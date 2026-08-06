/**
 * Cycle de vie d'une execution Claude Code, cote runner.
 *
 * `startClaudeRun` fait tout ce qui doit etre fait **avant** de repondre au web,
 * puis rend la main : les verifications, l'enregistrement au registre, le
 * lancement. La suite — attendre, analyser, capturer l'etat Git — se poursuit en
 * arriere-plan, sans qu'aucune requete HTTP ne l'attende.
 *
 * ## Les verifications sont refaites ici
 *
 * Le preflight a deja tout controle, mais entre le preflight et le lancement
 * l'utilisateur a lu un prompt, reflechi, peut-etre fait un `git pull`. Refaire
 * les controles au moment du lancement n'est pas de la paranoia : c'est la seule
 * facon de garantir que l'execution part de l'etat que l'utilisateur a valide.
 * `expectedGitHead` rend ce controle explicite.
 *
 * ## NOX ne repare rien
 *
 * Si l'execution a viole les regles Git — un commit malgre l'interdiction, un
 * changement de branche —, le runner le **constate** et le signale. Aucun
 * `reset`, aucun `restore`, aucun `checkout` : une reparation automatique
 * detruirait justement le travail que l'utilisateur doit relire pour comprendre
 * ce qui s'est passe.
 */

import {
  RUNNER_ERROR,
  RUN_STATUS,
  buildClaudeToolPolicy,
  isRunnerRunId,
  RUN_LIMITS,
  type RunnerErrorCode,
} from "@nox/shared";

import type { ClaudeConfig } from "../config.ts";
import { resolveRepositoryRoot } from "../repositories/documents/repository-root.ts";
import { readGitChanges, type GitStateOptions } from "../repositories/git-state.ts";
import { launchClaude, type ClaudeLauncher, type LaunchOutcome } from "./launcher.ts";
import { detectUsageLimit, parseClaudeOutput } from "./output.ts";
import { runPreflight, type PreflightOptions } from "./preflight.ts";
import type { ClaudeRunRegistry } from "./registry.ts";

export type StartRunRequest = {
  runId: string;
  repositoryPath: string;
  prompt: string;
  expectedGitHead: string;
  validationCommands: readonly string[];
};

export type StartRunResult =
  | { ok: true; startedAt: Date }
  | { ok: false; code: RunnerErrorCode };

export type StartRunOptions = PreflightOptions &
  GitStateOptions & {
    launch?: ClaudeLauncher;
  };

/**
 * Verifie la forme du prompt.
 *
 * Le contenu n'est pas juge — c'est le web qui le genere, de facon
 * deterministe. Seules sa presence, sa taille et l'absence d'octet nul sont
 * controlees : un octet nul dans une chaine ecrite sur `stdin` produirait un
 * comportement dependant de la plateforme.
 */
function checkPrompt(prompt: string): RunnerErrorCode | null {
  if (prompt.trim() === "") {
    return RUNNER_ERROR.CLAUDE_PROMPT_INVALID;
  }
  if (prompt.includes("\0")) {
    return RUNNER_ERROR.CLAUDE_PROMPT_INVALID;
  }
  if (prompt.length > RUN_LIMITS.prompt) {
    return RUNNER_ERROR.CLAUDE_PROMPT_INVALID;
  }
  return null;
}

/**
 * Lance une execution et repond sans attendre sa fin.
 *
 * Toutes les preconditions sont verifiees avant que quoi que ce soit ne demarre :
 * un refus ne laisse ni processus orphelin, ni entree au registre.
 */
export async function startClaudeRun(
  request: StartRunRequest,
  claude: ClaudeConfig,
  registry: ClaudeRunRegistry,
  options: StartRunOptions = {},
): Promise<StartRunResult> {
  if (!isRunnerRunId(request.runId)) {
    return { ok: false, code: RUNNER_ERROR.CLAUDE_RUN_ID_INVALID };
  }

  const promptProblem = checkPrompt(request.prompt);
  if (promptProblem !== null) {
    return { ok: false, code: promptProblem };
  }

  // Les commandes sont revalidees ici meme si le web les a deja verifiees : le
  // runner est la derniere barriere avant l'execution, et il ne fait confiance a
  // personne sur ce point.
  const policy = buildClaudeToolPolicy([...request.validationCommands]);
  if (!policy.ok) {
    return { ok: false, code: RUNNER_ERROR.CLAUDE_COMMAND_NOT_ALLOWED };
  }

  const repository = resolveRepositoryRoot(request.repositoryPath);
  if (!repository.ok) {
    return repository;
  }

  const preflight = await runPreflight(request.repositoryPath, claude, options);
  if (!preflight.ok) {
    return preflight;
  }

  // Le controle qui justifie tout le reste : l'etat de depart doit etre celui
  // que l'utilisateur a vu.
  if (preflight.git.head !== request.expectedGitHead) {
    return { ok: false, code: RUNNER_ERROR.GIT_HEAD_CHANGED };
  }

  const registered = registry.register(request.runId);
  if (!registered.ok) {
    return {
      ok: false,
      code:
        registered.reason === "already_active"
          ? RUNNER_ERROR.CLAUDE_RUN_ALREADY_ACTIVE
          : RUNNER_ERROR.CLAUDE_RUN_ID_INVALID,
    };
  }

  const startedAt = new Date();
  registry.update(request.runId, {
    git: {
      branch: preflight.git.branch,
      upstream: preflight.git.upstream,
      headBefore: preflight.git.head,
      headAfter: null,
      diffStat: null,
      changedFiles: [],
    },
  });
  registry.start(request.runId, startedAt);

  const launch = options.launch ?? launchClaude;
  const handle = launch({
    repositoryRoot: repository.root,
    prompt: request.prompt,
    allowedTools: policy.policy.allowed,
    disallowedTools: policy.policy.disallowed,
    claude,
  });

  registry.attachKill(request.runId, handle.kill);

  // L'attente se poursuit en arriere-plan : la requete HTTP, elle, repond tout
  // de suite. `void` est explicite — rien n'attend cette promesse.
  void finishRun(request, repository.root, registry, handle.completed, preflight.git.head, options);

  return { ok: true, startedAt };
}

/**
 * Conclut une execution : analyse, capture Git, statut final.
 *
 * Ne leve jamais : une exception ici laisserait une execution eternellement
 * active, et le web attendrait un resultat qui n'arriverait pas.
 */
async function finishRun(
  request: StartRunRequest,
  repositoryRoot: string,
  registry: ClaudeRunRegistry,
  completed: Promise<LaunchOutcome>,
  headBefore: string,
  options: GitStateOptions,
): Promise<void> {
  try {
    const outcome = await completed;

    // L'etat Git est capture dans tous les cas, y compris apres un echec : c'est
    // souvent la seule facon de savoir ce que l'execution a laisse derriere elle.
    const changes = await readGitChanges(repositoryRoot, options);

    const gitUpdate = {
      git: {
        branch: changes.branch,
        upstream: registry.snapshot(request.runId)?.git.upstream ?? null,
        headBefore,
        headAfter: changes.head,
        diffStat: changes.diffStat,
        changedFiles: changes.changedFiles,
      },
    };

    if (outcome.spawnError !== null) {
      registry.finish(request.runId, RUN_STATUS.FAILED, {
        ...gitUpdate,
        errorCode: RUNNER_ERROR.CLAUDE_START_FAILED,
        stderrTail: outcome.stderrTail,
        exitCode: null,
      });
      return;
    }

    if (outcome.timedOut) {
      registry.finish(request.runId, RUN_STATUS.BLOCKED, {
        ...gitUpdate,
        errorCode: RUNNER_ERROR.CLAUDE_TIMEOUT,
        stderrTail: outcome.stderrTail,
        exitCode: outcome.exitCode,
      });
      return;
    }

    const parsed = parseClaudeOutput(outcome.stdout);
    const report = parsed.ok ? parsed.result : null;

    const claudeFields = {
      resultText: report?.result ?? null,
      claudeSessionId: report?.sessionId ?? null,
      durationMs: report?.durationMs ?? null,
      durationApiMs: report?.durationApiMs ?? null,
      numTurns: report?.numTurns ?? null,
      reportedCostUsd: report?.totalCostUsd ?? null,
      exitCode: outcome.exitCode,
      stderrTail: outcome.stderrTail,
    };

    // La limite d'utilisation est cherchee avant tout autre diagnostic : elle
    // appelle une action tres differente — attendre, plutot que corriger.
    if (detectUsageLimit({ parsed: report, stderrTail: outcome.stderrTail, exitCode: outcome.exitCode })) {
      registry.finish(request.runId, RUN_STATUS.BLOCKED, {
        ...gitUpdate,
        ...claudeFields,
        errorCode: RUNNER_ERROR.CLAUDE_LIMIT_REACHED,
      });
      return;
    }

    // Une violation des regles Git prime sur le resultat annonce par l'agent :
    // un travail « reussi » qui a cree un commit reste un echec pour NOX.
    const violated =
      (changes.head !== null && changes.head !== headBefore) ||
      (changes.branch !== null &&
        registry.snapshot(request.runId)?.git.branch !== null &&
        changes.branch !== registry.snapshot(request.runId)?.git.branch);

    if (violated) {
      registry.finish(request.runId, RUN_STATUS.FAILED, {
        ...gitUpdate,
        ...claudeFields,
        errorCode: RUNNER_ERROR.GIT_POLICY_VIOLATION,
      });
      return;
    }

    if (!parsed.ok) {
      registry.finish(request.runId, RUN_STATUS.FAILED, {
        ...gitUpdate,
        ...claudeFields,
        errorCode: RUNNER_ERROR.CLAUDE_OUTPUT_INVALID,
      });
      return;
    }

    if (outcome.exitCode !== 0 || report?.isError === true) {
      registry.finish(request.runId, RUN_STATUS.FAILED, {
        ...gitUpdate,
        ...claudeFields,
        errorCode: RUNNER_ERROR.CLAUDE_PROCESS_FAILED,
      });
      return;
    }

    registry.finish(request.runId, RUN_STATUS.COMPLETED, {
      ...gitUpdate,
      ...claudeFields,
      errorCode: null,
    });
  } catch {
    // Aucun detail n'est expose : le web recevra un code, et les logs du runner
    // portent deja ce qu'il faut.
    registry.finish(request.runId, RUN_STATUS.FAILED, {
      errorCode: RUNNER_ERROR.CLAUDE_PROCESS_FAILED,
    });
  }
}
