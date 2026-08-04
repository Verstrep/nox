/**
 * Runner local NOX.
 *
 * Perimetre de TASK-001 : un serveur HTTP minimal, base uniquement sur les
 * modules natifs de Node.js, exposant `GET /health`.
 *
 * Le runner n'execute aucune commande systeme et ne connait ni Claude Code ni
 * Git a ce stade.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import process from "node:process";
import { NOX_VERSION, RUN_STATUS, type RunStatus } from "@nox/shared";

const SERVICE_NAME = "nox-runner";
const DEFAULT_PORT = 4310;
const DEFAULT_HOST = "127.0.0.1";
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/**
 * Etat de cycle de vie du runner, exprime avec le vocabulaire partage des
 * executions. Il n'est pas encore expose par l'API : il sert de base au suivi
 * des executions qui sera ajoute dans une tache ulterieure.
 */
let runnerState: RunStatus = RUN_STATUS.QUEUED;

function readPort(rawPort: string | undefined): number {
  if (rawPort === undefined || rawPort.trim() === "") {
    return DEFAULT_PORT;
  }

  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.warn(
      `[${SERVICE_NAME}] NOX_RUNNER_PORT invalide ("${rawPort}"), utilisation du port ${DEFAULT_PORT}.`,
    );
    return DEFAULT_PORT;
  }

  return port;
}

function readHost(rawHost: string | undefined): string {
  const host = rawHost?.trim();
  return host === undefined || host === "" ? DEFAULT_HOST : host;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  const method = request.method ?? "GET";
  const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? DEFAULT_HOST}`)
    .pathname;

  if (pathname === "/health" && (method === "GET" || method === "HEAD")) {
    sendJson(response, 200, {
      service: SERVICE_NAME,
      status: "ok",
      version: NOX_VERSION,
    });
    return;
  }

  sendJson(response, 404, {
    service: SERVICE_NAME,
    status: "not_found",
    error: `Route inconnue : ${method} ${pathname}`,
  });
}

const port = readPort(process.env["NOX_RUNNER_PORT"]);
const host = readHost(process.env["NOX_RUNNER_HOST"]);
const server = createServer(handleRequest);

server.on("error", (error: NodeJS.ErrnoException) => {
  runnerState = RUN_STATUS.FAILED;
  if (error.code === "EADDRINUSE") {
    console.error(
      `[${SERVICE_NAME}] Le port ${port} est deja utilise. Definir NOX_RUNNER_PORT pour en changer.`,
    );
  } else {
    console.error(`[${SERVICE_NAME}] Erreur du serveur HTTP :`, error);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  runnerState = RUN_STATUS.RUNNING;
  console.log(`[${SERVICE_NAME}] v${NOX_VERSION} - etat ${runnerState}`);
  console.log(`[${SERVICE_NAME}] En ecoute sur http://${host}:${port}`);
  console.log(`[${SERVICE_NAME}] Sonde de sante : http://${host}:${port}/health`);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  runnerState = RUN_STATUS.CANCELLED;
  console.log(`[${SERVICE_NAME}] ${signal} recu, arret du serveur...`);

  server.close((error) => {
    if (error) {
      console.error(`[${SERVICE_NAME}] Arret incomplet :`, error);
      process.exitCode = 1;
      return;
    }
    console.log(`[${SERVICE_NAME}] Serveur arrete proprement.`);
  });

  server.closeIdleConnections();
}

for (const signal of SHUTDOWN_SIGNALS) {
  process.on(signal, shutdown);
}
