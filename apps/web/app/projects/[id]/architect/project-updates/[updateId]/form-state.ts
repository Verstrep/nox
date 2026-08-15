/**
 * Etat echange entre la revue d'une proposition et ses Server Actions.
 *
 * ## Ce que le formulaire transporte
 *
 * Les valeurs des champs, et rien d'autre. Il ne declare **pas** quelles
 * sections changent : cette information vit dans la proposition enregistree, et
 * le serveur la relit. Laisser le navigateur annoncer « le brief change »
 * reviendrait a lui confier la semantique du payload du fournisseur, qu'il n'a
 * aucune raison de connaitre — et qu'il pourrait contredire.
 *
 * Il ne transporte pas davantage l'etat courant, les revisions de base, le
 * statut de la proposition ou un budget : tout cela est relu en base, dans la
 * transaction qui ecrit.
 */

import type { BriefFormValues, V1PlanFormValues } from "../../../plan/form-state";

export type ProjectUpdateReviewValues = {
  brief: BriefFormValues;
  plan: V1PlanFormValues;
};

export type ProjectUpdateReviewState = {
  values: ProjectUpdateReviewValues;
  error: string | null;
};

export type ProjectUpdateDismissState = {
  error: string | null;
};

export const INITIAL_DISMISS_STATE: ProjectUpdateDismissState = { error: null };
