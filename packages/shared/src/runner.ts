/**
 * Contrat HTTP entre l'application web et le runner local.
 *
 * Ce fichier est la seule source de verite des codes d'erreur et des formes de
 * messages echangees. Le runner les produit, le web les consomme : aucun des
 * deux ne redeclare la liste.
 *
 * Les codes sont volontairement **independants des messages affiches** : le
 * runner ne renvoie jamais de texte destine a l'utilisateur, c'est le web qui
 * traduit chaque code en phrase comprehensible.
 */

import { createStatusGuard } from "./statuses.js";

/** Nom de service annonce par le runner. */
export const RUNNER_SERVICE_NAME = "nox-runner";

/** Codes d'erreur stables du runner. */
export const RUNNER_ERROR = {
  /** Le corps de la requete n'est pas du JSON valide. */
  INVALID_JSON: "INVALID_JSON",
  /** Le corps est du JSON valide mais ne respecte pas la forme attendue. */
  INVALID_REQUEST: "INVALID_REQUEST",
  /** Le corps depasse la taille maximale acceptee. */
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  /** `Content-Type` absent ou different de `application/json`. */
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  /** Route inconnue. */
  ROUTE_NOT_FOUND: "ROUTE_NOT_FOUND",
  /** Route connue, methode HTTP non supportee. */
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  /** Jeton absent, mal forme ou incorrect. */
  UNAUTHORIZED: "UNAUTHORIZED",

  /** Chemin absent ou vide. */
  PATH_REQUIRED: "PATH_REQUIRED",
  /** Chemin relatif. */
  PATH_NOT_ABSOLUTE: "PATH_NOT_ABSOLUTE",
  /** Chemin inexistant sur la machine du runner. */
  PATH_NOT_FOUND: "PATH_NOT_FOUND",
  /** Chemin pointant vers un fichier et non un dossier. */
  PATH_NOT_DIRECTORY: "PATH_NOT_DIRECTORY",
  /** Dossier n'appartenant a aucun repository Git. */
  NOT_A_GIT_REPOSITORY: "NOT_A_GIT_REPOSITORY",
  /** Binaire Git introuvable sur la machine du runner. */
  GIT_NOT_AVAILABLE: "GIT_NOT_AVAILABLE",
  /** Git n'a pas repondu dans le delai imparti. */
  GIT_TIMEOUT: "GIT_TIMEOUT",

  /** Defaillance non prevue du runner. */
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type RunnerErrorCode = (typeof RUNNER_ERROR)[keyof typeof RUNNER_ERROR];

export const RUNNER_ERROR_CODES: readonly RunnerErrorCode[] = Object.values(RUNNER_ERROR);

export const isRunnerErrorCode = createStatusGuard(RUNNER_ERROR_CODES);

/** Reponse de `GET /health`. */
export type RunnerHealthResponse = {
  service: typeof RUNNER_SERVICE_NAME;
  status: "ok";
  version: string;
};

/** Corps attendu par `POST /repositories/resolve`. */
export type ResolveRepositoryRequest = {
  repositoryPath: string;
};

/** Reponse de `POST /repositories/resolve` en cas de succes. */
export type ResolveRepositorySuccess = {
  ok: true;
  repository: {
    canonicalPath: string;
  };
};

/** Reponse d'echec commune a toutes les routes du runner. */
export type RunnerErrorResponse = {
  ok: false;
  error: { code: RunnerErrorCode };
};

export type ResolveRepositoryResponse = ResolveRepositorySuccess | RunnerErrorResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Valide le corps recu par `POST /repositories/resolve`.
 * Retourne `null` si la forme n'est pas celle attendue.
 */
export function parseResolveRepositoryRequest(value: unknown): ResolveRepositoryRequest | null {
  if (!isRecord(value) || typeof value["repositoryPath"] !== "string") {
    return null;
  }
  return { repositoryPath: value["repositoryPath"] };
}

/** Verifie qu'une reponse JSON est bien une reponse de sante du runner. */
export function isRunnerHealthResponse(value: unknown): value is RunnerHealthResponse {
  return (
    isRecord(value) &&
    value["service"] === RUNNER_SERVICE_NAME &&
    value["status"] === "ok" &&
    typeof value["version"] === "string"
  );
}

/** Verifie qu'une reponse JSON est une erreur structuree du runner. */
export function isRunnerErrorResponse(value: unknown): value is RunnerErrorResponse {
  if (!isRecord(value) || value["ok"] !== false) {
    return false;
  }
  const error: unknown = value["error"];
  return isRecord(error) && isRunnerErrorCode(error["code"]);
}

/** Verifie qu'une reponse JSON est une resolution de repository reussie. */
export function isResolveRepositorySuccess(value: unknown): value is ResolveRepositorySuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }
  const repository: unknown = value["repository"];
  return isRecord(repository) && typeof repository["canonicalPath"] === "string";
}
