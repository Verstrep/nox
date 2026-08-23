/**
 * Etat retourne par les Server Actions de la file d'execution.
 *
 * Un fichier `"use server"` ne peut exporter que des fonctions asynchrones :
 * cette forme vit donc a cote, comme pour les autres formulaires.
 */

export type QueueActionState = {
  error: string | null;
  /** Ce que l'action a produit, affiche apres coup. `null` quand rien a dire. */
  notice: string | null;
};

export const INITIAL_QUEUE_ACTION_STATE: QueueActionState = { error: null, notice: null };
