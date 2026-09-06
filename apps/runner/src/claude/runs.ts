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
  CLAUDE_RUN_EVENT_KIND,
  RUNNER_ERROR,
  RUN_FAILURE_CATEGORY,
  RUN_STATUS,
  WORKSPACE_FINGERPRINT_VERSION,
  boundFailureDetail,
  buildClaudeToolPolicy,
  isRunnerRunId,
  repositoryLockKey,
  RUN_LIMITS,
  serializeWorkspaceEntries,
  type DeliveryPolicy,
  type RunFailureCategory,
  type RunStatus,
  type RunWorkspaceFingerprint,
  type RunnerErrorCode,
  type TaskKind,
} from "@nox/shared";

import type { ClaudeConfig } from "../config.ts";
import { resolveRepositoryRoot } from "../repositories/documents/repository-root.ts";
import {
  captureRepositoryChanges,
  type ReviewCaptureResult,
} from "../repositories/git-review.ts";
import { readGitChanges, type GitStateOptions } from "../repositories/git-state.ts";
import { computeWorkspaceFingerprint } from "../repositories/workspace-fingerprint.ts";
import { runCorrectionPreflight } from "./correction-preflight.ts";
import { launchClaude, type ClaudeLauncher, type LaunchOutcome } from "./launcher.ts";
import { detectUsageLimit, parseClaudeOutput } from "./output.ts";
import { runPreflight, type PreflightOptions } from "./preflight.ts";
import type { ClaudeRunRegistry } from "./registry.ts";
import { ClaudeStreamCollector } from "./stream/collector.ts";

export type StartRunRequest = {
  runId: string;
  repositoryPath: string;
  prompt: string;
  expectedGitHead: string;
  validationCommands: readonly string[];
  /** Nature de la tache : elle decide des programmes d'amorcage autorises. */
  taskKind: TaskKind;
  /**
   * Politique de livraison Git du projet, relue en base par le serveur web.
   *
   * Elle n'autorise aucune ecriture ici : elle dit seulement si une branche
   * locale en avance sur son upstream est un incident ou l'etat normal du
   * projet. Le preflight en a besoin ; rien d'autre sur cette route.
   */
  deliveryPolicy: DeliveryPolicy;
  /** Correction ciblee : session a reprendre et etat de depart attendu. */
  correction?: {
    sessionId: string;
    expectedBranch: string;
    expectedWorkspaceFingerprint: string;
    /** Entrees de l'etat relu, serialisees ; sert uniquement au diagnostic. */
    expectedWorkspaceEntries?: string | null;
  };
};

export type StartRunResult =
  | { ok: true; startedAt: Date }
  | {
      ok: false;
      code: RunnerErrorCode;
      /** Nomme les chemins divergents, quand le refus vient de l'empreinte. */
      detail?: string;
    };

export type StartRunOptions = PreflightOptions &
  GitStateOptions & {
    launch?: ClaudeLauncher;
    /**
     * Cle d'empreinte du dossier de travail, derivee du jeton du runner.
     *
     * Facultative : sans elle, les executions restent possibles mais ne
     * produisent aucune empreinte, donc ne sont pas reprenables. C'est le
     * comportement voulu pour un runner mal configure — refuser une reprise
     * qu'on ne saurait pas verifier plutot que l'accorder a l'aveugle.
     */
    fingerprintKey?: Buffer;
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
 * Traduit un refus du registre en code d'erreur du contrat.
 *
 * `already_active` designe **ce** repository, jamais le runner entier : deux
 * repositories differents peuvent executer Claude Code en meme temps. Le code
 * historique `CLAUDE_RUN_ALREADY_ACTIVE`, qui signifiait « occupe quelque part »,
 * n'est plus emis.
 */
function registerRefusal(reason: "already_active" | "duplicate_id" | "unknown_repository"): RunnerErrorCode {
  switch (reason) {
    case "already_active":
      return RUNNER_ERROR.REPOSITORY_CLAUDE_RUN_ALREADY_ACTIVE;
    case "unknown_repository":
      return RUNNER_ERROR.REPOSITORY_PATH_REQUIRED;
    case "duplicate_id":
      return RUNNER_ERROR.CLAUDE_RUN_ID_INVALID;
  }
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
  const policy = buildClaudeToolPolicy([...request.validationCommands], request.taskKind);
  if (!policy.ok) {
    return { ok: false, code: RUNNER_ERROR.CLAUDE_COMMAND_NOT_ALLOWED };
  }

  const repository = resolveRepositoryRoot(request.repositoryPath);
  if (!repository.ok) {
    return repository;
  }

  const correction = request.correction;

  /**
   * Deux preflights, un seul point de decision.
   *
   * Une correction ne peut pas exiger un repository propre — elle part du travail
   * relu, qui est encore la. Elle exige a la place que le dossier de travail soit
   * **exactement** celui qui a ete relu, empreinte a l'appui.
   *
   * Ce controle est refait **ici**, juste avant le lancement, et pas seulement au
   * moment ou la page de preparation s'est affichee. Entre l'affichage vert et le
   * clic, l'utilisateur a eu tout le temps d'enregistrer un fichier dans son
   * editeur ; sans cette seconde verification, la course lui donnerait raison.
   */
  const fingerprintKey = options.fingerprintKey;

  if (correction !== undefined && fingerprintKey === undefined) {
    // Sans cle, l'empreinte actuelle ne peut pas etre calculee, donc la
    // comparaison ne peut pas avoir lieu. NOX refuse plutot que de reprendre une
    // session sur un etat qu'il n'a pas su verifier.
    return { ok: false, code: RUNNER_ERROR.WORKSPACE_FINGERPRINT_UNAVAILABLE };
  }

  const preflight =
    correction === undefined || fingerprintKey === undefined
      ? await runPreflight(request.repositoryPath, claude, {
          ...options,
          deliveryPolicy: request.deliveryPolicy,
        })
      : await runCorrectionPreflight(
          {
            repositoryPath: request.repositoryPath,
            expectedGitHead: request.expectedGitHead,
            expectedBranch: correction.expectedBranch,
            expectedWorkspaceFingerprint: correction.expectedWorkspaceFingerprint,
            expectedWorkspaceEntries: correction.expectedWorkspaceEntries ?? null,
          },
          claude,
          { ...options, fingerprintKey },
        );

  if (!preflight.ok) {
    return preflight;
  }

  // Le controle qui justifie tout le reste : l'etat de depart doit etre celui
  // que l'utilisateur a vu. Le preflight de correction l'a deja fait ; le refaire
  // ne coute rien et garde les deux chemins symetriques.
  if (preflight.git.head !== request.expectedGitHead) {
    return { ok: false, code: RUNNER_ERROR.GIT_HEAD_CHANGED };
  }

  // L'exclusion d'execution porte sur le repository, pas sur le runner entier.
  // La cle est derivee de la racine **reelle** rendue par le systeme de fichiers,
  // jamais du chemin recu : c'est ce qui fait qu'un alias, une barre finale ou
  // une difference de casse sous Windows ne contournent rien.
  //
  // Le web a deja verifie la meme chose en base ; ce controle-ci ne lui fait pas
  // confiance, et il est le seul a voir les processus reels.
  const registered = registry.register(request.runId, repositoryLockKey(repository.root));
  if (!registered.ok) {
    return { ok: false, code: registerRefusal(registered.reason) };
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

  // Le contexte reste interne au runner : il sert a finaliser une execution
  // dont le processus refuserait de mourir, et un chemin absolu n'a rien a faire
  // dans une reponse HTTP.
  registry.attachContext(request.runId, {
    repositoryRoot: repository.root,
    headBefore: preflight.git.head,
  });

  // Un premier evenement immediat : sans lui, la timeline resterait vide
  // pendant les quelques secondes que Claude Code met a demarrer, et un
  // lancement qui echouerait tout de suite ne laisserait aucune trace.
  registry.appendEvents(request.runId, [
    {
      kind: CLAUDE_RUN_EVENT_KIND.STATUS,
      label: "Started",
      detail: null,
      toolName: null,
      isError: false,
    },
  ]);

  // Les commandes attendues sont recopiees maintenant, avant que quoi que ce
  // soit ne tourne : une commande jamais lancee doit apparaitre dans la review,
  // et elle ne le pourrait pas si la table etait remplie au fil des executions.
  registry.seedValidations(request.runId, request.validationCommands);

  // Le collecteur est cree avec la racine reelle du repository : c'est elle qui
  // permet de rendre les chemins relatifs plutot que de simplement les masquer.
  const collector = new ClaudeStreamCollector({
    repositoryRoot: repository.root,
    allowedCommands: policy.policy.authorizedCommands,
    onEvents: (events) => {
      registry.appendEvents(request.runId, events);
    },
    onValidation: (signal) => {
      registry.applyValidation(request.runId, signal);
    },
  });

  const launch = options.launch ?? launchClaude;
  const handle = launch({
    repositoryRoot: repository.root,
    prompt: request.prompt,
    allowedTools: policy.policy.allowed,
    disallowedTools: policy.policy.disallowed,
    claude,
    // La session vient du contexte interne de la requete, deja relu en base par
    // le serveur web. Les regles d'outils, elles, sont recalculees a l'identique :
    // une correction n'a pas plus de droits qu'un run initial.
    resumeSessionId: correction?.sessionId ?? null,
    onChunk: (chunk) => {
      collector.push(chunk);
    },
  });

  registry.attachKill(request.runId, handle.kill);

  // L'attente se poursuit en arriere-plan : la requete HTTP, elle, repond tout
  // de suite. `void` est explicite — rien n'attend cette promesse.
  void finishRun(
    request,
    repository.root,
    registry,
    handle.completed,
    preflight.git.head,
    collector,
    options,
  );

  return { ok: true, startedAt };
}

/** Libelle de l'evenement final, par statut. */
const FINAL_EVENT_LABELS: Record<RunStatus, string> = {
  [RUN_STATUS.QUEUED]: "Queued",
  [RUN_STATUS.RUNNING]: "Running",
  [RUN_STATUS.CANCELLING]: "Cancelling",
  [RUN_STATUS.BLOCKED]: "Blocked",
  [RUN_STATUS.FAILED]: "Failed",
  [RUN_STATUS.CANCELLED]: "Cancelled",
  [RUN_STATUS.COMPLETED]: "Completed",
};

/**
 * Conclut une execution : analyse, capture Git, statut final.
 *
 * Ne leve jamais : une exception ici laisserait une execution eternellement
 * active, et le web attendrait un resultat qui n'arriverait pas.
 *
 * ## L'ordre des diagnostics n'est pas arbitraire
 *
 * 1. **Le processus n'a pas demarre** : rien d'autre n'a de sens.
 * 2. **Le delai maximal** : NOX a tue le processus, il sait pourquoi.
 * 3. **Une limite d'utilisation** : appelle une action tres differente — attendre.
 * 4. **Une violation Git** : prime sur tout le reste, y compris sur une
 *    annulation demandee. Un commit interdit reste un commit interdit, et c'est
 *    ce qu'il faut regarder en premier.
 * 5. **Une annulation demandee** : mais seulement si l'execution n'a pas eu le
 *    temps de reussir proprement. Voir ci-dessous.
 * 6. Sortie illisible, code de retour, puis reussite.
 *
 * ## La course entre la fin et l'annulation
 *
 * Un clic sur « Cancel run » et une terminaison naturelle peuvent arriver dans
 * la meme milliseconde. La regle est simple : **le premier etat final
 * validement enregistre gagne**, et `CANCELLING` n'est pas un etat final. Si le
 * processus a rendu un resultat complet, un code de sortie nul et aucune erreur,
 * alors il a fini son travail — l'annulation est arrivee trop tard, et le run
 * est `COMPLETED`. Dans tous les autres cas, l'annulation a bien interrompu
 * quelque chose, et le run est `CANCELLED`.
 */
async function finishRun(
  request: StartRunRequest,
  repositoryRoot: string,
  registry: ClaudeRunRegistry,
  completed: Promise<LaunchOutcome>,
  headBefore: string,
  collector: ClaudeStreamCollector,
  options: StartRunOptions,
): Promise<void> {
  try {
    const outcome = await completed;

    // La derniere ligne du flux n'a pas de retour a la ligne : sans ce `end`,
    // c'est le resultat final lui-meme qui serait perdu.
    collector.end();

    // L'etat Git est capture dans tous les cas, y compris apres un echec ou une
    // annulation : c'est souvent la seule facon de savoir ce que l'execution a
    // laisse derriere elle. NOX constate, et ne restaure rien.
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

    /**
     * Fige l'execution, puis capture sa review.
     *
     * L'ordre est celui de TASK-011 : etat Git final, puis instantane detaille,
     * puis statut. La capture est **tentee** dans tous les cas finaux — reussite,
     * echec, blocage, annulation — parce que c'est justement apres un echec ou
     * une interruption qu'on a le plus besoin de voir ce qui a ete laisse sur le
     * disque.
     *
     * Un echec de la capture ne change **jamais** le sort de l'execution : le
     * compte rendu de Claude Code, ses durees et son etat Git restent ce qu'ils
     * sont. Un diff que NOX n'a pas su lire n'est pas un travail rate.
     */
    const conclude = async (
      status: RunStatus,
      update: Parameters<typeof registry.finish>[2],
      unreliable = false,
    ): Promise<void> => {
      // La categorie est ecrite **ici**, au moment ou NOX observe la
      // terminaison, et jamais recalculee ensuite. Le pilote reel n'avait qu'un
      // `CLAUDE_PROCESS_FAILED` : un code qui melangeait « le systeme a rendu 1 »
      // et « l'agent s'est declare en echec », deux incidents qui n'appellent
      // pas le meme geste.
      const captured = await captureReview(repositoryRoot, headBefore, options);
      // L'empreinte est prise **au meme instant** que la review, et pour la meme
      // raison : les deux decrivent l'etat que l'utilisateur va relire. Un echec
      // ici ne change rien au sort de l'execution — il rend seulement la reprise
      // ciblee impossible, et l'interface le dira.
      const workspace = await captureFingerprint(repositoryRoot, options);

      // `finish` fige les validations en cours : elles doivent l'etre avant
      // d'entrer dans l'instantane, sinon la review afficherait un « Running »
      // eternel pour un processus deja mort.
      registry.finish(request.runId, status, update);

      registry.attachReview(
        request.runId,
        captured.ok
          ? {
              ok: true,
              snapshot: {
                capturedAt: new Date().toISOString(),
                headBefore,
                unreliable,
                files: captured.changes.files,
                omittedFiles: captured.changes.omittedFiles,
                validations: registry.validations(request.runId),
                workspace,
              },
            }
          : { ok: false, code: captured.code },
      );

      // L'evenement final est ajoute apres la finalisation : le statut affiche
      // et le dernier evenement de la timeline disent alors la meme chose.
      // C'est un `STATUS`, donc il survit a une troncature.
      registry.appendEvents(request.runId, [
        {
          kind: CLAUDE_RUN_EVENT_KIND.STATUS,
          label: FINAL_EVENT_LABELS[status],
          detail: null,
          toolName: null,
          isError: status === RUN_STATUS.FAILED,
        },
      ]);
    };

    if (outcome.spawnError !== null) {
      await conclude(RUN_STATUS.FAILED, {
        ...gitUpdate,
        errorCode: RUNNER_ERROR.CLAUDE_START_FAILED,
        ...failure(
          RUN_FAILURE_CATEGORY.SPAWN_FAILED,
          // `spawnError` est deja le seul code systeme, ecrit par le lanceur —
          // jamais le message de Node, qui porterait le chemin absolu du binaire.
          `Le processus Claude Code n'a pas pu etre lance (${outcome.spawnError}).`,
        ),
        stderrTail: outcome.stderrTail,
        exitCode: null,
      });
      return;
    }

    if (outcome.timedOut) {
      await conclude(RUN_STATUS.BLOCKED, {
        ...gitUpdate,
        errorCode: RUNNER_ERROR.CLAUDE_TIMEOUT,
        ...failure(
          RUN_FAILURE_CATEGORY.TIMEOUT,
          "NOX a atteint son plafond de duree et a arrete le processus. " +
            "Le travail deja ecrit dans le dossier de travail est intact.",
        ),
        stderrTail: outcome.stderrTail,
        exitCode: outcome.exitCode,
      });
      return;
    }

    // Le resultat final vient de la ligne `result` mise de cote par le
    // collecteur, relue par le parser de TASK-008 — inchange. La sortie
    // accumulee reste le repli des tests qui n'utilisent pas le streaming.
    const parsed = parseClaudeOutput(collector.finalResultLine ?? outcome.stdout);
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
      await conclude(RUN_STATUS.BLOCKED, {
        ...gitUpdate,
        ...claudeFields,
        errorCode: RUNNER_ERROR.CLAUDE_LIMIT_REACHED,
        ...failure(
          RUN_FAILURE_CATEGORY.USAGE_LIMIT,
          "Une limite d'utilisation Claude a ete reconnue. Le geste qui s'applique est d'attendre.",
        ),
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

    // Une violation Git reste prioritaire, y compris apres une annulation :
    // l'utilisateur doit apprendre d'abord qu'un commit interdit existe, et
    // ensuite seulement que le processus a ete interrompu.
    if (violated) {
      await conclude(
        RUN_STATUS.FAILED,
        {
          ...gitUpdate,
          ...claudeFields,
          errorCode: RUNNER_ERROR.GIT_POLICY_VIOLATION,
          ...failure(
            RUN_FAILURE_CATEGORY.GIT_POLICY_VIOLATION,
            "L'execution a modifie l'etat Git alors qu'elle n'en avait pas le droit. " +
              "NOX n'a rien restaure.",
          ),
        },
        // Le detail est capture quand meme — il reste la meilleure trace de ce
        // qui s'est passe — mais il est marque comme non fiable : compare a
        // `headBefore`, il melange le commit interdit et le travail en cours,
        // et ne decrit plus « ce que l'agent a produit depuis un etat propre ».
        true,
      );
      return;
    }

    // Un processus tue rend presque toujours une sortie incomplete et un code
    // non nul. Les diagnostics suivants n'ont donc de sens que si personne n'a
    // demande l'arret — sans quoi NOX signalerait « sortie illisible » pour une
    // interruption parfaitement volontaire.
    const cleanSuccess = parsed.ok && outcome.exitCode === 0 && report?.isError !== true;
    if (registry.isCancellationRequested(request.runId) && !cleanSuccess) {
      await conclude(RUN_STATUS.CANCELLED, {
        ...gitUpdate,
        ...claudeFields,
        // Aucun code d'erreur : une annulation demandee et obtenue n'est pas un
        // incident. Ce qu'il faut regarder, c'est l'etat du repository. La
        // categorie, elle, est renseignee : « pourquoi cela s'est-il arrete ? »
        // a une reponse, meme quand « qu'est-ce qui a echoue ? » n'en a pas.
        errorCode: null,
        ...failure(
          RUN_FAILURE_CATEGORY.CANCELLED,
          "Un humain a demande l'arret, et le processus s'est arrete.",
        ),
      });
      return;
    }

    if (!parsed.ok) {
      await conclude(RUN_STATUS.FAILED, {
        ...gitUpdate,
        ...claudeFields,
        errorCode: RUNNER_ERROR.CLAUDE_OUTPUT_INVALID,
        ...failure(
          RUN_FAILURE_CATEGORY.STREAM_UNREADABLE,
          "Le processus a parle, mais NOX n'a pas retrouve la ligne de resultat attendue " +
            "dans son flux.",
        ),
      });
      return;
    }

    // Ces deux issues partagent `CLAUDE_PROCESS_FAILED` — le code du contrat ne
    // bouge pas, et les executions deja enregistrees restent lisibles — mais
    // elles ne disent pas la meme chose. Un code de sortie non nul est le
    // systeme qui tranche ; un `is_error` sur une sortie nulle est l'agent qui
    // renonce. Le second pilote reel etait le premier cas, et l'ecran ne
    // permettait pas de le savoir.
    if (outcome.exitCode !== null && outcome.exitCode !== 0) {
      await conclude(RUN_STATUS.FAILED, {
        ...gitUpdate,
        ...claudeFields,
        errorCode: RUNNER_ERROR.CLAUDE_PROCESS_FAILED,
        ...failure(
          RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO,
          `Le processus Claude Code s'est termine avec le code ${String(outcome.exitCode)}. ` +
            "Ce qu'il avait deja ecrit reste dans le dossier de travail.",
        ),
      });
      return;
    }

    // Un processus tue par un signal ne rend aucun code. NOX sait qu'il est mort,
    // pas pourquoi : ni le systeme ni l'agent n'ont tranche, et personne ne l'a
    // demande — le delai et l'annulation ont deja ete traites plus haut.
    if (outcome.exitCode === null) {
      await conclude(RUN_STATUS.FAILED, {
        ...gitUpdate,
        ...claudeFields,
        errorCode: RUNNER_ERROR.CLAUDE_PROCESS_FAILED,
        ...failure(
          RUN_FAILURE_CATEGORY.UNKNOWN,
          "Le processus a ete termine par un signal, sans rendre de code de sortie. " +
            "NOX ne sait pas ce qui l'a tue.",
        ),
      });
      return;
    }

    if (report?.isError === true) {
      await conclude(RUN_STATUS.FAILED, {
        ...gitUpdate,
        ...claudeFields,
        errorCode: RUNNER_ERROR.CLAUDE_PROCESS_FAILED,
        ...failure(
          RUN_FAILURE_CATEGORY.AGENT_REPORTED_ERROR,
          "Claude Code s'est declare en erreur dans son compte rendu final, " +
            "alors que son code de sortie etait nul.",
        ),
      });
      return;
    }

    await conclude(RUN_STATUS.COMPLETED, {
      ...gitUpdate,
      ...claudeFields,
      errorCode: null,
    });
  } catch {
    // Aucun detail n'est expose : le web recevra un code, et les logs du runner
    // portent deja ce qu'il faut.
    registry.finish(request.runId, RUN_STATUS.FAILED, {
      errorCode: RUNNER_ERROR.CLAUDE_PROCESS_FAILED,
      failureCategory: RUN_FAILURE_CATEGORY.UNKNOWN,
      failureDetail:
        "La finalisation de l'execution a echoue dans le runner. NOX ne peut rien " +
        "affirmer de ce que le processus a laisse derriere lui.",
    });
  }
}

/**
 * Compose les deux champs de diagnostic d'une issue.
 *
 * Un helper plutot que deux lignes recopiees huit fois : c'est ce qui garantit
 * qu'aucune issue ne nomme sa categorie sans expliquer pourquoi, et que la
 * phrase passe toujours par la meme borne.
 *
 * Toutes les phrases sont ecrites par NOX. Aucune ne provient du systeme, du
 * processus, ni du reseau — c'est la seule facon de garantir qu'un chemin absolu
 * ou un fragment d'environnement ne puisse pas y entrer.
 */
function failure(
  category: RunFailureCategory,
  detail: string,
): { failureCategory: string; failureDetail: string | null } {
  return { failureCategory: category, failureDetail: boundFailureDetail(detail) };
}

/**
 * Capture le detail des changements, sans jamais faire tomber la finalisation.
 *
 * Le `try` n'est pas decoratif : cette fonction lit le disque et lance des
 * commandes, et une exception ici laisserait une execution eternellement active.
 * Un echec devient un code d'erreur de review — le resultat de Claude Code, lui,
 * reste intact.
 */
async function captureReview(
  repositoryRoot: string,
  headBefore: string,
  options: GitStateOptions,
): Promise<ReviewCaptureResult> {
  try {
    return await captureRepositoryChanges(repositoryRoot, headBefore, {
      runGit: options.runGit,
    });
  } catch {
    return { ok: false, code: RUNNER_ERROR.CLAUDE_REVIEW_FAILED };
  }
}

/**
 * Calcule l'empreinte du dossier de travail, sans jamais faire tomber la fin.
 *
 * Un echec n'est pas une erreur d'execution : il produit une empreinte `null`
 * assortie de son code, ce qui rendra simplement la reprise ciblee indisponible.
 * L'interface l'expliquera plutot que de proposer un bouton qui echouerait.
 */
async function captureFingerprint(
  repositoryRoot: string,
  options: StartRunOptions,
): Promise<RunWorkspaceFingerprint> {
  if (options.fingerprintKey === undefined) {
    return {
      value: null,
      version: WORKSPACE_FINGERPRINT_VERSION,
      errorCode: RUNNER_ERROR.WORKSPACE_FINGERPRINT_UNAVAILABLE,
    };
  }

  try {
    const result = await computeWorkspaceFingerprint(repositoryRoot, options.fingerprintKey, {
      runGit: options.runGit,
    });
    return result.ok
      ? {
          value: result.value,
          version: WORKSPACE_FINGERPRINT_VERSION,
          errorCode: null,
          // `null` quand la liste depasse ses bornes : la reprise reste
          // possible, son refus eventuel sera simplement moins bavard.
          entries: serializeWorkspaceEntries(result.entries),
        }
      : { value: null, version: WORKSPACE_FINGERPRINT_VERSION, errorCode: result.code };
  } catch {
    return {
      value: null,
      version: WORKSPACE_FINGERPRINT_VERSION,
      errorCode: RUNNER_ERROR.WORKSPACE_FINGERPRINT_UNAVAILABLE,
    };
  }
}
