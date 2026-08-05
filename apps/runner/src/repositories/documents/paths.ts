/**
 * Confinement des chemins de documents.
 *
 * C'est la partie critique de TASK-004 : le runner recoit un chemin relatif
 * venu du navigateur et doit garantir qu'aucune lecture ne sort du repository.
 *
 * La verification se fait en deux temps, et les deux sont necessaires :
 *
 * 1. **Analyse syntaxique** du chemin recu — refus des chemins absolus, des URL
 *    et de toute remontee `..`. Ce filtre attrape l'essentiel, mais il ne voit
 *    pas les liens symboliques.
 * 2. **Verification apres resolution reelle** — les deux chemins sont passes par
 *    `realpath`, ce qui suit les liens symboliques, puis on verifie que le
 *    fichier reste sous la racine reelle. Un lien symbolique pointant a
 *    l'exterieur est donc rejete, alors qu'aucune analyse textuelle ne pourrait
 *    le detecter.
 *
 * Le confinement final n'utilise pas une comparaison de prefixe de chaine :
 * `path.relative` traite correctement les separateurs, la casse Windows et les
 * volumes differents, la ou `startsWith` se laisse tromper par un dossier voisin
 * dont le nom commence pareil (`C:\repo-public` face a `C:\repo`).
 */

import { realpathSync } from "node:fs";
import path from "node:path";

import { RUNNER_ERROR, type RunnerErrorCode } from "@nox/shared";

import {
  MARKDOWN_EXTENSION,
  ROOT_DOCUMENTS,
  SCANNED_DIRECTORIES,
} from "./constants.ts";

export type NormalizedDocumentPath = { ok: true; relativePath: string } | { ok: false; code: RunnerErrorCode };

export type ResolvedDocumentPath =
  | { ok: true; relativePath: string; absolutePath: string }
  | { ok: false; code: RunnerErrorCode };

/** Detecte un schema d'URL (`file:`, `http:`, mais aussi `C:` sous Windows). */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Convertit les separateurs Windows en `/`, forme unique du contrat. */
export function toPosixSeparators(value: string): string {
  return value.replaceAll("\\", "/");
}

function hasTraversalSegment(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => segment === "..");
}

function isMarkdown(relativePath: string): boolean {
  return relativePath.toLowerCase().endsWith(MARKDOWN_EXTENSION);
}

/**
 * Verifie que le chemin appartient aux emplacements que NOX inspecte.
 *
 * Sans ce controle, un chemin parfaitement confine mais arbitraire
 * (`src/secrets.md`) resterait lisible : le confinement empeche de sortir du
 * repository, celui-ci limite ce qui est lisible a l'interieur.
 */
function isAllowedLocation(relativePath: string): boolean {
  const lowered = relativePath.toLowerCase();

  if (ROOT_DOCUMENTS.some((document) => document.toLowerCase() === lowered)) {
    return true;
  }

  const firstSegment = lowered.split("/")[0] ?? "";
  return relativePath.includes("/") && SCANNED_DIRECTORIES.includes(firstSegment);
}

/**
 * Valide et normalise un chemin de document recu de l'exterieur.
 *
 * Ne touche pas au disque : purement syntaxique, donc testable sans fixture.
 */
export function normalizeDocumentPath(rawPath: string): NormalizedDocumentPath {
  const trimmed = rawPath.trim();
  if (trimmed === "") {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_PATH_REQUIRED };
  }

  if (trimmed.includes("\0")) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_PATH_INVALID };
  }

  // `C:\...` et `file://...` sont tous deux captes par ce test.
  if (URL_SCHEME.test(trimmed)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_PATH_INVALID };
  }

  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_PATH_INVALID };
  }

  if (path.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_PATH_INVALID };
  }

  const posix = toPosixSeparators(trimmed);
  if (hasTraversalSegment(posix)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_PATH_INVALID };
  }

  // `path.posix.normalize` retire les `.` et les `//` superflus. Les `..` ayant
  // deja ete refuses, la normalisation ne peut plus faire remonter le chemin.
  const relativePath = path.posix.normalize(posix).replace(/^\.\//, "");
  if (relativePath === "" || relativePath === ".") {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_PATH_REQUIRED };
  }

  if (!isMarkdown(relativePath)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_NOT_MARKDOWN };
  }

  if (!isAllowedLocation(relativePath)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_NOT_ALLOWED };
  }

  return { ok: true, relativePath };
}

/**
 * Verifie qu'un chemin absolu est bien contenu dans une racine.
 *
 * `path.relative` renvoie un chemin remontant (`..`) ou absolu des que la cible
 * sort de la racine — y compris sur un autre volume Windows. Sous Windows, la
 * comparaison est insensible a la casse, comme le systeme de fichiers.
 */
export function isContainedIn(root: string, candidate: string): boolean {
  if (root === candidate) {
    return true;
  }

  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

/**
 * Resout le chemin reel d'un document et verifie son confinement.
 *
 * `realpathSync.native` suit les liens symboliques et normalise la casse reelle
 * sous Windows : c'est ce qui permet de rejeter un lien pointant hors du
 * repository, qu'aucun controle syntaxique ne pourrait detecter.
 */
export function resolveDocumentPath(
  repositoryRoot: string,
  documentPath: string,
): ResolvedDocumentPath {
  const normalized = normalizeDocumentPath(documentPath);
  if (!normalized.ok) {
    return normalized;
  }

  let realRoot: string;
  try {
    realRoot = realpathSync.native(repositoryRoot);
  } catch {
    return { ok: false, code: RUNNER_ERROR.REPOSITORY_NOT_FOUND };
  }

  const candidate = path.resolve(realRoot, normalized.relativePath);

  // Controle avant meme de toucher au fichier : si la forme resolue sort deja de
  // la racine, inutile d'aller plus loin.
  if (!isContainedIn(realRoot, candidate)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_OUTSIDE_REPOSITORY };
  }

  let realDocument: string;
  try {
    realDocument = realpathSync.native(candidate);
  } catch {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_NOT_FOUND };
  }

  // Second controle, apres resolution des liens symboliques.
  if (!isContainedIn(realRoot, realDocument)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_OUTSIDE_REPOSITORY };
  }

  return { ok: true, relativePath: normalized.relativePath, absolutePath: realDocument };
}
