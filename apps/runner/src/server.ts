/**
 * Construction du serveur HTTP du runner.
 *
 * `createRunnerServer` retourne un serveur qui n'ecoute pas encore : les tests
 * l'ouvrent sur le port 0 (attribue par le systeme) et n'ont donc jamais besoin
 * du port 4310. Le demarrage reel est la seule responsabilite d'`index.ts`.
 *
 * Les dependances externes (Git) sont injectees par parametre : pas de
 * conteneur d'injection, juste une valeur par defaut remplacable.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import {
  NOX_VERSION,
  RUNNER_ERROR,
  RUNNER_SERVICE_NAME,
  parseResolveRepositoryRequest,
  type ResolveRepositorySuccess,
  type RunnerHealthResponse,
} from "@nox/shared";

import type { RunnerConfig } from "./config.ts";
import { isAuthorized } from "./http/auth.ts";
import { readJsonBody } from "./http/body.ts";
import { sendJson, sendMethodNotAllowed, sendRunnerError } from "./http/responses.ts";
import { resolveRepository, type ResolveRepositoryResult } from "./repositories/resolve-repository.ts";

/** Fonctions remplacables dans les tests. */
export type RunnerDependencies = {
  resolveRepository?: (repositoryPath: string) => Promise<ResolveRepositoryResult>;
  /** Journalisation ; remplacee par une fonction muette dans les tests. */
  log?: (message: string) => void;
};

const HEALTH_ROUTE = "/health";
const RESOLVE_ROUTE = "/repositories/resolve";

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

async function handleResolveRepository(
  request: IncomingMessage,
  response: ServerResponse,
  config: RunnerConfig,
  requestId: string,
  resolve: (repositoryPath: string) => Promise<ResolveRepositoryResult>,
  log: (message: string) => void,
): Promise<void> {
  if (!isAuthorized(request.headers.authorization, config.token)) {
    // Aucune distinction entre en-tete absent, schema errone et jeton faux :
    // la reponse ne doit rien apprendre a un appelant non autorise.
    log(`[${RUNNER_SERVICE_NAME}] ${requestId} 401 ${RESOLVE_ROUTE}`);
    sendRunnerError(response, RUNNER_ERROR.UNAUTHORIZED, requestId);
    return;
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    log(`[${RUNNER_SERVICE_NAME}] ${requestId} corps rejete : ${body.code}`);
    sendRunnerError(response, body.code, requestId);
    return;
  }

  const parsed = parseResolveRepositoryRequest(body.value);
  if (parsed === null) {
    sendRunnerError(response, RUNNER_ERROR.INVALID_REQUEST, requestId);
    return;
  }

  const result = await resolve(parsed.repositoryPath);
  if (!result.ok) {
    // Le code seul est journalise : le chemin recu n'apparait pas dans les logs.
    log(`[${RUNNER_SERVICE_NAME}] ${requestId} resolution refusee : ${result.code}`);
    sendRunnerError(response, result.code, requestId);
    return;
  }

  const payload: ResolveRepositorySuccess = {
    ok: true,
    repository: { canonicalPath: result.canonicalPath },
  };
  sendJson(response, 200, payload, requestId);
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
  const log = dependencies.log ?? ((message: string) => { console.log(message); });

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
        await handleResolveRepository(request, response, config, requestId, resolve, log);
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
