/**
 * Forme de l'etat echange entre les Server Actions de la memoire et ses
 * formulaires.
 *
 * Separe de `actions.ts` comme les autres : un fichier `"use server"` ne peut
 * exporter que des fonctions asynchrones.
 *
 * Aucun chemin de repository, aucune empreinte, aucun budget calcule ne figure
 * dans ces valeurs. Le formulaire ne transporte que ce que l'utilisateur a
 * saisi ; tout le reste est derive cote serveur, a partir de l'identifiant du
 * projet relu en base.
 */

import { PROJECT_MEMORY_CATEGORY, PROJECT_MEMORY_STATUS } from "@nox/shared";

/** Valeurs brutes d'un formulaire de memoire, telles qu'elles sont saisies. */
export type MemoryFormValues = {
  category: string;
  title: string;
  content: string;
  rationale: string;
  status: string;
};

export const EMPTY_MEMORY_FORM_VALUES: MemoryFormValues = {
  // `DECISION` par defaut : c'est la categorie qui motive le plus souvent
  // l'enregistrement d'une memoire, et celle dont l'oubli coute le plus cher.
  category: PROJECT_MEMORY_CATEGORY.DECISION,
  title: "",
  content: "",
  rationale: "",
  // `ACTIVE` par defaut : une memoire qu'on prend la peine d'ecrire est une
  // memoire qu'on veut voir servir.
  status: PROJECT_MEMORY_STATUS.ACTIVE,
};

export type MemoryFormState = {
  values: MemoryFormValues;
  error: string | null;
};

export const INITIAL_MEMORY_FORM_STATE: MemoryFormState = {
  values: EMPTY_MEMORY_FORM_VALUES,
  error: null,
};

/** Etat des actions sans formulaire : archivage, restauration, suppression. */
export type MemoryActionState = {
  error: string | null;
};

export const INITIAL_MEMORY_ACTION_STATE: MemoryActionState = { error: null };
