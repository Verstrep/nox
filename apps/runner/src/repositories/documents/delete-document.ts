/**
 * Suppression d'un document Markdown existant.
 *
 * Troisieme operation d'ecriture de NOX, et la premiere qui **retire** quelque
 * chose. Son risque n'est ni celui de l'edition — perdre une modification
 * concurrente — ni celui de la creation — ecraser un fichier present. C'est
 * l'irreversibilite : rien de ce qui est supprime ici n'est conserve par NOX.
 * Seul Git peut le rendre, et seulement si le fichier y etait deja.
 *
 * D'ou quatre garanties, dans cet ordre d'importance :
 *
 * 1. **Le meme confinement que la lecture.** `resolveDocumentPath` est reutilise
 *    tel quel : il n'existe pas de quatrieme logique de validation de chemin.
 * 2. **Le meme controle de revision que l'edition.** Le fichier doit etre
 *    exactement celui que l'utilisateur a vu, sinon la suppression est refusee.
 * 3. **Un seul fichier, jamais un dossier.** L'appel est `unlink`, qui ne peut
 *    rien faire d'autre. Aucun `rm -rf`, aucun `rmdir`, aucun parent devenu vide
 *    n'est nettoye.
 * 4. **Aucun lien suivi.** Un document qui est un lien symbolique est refuse,
 *    comme a l'ecriture : l'utilisateur doit savoir quel fichier physique
 *    disparait.
 *
 * Ce module ne connait pas HTTP : il retourne un resultat, jamais une reponse.
 */

import { lstat, readFile, unlink } from "node:fs/promises";

import {
  RUNNER_ERROR,
  isManagedTaskDocumentPath,
  type ProjectDocumentRevision,
  type RunnerErrorCode,
} from "@nox/shared";

import { MAX_DOCUMENT_BYTES } from "./constants.ts";
import { resolveDocumentPath } from "./paths.ts";
import { resolveRepositoryRoot } from "./repository-root.ts";
import { computeRevision, isValidRevisionFormat, revisionsMatch } from "./revisions.ts";

export type DeleteDocumentResult =
  | { ok: true; path: string; revision: ProjectDocumentRevision }
  | { ok: false; code: RunnerErrorCode };

/** Remplacable dans les tests, pour simuler une panne du systeme de fichiers. */
export type DeleteFileHooks = {
  unlink?: (target: string) => Promise<void>;
};

export type DeleteDocumentOptions = {
  maxBytes?: number;
  deleteHooks?: DeleteFileHooks;
};

/**
 * Verifie que la cible est un fichier ordinaire.
 *
 * Le controle porte sur le chemin **avant** resolution des liens : `lstat` ne
 * suit pas le lien, il le decrit. Un lien pointant a l'interieur du repository
 * est refuse comme les autres — sinon « supprimer ce document » retirerait le
 * lien en laissant sa cible, ou l'inverse, sans que l'interface puisse dire
 * lequel.
 */
async function ensureRegularFile(candidatePath: string): Promise<RunnerErrorCode | null> {
  let stats;
  try {
    stats = await lstat(candidatePath);
  } catch {
    return RUNNER_ERROR.DOCUMENT_NOT_FOUND;
  }

  if (stats.isSymbolicLink()) {
    return RUNNER_ERROR.DOCUMENT_SYMLINK_NOT_WRITABLE;
  }

  if (!stats.isFile()) {
    return RUNNER_ERROR.DOCUMENT_NOT_FILE;
  }

  return null;
}

/** Valide la forme de la revision attendue, avant tout acces au disque. */
function checkRevisionFormat(expectedRevision: string): RunnerErrorCode | null {
  if (expectedRevision.trim() === "") {
    return RUNNER_ERROR.DOCUMENT_REVISION_REQUIRED;
  }
  if (!isValidRevisionFormat(expectedRevision)) {
    return RUNNER_ERROR.DOCUMENT_REVISION_INVALID;
  }
  return null;
}

/**
 * Supprime un document Markdown ordinaire.
 *
 * Refuse les documents geres par une tache : ils appartiennent a une ligne de la
 * base, et les separer laisserait une tache sans artefact sans que rien ne
 * l'enregistre. Cette protection vit **ici**, dans le runner, et pas seulement
 * dans l'interface — une interface se contourne, une route non.
 */
export async function deleteDocument(
  repositoryPath: string,
  documentPath: string,
  expectedRevision: ProjectDocumentRevision,
  options: DeleteDocumentOptions = {},
): Promise<DeleteDocumentResult> {
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;
  const removeFile = options.deleteHooks?.unlink ?? unlink;

  const revisionProblem = checkRevisionFormat(expectedRevision);
  if (revisionProblem !== null) {
    return { ok: false, code: revisionProblem };
  }

  // Meme validation syntaxique que la lecture : chemin relatif, sans `..`,
  // extension `.md`, emplacement reconnu par NOX.
  const repository = resolveRepositoryRoot(repositoryPath);
  if (!repository.ok) {
    return repository;
  }

  const resolved = resolveDocumentPath(repository.root, documentPath);
  if (!resolved.ok) {
    return resolved;
  }

  // Refus apres normalisation, et non sur la chaine recue : `tasks\TASK-001.md`
  // et `./tasks/TASK-001.md` designent le meme fichier protege.
  if (isManagedTaskDocumentPath(resolved.relativePath)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_PROTECTED };
  }

  const linkProblem = await ensureRegularFile(resolved.candidatePath);
  if (linkProblem !== null) {
    return { ok: false, code: linkProblem };
  }

  // Les octets sont relus pour recalculer la revision : c'est l'etat reel du
  // disque qui decide, jamais une valeur memorisee ailleurs. La limite de taille
  // evite de charger en memoire un fichier devenu enorme depuis l'affichage.
  let currentBytes: Buffer;
  try {
    currentBytes = await readFile(resolved.absolutePath);
  } catch {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_READ_FAILED };
  }

  if (currentBytes.byteLength > maxBytes) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_TOO_LARGE };
  }

  const revision = computeRevision(currentBytes);
  if (!revisionsMatch(revision, expectedRevision)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_DELETE_CONFLICT };
  }

  // Dernier controle, au plus pres de la suppression : entre la lecture et ce
  // point, le fichier a pu etre remplace par un dossier ou par un lien. La
  // fenetre restante ne peut pas etre fermee — Node n'expose pas de suppression
  // conditionnee a un descripteur deja ouvert. Elle est en revanche bornee :
  // `unlink` ne suit jamais un lien, il retire l'entree de dossier elle-meme.
  // Un lien apparu entre ces deux instants serait donc supprime **a la place**
  // du document, sans que sa cible soit touchee.
  const lateLinkProblem = await ensureRegularFile(resolved.candidatePath);
  if (lateLinkProblem !== null) {
    return { ok: false, code: lateLinkProblem };
  }

  try {
    await removeFile(resolved.candidatePath);
  } catch {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_DELETE_FAILED };
  }

  // Confirmation reelle : NOX n'annonce une suppression qu'apres avoir constate
  // l'absence du fichier. Une doublure de test qui ne supprime rien est donc
  // rattrapee ici, exactement comme le serait un `unlink` sans effet.
  if (!(await isAbsent(resolved.candidatePath))) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_DELETE_FAILED };
  }

  // Aucun dossier parent n'est retire, meme devenu vide : `docs/` fait partie de
  // la structure du repository, pas du document qui s'y trouvait.
  return { ok: true, path: resolved.relativePath, revision };
}

async function isAbsent(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return false;
  } catch {
    return true;
  }
}
