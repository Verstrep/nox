import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  InvalidRunRecordError,
  blockRun,
  cancelTaskExecution,
  completeRun,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  failRun,
  getRunById,
  getTaskById,
  hasActiveRun,
  listRunsByTask,
  markRunRunning,
  startTaskExecution,
  toDatabaseFilePath,
  toSqliteUrl,
  updateRunFromRunner,
  updateTaskStatus,
  type DatabaseClient,
} from "../dist/index.js";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma",
  "migrations",
);

let workspace: string;
let databaseFile: string;
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

/** Cree un projet et une tache prete a etre lancee. */
async function newTask(): Promise<{ projectId: string; taskId: string }> {
  counter += 1;
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

  return { projectId: project.id, taskId: task.id };
}

let runIdCounter = 0;

function runInput(taskId: string) {
  runIdCounter += 1;
  const suffix = String(runIdCounter).padStart(12, "0");
  return {
    taskId,
    prompt: "Prompt d'execution.",
    promptSha256: "a".repeat(64),
    runnerRunId: `3f2504e0-4f89-41d3-9a0c-${suffix}`,
  };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-runs-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  databaseFile = toDatabaseFilePath(databaseUrl);

  await applyMigrations(databaseFile);
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("allocation des numeros d'execution", () => {
  it("attribue RUN-001 a la premiere execution d'une tache", async () => {
    const { taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));

    assert.equal(run?.code, "RUN-001");
    assert.equal(run?.status, "QUEUED");
  });

  it("incremente le numero a chaque execution", async () => {
    const { taskId } = await newTask();

    const first = await createRun(db, runInput(taskId));
    const second = await createRun(db, runInput(taskId));
    const third = await createRun(db, runInput(taskId));

    assert.deepEqual([first?.code, second?.code, third?.code], ["RUN-001", "RUN-002", "RUN-003"]);
  });

  it("n'attribue jamais deux fois le meme numero, meme en creation concurrente", async () => {
    const { taskId } = await newTask();

    const created = await Promise.all(
      Array.from({ length: 12 }, () => createRun(db, runInput(taskId))),
    );

    const codes = created.map((run) => run?.code);
    assert.equal(new Set(codes).size, codes.length, `codes en double : ${codes.join(", ")}`);
  });

  it("garde un compteur independant par tache", async () => {
    const first = await newTask();
    const second = await newTask();

    await createRun(db, runInput(first.taskId));
    await createRun(db, runInput(first.taskId));
    const other = await createRun(db, runInput(second.taskId));

    assert.equal(other?.code, "RUN-001");
  });

  it("refuse une tache inconnue sans lever", async () => {
    assert.equal(await createRun(db, runInput("tache-inexistante")), null);
  });

  it("liste les executions de la plus recente a la plus ancienne", async () => {
    const { taskId } = await newTask();
    await createRun(db, runInput(taskId));
    await createRun(db, runInput(taskId));
    await createRun(db, runInput(taskId));

    const runs = await listRunsByTask(db, taskId);
    assert.deepEqual(
      runs.map((run) => run.code),
      ["RUN-003", "RUN-002", "RUN-001"],
    );
  });
});

describe("cycle de vie d'une execution", () => {
  it("passe de QUEUED a RUNNING", async () => {
    const { taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);

    const started = await markRunRunning(db, run.id, new Date("2026-08-06T10:00:00.000Z"));

    assert.equal(started?.status, "RUNNING");
    assert.equal(started?.startedAt, "2026-08-06T10:00:00.000Z");
  });

  it("conserve la premiere heure de demarrage", async () => {
    const { taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);

    await markRunRunning(db, run.id, new Date("2026-08-06T10:00:00.000Z"));
    const again = await markRunRunning(db, run.id, new Date("2026-08-06T11:00:00.000Z"));

    assert.equal(again?.startedAt, "2026-08-06T10:00:00.000Z");
  });

  it("enregistre un resultat complet a la reussite", async () => {
    const { projectId, taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);

    await updateTaskStatus(db, taskId, projectId, "READY");
    await startTaskExecution(db, taskId);
    await markRunRunning(db, run.id, new Date());

    const finished = await completeRun(db, run.id, {
      resultText: "Compte rendu.",
      claudeSessionId: "session-123",
      durationMs: 42_000,
      durationApiMs: 30_000,
      numTurns: 7,
      reportedCostUsd: 0.1234,
      exitCode: 0,
      git: {
        branch: "main",
        upstream: "origin/main",
        headBefore: "abc",
        headAfter: "abc",
        diffStat: " 1 file changed",
        changedFiles: ["src/a.ts", "src/b.ts"],
      },
    });

    assert.equal(finished?.status, "COMPLETED");
    assert.equal(finished?.claude.resultText, "Compte rendu.");
    assert.equal(finished?.claude.sessionId, "session-123");
    assert.equal(finished?.claude.numTurns, 7);
    assert.equal(finished?.claude.reportedCostUsd, 0.1234);
    assert.deepEqual([...(finished?.git.changedFiles ?? [])], ["src/a.ts", "src/b.ts"]);
    assert.ok(finished?.finishedAt !== null);

    // La tache suit : une reussite mene a la relecture, pas a la validation.
    assert.equal((await getTaskById(db, taskId))?.status, "REVIEW");
  });

  it("fait passer la tache en echec apres un run echoue", async () => {
    const { projectId, taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);

    await updateTaskStatus(db, taskId, projectId, "READY");
    await startTaskExecution(db, taskId);
    await failRun(db, run.id, { errorCode: "CLAUDE_PROCESS_FAILED" });

    assert.equal((await getRunById(db, run.id))?.status, "FAILED");
    assert.equal((await getTaskById(db, taskId))?.status, "FAILED");
  });

  it("fait passer la tache en bloquee apres un run bloque", async () => {
    const { projectId, taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);

    await updateTaskStatus(db, taskId, projectId, "READY");
    await startTaskExecution(db, taskId);
    await blockRun(db, run.id, { errorCode: "CLAUDE_LIMIT_REACHED" });

    assert.equal((await getRunById(db, run.id))?.status, "BLOCKED");
    assert.equal((await getTaskById(db, taskId))?.status, "BLOCKED");
  });

  it("ne fait jamais revenir un etat final vers un etat actif", async () => {
    const { taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);

    await completeRun(db, run.id, { resultText: "Premier resultat." });

    // Une reponse tardive du runner ne doit rien rouvrir.
    await markRunRunning(db, run.id, new Date());
    await updateRunFromRunner(db, run.id, { status: "RUNNING" });
    await failRun(db, run.id, { errorCode: "CLAUDE_PROCESS_FAILED" });

    const final = await getRunById(db, run.id);
    assert.equal(final?.status, "COMPLETED");
    assert.equal(final?.claude.resultText, "Premier resultat.");
    assert.equal(final?.errorCode, null);
  });

  it("ne modifie pas la tache si elle a deja quitte RUNNING", async () => {
    const { projectId, taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);

    await updateTaskStatus(db, taskId, projectId, "READY");
    // La tache reste `READY` : aucune execution ne l'a fait passer en cours.
    await completeRun(db, run.id, {});

    assert.equal((await getTaskById(db, taskId))?.status, "READY");
  });

  it("est idempotent applique deux fois", async () => {
    const { taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);

    const report = { status: "COMPLETED" as const, resultText: "Resultat.", exitCode: 0 };
    const first = await updateRunFromRunner(db, run.id, report);
    const second = await updateRunFromRunner(db, run.id, report);

    assert.equal(first?.status, "COMPLETED");
    assert.deepEqual(second?.status, first?.status);
    assert.deepEqual(second?.claude.resultText, first?.claude.resultText);
  });

  it("retourne null pour une execution inconnue", async () => {
    assert.equal(await getRunById(db, "run-inexistant"), null);
    assert.equal(await completeRun(db, "run-inexistant"), null);
    assert.equal(await markRunRunning(db, "run-inexistant", new Date()), null);
  });
});

describe("bornes appliquees a l'ecriture", () => {
  it("borne un compte rendu demesure", async () => {
    const { taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);

    const finished = await completeRun(db, run.id, { resultText: "a".repeat(500_000) });

    assert.ok((finished?.claude.resultText ?? "").length <= 200_000);
    assert.ok((finished?.claude.resultText ?? "").includes("tronque"));
  });

  it("borne la sortie d'erreur en conservant sa fin", async () => {
    const { taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);

    const finished = await failRun(db, run.id, {
      stderrTail: `${"a".repeat(50_000)}CAUSE_REELLE`,
    });

    assert.ok((finished?.stderrTail ?? "").length <= 8_000);
    assert.ok((finished?.stderrTail ?? "").includes("CAUSE_REELLE"));
  });

  it("borne le message d'erreur affiche", async () => {
    const { taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);

    const finished = await failRun(db, run.id, { errorMessage: "b".repeat(10_000) });

    assert.ok((finished?.errorMessage ?? "").length <= 2_000);
  });

  it("borne la liste des fichiers modifies", async () => {
    const { taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);

    const many = Array.from({ length: 900 }, (_, index) => `src/file-${String(index)}.ts`);
    const finished = await completeRun(db, run.id, { git: { changedFiles: many } });

    assert.equal(finished?.git.changedFiles.length, 500);
  });
});

describe("transitions de tache liees a l'execution", () => {
  it("n'entre en RUNNING que depuis READY", async () => {
    const { projectId, taskId } = await newTask();

    // Une tache `DRAFT` ne peut pas etre lancee.
    assert.equal(await startTaskExecution(db, taskId), false);
    assert.equal((await getTaskById(db, taskId))?.status, "DRAFT");

    await updateTaskStatus(db, taskId, projectId, "READY");
    assert.equal(await startTaskExecution(db, taskId), true);
    assert.equal((await getTaskById(db, taskId))?.status, "RUNNING");
  });

  it("ramene la tache a READY apres un lancement refuse", async () => {
    const { projectId, taskId } = await newTask();
    await updateTaskStatus(db, taskId, projectId, "READY");
    await startTaskExecution(db, taskId);

    await cancelTaskExecution(db, taskId);

    assert.equal((await getTaskById(db, taskId))?.status, "READY");
  });

  it("ne touche pas a une tache qui n'est pas en cours", async () => {
    const { projectId, taskId } = await newTask();
    await updateTaskStatus(db, taskId, projectId, "READY");

    await cancelTaskExecution(db, taskId);

    assert.equal((await getTaskById(db, taskId))?.status, "READY");
  });

  it("signale une execution active sur une tache", async () => {
    const { taskId } = await newTask();
    assert.equal(await hasActiveRun(db, taskId), false);

    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);
    assert.equal(await hasActiveRun(db, taskId), true);

    await completeRun(db, run.id);
    assert.equal(await hasActiveRun(db, taskId), false);
  });
});

describe("validation des lignes lues en base", () => {
  function corrupt(runId: string, column: string, value: string): void {
    const sqlite = new DatabaseSync(databaseFile);
    try {
      sqlite.prepare(`UPDATE "Run" SET "${column}" = ? WHERE "id" = ?`).run(value, runId);
    } finally {
      sqlite.close();
    }
  }

  it("refuse un statut inconnu", async () => {
    const { taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);

    corrupt(run.id, "status", "PARTI");

    await assert.rejects(getRunById(db, run.id), InvalidRunRecordError);
  });

  it("refuse un numero d'execution impossible", async () => {
    const { taskId } = await newTask();
    const run = await createRun(db, runInput(taskId));
    assert.ok(run !== null);

    corrupt(run.id, "sequence", "0");

    await assert.rejects(getRunById(db, run.id), InvalidRunRecordError);
  });
});
