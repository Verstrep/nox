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
import {
  TASK_ARTIFACT_OUTCOME,
  type TaskArtifactOutcome,
  type TaskArtifactReport,
} from "./project-deletion.js";

/** Liste fermee des sorts possibles, pour valider une reponse du runner. */
const TASK_ARTIFACT_OUTCOMES: readonly TaskArtifactOutcome[] = Object.values(TASK_ARTIFACT_OUTCOME);

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

/**
 * Demande de nettoyage des documents de taches d'un projet supprime.
 *
 * ## Pourquoi une troisieme route, et pas un drapeau sur la deuxieme
 *
 * `POST /repositories/tasks/delete-document` refuse un fichier dont la revision
 * ne correspond plus : la suppression d'**une** tache est une operation
 * ordinaire, et un document modifie a la main y merite un conflit. Ajouter un
 * `force` a cette route aurait fait dependre sa garantie d'un booleen — c'est
 * exactement ce qu'il ne faut pas pour du code qui supprime des fichiers.
 *
 * La suppression d'un **projet** pose une question differente : l'utilisateur a
 * recopie le nom du projet pour confirmer le retrait de tout ce que NOX en sait.
 * Un document divergent n'y est pas un desaccord a arbitrer — c'est un artefact
 * de NOX que l'utilisateur a modifie, et qu'il demande explicitement a voir
 * disparaitre. La revision reste calculee, et la divergence reste **annoncee** :
 * ce qui change est qu'elle n'interdit plus le retrait.
 *
 * Ce que cette route ne fait pas, en revanche, ne change pas d'un iota : aucun
 * chemin ne vient de l'appelant, aucun lien n'est suivi, aucun dossier n'est
 * cree ni supprime, et un fichier dont NOX ne connait pas la revision n'est
 * jamais candidat — il n'entre meme pas dans la requete.
 */
export type ProjectTaskArtifact = {
  taskCode: string;
  /**
   * Revision enregistree en base, jamais `null`.
   *
   * C'est la preuve d'appartenance : NOX a ecrit ce fichier a ce chemin et en a
   * relu les octets. Une tache jamais synchronisee n'a pas de revision, donc
   * pas d'artefact — et le fichier qui occuperait malgre tout son chemin n'est
   * pas le sien.
   */
  expectedRevision: string;
};

export type DeleteProjectDocumentsRequest = {
  repositoryPath: string;
  artifacts: ProjectTaskArtifact[];
};

/**
 * Reponse du nettoyage.
 *
 * `ok: true` signifie que la route a traite la liste, pas que tout a ete
 * retire : chaque entree porte son propre sort, et un `REFUSED` interdit a
 * l'appelant d'affirmer que le projet a ete supprime.
 */
export type DeleteProjectDocumentsSuccess = {
  ok: true;
  documents: TaskArtifactReport[];
};

/** Valide le corps recu par `POST /repositories/tasks/delete-project-documents`. */
export function parseDeleteProjectDocumentsRequest(
  value: unknown,
): DeleteProjectDocumentsRequest | null {
  if (
    !isRecord(value) ||
    typeof value["repositoryPath"] !== "string" ||
    !Array.isArray(value["artifacts"])
  ) {
    return null;
  }

  const artifacts: ProjectTaskArtifact[] = [];
  for (const entry of value["artifacts"] as unknown[]) {
    if (
      !isRecord(entry) ||
      typeof entry["taskCode"] !== "string" ||
      typeof entry["expectedRevision"] !== "string"
    ) {
      return null;
    }
    artifacts.push({ taskCode: entry["taskCode"], expectedRevision: entry["expectedRevision"] });
  }

  return { repositoryPath: value["repositoryPath"], artifacts };
}

/** Verifie qu'une reponse JSON est un nettoyage d'artefacts reussi. */
export function isDeleteProjectDocumentsSuccess(
  value: unknown,
): value is DeleteProjectDocumentsSuccess {
  if (!isRecord(value) || value["ok"] !== true || !Array.isArray(value["documents"])) {
    return false;
  }

  return (value["documents"] as unknown[]).every(
    (entry) =>
      isRecord(entry) &&
      typeof entry["taskCode"] === "string" &&
      typeof entry["path"] === "string" &&
      (TASK_ARTIFACT_OUTCOMES as readonly string[]).includes(entry["outcome"] as string),
  );
}
