/**
 * Forme de l'etat echange entre la Server Action de creation et le formulaire.
 *
 * Ce module est volontairement separe de `actions.ts` : un fichier `"use server"`
 * ne peut exporter que des fonctions asynchrones.
 */

export type CreateProjectValues = {
  name: string;
  description: string;
  repositoryPath: string;
};

export type CreateProjectErrors = {
  name: string | null;
  description: string | null;
  repositoryPath: string | null;
  /** Erreur non rattachee a un champ (base indisponible, echec inattendu). */
  form: string | null;
};

export type CreateProjectState = {
  values: CreateProjectValues;
  errors: CreateProjectErrors;
};

export const NO_ERRORS: CreateProjectErrors = {
  name: null,
  description: null,
  repositoryPath: null,
  form: null,
};

export const INITIAL_CREATE_PROJECT_STATE: CreateProjectState = {
  values: { name: "", description: "", repositoryPath: "" },
  errors: NO_ERRORS,
};
