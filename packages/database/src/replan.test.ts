/**
 * Persistance d'une replanification, et etat de planification relu en base.
 *
 * Base temporaire, migrations reelles. Aucun fournisseur, aucun Claude Code,
 * aucun runner, aucune commande Git : ce sont des ecritures SQLite.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMMAND_EXECUTION_MODE,
  REPLAN_LOCK_REASON,
  REPLAN_MODE,
  REPLAN_PROPOSAL_STATUS,
  REPLAN_SCHEMA_VERSION,
  TASK_PRIORITY,
  TASK_STATUS,
  VERIFICATION_MODE,
  type ReplanProposal,
} from "@nox/shared";

import {
  createArchitectSession,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  enqueueTask,
  getPendingReplanProposal,
  getReplanProposal,
  getReplanProposalForGeneration,
  listReplanProposals,
  loadReplanPlanningState,
  toDatabaseFilePath,
  toSqliteUrl,
  updateTaskStatus,
  writeReplanProposal,
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
let generationCounter = 0;

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

/** Un tour de conversation, auquel une proposition peut se rattacher. */
async function newGeneration(projectId: string): Promise<string> {
  const session = await createArchitectSession(db, {
    projectId,
    requestText: "Je change d'avis sur l'export.",
  });
  assert.ok(session !== null);
  // La ligne est ecrite directement : ce module ne teste pas la reservation d'un
  // tour, seulement ce qui s'y rattache.
  generationCounter += 1;
  const generation = await db.architectGeneration.create({
    data: {
      sessionId: session.id,
      sequence: generationCounter,
      model: "modele-de-test",
      promptVersion: "architect/5",
      inputHash: "a".repeat(64),
      contextManifestJson: "{}",
      status: "CONTINUE",
    },
  });
  return generation.id;
}

async function newTask(
  projectId: string,
  title: string,
  overrides: { commands?: string[] } = {},
): Promise<string> {
  const task = await createTask(db, {
    projectId,
    title,
    objective: `Objectif de ${title}.`,
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: [`${title} est verifiable`],
    documentReferences: [],
    validationCommands: overrides.commands ?? [],
  });
  assert.ok(task !== null);
  return task.id;
}

function proposal(overrides: Partial<ReplanProposal> = {}): ReplanProposal {
  return {
    schemaVersion: REPLAN_SCHEMA_VERSION,
    mode: REPLAN_MODE.PROPOSED,
    rationale: "L'utilisateur abandonne l'export PDF.",
    futureTasks: [
      {
        existingTaskId: null,
        tempId: "N1",
        title: "Partager une liste par lien",
        priority: TASK_PRIORITY.MEDIUM,
        objective: "Permettre le partage par lien.",
        context: null,
        acceptanceCriteria: [],
        outOfScope: [],
        documentReferences: [],
        validationCommands: [],
        dependsOnTaskIds: [],
        dependsOnTempIds: [],
      },
    ],
    ...overrides,
  };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-replan-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("writeReplanProposal", () => {
  it("enregistre la proposition telle que le fournisseur l'a rendue", async () => {
    const projectId = await newProject();
    const generationId = await newGeneration(projectId);

    const written = await writeReplanProposal(db, {
      projectId,
      generationId,
      projectUpdateId: null,
      proposal: proposal(),
      baseBriefRevision: "c".repeat(64),
      basePlanRevision: null,
      planningFingerprint: "d".repeat(64),
    });

    assert.ok(written.ok);
    assert.equal(written.proposal.status, REPLAN_PROPOSAL_STATUS.PENDING);
    assert.equal(written.proposal.targetCount, 1);
    assert.equal(written.proposal.newCount, 1);
    assert.equal(written.proposal.appliedJson, null);
    assert.deepEqual(JSON.parse(written.proposal.providerJson), proposal());
  });

  it("refuse une seconde proposition tant que la premiere attend", async () => {
    // Un projet ne porte pas deux plans cibles concurrents : l'utilisateur ne
    // saurait pas lequel il relit.
    const projectId = await newProject();
    const first = await writeReplanProposal(db, {
      projectId,
      generationId: await newGeneration(projectId),
      projectUpdateId: null,
      proposal: proposal(),
      baseBriefRevision: null,
      basePlanRevision: null,
      planningFingerprint: "d".repeat(64),
    });
    assert.ok(first.ok);

    const second = await writeReplanProposal(db, {
      projectId,
      generationId: await newGeneration(projectId),
      projectUpdateId: null,
      proposal: proposal(),
      baseBriefRevision: null,
      basePlanRevision: null,
      planningFingerprint: "e".repeat(64),
    });

    assert.equal(second.ok, false);
    assert.equal(second.ok ? null : second.reason, "pending_exists");
    assert.equal((await listReplanProposals(db, projectId)).length, 1);
  });

  it("borne l'unicite au projet", async () => {
    // Deux projets peuvent porter chacun leur proposition en attente : TASK-031
    // interdit tout verrou global, et TASK-032 n'en reintroduit pas.
    const alpha = await newProject();
    const beta = await newProject();

    const first = await writeReplanProposal(db, {
      projectId: alpha,
      generationId: await newGeneration(alpha),
      projectUpdateId: null,
      proposal: proposal(),
      baseBriefRevision: null,
      basePlanRevision: null,
      planningFingerprint: "d".repeat(64),
    });
    const second = await writeReplanProposal(db, {
      projectId: beta,
      generationId: await newGeneration(beta),
      projectUpdateId: null,
      proposal: proposal(),
      baseBriefRevision: null,
      basePlanRevision: null,
      planningFingerprint: "d".repeat(64),
    });

    assert.ok(first.ok);
    assert.ok(second.ok);
  });

  it("se relit par projet, par identifiant et par tour", async () => {
    const projectId = await newProject();
    const generationId = await newGeneration(projectId);
    const written = await writeReplanProposal(db, {
      projectId,
      generationId,
      projectUpdateId: null,
      proposal: proposal(),
      baseBriefRevision: null,
      basePlanRevision: null,
      planningFingerprint: "d".repeat(64),
    });
    assert.ok(written.ok);

    assert.equal((await getPendingReplanProposal(db, projectId))?.id, written.proposal.id);
    assert.equal((await getReplanProposal(db, projectId, written.proposal.id))?.id, written.proposal.id);
    assert.equal((await getReplanProposalForGeneration(db, generationId))?.id, written.proposal.id);
  });

  it("ne rend jamais une proposition d'un autre projet", async () => {
    const alpha = await newProject();
    const beta = await newProject();
    const written = await writeReplanProposal(db, {
      projectId: alpha,
      generationId: await newGeneration(alpha),
      projectUpdateId: null,
      proposal: proposal(),
      baseBriefRevision: null,
      basePlanRevision: null,
      planningFingerprint: "d".repeat(64),
    });
    assert.ok(written.ok);

    assert.equal(await getReplanProposal(db, beta, written.proposal.id), null);
  });
});

describe("loadReplanPlanningState", () => {
  it("classe les taches selon les regles de l'editeur de tache future", async () => {
    const projectId = await newProject();
    const draft = await newTask(projectId, "Brouillon");
    const ready = await newTask(projectId, "Prete");
    const started = await newTask(projectId, "Commencee");
    const queued = await newTask(projectId, "En file");

    assert.ok((await updateTaskStatus(db, ready, projectId, TASK_STATUS.READY)).ok);
    assert.ok((await updateTaskStatus(db, queued, projectId, TASK_STATUS.READY)).ok);
    await enqueueTask(db, { projectId, taskId: queued });

    const created = await createRun(db, {
      taskId: started,
      projectId,
      runnerRunId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      prompt: "Prompt",
      promptSha256: "f".repeat(64),
    });
    assert.ok(created.ok);

    const state = await loadReplanPlanningState(db, projectId);
    const byId = new Map(state.tasks.map((task) => [task.classified.id, task.classified]));

    assert.equal(byId.get(draft)?.editable, true);
    assert.equal(byId.get(ready)?.editable, true);
    assert.equal(byId.get(started)?.editable, false);
    assert.equal(byId.get(started)?.lockReason, REPLAN_LOCK_REASON.STARTED);
    assert.equal(byId.get(queued)?.editable, false);
    assert.equal(byId.get(queued)?.lockReason, REPLAN_LOCK_REASON.QUEUED);
  });

  it("ne rend le contrat complet que des taches modifiables", async () => {
    const projectId = await newProject();
    const editableId = await newTask(projectId, "Modifiable", { commands: ["npm run test"] });
    const startedId = await newTask(projectId, "Commencee");
    const created = await createRun(db, {
      taskId: startedId,
      projectId,
      runnerRunId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
      prompt: "Prompt",
      promptSha256: "f".repeat(64),
    });
    assert.ok(created.ok);

    const state = await loadReplanPlanningState(db, projectId);
    const byId = new Map(state.tasks.map((task) => [task.classified.id, task]));

    const contract = byId.get(editableId)?.contract;
    assert.ok(contract !== null && contract !== undefined);
    assert.equal(contract.validationCommands.length, 1);
    assert.equal(contract.validationCommands[0]?.executionMode, COMMAND_EXECUTION_MODE.AGENT_ONLY);
    assert.equal(contract.acceptanceCriteria[0]?.verificationMode, VERIFICATION_MODE.HUMAN);

    assert.equal(byId.get(startedId)?.contract, null);
  });

  it("presente le plan dans un ordre deterministe", async () => {
    const projectId = await newProject();
    const first = await newTask(projectId, "Premiere");
    const second = await newTask(projectId, "Seconde");
    const third = await newTask(projectId, "Troisieme");

    // Un ordre de planification pose sur deux taches ; la troisieme garde son
    // ordre historique, et se range donc derriere.
    await db.task.update({ where: { id: third }, data: { planningOrder: 0 } });
    await db.task.update({ where: { id: first }, data: { planningOrder: 1 } });

    const state = await loadReplanPlanningState(db, projectId);
    assert.deepEqual(
      state.tasks.map((task) => task.classified.id),
      [third, first, second],
    );
  });

  it("compte les backlogs initiaux appliques", async () => {
    const projectId = await newProject();
    assert.equal((await loadReplanPlanningState(db, projectId)).appliedBacklogCount, 0);
  });
});
