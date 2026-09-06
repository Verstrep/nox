/**
 * Etat du formulaire de reprise d'une execution qui a echoue.
 *
 * Meme forme que ses deux voisines : un fichier `"use server"` ne peut exporter
 * que des fonctions asynchrones, et la forme vit donc a cote.
 */
export type StartFailureCorrectionState = {
  error: string | null;
};

export const INITIAL_START_FAILURE_CORRECTION_STATE: StartFailureCorrectionState = {
  error: null,
};
