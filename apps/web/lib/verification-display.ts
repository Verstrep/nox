/**
 * Ce que l'ecran dit de la verification d'une execution.
 *
 * ## Ce module ne decide de rien
 *
 * Il traduit : des libelles, des tons, des durees. Aucune regle metier n'y vit —
 * ce qui autorise une acceptation, ce qui declenche un lot et ce qui compte
 * comme une preuve appartiennent au serveur, et les redire ici les ferait
 * diverger le jour ou l'un des deux changerait.
 *
 * ## Le sort d'une sortie absente est toujours dit
 *
 * `Truncated`, `Not captured`, `Timed out` : jamais un vide muet. Une preuve
 * dont on ne sait pas ce qu'elle a produit doit se voir comme telle, sinon
 * l'ecran laisse croire qu'il n'y avait rien a montrer.
 *
 * Pur et sans dependance : ni base, ni React, ni reseau.
 */

import {
  AUTONOMOUS_VALIDATION_STATUS,
  CRITERION_VERIFICATION_RESULT,
  REVIEW_DECISION_SOURCE,
  TASK_VERIFICATION_OUTCOME,
  VALIDATION_BATCH_STATUS,
  VERIFICATION_MODE,
  type AutonomousValidationStatus,
  type CriterionVerificationResult,
  type ReviewDecisionSource,
  type TaskVerificationOutcome,
  type ValidationBatchStatus,
  type VerificationMode,
} from "@nox/shared";

/** Tons disponibles pour les pastilles de statut. */
export type VerificationTone = "accent" | "muted" | "warn" | "danger";

/** Libelle d'une commande executee par NOX. */
export function autonomousStatusLabel(status: AutonomousValidationStatus): string {
  switch (status) {
    case AUTONOMOUS_VALIDATION_STATUS.PASSED:
      return "Passed";
    case AUTONOMOUS_VALIDATION_STATUS.FAILED:
      return "Failed";
    case AUTONOMOUS_VALIDATION_STATUS.TIMED_OUT:
      return "Timed out";
    default:
      return "Error";
  }
}

export function autonomousStatusTone(status: AutonomousValidationStatus): VerificationTone {
  switch (status) {
    case AUTONOMOUS_VALIDATION_STATUS.PASSED:
      return "accent";
    case AUTONOMOUS_VALIDATION_STATUS.ERROR:
      return "warn";
    default:
      return "danger";
  }
}

/** Libelle d'un lot de validations. */
export function batchStatusLabel(status: ValidationBatchStatus): string {
  switch (status) {
    case VALIDATION_BATCH_STATUS.PENDING:
      return "Queued";
    case VALIDATION_BATCH_STATUS.RUNNING:
      return "Running";
    case VALIDATION_BATCH_STATUS.PASSED:
      return "Passed";
    case VALIDATION_BATCH_STATUS.FAILED:
      return "Failed";
    default:
      return "Infrastructure error";
  }
}

export function batchStatusTone(status: ValidationBatchStatus): VerificationTone {
  switch (status) {
    case VALIDATION_BATCH_STATUS.PASSED:
      return "accent";
    case VALIDATION_BATCH_STATUS.FAILED:
      return "danger";
    case VALIDATION_BATCH_STATUS.ERROR:
      return "warn";
    default:
      return "muted";
  }
}

/** Libelle du resultat d'un critere. */
export function criterionResultLabel(result: CriterionVerificationResult): string {
  switch (result) {
    case CRITERION_VERIFICATION_RESULT.PASSED:
      return "Proven";
    case CRITERION_VERIFICATION_RESULT.FAILED:
      return "Failed";
    case CRITERION_VERIFICATION_RESULT.HUMAN:
      return "Human check";
    default:
      return "Not verified";
  }
}

export function criterionResultTone(result: CriterionVerificationResult): VerificationTone {
  switch (result) {
    case CRITERION_VERIFICATION_RESULT.PASSED:
      return "accent";
    case CRITERION_VERIFICATION_RESULT.FAILED:
      return "danger";
    case CRITERION_VERIFICATION_RESULT.NOT_VERIFIED:
      return "warn";
    default:
      return "muted";
  }
}

/**
 * Pastille d'un critere.
 *
 * Trois signes, trois etats, et jamais le meme pour deux choses differentes :
 * une preuve obtenue, une preuve manquee, et une question laissee a un humain.
 */
export function criterionMark(result: CriterionVerificationResult): string {
  switch (result) {
    case CRITERION_VERIFICATION_RESULT.PASSED:
      return "✓";
    case CRITERION_VERIFICATION_RESULT.FAILED:
      return "✕";
    default:
      return "○";
  }
}

/** Libelle d'un mode de verification. */
export function verificationModeLabel(mode: VerificationMode): string {
  return mode === VERIFICATION_MODE.AUTOMATED ? "Automated" : "Human";
}

/** Ce que l'issue d'une tache dit, en une phrase. */
export function verificationOutcomeMessage(outcome: TaskVerificationOutcome): string {
  switch (outcome) {
    case TASK_VERIFICATION_OUTCOME.AUTO_PASSED:
      return "Toutes les preuves automatisees sont passees, et aucun critere ne demande un humain.";
    case TASK_VERIFICATION_OUTCOME.AUTO_FAILED:
      return "Au moins une preuve automatisee a echoue. Une acceptation ordinaire n'est pas possible.";
    case TASK_VERIFICATION_OUTCOME.AUTO_ERROR:
      return "Au moins une preuve n'a pas pu etre obtenue. « Je n'ai pas pu regarder » n'est pas « j'ai regarde et c'est faux ».";
    default:
      return "Au moins un critere demande une verification humaine.";
  }
}

/** Comment une decision de review a ete prise. */
export function decisionSourceLabel(source: ReviewDecisionSource): string {
  switch (source) {
    case REVIEW_DECISION_SOURCE.AUTOMATED:
      return "Automatique";
    case REVIEW_DECISION_SOURCE.HUMAN_OVERRIDE:
      return "Humaine, malgre la validation";
    default:
      return "Humaine";
  }
}

/** Duree d'une commande, en secondes lisibles. */
export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return "duree inconnue";
  }
  if (durationMs < 1_000) {
    return `${String(durationMs)} ms`;
  }
  return `${(durationMs / 1_000).toFixed(1)} s`;
}

/** Code de sortie, ou son absence, dite en toutes lettres. */
export function formatExitCode(exitCode: number | null): string {
  return exitCode === null ? "aucun code de sortie" : `exit ${String(exitCode)}`;
}

/**
 * Ce qu'on affiche a la place d'un flux vide.
 *
 * `null` et `""` ne disent pas la meme chose : le premier veut dire que rien n'a
 * ete capture, le second que la commande n'a rien ecrit.
 */
export function outputPlaceholder(value: string | null): string | null {
  if (value === null) {
    return "Aucune sortie capturee.";
  }
  return value === "" ? "La commande n'a rien ecrit sur ce flux." : null;
}

/** Message de troncature, lorsqu'elle a eu lieu. */
export function truncationNotice(truncated: boolean, limit: number): string | null {
  return truncated
    ? `Sortie tronquee a ${String(limit)} caracteres. La commande a continue de tourner : seule sa trace est bornee.`
    : null;
}

/** Ce que l'ecran dit quand aucune validation autonome n'etait configuree. */
export const NO_AUTONOMOUS_VALIDATION_MESSAGE =
  "No autonomous validation was configured for this run.";

/** Le meme fait, pour une execution anterieure a la validation autonome. */
export const HISTORICAL_RUN_MESSAGE =
  "No autonomous validation was configured for this historical run.";

/** Ce que l'ecran dit quand une validation a modifie des fichiers suivis. */
export const TRACKED_FILES_MUTATED_MESSAGE =
  "Une validation autonome a modifie des fichiers suivis par Git. NOX ne peut donc plus affirmer " +
  "que ce qui a ete verifie est ce que Claude Code avait laisse : la completion automatique est " +
  "refusee, et la decision revient a un humain.";

/** Ce que l'ecran dit a cote du bouton de reprise. */
export const RETRY_VALIDATION_NOTICE =
  "Relancer ne rappelle ni Claude Code, ni l'Architecte : NOX rejoue les memes commandes, " +
  "enregistre une nouvelle tentative, et conserve la precedente.";
