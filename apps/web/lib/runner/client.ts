/**
 * Client HTTP du runner local, strictement cote serveur.
 *
 * Une fonction par operation du runner, pas une de plus : sante, resolution d'un
 * repository, inventaire, lecture et ecriture d'un document. Ce n'est
 * volontairement pas un client HTTP generique.
 *
 * Le jeton circule uniquement dans l'en-tete `Authorization` d'une requete
 * serveur-vers-serveur. Il n'apparait dans aucune valeur de retour, dans aucun
 * message d'erreur et dans aucun log.
 */

import {
  RUN_EVENT_LIMITS,
  isClaudePreflightSuccess,
  isClaudeRunCancelSuccess,
  isClaudeRunEventsSuccess,
  isClaudeRunStatusSuccess,
  isCreateProjectDocumentSuccess,
  isCreateTaskDocumentSuccess,
  isDeleteProjectDocumentSuccess,
  isDeleteTaskDocumentSuccess,
  isListProjectDocumentsSuccess,
  isStartClaudeRunSuccess,
  isReadProjectDocumentSuccess,
  isResolveRepositorySuccess,
  isRunnerErrorResponse,
  isRunnerHealthResponse,
  isUpdateProjectDocumentSuccess,
  type ClaudePreflightRequest,
  type ClaudePreflightSuccess,
  type ClaudeRunCancelRequest,
  type ClaudeRunCancelSuccess,
  type ClaudeRunEventsRequest,
  type ClaudeRunEventsSuccess,
  type ClaudeRunSnapshot,
  type ClaudeRunStatusRequest,
  type CreateProjectDocumentRequest,
  type CreateTaskDocumentRequest,
  type DeleteProjectDocumentRequest,
  type DeleteProjectDocumentSuccess,
  type DeleteTaskDocumentRequest,
  type DeleteTaskDocumentSuccess,
  type ListProjectDocumentsRequest,
  type StartClaudeRunRequest,
  type ProjectDocumentContent,
  type ProjectDocumentSummary,
  type ReadProjectDocumentRequest,
  type ResolveRepositoryRequest,
  type RunnerHealthResponse,
  type UpdateProjectDocumentRequest,
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
  successStatus = 200,
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

  if (result.response.status === successStatus && isSuccess(result.response.body)) {
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

/**
 * Enregistre le nouveau contenu d'un document existant.
 *
 * `expectedRevision` est la revision obtenue a l'ouverture. Le runner compare
 * cette valeur a l'etat reel du fichier et refuse l'ecriture si elle differe :
 * le web ne decide jamais si l'ecriture est sure, il transmet et interprete.
 *
 * `repositoryPath` provient toujours de la base, jamais du navigateur.
 */
export function updateProjectDocument(
  repositoryPath: string,
  documentPath: string,
  content: string,
  expectedRevision: string,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<ProjectDocumentContent>> {
  const payload: UpdateProjectDocumentRequest = {
    repositoryPath,
    documentPath,
    content,
    expectedRevision,
  };

  return postAuthenticated(
    "/repositories/documents/update",
    "documents/update",
    payload,
    isUpdateProjectDocumentSuccess,
    (value) => (value as { document: ProjectDocumentContent }).document,
    options,
  );
}

/**
 * Cree un nouveau document dans le repository.
 *
 * `documentPath` a ete reconstruit cote serveur a partir d'une destination
 * validee : le navigateur n'a jamais fourni de chemin complet.
 *
 * Le runner repond `201` — une ressource est apparue — et renvoie le document
 * relu, directement exploitable par l'affichage et par l'edition.
 */
export function createProjectDocument(
  repositoryPath: string,
  documentPath: string,
  content: string,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<ProjectDocumentContent>> {
  const payload: CreateProjectDocumentRequest = { repositoryPath, documentPath, content };

  return postAuthenticated(
    "/repositories/documents/create",
    "documents/create",
    payload,
    isCreateProjectDocumentSuccess,
    (value) => (value as { document: ProjectDocumentContent }).document,
    options,
    201,
  );
}

/**
 * Supprime un document ordinaire du repository.
 *
 * `expectedRevision` est la revision obtenue a l'affichage : le runner refuse la
 * suppression si le fichier a change depuis. Comme pour l'ecriture, le web ne
 * decide jamais si l'operation est sure — il transmet et interprete.
 *
 * Les documents de tache sont refuses par le runner, quel que soit ce que le web
 * envoie : la protection ne depend pas de cet appel.
 */
export function deleteProjectDocument(
  repositoryPath: string,
  documentPath: string,
  expectedRevision: string,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<DeleteProjectDocumentSuccess["deleted"]>> {
  const payload: DeleteProjectDocumentRequest = {
    repositoryPath,
    documentPath,
    expectedRevision,
  };

  return postAuthenticated(
    "/repositories/documents/delete",
    "documents/delete",
    payload,
    isDeleteProjectDocumentSuccess,
    (value) => (value as DeleteProjectDocumentSuccess).deleted,
    options,
  );
}

/**
 * Supprime le document Markdown d'une tache.
 *
 * Le web n'envoie **aucun chemin** : il envoie le code de la tache, et le runner
 * compose `tasks/<code>.md`. `expectedRevision` est relue en base — jamais recue
 * du navigateur — et vaut `null` lorsque la tache n'a jamais ete synchronisee.
 *
 * Une reponse `alreadyAbsent` est une reussite : il n'y a plus rien a ce chemin,
 * ce qui est exactement le resultat recherche.
 */
export function deleteTaskDocument(
  repositoryPath: string,
  taskCode: string,
  expectedRevision: string | null,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<DeleteTaskDocumentSuccess>> {
  const payload: DeleteTaskDocumentRequest = { repositoryPath, taskCode, expectedRevision };

  return postAuthenticated(
    "/repositories/tasks/delete-document",
    "tasks/delete-document",
    payload,
    isDeleteTaskDocumentSuccess,
    (value) => value as DeleteTaskDocumentSuccess,
    options,
  );
}

/**
 * Verifie qu'un repository est pret a recevoir une execution Claude Code.
 *
 * Strictement en lecture : cette route ne modifie rien, ne touche pas au reseau,
 * et ne consomme aucun quota Claude — elle se contente d'interroger Git et de
 * demander sa version a l'executable.
 */
export function claudePreflight(
  repositoryPath: string,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<ClaudePreflightSuccess>> {
  const payload: ClaudePreflightRequest = { repositoryPath };

  return postAuthenticated(
    "/claude/preflight",
    "claude/preflight",
    payload,
    isClaudePreflightSuccess,
    (value) => value as ClaudePreflightSuccess,
    options,
  );
}

/**
 * Lance une execution Claude Code.
 *
 * Le runner repond `202` sans attendre la fin du processus : c'est ce qui permet
 * a l'utilisateur de fermer son navigateur sans interrompre l'execution.
 *
 * Rien de ce que le navigateur envoie n'atteint cette fonction : le prompt est
 * regenere cote serveur, les commandes sont relues en base, et `repositoryPath`
 * vient du projet.
 */
export function startClaudeRun(
  request: StartClaudeRunRequest,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<{ startedAt: string }>> {
  return postAuthenticated(
    "/claude/runs/start",
    "claude/runs/start",
    request,
    isStartClaudeRunSuccess,
    (value) => ({ startedAt: (value as { run: { startedAt: string } }).run.startedAt }),
    options,
    202,
  );
}

/**
 * Interroge l'etat d'une execution.
 *
 * Appelee uniquement depuis le serveur : le navigateur passe par un Route
 * Handler de Next.js, jamais directement par le runner — le jeton ne doit pas
 * quitter le serveur.
 */
export function fetchClaudeRunStatus(
  runId: string,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<ClaudeRunSnapshot>> {
  const payload: ClaudeRunStatusRequest = { runId };

  return postAuthenticated(
    "/claude/runs/status",
    "claude/runs/status",
    payload,
    isClaudeRunStatusSuccess,
    (value) => (value as { run: ClaudeRunSnapshot }).run,
    options,
  );
}

/**
 * Lit les evenements publics d'une execution, apres un curseur.
 *
 * Appelee uniquement depuis le serveur, comme tout le reste de ce module : le
 * navigateur passe par le flux SSE de Next.js. Les evenements retournes ont ete
 * normalises et nettoyes par le runner ; le contrat partage les revalide un a
 * un avant qu'ils n'atteignent quoi que ce soit.
 */
export function fetchClaudeRunEvents(
  runId: string,
  afterSequence: number,
  limit: number = RUN_EVENT_LIMITS.maxBatch,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<ClaudeRunEventsSuccess>> {
  const payload: ClaudeRunEventsRequest = { runId, afterSequence, limit };

  return postAuthenticated(
    "/claude/runs/events",
    "claude/runs/events",
    payload,
    isClaudeRunEventsSuccess,
    (value) => value as ClaudeRunEventsSuccess,
    options,
  );
}

/**
 * Demande l'arret d'une execution active.
 *
 * Le corps ne porte qu'un identifiant d'execution. Aucun identifiant de
 * processus, aucun signal, aucun delai, aucune option de forcage : ce que le
 * navigateur peut declencher se limite a « arrete ce run », et le runner decide
 * seul de la maniere.
 *
 * Le runner repond `202` sans attendre la mort du processus.
 */
export function cancelClaudeRun(
  runId: string,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<ClaudeRunCancelSuccess["run"]>> {
  const payload: ClaudeRunCancelRequest = { runId };

  return postAuthenticated(
    "/claude/runs/cancel",
    "claude/runs/cancel",
    payload,
    isClaudeRunCancelSuccess,
    (value) => (value as ClaudeRunCancelSuccess).run,
    options,
    202,
  );
}

/**
 * Cree le document Markdown d'une tache.
 *
 * Le web n'envoie **aucun chemin** : il envoie le code de la tache, et c'est le
 * runner qui compose `tasks/<code>.md`. Le dossier `tasks/` est cree par le
 * runner s'il manque — seule creation de dossier de tout NOX.
 *
 * Comme pour un document ordinaire, la reponse est un `201` accompagne du
 * document relu, revision comprise : l'appelant n'a pas de second aller-retour
 * a faire pour connaitre l'etat reel du fichier.
 */
export function createTaskDocument(
  repositoryPath: string,
  taskCode: string,
  content: string,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<ProjectDocumentContent>> {
  const payload: CreateTaskDocumentRequest = { repositoryPath, taskCode, content };

  return postAuthenticated(
    "/repositories/tasks/create-document",
    "tasks/create-document",
    payload,
    isCreateTaskDocumentSuccess,
    (value) => (value as { document: ProjectDocumentContent }).document,
    options,
    201,
  );
}
