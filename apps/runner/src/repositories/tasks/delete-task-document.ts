/**
 * Suppression du document Markdown d'une tache.
 *
 * Route distincte de la suppression ordinaire, pour la meme raison que la
 * creation l'est : **le web n'envoie aucun chemin**. Il envoie un code de tache,
 * et c'est ce module qui compose `tasks/<code>.md`. Un chemin arbitraire n'a
 * donc aucune prise, meme falsifie — et cette route est precisement la seule
 * autorisee a toucher aux fichiers que la route generique protege.
 *
 * Trois differences avec la suppression ordinaire, toutes voulues :
 *
 * 1. **Un document absent est une reussite.** Une tache dont la synchronisation
 *    a echoue n'a jamais eu de fichier ; exiger sa presence rendrait cette tache
 *    indestructible. Le resultat vise est « plus rien a ce chemin », pas « un
 *    fichier de moins ».
 * 2. **Une revision inconnue est un refus.** Si la tache n'a pas de revision
 *    mais qu'un fichier occupe malgre tout le chemin, NOX ne peut pas prouver
 *    qu'il lui appartient. Supprimer reviendrait a deviner.
 * 3. **Le dossier `tasks/` n'est ni cree, ni supprime.** Il preexiste a la tache
 *    et lui survit.
 */

import type { Stats } from "node:fs";
import { lstat, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { RUNNER_ERROR, isTaskCode, taskDocumentPath, type RunnerErrorCode } from "@nox/shared";

import { MAX_DOCUMENT_BYTES } from "../documents/constants.ts";
import { resolveRepositoryRoot } from "../documents/repository-root.ts";
import { computeRevision, isValidRevisionFormat, revisionsMatch } from "../documents/revisions.ts";
import type { DeleteFileHooks } from "../documents/delete-document.ts";
import { inspectTasksDirectory } from "./tasks-directory.ts";

export type DeleteTaskDocumentResult =
  | { ok: true; deleted: boolean; alreadyAbsent: boolean; path: string }
  | { ok: false; code: RunnerErrorCode };

export type DeleteTaskDocumentOptions = {
  maxBytes?: number;
  deleteHooks?: DeleteFileHooks;
};

async function lstatOrNull(target: string): Promise<Stats | null> {
  try {
    return await lstat(target);
  } catch {
    return null;
  }
}

/**
 * Supprime `tasks/<taskCode>.md`, s'il existe et s'il est bien celui attendu.
 *
 * Ne supprime jamais le dossier `tasks/`, meme devenu vide.
 */
export async function deleteTaskDocument(
  repositoryPath: string,
  taskCode: string,
  expectedRevision: string | null,
  options: DeleteTaskDocumentOptions = {},
): Promise<DeleteTaskDocumentResult> {
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;
  const removeFile = options.deleteHooks?.unlink ?? unlink;

  // Le code determine le nom du fichier : le valider, c'est valider le chemin.
  // `TASK-` suivi d'au moins trois chiffres ne peut contenir ni separateur, ni
  // remontee, ni caractere non portable.
  if (!isTaskCode(taskCode)) {
    return { ok: false, code: RUNNER_ERROR.TASK_CODE_INVALID };
  }

  const relativePath = taskDocumentPath(taskCode);

  const repository = resolveRepositoryRoot(repositoryPath);
  if (!repository.ok) {
    return repository;
  }

  const directory = await inspectTasksDirectory(repository.root);
  if (!directory.ok) {
    return directory;
  }

  // Pas de dossier `tasks/`, donc pas de document : le resultat recherche est
  // deja atteint. NOX ne cree surtout pas le dossier pour le constater.
  if (!directory.present) {
    return { ok: true, deleted: false, alreadyAbsent: true, path: relativePath };
  }

  const target = path.join(directory.directory, `${taskCode}.md`);

  const stats = await lstatOrNull(target);
  if (stats === null) {
    return { ok: true, deleted: false, alreadyAbsent: true, path: relativePath };
  }

  if (stats.isSymbolicLink()) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_SYMLINK_NOT_WRITABLE };
  }

  if (!stats.isFile()) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_NOT_FILE };
  }

  // Un fichier est la, mais la tache n'a jamais ete synchronisee : il n'existe
  // aucune revision a laquelle le comparer. Ce n'est pas un conflit — il n'y a
  // rien qui differe — c'est une impossibilite de prouver l'appartenance.
  if (expectedRevision === null) {
    return { ok: false, code: RUNNER_ERROR.TASK_DOCUMENT_REVISION_UNKNOWN };
  }

  if (!isValidRevisionFormat(expectedRevision)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_REVISION_INVALID };
  }

  let currentBytes: Buffer;
  try {
    currentBytes = await readFile(target);
  } catch {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_READ_FAILED };
  }

  if (currentBytes.byteLength > maxBytes) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_TOO_LARGE };
  }

  if (!revisionsMatch(computeRevision(currentBytes), expectedRevision)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_DELETE_CONFLICT };
  }

  // Dernier controle avant la suppression, pour la meme raison et avec la meme
  // limite que dans `delete-document.ts` : la fenetre ne se ferme pas, mais
  // `unlink` ne suit aucun lien apparu entre-temps.
  const lateStats = await lstatOrNull(target);
  if (lateStats === null) {
    return { ok: true, deleted: false, alreadyAbsent: true, path: relativePath };
  }
  if (lateStats.isSymbolicLink()) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_SYMLINK_NOT_WRITABLE };
  }
  if (!lateStats.isFile()) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_NOT_FILE };
  }

  try {
    await removeFile(target);
  } catch {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_DELETE_FAILED };
  }

  if ((await lstatOrNull(target)) !== null) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_DELETE_FAILED };
  }

  return { ok: true, deleted: true, alreadyAbsent: false, path: relativePath };
}
