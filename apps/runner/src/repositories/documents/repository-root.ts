/**
 * Verification du repository avant toute operation sur ses documents.
 *
 * Le chemin recu vient de la base : il a ete valide lors de la creation du
 * projet, mais rien ne garantit qu'il existe encore. Un repository deplace ou
 * supprime doit produire un message clair, pas une erreur de lecture obscure.
 */

import { realpathSync, statSync } from "node:fs";
import path from "node:path";

import { RUNNER_ERROR, type RunnerErrorCode } from "@nox/shared";

export type RepositoryRootResult = { ok: true; root: string } | { ok: false; code: RunnerErrorCode };

/** Valide le chemin d'un repository et retourne sa racine reelle. */
export function resolveRepositoryRoot(repositoryPath: string): RepositoryRootResult {
  const trimmed = repositoryPath.trim();
  if (trimmed === "") {
    return { ok: false, code: RUNNER_ERROR.REPOSITORY_PATH_REQUIRED };
  }

  if (!path.isAbsolute(trimmed)) {
    return { ok: false, code: RUNNER_ERROR.REPOSITORY_PATH_REQUIRED };
  }

  let stats;
  try {
    stats = statSync(trimmed);
  } catch {
    return { ok: false, code: RUNNER_ERROR.REPOSITORY_NOT_FOUND };
  }

  if (!stats.isDirectory()) {
    return { ok: false, code: RUNNER_ERROR.REPOSITORY_NOT_DIRECTORY };
  }

  try {
    return { ok: true, root: realpathSync.native(trimmed) };
  } catch {
    return { ok: false, code: RUNNER_ERROR.REPOSITORY_NOT_FOUND };
  }
}
