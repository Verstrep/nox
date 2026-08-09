/** Etat du formulaire de nouvelle demande Architecte. */
export type NewArchitectRequestState = {
  error: string | null;
  /** Texte deja saisi, reaffiche apres un refus pour ne pas le perdre. */
  text: string;
};

export const INITIAL_NEW_ARCHITECT_REQUEST_STATE: NewArchitectRequestState = {
  error: null,
  text: "",
};
