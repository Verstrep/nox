/**
 * Resolution de l'executable Claude Code et preparation de son environnement.
 *
 * Trois problemes distincts vivent ici, tous lies au lancement d'un processus
 * exterieur depuis un serveur.
 *
 * ## 1. Retrouver l'executable sans passer par un shell
 *
 * `shell: true` est exclu : c'est la porte par laquelle une chaine concatenee
 * devient une commande. La resolution est donc faite ici, a la main, en
 * parcourant `PATH` — et sous Windows en essayant chaque extension de `PATHEXT`.
 * Le resultat est un chemin, pas une chaine a interpreter.
 *
 * ## 2. Le cas Windows des scripts `.cmd`
 *
 * Sous Windows, `claude` est generalement un `claude.cmd` genere par npm. Un
 * `.cmd` n'est pas un executable : il doit etre lance par `cmd.exe`. La solution
 * n'est pas de repasser par un shell mais de construire une **liste
 * d'arguments fixe** — `cmd.exe /d /s /c <chemin resolu> <args>` — ou le chemin
 * vient de notre resolution et les arguments de notre code. Le prompt, lui,
 * n'entre jamais dans cette liste : il passe exclusivement par l'entree
 * standard.
 *
 * ## 3. Ne pas transmettre les secrets de NOX
 *
 * Le processus enfant herite de l'environnement du runner, qui contient le jeton
 * partage et l'URL de la base. Claude Code n'en a aucun besoin, et un agent qui
 * peut lire `NOX_RUNNER_TOKEN` peut appeler le runner lui-meme. Toutes les
 * variables `NOX_*` sont donc retirees — pas seulement celles qu'on sait
 * secretes aujourd'hui.
 *
 * Les variables `ANTHROPIC_*` sont en revanche **laissees intactes** : NOX n'en
 * ajoute aucune, mais s'il en existe une, elle appartient a la configuration
 * Claude Code de l'utilisateur, et la retirer casserait une authentification qui
 * fonctionnait.
 */

import { execFile, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** Delai maximal accorde a `claude --version`. */
export const CLAUDE_VERSION_TIMEOUT_MS = 15_000;

/** Prefixe des variables retirees de l'environnement du processus enfant. */
const SECRET_ENVIRONMENT_PREFIX = "NOX_";

export type ExecutableEnvironment = Record<string, string | undefined>;

function isExecutableFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Retrouve le chemin d'un executable, sans shell.
 *
 * Un nom sans separateur est cherche dans `PATH` ; un chemin est utilise tel
 * quel. Retourne `null` si rien n'est trouve — c'est un refus, pas une
 * exception : l'absence de Claude Code est un cas normal que le preflight doit
 * savoir annoncer.
 */
export function resolveExecutablePath(
  command: string,
  environment: ExecutableEnvironment = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const trimmed = command.trim();
  if (trimmed === "") {
    return null;
  }

  const isWindows = platform === "win32";
  const extensions = isWindows
    ? (environment["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((entry) => entry !== "")
    : [""];

  const hasSeparator = trimmed.includes("/") || (isWindows && trimmed.includes("\\"));

  const candidatesFor = (base: string): string[] => {
    // Un chemin deja pourvu d'une extension connue est essaye tel quel d'abord.
    const direct = isExecutableFile(base) ? [base] : [];
    const suffixed = isWindows ? extensions.map((extension) => `${base}${extension}`) : [];
    return [...direct, ...suffixed];
  };

  if (hasSeparator || path.isAbsolute(trimmed)) {
    return candidatesFor(path.resolve(trimmed)).find(isExecutableFile) ?? null;
  }

  const searchPath = (environment["PATH"] ?? environment["Path"] ?? "").split(path.delimiter);
  for (const directory of searchPath) {
    if (directory === "") {
      continue;
    }
    const found = candidatesFor(path.join(directory, trimmed)).find(isExecutableFile);
    if (found !== undefined) {
      return found;
    }
  }

  return null;
}

export type SpawnPlan = {
  command: string;
  args: string[];
};

/**
 * Construit la commande et la liste d'arguments a passer a `spawn`.
 *
 * Aucune concatenation : chaque argument est un element distinct du tableau, et
 * Node se charge de l'echappement. Un `.cmd` ou un `.bat` sous Windows est
 * enveloppe dans `cmd.exe /d /s /c`, avec la meme regle.
 */
export function buildSpawnPlan(
  resolvedPath: string,
  args: readonly string[],
  environment: ExecutableEnvironment = process.env,
  platform: NodeJS.Platform = process.platform,
): SpawnPlan {
  const extension = path.extname(resolvedPath).toLowerCase();

  if (platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
    const comspec = environment["ComSpec"] ?? environment["COMSPEC"] ?? "cmd.exe";
    return { command: comspec, args: ["/d", "/s", "/c", resolvedPath, ...args] };
  }

  return { command: resolvedPath, args: [...args] };
}

/**
 * Copie l'environnement en retirant les variables propres a NOX.
 *
 * Le filtre porte sur le prefixe entier plutot que sur une liste nominative :
 * une variable ajoutee plus tard serait sinon transmise par oubli, et
 * l'oubli irait dans le mauvais sens.
 */
export function sanitizeEnvironment(
  environment: ExecutableEnvironment = process.env,
): NodeJS.ProcessEnv {
  const sanitized: Record<string, string> = {};

  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) {
      continue;
    }
    if (name.toUpperCase().startsWith(SECRET_ENVIRONMENT_PREFIX)) {
      continue;
    }
    sanitized[name] = value;
  }

  // `NodeJS.ProcessEnv` est augmente par Next.js pour rendre `NODE_ENV`
  // obligatoire, ce qu'un objet construit ne peut pas garantir structurellement.
  // La valeur *est* pourtant un environnement, derive du vrai : l'assertion dit
  // exactement cela, et rien de plus.
  return sanitized as NodeJS.ProcessEnv;
}

export type ClaudeVersionResult =
  | { available: true; version: string; resolvedPath: string }
  | { available: false };

/** Signature d'un detecteur de version, injectable pour les tests. */
export type ClaudeVersionProbe = (
  executable: string,
  timeoutMs: number,
) => Promise<ClaudeVersionResult>;

/**
 * Interroge `claude --version`.
 *
 * Volontairement la seule invocation faite hors d'une execution reelle : elle
 * ne consomme aucun quota et ne joint aucun service. L'authentification, elle,
 * n'est **pas** verifiee ici — la tester demanderait une vraie requete, donc du
 * quota. Un probleme d'authentification apparait au premier lancement reel,
 * avec le message de Claude Code.
 */
export const probeClaudeVersion: ClaudeVersionProbe = (executable, timeoutMs) =>
  new Promise((resolve) => {
    const resolvedPath = resolveExecutablePath(executable);
    if (resolvedPath === null) {
      resolve({ available: false });
      return;
    }

    const plan = buildSpawnPlan(resolvedPath, ["--version"]);

    // Options typees explicitement : ce fichier est aussi compile par la
    // configuration de `apps/web` (via son test d'integration), dont les `lib`
    // different et ne laissent pas `encoding` se restreindre tout seul.
    const options: ExecFileOptionsWithStringEncoding = {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: "utf8",
      env: sanitizeEnvironment(),
    };

    execFile(
      plan.command,
      plan.args,
      options,
      (error: Error | null, stdout: string) => {
        if (error !== null) {
          resolve({ available: false });
          return;
        }
        const version = stdout.trim().split("\n")[0]?.trim() ?? "";
        resolve(
          version === ""
            ? { available: false }
            : { available: true, version, resolvedPath },
        );
      },
    );
  });

/** Verifie l'existence d'un chemin, utilise par les tests de resolution. */
export function executableExists(candidate: string): boolean {
  return existsSync(candidate) && isExecutableFile(candidate);
}
