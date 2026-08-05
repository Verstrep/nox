/**
 * Lecture d'un document Markdown du repository.
 *
 * La lecture elle-meme ne modifie rien : aucune ecriture, aucune creation,
 * aucune modification d'horodatage. Le contenu est renvoye brut — le runner
 * n'interprete pas le Markdown, et le web ne le rendra pas en HTML.
 *
 * Depuis TASK-005, chaque lecture renvoie aussi la **revision** du document,
 * calculee sur les octets lus. C'est elle que l'utilisateur renverra a
 * l'enregistrement, et elle seule qui permet de detecter qu'un fichier a change
 * entre-temps.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { RUNNER_ERROR, type ProjectDocumentContent, type RunnerErrorCode } from "@nox/shared";

import { categorizeDocument } from "./categories.ts";
import { MAX_DOCUMENT_BYTES } from "./constants.ts";
import { resolveDocumentPath } from "./paths.ts";
import { resolveRepositoryRoot } from "./repository-root.ts";
import { computeRevision } from "./revisions.ts";

export type ReadDocumentResult =
  | { ok: true; document: ProjectDocumentContent }
  | { ok: false; code: RunnerErrorCode };

export type ReadDocumentOptions = {
  maxBytes?: number;
};

/**
 * Decode un contenu en UTF-8 strict, sans rien retirer.
 *
 * `fatal: true` fait echouer le decodage sur une sequence invalide au lieu de la
 * remplacer silencieusement par `U+FFFD`. Un binaire renomme en `.md` produit
 * ainsi une erreur claire, plutot qu'un contenu corrompu affiche comme du texte.
 *
 * `ignoreBOM: true` a un nom trompeur : il demande de **conserver** un eventuel
 * BOM sous forme de caractere `U+FEFF` au lieu de le retirer. C'est indispensable
 * depuis que NOX sait ecrire : sans cela, ouvrir puis enregistrer un fichier
 * porteur d'un BOM le lui ferait perdre en silence, alors que l'utilisateur n'a
 * rien demande de tel. Le contenu relu redonne ainsi exactement les octets du
 * fichier.
 */
function decodeUtf8(buffer: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    return null;
  }
}

/** Lit un document autorise et retourne sa fiche accompagnee de son contenu. */
export async function readDocument(
  repositoryPath: string,
  documentPath: string,
  options: ReadDocumentOptions = {},
): Promise<ReadDocumentResult> {
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;

  const repository = resolveRepositoryRoot(repositoryPath);
  if (!repository.ok) {
    return repository;
  }

  const resolved = resolveDocumentPath(repository.root, documentPath);
  if (!resolved.ok) {
    return resolved;
  }

  let stats;
  try {
    stats = await stat(resolved.absolutePath);
  } catch {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_NOT_FOUND };
  }

  if (!stats.isFile()) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_NOT_FILE };
  }

  // La taille est verifiee AVANT la lecture : un fichier de plusieurs gigaoctets
  // ne doit jamais etre charge en memoire, meme partiellement.
  if (stats.size > maxBytes) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_TOO_LARGE };
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(resolved.absolutePath);
  } catch {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_READ_FAILED };
  }

  const content = decodeUtf8(buffer);
  if (content === null) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_NOT_UTF8 };
  }

  return {
    ok: true,
    document: {
      path: resolved.relativePath,
      name: path.posix.basename(resolved.relativePath),
      category: categorizeDocument(resolved.relativePath),
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
      content,
      // Calculee sur les octets lus, et non sur `content` : ce sont les octets
      // du disque qui font foi, et eux seuls qui seront recompares a l'ecriture.
      revision: computeRevision(buffer),
    },
  };
}
