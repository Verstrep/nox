/**
 * Orchestration de la suppression et du renommage d'un projet.
 *
 * ## Ce que ce fichier prouve
 *
 * L'ordre : le disque d'abord, la base ensuite. Il se verifie ici par les
 * effets — quand le nettoyage echoue, **rien** n'a ete supprime en base ; quand
 * il reussit, la base est videe ensuite.
 *
 * Et le refus global : un seul document qui resiste annule la suppression
 * entiere. L'etat a rendre impossible est « projet efface, documents laisses
 * derriere » — celui que plus rien ne pourrait rattacher a quoi que ce soit.
 *
 * Base temporaire, aucun runner reel, aucun fournisseur, aucun acces au disque.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  TASK_ARTIFACT_OUTCOME,
  TASK_PRIORITY,
  type ProjectTaskArtifact,
  type TaskArtifactReport,
} from "@nox/shared";
import {
  createDatabaseClient,
  createProject,
  createTask,
  markTaskDocumentSynced,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
} from "@nox/database";

import { deleteProjectFromNox, renameProjectInNox } from "./project-lifecycle.ts";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "database",
  "prisma",
  "migrations",
);

let workspace: string;
let db: DatabaseClient;
let counter = 0;

const REVISION = "a".repeat(64);

async function applyMigrations(file: string): Promise<void> {
  const directories = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
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

/** Un projet avec une tache dont le document est synchronise. */
async function newProject(name = "Meal Planner"): Promise<{ id: string; taskId: string }> {
  counter += 1;
  const project = await createProject(db, {
    name,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  const task = await createTask(db, {
    projectId: project.id,
    title: "Premiere tache",
    objective: "Objectif.",
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: ["verifiable"],
    documentReferences: [],
    validationCommands: [],
  });
  assert.ok(task !== null);
  await markTaskDocumentSynced(db, task.id, task.documentPath, REVISION);
  return { id: project.id, taskId: task.id };
}

/** Doublure du runner : elle enregistre ce qu'on lui demande. */
function runnerStub(outcome: TaskArtifactReport["outcome"]) {
  const calls: ProjectTaskArtifact[][] = [];
  return {
    calls,
    ports: {
      removeArtifacts: (_repositoryPath: string, artifacts: readonly ProjectTaskArtifact[]) => {
        calls.push([...artifacts]);
        return Promise.resolve({
          ok: true as const,
          value: artifacts.map((artifact) => ({
            taskCode: artifact.taskCode,
            path: `tasks/${artifact.taskCode}.md`,
            outcome,
          })),
        });
      },
    },
  };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-lifecycle-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("deleteProjectFromNox", () => {
  it("nettoie le repository puis vide la base", async () => {
    const project = await newProject();
    const runner = runnerStub(TASK_ARTIFACT_OUTCOME.REMOVED);

    const outcome = await deleteProjectFromNox(db, project.id, "Meal Planner", runner.ports);

    assert.ok(outcome.ok);
    assert.equal(outcome.ok && outcome.removed, 1);
    assert.equal(outcome.ok && outcome.modified, 0);
    assert.equal(await db.project.count({ where: { id: project.id } }), 0);

    // Le runner a recu des codes et des revisions, jamais un chemin.
    assert.deepEqual(runner.calls, [[{ taskCode: "TASK-001", expectedRevision: REVISION }]]);
  });

  it("compte a part un document qui avait diverge", async () => {
    const project = await newProject();
    const runner = runnerStub(TASK_ARTIFACT_OUTCOME.REMOVED_MODIFIED);

    const outcome = await deleteProjectFromNox(db, project.id, "Meal Planner", runner.ports);

    assert.ok(outcome.ok);
    assert.equal(outcome.ok && outcome.removed, 1);
    assert.equal(outcome.ok && outcome.modified, 1);
  });

  it("refuse un nom mal recopie sans appeler le runner", async () => {
    const project = await newProject();
    const runner = runnerStub(TASK_ARTIFACT_OUTCOME.REMOVED);

    const outcome = await deleteProjectFromNox(db, project.id, "meal planner", runner.ports);

    assert.equal(outcome.ok, false);
    // Ni fichier touche, ni ligne supprimee : le refus est gratuit.
    assert.deepEqual(runner.calls, []);
    assert.equal(await db.project.count({ where: { id: project.id } }), 1);
  });

  it("annule tout quand un document resiste", async () => {
    const project = await newProject();
    const runner = runnerStub(TASK_ARTIFACT_OUTCOME.REFUSED);

    const outcome = await deleteProjectFromNox(db, project.id, "Meal Planner", runner.ports);

    assert.equal(outcome.ok, false);
    assert.ok(outcome.ok === false && outcome.message.includes("tasks/TASK-001.md"));
    // L'etat a rendre impossible : projet efface, documents orphelins.
    assert.equal(await db.project.count({ where: { id: project.id } }), 1);
    assert.equal(await db.task.count({ where: { projectId: project.id } }), 1);
  });

  it("ne supprime rien quand le runner est injoignable", async () => {
    const project = await newProject();

    const outcome = await deleteProjectFromNox(db, project.id, "Meal Planner", {
      removeArtifacts: () => Promise.resolve({ ok: false, failure: { kind: "unreachable" } }),
    });

    assert.equal(outcome.ok, false);
    assert.equal(await db.project.count({ where: { id: project.id } }), 1);
  });

  it("n'appelle pas le runner quand aucun artefact n'est connu", async () => {
    // Un projet dont aucune tache n'a de document : il n'y a rien a retirer, et
    // le runner n'a donc aucune raison d'etre sollicite. C'est ce qui permet de
    // supprimer un projet runner arrete.
    counter += 1;
    const project = await createProject(db, {
      name: "Sans document",
      description: null,
      repositoryPath: path.join(workspace, `depot-${String(counter)}`),
    });
    const runner = runnerStub(TASK_ARTIFACT_OUTCOME.REMOVED);

    const outcome = await deleteProjectFromNox(db, project.id, "Sans document", runner.ports);

    assert.ok(outcome.ok);
    assert.deepEqual(runner.calls, []);
    assert.equal(await db.project.count({ where: { id: project.id } }), 0);
  });

  it("refuse un projet inexistant", async () => {
    const runner = runnerStub(TASK_ARTIFACT_OUTCOME.REMOVED);
    const outcome = await deleteProjectFromNox(db, "inconnu", "Peu importe", runner.ports);

    assert.equal(outcome.ok, false);
    assert.deepEqual(runner.calls, []);
  });

  it("laisse les autres projets intacts", async () => {
    const kept = await newProject("Autre projet");
    const doomed = await newProject();
    const runner = runnerStub(TASK_ARTIFACT_OUTCOME.REMOVED);

    assert.ok((await deleteProjectFromNox(db, doomed.id, "Meal Planner", runner.ports)).ok);

    assert.equal(await db.project.count({ where: { id: kept.id } }), 1);
    assert.equal(await db.task.count({ where: { projectId: kept.id } }), 1);
  });
});

describe("renameProjectInNox", () => {
  it("renomme sans toucher au repository", async () => {
    const project = await newProject();
    const before = await db.project.findUnique({ where: { id: project.id } });

    const outcome = await renameProjectInNox(db, project.id, "  Planificateur  ");

    assert.ok(outcome.ok);
    assert.equal(outcome.ok && outcome.changed, true);
    // Le nom est normalise par le validateur de la creation, pas par un second.
    assert.equal(outcome.ok && outcome.name, "Planificateur");

    const after = await db.project.findUnique({ where: { id: project.id } });
    assert.equal(after?.repositoryPath, before?.repositoryPath);
  });

  it("refuse un nom vide", async () => {
    const project = await newProject();
    const outcome = await renameProjectInNox(db, project.id, "   ");

    assert.equal(outcome.ok, false);
    assert.equal((await db.project.findUnique({ where: { id: project.id } }))?.name, "Meal Planner");
  });

  it("refuse un nom trop long", async () => {
    const project = await newProject();
    const outcome = await renameProjectInNox(db, project.id, "n".repeat(81));
    assert.equal(outcome.ok, false);
  });

  it("ne signale aucun changement pour un nom identique", async () => {
    const project = await newProject();
    const outcome = await renameProjectInNox(db, project.id, "Meal Planner");

    assert.ok(outcome.ok);
    assert.equal(outcome.ok && outcome.changed, false);
  });

  it("refuse un projet inexistant", async () => {
    const outcome = await renameProjectInNox(db, "inconnu", "Peu importe");
    assert.equal(outcome.ok, false);
  });
});
