/**
 * Ce qu'un humain a le droit de decider sur une review, et a quelles conditions.
 *
 * ## Le serveur decide, pas le formulaire
 *
 * Un bouton desactive n'est pas une regle : c'est une politesse. Toutes les
 * conditions verifiees ici le sont a partir de l'etat **relu au moment d'agir** —
 * le lot, ses resultats, le plan, les criteres humains. Un formulaire forge qui
 * pretendrait avoir coche des cases, ou qui viserait un critere inexistant, se
 * heurte aux memes controles.
 *
 * ## Ce qu'un passage en force n'est pas
 *
 * Il ne transforme jamais un echec en reussite. Le lot reste `FAILED`, les
 * commandes gardent leur code de sortie, et la review continue de les afficher.
 * Il enregistre un fait supplementaire : un humain a accepte malgre cela, et
 * voici pourquoi.
 *
 * Ce n'est pas un systeme de derogations. Une raison, persistee avec la
 * decision, suffit — et c'est tout ce qui existe.
 */

import type { DatabaseClient } from "@nox/database";
import {
  MAX_OVERRIDE_REASON_LENGTH,
  REVIEW_DECISION_SOURCE,
  TASK_VERIFICATION_OUTCOME,
  type ReviewDecisionSource,
} from "@nox/shared";

import { canApproveNormally, loadVerificationReview, requiresOverride } from "./verification-review.ts";

/** Refus possibles d'une acceptation. */
export const REVIEW_APPROVAL_ERROR = {
  /** Le lot de validation tourne encore : aucune decision n'est possible. */
  VALIDATION_RUNNING: "VALIDATION_RUNNING",
  /** Des criteres humains n'ont pas ete confirmes. */
  HUMAN_CHECKS_MISSING: "HUMAN_CHECKS_MISSING",
  /** Une confirmation designe un critere qui n'est pas humain, ou n'existe pas. */
  HUMAN_CHECK_UNKNOWN: "HUMAN_CHECK_UNKNOWN",
  /** La validation automatisee a echoue : seul un passage en force reste. */
  OVERRIDE_REQUIRED: "OVERRIDE_REQUIRED",
  /** Un passage en force sans raison. */
  OVERRIDE_REASON_REQUIRED: "OVERRIDE_REASON_REQUIRED",
  /** Un passage en force propose alors que rien n'a echoue. */
  OVERRIDE_NOT_APPLICABLE: "OVERRIDE_NOT_APPLICABLE",
} as const;

export type ReviewApprovalErrorCode =
  (typeof REVIEW_APPROVAL_ERROR)[keyof typeof REVIEW_APPROVAL_ERROR];

export type ReviewApprovalCheck =
  | {
      ok: true;
      source: ReviewDecisionSource;
      overrideReason: string | null;
      confirmations: readonly { criterionId: string | null; criterionText: string }[];
    }
  | { ok: false; code: ReviewApprovalErrorCode; message: string };

const MESSAGES: Record<ReviewApprovalErrorCode, string> = {
  [REVIEW_APPROVAL_ERROR.VALIDATION_RUNNING]:
    "La validation automatique est encore en cours. Attendez son resultat avant de decider : " +
    "accepter maintenant reviendrait a conclure sans la preuve qu'on est en train d'obtenir.",
  [REVIEW_APPROVAL_ERROR.HUMAN_CHECKS_MISSING]:
    "Cette tache porte des criteres que seul un humain peut verifier. Confirmez-les un par un " +
    "avant d'accepter : NOX ne peut pas le faire a votre place.",
  [REVIEW_APPROVAL_ERROR.HUMAN_CHECK_UNKNOWN]:
    "Une confirmation ne correspond a aucun critere humain de cette tache. Rechargez la page.",
  [REVIEW_APPROVAL_ERROR.OVERRIDE_REQUIRED]:
    "La validation automatique n'est pas passee. Une acceptation ordinaire n'est pas possible : " +
    "utilisez le passage en force et dites pourquoi, ou demandez une correction.",
  [REVIEW_APPROVAL_ERROR.OVERRIDE_REASON_REQUIRED]:
    "Un passage en force demande une raison. Elle sera conservee avec la decision, et le resultat " +
    "automatise restera affiche tel quel.",
  [REVIEW_APPROVAL_ERROR.OVERRIDE_NOT_APPLICABLE]:
    "Aucune validation automatisee n'a echoue : il n'y a rien a passer en force. Utilisez " +
    "l'acceptation ordinaire.",
};

export function reviewApprovalMessage(code: ReviewApprovalErrorCode): string {
  return MESSAGES[code];
}

/**
 * Verifie qu'une acceptation humaine est recevable, et sous quelle forme.
 *
 * L'ordre des controles suit ce qui bloque : un lot en cours interdit toute
 * decision ; ensuite seulement viennent les criteres humains, puis l'etat de la
 * validation automatisee.
 */
export async function checkReviewApproval(
  db: DatabaseClient,
  input: {
    runId: string;
    taskId: string;
    /** Identifiants des criteres humains coches dans le formulaire. */
    confirmedCriterionIds: readonly string[];
    /** Raison saisie, lorsque l'utilisateur demande un passage en force. */
    overrideReason: string | null;
    override: boolean;
  },
): Promise<ReviewApprovalCheck> {
  const review = await loadVerificationReview(db, {
    runId: input.runId,
    taskId: input.taskId,
  });

  // Rien ne se decide pendant qu'une preuve est en train d'etre obtenue.
  if (!review.batchSettled) {
    return refuse(REVIEW_APPROVAL_ERROR.VALIDATION_RUNNING);
  }

  // Les criteres humains sont relus en base : le formulaire n'en definit pas la
  // liste, il ne fait que designer des identifiants.
  const humanIds = new Set(review.humanCriteria.map((criterion) => criterion.id));
  const confirmed = new Set(input.confirmedCriterionIds);

  for (const id of confirmed) {
    if (!humanIds.has(id)) {
      return refuse(REVIEW_APPROVAL_ERROR.HUMAN_CHECK_UNKNOWN);
    }
  }
  for (const id of humanIds) {
    if (!confirmed.has(id)) {
      return refuse(REVIEW_APPROVAL_ERROR.HUMAN_CHECKS_MISSING);
    }
  }

  const confirmations = review.humanCriteria.map((criterion) => ({
    criterionId: criterion.id,
    // Le texte est recopie : editer la tache plus tard ne doit pas reecrire ce
    // qui a ete confirme a l'epoque.
    criterionText: criterion.text,
  }));

  if (input.override) {
    if (!requiresOverride(review)) {
      return refuse(REVIEW_APPROVAL_ERROR.OVERRIDE_NOT_APPLICABLE);
    }
    const reason = (input.overrideReason ?? "").trim();
    if (reason === "" || reason.length > MAX_OVERRIDE_REASON_LENGTH) {
      return refuse(REVIEW_APPROVAL_ERROR.OVERRIDE_REASON_REQUIRED);
    }
    return {
      ok: true,
      source: REVIEW_DECISION_SOURCE.HUMAN_OVERRIDE,
      overrideReason: reason,
      confirmations,
    };
  }

  if (!canApproveNormally(review)) {
    return refuse(REVIEW_APPROVAL_ERROR.OVERRIDE_REQUIRED);
  }

  return {
    ok: true,
    source: REVIEW_DECISION_SOURCE.HUMAN,
    overrideReason: null,
    confirmations,
  };
}

function refuse(code: ReviewApprovalErrorCode): ReviewApprovalCheck {
  return { ok: false, code, message: MESSAGES[code] };
}

/**
 * Une demande de correction est-elle possible ?
 *
 * Refusee pendant un lot, pour la meme raison qu'une acceptation : lancer une
 * correction pendant qu'un test tourne produirait une reprise fondee sur un
 * resultat qu'on n'a pas encore.
 */
export async function checkCorrectionAllowed(
  db: DatabaseClient,
  input: { runId: string; taskId: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const review = await loadVerificationReview(db, input);
  return review.batchSettled
    ? { ok: true }
    : { ok: false, message: MESSAGES[REVIEW_APPROVAL_ERROR.VALIDATION_RUNNING] };
}

/** Une tache dont toutes les preuves sont passees et sans critere humain. */
export function wasFullyProven(outcome: string): boolean {
  return outcome === TASK_VERIFICATION_OUTCOME.AUTO_PASSED;
}
