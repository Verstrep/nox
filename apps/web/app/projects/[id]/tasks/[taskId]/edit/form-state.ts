import type { TaskEditFormValues } from "@/lib/task-edit";

/**
 * Etat du formulaire d'edition.
 *
 * `values` est renvoye tel quel a chaque refus : un cycle refuse ne doit pas
 * faire perdre l'objectif qu'on venait de reecrire. `revision` accompagne les
 * valeurs pour que la tentative suivante reste comparee au meme etat de depart.
 */
export type EditTaskState = {
  values: TaskEditFormValues | null;
  error: string | null;
};

export const INITIAL_EDIT_TASK_STATE: EditTaskState = { values: null, error: null };
