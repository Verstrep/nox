/**
 * Rassemble les faits dont le workflow guide a besoin, puis derive.
 *
 * ## Ce module lit ; il ne decide pas
 *
 * Toute la logique de recommandation vit dans `deriveGuidedWorkflowState`, une
 * fonction pure de `@nox/shared`. Ici, on ne fait que constater : statut de la
 * tache, executions, instantane de review, analyses Architecte, feedback en
 * attente, disponibilite du runner. Separer les deux n'est pas une coquetterie —
 * c'est ce qui rend la decision testable sans base, sans runner et sans reseau.
 *
 * ## Ce que ce rendu ne fait jamais
 *
 * Aucun appel OpenAI, aucun lancement de Claude Code, aucune transition de
 * statut, aucun `ReviewFeedback` cree, aucune ecriture Git. Le chargement d'une
 * page de tache ne doit rien declencher : c'est une consultation.
 *
 * Deux sondes **en lecture** sont faites, et uniquement quand elles servent :
 * le preflight de lancement lorsque la tache est prete, et le preflight de
 * correction lorsqu'un feedback attend. Ce sont exactement ceux de TASK-008 et
 * TASK-012, appeles tels quels — NOX n'a pas de seconde sonde du runner, ni de
 * seconde sonde de Claude Code.
 *
 * ## Pourquoi les preconditions de correction sont verifiees ici
 *
 * Le guide pourrait se contenter de dire « une correction est demandee, allez
 * voir ». Il dirait alors la meme chose que le dossier de travail soit intact ou
 * qu'il ait change entre-temps — c'est-a-dire l'inverse de ce qu'on attend d'un
 * guide. NOX interroge donc le runner, et distingue « Correction ready » de
 * « Blocked : le dossier de travail a change ».
 *
 * Rien de tout cela n'est memorise : l'etat est recalcule a chaque rendu.
 */

import {
  findArchitectSessionForTask,
  type ArchitectTaskOrigin,
  getArchitectReviewSummary,
  getDatabaseClient,
  getRunResumeContext,
  listFeedbacksForSourceRun,
  listQueueEntries,
  listTaskDependencies,
  listTaskRunFacts,
  readProjectDeliveryPolicy,
  type ArchitectReviewSummary,
  type TaskRunFact,
} from "@nox/database";
import {
  ACTIVE_RUN_STATUSES,
  RUN_KIND,
  RUNNER_ERROR,
  RUN_STATUS,
  TASK_STATUS,
  categoryMayLeavePartialWork,
  checkResumeCandidate,
  deriveGuidedWorkflowState,
  isQueueBarrier,
  isRunKind,
  readRunFailureCategory,
  selectGuidedCurrentRun,
  summarizeTaskDependencies,
  type DevelopmentTaskDetail,
  type GuidedArchitectFact,
  type GuidedCorrectionFact,
  type GuidedCorrectionReadiness,
  type GuidedLaunchReadiness,
  type GuidedQueueFact,
  type GuidedRunFact,
  type GuidedWorkflowState,
  type TaskDependencySummary,
} from "@nox/shared";
import { connection } from "next/server";

import { loadArchitectConfig } from "./architect/config.ts";
import { feedbackExcerpt, resumeRefusalMessage } from "./correction-display.ts";
import { claudeCorrectionPreflight, claudePreflight } from "./runner/client.ts";
import { describeRunnerFailure, type RunnerFailure } from "./runner/errors.ts";

/** Ce que la page de la tache affiche en plus de l'etat derive. */
export type GuidedWorkflowView = {
  state: GuidedWorkflowState;
  /**
   * Les deux sens du graphe de dependances, derives a ce rendu.
   *
   * La page les affiche telles quelles. Rien n'est stocke : rouvrir une tache
   * terminee change ce resume au rendu suivant, sans qu'aucune ligne ne bouge.
   */
  dependencies: TaskDependencySummary;
  /** D'ou vient la tache, lorsqu'un architecte l'a proposee. */
  architectSession: ArchitectTaskOrigin | null;
  /** Extrait du feedback en attente, pour l'afficher sans le tronquer en base. */
  pendingFeedbackExcerpt: string | null;
};

/**
 * Traduit un echec de preflight en cause lisible.
 *
 * Trois causes seulement, parce que trois gestes seulement : demarrer le runner,
 * installer Claude Code, ranger le repository. Le message, lui, vient de
 * `describeRunnerFailure` — le guide ne reformule pas ce qui a deja ete formule.
 */
function toLaunchReadiness(failure: RunnerFailure): GuidedLaunchReadiness {
  const detail = describeRunnerFailure(failure);

  if (failure.kind !== "runner_error") {
    return { state: "runner_unavailable", detail };
  }
  if (failure.code === RUNNER_ERROR.CLAUDE_NOT_AVAILABLE) {
    return { state: "claude_unavailable", detail };
  }
  return { state: "repository_unavailable", detail };
}

/** Convertit une ligne d'execution en fait, avec son verdict de reprise. */
function toRunFact(
  row: TaskRunFact,
  taskStatus: string,
  hasActiveRun: boolean,
): GuidedRunFact {
  const refusal = checkResumeCandidate({
    runStatus: row.status,
    taskStatus,
    errorCode: row.errorCode,
    exitCode: row.exitCode,
    // Seule l'existence de la session compte : sa valeur ne quitte pas la base.
    claudeSessionId: row.hasSession ? "present" : null,
    hasReview: row.hasReview,
    hasFingerprint: row.hasFingerprint,
    hasActiveRun,
    hasCorrection: row.hasCorrection,
  });

  // Le guide ne rejoue aucune decision : il combine deux verdicts deja rendus.
  // `checkResumeCandidate` dit si l'etat relu est reprenable ;
  // `checkProcessFailureCorrection` dit si l'echec laisse quelque chose a
  // reprendre. Une troisieme implementation finirait par proposer un bouton que
  // la Server Action refuse.
  const failureCategory = readRunFailureCategory(row.failureCategory, {
    status: row.status,
    errorCode: row.errorCode,
    exitCode: row.exitCode,
  });
  const canCorrectFailure =
    refusal === null &&
    row.status === RUN_STATUS.FAILED &&
    categoryMayLeavePartialWork(failureCategory);

  return {
    id: row.id,
    code: row.code,
    // Une valeur inconnue est lue comme une execution initiale : c'est la
    // lecture prudente, celle qui n'invente pas une filiation.
    kind: isRunKind(row.kind) ? row.kind : RUN_KIND.INITIAL,
    status: row.status,
    hasReview: row.hasReview,
    canRequestChanges: refusal === null,
    requestChangesDetail: refusal === null ? null : resumeRefusalMessage(refusal),
    canCorrectFailure,
    hasPartialWork: row.hasPartialWork,
  };
}

function toArchitectFact(
  configured: boolean,
  summary: ArchitectReviewSummary | null,
): GuidedArchitectFact {
  if (summary === null) {
    return {
      configured,
      latestCompleted: null,
      lastAttemptFailed: false,
      active: false,
      analysesLeft: 0,
    };
  }

  const completed = summary.latestCompleted;

  return {
    configured,
    latestCompleted:
      completed === null || completed.finalVerdict === null
        ? null
        : {
            id: completed.id,
            code: completed.code,
            // Le verdict retenu par NOX, jamais celui du fournisseur : c'est
            // celui-la qui a passe la garde de TASK-015.
            verdict: completed.finalVerdict,
            blockers: completed.blockers,
            hasFeedback: completed.feedback !== null && completed.feedback.trim() !== "",
          },
    lastAttemptFailed:
      summary.latest !== null &&
      summary.latest.id !== completed?.id &&
      !summary.active,
    active: summary.active,
    analysesLeft: summary.analysesLeft,
  };
}

/**
 * Charge et derive l'etat guide d'une tache.
 *
 * Le projet est passe en entier parce que le chemin du repository ne doit jamais
 * venir d'ailleurs : il se relit en base a partir de l'identifiant du projet, et
 * ne transite par aucun formulaire.
 */
export async function loadGuidedWorkflow(input: {
  project: { id: string; repositoryPath: string };
  task: DevelopmentTaskDetail;
}): Promise<GuidedWorkflowView> {
  await connection();

  const db = getDatabaseClient();
  const task = input.task;

  const [rows, architectSession, dependencyRows] = await Promise.all([
    listTaskRunFacts(db, task.id),
    findArchitectSessionForTask(db, task.id),
    listTaskDependencies(db, task.id),
  ]);

  const dependencies = summarizeTaskDependencies(dependencyRows);

  const current = selectGuidedCurrentRun(rows);
  const hasActiveRun = rows.some((row) => ACTIVE_RUN_STATUSES.includes(row.status));
  const runs = rows.map((row) => toRunFact(row, task.status, hasActiveRun));

  const config = loadArchitectConfig(process.env);

  // Analyses de l'execution **courante**, et d'elle seule : l'analyse d'un
  // parent ne dit rien de ce que la correction a produit.
  const architectSummary =
    current === null || !current.hasReview ? null : await getArchitectReviewSummary(db, current.id);

  // La file est lue en base : deux comptages, aucune sonde. Une tache dont le
  // projet possede une file en attente n'a pas de lancement direct a preparer,
  // et sonder le runner pour elle serait un aller-retour pour rien.
  const queuedEntries = await listQueueEntries(db, input.project.id);
  // La barriere se derive comme partout ailleurs, par la meme fonction : la
  // premiere entree dont le cycle a commence, ou dont la tache a quitte
  // `READY`. Une tache rouverte en fait partie, bien qu'elle soit `READY`.
  const barrier = queuedEntries.find(isQueueBarrier) ?? null;
  const queue: GuidedQueueFact = {
    queued: queuedEntries.some((entry) => entry.taskId === task.id),
    pendingEntries: queuedEntries.length,
    isCurrent: barrier !== null && barrier.taskId === task.id,
  };

  // Une tache qui attend une autre tache n'a rien a lancer : sonder le runner y
  // serait un aller-retour pour rien, et une panne du runner y afficherait un
  // blocage sans objet. Le refus, lui, ne depend pas de cette sonde — il est
  // reverifie cote serveur au lancement.
  // La barriere courante, elle, se lance depuis cette page : la sonde sert donc,
  // et l'ecran doit dire la verite sur le repository plutot que « je ne sais
  // pas ».
  const launch =
    dependencies.allSatisfied && (queue.pendingEntries === 0 || queue.isCurrent)
      ? await probeLaunch(db, input.project.id, input.project.repositoryPath, task, hasActiveRun)
      : ({ state: "unknown" } as const);
  const correction = await probeCorrection(
    db,
    input.project.repositoryPath,
    task,
    current,
    hasActiveRun,
  );

  const state = deriveGuidedWorkflowState({
    taskStatus: task.status,
    unresolvedDependencies: dependencies.waiting,
    documentSyncStatus: task.documentSyncStatus,
    hasAcceptanceCriteria: task.acceptanceCriteria.length > 0,
    designedWithArchitect: architectSession !== null,
    runs,
    launch,
    queue,
    architect: toArchitectFact(config.ok, architectSummary),
    correction,
  });

  return {
    state,
    dependencies,
    architectSession,
    pendingFeedbackExcerpt: correction?.excerpt ?? null,
  };
}

/**
 * Interroge le runner, mais seulement quand la reponse sert.
 *
 * Une tache en brouillon, en cours ou en review n'a rien a lancer : sonder le
 * runner y serait un aller-retour pour rien, et une panne du runner y afficherait
 * un blocage sans objet.
 */
async function probeLaunch(
  db: ReturnType<typeof getDatabaseClient>,
  projectId: string,
  repositoryPath: string,
  task: DevelopmentTaskDetail,
  hasActiveRun: boolean,
): Promise<GuidedLaunchReadiness> {
  if (task.status !== TASK_STATUS.READY || hasActiveRun) {
    return { state: "unknown" };
  }

  // La politique de livraison est relue en base : la sonde doit constater
  // exactement ce que le lancement constatera, sans quoi elle annoncerait un
  // blocage la ou rien ne bloque.
  const policy = await readProjectDeliveryPolicy(db, projectId);
  const preflight = await claudePreflight(repositoryPath, policy);
  return preflight.ok ? { state: "ready" } : toLaunchReadiness(preflight.failure);
}

type PendingCorrection = GuidedCorrectionFact | null;

/**
 * Feedback en attente et etat reel de la reprise.
 *
 * Le refus de TASK-012 est evalue d'abord, en base : inutile de deranger le
 * runner pour une execution dont la session a disparu. L'empreinte attendue, elle,
 * ne quitte pas ce module : elle part vers le runner et ne remonte dans aucune
 * page.
 */
async function probeCorrection(
  db: ReturnType<typeof getDatabaseClient>,
  repositoryPath: string,
  task: DevelopmentTaskDetail,
  current: TaskRunFact | null,
  hasActiveRun: boolean,
): Promise<PendingCorrection> {
  if (task.status !== TASK_STATUS.REVIEW || current === null) {
    return null;
  }

  const feedbacks = await listFeedbacksForSourceRun(db, current.id);
  // Le plus recent des feedbacks jamais consommes : c'est celui que
  // l'utilisateur vient d'ecrire, et le seul qui puisse encore lancer une reprise.
  const pending = feedbacks.filter((entry) => entry.correctionRunId === null).at(-1);
  if (pending === undefined) {
    return null;
  }

  const base = {
    feedbackId: pending.id,
    sourceRunId: pending.sourceRunId,
    sourceRunCode: pending.sourceRunCode,
    excerpt: feedbackExcerpt(pending.text),
  };

  const context = await getRunResumeContext(db, current.id);
  if (context === null) {
    return { ...base, refusalDetail: null, readiness: { state: "unknown" } };
  }

  const refusal = checkResumeCandidate({
    runStatus: context.status,
    taskStatus: task.status,
    errorCode: context.errorCode,
    exitCode: context.exitCode,
    claudeSessionId: context.claudeSessionId,
    hasReview: context.hasReview,
    hasFingerprint: context.workspaceFingerprint !== null,
    hasActiveRun,
    hasCorrection: context.hasCorrection,
  });

  if (refusal !== null) {
    return {
      ...base,
      refusalDetail: resumeRefusalMessage(refusal),
      readiness: { state: "unknown" },
    };
  }

  const readiness = await probeWorkspace(repositoryPath, context);
  return { ...base, refusalDetail: null, readiness };
}

async function probeWorkspace(
  repositoryPath: string,
  context: {
    workspaceFingerprint: string | null;
    gitBranch: string | null;
    gitHeadAfter: string | null;
  },
): Promise<GuidedCorrectionReadiness> {
  if (
    context.workspaceFingerprint === null ||
    context.gitBranch === null ||
    context.gitHeadAfter === null
  ) {
    return { state: "unknown" };
  }

  const preflight = await claudeCorrectionPreflight({
    repositoryPath,
    expectedGitHead: context.gitHeadAfter,
    expectedBranch: context.gitBranch,
    expectedWorkspaceFingerprint: context.workspaceFingerprint,
  });

  if (preflight.ok) {
    return { state: "ready" };
  }

  // Un runner injoignable ne dit **rien** de l'etat du dossier de travail.
  // Le traiter comme un refus afficherait « le repository a change » alors que
  // personne n'a regarde : le guide dit alors qu'il ne sait pas, et renvoie vers
  // la page qui saura.
  if (preflight.failure.kind !== "runner_error") {
    return { state: "unknown" };
  }

  return { state: "blocked", detail: describeRunnerFailure(preflight.failure) };
}
