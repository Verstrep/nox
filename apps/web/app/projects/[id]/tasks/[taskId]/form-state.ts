/**
 * Etat retourne par la Server Action de changement de statut.
 *
 * Un fichier `"use server"` ne peut exporter que des fonctions asynchrones :
 * cette forme vit donc a cote, comme pour les autres formulaires.
 */

export type TaskStatusState = {
  error: string | null;
};

export const INITIAL_TASK_STATUS_STATE: TaskStatusState = { error: null };
