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

/**
 * Etat retourne par la Server Action de suppression d'une tache.
 *
 * Une reussite ne produit aucun etat : la Server Action redirige vers le
 * backlog, et la tache n'existe plus pour reafficher quoi que ce soit.
 */
export type DeleteTaskState = {
  error: string | null;
};

export const INITIAL_DELETE_TASK_STATE: DeleteTaskState = { error: null };
