/**
 * Contrat de `POST /repositories/tasks/create-document`.
 *
 * Cette route est volontairement distincte de la creation d'un document
 * ordinaire, malgre une parente evidente. Deux differences la justifient :
 *
 * 1. **Le web n'envoie pas de chemin.** Il envoie un code de tache ; c'est le
 *    runner qui en deduit `tasks/<code>.md`. Un chemin arbitraire n'a donc
 *    aucune prise sur cette route, meme falsifie.
 * 2. **Elle peut creer un dossier**, et un seul : `tasks/` a la racine du
 *    repository. La creation ordinaire, elle, n'en cree jamais aucun.
 *
 * Melanger les deux aurait donne une route dont les garanties dependent d'un
 * drapeau — exactement ce qu'il ne faut pas pour du code qui ecrit sur disque.
 */

import { isProjectDocumentContent, type ProjectDocumentContent } from "./documents.js";

/**
 * Demande de creation du document d'une tache.
 *
 * `taskCode` remplace le chemin : sa forme est verifiee par le runner, qui
 * refuse tout ce qui ne ressemble pas a `TASK-` suivi d'au moins trois
 * chiffres. Le contrat ne verifie ici que les types — le format a son propre
 * code d'erreur, plus parlant qu'un rejet global de la requete.
 */
export type CreateTaskDocumentRequest = {
  repositoryPath: string;
  taskCode: string;
  content: string;
};

/** Meme forme qu'une lecture : le document cree est immediatement exploitable. */
export type CreateTaskDocumentSuccess = {
  ok: true;
  document: ProjectDocumentContent;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Valide le corps recu par `POST /repositories/tasks/create-document`. */
export function parseCreateTaskDocumentRequest(value: unknown): CreateTaskDocumentRequest | null {
  if (
    !isRecord(value) ||
    typeof value["repositoryPath"] !== "string" ||
    typeof value["taskCode"] !== "string" ||
    typeof value["content"] !== "string"
  ) {
    return null;
  }
  return {
    repositoryPath: value["repositoryPath"],
    taskCode: value["taskCode"],
    content: value["content"],
  };
}

/** Verifie qu'une reponse JSON est une creation de document de tache reussie. */
export function isCreateTaskDocumentSuccess(value: unknown): value is CreateTaskDocumentSuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }
  return isProjectDocumentContent(value["document"]);
}
