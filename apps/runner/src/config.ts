/**
 * Configuration du runner, validee au demarrage.
 *
 * Le principe : une configuration invalide arrete le runner avec un message
 * actionnable, plutot que de le laisser demarrer dans un etat a moitie
 * utilisable. Un runner sans jeton ne peut rien faire d'utile ; un runner
 * ecoutant hors de la boucle locale serait une faille.
 */

export const DEFAULT_RUNNER_HOST = "127.0.0.1";
export const DEFAULT_RUNNER_PORT = 4310;

/**
 * Executable Claude Code par defaut.
 *
 * Un nom, pas un chemin : la resolution est laissee au systeme, qui applique le
 * `PATH` de l'utilisateur. Un chemin code en dur casserait a la premiere mise a
 * jour de l'outil.
 */
export const DEFAULT_CLAUDE_EXECUTABLE = "claude";

/**
 * Nombre maximal de tours accorde a Claude Code.
 *
 * 80 est genereux pour une tache NOX bien decoupee, et suffisamment bas pour
 * qu'une boucle qui tourne en rond s'arrete d'elle-meme.
 */
export const DEFAULT_CLAUDE_MAX_TURNS = 80;
export const MIN_CLAUDE_MAX_TURNS = 1;
export const MAX_CLAUDE_MAX_TURNS = 500;

/**
 * Delai maximal d'une execution, en minutes.
 *
 * Deux heures : au-dela, une tache qui n'a pas abouti a un probleme que le
 * temps ne resoudra pas. La borne haute evite qu'une valeur mal saisie
 * transforme le delai en absence de delai.
 */
export const DEFAULT_CLAUDE_TIMEOUT_MINUTES = 120;
export const MIN_CLAUDE_TIMEOUT_MINUTES = 1;
export const MAX_CLAUDE_TIMEOUT_MINUTES = 600;

export type ClaudeConfig = {
  /** Nom ou chemin de l'executable ; ne vient jamais du navigateur. */
  executable: string;
  maxTurns: number;
  timeoutMinutes: number;
};

export type RunnerConfig = {
  host: string;
  port: number;
  /** Jeton attendu dans l'en-tete `Authorization` des routes sensibles. */
  token: string;
  claude: ClaudeConfig;
};

export type RunnerConfigResult =
  | { ok: true; config: RunnerConfig }
  | { ok: false; message: string };

/**
 * Determine si un host est une adresse de boucle locale.
 *
 * Seules ces adresses sont acceptees en V1 : le runner exécute Git et, a terme,
 * Claude Code. L'exposer sur le reseau reviendrait a offrir l'execution de
 * commandes a quiconque atteint la machine.
 */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");

  if (normalized === "localhost" || normalized === "::1" || normalized === "::ffff:127.0.0.1") {
    return true;
  }

  // Tout le bloc 127.0.0.0/8 est de la boucle locale.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  if (ipv4 === null) {
    return false;
  }

  const octets = ipv4.slice(1).map((part) => Number.parseInt(part, 10));
  return octets.every((part) => part >= 0 && part <= 255) && octets[0] === 127;
}

function readPort(raw: string | undefined): { ok: true; port: number } | { ok: false } {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, port: DEFAULT_RUNNER_PORT };
  }

  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false };
  }

  return { ok: true, port };
}

/**
 * Construit la configuration a partir des variables d'environnement.
 *
 * Aucune valeur de jeton n'apparait dans les messages retournes.
 */
export function loadRunnerConfig(environment: Record<string, string | undefined>): RunnerConfigResult {
  const rawHost = environment["NOX_RUNNER_HOST"]?.trim();
  const host = rawHost === undefined || rawHost === "" ? DEFAULT_RUNNER_HOST : rawHost;

  if (!isLoopbackHost(host)) {
    return {
      ok: false,
      message:
        `NOX_RUNNER_HOST vaut "${host}", qui n'est pas une adresse de boucle locale. ` +
        "Le runner de la V1 refuse d'ecouter en dehors de 127.0.0.0/8, ::1 ou localhost.",
    };
  }

  const port = readPort(environment["NOX_RUNNER_PORT"]);
  if (!port.ok) {
    return {
      ok: false,
      message:
        `NOX_RUNNER_PORT est invalide ("${environment["NOX_RUNNER_PORT"] ?? ""}"). ` +
        "Indiquez un entier compris entre 1 et 65535.",
    };
  }

  const token = environment["NOX_RUNNER_TOKEN"]?.trim();
  if (token === undefined || token === "") {
    return {
      ok: false,
      message:
        "NOX_RUNNER_TOKEN est absent. Les routes sensibles du runner en dependent, et le " +
        "runner n'en genere pas automatiquement : l'application web doit pouvoir utiliser la " +
        "meme valeur d'un demarrage a l'autre.\n" +
        "  Generer un jeton local :  node -e \"console.log(require('node:crypto').randomBytes(32).toString('hex'))\"",
    };
  }

  const claude = readClaudeConfig(environment);
  if (!claude.ok) {
    return { ok: false, message: claude.message };
  }

  return { ok: true, config: { host, port: port.port, token, claude: claude.config } };
}

/**
 * Lit un entier borne depuis l'environnement.
 *
 * Une valeur hors bornes est un refus, jamais un ecretage silencieux : un
 * utilisateur qui ecrit `NOX_CLAUDE_TIMEOUT_MINUTES=6000` doit apprendre que sa
 * valeur est refusee, pas decouvrir des mois plus tard que le runner en a
 * applique une autre.
 */
function readBoundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): { ok: true; value: number } | { ok: false } {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, value: fallback };
  }

  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    return { ok: false };
  }

  return { ok: true, value };
}

type ClaudeConfigResult = { ok: true; config: ClaudeConfig } | { ok: false; message: string };

/**
 * Construit la configuration Claude Code.
 *
 * Aucune de ces valeurs ne vient du navigateur : ni l'executable, ni le nombre
 * de tours, ni le delai. Elles sont fixees sur la machine, par la personne qui
 * y lance le runner.
 */
function readClaudeConfig(environment: Record<string, string | undefined>): ClaudeConfigResult {
  const rawExecutable = environment["NOX_CLAUDE_EXECUTABLE"]?.trim();
  const executable =
    rawExecutable === undefined || rawExecutable === ""
      ? DEFAULT_CLAUDE_EXECUTABLE
      : rawExecutable;

  const maxTurns = readBoundedInteger(
    environment["NOX_CLAUDE_MAX_TURNS"],
    DEFAULT_CLAUDE_MAX_TURNS,
    MIN_CLAUDE_MAX_TURNS,
    MAX_CLAUDE_MAX_TURNS,
  );
  if (!maxTurns.ok) {
    return {
      ok: false,
      message:
        `NOX_CLAUDE_MAX_TURNS est invalide ("${environment["NOX_CLAUDE_MAX_TURNS"] ?? ""}"). ` +
        `Indiquez un entier compris entre ${String(MIN_CLAUDE_MAX_TURNS)} et ${String(MAX_CLAUDE_MAX_TURNS)}.`,
    };
  }

  const timeoutMinutes = readBoundedInteger(
    environment["NOX_CLAUDE_TIMEOUT_MINUTES"],
    DEFAULT_CLAUDE_TIMEOUT_MINUTES,
    MIN_CLAUDE_TIMEOUT_MINUTES,
    MAX_CLAUDE_TIMEOUT_MINUTES,
  );
  if (!timeoutMinutes.ok) {
    return {
      ok: false,
      message:
        `NOX_CLAUDE_TIMEOUT_MINUTES est invalide ("${environment["NOX_CLAUDE_TIMEOUT_MINUTES"] ?? ""}"). ` +
        `Indiquez un entier compris entre ${String(MIN_CLAUDE_TIMEOUT_MINUTES)} et ${String(MAX_CLAUDE_TIMEOUT_MINUTES)}.`,
    };
  }

  return {
    ok: true,
    config: { executable, maxTurns: maxTurns.value, timeoutMinutes: timeoutMinutes.value },
  };
}
