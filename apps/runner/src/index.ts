/**
 * Point d'entree du runner local NOX.
 *
 * Responsabilites : charger la configuration, la valider, demarrer le serveur,
 * et l'arreter proprement. Toute la logique HTTP vit dans `server.ts`.
 */

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { NOX_VERSION, RUNNER_SERVICE_NAME, RUN_STATUS, type RunStatus } from "@nox/shared";

import { loadRunnerConfig } from "./config.ts";
import { createRunnerServer } from "./server.ts";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/**
 * Charge le `.env` de la racine du monorepo s'il existe.
 * `process.loadEnvFile` est fourni par Node : aucune dependance necessaire.
 */
function loadRepositoryEnvFile(): void {
  const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  try {
    process.loadEnvFile(path.resolve(packageDir, "..", "..", ".env"));
  } catch {
    // Aucun `.env` : les variables du shell font foi.
  }
}

loadRepositoryEnvFile();

const configuration = loadRunnerConfig(process.env);

if (!configuration.ok) {
  console.error(`[${RUNNER_SERVICE_NAME}] Configuration invalide.`);
  console.error(`  ${configuration.message}`);
  process.exit(1);
}

const { host, port } = configuration.config;

/**
 * Etat de cycle de vie du runner, exprime avec le vocabulaire partage des
 * executions. Il n'est pas expose par l'API : il sert de base au suivi des
 * executions qui sera ajoute dans une tache ulterieure.
 */
let runnerState: RunStatus = RUN_STATUS.QUEUED;

const server = createRunnerServer(configuration.config);

server.on("error", (error: NodeJS.ErrnoException) => {
  runnerState = RUN_STATUS.FAILED;
  if (error.code === "EADDRINUSE") {
    console.error(
      `[${RUNNER_SERVICE_NAME}] Le port ${String(port)} est deja utilise. ` +
        "Definir NOX_RUNNER_PORT pour en changer.",
    );
  } else {
    console.error(`[${RUNNER_SERVICE_NAME}] Erreur du serveur HTTP :`, error);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  runnerState = RUN_STATUS.RUNNING;
  // Le jeton n'est jamais journalise, meme partiellement.
  console.log(`[${RUNNER_SERVICE_NAME}] v${NOX_VERSION} - etat ${runnerState}`);
  console.log(`[${RUNNER_SERVICE_NAME}] En ecoute sur http://${host}:${String(port)}`);
  console.log(`[${RUNNER_SERVICE_NAME}] Sonde de sante : http://${host}:${String(port)}/health`);
  console.log(`[${RUNNER_SERVICE_NAME}] Routes sensibles protegees par NOX_RUNNER_TOKEN.`);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  runnerState = RUN_STATUS.CANCELLED;
  console.log(`[${RUNNER_SERVICE_NAME}] ${signal} recu, arret du serveur...`);

  server.close((error) => {
    if (error) {
      console.error(`[${RUNNER_SERVICE_NAME}] Arret incomplet :`, error);
      process.exitCode = 1;
      return;
    }
    console.log(`[${RUNNER_SERVICE_NAME}] Serveur arrete proprement.`);
  });

  server.closeIdleConnections();
}

for (const signal of SHUTDOWN_SIGNALS) {
  process.on(signal, shutdown);
}
