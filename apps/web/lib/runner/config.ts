/**
 * Configuration du client runner, cote serveur uniquement.
 *
 * Le jeton lu ici ne doit jamais atteindre le navigateur : aucune de ces valeurs
 * n'est prefixee `NEXT_PUBLIC_`, et ce module refuse de s'executer cote client.
 */

export const DEFAULT_RUNNER_URL = "http://127.0.0.1:4310";

/** Delai maximal accorde a une requete vers le runner. */
export const RUNNER_REQUEST_TIMEOUT_MS = 8_000;

export type RunnerClientConfig = {
  baseUrl: string;
  token: string;
};

export type RunnerClientConfigResult =
  | { ok: true; config: RunnerClientConfig }
  | { ok: false };

/**
 * Garde-fou : si ce module se retrouvait dans un bundle navigateur, l'erreur
 * serait immediate et explicite plutot que silencieuse.
 */
function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error("Le client runner de NOX ne peut pas etre utilise cote navigateur.");
  }
}

/**
 * Construit la configuration du client a partir de l'environnement.
 *
 * Retourne `ok: false` sans detail : l'appelant traduit cela en « runner non
 * configure », sans jamais exposer l'URL interne ni la presence du jeton.
 */
export function loadRunnerClientConfig(
  environment: Record<string, string | undefined>,
): RunnerClientConfigResult {
  assertServerOnly();

  const token = environment["NOX_RUNNER_TOKEN"]?.trim();
  if (token === undefined || token === "") {
    return { ok: false };
  }

  const rawUrl = environment["NOX_RUNNER_URL"]?.trim();
  const baseUrl = rawUrl === undefined || rawUrl === "" ? DEFAULT_RUNNER_URL : rawUrl;

  return { ok: true, config: { baseUrl: baseUrl.replace(/\/+$/, ""), token } };
}
