/**
 * Forme de l'etat echange entre la Server Action de creation et son formulaire.
 *
 * Separe de `actions.ts` comme les autres : un fichier `"use server"` ne peut
 * exporter que des fonctions asynchrones.
 *
 * Aucun chemin de repository ne figure dans les valeurs : le formulaire ne
 * connait que l'identifiant du projet, et la Server Action relit le repository
 * en base.
 */

import { EMPTY_TASK_FORM_VALUES, type TaskFormValues } from "@/lib/task-input";

export type CreateTaskState = {
  values: TaskFormValues;
  error: string | null;
};

export const INITIAL_CREATE_TASK_STATE: CreateTaskState = {
  values: EMPTY_TASK_FORM_VALUES,
  error: null,
};
