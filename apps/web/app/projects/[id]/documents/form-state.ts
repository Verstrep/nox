/**
 * Forme de l'etat echange entre la Server Action d'edition et le formulaire.
 *
 * Separe de `actions.ts` comme pour la creation de projet : un fichier
 * `"use server"` ne peut exporter que des fonctions asynchrones.
 */

export type EditDocumentValues = {
  /** Chemin relatif du document edite. */
  documentPath: string;
  /** Texte saisi, conserve tel quel en cas d'erreur. */
  content: string;
  /** Revision du document au moment de son ouverture. */
  expectedRevision: string;
};

export type EditDocumentState = {
  values: EditDocumentValues;
  error: string | null;
  /**
   * Vrai lorsque l'echec est un conflit de revision.
   *
   * L'interface s'en sert pour proposer de recharger la version actuelle plutot
   * que de simplement inviter a reessayer, ce qui echouerait a l'identique.
   */
  conflict: boolean;
};

/** Etat initial d'un formulaire ouvert sur un document donne. */
export function initialEditDocumentState(
  documentPath: string,
  content: string,
  expectedRevision: string,
): EditDocumentState {
  return {
    values: { documentPath, content, expectedRevision },
    error: null,
    conflict: false,
  };
}

/**
 * Etat retourne par la Server Action de suppression.
 *
 * Aucune valeur n'y est conservee, contrairement a l'edition : il n'y a pas de
 * texte a ne pas perdre. Seuls le message et la nature du refus comptent.
 */
export type DeleteDocumentState = {
  error: string | null;
  /** Vrai lorsque le fichier a change depuis son affichage. */
  conflict: boolean;
};

export const INITIAL_DELETE_DOCUMENT_STATE: DeleteDocumentState = {
  error: null,
  conflict: false,
};
