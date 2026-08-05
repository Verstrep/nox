/**
 * Ecriture uniforme des reponses HTTP du runner.
 *
 * Toutes les reponses sont du JSON ; toutes les erreurs suivent le contrat
 * partage `RunnerErrorResponse`. Aucune trace d'exception, aucun chemin local et
 * aucun jeton n'est jamais ecrit dans une reponse.
 */

import type { ServerResponse } from "node:http";

import { RUNNER_ERROR, type RunnerErrorCode, type RunnerErrorResponse } from "@nox/shared";

/**
 * Statut HTTP associe a chaque code d'erreur.
 *
 * Les echecs de validation d'un repository sont des `422` : la requete est bien
 * formee, mais la machine ne permet pas de la satisfaire.
 */
const ERROR_STATUS: Record<RunnerErrorCode, number> = {
  [RUNNER_ERROR.INVALID_JSON]: 400,
  [RUNNER_ERROR.INVALID_REQUEST]: 400,
  [RUNNER_ERROR.PAYLOAD_TOO_LARGE]: 413,
  [RUNNER_ERROR.UNSUPPORTED_MEDIA_TYPE]: 415,
  [RUNNER_ERROR.ROUTE_NOT_FOUND]: 404,
  [RUNNER_ERROR.METHOD_NOT_ALLOWED]: 405,
  [RUNNER_ERROR.UNAUTHORIZED]: 401,

  [RUNNER_ERROR.PATH_REQUIRED]: 422,
  [RUNNER_ERROR.PATH_NOT_ABSOLUTE]: 422,
  [RUNNER_ERROR.PATH_NOT_FOUND]: 422,
  [RUNNER_ERROR.PATH_NOT_DIRECTORY]: 422,
  [RUNNER_ERROR.NOT_A_GIT_REPOSITORY]: 422,
  [RUNNER_ERROR.GIT_NOT_AVAILABLE]: 503,
  [RUNNER_ERROR.GIT_TIMEOUT]: 504,

  // Le repository enregistre a disparu ou changé de nature : la requete est
  // correcte, c'est l'etat de la machine qui ne permet pas d'y repondre.
  [RUNNER_ERROR.REPOSITORY_PATH_REQUIRED]: 400,
  [RUNNER_ERROR.REPOSITORY_NOT_FOUND]: 422,
  [RUNNER_ERROR.REPOSITORY_NOT_DIRECTORY]: 422,

  [RUNNER_ERROR.DOCUMENT_PATH_REQUIRED]: 400,
  [RUNNER_ERROR.DOCUMENT_PATH_INVALID]: 400,
  // `403` et non `404` : le runner sait ou pointe la demande et refuse
  // deliberement d'y repondre. Un `404` laisserait croire a une simple absence.
  [RUNNER_ERROR.DOCUMENT_OUTSIDE_REPOSITORY]: 403,
  [RUNNER_ERROR.DOCUMENT_NOT_ALLOWED]: 403,
  [RUNNER_ERROR.DOCUMENT_NOT_FOUND]: 404,
  [RUNNER_ERROR.DOCUMENT_NOT_FILE]: 422,
  [RUNNER_ERROR.DOCUMENT_NOT_MARKDOWN]: 422,
  [RUNNER_ERROR.DOCUMENT_TOO_LARGE]: 413,
  [RUNNER_ERROR.DOCUMENT_NOT_UTF8]: 422,
  [RUNNER_ERROR.DOCUMENT_READ_FAILED]: 500,
  [RUNNER_ERROR.TOO_MANY_DOCUMENTS]: 422,

  [RUNNER_ERROR.DOCUMENT_REVISION_REQUIRED]: 400,
  [RUNNER_ERROR.DOCUMENT_REVISION_INVALID]: 400,
  [RUNNER_ERROR.DOCUMENT_CONTENT_INVALID]: 400,
  // `409` : la requete est valide et le fichier accessible, mais son etat a
  // change. C'est exactement le sens du statut de conflit.
  [RUNNER_ERROR.DOCUMENT_CONFLICT]: 409,
  // Meme famille que `DOCUMENT_OUTSIDE_REPOSITORY` : le runner sait ecrire ici
  // mais s'y refuse deliberement.
  [RUNNER_ERROR.DOCUMENT_SYMLINK_NOT_WRITABLE]: 403,
  [RUNNER_ERROR.DOCUMENT_TEMPORARY_FILE_FAILED]: 500,
  [RUNNER_ERROR.DOCUMENT_WRITE_FAILED]: 500,

  [RUNNER_ERROR.INTERNAL_ERROR]: 500,
};

export function statusForErrorCode(code: RunnerErrorCode): number {
  return ERROR_STATUS[code];
}

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  requestId?: string,
): void {
  const body = JSON.stringify(payload);
  const headers: Record<string, string | number> = {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  };

  if (requestId !== undefined) {
    headers["x-request-id"] = requestId;
  }

  response.writeHead(statusCode, headers);
  response.end(body);
}

/** Envoie une erreur conforme au contrat partage, avec le statut adapte. */
export function sendRunnerError(
  response: ServerResponse,
  code: RunnerErrorCode,
  requestId?: string,
): void {
  const payload: RunnerErrorResponse = { ok: false, error: { code } };
  sendJson(response, statusForErrorCode(code), payload, requestId);
}

/** Ajoute l'en-tete exige par la RFC pour un `405`. */
export function sendMethodNotAllowed(
  response: ServerResponse,
  allowed: readonly string[],
  requestId?: string,
): void {
  response.setHeader("allow", allowed.join(", "));
  sendRunnerError(response, RUNNER_ERROR.METHOD_NOT_ALLOWED, requestId);
}
