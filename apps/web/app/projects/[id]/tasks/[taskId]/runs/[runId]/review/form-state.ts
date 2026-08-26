/**
 * Etat retourne par la Server Action de decision de review.
 *
 * Un fichier `"use server"` ne peut exporter que des fonctions asynchrones :
 * cette forme vit donc a cote, comme pour les autres formulaires.
 *
 * `decided` porte la decision reellement enregistree, et non un simple booleen
 * de reussite : le message de confirmation n'est pas le meme selon qu'on vient
 * d'accepter le travail ou de le renvoyer en file.
 */

export type ReviewDecisionState = {
  error: string | null;
  decided?: "approve" | "reopen";
  /**
   * L'acceptation exige un passage en force motive.
   *
   * Permet au formulaire de proposer la raison **apres** un refus, sans que le
   * navigateur ait eu a deviner l'etat de la validation.
   */
  overrideRequired?: boolean;
};

export const INITIAL_REVIEW_DECISION_STATE: ReviewDecisionState = { error: null };

/**
 * Etat retourne par la reprise d'un lot de validations.
 *
 * Elle ne rend aucune donnee : soit la tentative est ouverte et la page se
 * recharge avec, soit un refus est explique. Un « succes » silencieux
 * laisserait croire qu'un resultat est arrive alors que le lot vient a peine de
 * demarrer.
 */
export type RetryValidationState = {
  error: string | null;
};

export const INITIAL_RETRY_VALIDATION_STATE: RetryValidationState = { error: null };

/**
 * Etat retourne par la reprise d'une correction restee en plan.
 *
 * Elle ne rend rien non plus : soit la correction demarre et la page suivante
 * l'affiche, soit un refus nomme dit ce qui a change depuis la reservation.
 */
export type ResumeCorrectionState = {
  error: string | null;
};

export const INITIAL_RESUME_CORRECTION_STATE: ResumeCorrectionState = { error: null };
