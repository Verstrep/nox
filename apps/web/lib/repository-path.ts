/**
 * Validation d'un chemin de repository Git local.
 *
 * Ce module tourne exclusivement cote serveur. Il est volontairement sans
 * dependance a React ni a Next.js afin d'etre testable avec `node --test`.
 *
 * Regles de securite appliquees ici :
 * - la valeur utilisateur n'est jamais concatenee dans une ligne de commande :
 *   `execFile` recoit un tableau d'arguments, sans shell intermediaire ;
 * - aucune commande Git modifiant le repository n'est executee ;
 * - aucun fichier du repository n'est lu ni affiche ;
 * - la commande est bornee par un delai maximal.
 *
 * Responsabilite temporaire : cette verification est faite par le serveur web
 * local. Elle sera deplacee vers `apps/runner` lorsque NOX separera reellement
 * l'interface de la machine qui execute Claude Code.
 */

import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";

/** Delai maximal accorde a la commande Git, en millisecondes. */
export const GIT_TIMEOUT_MS = 5_000;

export const REPOSITORY_PATH_ERROR = {
  EMPTY: "EMPTY",
  NOT_ABSOLUTE: "NOT_ABSOLUTE",
  NOT_FOUND: "NOT_FOUND",
  NOT_A_DIRECTORY: "NOT_A_DIRECTORY",
  NOT_A_GIT_REPOSITORY: "NOT_A_GIT_REPOSITORY",
  GIT_UNAVAILABLE: "GIT_UNAVAILABLE",
  GIT_TIMEOUT: "GIT_TIMEOUT",
  GIT_FAILED: "GIT_FAILED",
} as const;

export type RepositoryPathErrorCode =
  (typeof REPOSITORY_PATH_ERROR)[keyof typeof REPOSITORY_PATH_ERROR];

export type RepositoryPathResult =
  | { ok: true; canonicalPath: string }
  | { ok: false; code: RepositoryPathErrorCode; message: string };

/** Resultat brut d'un appel a Git, sans distinction de cause. */
export type GitOutcome =
  | { status: "ok"; stdout: string }
  | { status: "unavailable" }
  | { status: "timeout" }
  | { status: "failed" };

/** Signature d'un lanceur Git, injectable pour les tests. */
export type GitRunner = (directory: string, timeoutMs: number) => Promise<GitOutcome>;

const MESSAGES: Record<RepositoryPathErrorCode, string> = {
  EMPTY: "Indiquez le chemin du repository Git local.",
  NOT_ABSOLUTE: "Le chemin doit etre absolu (par exemple D:\\Projets\\mon-projet).",
  NOT_FOUND: "Ce chemin n'existe pas sur cette machine.",
  NOT_A_DIRECTORY: "Ce chemin pointe vers un fichier : indiquez un dossier.",
  NOT_A_GIT_REPOSITORY: "Ce dossier n'appartient a aucun repository Git.",
  GIT_UNAVAILABLE: "Git est introuvable. Installez Git et verifiez qu'il est dans le PATH.",
  GIT_TIMEOUT: "Git n'a pas repondu dans le delai imparti.",
  GIT_FAILED: "Git n'a pas pu determiner la racine du repository.",
};

function failure(code: RepositoryPathErrorCode): RepositoryPathResult {
  return { ok: false, code, message: MESSAGES[code] };
}

/**
 * Execute `git -C <directory> rev-parse --show-toplevel`.
 *
 * `execFile` est utilise sans shell : le chemin est transmis comme argument, il
 * ne peut donc pas etre interprete comme une commande.
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
 * designent le meme dossier : sans cette normalisation, un meme repository
 * pourrait etre enregistre deux fois.
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
 * Valide un chemin saisi par l'utilisateur et retourne la racine canonique du
 * repository Git correspondant.
 *
 * Un sous-dossier est accepte : c'est la racine retournee par Git qui est
 * conservee.
 */
export async function validateRepositoryPath(
  rawPath: string,
  options: { runGit?: GitRunner; timeoutMs?: number } = {},
): Promise<RepositoryPathResult> {
  const runGit = options.runGit ?? runGitToplevel;
  const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;

  const trimmed = rawPath.trim();
  if (trimmed === "") {
    return failure(REPOSITORY_PATH_ERROR.EMPTY);
  }

  if (!path.isAbsolute(trimmed)) {
    return failure(REPOSITORY_PATH_ERROR.NOT_ABSOLUTE);
  }

  let stats;
  try {
    stats = statSync(trimmed);
  } catch {
    return failure(REPOSITORY_PATH_ERROR.NOT_FOUND);
  }

  if (!stats.isDirectory()) {
    return failure(REPOSITORY_PATH_ERROR.NOT_A_DIRECTORY);
  }

  const outcome = await runGit(trimmed, timeoutMs);

  switch (outcome.status) {
    case "unavailable":
      return failure(REPOSITORY_PATH_ERROR.GIT_UNAVAILABLE);
    case "timeout":
      return failure(REPOSITORY_PATH_ERROR.GIT_TIMEOUT);
    case "failed":
      // Git s'execute mais refuse : hors repository dans l'immense majorite des cas.
      return failure(REPOSITORY_PATH_ERROR.NOT_A_GIT_REPOSITORY);
    case "ok":
      break;
  }

  const toplevel = outcome.stdout.trim();
  if (toplevel === "") {
    return failure(REPOSITORY_PATH_ERROR.GIT_FAILED);
  }

  return { ok: true, canonicalPath: toCanonicalPath(toplevel) };
}
