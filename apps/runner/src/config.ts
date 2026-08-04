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

export type RunnerConfig = {
  host: string;
  port: number;
  /** Jeton attendu dans l'en-tete `Authorization` des routes sensibles. */
  token: string;
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

  return { ok: true, config: { host, port: port.port, token } };
}
