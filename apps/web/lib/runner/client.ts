/**
 * Client HTTP du runner local, strictement cote serveur.
 *
 * Deux operations, pas une de plus : verifier la disponibilite du runner et
 * resoudre la racine d'un repository. Ce n'est volontairement pas un client HTTP
 * generique.
 *
 * Le jeton circule uniquement dans l'en-tete `Authorization` d'une requete
 * serveur-vers-serveur. Il n'apparait dans aucune valeur de retour, dans aucun
 * message d'erreur et dans aucun log.
 */

import {
  isListProjectDocumentsSuccess,
  isReadProjectDocumentSuccess,
  isResolveRepositorySuccess,
  isRunnerErrorResponse,
  isRunnerHealthResponse,
  type ListProjectDocumentsRequest,
  type ProjectDocumentContent,
  type ProjectDocumentSummary,
  type ReadProjectDocumentRequest,
  type ResolveRepositoryRequest,
  type RunnerHealthResponse,
} from "@nox/shared";

import { RUNNER_REQUEST_TIMEOUT_MS, loadRunnerClientConfig } from "./config.ts";
import type { RunnerFailure, RunnerResult } from "./errors.ts";

/** Dependances injectables, utilisees par les tests. */
export type RunnerClientOptions = {
  fetch?: typeof globalThis.fetch;
  environment?: Record<string, string | undefined>;
  timeoutMs?: number;
};

type RawResponse = { status: number; body: unknown };

function failure<TValue>(runnerFailure: RunnerFailure): RunnerResult<TValue> {
  return { ok: false, failure: runnerFailure };
}

/**
 * Journalise un incident technique cote serveur.
 * Ni le jeton ni l'en-tete `Authorization` ne sont passes a cette fonction.
 */
function logRunnerIssue(operation: string, detail: string): void {
  console.error(`[nox] runner ${operation} : ${detail}`);
}

/**
 * Execute une requete vers le runner et retourne son statut et son corps JSON.
 *
 * Le timeout passe par un `AbortController` afin de distinguer un depassement de
 * delai d'une simple absence de connexion.
 */
async function request(
  url: string,
  init: RequestInit,
  fetchImplementation: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<{ ok: true; response: RawResponse } | { ok: false; failure: RunnerFailure }> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);

  let response: Response;
  try {
    response = await fetchImplementation(url, { ...init, signal: controller.signal });
  } catch (error) {
    // `abort` declenche par notre minuteur : c'est un depassement de delai.
    if (controller.signal.aborted) {
      return { ok: false, failure: { kind: "timeout" } };
    }
    logRunnerIssue("injoignable", error instanceof Error ? error.message : "cause inconnue");
    return { ok: false, failure: { kind: "unreachable" } };
  } finally {
    clearTimeout(timer);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    logRunnerIssue("reponse illisible", `statut ${String(response.status)}, JSON invalide`);
    return { ok: false, failure: { kind: "invalid_response" } };
  }

  return { ok: true, response: { status: response.status, body } };
}

/** Traduit un corps d'erreur du runner en echec typé. */
function toFailure(operation: string, response: RawResponse): RunnerFailure {
  if (response.status === 401) {
    return { kind: "unauthorized" };
  }

  if (isRunnerErrorResponse(response.body)) {
    return { kind: "runner_error", code: response.body.error.code };
  }

  logRunnerIssue(operation, `contrat inattendu (statut ${String(response.status)})`);
  return { kind: "invalid_response" };
}

/**
 * Interroge `GET /health`.
 *
 * Ne necessite pas de jeton cote runner, mais exige tout de meme une
 * configuration : sans elle, le web ne saurait pas ou joindre le runner.
 */
export async function checkRunnerHealth(
  options: RunnerClientOptions = {},
): Promise<RunnerResult<RunnerHealthResponse>> {
  const configuration = loadRunnerClientConfig(options.environment ?? process.env);
  if (!configuration.ok) {
    return failure({ kind: "not_configured" });
  }

  const result = await request(
    `${configuration.config.baseUrl}/health`,
    { method: "GET", headers: { accept: "application/json" }, cache: "no-store" },
    options.fetch ?? globalThis.fetch,
    options.timeoutMs ?? RUNNER_REQUEST_TIMEOUT_MS,
  );

  if (!result.ok) {
    return failure(result.failure);
  }

  if (result.response.status !== 200 || !isRunnerHealthResponse(result.response.body)) {
    return failure(toFailure("health", result.response));
  }

  return { ok: true, value: result.response.body };
}

/**
 * Envoie une requete authentifiee a une route sensible du runner, et valide sa
 * reponse contre le contrat partage.
 *
 * `extract` n'est appele que sur une reponse `200` reconnue : tout le reste
 * devient un echec typé. Une reponse hors contrat n'atteint donc jamais
 * l'interface.
 */
async function postAuthenticated<TBody, TValue>(
  route: string,
  operation: string,
  payload: TBody,
  isSuccess: (value: unknown) => boolean,
  extract: (value: unknown) => TValue,
  options: RunnerClientOptions,
): Promise<RunnerResult<TValue>> {
  const configuration = loadRunnerClientConfig(options.environment ?? process.env);
  if (!configuration.ok) {
    return failure({ kind: "not_configured" });
  }

  const result = await request(
    `${configuration.config.baseUrl}${route}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${configuration.config.token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    },
    options.fetch ?? globalThis.fetch,
    options.timeoutMs ?? RUNNER_REQUEST_TIMEOUT_MS,
  );

  if (!result.ok) {
    return failure(result.failure);
  }

  if (result.response.status === 200 && isSuccess(result.response.body)) {
    return { ok: true, value: extract(result.response.body) };
  }

  return failure(toFailure(operation, result.response));
}

/**
 * Demande au runner la racine canonique du repository contenant `repositoryPath`.
 *
 * Le web ne valide plus le chemin lui-meme : c'est la machine du runner qui fait
 * foi. Seule l'unicite en base reste une responsabilite du web.
 */
export function resolveRepositoryPath(
  repositoryPath: string,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<string>> {
  const payload: ResolveRepositoryRequest = { repositoryPath };

  return postAuthenticated(
    "/repositories/resolve",
    "resolve",
    payload,
    isResolveRepositorySuccess,
    (value) => (value as { repository: { canonicalPath: string } }).repository.canonicalPath,
    options,
  );
}

/**
 * Inventorie les documents Markdown d'un repository.
 *
 * Les fiches retournees ne contiennent que des chemins **relatifs** : le chemin
 * absolu du repository ne quitte jamais le runner.
 */
export function listProjectDocuments(
  repositoryPath: string,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<ProjectDocumentSummary[]>> {
  const payload: ListProjectDocumentsRequest = { repositoryPath };

  return postAuthenticated(
    "/repositories/documents/list",
    "documents/list",
    payload,
    isListProjectDocumentsSuccess,
    (value) => (value as { documents: ProjectDocumentSummary[] }).documents,
    options,
  );
}

/**
 * Lit un document Markdown du repository.
 *
 * `documentPath` est relatif a la racine du repository. Le confinement est
 * verifie par le runner, jamais ici : le web n'a aucune vue sur le disque.
 */
export function readProjectDocument(
  repositoryPath: string,
  documentPath: string,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<ProjectDocumentContent>> {
  const payload: ReadProjectDocumentRequest = { repositoryPath, documentPath };

  return postAuthenticated(
    "/repositories/documents/read",
    "documents/read",
    payload,
    isReadProjectDocumentSuccess,
    (value) => (value as { document: ProjectDocumentContent }).document,
    options,
  );
}
