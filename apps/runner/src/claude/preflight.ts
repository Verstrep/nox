/**
 * Preflight : verifier qu'un lancement est possible, sans rien modifier.
 *
 * Ce module existe pour une raison simple : **apres une execution, il faut
 * pouvoir dire ce que Claude Code a change**. Ce n'est possible que si l'on
 * connait exactement l'etat de depart. Un repository sale melange le travail de
 * l'agent a celui qui trainait deja ; une branche detachee ou desynchronisee
 * rend le `git diff` de fin ininterpretable.
 *
 * Tous les refus sont donc des refus **avant** lancement, jamais des
 * corrections apres coup : NOX ne nettoie pas le repository de l'utilisateur.
 */

import {
  RUNNER_ERROR,
  type ClaudePreflightGit,
  type RunnerErrorCode,
} from "@nox/shared";

import type { ClaudeConfig } from "../config.ts";
import { resolveRepositoryRoot } from "../repositories/documents/repository-root.ts";
import { readGitState, type GitStateOptions } from "../repositories/git-state.ts";
import {
  CLAUDE_VERSION_TIMEOUT_MS,
  probeClaudeVersion,
  type ClaudeVersionProbe,
} from "./executable.ts";

export type PreflightResult =
  | { ok: true; claudeVersion: string; git: ClaudePreflightGit }
  | { ok: false; code: RunnerErrorCode };

export type PreflightOptions = GitStateOptions & {
  probeVersion?: ClaudeVersionProbe;
  versionTimeoutMs?: number;
};

/**
 * Verifie qu'un repository est pret a recevoir une execution.
 *
 * L'ordre des controles n'est pas indifferent : Git d'abord, Claude Code
 * ensuite. Un repository sale se corrige en quelques secondes, alors qu'une
 * installation manquante demande une intervention — autant signaler d'abord ce
 * que l'utilisateur peut regler tout de suite.
 */
export async function runPreflight(
  repositoryPath: string,
  claude: ClaudeConfig,
  options: PreflightOptions = {},
): Promise<PreflightResult> {
  const repository = resolveRepositoryRoot(repositoryPath);
  if (!repository.ok) {
    return repository;
  }

  const state = await readGitState(repository.root, options);
  if (!state.ok) {
    return state;
  }

  if (!state.state.clean) {
    return { ok: false, code: RUNNER_ERROR.REPOSITORY_DIRTY };
  }

  // Une branche en avance ou en retard rend la relecture ambigue : on ne saurait
  // plus dire si un ecart vient de l'agent ou d'un `pull` en attente.
  if (state.state.ahead !== 0 || state.state.behind !== 0) {
    return { ok: false, code: RUNNER_ERROR.GIT_NOT_SYNCHRONIZED };
  }

  const probe = options.probeVersion ?? probeClaudeVersion;
  const version = await probe(
    claude.executable,
    options.versionTimeoutMs ?? CLAUDE_VERSION_TIMEOUT_MS,
  );

  if (!version.available) {
    return { ok: false, code: RUNNER_ERROR.CLAUDE_NOT_AVAILABLE };
  }

  return { ok: true, claudeVersion: version.version, git: state.state };
}
