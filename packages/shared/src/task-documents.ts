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

/**
 * Demande de suppression du document d'une tache.
 *
 * Meme principe que la creation : **aucun chemin n'est transmis**. Le runner
 * compose `tasks/<code>.md` a partir du code, apres en avoir verifie la forme.
 *
 * `expectedRevision` peut valoir `null`, et ce cas est le plus interessant : une
 * tache jamais synchronisee n'a pas de revision. Le runner ne le traite pas
 * comme une autorisation de supprimer sans verifier — il le traite comme
 * l'absence attendue du fichier. Si un document occupe malgre tout le chemin,
 * la suppression est refusee, faute de pouvoir prouver qu'il appartient a NOX.
 */
export type DeleteTaskDocumentRequest = {
  repositoryPath: string;
  taskCode: string;
  expectedRevision: string | null;
};

/**
 * Reponse d'une suppression de document de tache.
 *
 * `deleted: false` avec `alreadyAbsent: true` est une **reussite** : le resultat
 * recherche — plus de fichier a ce chemin — est atteint. C'est ce qui permet de
 * supprimer une tache dont la synchronisation avait echoue avant meme que son
 * document n'existe.
 */
export type DeleteTaskDocumentSuccess = {
  ok: true;
  deleted: boolean;
  alreadyAbsent: boolean;
  /** Chemin relatif derive du code, renvoye pour l'affichage. */
  path: string;
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

/**
 * Valide le corps recu par `POST /repositories/tasks/delete-document`.
 *
 * `expectedRevision` accepte `null` mais **pas** l'absence du champ : une
 * requete qui l'omet est un desaccord de contrat, alors qu'un `null` explicite
 * est une information — « cette tache n'a jamais ete synchronisee ». Les
 * confondre ferait passer un appelant negligent pour un appelant informe.
 */
export function parseDeleteTaskDocumentRequest(value: unknown): DeleteTaskDocumentRequest | null {
  if (
    !isRecord(value) ||
    typeof value["repositoryPath"] !== "string" ||
    typeof value["taskCode"] !== "string" ||
    !("expectedRevision" in value)
  ) {
    return null;
  }

  const revision: unknown = value["expectedRevision"];
  if (revision !== null && typeof revision !== "string") {
    return null;
  }

  return {
    repositoryPath: value["repositoryPath"],
    taskCode: value["taskCode"],
    expectedRevision: revision,
  };
}

/** Verifie qu'une reponse JSON est une creation de document de tache reussie. */
export function isCreateTaskDocumentSuccess(value: unknown): value is CreateTaskDocumentSuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }
  return isProjectDocumentContent(value["document"]);
}

/** Verifie qu'une reponse JSON est une suppression de document de tache reussie. */
export function isDeleteTaskDocumentSuccess(value: unknown): value is DeleteTaskDocumentSuccess {
  return (
    isRecord(value) &&
    value["ok"] === true &&
    typeof value["deleted"] === "boolean" &&
    typeof value["alreadyAbsent"] === "boolean" &&
    typeof value["path"] === "string"
  );
}
