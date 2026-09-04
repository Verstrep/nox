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
 * Sous Windows, `claude`, `npm` et `npx` sont des `.cmd` generes par npm. Un
 * `.cmd` n'est pas un executable : il doit etre lance par `cmd.exe`, et Node
 * **refuse** desormais de le lancer autrement — `spawn` leve `EINVAL` depuis la
 * correction de CVE-2024-27980.
 *
 * La solution n'est pas de repasser par un shell : c'est de construire nous-meme
 * la ligne que `cmd.exe` recevra, jeton par jeton et guillemet par guillemet.
 * Cette construction vit dans `command-line.ts`, avec ses raisons. Le prompt,
 * lui, n'entre jamais dans cette ligne : il passe exclusivement par l'entree
 * standard.
 *
 * ## 2 bis. Ce qui est executable sous Windows
 *
 * Un fichier sans extension ne l'est pas. `C:\Program Files\nodejs\` contient un
 * `npm` — le script shell destine a Unix — a cote du `npm.cmd` reellement
 * utilisable. Retenir le premier parce qu'il existe produit un `ENOENT` au
 * lancement : c'est exactement ce que le premier pilote reel a rencontre. La
 * resolution ne retient donc, sous Windows, que les extensions declarees par
 * `PATHEXT`.
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
import { statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { buildWindowsCommandLine } from "./command-line.ts";

/** Delai maximal accorde a `claude --version`. */
export const CLAUDE_VERSION_TIMEOUT_MS = 15_000;

/** Prefixe des variables retirees de l'environnement du processus enfant. */
const SECRET_ENVIRONMENT_PREFIX = "NOX_";

export type ExecutableEnvironment = Record<string, string | undefined>;

/**
 * Existence d'un fichier, injectable.
 *
 * Le seul point de substitution du systeme de fichiers dans ce module. Il existe
 * pour que la branche Windows soit testable depuis n'importe quelle plateforme :
 * simuler `win32` sans pouvoir simuler l'arborescence ne prouverait rien.
 */
export type FileProbe = (candidate: string) => boolean;

function isExecutableFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export type ResolveExecutableOptions = {
  /**
   * Dossier de reference d'un chemin relatif.
   *
   * `./gradlew` designe le programme du **repository**, pas un fichier du
   * dossier depuis lequel le runner a ete lance. Par defaut le dossier courant,
   * pour ne rien changer aux appels qui visent un nom simple.
   */
  cwd?: string;
  /** Sonde de presence, remplacee dans les tests. */
  fileExists?: FileProbe;
};

/**
 * Extensions executables declarees par `PATHEXT`, dans leur ordre.
 *
 * La casse d'origine est conservee : c'est elle qui construit les chemins
 * essayes, et rendre un chemin dont la casse ne correspond a rien serait une
 * approximation gratuite. La comparaison, elle, ignore la casse.
 */
function windowsExtensions(environment: ExecutableEnvironment): string[] {
  return (environment["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
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
  options: ResolveExecutableOptions = {},
): string | null {
  const trimmed = command.trim();
  if (trimmed === "") {
    return null;
  }

  const exists = options.fileExists ?? isExecutableFile;
  const base = options.cwd ?? process.cwd();
  const isWindows = platform === "win32";
  const extensions = isWindows ? windowsExtensions(environment) : [];

  const hasSeparator = trimmed.includes("/") || (isWindows && trimmed.includes("\\"));

  /**
   * Candidats pour un emplacement donne, dans l'ordre d'essai.
   *
   * Sous Windows, un fichier n'est executable que si son extension figure dans
   * `PATHEXT` : le fichier nu n'est donc retenu que lorsqu'il en porte deja une.
   * Ailleurs, le fichier nu est le seul candidat.
   */
  const candidatesFor = (candidate: string): string[] => {
    if (!isWindows) {
      return [candidate];
    }
    const extension = path.extname(candidate).toLowerCase();
    const known = extensions.some((entry) => entry.toLowerCase() === extension);
    const direct = extension !== "" && known ? [candidate] : [];
    return [...direct, ...extensions.map((entry) => `${candidate}${entry}`)];
  };

  if (hasSeparator || path.isAbsolute(trimmed)) {
    return candidatesFor(path.resolve(base, trimmed)).find(exists) ?? null;
  }

  const searchPath = (environment["PATH"] ?? environment["Path"] ?? "").split(path.delimiter);
  for (const directory of searchPath) {
    if (directory === "") {
      continue;
    }
    const found = candidatesFor(path.join(directory, trimmed)).find(exists);
    if (found !== undefined) {
      return found;
    }
  }

  return null;
}

export type SpawnPlan = {
  command: string;
  args: string[];
  /**
   * La ligne est-elle deja ecrite, et doit-elle partir telle quelle ?
   *
   * Vrai uniquement pour l'enveloppe `cmd.exe`, dont la ligne est construite par
   * `command-line.ts`. Ailleurs, chaque argument reste un element distinct et
   * c'est Node qui l'echappe.
   */
  windowsVerbatimArguments: boolean;
};

/**
 * Construit la commande et les arguments a passer a `spawn`.
 *
 * Hors Windows, et pour un vrai executable Windows, rien n'est concatene :
 * chaque argument est un element distinct du tableau, et Node se charge de
 * l'echappement.
 *
 * Un `.cmd` ou un `.bat` sous Windows passe par `cmd.exe /d /s /c`, avec une
 * ligne unique ecrite par `buildWindowsCommandLine` et envoyee sans retouche.
 * Laisser Node echapper cette ligne argument par argument produirait une
 * commande que `cmd.exe` relit differemment — c'est la panne du premier pilote.
 *
 * Retourne `null` quand la ligne ne peut pas etre rendue inerte. Un refus
 * explicite vaut mieux qu'une ligne approximative : l'appelant le traduit en
 * erreur d'infrastructure nommee.
 */
export function buildSpawnPlan(
  resolvedPath: string,
  args: readonly string[],
  environment: ExecutableEnvironment = process.env,
  platform: NodeJS.Platform = process.platform,
): SpawnPlan | null {
  const extension = path.extname(resolvedPath).toLowerCase();

  if (platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
    const comspec = environment["ComSpec"] ?? environment["COMSPEC"] ?? "cmd.exe";
    const line = buildWindowsCommandLine(resolvedPath, args);
    if (line === null) {
      return null;
    }
    return {
      command: comspec,
      args: ["/d", "/s", "/c", line],
      windowsVerbatimArguments: true,
    };
  }

  return { command: resolvedPath, args: [...args], windowsVerbatimArguments: false };
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
    if (plan === null) {
      resolve({ available: false });
      return;
    }

    // Options typees explicitement : ce fichier est aussi compile par la
    // configuration de `apps/web` (via son test d'integration), dont les `lib`
    // different et ne laissent pas `encoding` se restreindre tout seul.
    const options: ExecFileOptionsWithStringEncoding = {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: "utf8",
      env: sanitizeEnvironment(),
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
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
