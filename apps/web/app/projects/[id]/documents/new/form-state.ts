/**
 * Forme de l'etat echange entre la Server Action de creation et son formulaire.
 *
 * Separe de `actions.ts` comme les autres : un fichier `"use server"` ne peut
 * exporter que des fonctions asynchrones.
 *
 * Aucun chemin complet ne figure dans les valeurs : le formulaire ne connait
 * qu'une destination et un nom relatif. Le chemin final est recompose cote
 * serveur a chaque soumission.
 */

import { PROJECT_DOCUMENT_CATEGORY } from "@nox/shared";

export type CreateDocumentValues = {
  /** Identifiant de destination, parmi `DOCUMENT_DESTINATIONS`. */
  destination: string;
  /** Nom relatif saisi, ou nom de document racine choisi. */
  name: string;
  content: string;
};

export type CreateDocumentState = {
  values: CreateDocumentValues;
  error: string | null;
  /**
   * Chemin du document qui occupe deja l'emplacement demande.
   *
   * Renseigne uniquement lorsque la creation est refusee pour cette raison :
   * l'interface propose alors d'ouvrir ce document plutot que d'inviter a
   * reessayer, ce qui echouerait a l'identique.
   */
  existingPath: string | null;
};

export const INITIAL_CREATE_DOCUMENT_STATE: CreateDocumentState = {
  values: {
    // La documentation est la destination la plus courante ; elle evite un choix
    // obligatoire avant de commencer a ecrire.
    destination: PROJECT_DOCUMENT_CATEGORY.DOCUMENTATION,
    name: "",
    content: "",
  },
  error: null,
  existingPath: null,
};
