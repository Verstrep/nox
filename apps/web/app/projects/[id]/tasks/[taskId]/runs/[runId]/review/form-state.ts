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
};

export const INITIAL_REVIEW_DECISION_STATE: ReviewDecisionState = { error: null };
