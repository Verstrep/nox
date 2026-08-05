/**
 * Inventaire des documents Markdown d'un repository.
 *
 * Le parcours est volontairement etroit : trois fichiers a la racine, puis les
 * dossiers `docs/`, `decisions/`, `plans/` et `tasks/`. Parcourir tout le
 * repository serait lent, imprevisible, et remplirait la liste de Markdown
 * appartenant a des dependances.
 *
 * Aucun contenu n'est lu : seules les metadonnees du systeme de fichiers sont
 * consultees. Aucune ecriture n'est effectuee.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { RUNNER_ERROR, type ProjectDocumentSummary, type RunnerErrorCode } from "@nox/shared";

import { categorizeDocument, compareDocuments } from "./categories.ts";
import {
  EXCLUDED_DIRECTORY_NAMES,
  MARKDOWN_EXTENSION,
  MAX_DOCUMENTS,
  MAX_SCAN_DEPTH,
  ROOT_DOCUMENTS,
  SCANNED_DIRECTORIES,
} from "./constants.ts";
import { toPosixSeparators } from "./paths.ts";
import { resolveRepositoryRoot } from "./repository-root.ts";

export type ListDocumentsResult =
  | { ok: true; documents: ProjectDocumentSummary[] }
  | { ok: false; code: RunnerErrorCode };

export type ListDocumentsOptions = {
  maxDocuments?: number;
  maxDepth?: number;
};

/** Signale que la limite de documents a ete atteinte pendant le parcours. */
class DocumentLimitReached extends Error {}

function isMarkdownFileName(name: string): boolean {
  return name.toLowerCase().endsWith(MARKDOWN_EXTENSION);
}

async function describeDocument(
  root: string,
  absolutePath: string,
): Promise<ProjectDocumentSummary | null> {
  let stats;
  try {
    stats = await stat(absolutePath);
  } catch {
    // Fichier disparu entre la lecture du dossier et le `stat` : on l'ignore
    // plutot que de faire echouer tout l'inventaire.
    return null;
  }

  if (!stats.isFile()) {
    return null;
  }

  const relativePath = toPosixSeparators(path.relative(root, absolutePath));

  return {
    path: relativePath,
    name: path.basename(relativePath),
    category: categorizeDocument(relativePath),
    size: stats.size,
    updatedAt: stats.mtime.toISOString(),
  };
}

/**
 * Parcourt un dossier en profondeur limitee.
 *
 * `withFileTypes` evite un `stat` par entree, et surtout permet de reconnaitre
 * les liens symboliques : ils ne sont **jamais** suivis pendant la decouverte,
 * ce qui empeche de sortir du repository ou de boucler indefiniment.
 */
async function collectFromDirectory(
  root: string,
  directory: string,
  depth: number,
  maxDepth: number,
  maxDocuments: number,
  collected: ProjectDocumentSummary[],
): Promise<void> {
  if (depth > maxDepth) {
    return;
  }

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    // Dossier absent ou illisible : ce n'est pas une erreur d'inventaire.
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
        continue;
      }
      await collectFromDirectory(root, absolutePath, depth + 1, maxDepth, maxDocuments, collected);
      continue;
    }

    if (!entry.isFile() || !isMarkdownFileName(entry.name)) {
      continue;
    }

    const document = await describeDocument(root, absolutePath);
    if (document === null) {
      continue;
    }

    collected.push(document);
    if (collected.length > maxDocuments) {
      throw new DocumentLimitReached();
    }
  }
}

/** Inventorie les documents Markdown reconnus d'un repository. */
export async function listDocuments(
  repositoryPath: string,
  options: ListDocumentsOptions = {},
): Promise<ListDocumentsResult> {
  const maxDocuments = options.maxDocuments ?? MAX_DOCUMENTS;
  const maxDepth = options.maxDepth ?? MAX_SCAN_DEPTH;

  const repository = resolveRepositoryRoot(repositoryPath);
  if (!repository.ok) {
    return repository;
  }

  const { root } = repository;
  const collected: ProjectDocumentSummary[] = [];

  try {
    for (const fileName of ROOT_DOCUMENTS) {
      const document = await describeDocument(root, path.join(root, fileName));
      if (document !== null) {
        collected.push(document);
      }
    }

    for (const directoryName of SCANNED_DIRECTORIES) {
      await collectFromDirectory(
        root,
        path.join(root, directoryName),
        1,
        maxDepth,
        maxDocuments,
        collected,
      );
    }
  } catch (error) {
    if (error instanceof DocumentLimitReached) {
      return { ok: false, code: RUNNER_ERROR.TOO_MANY_DOCUMENTS };
    }
    throw error;
  }

  collected.sort(compareDocuments);
  return { ok: true, documents: collected };
}
