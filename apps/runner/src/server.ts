/**
 * Construction du serveur HTTP du runner.
 *
 * `createRunnerServer` retourne un serveur qui n'ecoute pas encore : les tests
 * l'ouvrent sur le port 0 (attribue par le systeme) et n'ont donc jamais besoin
 * du port 4310. Le demarrage reel est la seule responsabilite d'`index.ts`.
 *
 * Ce fichier ne fait que quatre choses par requete : authentifier, lire et
 * valider le corps, appeler la fonction metier, traduire le resultat en reponse.
 * Toute la logique Git et fichiers vit dans `repositories/`.
 *
 * Les dependances externes sont injectees par parametre : pas de conteneur
 * d'injection, juste des valeurs par defaut remplacables.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  NOX_VERSION,
  RUNNER_ERROR,
  RUNNER_SERVICE_NAME,
  RUN_STATUS,
  parseClaudeCorrectionPreflightRequest,
  parseClaudePreflightRequest,
  parseClaudeRunCancelRequest,
  parseClaudeRunEventsRequest,
  parseClaudeRunReviewRequest,
  parseClaudeRunStatusRequest,
  parseDeliveryCommitRequest,
  parseDeliveryInspectRequest,
  parseDeliveryPushRequest,
  parseCreateProjectDocumentRequest,
  parseCreateTaskDocumentRequest,
  parseDeleteProjectDocumentRequest,
  parseDeleteProjectDocumentsRequest,
  parseDeleteTaskDocumentRequest,
  parseInspectRepositoryRequest,
  parseListProjectDocumentsRequest,
  parseReadProjectDocumentRequest,
  parseResolveRepositoryRequest,
  parseRunValidationRequest,
  parseTrackedStateRequest,
  parseStartClaudeRunRequest,
  parseUpdateProjectDocumentRequest,
  type ClaudeCorrectionPreflightSuccess,
  type ClaudePreflightSuccess,
  type ClaudeRunCancelSuccess,
  type ClaudeRunEventsSuccess,
  type ClaudeRunReviewSuccess,
  type ClaudeRunStatusSuccess,
  type DeliveryCommitSuccess,
  type DeliveryPolicy,
  type DeliveryInspectSuccess,
  type DeliveryPushSuccess,
  type CreateProjectDocumentSuccess,
  type CreateTaskDocumentSuccess,
  type DeleteProjectDocumentSuccess,
  type DeleteProjectDocumentsSuccess,
  type ProjectTaskArtifact,
  type DeleteTaskDocumentSuccess,
  type InspectRepositorySuccess,
  type ListProjectDocumentsSuccess,
  type ReadProjectDocumentSuccess,
  type ResolveRepositorySuccess,
  type RunnerHealthResponse,
  type StartClaudeRunSuccess,
  type UpdateProjectDocumentSuccess,
} from "@nox/shared";

import type { RunnerConfig } from "./config.ts";
import { isAuthorized } from "./http/auth.ts";
import { MAX_DOCUMENT_BODY_BYTES, readJsonBody } from "./http/body.ts";
import { sendJson, sendMethodNotAllowed, sendRunnerError } from "./http/responses.ts";
import {
  createDocument,
  type CreateDocumentResult,
} from "./repositories/documents/create-document.ts";
import { readTrackedState, runRepositoryValidation } from "./repositories/run-validation.ts";
import {
  commitDelivery,
  inspectDelivery,
  pushDelivery,
  type DeliveryCommitResult,
  type DeliveryInspectResult,
  type DeliveryPushResult,
} from "./repositories/git-delivery.ts";
import {
  deleteDocument,
  type DeleteDocumentResult,
} from "./repositories/documents/delete-document.ts";
import { listDocuments, type ListDocumentsResult } from "./repositories/documents/list-documents.ts";
import { readDocument, type ReadDocumentResult } from "./repositories/documents/read-document.ts";
import {
  updateDocument,
  type UpdateDocumentResult,
} from "./repositories/documents/update-document.ts";
import {
  inspectRepository,
  type InspectRepositoryResult,
} from "./repositories/inspect-repository.ts";
import { resolveRepository, type ResolveRepositoryResult } from "./repositories/resolve-repository.ts";
import {
  createTaskDocument,
  type CreateTaskDocumentResult,
} from "./repositories/tasks/create-task-document.ts";
import {
  deleteTaskDocument,
  type DeleteTaskDocumentResult,
} from "./repositories/tasks/delete-task-document.ts";
import {
  deleteProjectTaskDocuments,
  type DeleteProjectDocumentsResult,
} from "./repositories/tasks/delete-project-documents.ts";
import { cancelClaudeRun, type CancelRunResult } from "./claude/cancel.ts";
import {
  runCorrectionPreflight,
  type CorrectionPreflightRequest,
  type CorrectionPreflightResult,
} from "./claude/correction-preflight.ts";
import { runPreflight, type PreflightResult } from "./claude/preflight.ts";
import { ClaudeRunRegistry } from "./claude/registry.ts";
import { startClaudeRun, type StartRunRequest, type StartRunResult } from "./claude/runs.ts";
import { deriveFingerprintKey } from "./repositories/workspace-fingerprint.ts";

/** Fonctions remplacables dans les tests. */
export type RunnerDependencies = {
  resolveRepository?: (repositoryPath: string) => Promise<ResolveRepositoryResult>;
  inspectRepository?: (repositoryPath: string) => Promise<InspectRepositoryResult>;
  listDocuments?: (repositoryPath: string) => Promise<ListDocumentsResult>;
  readDocument?: (repositoryPath: string, documentPath: string) => Promise<ReadDocumentResult>;
  updateDocument?: (
    repositoryPath: string,
    documentPath: string,
    content: string,
    expectedRevision: string,
  ) => Promise<UpdateDocumentResult>;
  createDocument?: (
    repositoryPath: string,
    documentPath: string,
    content: string,
  ) => Promise<CreateDocumentResult>;
  deleteDocument?: (
    repositoryPath: string,
    documentPath: string,
    expectedRevision: string,
  ) => Promise<DeleteDocumentResult>;
  createTaskDocument?: (
    repositoryPath: string,
    taskCode: string,
    content: string,
  ) => Promise<CreateTaskDocumentResult>;
  deleteTaskDocument?: (
    repositoryPath: string,
    taskCode: string,
    expectedRevision: string | null,
  ) => Promise<DeleteTaskDocumentResult>;
  deleteProjectTaskDocuments?: (
    repositoryPath: string,
    artifacts: readonly ProjectTaskArtifact[],
  ) => Promise<DeleteProjectDocumentsResult>;
  /**
   * Livraison Git : les trois seules ecritures Git que NOX sache faire.
   *
   * Injectables comme le reste, mais **jamais** remplacees en production :
   * la politique qui les autorise vit cote web, et la verification qui les
   * conditionne vit dans le module, pas ici.
   */
  inspectDelivery?: (
    repositoryPath: string,
    trailer: string | null,
  ) => Promise<DeliveryInspectResult>;
  commitDelivery?: (
    request: Parameters<typeof commitDelivery>[0],
  ) => Promise<DeliveryCommitResult>;
  pushDelivery?: (
    request: Parameters<typeof pushDelivery>[0],
  ) => Promise<DeliveryPushResult>;
  claudePreflight?: (
    repositoryPath: string,
    deliveryPolicy: DeliveryPolicy,
  ) => Promise<PreflightResult>;
  claudeCorrectionPreflight?: (
    request: CorrectionPreflightRequest,
  ) => Promise<CorrectionPreflightResult>;
  startClaudeRun?: (request: StartRunRequest) => Promise<StartRunResult>;
  cancelClaudeRun?: (runId: string) => CancelRunResult;
  /**
   * Registre des executions.
   *
   * Injectable pour que les tests disposent d'une instance neuve : la contrainte
   * « un seul run actif » serait sinon partagee entre deux tests.
   */
  runRegistry?: ClaudeRunRegistry;
  /** Journalisation ; remplacee par une fonction muette dans les tests. */
  log?: (message: string) => void;
};

const HEALTH_ROUTE = "/health";
const RESOLVE_ROUTE = "/repositories/resolve";
const INSPECT_ROUTE = "/repositories/inspect";
const DOCUMENTS_LIST_ROUTE = "/repositories/documents/list";
const DOCUMENTS_READ_ROUTE = "/repositories/documents/read";
const DOCUMENTS_UPDATE_ROUTE = "/repositories/documents/update";
const DOCUMENTS_CREATE_ROUTE = "/repositories/documents/create";
const DOCUMENTS_DELETE_ROUTE = "/repositories/documents/delete";
const TASKS_CREATE_DOCUMENT_ROUTE = "/repositories/tasks/create-document";
const TASKS_DELETE_DOCUMENT_ROUTE = "/repositories/tasks/delete-document";
const TASKS_DELETE_PROJECT_DOCUMENTS_ROUTE = "/repositories/tasks/delete-project-documents";
const VALIDATIONS_RUN_ROUTE = "/repositories/validations/run";
const VALIDATIONS_STATE_ROUTE = "/repositories/validations/state";
const CLAUDE_PREFLIGHT_ROUTE = "/claude/preflight";
const CLAUDE_RUNS_START_ROUTE = "/claude/runs/start";
const CLAUDE_RUNS_STATUS_ROUTE = "/claude/runs/status";
const CLAUDE_RUNS_EVENTS_ROUTE = "/claude/runs/events";
const CLAUDE_RUNS_CANCEL_ROUTE = "/claude/runs/cancel";
const CLAUDE_RUNS_REVIEW_ROUTE = "/claude/runs/review";
const CLAUDE_CORRECTION_PREFLIGHT_ROUTE = "/claude/corrections/preflight";
const DELIVERY_INSPECT_ROUTE = "/repositories/delivery/inspect";
const DELIVERY_COMMIT_ROUTE = "/repositories/delivery/commit";
const DELIVERY_PUSH_ROUTE = "/repositories/delivery/push";

function requestPathname(request: IncomingMessage): string {
  // La base est fictive : seul le chemin est exploite, jamais l'hote annonce.
  return new URL(request.url ?? "/", "http://runner.invalid").pathname.replace(/\/+$/, "") || "/";
}

/** Identifiant court, suffisant pour relier une ligne de log a une reponse. */
function newRequestId(): string {
  return randomUUID().slice(0, 8);
}

function handleHealth(response: ServerResponse, requestId: string): void {
  const payload: RunnerHealthResponse = {
    service: RUNNER_SERVICE_NAME,
    status: "ok",
    version: NOX_VERSION,
  };
  sendJson(response, 200, payload, requestId);
}

/**
 * Authentifie la requete, lit son corps JSON et le valide.
 *
 * Retourne `null` lorsqu'une reponse d'erreur a deja ete envoyee : l'appelant
 * n'a plus rien a faire. Cette forme evite de repeter le meme preambule sur
 * chacune des routes sensibles.
 */
async function readAuthenticatedBody<TRequest>(
  request: IncomingMessage,
  response: ServerResponse,
  config: RunnerConfig,
  requestId: string,
  route: string,
  log: (message: string) => void,
  parse: (value: unknown) => TRequest | null,
  maxBytes?: number,
): Promise<TRequest | null> {
  if (!isAuthorized(request.headers.authorization, config.token)) {
    // Aucune distinction entre en-tete absent, schema errone et jeton faux :
    // la reponse ne doit rien apprendre a un appelant non autorise.
    log(`[${RUNNER_SERVICE_NAME}] ${requestId} 401 ${route}`);
    sendRunnerError(response, RUNNER_ERROR.UNAUTHORIZED, requestId);
    return null;
  }

  const body = await readJsonBody(request, maxBytes === undefined ? {} : { maxBytes });
  if (!body.ok) {
    log(`[${RUNNER_SERVICE_NAME}] ${requestId} corps rejete : ${body.code}`);
    sendRunnerError(response, body.code, requestId);
    return null;
  }

  const parsed = parse(body.value);
  if (parsed === null) {
    sendRunnerError(response, RUNNER_ERROR.INVALID_REQUEST, requestId);
    return null;
  }

  return parsed;
}

/**
 * Cree le serveur HTTP du runner.
 *
 * Le serveur retourne n'ecoute pas : c'est a l'appelant de faire `listen`.
 */
export function createRunnerServer(
  config: RunnerConfig,
  dependencies: RunnerDependencies = {},
): Server {
  const resolve =
    dependencies.resolveRepository ?? ((repositoryPath: string) => resolveRepository(repositoryPath));
  const inspect =
    dependencies.inspectRepository ??
    ((repositoryPath: string) => inspectRepository(repositoryPath));
  const list = dependencies.listDocuments ?? ((repositoryPath: string) => listDocuments(repositoryPath));
  const read =
    dependencies.readDocument ??
    ((repositoryPath: string, documentPath: string) => readDocument(repositoryPath, documentPath));
  const update =
    dependencies.updateDocument ??
    ((repositoryPath: string, documentPath: string, content: string, expectedRevision: string) =>
      updateDocument(repositoryPath, documentPath, content, expectedRevision));
  const create =
    dependencies.createDocument ??
    ((repositoryPath: string, documentPath: string, content: string) =>
      createDocument(repositoryPath, documentPath, content));
  const remove =
    dependencies.deleteDocument ??
    ((repositoryPath: string, documentPath: string, expectedRevision: string) =>
      deleteDocument(repositoryPath, documentPath, expectedRevision));
  const createTask =
    dependencies.createTaskDocument ??
    ((repositoryPath: string, taskCode: string, content: string) =>
      createTaskDocument(repositoryPath, taskCode, content));
  const removeTask =
    dependencies.deleteTaskDocument ??
    ((repositoryPath: string, taskCode: string, expectedRevision: string | null) =>
      deleteTaskDocument(repositoryPath, taskCode, expectedRevision));
  const removeProjectTasks =
    dependencies.deleteProjectTaskDocuments ??
    ((repositoryPath: string, artifacts: readonly ProjectTaskArtifact[]) =>
      deleteProjectTaskDocuments(repositoryPath, artifacts));
  // Le registre appartient au serveur : il vit aussi longtemps que le processus,
  // et pas une requete de plus.
  const registry = dependencies.runRegistry ?? new ClaudeRunRegistry();
  const preflight =
    dependencies.claudePreflight ??
    ((repositoryPath: string, deliveryPolicy: DeliveryPolicy) =>
      runPreflight(repositoryPath, config.claude, { deliveryPolicy }));
  // La cle est derivee **une fois**, au demarrage : le jeton lui-meme ne circule
  // ensuite plus nulle part, et aucun module de calcul d'empreinte ne le voit.
  const fingerprintKey = deriveFingerprintKey(config.token);
  const correctionPreflight =
    dependencies.claudeCorrectionPreflight ??
    ((request: CorrectionPreflightRequest) =>
      runCorrectionPreflight(request, config.claude, { fingerprintKey }));
  const inspectForDelivery =
    dependencies.inspectDelivery ??
    ((repositoryPath: string, trailer: string | null) =>
      inspectDelivery(repositoryPath, trailer, { fingerprintKey }));
  const commitForDelivery =
    dependencies.commitDelivery ??
    ((request: Parameters<typeof commitDelivery>[0]) =>
      commitDelivery(request, { fingerprintKey }));
  const pushForDelivery =
    dependencies.pushDelivery ??
    ((request: Parameters<typeof pushDelivery>[0]) =>
      pushDelivery(request, { fingerprintKey }));
  const startRun =
    dependencies.startClaudeRun ??
    ((request: StartRunRequest) =>
      startClaudeRun(request, config.claude, registry, { fingerprintKey }));
  const cancelRun =
    dependencies.cancelClaudeRun ?? ((runId: string) => cancelClaudeRun(runId, registry));
  const log = dependencies.log ?? ((message: string) => { console.log(message); });

  /** Journalise un refus metier : le code seul, jamais le chemin recu. */
  const logRefusal = (requestId: string, route: string, code: string): void => {
    log(`[${RUNNER_SERVICE_NAME}] ${requestId} ${route} refuse : ${code}`);
  };

  return createServer((request, response) => {
    const requestId = newRequestId();
    const method = request.method ?? "GET";
    const pathname = requestPathname(request);

    const route = async (): Promise<void> => {
      if (pathname === HEALTH_ROUTE) {
        if (method !== "GET" && method !== "HEAD") {
          sendMethodNotAllowed(response, ["GET", "HEAD"], requestId);
          return;
        }
        handleHealth(response, requestId);
        return;
      }

      if (pathname === RESOLVE_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, RESOLVE_ROUTE, log, parseResolveRepositoryRequest,
        );
        if (parsed === null) {
          return;
        }

        const result = await resolve(parsed.repositoryPath);
        if (!result.ok) {
          logRefusal(requestId, RESOLVE_ROUTE, result.code);
          sendRunnerError(response, result.code, requestId);
          return;
        }

        const payload: ResolveRepositorySuccess = {
          ok: true,
          repository: { canonicalPath: result.canonicalPath },
        };
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === INSPECT_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, INSPECT_ROUTE, log,
          parseInspectRepositoryRequest,
        );
        if (parsed === null) {
          return;
        }

        const result = await inspect(parsed.repositoryPath);
        if (!result.ok) {
          logRefusal(requestId, INSPECT_ROUTE, result.code);
          sendRunnerError(response, result.code, requestId);
          return;
        }

        const payload: InspectRepositorySuccess = { ok: true, inspection: result.inspection };
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === DOCUMENTS_LIST_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, DOCUMENTS_LIST_ROUTE, log,
          parseListProjectDocumentsRequest,
        );
        if (parsed === null) {
          return;
        }

        const result = await list(parsed.repositoryPath);
        if (!result.ok) {
          logRefusal(requestId, DOCUMENTS_LIST_ROUTE, result.code);
          sendRunnerError(response, result.code, requestId);
          return;
        }

        const payload: ListProjectDocumentsSuccess = { ok: true, documents: result.documents };
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === DOCUMENTS_READ_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, DOCUMENTS_READ_ROUTE, log,
          parseReadProjectDocumentRequest,
        );
        if (parsed === null) {
          return;
        }

        const result = await read(parsed.repositoryPath, parsed.documentPath);
        if (!result.ok) {
          logRefusal(requestId, DOCUMENTS_READ_ROUTE, result.code);
          sendRunnerError(response, result.code, requestId);
          return;
        }

        const payload: ReadProjectDocumentSuccess = { ok: true, document: result.document };
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === DOCUMENTS_UPDATE_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        // Seule route dont le corps transporte un document entier : sa limite est
        // plus haute, mais elle reste une limite.
        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, DOCUMENTS_UPDATE_ROUTE, log,
          parseUpdateProjectDocumentRequest, MAX_DOCUMENT_BODY_BYTES,
        );
        if (parsed === null) {
          return;
        }

        const result = await update(
          parsed.repositoryPath,
          parsed.documentPath,
          parsed.content,
          parsed.expectedRevision,
        );
        if (!result.ok) {
          logRefusal(requestId, DOCUMENTS_UPDATE_ROUTE, result.code);
          sendRunnerError(response, result.code, requestId);
          return;
        }

        const payload: UpdateProjectDocumentSuccess = { ok: true, document: result.document };
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === DOCUMENTS_CREATE_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, DOCUMENTS_CREATE_ROUTE, log,
          parseCreateProjectDocumentRequest, MAX_DOCUMENT_BODY_BYTES,
        );
        if (parsed === null) {
          return;
        }

        const result = await create(parsed.repositoryPath, parsed.documentPath, parsed.content);
        if (!result.ok) {
          logRefusal(requestId, DOCUMENTS_CREATE_ROUTE, result.code);
          sendRunnerError(response, result.code, requestId);
          return;
        }

        // `201` et non `200` : une ressource vient d'apparaitre. Aucun en-tete
        // `Location` n'accompagne la reponse — aucune route du runner n'adresse
        // un document par URL, et en inventer une laisserait croire a un `GET`
        // qui n'existe pas. Le chemin relatif du document est dans le corps.
        const payload: CreateProjectDocumentSuccess = { ok: true, document: result.document };
        sendJson(response, 201, payload, requestId);
        return;
      }

      if (pathname === DOCUMENTS_DELETE_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        // Corps minuscule — deux chemins relatifs et une empreinte : la limite
        // par defaut suffit largement, aucun contenu ne transite.
        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, DOCUMENTS_DELETE_ROUTE, log,
          parseDeleteProjectDocumentRequest,
        );
        if (parsed === null) {
          return;
        }

        const result = await remove(
          parsed.repositoryPath,
          parsed.documentPath,
          parsed.expectedRevision,
        );
        if (!result.ok) {
          logRefusal(requestId, DOCUMENTS_DELETE_ROUTE, result.code);
          sendRunnerError(response, result.code, requestId);
          return;
        }

        // `200` et non `204` : la reponse a un corps, et il porte le chemin
        // relatif reellement supprime ainsi que sa revision. Un `204` obligerait
        // l'appelant a faire confiance a ce qu'il avait envoye.
        const payload: DeleteProjectDocumentSuccess = {
          ok: true,
          deleted: { path: result.path, revision: result.revision },
        };
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === TASKS_CREATE_DOCUMENT_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, TASKS_CREATE_DOCUMENT_ROUTE, log,
          parseCreateTaskDocumentRequest, MAX_DOCUMENT_BODY_BYTES,
        );
        if (parsed === null) {
          return;
        }

        // Le corps ne porte aucun chemin : le runner compose lui-meme
        // `tasks/<code>.md` a partir du code, apres en avoir verifie la forme.
        const result = await createTask(parsed.repositoryPath, parsed.taskCode, parsed.content);
        if (!result.ok) {
          logRefusal(requestId, TASKS_CREATE_DOCUMENT_ROUTE, result.code);
          sendRunnerError(response, result.code, requestId);
          return;
        }

        const payload: CreateTaskDocumentSuccess = { ok: true, document: result.document };
        sendJson(response, 201, payload, requestId);
        return;
      }

      if (pathname === TASKS_DELETE_DOCUMENT_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, TASKS_DELETE_DOCUMENT_ROUTE, log,
          parseDeleteTaskDocumentRequest,
        );
        if (parsed === null) {
          return;
        }

        // Comme a la creation, le corps ne porte aucun chemin : le runner
        // compose `tasks/<code>.md` lui-meme. C'est ce qui rend cette route sure
        // malgre le droit exceptionnel qu'elle detient — celui de supprimer un
        // fichier que la route generique protege.
        const result = await removeTask(
          parsed.repositoryPath,
          parsed.taskCode,
          parsed.expectedRevision,
        );
        if (!result.ok) {
          logRefusal(requestId, TASKS_DELETE_DOCUMENT_ROUTE, result.code);
          sendRunnerError(response, result.code, requestId);
          return;
        }

        const payload: DeleteTaskDocumentSuccess = {
          ok: true,
          deleted: result.deleted,
          alreadyAbsent: result.alreadyAbsent,
          path: result.path,
        };
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === TASKS_DELETE_PROJECT_DOCUMENTS_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, TASKS_DELETE_PROJECT_DOCUMENTS_ROUTE, log,
          parseDeleteProjectDocumentsRequest,
        );
        if (parsed === null) {
          return;
        }

        // Comme les deux routes voisines, le corps ne porte aucun chemin : le
        // runner compose `tasks/<code>.md` a partir de codes que le serveur web
        // a lus en base. Le sort de chaque document est rapporte ligne par
        // ligne — un refus n'interrompt pas le lot, il le condamne cote web.
        const result = await removeProjectTasks(parsed.repositoryPath, parsed.artifacts);
        if (!result.ok) {
          logRefusal(requestId, TASKS_DELETE_PROJECT_DOCUMENTS_ROUTE, result.code);
          sendRunnerError(response, result.code, requestId);
          return;
        }

        const payload: DeleteProjectDocumentsSuccess = { ok: true, documents: result.documents };
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === VALIDATIONS_STATE_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, VALIDATIONS_STATE_ROUTE, log,
          parseTrackedStateRequest,
        );
        if (parsed === null) {
          return;
        }

        // Strictement en lecture. L'empreinte reste la seule chose qui decide
        // d'une completion automatique ; les chemins l'accompagnent pour nommer
        // ce qui a bouge dans un contexte de correction. Ils sont **relatifs** au
        // repository et bornes : aucun chemin absolu ne sort d'ici.
        const state = await readTrackedState(parsed.repositoryPath);
        if (!state.ok) {
          logRefusal(requestId, VALIDATIONS_STATE_ROUTE, state.code);
          sendRunnerError(response, state.code, requestId);
          return;
        }

        sendJson(
          response,
          200,
          { ok: true, digest: state.digest, files: state.files },
          requestId,
        );
        return;
      }

      if (pathname === VALIDATIONS_RUN_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, VALIDATIONS_RUN_ROUTE, log,
          parseRunValidationRequest,
        );
        if (parsed === null) {
          return;
        }

        // Le corps ne porte que deux chaines : un repository et une commande.
        // Aucun `cwd`, aucun environnement, aucun delai, aucun vecteur
        // d'arguments deja decoupe. La politique est **rejouee ici** — le
        // serveur web l'a deja verifiee, et cette frontiere ne s'y fie pas :
        // c'est elle qui touche reellement la machine.
        const outcome = await runRepositoryValidation(parsed.repositoryPath, parsed.command);
        if (!outcome.ok) {
          logRefusal(requestId, VALIDATIONS_RUN_ROUTE, outcome.code);
          sendRunnerError(response, outcome.code, requestId);
          return;
        }

        sendJson(response, 200, outcome.result, requestId);
        return;
      }

      if (pathname === DELIVERY_INSPECT_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, DELIVERY_INSPECT_ROUTE, log,
          parseDeliveryInspectRequest,
        );
        if (parsed === null) {
          return;
        }

        // Strictement en lecture : aucune commande de cette route ne cree, ne
        // modifie, ne supprime ni ne pousse quoi que ce soit. C'est ce qui
        // permet a une page de livraison de l'appeler sans qu'un
        // rafraichissement produise une ecriture Git.
        const inspected = await inspectForDelivery(parsed.repositoryPath, parsed.trailer ?? null);
        if (!inspected.ok) {
          logRefusal(requestId, DELIVERY_INSPECT_ROUTE, inspected.code);
          sendRunnerError(response, inspected.code, requestId);
          return;
        }

        const payload: DeliveryInspectSuccess = { ok: true, inspection: inspected.inspection };
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === DELIVERY_COMMIT_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, DELIVERY_COMMIT_ROUTE, log,
          parseDeliveryCommitRequest,
          MAX_DOCUMENT_BODY_BYTES,
        );
        if (parsed === null) {
          return;
        }

        // Le corps porte des **faits attendus**, jamais des arguments Git : une
        // branche, un `HEAD`, une empreinte, des chemins relatifs, un message.
        // Le runner en deduit lui-meme les commandes, et refuse des la premiere
        // divergence avec ce qu'il lit sur le disque.
        const committed = await commitForDelivery(parsed);
        if (!committed.ok) {
          // Le detail technique reste dans les logs du runner : la reponse ne
          // porte qu'un code, comme toutes les erreurs du contrat.
          log(`[${RUNNER_SERVICE_NAME}] ${requestId} ${DELIVERY_COMMIT_ROUTE} refuse : ${committed.code} — ${committed.detail}`);
          sendRunnerError(response, committed.code, requestId);
          return;
        }

        const payload: DeliveryCommitSuccess = committed.value;
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === DELIVERY_PUSH_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, DELIVERY_PUSH_ROUTE, log,
          parseDeliveryPushRequest,
        );
        if (parsed === null) {
          return;
        }

        // Ni remote, ni URL, ni refspec dans le corps : la destination est lue
        // dans la configuration de la branche. Aucun appelant ne peut faire
        // pousser NOX ailleurs que la ou la branche pointe deja.
        const pushed = await pushForDelivery(parsed);
        if (!pushed.ok) {
          log(`[${RUNNER_SERVICE_NAME}] ${requestId} ${DELIVERY_PUSH_ROUTE} refuse : ${pushed.code} — ${pushed.detail}`);
          sendRunnerError(response, pushed.code, requestId);
          return;
        }

        const payload: DeliveryPushSuccess = pushed.value;
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === CLAUDE_PREFLIGHT_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, CLAUDE_PREFLIGHT_ROUTE, log,
          parseClaudePreflightRequest,
        );
        if (parsed === null) {
          return;
        }

        // La politique vient du corps, deja ramenee a `MANUAL` par le parseur
        // si elle etait absente ou illisible. Le runner la rejoue lui-meme : il
        // ne fait pas confiance au web, mais il n'a aucun moyen de la relire.
        const result = await preflight(parsed.repositoryPath, parsed.deliveryPolicy);
        if (!result.ok) {
          logRefusal(requestId, CLAUDE_PREFLIGHT_ROUTE, result.code);
          sendRunnerError(response, result.code, requestId);
          return;
        }

        // Aucun chemin absolu dans la reponse : branche, upstream et `HEAD`
        // suffisent a l'affichage, et le chemin est deja connu de l'appelant.
        const payload: ClaudePreflightSuccess = {
          ok: true,
          claude: { available: true, version: result.claudeVersion },
          git: result.git,
        };
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === CLAUDE_CORRECTION_PREFLIGHT_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, CLAUDE_CORRECTION_PREFLIGHT_ROUTE, log,
          parseClaudeCorrectionPreflightRequest,
        );
        if (parsed === null) {
          return;
        }

        const result = await correctionPreflight(parsed);
        if (!result.ok) {
          logRefusal(requestId, CLAUDE_CORRECTION_PREFLIGHT_ROUTE, result.code);
          sendRunnerError(response, result.code, requestId);
          return;
        }

        // Comme le preflight initial : ni chemin absolu, ni empreinte dans la
        // reponse. L'appelant apprend que l'etat correspond, pas a quoi il
        // correspond.
        const payload: ClaudeCorrectionPreflightSuccess = {
          ok: true,
          claude: { available: true, version: result.claudeVersion },
          git: result.git,
        };
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === CLAUDE_RUNS_START_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        // Le corps transporte un prompt entier : meme limite que les routes
        // d'ecriture de documents.
        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, CLAUDE_RUNS_START_ROUTE, log,
          parseStartClaudeRunRequest, MAX_DOCUMENT_BODY_BYTES,
        );
        if (parsed === null) {
          return;
        }

        const result = await startRun(parsed);
        if (!result.ok) {
          logRefusal(requestId, CLAUDE_RUNS_START_ROUTE, result.code);
          sendRunnerError(response, result.code, requestId);
          return;
        }

        // `202` et non `200` : la demande est acceptee, le travail commence,
        // mais rien n'est termine. Le resultat s'obtient par interrogation.
        const payload: StartClaudeRunSuccess = {
          ok: true,
          run: {
            runId: parsed.runId,
            status: RUN_STATUS.RUNNING,
            startedAt: result.startedAt.toISOString(),
          },
        };
        sendJson(response, 202, payload, requestId);
        return;
      }

      if (pathname === CLAUDE_RUNS_STATUS_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, CLAUDE_RUNS_STATUS_ROUTE, log,
          parseClaudeRunStatusRequest,
        );
        if (parsed === null) {
          return;
        }

        const snapshot = registry.snapshot(parsed.runId);
        if (snapshot === null) {
          // Cas normal apres un redemarrage du runner : le web en tirera la
          // conclusion qui s'impose, sans que NOX pretende connaitre l'issue.
          logRefusal(requestId, CLAUDE_RUNS_STATUS_ROUTE, RUNNER_ERROR.CLAUDE_RUN_NOT_FOUND);
          sendRunnerError(response, RUNNER_ERROR.CLAUDE_RUN_NOT_FOUND, requestId);
          return;
        }

        const payload: ClaudeRunStatusSuccess = { ok: true, run: snapshot };
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === CLAUDE_RUNS_EVENTS_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, CLAUDE_RUNS_EVENTS_ROUTE, log,
          parseClaudeRunEventsRequest,
        );
        if (parsed === null) {
          return;
        }

        // Aucune attente : la route rend ce qu'elle a, tout de suite. C'est le
        // flux SSE du web qui espace les appels — un long polling ici
        // immobiliserait une connexion du runner par onglet ouvert.
        const page = registry.getEvents(parsed.runId, parsed.afterSequence, parsed.limit);
        if (page === null) {
          logRefusal(requestId, CLAUDE_RUNS_EVENTS_ROUTE, RUNNER_ERROR.CLAUDE_RUN_NOT_FOUND);
          sendRunnerError(response, RUNNER_ERROR.CLAUDE_RUN_NOT_FOUND, requestId);
          return;
        }

        // Les evenements ont ete normalises et nettoyes a leur creation : rien
        // de brut ne peut arriver jusqu'ici.
        const payload: ClaudeRunEventsSuccess = { ok: true, ...page };
        sendJson(response, 200, payload, requestId);
        return;
      }

      if (pathname === CLAUDE_RUNS_CANCEL_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, CLAUDE_RUNS_CANCEL_ROUTE, log,
          parseClaudeRunCancelRequest,
        );
        if (parsed === null) {
          return;
        }

        // Le corps ne porte qu'un `runId`. Aucun identifiant de processus, aucun
        // signal, aucun delai, aucune option de forcage : ce que le navigateur
        // peut designer se limite a une execution que le runner connait deja.
        const result = cancelRun(parsed.runId);
        if (!result.ok) {
          logRefusal(requestId, CLAUDE_RUNS_CANCEL_ROUTE, result.code);
          sendRunnerError(response, result.code, requestId);
          return;
        }

        // `202` : la demande est acceptee et l'arret engage, mais le processus
        // dispose encore de son delai de grace. Repondre `200` laisserait croire
        // qu'il est deja mort.
        const payload: ClaudeRunCancelSuccess = {
          ok: true,
          run: {
            runId: parsed.runId,
            status: RUN_STATUS.CANCELLING,
            cancellationRequestedAt: result.requestedAt.toISOString(),
          },
        };
        sendJson(response, 202, payload, requestId);
        return;
      }

      if (pathname === CLAUDE_RUNS_REVIEW_ROUTE) {
        if (method !== "POST") {
          sendMethodNotAllowed(response, ["POST"], requestId);
          return;
        }

        const parsed = await readAuthenticatedBody(
          request, response, config, requestId, CLAUDE_RUNS_REVIEW_ROUTE, log,
          parseClaudeRunReviewRequest,
        );
        if (parsed === null) {
          return;
        }

        // Cette route ne calcule rien : elle relit un instantane deja capture au
        // moment ou l'execution s'est terminee. C'est ce qui l'empeche de
        // devenir un explorateur Git — aucun chemin, aucun commit et aucun
        // repository ne peuvent lui etre demandes, seulement une execution
        // qu'elle connait deja.
        const review = registry.review(parsed.runId);

        if (review === null) {
          // Deux causes possibles, un seul comportement : l'execution est
          // inconnue, ou elle n'a pas encore fini. La distinction se lit dans
          // l'instantane d'etat, deja disponible par ailleurs.
          const code = registry.has(parsed.runId)
            ? RUNNER_ERROR.CLAUDE_REVIEW_NOT_READY
            : RUNNER_ERROR.CLAUDE_RUN_NOT_FOUND;
          logRefusal(requestId, CLAUDE_RUNS_REVIEW_ROUTE, code);
          sendRunnerError(response, code, requestId);
          return;
        }

        if (!review.ok) {
          logRefusal(requestId, CLAUDE_RUNS_REVIEW_ROUTE, review.code);
          sendRunnerError(response, review.code, requestId);
          return;
        }

        const payload: ClaudeRunReviewSuccess = { ok: true, review: review.snapshot };
        sendJson(response, 200, payload, requestId);
        return;
      }

      sendRunnerError(response, RUNNER_ERROR.ROUTE_NOT_FOUND, requestId);
    };

    route().catch((error: unknown) => {
      // Le detail technique reste dans les logs du runner ; la reponse ne porte
      // qu'un code, jamais une trace d'exception.
      log(`[${RUNNER_SERVICE_NAME}] ${requestId} erreur interne : ${String(error)}`);
      if (!response.headersSent) {
        sendRunnerError(response, RUNNER_ERROR.INTERNAL_ERROR, requestId);
      } else {
        response.end();
      }
    });
  });
}
