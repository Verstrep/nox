/**
 * Etat du formulaire de correction fondee sur les preuves de NOX.
 *
 * Meme forme que celui d'une correction avec feedback : un fichier
 * `"use server"` ne peut exporter que des fonctions asynchrones, et la forme
 * vit donc a cote.
 */
export type StartEvidenceCorrectionState = {
  error: string | null;
};

export const INITIAL_START_EVIDENCE_CORRECTION_STATE: StartEvidenceCorrectionState = {
  error: null,
};
