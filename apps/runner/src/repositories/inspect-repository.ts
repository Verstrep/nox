/**
 * Inspection grossiere d'un repository.
 *
 * ## Ce que cette route lit, et ce qu'elle ne lit pas
 *
 * Elle lit **des noms d'entrees**, a la racine et pour quelques chemins connus.
 * Aucun contenu de fichier n'est ouvert, aucune commande n'est lancee, rien
 * n'est ecrit. Un `.env` present ne fuit donc pas : il n'appartient a aucune
 * liste reconnue, et de toute facon personne ne l'ouvre ici.
 *
 * ## Elle constate, elle ne conclut pas
 *
 * Le runner rend des faits — quels manifestes reconnus existent, quels dossiers
 * de code existent, combien d'entrees a la racine. La conclusion « ce
 * repository porte deja une application » est calculee cote web, ou elle est
 * pure et testable. Le runner execute ; il ne decide pas.
 *
 * ## Le parcours est etroit par construction
 *
 * Une seule lecture de la racine, puis un `stat` par chemin connu. Parcourir le
 * repository en profondeur serait lent, imprevisible sur un `node_modules`, et
 * n'apporterait rien a la question posee.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  FOUNDATIONAL_DOCUMENTS,
  REPOSITORY_INSPECTION_MAX_ENTRIES,
  REPOSITORY_MANIFEST_FILES,
  REPOSITORY_SOURCE_DIRECTORIES,
  type RepositoryInspection,
  type RunnerErrorCode,
} from "@nox/shared";

import { readGitChanges } from "./git-state.ts";
import { resolveRepositoryRoot } from "./documents/repository-root.ts";

export type InspectRepositoryResult =
  | { ok: true; inspection: RepositoryInspection }
  | { ok: false; code: RunnerErrorCode };

/**
 * Ce chemin designe-t-il un fichier ordinaire ?
 *
 * `lstat` plutot que `stat` : un lien symbolique n'est **pas** suivi. Un lien
 * nomme `package.json` pointant hors du repository ne doit pas se faire passer
 * pour un manifeste local.
 */
async function isRegularFile(absolutePath: string): Promise<boolean> {
  try {
    const stats = await stat(absolutePath, { bigint: false });
    return stats.isFile();
  } catch {
    return false;
  }
}

async function existingFiles(root: string, candidates: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const relativePath of candidates) {
    if (await isRegularFile(path.join(root, ...relativePath.split("/")))) {
      found.push(relativePath);
    }
  }
  return found;
}

/**
 * Entrees de la racine, hors `.git`, et les dossiers de code reconnus.
 *
 * Les liens symboliques sont comptes comme entrees mais ne peuvent jamais etre
 * reconnus comme dossiers de code : la question « y a-t-il du code ici » ne se
 * repond pas en suivant un lien qui peut sortir du repository.
 */
async function readRoot(root: string): Promise<{
  sourceDirectories: string[];
  rootEntryCount: number;
  rootEntryCountTruncated: boolean;
}> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { sourceDirectories: [], rootEntryCount: 0, rootEntryCountTruncated: false };
  }

  const directories = new Set<string>();
  let count = 0;

  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }
    count += 1;
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      directories.add(entry.name);
    }
  }

  const truncated = count > REPOSITORY_INSPECTION_MAX_ENTRIES;

  return {
    sourceDirectories: REPOSITORY_SOURCE_DIRECTORIES.filter((name) => directories.has(name)),
    rootEntryCount: truncated ? REPOSITORY_INSPECTION_MAX_ENTRIES : count,
    rootEntryCountTruncated: truncated,
  };
}

/** Inventorie grossierement ce que contient un repository. */
export async function inspectRepository(
  repositoryPath: string,
): Promise<InspectRepositoryResult> {
  const repository = resolveRepositoryRoot(repositoryPath);
  if (!repository.ok) {
    return repository;
  }

  const { root } = repository;

  // `readGitChanges` plutot que `readGitState` : un repository sans commit est
  // le cas normal d'un projet neuf, et c'est justement celui qu'on amorce. La
  // lecture stricte le traiterait comme une erreur.
  const [rootScan, manifests, foundationalDocuments, git] = await Promise.all([
    readRoot(root),
    existingFiles(root, REPOSITORY_MANIFEST_FILES),
    existingFiles(root, FOUNDATIONAL_DOCUMENTS),
    readGitChanges(root),
  ]);

  return {
    ok: true,
    inspection: {
      manifests,
      sourceDirectories: rootScan.sourceDirectories,
      foundationalDocuments,
      hasCommits: git.head !== null,
      rootEntryCount: rootScan.rootEntryCount,
      rootEntryCountTruncated: rootScan.rootEntryCountTruncated,
    },
  };
}
