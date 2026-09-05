/**
 * Persistance de la tache d'amorcage.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'un projet ne peut porter qu'une `TASK-000`, y compris sous concurrence —
 * et que cette garantie ne vient d'aucune verification applicative mais de la
 * contrainte `projectId + sequence`, qui existait avant TASK-023.
 *
 * Que le compteur de taches ordinaires ne bouge pas : creer l'amorcage ne
 * consomme aucun numero, et la tache suivante recoit celui qu'elle aurait recu
 * sans lui.
 *
 * Et que rien d'existant ne bouge : ni les codes, ni les statuts, ni les
 * specifications, ni la provenance de backlog des taches deja creees.
 *
 * Base temporaire, aucun reseau, aucun fournisseur.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHITECT_BACKLOG_GENERATION_STATUS,
  ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
  VERIFICATION_MODE,
  BOOTSTRAP_TASK_CODE,
  TASK_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
  type ArchitectBacklogProposalV3,
  type BacklogContextManifest,
} from "@nox/shared";

import {
  applyBacklogProposal,
  countAppliedBacklogProposals,
  createBootstrapTask,
  createDatabaseClient,
  createProject,
  createTask,
  finishBacklogGeneration,
  getBacklogProposalForGeneration,
  getBootstrapTask,
  getTaskById,
  listTasksByProject,
  peekNextTaskSequence,
  startBacklogGeneration,
  toDatabaseFilePath,
  toSqliteUrl,
  type CreateTaskInput,
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

const MANIFEST: BacklogContextManifest = {
  schemaVersion: 1,
  sources: [],
  totalChars: 0,
  missing: [],
  taskInventoryRevision: "inv-1",
};

function bootstrapInput(projectId: string): CreateTaskInput {
  return {
    projectId,
    title: "Bootstrap project repository and foundational documentation",
    objective: "Etablir une fondation minimale et executable.",
    context: "Contexte deterministe.",
    outOfScope: "- Implementer une fonctionnalite produit.",
    priority: TASK_PRIORITY.HIGH,
    acceptanceCriteria: ["Le repository a ete inspecte avant toute modification."],
    documentReferences: [],
    validationCommands: [],
  };
}

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

async function newProject(): Promise<string> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  return project.id;
}

/** Cree et applique un backlog, pour disposer de vraies taches produit. */
async function applyBacklog(projectId: string, titles: readonly string[]): Promise<void> {
  const proposal: ArchitectBacklogProposalV3 = {
    schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
    message: "Ce decoupage couvre le plan.",
    tasks: titles.map((title) => ({
      title,
      priority: TASK_PRIORITY.MEDIUM,
      objective: `Objectif de ${title}.`,
      context: null,
      acceptanceCriteria: [
        {
          text: `${title} est verifiable`,
          verificationMode: VERIFICATION_MODE.HUMAN,
          humanInstructions: "Verifier a la main.",
          validationCommandIndexes: [],
        },
      ],
      outOfScope: [],
      documentReferences: [],
      validationCommands: [],
      dependsOn: [],
    })),
  };

  const reserved = await startBacklogGeneration(db, {
    projectId,
    model: "modele-de-test",
    promptVersion: "backlog/1",
    inputHash: "hash-1",
    manifest: MANIFEST,
    base: {
      planningFingerprint: "f".repeat(64),
      briefRevision: "brief-1",
      planRevision: "plan-1",
      taskInventoryRevision: "inv-1",
      memoryRevision: "mem-1",
    },
  });
  assert.ok(reserved.ok, "la reservation aboutit");

  await finishBacklogGeneration(db, {
    generationId: reserved.generation.id,
    status: ARCHITECT_BACKLOG_GENERATION_STATUS.READY,
    proposal,
    usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, cachedInputTokens: null },
  });

  const stored = await getBacklogProposalForGeneration(db, projectId, reserved.generation.id);
  assert.ok(stored !== null);

  const applied = await applyBacklogProposal(db, {
    projectId,
    proposalId: stored.id,
    tasks: titles.map((title) => ({
      title,
      objective: `Objectif de ${title}.`,
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: [`${title} est verifiable`],
      documentReferences: [],
      validationCommands: [],
    })),
    currentPlanningFingerprint: "f".repeat(64),
    message: `${String(titles.length)} taches appliquees.`,
  });
  assert.ok(applied.ok, "le backlog s'applique");
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-bootstrap-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true });
});

describe("creation", () => {
  it("cree TASK-000 en DRAFT, de nature BOOTSTRAP", async () => {
    const projectId = await newProject();
    const created = await createBootstrapTask(db, bootstrapInput(projectId));

    assert.ok(created.ok);
    assert.equal(created.task.code, BOOTSTRAP_TASK_CODE);
    assert.equal(created.task.code, "TASK-000");
    assert.equal(created.task.kind, TASK_KIND.BOOTSTRAP);
    assert.equal(created.task.status, TASK_STATUS.DRAFT);
  });

  it("derive un chemin de document stable", async () => {
    const projectId = await newProject();
    const created = await createBootstrapTask(db, bootstrapInput(projectId));
    assert.ok(created.ok);
    assert.equal(created.task.documentPath, "tasks/TASK-000.md");
  });

  it("conserve la specification recue", async () => {
    const projectId = await newProject();
    const created = await createBootstrapTask(db, bootstrapInput(projectId));
    assert.ok(created.ok);
    assert.equal(created.task.priority, TASK_PRIORITY.HIGH);
    assert.deepEqual(created.task.acceptanceCriteria, [
      "Le repository a ete inspecte avant toute modification.",
    ]);
    assert.deepEqual(created.task.validationCommands, []);
  });

  it("refuse un projet inconnu", async () => {
    const created = await createBootstrapTask(db, bootstrapInput("projet-inexistant"));
    assert.ok(!created.ok);
    assert.equal(created.reason, "unknown_project");
  });

  it("ne porte aucune provenance de backlog", async () => {
    const projectId = await newProject();
    await applyBacklog(projectId, ["Domaine", "Planning"]);
    const created = await createBootstrapTask(db, bootstrapInput(projectId));
    assert.ok(created.ok);

    const rows = await db.task.findMany({
      where: { projectId },
      select: { sequence: true, backlogProposalId: true, backlogItemPosition: true },
      orderBy: { sequence: "asc" },
    });
    const bootstrapRow = rows.find((row) => row.sequence === 0);
    assert.ok(bootstrapRow !== undefined);
    assert.equal(bootstrapRow.backlogProposalId, null);
    assert.equal(bootstrapRow.backlogItemPosition, null);

    // Les taches du backlog gardent la leur.
    for (const row of rows.filter((entry) => entry.sequence > 0)) {
      assert.notEqual(row.backlogProposalId, null);
      assert.notEqual(row.backlogItemPosition, null);
    }
  });
});

describe("une seule par projet", () => {
  it("refuse la seconde creation", async () => {
    const projectId = await newProject();
    const first = await createBootstrapTask(db, bootstrapInput(projectId));
    assert.ok(first.ok);

    const second = await createBootstrapTask(db, bootstrapInput(projectId));
    assert.ok(!second.ok);
    assert.equal(second.reason, "already_exists");

    const tasks = await listTasksByProject(db, projectId);
    assert.equal(tasks.filter((task) => task.kind === TASK_KIND.BOOTSTRAP).length, 1);
  });

  it("n'en produit qu'une sous concurrence", async () => {
    const projectId = await newProject();

    // Cinq creations lancees ensemble : la contrainte d'unicite arbitre, pas une
    // verification applicative qui pourrait s'entrelacer de travers.
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => createBootstrapTask(db, bootstrapInput(projectId))),
    );

    assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
    assert.equal(
      outcomes.filter((outcome) => !outcome.ok && outcome.reason === "already_exists").length,
      4,
    );

    const tasks = await listTasksByProject(db, projectId);
    assert.equal(tasks.filter((task) => task.code === BOOTSTRAP_TASK_CODE).length, 1);
  });

  it("laisse chaque projet avoir la sienne", async () => {
    const first = await newProject();
    const second = await newProject();

    assert.ok((await createBootstrapTask(db, bootstrapInput(first))).ok);
    assert.ok((await createBootstrapTask(db, bootstrapInput(second))).ok);

    assert.notEqual(await getBootstrapTask(db, first), null);
    assert.notEqual(await getBootstrapTask(db, second), null);
  });
});

describe("lecture", () => {
  it("rend null quand aucune tache d'amorcage n'existe", async () => {
    const projectId = await newProject();
    assert.equal(await getBootstrapTask(db, projectId), null);
  });

  it("rend la tache complete quand elle existe", async () => {
    const projectId = await newProject();
    const created = await createBootstrapTask(db, bootstrapInput(projectId));
    assert.ok(created.ok);

    const read = await getBootstrapTask(db, projectId);
    assert.ok(read !== null);
    assert.equal(read.id, created.task.id);
    assert.equal(read.kind, TASK_KIND.BOOTSTRAP);
    assert.equal(read.objective, "Etablir une fondation minimale et executable.");
  });

  it("ne confond pas les projets", async () => {
    const withBootstrap = await newProject();
    const without = await newProject();
    assert.ok((await createBootstrapTask(db, bootstrapInput(withBootstrap))).ok);
    assert.equal(await getBootstrapTask(db, without), null);
  });
});

describe("le compteur de taches ordinaires", () => {
  it("ne bouge pas a la creation de l'amorcage", async () => {
    const projectId = await newProject();
    await applyBacklog(projectId, ["Domaine", "Planning", "Courses"]);

    const before = await peekNextTaskSequence(db, projectId);
    assert.equal(before, 4);

    assert.ok((await createBootstrapTask(db, bootstrapInput(projectId))).ok);

    assert.equal(await peekNextTaskSequence(db, projectId), 4);
  });

  it("laisse la tache suivante prendre le numero qu'elle aurait eu", async () => {
    const projectId = await newProject();
    await applyBacklog(projectId, ["Domaine", "Planning", "Courses"]);
    assert.ok((await createBootstrapTask(db, bootstrapInput(projectId))).ok);

    const next = await createTask(db, {
      projectId,
      title: "Tache ordinaire",
      objective: "Un objectif.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: ["Verifiable."],
      documentReferences: [],
      validationCommands: [],
    });

    assert.ok(next !== null);
    assert.equal(next.code, "TASK-004");
    assert.equal(next.kind, TASK_KIND.NORMAL);
  });

  it("place TASK-000 avant les autres dans un tri par code", async () => {
    const projectId = await newProject();
    await applyBacklog(projectId, ["Domaine", "Planning"]);
    assert.ok((await createBootstrapTask(db, bootstrapInput(projectId))).ok);

    const codes = (await listTasksByProject(db, projectId))
      .map((task) => task.code)
      .sort((a, b) => a.localeCompare(b));
    assert.deepEqual(codes, ["TASK-000", "TASK-001", "TASK-002"]);
  });
});

describe("les taches existantes ne bougent pas", () => {
  it("garde codes, statuts, specifications et provenance intacts", async () => {
    const projectId = await newProject();
    await applyBacklog(projectId, ["Domaine", "Planning", "Courses"]);

    const snapshot = await db.task.findMany({
      where: { projectId },
      select: {
        id: true,
        sequence: true,
        kind: true,
        title: true,
        objective: true,
        status: true,
        priority: true,
        backlogProposalId: true,
        backlogItemPosition: true,
      },
      orderBy: { sequence: "asc" },
    });

    assert.ok((await createBootstrapTask(db, bootstrapInput(projectId))).ok);

    const after = await db.task.findMany({
      where: { projectId, sequence: { gt: 0 } },
      select: {
        id: true,
        sequence: true,
        kind: true,
        title: true,
        objective: true,
        status: true,
        priority: true,
        backlogProposalId: true,
        backlogItemPosition: true,
      },
      orderBy: { sequence: "asc" },
    });

    assert.deepEqual(after, snapshot);
  });

  it("laisse les taches ordinaires de nature NORMAL", async () => {
    const projectId = await newProject();
    await applyBacklog(projectId, ["Domaine"]);
    assert.ok((await createBootstrapTask(db, bootstrapInput(projectId))).ok);

    const tasks = await listTasksByProject(db, projectId);
    const normal = tasks.filter((task) => task.code !== BOOTSTRAP_TASK_CODE);
    assert.ok(normal.length > 0);
    for (const task of normal) {
      assert.equal(task.kind, TASK_KIND.NORMAL);
    }
  });
});

describe("cascade et suppression", () => {
  it("disparait avec son projet, comme toute tache", async () => {
    const projectId = await newProject();
    const created = await createBootstrapTask(db, bootstrapInput(projectId));
    assert.ok(created.ok);

    await db.project.delete({ where: { id: projectId } });
    assert.equal(await getTaskById(db, created.task.id), null);
  });
});

describe("preconditions de backlog", () => {
  it("compte zero backlog applique sur un projet neuf", async () => {
    const projectId = await newProject();
    assert.equal(await countAppliedBacklogProposals(db, projectId), 0);
  });

  it("compte un backlog applique apres application", async () => {
    const projectId = await newProject();
    await applyBacklog(projectId, ["Domaine"]);
    assert.equal(await countAppliedBacklogProposals(db, projectId), 1);
  });
});
