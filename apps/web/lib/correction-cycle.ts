/**
 * Ce que NOX sait du cycle de correction d'une execution.
 *
 * ## Un seul modele de lecture
 *
 * La review, la page d'une tache, la file et le declencheur automatique posent
 * la meme question — cette execution peut-elle etre corrigee, et par qui ? — et
 * doivent recevoir la meme reponse. La deriver quatre fois la ferait diverger
 * quatre fois, et c'est celle du declencheur qui aurait raison a tort.
 *
 * ## Ce module ne lance rien
 *
 * Il lit la base et derive. Aucun appel a Claude Code, aucun appel a OpenAI,
 * aucun appel au runner, aucune ecriture Git. Le lancement vit dans
 * `correction-launch.ts`, et il refait lui-meme tous ces controles juste avant
 * d'agir : un modele de lecture n'autorise rien dans NOX.
 *
 * ## Le cycle courant, et pourquoi ce n'est pas `runCount`
 *
 * Une tache peut avoir eu une histoire avant celle-ci : un lancement, une
 * review, une reouverture, un second lancement. Compter toutes ses executions
 * melangerait ces vies successives, et la borne de deux corrections
 * automatiques refuserait une correction legitime — ou en autoriserait une de
 * trop. Le cycle courant est la suite d'executions reliees par `parentRunId`
 * jusqu'a l'execution initiale dont elles descendent.
 */

import {
  getProjectById,
  getRunById,
  getTaskById,
  isLatestRunForTask,
  listCorrectionAttempts,
  readCorrectionChain,
  type CorrectionAttemptRow,
  type DatabaseClient,
} from "@nox/database";
import {
  CORRECTION_SOURCE,
  RUN_STATUS,
  attemptHoldsPlace,
  checkAutomaticCorrection,
  checkHumanCorrection,
  checkProcessFailureCorrection,
  deriveCorrectionCycle,
  isStrandedRetry,
  readRunFailureCategory,
  selectGuidedCurrentRun,
  type AutomaticCorrectionDecision,
  type CorrectionAttemptFacts,
  type CorrectionCycleState,
  type DevelopmentRunDetail,
  type RunFailureCategory,
  type DevelopmentTaskDetail,
} from "@nox/shared";

import { readQueue } from "./queue.ts";
import { loadVerificationReview, type VerificationReview } from "./verification-review.ts";

/** Tout ce qu'une surface a besoin de savoir du cycle d'une execution. */
export type CorrectionContext = {
  task: DevelopmentTaskDetail;
  run: DevelopmentRunDetail;
  review: VerificationReview;
  /** Executions du cycle courant, de la plus ancienne a la plus recente. */
  chain: readonly string[];
  /** Reservations du cycle courant, dans l'ordre de leur prise. */
  attempts: readonly CorrectionAttemptRow[];
  /** Corrections automatiques deja engagees dans ce cycle. */
  automatedAttempts: number;
  /** La tache est la barriere courante d'une file. */
  queueCurrent: boolean;
  /** La file du projet porte une autorisation permanente. */
  queueActive: boolean;
  /** Une reservation occupe deja cette execution source. */
  held: CorrectionAttemptRow | null;
  automatic: AutomaticCorrectionDecision;
  human: AutomaticCorrectionDecision;
  /**
   * Une correction peut-elle repartir de l'echec de cette execution ?
   *
   * Distincte de `human` : celle-ci part d'une review qui demande des
   * changements, celle-la d'un processus qui s'est arrete tout seul. Les deux
   * ne peuvent jamais etre eligibles en meme temps — la premiere exige
   * `REVIEW`, la seconde `FAILED`.
   */
  processFailure: AutomaticCorrectionDecision;
  /** Ce qui a cede : valeur enregistree, ou derivee pour une execution ancienne. */
  failureCategory: RunFailureCategory;
  /**
   * La tache est `READY` uniquement parce qu'un `Retry` n'a jamais demarre.
   *
   * Sert a **expliquer** la reprise sur une surface ou l'utilisateur lit
   * « Prete » : sans cette phrase, un bouton de reprise devant une tache prete
   * ressemble a une incoherence de NOX.
   */
  strandedRetry: boolean;
  cycle: CorrectionCycleState;
};

function toFacts(row: CorrectionAttemptRow): CorrectionAttemptFacts {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    automatedAttempt: row.automatedAttempt ?? 0,
    correctionRunId: row.correctionRunId,
  };
}

/**
 * Assemble le cycle de correction d'une execution.
 *
 * `queueCurrent` est vrai lorsque la tache est **la** barriere courante de la
 * file, pas seulement inscrite : l'autorisation permanente ouverte par `Start
 * queue` porte sur le travail en cours, jamais sur une entree qui attend encore
 * son tour.
 */
export async function loadCorrectionContext(
  db: DatabaseClient,
  input: { runId: string; taskId: string },
): Promise<CorrectionContext | null> {
  const run = await getRunById(db, input.runId);
  if (run === null || run.taskId !== input.taskId) {
    return null;
  }
  const task = await getTaskById(db, input.taskId);
  if (task === null) {
    return null;
  }

  const [review, chain, allAttempts, isLatestRun] = await Promise.all([
    loadVerificationReview(db, input),
    readCorrectionChain(db, input.runId),
    listCorrectionAttempts(db, input.taskId),
    // Ce que le statut de la tache ne dit pas : un `Retry` qui n'a jamais
    // demarre laisse `READY` derriere lui sans produire d'execution.
    isLatestRunForTask(db, input.taskId, input.runId),
  ]);

  const inChain = new Set(chain);
  const attempts = allAttempts.filter((attempt) => inChain.has(attempt.sourceRunId));
  const automatedAttempts = attempts.filter(
    (attempt) =>
      attempt.source === CORRECTION_SOURCE.AUTOMATED_VALIDATION &&
      attemptHoldsPlace(attempt.status),
  ).length;

  const held =
    attempts.find(
      (attempt) => attempt.sourceRunId === input.runId && attemptHoldsPlace(attempt.status),
    ) ?? null;

  const queue = await readQueue(db, task.projectId, "unknown");
  const queueCurrent = queue.current !== null && queue.current.taskId === task.id;

  const shared = {
    taskKind: task.kind,
    taskStatus: task.status,
    runStatus: run.status,
    decided: review.decision !== null,
    planValid: review.planValid,
    batchStatus: review.batch?.status ?? null,
    outcome: review.outcome,
    attemptReserved: held !== null,
    repositoryMutated: review.repositoryMutationObserved,
  };

  const automatic = checkAutomaticCorrection({
    ...shared,
    queueCurrent,
    queueActive: queue.active,
    automatedAttempts,
  });
  const human = checkHumanCorrection(shared);

  // La categorie est **relue** quand la base la porte, et derivee sinon. Une
  // execution d'avant HOTFIX-006 se lit donc exactement comme une execution
  // recente, sans qu'aucune ligne historique n'ait ete reecrite.
  const failureCategory = readRunFailureCategory(run.failureCategory, {
    status: run.status,
    errorCode: run.errorCode,
    exitCode: run.claude.exitCode,
  });
  // Une correction deja nee de cette execution interdit la reconnaissance du
  // `Retry` avorte : la tache serait alors passee par une reprise, et son
  // `READY` ne viendrait plus de la.
  const hasCorrection = attempts.some(
    (attempt) => attempt.sourceRunId === input.runId && attempt.correctionRunId !== null,
  );
  const processFailure = checkProcessFailureCorrection({
    ...shared,
    failureCategory,
    isLatestRun,
    hasCorrection,
  });
  const strandedRetry = isStrandedRetry({
    runStatus: run.status,
    taskStatus: task.status,
    isLatestRun,
    hasCorrection,
  });

  // Une execution du cycle qui tourne encore : la correction en cours, ou la
  // reprise que quelqu'un vient de lancer depuis un autre onglet.
  const running = run.status === RUN_STATUS.RUNNING || run.status === RUN_STATUS.QUEUED;

  return {
    task,
    run,
    review,
    chain,
    attempts,
    automatedAttempts,
    queueCurrent,
    queueActive: queue.active,
    held,
    automatic,
    human,
    processFailure,
    failureCategory,
    strandedRetry,
    cycle: deriveCorrectionCycle({
      attempts: attempts.map(toFacts),
      running,
      // Les deux portes menent au meme geste — reprendre la session sur le
      // travail deja produit — et l'ecran doit annoncer « une correction est
      // possible » dans les deux cas. Elles ne peuvent pas etre vraies
      // ensemble : l'une exige `REVIEW`, l'autre `FAILED`.
      correctionAvailable: human.eligible || processFailure.eligible,
      automatic,
    }),
  };
}

/**
 * Le cycle de la tache, vu depuis son execution courante.
 *
 * L'execution regardee est celle de `selectGuidedCurrentRun` — la seule active,
 * sinon la plus recente. Une seule implementation de cette selection existe
 * dans NOX, et c'est celle-la : une seconde finirait par designer une autre
 * execution que l'ecran d'a cote.
 */
export async function loadTaskCorrectionCycle(
  db: DatabaseClient,
  taskId: string,
): Promise<CorrectionContext | null> {
  const { listRunsByTask } = await import("@nox/database");
  const runs = await listRunsByTask(db, taskId);
  const run = selectGuidedCurrentRun(runs);
  if (run === null) {
    return null;
  }
  return loadCorrectionContext(db, { runId: run.id, taskId });
}

/** Le projet d'un contexte, relu en base. Jamais recu d'un formulaire. */
export function loadCorrectionProject(db: DatabaseClient, context: CorrectionContext) {
  return getProjectById(db, context.task.projectId);
}
