/**
 * Etat retourne par la Server Action de lancement.
 *
 * Un fichier `"use server"` ne peut exporter que des fonctions asynchrones :
 * cette forme vit donc a cote, comme pour les autres formulaires.
 */

export type StartRunState = {
  error: string | null;
};

export const INITIAL_START_RUN_STATE: StartRunState = { error: null };
