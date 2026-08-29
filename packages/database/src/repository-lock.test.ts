/**
 * Exclusion d'execution par repository, verifiee sur une vraie base.
 *
 * Base temporaire, isolee, detruite a la fin. Le package **compile** est
 * importe : c'est celui que le web utilise.
 *
 * Ce que ces tests protegent est le fait central de TASK-031, et son revers :
 * deux repositories differents peuvent executer en meme temps ; un meme
 * repository, jamais — y compris quand deux projets le visent, ce que la base
 * n'est pas censee permettre mais qu'une ligne forgee rend possible.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  completeRun,
  countActiveRepositoryRuns,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  listProjectIdsSharingRepository,
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

const BACKSLASH = String.fromCharCode(92);

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

function runnerRunId(): string {
  counter += 1;
  return `3f2504e0-4f89-41d3-9a0c-${String(counter).padStart(12, "0")}`;
}

/** Cree un projet vise sur un repository donne, avec une tache prete. */
async function newProject(
  repositoryPath: string,
): Promise<{ projectId: string; taskId: string }> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath,
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

function start(target: { projectId: string; taskId: string }) {
  return createRun(db, {
    projectId: target.projectId,
    taskId: target.taskId,
    prompt: "Prompt.",
    promptSha256: "a".repeat(64),
    runnerRunId: runnerRunId(),
  });
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-repo-lock-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("listProjectIdsSharingRepository", () => {
  it("rend le projet lui-meme quand il est seul sur son repository", async () => {
    const alpha = await newProject(path.join(workspace, "seul"));

    assert.deepEqual(await listProjectIdsSharingRepository(db, alpha.projectId), [
      alpha.projectId,
    ]);
  });

  it("rend les deux projets quand deux chemins designent le meme dossier", async () => {
    // TASK-025 interdit normalement cette situation. Elle reste possible avec une
    // base ancienne ou modifiee a la main, et la securite d'execution ne doit pas
    // dependre d'un invariant applicatif.
    const root = path.join(workspace, "partage");
    const first = await newProject(root);
    const second = await newProject(`${root}${path.sep}`);

    const shared = await listProjectIdsSharingRepository(db, first.projectId);
    assert.equal(shared.length, 2);
    assert.ok(shared.includes(first.projectId));
    assert.ok(shared.includes(second.projectId));
  });

  it("rend une liste vide pour un projet inexistant", async () => {
    assert.deepEqual(await listProjectIdsSharingRepository(db, "projet-inexistant"), []);
  });
});

describe("countActiveRepositoryRuns", () => {
  it("compte une execution active du repository", async () => {
    const alpha = await newProject(path.join(workspace, "compte"));
    const created = await start(alpha);
    assert.ok(created.ok);

    assert.equal(await countActiveRepositoryRuns(db, alpha.projectId), 1);
    assert.equal(await countActiveRepositoryRuns(db, alpha.projectId, created.run.id), 0);
  });

  it("ne compte pas les executions d'un autre repository", async () => {
    const alpha = await newProject(path.join(workspace, "compte-a"));
    const beta = await newProject(path.join(workspace, "compte-b"));
    assert.ok((await start(alpha)).ok);

    assert.equal(await countActiveRepositoryRuns(db, beta.projectId), 0);
  });

  it("cesse de compter une execution terminee", async () => {
    const alpha = await newProject(path.join(workspace, "compte-fini"));
    const created = await start(alpha);
    assert.ok(created.ok);
    await completeRun(db, created.run.id, { finishedAt: new Date() });

    // Aucun verrou fantome : la tache suivante du repository doit pouvoir partir.
    assert.equal(await countActiveRepositoryRuns(db, alpha.projectId), 0);
  });
});

describe("createRun - exclusion par repository", () => {
  it("refuse une seconde execution sur le meme repository", async () => {
    const alpha = await newProject(path.join(workspace, "exclusion"));
    assert.ok((await start(alpha)).ok);

    const second = await start(alpha);
    assert.equal(second.ok, false);
    assert.equal(second.ok ? null : second.reason, "active_run");
  });

  it("accepte une execution sur un repository different", async () => {
    const alpha = await newProject(path.join(workspace, "libre-a"));
    const beta = await newProject(path.join(workspace, "libre-b"));
    const gamma = await newProject(path.join(workspace, "libre-c"));

    // Le fait central de TASK-031 : la limite globale historique n'existe plus.
    assert.ok((await start(alpha)).ok);
    assert.ok((await start(beta)).ok);
    assert.ok((await start(gamma)).ok);
  });

  it("refuse un second projet visant le meme repository", async () => {
    const root = path.join(workspace, "double-projet");
    const first = await newProject(root);
    const second = await newProject(`${root}${path.sep}`);

    assert.ok((await start(first)).ok);

    // Defense en profondeur : meme si deux projets pointent le meme dossier,
    // un seul Claude Code peut y travailler.
    const refused = await start(second);
    assert.equal(refused.ok, false);
    assert.equal(refused.ok ? null : refused.reason, "active_run");
  });

  it("refuse un alias ecrit differemment", async () => {
    const root = path.join(workspace, "alias-projet");
    const first = await newProject(root);
    // Separateurs inverses : le meme dossier, ecrit autrement.
    const second = await newProject(root.split(BACKSLASH).join("/") + "/");

    assert.ok((await start(first)).ok);
    assert.equal((await start(second)).ok, false);
  });
});

describe("createRun - concurrence", () => {
  it("n'accorde qu'une execution a dix lancements simultanes sur un repository", async () => {
    const alpha = await newProject(path.join(workspace, "course-meme"));

    const results = await Promise.all(Array.from({ length: 10 }, () => start(alpha)));

    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(await countActiveRepositoryRuns(db, alpha.projectId), 1);
  });

  it("laisse dix repositories differents partir ensemble", async () => {
    const projects = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        newProject(path.join(workspace, `course-${String(index)}`)),
      ),
    );

    const results = await Promise.all(projects.map((project) => start(project)));

    // Aucun refus ne doit venir d'une limite globale : elle n'existe plus.
    assert.equal(results.filter((result) => result.ok).length, 10);
    for (const project of projects) {
      assert.equal(await countActiveRepositoryRuns(db, project.projectId), 1);
    }
  });

  it("laisse repartir le repository une fois l'execution conclue", async () => {
    const alpha = await newProject(path.join(workspace, "liberation"));
    const first = await start(alpha);
    assert.ok(first.ok);

    assert.equal((await start(alpha)).ok, false);

    await completeRun(db, first.run.id, { finishedAt: new Date() });
    assert.equal((await start(alpha)).ok, true);
  });
});
