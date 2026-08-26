/**
 * Ce qu'une review sait de la verification d'une execution.
 *
 * ## Un seul modele de lecture
 *
 * La page d'une execution, la page de review, la page d'une tache et la file
 * posent la meme question — ou en est la verification de ce travail ? — et
 * doivent recevoir la meme reponse. La deriver quatre fois la ferait diverger
 * quatre fois.
 *
 * ## Rien n'est stocke
 *
 * Le resultat par critere et l'issue de la tache se recalculent a chaque lecture
 * a partir du plan et des lignes du lot. Aucun compteur, aucun statut agrege en
 * base : ils se mettraient a mentir des la premiere reouverture d'une tache.
 *
 * ## Ce module ne lance rien
 *
 * Ni commande, ni runner, ni fournisseur. Lire une review n'a jamais declenche
 * une validation, et ce fichier est l'endroit ou cette garantie doit rester
 * evidente.
 */

import {
  getLatestValidationBatch,
  listRunsByTask,
  listValidationBatches,
  readVerificationPlan,
  type AutonomousValidationBatchRow,
  type DatabaseClient,
} from "@nox/database";
import {
  CRITERION_VERIFICATION_RESULT,
  REVIEW_DECISION_SOURCE,
  TASK_KIND,
  TASK_VERIFICATION_OUTCOME,
  VALIDATION_BATCH_STATUS,
  autonomousCommandsFor,
  checkVerificationPlan,
  deriveCriterionResults,
  deriveTaskVerificationOutcome,
  REVIEW_WAIT,
  humanCriteriaOf,
  isBatchFinal,
  planRequiresHuman,
  selectGuidedCurrentRun,
  type AutonomousCommandOutcome,
  type CriterionVerificationView,
  type ReviewDecisionSource,
  type ReviewWait,
  type TaskKind,
  type TaskVerificationOutcome,
  type VerificationPlan,
  type VerificationPlanCriterion,
} from "@nox/shared";

/** Comment une review a ete conclue, telle qu'elle est relue. */
export type ReviewDecisionView = {
  source: ReviewDecisionSource;
  overrideReason: string | null;
  decidedAt: Date;
  confirmedCriteria: readonly string[];
};

/** Tout ce qu'une surface a besoin de savoir sur la verification d'une execution. */
export type VerificationReview = {
  plan: VerificationPlan;
  planValid: boolean;
  /** Le lot courant, ou `null` quand aucun n'a jamais eu lieu. */
  batch: AutonomousValidationBatchRow | null;
  /** Tentatives precedentes, de la plus recente a la plus ancienne. */
  previousBatches: readonly AutonomousValidationBatchRow[];
  /**
   * Aucune validation autonome n'etait configuree pour cette execution.
   *
   * Distinct d'un lot absent pour une autre raison : une tache entierement
   * humaine, ou une execution anterieure a TASK-027, n'a rien rate.
   */
  noAutomatedValidation: boolean;
  criteria: readonly CriterionVerificationView[];
  humanCriteria: readonly VerificationPlanCriterion[];
  outcome: TaskVerificationOutcome;
  /** Le lot est termine : aucune decision de review n'est possible avant. */
  batchSettled: boolean;
  /** Une reprise de la validation est proposee — panne d'infrastructure seule. */
  retryAvailable: boolean;
  /** Une validation autonome a modifie des fichiers suivis. */
  trackedFilesMutated: boolean;
  decision: ReviewDecisionView | null;
};

function toOutcomes(batch: AutonomousValidationBatchRow | null): AutonomousCommandOutcome[] {
  if (batch === null) {
    return [];
  }
  return batch.results
    .filter((result) => result.commandId !== null)
    .map((result) => ({ commandId: result.commandId as string, status: result.status }));
}

/**
 * Assemble la verification d'une execution.
 *
 * `taskKind` sert a une seule chose : ne jamais annoncer une eligibilite a
 * l'auto-completion pour un amorcage, qui n'en aura jamais.
 */
export async function loadVerificationReview(
  db: DatabaseClient,
  input: { runId: string; taskId: string },
): Promise<VerificationReview> {
  const [plan, batch, batches, decisionRow] = await Promise.all([
    readVerificationPlan(db, input.taskId),
    getLatestValidationBatch(db, input.runId),
    listValidationBatches(db, input.runId),
    db.runReviewDecision.findUnique({
      where: { runId: input.runId },
      include: { confirmations: { orderBy: { createdAt: "asc" } } },
    }),
  ]);

  const planValid = checkVerificationPlan(plan).ok;
  const outcomes = toOutcomes(batch);
  const criteria = deriveCriterionResults(plan, outcomes);
  const outcome = deriveTaskVerificationOutcome(criteria);

  const expected = autonomousCommandsFor(plan);
  const noAutomatedValidation = expected.length === 0;

  // Deux empreintes connues et differentes disent que la preuve a modifie le
  // travail. Deux empreintes inconnues ne disent rien — et « ne pas savoir »
  // n'autorise jamais une completion automatique.
  const trackedFilesMutated =
    batch === null
      ? false
      : batch.trackedStateBefore === null ||
        batch.trackedStateAfter === null ||
        batch.trackedStateBefore !== batch.trackedStateAfter;

  return {
    plan,
    planValid,
    batch,
    previousBatches: batches.filter((entry) => entry.id !== batch?.id),
    noAutomatedValidation,
    criteria,
    humanCriteria: humanCriteriaOf(plan),
    outcome,
    // Aucun lot n'est un etat conclu : il n'y a rien a attendre.
    batchSettled: batch === null ? true : isBatchFinal(batch.status),
    // Seule une panne d'infrastructure se retente. Une commande qui a echoue
    // pour de vrai ne changera pas d'avis : le code n'a pas bouge.
    retryAvailable: batch !== null && batch.status === VALIDATION_BATCH_STATUS.ERROR,
    trackedFilesMutated,
    decision:
      decisionRow === null
        ? null
        : {
            source: toDecisionSource(decisionRow.source),
            overrideReason: decisionRow.overrideReason,
            decidedAt: decisionRow.decidedAt,
            confirmedCriteria: decisionRow.confirmations.map((row) => row.criterionText),
          },
  };
}

function toDecisionSource(value: string): ReviewDecisionSource {
  // Une valeur illisible devient `HUMAN` : c'est celle qui ne pretend rien de
  // plus qu'un humain a conclu, et qui ne peut pas faire croire a une preuve.
  return value === REVIEW_DECISION_SOURCE.AUTOMATED ||
    value === REVIEW_DECISION_SOURCE.HUMAN_OVERRIDE
    ? value
    : REVIEW_DECISION_SOURCE.HUMAN;
}

/**
 * Une acceptation ordinaire est-elle possible ?
 *
 * Elle exige que toutes les preuves automatisees soient passees. Sinon, seul un
 * passage en force explicite reste, et il porte une raison.
 */
export function canApproveNormally(review: VerificationReview): boolean {
  if (!review.batchSettled) {
    return false;
  }
  return (
    review.outcome === TASK_VERIFICATION_OUTCOME.AUTO_PASSED ||
    review.outcome === TASK_VERIFICATION_OUTCOME.HUMAN_REQUIRED
  );
}

/** Une acceptation exige-t-elle un passage en force motive ? */
export function requiresOverride(review: VerificationReview): boolean {
  return (
    review.batchSettled &&
    (review.outcome === TASK_VERIFICATION_OUTCOME.AUTO_FAILED ||
      review.outcome === TASK_VERIFICATION_OUTCOME.AUTO_ERROR)
  );
}

/**
 * Cette tache pourrait-elle se terminer seule, d'apres son seul contrat ?
 *
 * Annonce avant l'execution, sur la page de la tache : c'est ce qui rend
 * l'acceptation du contrat eclairee au moment du `Mark ready`.
 */
export function planIsFullyAutomated(plan: VerificationPlan, kind: TaskKind): boolean {
  return (
    kind !== TASK_KIND.BOOTSTRAP &&
    plan.criteria.length > 0 &&
    !planRequiresHuman(plan) &&
    checkVerificationPlan(plan).ok
  );
}

/** Nombre de criteres humains encore a confirmer. */
export function pendingHumanCheckCount(review: VerificationReview): number {
  return review.decision === null ? review.humanCriteria.length : 0;
}

/** Un critere a-t-il ete prouve ? Sert aux pastilles de la review. */
export function isCriterionProven(view: CriterionVerificationView): boolean {
  return view.result === CRITERION_VERIFICATION_RESULT.PASSED;
}

/**
 * Ce que la review attend, en une valeur fermee.
 *
 * L'ordre des tests suit ce qui bloque : un lot en cours interdit toute
 * decision, un echec impose un choix, une panne se relance, et une attente
 * humaine se satisfait en regardant. Les intervertir ferait annoncer « il vous
 * reste deux cases a cocher » a quelqu'un qui ne peut rien cocher.
 */
export function describeReviewWait(review: VerificationReview): ReviewWait {
  const humanCheckCount = pendingHumanCheckCount(review);

  if (!review.batchSettled) {
    return { kind: REVIEW_WAIT.VALIDATION_RUNNING, humanCheckCount };
  }
  if (review.outcome === TASK_VERIFICATION_OUTCOME.AUTO_FAILED) {
    return { kind: REVIEW_WAIT.VALIDATION_FAILED, humanCheckCount };
  }
  if (review.outcome === TASK_VERIFICATION_OUTCOME.AUTO_ERROR) {
    return { kind: REVIEW_WAIT.VALIDATION_ERROR, humanCheckCount };
  }
  if (humanCheckCount > 0) {
    return { kind: REVIEW_WAIT.HUMAN_CHECKS, humanCheckCount };
  }
  return { kind: REVIEW_WAIT.REVIEW, humanCheckCount };
}

/**
 * Ce que la review de la tache courante attend, relu en base.
 *
 * Lecture seule : ni runner, ni fournisseur, ni commande — ouvrir la file ne
 * declenche aucune validation. L'execution regardee est celle de
 * `selectGuidedCurrentRun` — la seule active, sinon la plus recente — et pas une
 * seconde selection qui finirait par designer une autre execution.
 */
export async function loadReviewWait(
  db: DatabaseClient,
  taskId: string,
): Promise<ReviewWait | null> {
  const runs = await listRunsByTask(db, taskId);
  const run = selectGuidedCurrentRun(runs);
  if (run === null) {
    return null;
  }
  return describeReviewWait(await loadVerificationReview(db, { runId: run.id, taskId }));
}
