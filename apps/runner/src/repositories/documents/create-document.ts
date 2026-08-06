/**
 * Creation d'un nouveau document Markdown.
 *
 * Deuxieme operation d'ecriture de NOX, et la premiere qui **ajoute** quelque
 * chose au repository. Son risque n'est pas celui de l'edition : il ne s'agit
 * pas de perdre une modification concurrente, mais de faire disparaitre un
 * fichier deja present, ou de voir apparaitre des dossiers que personne n'a
 * demandes.
 *
 * D'ou trois garanties, dans cet ordre d'importance :
 *
 * 1. **Aucun ecrasement.** La creation passe par une ouverture exclusive : le
 *    systeme cree le fichier ou echoue, sans etape intermediaire exploitable.
 * 2. **Aucun dossier cree.** Tous les parents doivent exister, etre de vrais
 *    dossiers, et ne pas etre des liens.
 * 3. **Le meme confinement que la lecture.** `normalizeDocumentPath` est
 *    reutilise tel quel : il n'existe pas de troisieme logique de validation.
 *
 * Ce module ne connait pas HTTP : il retourne un resultat, jamais une reponse.
 */

import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { RUNNER_ERROR, type ProjectDocumentContent, type RunnerErrorCode } from "@nox/shared";

import { MAX_DOCUMENT_BYTES } from "./constants.ts";
import { createNewFile, type CreateFileHooks } from "./create-new-file.ts";
import { findUnportableSegment } from "./document-names.ts";
import { isContainedIn, normalizeDocumentPath } from "./paths.ts";
import { readDocument } from "./read-document.ts";
import { resolveRepositoryRoot } from "./repository-root.ts";

export type CreateDocumentResult =
  | { ok: true; document: ProjectDocumentContent }
  | { ok: false; code: RunnerErrorCode };

export type CreateDocumentOptions = {
  maxBytes?: number;
  /** Transmis a la creation ; sert aux tests a simuler une panne disque. */
  createHooks?: CreateFileHooks;
};

/**
 * Detecte une moitie de paire de substitution isolee.
 *
 * JSON l'accepte, UTF-8 non : `Buffer.from` la remplacerait par `U+FFFD` sans
 * rien dire, et le fichier cree differerait du texte saisi.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Verifie chaque dossier parent, du plus proche de la racine au plus profond.
 *
 * NOX ne cree aucun dossier : un parent manquant est une erreur, pas une
 * invitation. Et un parent qui est un lien est refuse meme si sa cible reste
 * dans le repository — ecrire a travers un lien de dossier deposerait le fichier
 * ailleurs que la ou l'utilisateur croit le ranger.
 *
 * Retourne le chemin **reel** du dossier qui contiendra le document.
 */
async function resolveParentDirectory(
  root: string,
  relativePath: string,
): Promise<{ ok: true; directory: string } | { ok: false; code: RunnerErrorCode }> {
  const segments = relativePath.split("/");
  let current = root;

  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);

    let stats;
    try {
      stats = await lstat(current);
    } catch {
      return { ok: false, code: RUNNER_ERROR.DOCUMENT_PARENT_NOT_FOUND };
    }

    if (stats.isSymbolicLink()) {
      return { ok: false, code: RUNNER_ERROR.DOCUMENT_PARENT_SYMLINK_NOT_ALLOWED };
    }

    if (!stats.isDirectory()) {
      return { ok: false, code: RUNNER_ERROR.DOCUMENT_PARENT_NOT_DIRECTORY };
    }
  }

  // Aucun parent n'etant un lien, la resolution reelle ne devrait rien changer.
  // On la fait tout de meme : c'est elle qui fait autorite sur le confinement,
  // jamais une comparaison de chaines.
  let realDirectory: string;
  try {
    realDirectory = await realpath(current);
  } catch {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_PARENT_NOT_FOUND };
  }

  if (!isContainedIn(root, realDirectory)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_OUTSIDE_REPOSITORY };
  }

  return { ok: true, directory: realDirectory };
}

/**
 * Cree un document Markdown a un emplacement autorise.
 *
 * Ne remplace jamais un fichier existant et ne cree jamais de dossier.
 */
export async function createDocument(
  repositoryPath: string,
  documentPath: string,
  content: string,
  options: CreateDocumentOptions = {},
): Promise<CreateDocumentResult> {
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;

  // Meme validation syntaxique que la lecture : chemin relatif, sans `..`,
  // extension `.md`, emplacement reconnu par NOX.
  const normalized = normalizeDocumentPath(documentPath);
  if (!normalized.ok) {
    return normalized;
  }

  const unportable = findUnportableSegment(normalized.relativePath);
  if (unportable !== null) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_NAME_NOT_PORTABLE };
  }

  const repository = resolveRepositoryRoot(repositoryPath);
  if (!repository.ok) {
    return repository;
  }

  const parent = await resolveParentDirectory(repository.root, normalized.relativePath);
  if (!parent.ok) {
    return parent;
  }

  const fileName = normalized.relativePath.split("/").at(-1) ?? "";
  const targetPath = path.join(parent.directory, fileName);

  // Controle prealable : il ne garantit rien — un fichier peut apparaitre juste
  // apres — mais il produit un message juste dans le cas courant. La garantie
  // reelle est l'ouverture exclusive plus bas.
  try {
    await lstat(targetPath);
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_ALREADY_EXISTS };
  } catch {
    // Absent : c'est le cas attendu.
  }

  if (LONE_SURROGATE.test(content)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_CONTENT_INVALID };
  }

  const data = Buffer.from(content, "utf8");
  if (data.byteLength > maxBytes) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_TOO_LARGE };
  }

  const created = await createNewFile(targetPath, data, options.createHooks);
  if (!created.ok) {
    return created;
  }

  // Relecture reelle : metadonnees, categorie et revision viennent du disque.
  // Le document est ainsi immediatement affichable et modifiable.
  return readDocument(repositoryPath, normalized.relativePath, { maxBytes });
}
