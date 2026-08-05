/**
 * Mise a jour d'un document Markdown **existant**.
 *
 * Premiere operation de NOX qui ecrit dans un repository. Elle reutilise
 * integralement le confinement de la lecture — il n'existe pas deux logiques de
 * validation de chemin — et y ajoute ce que l'ecriture seule exige :
 *
 * - un **controle de revision** : le fichier doit etre exactement celui que
 *   l'utilisateur a ouvert, sinon l'ecriture est refusee ;
 * - un **refus des liens symboliques** : NOX modifie le fichier designe, jamais
 *   un fichier atteint par un lien, meme confine ;
 * - une **ecriture sure** : le document n'est jamais laisse partiellement ecrit.
 *
 * Ce module ne connait pas HTTP : il retourne un resultat, jamais une reponse.
 */

import { lstat, readFile, stat } from "node:fs/promises";

import {
  RUNNER_ERROR,
  type ProjectDocumentContent,
  type ProjectDocumentRevision,
  type RunnerErrorCode,
} from "@nox/shared";

import { MAX_DOCUMENT_BYTES } from "./constants.ts";
import { alignLineEndings } from "./line-endings.ts";
import { resolveDocumentPath } from "./paths.ts";
import { readDocument } from "./read-document.ts";
import { resolveRepositoryRoot } from "./repository-root.ts";
import { computeRevision, isValidRevisionFormat, revisionsMatch } from "./revisions.ts";
import { writeFileSafely, type SafeWriteHooks } from "./safe-write.ts";

export type UpdateDocumentResult =
  | { ok: true; document: ProjectDocumentContent }
  | { ok: false; code: RunnerErrorCode };

export type UpdateDocumentOptions = {
  maxBytes?: number;
  /** Transmis a l'ecriture sure ; sert aux tests a simuler une panne disque. */
  writeHooks?: SafeWriteHooks;
};

/**
 * Detecte une moitie de paire de substitution isolee.
 *
 * JSON accepte ces caracteres, pas UTF-8. `Buffer.from` les remplacerait par
 * `U+FFFD` sans rien dire : le fichier ecrit differerait alors du texte soumis,
 * et sa relecture renverrait un contenu que l'utilisateur n'a pas saisi. Mieux
 * vaut refuser franchement.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Verifie que la cible n'est pas un lien symbolique.
 *
 * Le controle porte sur le chemin **avant** resolution : `absolutePath` a deja
 * suivi les liens, il ne peut donc plus en signaler aucun. Un lien pointant a
 * l'interieur du repository est refuse comme les autres : l'utilisateur doit
 * savoir quel fichier physique il modifie, et un lien rend cette reponse
 * ambigue.
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
 * Remplace le contenu d'un document existant.
 *
 * Ne cree jamais de fichier : un document absent est un refus, pas une creation
 * implicite. La creation fera l'objet d'une tache dediee.
 */
export async function updateDocument(
  repositoryPath: string,
  documentPath: string,
  content: string,
  expectedRevision: ProjectDocumentRevision,
  options: UpdateDocumentOptions = {},
): Promise<UpdateDocumentResult> {
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;

  const revisionProblem = checkRevisionFormat(expectedRevision);
  if (revisionProblem !== null) {
    return { ok: false, code: revisionProblem };
  }

  if (LONE_SURROGATE.test(content)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_CONTENT_INVALID };
  }

  const repository = resolveRepositoryRoot(repositoryPath);
  if (!repository.ok) {
    return repository;
  }

  const resolved = resolveDocumentPath(repository.root, documentPath);
  if (!resolved.ok) {
    return resolved;
  }

  const linkProblem = await ensureRegularFile(resolved.candidatePath);
  if (linkProblem !== null) {
    return { ok: false, code: linkProblem };
  }

  // Taille verifiee avant lecture : un fichier devenu enorme depuis l'ouverture
  // ne doit pas etre charge en memoire pour etre refuse ensuite.
  let stats;
  try {
    stats = await stat(resolved.absolutePath);
  } catch {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_NOT_FOUND };
  }

  if (stats.size > maxBytes) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_TOO_LARGE };
  }

  let currentBytes: Buffer;
  try {
    currentBytes = await readFile(resolved.absolutePath);
  } catch {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_READ_FAILED };
  }

  // Le coeur de la protection : la revision est recalculee sur l'etat courant du
  // disque, jamais sur celle memorisee ailleurs.
  if (!revisionsMatch(computeRevision(currentBytes), expectedRevision)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_CONFLICT };
  }

  const currentContent = new TextDecoder("utf-8", { ignoreBOM: true }).decode(currentBytes);
  const data = Buffer.from(alignLineEndings(content, currentContent), "utf8");

  // La limite porte sur les octets reellement ecrits : un texte d'un million de
  // caracteres accentues pese davantage que sa longueur en caracteres.
  if (data.byteLength > maxBytes) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_TOO_LARGE };
  }

  // Dernier controle, au plus pres de l'ecriture : entre la lecture et ce point,
  // le fichier a pu etre remplace par un lien. La fenetre restante est celle du
  // systeme de fichiers, on ne peut pas la fermer completement — mais on ecrit
  // sur le chemin **reel** resolu plus haut, qu'un lien cree entre-temps ne
  // detourne pas.
  const lateLinkProblem = await ensureRegularFile(resolved.candidatePath);
  if (lateLinkProblem !== null) {
    return { ok: false, code: lateLinkProblem };
  }

  const written = await writeFileSafely(resolved.absolutePath, data, options.writeHooks);
  if (!written.ok) {
    return written;
  }

  // Relecture reelle : les metadonnees et la nouvelle revision viennent du
  // disque, pas de ce qui vient d'etre envoye. Ce que NOX affiche apres
  // enregistrement est donc bien ce que contient le fichier.
  return readDocument(repositoryPath, documentPath, { maxBytes });
}
