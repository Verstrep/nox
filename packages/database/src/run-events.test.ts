/**
 * Tests de la persistance des evenements.
 *
 * Base temporaire, isolee, detruite a la fin : la base de developpement n'est
 * jamais ouverte par ces tests. Le package compile est importe volontairement —
 * c'est l'artefact que le web et le runner consomment reellement.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  InvalidRunEventRecordError,
  appendRunEvents,
  countRunEvents,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  completeRun,
  getLastRunEventSequence,
  getRunById,
  getTaskById,
  listRunEvents,
  markRunCancelling,
  toDatabaseFilePath,
  toSqliteUrl,
  updateRunFromRunner,
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

async function applyMigrations(target: string): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const sqlite = new DatabaseSync(target);
  try {
    for (const directory of directories) {
      sqlite.exec(await readFile(path.join(MIGRATIONS_DIR, directory, "migration.sql"), "utf8"));
    }
  } finally {
    sqlite.close();
  }
}

/** Cree un projet, une tache et une execution neuve. */
async function newRun(): Promise<{ runId: string; taskId: string }> {
  counter += 1;
  const suffix = String(counter).padStart(12, "0");

  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });

  const task = await createTask(db, {
    projectId: project.id,
    title: "Une tache",
    objective: "Un objectif.",
    context: null,
    outOfScope: null,
    priority: "MEDIUM",
    acceptanceCriteria: ["Un critere."],
    documentReferences: [],
    validationCommands: [],
  });
  assert.ok(task !== null);

  const run = await createRun(db, {
    taskId: task.id,
    prompt: "Prompt.",
    promptSha256: "a".repeat(64),
    runnerRunId: `3f2504e0-4f89-41d3-9a0c-${suffix}`,
  });
  assert.ok(run !== null);

  return { runId: run.id, taskId: task.id };
}

function event(sequence: number, overrides: Record<string, unknown> = {}) {
  return {
    sequence,
    kind: "TOOL_STARTED" as const,
    occurredAt: "2026-08-07T10:00:00.000Z",
    label: `Reading page-${String(sequence)}.md`,
    detail: null,
    toolName: "Read",
    isError: false,
    ...overrides,
  };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-run-events-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));

  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("appendRunEvents", () => {
  it("insere des evenements dans l'ordre", async () => {
    const { runId } = await newRun();
    await appendRunEvents(db, runId, [event(1), event(2), event(3)]);

    const stored = await listRunEvents(db, runId);
    assert.deepEqual(stored.map((entry) => entry.sequence), [1, 2, 3]);
  });

  it("restitue l'ordre meme si le lot arrive melange", async () => {
    const { runId } = await newRun();
    await appendRunEvents(db, runId, [event(3), event(1), event(2)]);

    const stored = await listRunEvents(db, runId);
    assert.deepEqual(stored.map((entry) => entry.sequence), [1, 2, 3]);
  });

  it("est idempotente : le meme lot deux fois ne duplique rien", async () => {
    const { runId } = await newRun();

    assert.equal(await appendRunEvents(db, runId, [event(1), event(2)]), 2);
    assert.equal(await appendRunEvents(db, runId, [event(1), event(2)]), 0);
    assert.equal(await countRunEvents(db, runId), 2);
  });

  it("n'insere que la partie nouvelle d'un lot recouvrant", async () => {
    const { runId } = await newRun();
    await appendRunEvents(db, runId, [event(1), event(2)]);

    assert.equal(await appendRunEvents(db, runId, [event(2), event(3)]), 1);
    assert.equal(await countRunEvents(db, runId), 3);
  });

  it("isole les evenements par execution", async () => {
    const first = await newRun();
    const second = await newRun();

    await appendRunEvents(db, first.runId, [event(1)]);
    await appendRunEvents(db, second.runId, [event(1)]);

    assert.equal(await countRunEvents(db, first.runId), 1);
    assert.equal(await countRunEvents(db, second.runId), 1);
  });

  it("ecarte un evenement au numero invalide plutot que d'en inventer un", async () => {
    const { runId } = await newRun();
    await appendRunEvents(db, runId, [event(0), event(-1), event(1)]);

    assert.deepEqual((await listRunEvents(db, runId)).map((e) => e.sequence), [1]);
  });

  it("borne un libelle et un detail trop longs", async () => {
    const { runId } = await newRun();
    await appendRunEvents(db, runId, [
      event(1, { label: "L".repeat(5_000), detail: "D".repeat(20_000) }),
    ]);

    const [stored] = await listRunEvents(db, runId);
    assert.equal((stored?.label.length ?? 0) <= 200, true);
    assert.equal((stored?.detail?.length ?? 0) <= 4_096, true);
  });

  it("accepte un lot vide sans rien ecrire", async () => {
    const { runId } = await newRun();
    assert.equal(await appendRunEvents(db, runId, []), 0);
  });

  it("tolere une date illisible sans perdre le lot", async () => {
    const { runId } = await newRun();
    await appendRunEvents(db, runId, [event(1, { occurredAt: "pas une date" })]);

    assert.equal(await countRunEvents(db, runId), 1);
  });

  it("conserve les caracteres Unicode", async () => {
    const { runId } = await newRun();
    await appendRunEvents(db, runId, [event(1, { label: "Éléphant 🐘 你好" })]);

    assert.equal((await listRunEvents(db, runId))[0]?.label, "Éléphant 🐘 你好");
  });
});

describe("listRunEvents et curseur", () => {
  it("ne rend que les evenements posterieurs au curseur", async () => {
    const { runId } = await newRun();
    await appendRunEvents(db, runId, [event(1), event(2), event(3), event(4)]);

    const after = await listRunEvents(db, runId, 2);
    assert.deepEqual(after.map((entry) => entry.sequence), [3, 4]);
  });

  it("borne le nombre d'evenements retournes", async () => {
    const { runId } = await newRun();
    await appendRunEvents(db, runId, [event(1), event(2), event(3)]);

    assert.equal((await listRunEvents(db, runId, 0, 2)).length, 2);
  });

  it("rend le dernier numero connu", async () => {
    const { runId } = await newRun();
    assert.equal(await getLastRunEventSequence(db, runId), 0);

    await appendRunEvents(db, runId, [event(1), event(2), event(7)]);
    assert.equal(await getLastRunEventSequence(db, runId), 7);
  });

  it("refuse une ligne dont le type n'existe plus", async () => {
    const { runId } = await newRun();
    await appendRunEvents(db, runId, [event(1)]);

    // Simule une base modifiee hors de NOX.
    await db.runEvent.updateMany({ where: { runId }, data: { kind: "TYPE_INCONNU" } });

    await assert.rejects(() => listRunEvents(db, runId), InvalidRunEventRecordError);
  });
});

describe("markRunCancelling", () => {
  it("passe une execution active en CANCELLING", async () => {
    const { runId } = await newRun();
    const requestedAt = new Date("2026-08-07T11:00:00.000Z");

    const updated = await markRunCancelling(db, runId, requestedAt);
    assert.equal(updated?.status, "CANCELLING");
    assert.equal(updated?.cancellationRequestedAt, requestedAt.toISOString());
  });

  it("garde la date de la premiere demande", async () => {
    const { runId } = await newRun();
    const first = new Date("2026-08-07T11:00:00.000Z");

    await markRunCancelling(db, runId, first);
    const second = await markRunCancelling(db, runId, new Date("2026-08-07T12:00:00.000Z"));

    assert.equal(second?.cancellationRequestedAt, first.toISOString());
  });

  it("n'a aucun effet sur une execution deja terminee", async () => {
    const { runId } = await newRun();
    await completeRun(db, runId, { resultText: "Fini." });

    const updated = await markRunCancelling(db, runId, new Date());
    assert.equal(updated?.status, "COMPLETED");
    assert.equal(updated?.cancellationRequestedAt, null);
  });

  it("retourne null pour une execution inconnue", async () => {
    assert.equal(await markRunCancelling(db, "inexistant", new Date()), null);
  });
});

describe("cycle d'une annulation", () => {
  it("laisse la tache en RUNNING pendant CANCELLING", async () => {
    const { runId, taskId } = await newRun();
    await updateRunFromRunner(db, runId, { status: "RUNNING" });
    await db.task.update({ where: { id: taskId }, data: { status: "RUNNING" } });

    await updateRunFromRunner(db, runId, { status: "CANCELLING" });

    assert.equal((await getRunById(db, runId))?.status, "CANCELLING");
    assert.equal((await getTaskById(db, taskId))?.status, "RUNNING");
  });

  it("bloque la tache une fois l'execution annulee", async () => {
    const { runId, taskId } = await newRun();
    await db.task.update({ where: { id: taskId }, data: { status: "RUNNING" } });

    await updateRunFromRunner(db, runId, { status: "CANCELLING" });
    await updateRunFromRunner(db, runId, { status: "CANCELLED" });

    assert.equal((await getRunById(db, runId))?.status, "CANCELLED");
    assert.equal((await getTaskById(db, taskId))?.status, "BLOCKED");
  });

  it("ne fait pas revenir un etat final a CANCELLING", async () => {
    const { runId } = await newRun();
    await updateRunFromRunner(db, runId, { status: "COMPLETED" });
    await updateRunFromRunner(db, runId, { status: "CANCELLING" });

    assert.equal((await getRunById(db, runId))?.status, "COMPLETED");
  });

  it("ne transforme pas une execution terminee en annulee", async () => {
    const { runId } = await newRun();
    await updateRunFromRunner(db, runId, { status: "COMPLETED" });
    await updateRunFromRunner(db, runId, { status: "CANCELLED" });

    assert.equal((await getRunById(db, runId))?.status, "COMPLETED");
  });

  it("ne transforme pas une execution annulee en terminee", async () => {
    const { runId } = await newRun();
    await updateRunFromRunner(db, runId, { status: "CANCELLED" });
    await updateRunFromRunner(db, runId, { status: "COMPLETED" });

    assert.equal((await getRunById(db, runId))?.status, "CANCELLED");
  });

  it("ne change pas deux fois le statut de la tache", async () => {
    const { runId, taskId } = await newRun();
    await db.task.update({ where: { id: taskId }, data: { status: "RUNNING" } });

    await updateRunFromRunner(db, runId, { status: "CANCELLED" });
    // La tache est passee a BLOCKED ; l'utilisateur la remet a READY.
    await db.task.update({ where: { id: taskId }, data: { status: "READY" } });
    await updateRunFromRunner(db, runId, { status: "CANCELLED" });

    assert.equal((await getTaskById(db, taskId))?.status, "READY");
  });

  it("conserve les evenements d'une execution annulee", async () => {
    const { runId } = await newRun();
    await appendRunEvents(db, runId, [event(1), event(2)]);
    await updateRunFromRunner(db, runId, { status: "CANCELLED" });

    assert.equal(await countRunEvents(db, runId), 2);
  });
});
