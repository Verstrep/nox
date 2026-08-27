/**
 * Etats retournes par les Server Actions de la livraison Git.
 *
 * Un fichier `"use server"` ne peut exporter que des fonctions asynchrones :
 * ces formes vivent donc a cote, comme pour les autres formulaires de NOX.
 */

export type DeliveryActionState = {
  error: string | null;
  /** Confirmation affichee apres une livraison reussie, `null` sinon. */
  notice: string | null;
};

export const INITIAL_DELIVERY_ACTION_STATE: DeliveryActionState = { error: null, notice: null };
