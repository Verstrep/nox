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
