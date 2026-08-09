/** Etat du formulaire de lancement d'une correction. */
export type StartCorrectionState = {
  error: string | null;
};

export const INITIAL_START_CORRECTION_STATE: StartCorrectionState = { error: null };
