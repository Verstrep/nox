/**
 * Construction du contexte de correction, a partir de ce que NOX possede deja.
 *
 * ## Pourquoi ce module existe
 *
 * Parce que l'utilisateur n'a plus rien a recopier. Le critere qui a echoue, la
 * commande qui devait le prouver, son code de sortie et ses sorties sont en
 * base depuis TASK-027 ; les relire ici coute une requete, et evite a quelqu'un
 * de lire des logs pour en extraire ce que NOX a deja extrait.
 *
 * ## Ce qui entre, et ce qui n'entre pas
 *
 * Entrent : le contrat gele, les criteres automatises en echec, leurs commandes
 * et leurs sorties bornees, la mutation du repository lorsqu'elle a eu lieu, le
 * texte humain lorsqu'il y en a un, et — depuis HOTFIX-006 — le diagnostic de
 * terminaison quand c'est le processus lui-meme qui a cede : sa categorie, la
 * phrase que NOX a ecrite, son code de sortie, la queue de sa sortie d'erreur,
 * et ses dernieres actions reconnues. N'entrent pas : le compte rendu de Claude
 * Code, le diff, le transcript, un chemin absolu, une variable d'environnement,
 * un secret. Ce ne sont pas des filtres — aucun de ces elements n'atteint ce
 * module.
 *
 * ## Le budget
 *
 * Borne par commande, puis borne globalement. Une sortie de test enorme ne doit
 * jamais evincer le contrat de la tache : c'est lui qu'il faut satisfaire, et
 * une correction qui l'aurait perdu de vue corrigerait a l'aveugle.
 */

import type { AutonomousValidationBatchRow, DatabaseClient } from "@nox/database";
import {
  CORRECTION_EVIDENCE_LIMITS,
  CORRECTION_SOURCE,
  CRITERION_VERIFICATION_RESULT,
  MAX_AUTOMATED_CORRECTION_ATTEMPTS,
  renderCorrectionEvidence,
  renderFrozenContract,
  type CorrectionCommandEvidence,
  type CorrectionCriterionEvidence,
  type CorrectionEvidence,
  type CorrectionSource,
  type DevelopmentTaskDetail,
  type ProcessFailureEvidence,
  type VerificationPlanCriterion,
} from "@nox/shared";

import type { VerificationReview } from "./verification-review.ts";

/** Le contexte d'une correction, pret a partir dans un prompt. */
export type CorrectionContextText = {
  /** Contrat gele, rendu. */
  contract: string;
  /** Preuves d'echec, rendues et bornees. Vide lorsqu'il n'y en a aucune. */
  evidence: string;
  /** Le budget a coupe quelque chose, et le texte le dit. */
  truncated: boolean;
  /** Criteres automatises en echec, pour l'affichage de la review. */
  failedCriteria: readonly CorrectionCriterionEvidence[];
};

function commandsFor(
  criterion: VerificationPlanCriterion,
  batch: AutonomousValidationBatchRow | null,
): CorrectionCommandEvidence[] {
  if (batch === null) {
    return [];
  }
  const wanted = new Set(criterion.commandIds);
  return batch.results
    .filter((result) => result.commandId !== null && wanted.has(result.commandId))
    .map((result) => ({
      command: result.command,
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stdoutTruncated: result.stdoutTruncated,
      stderr: result.stderr,
      stderrTruncated: result.stderrTruncated,
    }));
}

/**
 * Les criteres automatises que le lot n'a pas prouves.
 *
 * `FAILED` **et** `NOT_VERIFIED` : le premier dit « la commande a tourne et a
 * echoue », le second « NOX n'a pas pu regarder ». Les deux justifient qu'on
 * decrive la situation ; seul le premier justifie une correction automatique,
 * et cette decision-la se prend ailleurs.
 */
export function failedCriteriaOf(
  review: VerificationReview,
): CorrectionCriterionEvidence[] {
  return review.criteria
    .filter(
      (entry) =>
        entry.result === CRITERION_VERIFICATION_RESULT.FAILED ||
        entry.result === CRITERION_VERIFICATION_RESULT.NOT_VERIFIED,
    )
    .map((entry) => ({
      text: entry.criterion.text,
      verificationMode: entry.criterion.verificationMode,
      commands: commandsFor(entry.criterion, review.batch),
    }));
}

/**
 * Construit le contexte textuel d'une correction.
 *
 * `humanCriterionIds` designe des criteres relus en base par l'appelant : ce
 * module ne fait que les mettre en forme. Un identifiant forge n'arrive jamais
 * jusqu'ici, parce qu'il est refuse avant.
 */
export function buildCorrectionContext(input: {
  task: DevelopmentTaskDetail;
  review: VerificationReview;
  source: CorrectionSource;
  automatedAttempt: number;
  humanCriterionIds: readonly string[];
  humanFeedback: string | null;
  /**
   * Ce que NOX a observe de la terminaison, pour une reprise apres echec.
   *
   * Deja assemble par l'appelant, qui seul a lu les evenements en base. Ce
   * module met en forme ; il ne va rien chercher.
   */
  processFailure?: ProcessFailureEvidence | null;
}): CorrectionContextText {
  const failedCriteria = failedCriteriaOf(input.review);

  const wanted = new Set(input.humanCriterionIds);
  const humanCriteria = input.review.humanCriteria
    .filter((criterion) => wanted.has(criterion.id))
    .map((criterion) => ({ text: criterion.text, instructions: criterion.humanInstructions }));

  const evidence: CorrectionEvidence = {
    source: input.source,
    automatedAttempt: input.automatedAttempt,
    maxAutomatedAttempts: MAX_AUTOMATED_CORRECTION_ATTEMPTS,
    failedCriteria,
    humanCriteria,
    // La mutation **constatee**, jamais l'ignorance : demander a Claude Code de
    // reparer ce que NOX n'a pas su regarder n'aurait aucun sens.
    repositoryMutated: input.review.repositoryMutationObserved,
    mutatedFiles: input.review.batch?.mutatedFiles ?? [],
    humanFeedback: input.humanFeedback,
    processFailure: input.processFailure ?? null,
  };

  const contract = renderFrozenContract(
    input.review.plan.criteria.map((criterion) => ({
      text: criterion.text,
      verificationMode: criterion.verificationMode,
    })),
    input.task.validationCommands,
  );

  const rendered = renderCorrectionEvidence(evidence);
  const bounded = boundEvidence(rendered);

  return {
    contract,
    evidence: bounded.text,
    truncated: bounded.truncated,
    failedCriteria,
  };
}

/**
 * Borne la section de preuves, et **annonce** la coupe.
 *
 * La fin est conservee plutot que le debut pour chaque flux — c'est la que les
 * outils de test ecrivent leur resume. Ici, en revanche, c'est le debut qui est
 * conserve : les premiers criteres sont ceux du contrat, et perdre le dernier
 * bloc coute moins que perdre le premier.
 */
function boundEvidence(text: string): { text: string; truncated: boolean } {
  if (text.length <= CORRECTION_EVIDENCE_LIMITS.total) {
    return { text, truncated: false };
  }
  const notice =
    "\n\n[...] contexte de correction tronqué par NOX : les preuves suivantes n'ont pas tenu " +
    "dans le budget. Le contrat de la tâche ci-dessus reste entier.";
  return {
    text: `${text.slice(0, CORRECTION_EVIDENCE_LIMITS.total - notice.length)}${notice}`,
    truncated: true,
  };
}

/**
 * Le contexte d'une correction automatique, relu entierement en base.
 *
 * Aucun argument ne vient du navigateur : ni commande, ni chemin, ni sortie, ni
 * numero de tentative. L'appelant fournit des identifiants, et rien d'autre.
 */
export async function buildAutomaticCorrectionContext(
  _db: DatabaseClient,
  input: {
    task: DevelopmentTaskDetail;
    review: VerificationReview;
    automatedAttempt: number;
  },
): Promise<CorrectionContextText> {
  return buildCorrectionContext({
    task: input.task,
    review: input.review,
    source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
    automatedAttempt: input.automatedAttempt,
    // Une correction automatique ne signale aucun critere humain : NOX n'en a
    // aucune preuve, et pretendre le contraire serait exactement l'erreur que
    // TASK-027 existe pour empecher.
    humanCriterionIds: [],
    humanFeedback: null,
  });
}
