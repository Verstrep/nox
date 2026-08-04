/**
 * Resolution de la racine d'un repository Git local.
 *
 * Cette logique appartenait a `apps/web` pendant TASK-002. Elle vit desormais
 * dans le runner, qui devient l'unique composant autorise a toucher au systeme
 * de fichiers et a lancer des processus.
 *
 * Regles de securite :
 * - `execFile` sans shell : la valeur recue est un argument, jamais une commande ;
 * - aucune commande Git modifiant le repository ;
 * - aucun fichier du repository n'est lu ;
 * - la commande est bornee par un delai maximal.
 *
 * Ce module ne connait pas HTTP : il est testable directement.
 */

import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";

import { RUNNER_ERROR, type RunnerErrorCode } from "@nox/shared";

/** Delai maximal accorde a la commande Git, en millisecondes. */
export const GIT_TIMEOUT_MS = 5_000;

export type ResolveRepositoryResult =
  | { ok: true; canonicalPath: string }
  | { ok: false; code: RunnerErrorCode };

/** Resultat brut d'un appel a Git, sans interpretation metier. */
export type GitOutcome =
  | { status: "ok"; stdout: string }
  | { status: "unavailable" }
  | { status: "timeout" }
  | { status: "failed" };

/** Signature d'un lanceur Git, injectable pour les tests. */
export type GitRunner = (directory: string, timeoutMs: number) => Promise<GitOutcome>;

/**
 * Execute `git -C <directory> rev-parse --show-toplevel`.
 *
 * Commande strictement en lecture : elle ne cree rien, ne modifie rien, et
 * n'ouvre aucun fichier du repository.
 */
export const runGitToplevel: GitRunner = (directory, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["-C", directory, "rev-parse", "--show-toplevel"],
      { timeout: timeoutMs, windowsHide: true, encoding: "utf8" },
      (error, stdout) => {
        if (error === null) {
          resolve({ status: "ok", stdout });
          return;
        }

        const { code, killed } = error as NodeJS.ErrnoException & { killed?: boolean };
        if (code === "ENOENT") {
          resolve({ status: "unavailable" });
        } else if (killed === true || code === "ETIMEDOUT") {
          resolve({ status: "timeout" });
        } else {
          resolve({ status: "failed" });
        }
      },
    );
  });

/**
 * Normalise un chemin absolu en respectant la casse reelle du systeme de
 * fichiers. Indispensable sous Windows, ou `d:\projets` et `D:\Projets`
 * designent le meme dossier : sans cette normalisation, l'application web
 * pourrait enregistrer deux fois le meme repository.
 */
function toCanonicalPath(rawPath: string): string {
  try {
    return path.resolve(realpathSync.native(rawPath));
  } catch {
    // Chemin non resolvable par le systeme : on garde la forme normalisee.
    return path.resolve(rawPath);
  }
}

/**
 * Valide un chemin et retourne la racine canonique du repository Git
 * correspondant.
 *
 * Un sous-dossier est accepte : c'est la racine retournee par Git qui est
 * conservee. Aucun controle metier n'est fait ici — l'unicite en base reste la
 * responsabilite de l'application web.
 */
export async function resolveRepository(
  rawPath: string,
  options: { runGit?: GitRunner; timeoutMs?: number } = {},
): Promise<ResolveRepositoryResult> {
  const runGit = options.runGit ?? runGitToplevel;
  const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;

  const trimmed = rawPath.trim();
  if (trimmed === "") {
    return { ok: false, code: RUNNER_ERROR.PATH_REQUIRED };
  }

  if (!path.isAbsolute(trimmed)) {
    return { ok: false, code: RUNNER_ERROR.PATH_NOT_ABSOLUTE };
  }

  let stats;
  try {
    stats = statSync(trimmed);
  } catch {
    return { ok: false, code: RUNNER_ERROR.PATH_NOT_FOUND };
  }

  if (!stats.isDirectory()) {
    return { ok: false, code: RUNNER_ERROR.PATH_NOT_DIRECTORY };
  }

  const outcome = await runGit(trimmed, timeoutMs);

  switch (outcome.status) {
    case "unavailable":
      return { ok: false, code: RUNNER_ERROR.GIT_NOT_AVAILABLE };
    case "timeout":
      return { ok: false, code: RUNNER_ERROR.GIT_TIMEOUT };
    case "failed":
      // Git s'execute mais refuse : hors repository dans l'immense majorite des cas.
      return { ok: false, code: RUNNER_ERROR.NOT_A_GIT_REPOSITORY };
    case "ok":
      break;
  }

  const toplevel = outcome.stdout.trim();
  if (toplevel === "") {
    return { ok: false, code: RUNNER_ERROR.NOT_A_GIT_REPOSITORY };
  }

  return { ok: true, canonicalPath: toCanonicalPath(toplevel) };
}
