/**
 * L'unique autorite sur « cette execution en echec peut-elle etre reprise ? ».
 *
 * ## Pourquoi ce module existe
 *
 * Parce que la question etait posee a deux endroits, avec deux jeux de faits.
 *
 * `loadCorrectionContext` assemblait le candidat en lisant la base — dont
 * `isLatestRun`, le fait qui reconnait un `Retry` avorte. La page de preparation,
 * elle, rappelait `checkResumeCandidate` a la main et **oubliait ce fait**. Les
 * deux verdicts divergeaient donc exactement sur le cas que HOTFIX-006 venait
 * d'ouvrir, et le troisieme pilote reel a lu les deux moities de la
 * contradiction sur le meme ecran :
 *
 * ```text
 * « un Retry l'y a menee, mais aucune execution n'a demarre »   ← cycle : reconnu
 * « Task is in Failed — Blocked »                              ← page  : refuse
 * ```
 *
 * Le defaut n'etait pas dans une regle, mais dans le fait qu'il y en avait deux.
 *
 * ## Ce que ce module garantit
 *
 * Un seul assemblage du candidat, lu en base, utilise par l'ecran **et** par le
 * lancement. Une regle qui change ne peut plus changer d'un cote seulement.
 *
 * ## Ce qu'il n'autorise pas
 *
 * Rien. Le runner recalcule branche, `HEAD` et empreinte juste avant le spawn, et
 * `startTaskCorrection` rejoue la preuve d'historique **dans** la transaction qui
 * ecrit. Ce module dit ce que NOX sait ; il ne remplace aucun controle.
 */

import {
  getRunResumeContext,
  hasActiveRun,
  isLatestRunForTask,
  type DatabaseClient,
} from "@nox/database";
import {
  CORRECTION_REFUSAL,
  RESUME_REFUSAL,
  checkResumeCandidate,
  type CorrectionRefusalCode,
  type ResumeCandidate,
  type ResumeRefusal,
} from "@nox/shared";

import { loadCorrectionContext, type CorrectionContext } from "./correction-cycle.ts";
import {
  allPreconditionsMet,
  buildPreconditions,
  correctionRefusalMessage,
  resumeRefusalMessage,
  type Precondition,
} from "./correction-display.ts";
import { claudeCorrectionPreflight } from "./runner/client.ts";
import { describeInfrastructureFailure } from "./runner/errors.ts";

/** Acces au runner ; remplace par une doublure dans les tests. */
export type FailureCorrectionPorts = {
  preflight: typeof claudeCorrectionPreflight;
};

const RUNNER_PORTS: FailureCorrectionPorts = { preflight: claudeCorrectionPreflight };

/**
 * Ce qui, dans l'historique, a fait refuser.
 *
 * Nomme par le verdict lui-meme plutot que deduit de son code : deux familles de
 * refus — celle de `checkResumeCandidate` et celle de `checkProcessFailureCorrection` —
 * portent des codes differents pour la meme cause, et les reconcilier chez
 * l'appelant serait recreer la duplication qu'on vient de supprimer.
 */
export const FAILURE_GATE_CAUSE = {
  /** Le statut de la tache ne se prete pas a une reprise. */
  TASK_STATUS: "TASK_STATUS",
  /** L'execution ne laisse rien a reprendre. */
  RUN_STATE: "RUN_STATE",
  /** Session absente, review absente, repository occupe, deja corrigee… */
  OTHER: "OTHER",
} as const;

export type FailureGateCause = (typeof FAILURE_GATE_CAUSE)[keyof typeof FAILURE_GATE_CAUSE];

/**
 * Le verdict d'historique : la tache et son passe autorisent-ils une reprise ?
 *
 * Separe du preflight, et volontairement : celui-ci interroge le disque, celui-la
 * lit la base. Les melanger empechait de dire lequel des deux refusait — et c'est
 * precisement ce que l'ecran du pilote ne savait plus dire.
 */
export type FailureHistoryGate =
  | { ok: true; strandedRetry: boolean }
  | {
      ok: false;
      strandedRetry: boolean;
      cause: FailureGateCause;
      message: string;
    };

/** Ce que la preparation d'une reprise apres echec sait, et ce qu'elle propose. */
export type FailureCorrectionEligibility = {
  /** Le cycle de correction, deja charge : la page en a besoin pour le prompt. */
  cycle: CorrectionContext;
  /** Le verdict d'historique, seul et unique. */
  history: FailureHistoryGate;
  /** La tache est `READY` parce qu'un `Retry` n'a jamais demarre. */
  strandedRetry: boolean;
  /**
   * L'execution ne porte pas d'empreintes par entree.
   *
   * N'empeche **rien** : l'empreinte globale decide comme partout ailleurs.
   * Seule la localisation d'une divergence manquera en cas de refus.
   */
  entriesUnavailable: boolean;
  /** Le runner a-t-il ete interroge ? `false` quand l'historique refusait deja. */
  probed: boolean;
  preconditions: Precondition[];
  /** Toutes les conditions sont tenues : le bouton peut partir. */
  ready: boolean;
};

/**
 * Assemble le candidat a la reprise, **entierement** depuis la base.
 *
 * C'est le seul endroit ou ces faits sont reunis. Un appelant qui en composerait
 * d'autres reintroduirait la divergence que ce module existe pour supprimer.
 */
export async function loadFailureHistoryGate(
  db: DatabaseClient,
  input: { taskId: string; runId: string; taskStatus: string },
): Promise<{ gate: FailureHistoryGate; cycle: CorrectionContext | null }> {
  const cycle = await loadCorrectionContext(db, { runId: input.runId, taskId: input.taskId });
  const context = await getRunResumeContext(db, input.runId);

  if (cycle === null || context === null || context.taskId !== input.taskId) {
    return {
      cycle,
      gate: {
        ok: false,
        strandedRetry: false,
        cause: FAILURE_GATE_CAUSE.OTHER,
        message: "Cette execution ne designe rien de connu.",
      },
    };
  }

  const refusal = checkResumeCandidate(
    resumeCandidateFrom(context, {
      taskStatus: input.taskStatus,
      hasActiveRun: await hasActiveRun(db, input.taskId),
      // Le fait qui manquait a la page. Sans lui, un `Retry` avorte se lit
      // comme une tache prete ordinaire, et la reprise est refusee sur son
      // statut alors que tout ce qu'elle protege est intact.
      isLatestRun: await isLatestRunForTask(db, input.taskId, input.runId),
    }),
  );

  if (refusal !== null) {
    return {
      cycle,
      gate: {
        ok: false,
        strandedRetry: cycle.strandedRetry,
        cause: resumeRefusalCause(refusal),
        message: resumeRefusalMessage(refusal),
      },
    };
  }

  // Le second verdict — « cet echec a-t-il laisse quelque chose, et rien ne
  // l'occupe-t-il ? » — vient du cycle, qui l'a deja calcule avec les memes
  // faits. Le recalculer ici serait recreer la divergence.
  if (!cycle.processFailure.eligible) {
    return {
      cycle,
      gate: {
        ok: false,
        strandedRetry: cycle.strandedRetry,
        cause: correctionRefusalCause(cycle.processFailure.code),
        message: correctionRefusalMessage(cycle.processFailure.code),
      },
    };
  }

  return { cycle, gate: { ok: true, strandedRetry: cycle.strandedRetry } };
}

/**
 * Assemble le candidat a la reprise, a un seul endroit.
 *
 * ## Pourquoi cette fonction existe
 *
 * Parce que `ResumeCandidate` etait rempli a la main sur huit surfaces, et qu'il
 * suffisait d'en oublier un champ pour obtenir un verdict different du voisin.
 * C'est exactement ce qui est arrive a `isLatestRun` : le lancement le passait,
 * la page de preparation non, et les deux repondaient donc l'inverse l'un de
 * l'autre sur le seul cas que HOTFIX-006 venait d'ouvrir.
 *
 * Elle est **pure** et ne relit rien : ses appelants ont deja le contexte en
 * main, et une seconde requete par surface serait le prix d'une garantie qu'on
 * peut obtenir sans elle. Ce qu'elle garantit est ailleurs — un champ ajoute a
 * `ResumeCandidate` n'a plus qu'un seul endroit ou etre rempli.
 */
export function resumeCandidateFrom(
  context: {
    status: string;
    errorCode: string | null;
    exitCode: number | null;
    claudeSessionId: string | null;
    hasReview: boolean;
    hasCorrection: boolean;
    workspaceFingerprint: string | null;
  },
  facts: { taskStatus: string; hasActiveRun: boolean; isLatestRun: boolean },
): ResumeCandidate {
  return {
    runStatus: context.status,
    taskStatus: facts.taskStatus,
    errorCode: context.errorCode,
    exitCode: context.exitCode,
    claudeSessionId: context.claudeSessionId,
    hasReview: context.hasReview,
    hasFingerprint: context.workspaceFingerprint !== null,
    hasActiveRun: facts.hasActiveRun,
    hasCorrection: context.hasCorrection,
    isLatestRun: facts.isLatestRun,
  };
}

/** A quelle precondition un refus de `checkResumeCandidate` se rattache. */
function resumeRefusalCause(refusal: ResumeRefusal): FailureGateCause {
  switch (refusal) {
    case RESUME_REFUSAL.TASK_NOT_IN_REVIEW:
      return FAILURE_GATE_CAUSE.TASK_STATUS;
    case RESUME_REFUSAL.RUN_NOT_COMPLETED:
    case RESUME_REFUSAL.NO_PARTIAL_WORK:
      return FAILURE_GATE_CAUSE.RUN_STATE;
    default:
      return FAILURE_GATE_CAUSE.OTHER;
  }
}

/** Idem pour un refus du cycle, dont les codes sont distincts. */
function correctionRefusalCause(code: CorrectionRefusalCode): FailureGateCause {
  switch (code) {
    case CORRECTION_REFUSAL.TASK_NOT_IN_REVIEW:
      return FAILURE_GATE_CAUSE.TASK_STATUS;
    case CORRECTION_REFUSAL.RUN_NOT_COMPLETED:
    case CORRECTION_REFUSAL.NO_PARTIAL_WORK:
      return FAILURE_GATE_CAUSE.RUN_STATE;
    default:
      return FAILURE_GATE_CAUSE.OTHER;
  }
}

/**
 * Le libelle de la premiere precondition, quand `Failed` serait faux.
 *
 * Une tache `READY` laissee par un `Retry` avorte **tient** cette precondition.
 * Lui afficher « Task is in Failed — Blocked » etait doublement faux : sur son
 * statut, et sur son verdict.
 */
export const STRANDED_TASK_PRECONDITION_LABEL =
  "Legacy Retry left task Ready without starting a run";

/**
 * Ce que la page de reprise doit afficher, et si le bouton peut partir.
 *
 * L'ordre est celui du diagnostic : l'historique d'abord, le disque ensuite. Un
 * historique qui refuse **n'interroge pas** le runner — il n'y a rien a lui
 * demander — et les preconditions qui en dependent le disent au lieu d'afficher
 * un refus qu'elles n'ont pas constate.
 */
export async function evaluateFailureCorrection(
  db: DatabaseClient,
  input: {
    project: { id: string; repositoryPath: string };
    task: { id: string; status: string };
    runId: string;
  },
  ports: FailureCorrectionPorts = RUNNER_PORTS,
): Promise<FailureCorrectionEligibility | null> {
  const { gate, cycle } = await loadFailureHistoryGate(db, {
    taskId: input.task.id,
    runId: input.runId,
    taskStatus: input.task.status,
  });
  if (cycle === null) {
    return null;
  }

  const context = await getRunResumeContext(db, input.runId);
  if (context === null) {
    return null;
  }

  const anchored =
    context.workspaceFingerprint !== null &&
    context.gitBranch !== null &&
    context.gitHeadAfter !== null;

  // Le runner n'est interroge que lorsqu'il y a quelque chose a lui demander.
  const preflight =
    gate.ok && anchored
      ? await ports.preflight({
          repositoryPath: input.project.repositoryPath,
          expectedGitHead: context.gitHeadAfter ?? "",
          expectedBranch: context.gitBranch ?? "",
          expectedWorkspaceFingerprint: context.workspaceFingerprint ?? "",
          // Absentes pour une execution ancienne. Elles ne relachent rien : le
          // refus tiendra, il sera seulement moins bavard.
          expectedWorkspaceEntries: context.workspaceEntries,
        })
      : null;

  const preconditions = buildPreconditions({
    fromFailedRun: true,
    taskStatusLabel: gate.strandedRetry ? STRANDED_TASK_PRECONDITION_LABEL : undefined,
    // Le verdict d'historique **entier**, projete sur la ligne qui le concerne.
    // Une seule autorite, donc une seule reponse : une reprise acceptee ne peut
    // plus afficher « Blocked » sur une precondition qu'elle vient de tenir.
    taskInReview: gate.ok || gate.cause !== FAILURE_GATE_CAUSE.TASK_STATUS,
    runCompleted: gate.ok || gate.cause !== FAILURE_GATE_CAUSE.RUN_STATE,
    sessionAvailable: context.claudeSessionId !== null,
    reviewAvailable: context.hasReview,
    repositoryProbed: preflight !== null,
    workspaceMatches: preflight?.ok === true,
    gitUnchanged: preflight?.ok === true,
    claudeAvailable: preflight?.ok === true,
    // Le detail du runner nomme les chemins ayant diverge quand il le peut.
    workspaceDetail:
      preflight === null || preflight.ok
        ? null
        : describeInfrastructureFailure(preflight.failure).message,
  });

  return {
    cycle,
    history: gate,
    strandedRetry: gate.strandedRetry,
    entriesUnavailable: context.workspaceEntries === null,
    probed: preflight !== null,
    preconditions,
    ready: gate.ok && allPreconditionsMet(preconditions),
  };
}
