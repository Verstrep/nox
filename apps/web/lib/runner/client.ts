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
  isClaudeCorrectionPreflightSuccess,
  isClaudePreflightSuccess,
  isRunValidationSuccess,
  isTrackedStateSuccess,
  isClaudeRunCancelSuccess,
  isClaudeRunEventsSuccess,
  isClaudeRunReviewSuccess,
  isClaudeRunStatusSuccess,
  isCreateProjectDocumentSuccess,
  isCreateTaskDocumentSuccess,
  isDeleteProjectDocumentSuccess,
  isDeleteProjectDocumentsSuccess,
  isDeleteTaskDocumentSuccess,
  isInspectRepositorySuccess,
  isListProjectDocumentsSuccess,
  isStartClaudeRunSuccess,
  isReadProjectDocumentSuccess,
  isResolveRepositorySuccess,
  isRunnerErrorResponse,
  isDeliveryCommitSuccess,
  isDeliveryInspectSuccess,
  isDeliveryPushSuccess,
  isRunnerHealthResponse,
  isUpdateProjectDocumentSuccess,
  type ClaudeCorrectionPreflightRequest,
  type ClaudeCorrectionPreflightSuccess,
  type ClaudePreflightRequest,
  type ClaudePreflightSuccess,
  type RunValidationRequest,
  type RunValidationSuccess,
  type TrackedStateRequest,
  type TrackedStateSuccess,
  type ClaudeRunCancelRequest,
  type ClaudeRunCancelSuccess,
  type ClaudeRunEventsRequest,
  type ClaudeRunEventsSuccess,
  type ClaudeRunReviewRequest,
  type ClaudeRunReviewSuccess,
  type ClaudeRunSnapshot,
  type ClaudeRunStatusRequest,
  type CreateProjectDocumentRequest,
  type CreateTaskDocumentRequest,
  type DeleteProjectDocumentRequest,
  type DeleteProjectDocumentSuccess,
  type DeleteProjectDocumentsRequest,
  type DeleteProjectDocumentsSuccess,
  type DeleteTaskDocumentRequest,
  type DeleteTaskDocumentSuccess,
  type DeliveryCommitRequest,
  type DeliveryCommitSuccess,
  type DeliveryInspectRequest,
  type DeliveryInspectSuccess,
  type DeliveryPushRequest,
  type DeliveryPushSuccess,
  type InspectRepositoryRequest,
  type RepositoryInspection,
  type ListProjectDocumentsRequest,
  type StartClaudeRunRequest,
  type ProjectDocumentContent,
  type ProjectDocumentSummary,
  type ReadProjectDocumentRequest,
  type ResolveRepositoryRequest,
  type RunReviewSnapshot,
  type ProjectTaskArtifact,
  type RunnerHealthResponse,
  type TaskArtifactReport,
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
 * Inspecte grossierement un repository, en lecture seule.
 *
 * Le runner rend des faits — manifestes reconnus, dossiers de code, documents
 * fondamentaux presents, nombre d'entrees — et aucun contenu de fichier. La
 * conclusion « ce repository porte deja une application » se calcule ici, cote
 * web, ou elle est pure et testable.
 *
 * Aucun chemin absolu ne figure dans la reponse : seuls des chemins relatifs.
 */
export function inspectRepository(
  repositoryPath: string,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<RepositoryInspection>> {
  const payload: InspectRepositoryRequest = { repositoryPath };

  return postAuthenticated(
    "/repositories/inspect",
    "repositories/inspect",
    payload,
    isInspectRepositorySuccess,
    (value) => (value as { inspection: RepositoryInspection }).inspection,
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
 * Retire les documents de taches d'un projet supprime de NOX.
 *
 * Le web n'envoie **aucun chemin** : il envoie des codes de taches et les
 * revisions enregistrees en base — l'ensemble est reconstruit cote serveur a
 * partir du projet, jamais recu du navigateur. Une tache dont le document n'a
 * jamais ete synchronise n'a pas de revision, donc pas d'artefact, donc
 * n'apparait pas dans cette requete.
 *
 * La reponse rapporte le sort de chaque document. Un `REFUSED` ne leve pas : il
 * remonte tel quel, et c'est l'appelant qui en fait un refus global.
 */
export function deleteProjectTaskDocuments(
  repositoryPath: string,
  artifacts: readonly ProjectTaskArtifact[],
  options: RunnerClientOptions = {},
): Promise<RunnerResult<TaskArtifactReport[]>> {
  const payload: DeleteProjectDocumentsRequest = {
    repositoryPath,
    artifacts: artifacts.map((artifact) => ({ ...artifact })),
  };

  return postAuthenticated(
    "/repositories/tasks/delete-project-documents",
    "tasks/delete-project-documents",
    payload,
    isDeleteProjectDocumentsSuccess,
    (value) => (value as DeleteProjectDocumentsSuccess).documents,
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
 * Verifie qu'une correction ciblee peut reprendre la session d'une execution.
 *
 * Le pendant de `claudePreflight` pour une reprise : il ne demande pas un
 * repository **propre**, mais un dossier de travail **identique** a celui qui a
 * ete relu. L'empreinte attendue est relue en base par le serveur ; elle ne
 * transite jamais par un formulaire, et la reponse ne la renvoie pas.
 */
export function claudeCorrectionPreflight(
  request: ClaudeCorrectionPreflightRequest,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<ClaudeCorrectionPreflightSuccess>> {
  return postAuthenticated(
    "/claude/corrections/preflight",
    "claude/corrections/preflight",
    request,
    isClaudeCorrectionPreflightSuccess,
    (value) => value as ClaudeCorrectionPreflightSuccess,
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
 * Relit l'instantane de review d'une execution terminee.
 *
 * Ne declenche aucun calcul : le runner a capture cet instantane au moment ou
 * l'execution est devenue finale, et se contente de le rendre. Appelee **une
 * seule fois** par execution, quand la base n'a pas encore de review — ensuite,
 * c'est SQLite qui fait foi, et le runner n'est plus interroge.
 *
 * Le corps ne porte qu'un identifiant d'execution : ni chemin de repository, ni
 * commit, ni chemin de fichier.
 */
export function fetchClaudeRunReview(
  runId: string,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<RunReviewSnapshot>> {
  const payload: ClaudeRunReviewRequest = { runId };

  return postAuthenticated(
    "/claude/runs/review",
    "claude/runs/review",
    payload,
    isClaudeRunReviewSuccess,
    (value) => (value as ClaudeRunReviewSuccess).review,
    options,
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

/**
 * Fait executer une commande de validation par le runner.
 *
 * Le corps ne porte que deux chaines : le chemin du repository — relu en base a
 * partir de l'identifiant du projet, jamais recu d'un formulaire — et la
 * commande, deja verifiee par la politique cote serveur. Ni environnement, ni
 * delai, ni vecteur d'arguments : le runner decoupe et reverifie lui-meme.
 *
 * Le navigateur n'appelle jamais cette fonction. Comme tout le client runner,
 * elle vit cote serveur et le jeton ne la quitte pas.
 */
export function runValidationCommand(
  request: RunValidationRequest,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<RunValidationSuccess>> {
  return postAuthenticated(
    "/repositories/validations/run",
    "repositories/validations/run",
    request,
    isRunValidationSuccess,
    (value) => value as RunValidationSuccess,
    options,
  );
}

/**
 * Releve l'empreinte de l'etat suivi d'un repository.
 *
 * Appelee avant et apres un lot de validations. Deux empreintes identiques
 * disent que la preuve n'a pas touche au travail qu'elle evaluait ; deux
 * empreintes differentes refusent l'auto-completion.
 */
export function readRepositoryTrackedState(
  repositoryPath: string,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<TrackedStateSuccess>> {
  const payload: TrackedStateRequest = { repositoryPath };

  return postAuthenticated(
    "/repositories/validations/state",
    "repositories/validations/state",
    payload,
    isTrackedStateSuccess,
    (value) => value as TrackedStateSuccess,
    options,
  );
}

/**
 * Lit l'etat Git d'un repository pour une livraison.
 *
 * Strictement en lecture : aucune commande de cette route ne cree, ne modifie,
 * ne supprime ni ne pousse quoi que ce soit, et aucune ne touche au reseau.
 * C'est ce qui autorise une page de livraison a l'appeler sans qu'un
 * rafraichissement produise une ecriture Git.
 */
export function inspectDelivery(
  request: DeliveryInspectRequest,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<DeliveryInspectSuccess>> {
  return postAuthenticated(
    "/repositories/delivery/inspect",
    "repositories/delivery/inspect",
    request,
    isDeliveryInspectSuccess,
    (value) => value as DeliveryInspectSuccess,
    options,
  );
}

/**
 * Prepare les chemins exacts d'un candidat valide, puis cree le commit.
 *
 * Le corps ne porte aucun argument Git : une branche attendue, un `HEAD`
 * attendu, une empreinte attendue, des chemins relatifs et un message deja
 * construit. Le runner en deduit lui-meme les commandes et refuse des la
 * premiere divergence avec ce qu'il lit sur le disque.
 *
 * Le navigateur n'appelle jamais cette fonction. Comme tout le client runner,
 * elle vit cote serveur et le jeton ne la quitte pas.
 */
export function commitDelivery(
  request: DeliveryCommitRequest,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<DeliveryCommitSuccess>> {
  return postAuthenticated(
    "/repositories/delivery/commit",
    "repositories/delivery/commit",
    request,
    isDeliveryCommitSuccess,
    (value) => value as DeliveryCommitSuccess,
    options,
  );
}

/**
 * Pousse la branche courante vers son upstream deja configure.
 *
 * Ni remote, ni URL, ni refspec dans le corps : la destination est lue par le
 * runner dans la configuration du repository. Aucun appelant — et surtout pas
 * le navigateur, qui n'atteint jamais cette route — ne peut designer ou NOX
 * pousse.
 */
export function pushDelivery(
  request: DeliveryPushRequest,
  options: RunnerClientOptions = {},
): Promise<RunnerResult<DeliveryPushSuccess>> {
  return postAuthenticated(
    "/repositories/delivery/push",
    "repositories/delivery/push",
    request,
    isDeliveryPushSuccess,
    (value) => value as DeliveryPushSuccess,
    options,
  );
}
