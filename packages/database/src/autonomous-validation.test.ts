/**
 * Lots de validations autonomes : reservation, tentatives, conclusion.
 *
 * ## Ce que ce fichier prouve
 *
 * Que la reservation est un **verrou persistant**, pas une verification suivie
 * d'une ecriture : deux appels simultanes n'ouvrent qu'un lot, et la garantie
 * survivrait a un redemarrage comme a deux processus.
 *
 * Qu'une reprise n'existe que sur une panne. Une commande qui a reellement
 * echoue ne changera pas d'avis — le code n'a pas bouge — et proposer de la
 * relancer inviterait a jouer aux des jusqu'a obtenir le resultat voulu.
 *
 * Et qu'un lot conclu l'est une fois : la seconde conclusion ne reecrit rien.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { TASK_PRIORITY } from "@nox/shared";

import {
  completeValidationBatch,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  getLatestValidationBatch,
  listValidationBatches,
  recordValidationResult,
  reserveValidationBatch,
  startValidationBatch,
  summarizeBatchStatus,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
} from "../dist/index.js";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma",
  "migrations",
);

let workspace: string;
let db: DatabaseClient;
let counter = 0;

async function applyMigrations(file: string): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const sqlite = new DatabaseSync(file);
  try {
    for (const directory of directories) {
      sqlite.exec(await readFile(path.join(MIGRATIONS_DIR, directory, "migration.sql"), "utf8"));
    }
  } finally {
    sqlite.close();
  }
}

/** Une execution terminee, prete a recevoir un lot. */
async function newRun(): Promise<string> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  const task = await createTask(db, {
    projectId: project.id,
    title: `Tache ${String(counter)}`,
    objective: "Objectif.",
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: ["Verifiable"],
    documentReferences: [],
    validationCommands: [],
  });
  assert.ok(task !== null);

  const run = await createRun(db, {
    taskId: task.id,
    projectId: project.id,
    prompt: "Prompt de test.",
    promptSha256: "a".repeat(64),
    runnerRunId: `11111111-1111-4111-8111-${String(counter).padStart(12, "0")}`,
  });
  assert.ok(run.ok);
  await db.run.update({ where: { id: run.run.id }, data: { status: "COMPLETED" } });
  return run.run.id;
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-autonomous-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("reservation d'un lot", () => {
  it("ouvre une premiere tentative", async () => {
    const runId = await newRun();
    const reserved = await reserveValidationBatch(db, runId, { retry: false });
    assert.ok(reserved.ok);
    assert.equal(reserved.attempt, 1);
  });

  it("refuse une seconde reservation tant que la premiere tourne", async () => {
    const runId = await newRun();
    const first = await reserveValidationBatch(db, runId, { retry: false });
    assert.ok(first.ok);

    const second = await reserveValidationBatch(db, runId, { retry: false });
    assert.equal(second.ok, false);
    assert.equal(second.ok === false && second.reason, "already_active");
    assert.equal(await db.autonomousValidationBatch.count({ where: { runId } }), 1);
  });

  it("n'ouvre qu'un lot pour trois reservations simultanees", async () => {
    // La garantie est l'index unique `(runId, attempt)`, pas une lecture suivie
    // d'une ecriture : c'est la seule forme qui resiste a deux requetes en
    // parallele, et la seule qui survivrait a deux processus.
    const runId = await newRun();
    const results = await Promise.all([
      reserveValidationBatch(db, runId, { retry: false }),
      reserveValidationBatch(db, runId, { retry: false }),
      reserveValidationBatch(db, runId, { retry: false }),
    ]);

    assert.equal(results.filter((entry) => entry.ok).length, 1);
    assert.equal(await db.autonomousValidationBatch.count({ where: { runId } }), 1);
  });

  it("refuse une reservation pour une execution inconnue", async () => {
    const reserved = await reserveValidationBatch(db, "execution-inexistante", { retry: false });
    assert.equal(reserved.ok, false);
    assert.equal(reserved.ok === false && reserved.reason, "run_not_found");
  });
});

describe("reprise", () => {
  it("est possible apres une panne", async () => {
    const runId = await newRun();
    const first = await reserveValidationBatch(db, runId, { retry: false });
    assert.ok(first.ok);
    await completeValidationBatch(db, first.batchId, {
      status: "ERROR",
      trackedStateAfter: null,
      errorCode: "VALIDATION_UNAVAILABLE",
      errorMessage: "runner injoignable",
    });

    const retry = await reserveValidationBatch(db, runId, { retry: true });
    assert.ok(retry.ok);
    assert.equal(retry.attempt, 2);
    assert.equal(await db.autonomousValidationBatch.count({ where: { runId } }), 2);
  });

  it("est refusee apres un echec reel", async () => {
    // Le code n'a pas bouge : relancer ne changerait que le hasard.
    const runId = await newRun();
    const first = await reserveValidationBatch(db, runId, { retry: false });
    assert.ok(first.ok);
    await completeValidationBatch(db, first.batchId, {
      status: "FAILED",
      trackedStateAfter: "b".repeat(64),
    });

    const retry = await reserveValidationBatch(db, runId, { retry: true });
    assert.equal(retry.ok, false);
    assert.equal(retry.ok === false && retry.reason, "not_retryable");
  });

  it("est refusee apres une reussite", async () => {
    const runId = await newRun();
    const first = await reserveValidationBatch(db, runId, { retry: false });
    assert.ok(first.ok);
    await completeValidationBatch(db, first.batchId, {
      status: "PASSED",
      trackedStateAfter: "b".repeat(64),
    });

    const retry = await reserveValidationBatch(db, runId, { retry: true });
    assert.equal(retry.ok, false);
    assert.equal(retry.ok === false && retry.reason, "not_retryable");
  });

  it("n'est pas implicite : sans `retry`, un lot conclu bloque", async () => {
    const runId = await newRun();
    const first = await reserveValidationBatch(db, runId, { retry: false });
    assert.ok(first.ok);
    await completeValidationBatch(db, first.batchId, {
      status: "ERROR",
      trackedStateAfter: null,
    });

    const again = await reserveValidationBatch(db, runId, { retry: false });
    assert.equal(again.ok, false);
    assert.equal(again.ok === false && again.reason, "already_done");
  });
});

describe("conclusion d'un lot", () => {
  it("enregistre ses resultats dans l'ordre", async () => {
    const runId = await newRun();
    const reserved = await reserveValidationBatch(db, runId, { retry: false });
    assert.ok(reserved.ok);
    await startValidationBatch(db, reserved.batchId, "a".repeat(64));

    for (const [position, command] of ["npm run test", "npm run lint"].entries()) {
      await recordValidationResult(db, reserved.batchId, {
        position,
        commandId: `cmd-${String(position)}`,
        command,
        status: "PASSED",
        exitCode: 0,
        durationMs: 100,
        stdout: "ok",
        stdoutTruncated: false,
        stderr: "",
        stderrTruncated: false,
      });
    }
    await completeValidationBatch(db, reserved.batchId, {
      status: "PASSED",
      trackedStateAfter: "a".repeat(64),
    });

    const batch = await getLatestValidationBatch(db, runId);
    assert.ok(batch !== null);
    assert.equal(batch.status, "PASSED");
    assert.deepEqual(
      batch.results.map((result) => result.command),
      ["npm run test", "npm run lint"],
    );
    assert.equal(batch.trackedStateBefore, "a".repeat(64));
    assert.equal(batch.trackedStateAfter, "a".repeat(64));
  });

  it("ne se conclut qu'une fois", async () => {
    const runId = await newRun();
    const reserved = await reserveValidationBatch(db, runId, { retry: false });
    assert.ok(reserved.ok);

    await completeValidationBatch(db, reserved.batchId, {
      status: "PASSED",
      trackedStateAfter: "a".repeat(64),
    });
    await completeValidationBatch(db, reserved.batchId, {
      status: "FAILED",
      trackedStateAfter: "z".repeat(64),
    });

    const batch = await getLatestValidationBatch(db, runId);
    // La conclusion est conditionnelle a `PENDING`/`RUNNING` : le premier etat
    // final enregistre gagne, comme pour les executions.
    assert.equal(batch?.status, "PASSED");
  });

  it("rend les tentatives de la plus recente a la plus ancienne", async () => {
    const runId = await newRun();
    const first = await reserveValidationBatch(db, runId, { retry: false });
    assert.ok(first.ok);
    await completeValidationBatch(db, first.batchId, {
      status: "ERROR",
      trackedStateAfter: null,
    });
    const second = await reserveValidationBatch(db, runId, { retry: true });
    assert.ok(second.ok);

    const batches = await listValidationBatches(db, runId);
    assert.deepEqual(
      batches.map((batch) => batch.attempt),
      [2, 1],
    );
  });
});

describe("resume d'un lot", () => {
  it("fait primer la panne sur l'echec, et l'echec sur la reussite", () => {
    // « Je n'ai pas pu regarder » n'est pas « j'ai regarde et c'est faux » :
    // l'ordre de precedence est ce qui empeche de confondre les deux.
    assert.equal(summarizeBatchStatus(["PASSED", "PASSED"]), "PASSED");
    assert.equal(summarizeBatchStatus(["PASSED", "FAILED"]), "FAILED");
    assert.equal(summarizeBatchStatus(["FAILED", "ERROR"]), "ERROR");
    assert.equal(summarizeBatchStatus(["PASSED", "TIMED_OUT"]), "FAILED");
    assert.equal(summarizeBatchStatus([]), "PASSED");
  });
});
