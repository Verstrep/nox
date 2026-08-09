/** Etat du formulaire de demande de corrections. */
export type RequestChangesState = {
  error: string | null;
  /** Texte deja saisi, reaffiche apres un refus pour ne pas le perdre. */
  text: string;
};

export const INITIAL_REQUEST_CHANGES_STATE: RequestChangesState = {
  error: null,
  text: "",
};
