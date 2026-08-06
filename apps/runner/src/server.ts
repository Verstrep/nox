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
  parseCreateProjectDocumentRequest,
  parseCreateTaskDocumentRequest,
  parseListProjectDocumentsRequest,
  parseReadProjectDocumentRequest,
  parseResolveRepositoryRequest,
  parseUpdateProjectDocumentRequest,
  type CreateProjectDocumentSuccess,
  type CreateTaskDocumentSuccess,
  type ListProjectDocumentsSuccess,
  type ReadProjectDocumentSuccess,
  type ResolveRepositorySuccess,
  type RunnerHealthResponse,
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
import { listDocuments, type ListDocumentsResult } from "./repositories/documents/list-documents.ts";
import { readDocument, type ReadDocumentResult } from "./repositories/documents/read-document.ts";
import {
  updateDocument,
  type UpdateDocumentResult,
} from "./repositories/documents/update-document.ts";
import { resolveRepository, type ResolveRepositoryResult } from "./repositories/resolve-repository.ts";
import {
  createTaskDocument,
  type CreateTaskDocumentResult,
} from "./repositories/tasks/create-task-document.ts";

/** Fonctions remplacables dans les tests. */
export type RunnerDependencies = {
  resolveRepository?: (repositoryPath: string) => Promise<ResolveRepositoryResult>;
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
  createTaskDocument?: (
    repositoryPath: string,
    taskCode: string,
    content: string,
  ) => Promise<CreateTaskDocumentResult>;
  /** Journalisation ; remplacee par une fonction muette dans les tests. */
  log?: (message: string) => void;
};

const HEALTH_ROUTE = "/health";
const RESOLVE_ROUTE = "/repositories/resolve";
const DOCUMENTS_LIST_ROUTE = "/repositories/documents/list";
const DOCUMENTS_READ_ROUTE = "/repositories/documents/read";
const DOCUMENTS_UPDATE_ROUTE = "/repositories/documents/update";
const DOCUMENTS_CREATE_ROUTE = "/repositories/documents/create";
const TASKS_CREATE_DOCUMENT_ROUTE = "/repositories/tasks/create-document";

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
  const createTask =
    dependencies.createTaskDocument ??
    ((repositoryPath: string, taskCode: string, content: string) =>
      createTaskDocument(repositoryPath, taskCode, content));
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
