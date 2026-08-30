/**
 * Checkpoint fonctionnel d'un changement de projet.
 *
 * ## Ce que ce fichier parcourt
 *
 * La boucle entiere, de bout en bout, sur une vraie base : un tour de
 * conversation qui propose une mise a jour du projet **et** une replanification,
 * une revue humaine, une application, et ce qu'il advient des taches.
 *
 * Les tests unitaires prouvent chaque piece separement. Celui-ci prouve qu'elles
 * s'emboitent — et surtout qu'aucune n'en declenche une autre : ni fournisseur,
 * ni Claude Code, ni validation, ni file, ni Git.
 *
 * ## Le faux fournisseur
 *
 * Il rend un tour deja forme. Aucun quota consomme, aucun reseau, aucun binaire
 * lance. C'est la regle de tous les tests automatises de NOX, et elle n'a pas
 * d'exception ici.
 *
 * ## Ce qui n'est pas ici
 *
 * Le parcours complet de TASK-032 — toutes les combinaisons, toutes les
 * peremptions, tous les ecrans. Ce fichier est un point de controle ; il sera
 * repris et elargi.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHITECT_TURN_SCHEMA_VERSION_V4,
  ARCHITECT_TURN_STATE,
  PROJECT_UPDATE_ACTION,
  REPLAN_MODE,
  REPLAN_PROPOSAL_STATUS,
  TASK_PRIORITY,
  TASK_STATUS,
  VERIFICATION_MODE,
  type ArchitectPromptBrief,
  type ArchitectPromptV1Plan,
  type ProjectBriefInput,
  type ProjectV1PlanInput,
} from "@nox/shared";
import {
  createArchitectSession,
  createDatabaseClient,
  getArchitectSession,
  createProject,
  createRun,
  createTask,
  enqueueTask,
  getPendingReplanProposal,
  getTaskById,
  listTasksByProject,
  loadReplanPlanningState,
  saveProjectBrief,
  saveProjectV1Plan,
  setQueueActive,
  toDatabaseFilePath,
  toSqliteUrl,
  updateTaskStatus,
  type DatabaseClient,
  type ProjectPlanTools,
  type ReplanApplyOutcome,
} from "@nox/database";

import { FakeArchitectProvider, type ArchitectProviderResult } from "../architect/provider.ts";
import { loadStructuredState } from "../project-plan.ts";
import { sendArchitectMessage, type ArchitectRepositoryPorts } from "../architect/service.ts";
import { loadReplanChange } from "./change.ts";
import { applyReplanChange, dismissReplanChange } from "./service.ts";
import type { ReplanDocumentReport } from "./service.ts";
import { taskToReviewItem, type ReplanReviewItem } from "./target.ts";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
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

function hashOf(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part.length));
    hash.update(part, "utf8");
  }
  return hash.digest("hex");
}

const TOOLS: ProjectPlanTools = {
  sanitize: (value: string) => value,
  revisions: {
    brief: (brief: ArchitectPromptBrief) =>
      hashOf(["brief", brief.summary, brief.problem, brief.targetUsers, brief.desiredOutcome]),
    plan: (plan: ArchitectPromptV1Plan) => hashOf(["plan", plan.goal, plan.technicalDirection]),
  },
};

const BRIEF: ProjectBriefInput = {
  summary: "Un suivi de lectures.",
  problem: "Rien ne centralise mes lectures.",
  targetUsers: "Moi seul.",
  desiredOutcome: "Savoir ce que j'ai lu.",
  goals: ["Enregistrer un livre"],
  nonGoals: ["Reseau social"],
};

const PLAN: ProjectV1PlanInput = {
  goal: "Suivre une annee.",
  inScope: ["Liste"],
  outOfScope: ["Mobile"],
  technicalDirection: "Application web simple.",
  milestones: ["La liste est utilisable"],
};

/** Le repository, remplace par une doublure : aucun runner n'est demarre. */
const REPOSITORY_PORTS: ArchitectRepositoryPorts = {
  listDocuments: () => Promise.resolve({ ok: true, value: [] }),
  readDocument: (_repository: string, documentPath: string) =>
    Promise.resolve({
      ok: true,
      value: { path: documentPath, content: `# ${documentPath}`, revision: "a".repeat(64) },
    }),
};

/** La synchronisation Markdown, remplacee par un compte rendu observable. */
type SyncCall = { created: string[]; rewritten: string[]; removed: string[] };
let syncCalls: SyncCall[] = [];

const RECORDING_SYNC = async (
  _db: DatabaseClient,
  _project: { id: string; repositoryPath: string },
  outcome: ReplanApplyOutcome,
): Promise<ReplanDocumentReport> => {
  syncCalls.push({
    created: outcome.created.map((task) => task.code),
    rewritten: outcome.updated.map((task) => task.code),
    removed: outcome.removed.map((task) => task.code),
  });
  return {
    created: outcome.created.length,
    rewritten: outcome.updated.length,
    removed: outcome.removed.length,
    problems: [],
  };
};

/** Compte les appels reellement passes au fournisseur. */
let providerCalls = 0;

function success(raw: unknown): ArchitectProviderResult {
  providerCalls += 1;
  return {
    ok: true,
    value: {
      raw,
      responseId: "resp_test",
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: null },
    },
  };
}

/**
 * Le tour que le faux fournisseur rend.
 *
 * Deja forme, deja valide cote schema : ce que NOX en fait ensuite est
 * exactement ce que ce fichier observe.
 */
function turnPayload(options: {
  existingTaskId: string;
  update?: boolean;
}): Record<string, unknown> {
  return {
    schemaVersion: ARCHITECT_TURN_SCHEMA_VERSION_V4,
    state: ARCHITECT_TURN_STATE.CONTINUE,
    message: "Voici ce que je propose.",
    questions: [],
    proposal: null,
    projectUpdate:
      options.update === false
        ? null
        : {
            reason: "Le perimetre change : l'export PDF est abandonne.",
            brief: { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null },
            plan: {
              action: PROJECT_UPDATE_ACTION.SET,
              value: {
                goal: "Partager une liste de lecture.",
                inScope: ["Partage par lien"],
                outOfScope: ["Export PDF"],
                technicalDirection: "Application web simple.",
                milestones: ["Le partage est utilisable"],
              },
            },
          },
    replan: {
      mode: REPLAN_MODE.PROPOSED,
      rationale: "L'export PDF disparait ; le partage par lien le remplace.",
      futureTasks: [
        {
          existingTaskId: options.existingTaskId,
          tempId: null,
          title: "Afficher une liste de lecture",
          priority: TASK_PRIORITY.MEDIUM,
          objective: "Un objectif reecrit par l'architecte.",
          context: null,
          acceptanceCriteria: [
            {
              text: "La liste s'affiche.",
              verificationMode: VERIFICATION_MODE.HUMAN,
              humanInstructions: "Ouvrir la page.",
              validationCommandIndexes: [],
            },
          ],
          outOfScope: [],
          documentReferences: [],
          validationCommands: [],
          dependsOn: [],
        },
        {
          existingTaskId: null,
          tempId: "N1",
          title: "Partager une liste par lien",
          priority: TASK_PRIORITY.MEDIUM,
          objective: "Permettre le partage par lien.",
          context: null,
          acceptanceCriteria: [
            {
              text: "Le lien ouvre la liste.",
              verificationMode: VERIFICATION_MODE.HUMAN,
              humanInstructions: "Ouvrir le lien.",
              validationCommandIndexes: [],
            },
          ],
          outOfScope: [],
          documentReferences: [],
          validationCommands: [],
          dependsOn: [options.existingTaskId],
        },
      ],
    },
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

/**
 * Un projet deja planifie : brief, plan, un backlog applique, une tache future.
 *
 * Le backlog applique est la condition de disponibilite d'une replanification :
 * NOX n'ouvre pas un second chemin de planification initiale.
 */
async function newPlannedProject(): Promise<{
  project: { id: string; name: string; repositoryPath: string };
  sessionId: string;
  taskId: string;
}> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });

  assert.ok((await saveProjectBrief(db, { projectId: project.id, values: BRIEF, tools: TOOLS })).ok);
  assert.ok((await saveProjectV1Plan(db, { projectId: project.id, values: PLAN, tools: TOOLS })).ok);

  const session = await createArchitectSession(db, {
    projectId: project.id,
    requestText: "Conversation projet.",
    kind: "PROJECT",
  });
  assert.ok(session !== null);

  const generation = await db.architectBacklogGeneration.create({
    data: {
      projectId: project.id,
      sequence: counter,
      status: "PROPOSAL_READY",
      model: "modele-de-test",
      promptVersion: "backlog/2",
      inputHash: "a".repeat(64),
      contextManifestJson: "{}",
      planningFingerprint: "b".repeat(64),
      baseTaskInventoryRevision: "c".repeat(64),
      baseMemoryRevision: "d".repeat(64),
    },
    select: { id: true },
  });
  await db.architectBacklogProposal.create({
    data: {
      generationId: generation.id,
      projectId: project.id,
      status: "APPLIED",
      message: "Backlog initial.",
      taskCount: 1,
      providerJson: "{}",
      appliedAt: new Date(),
    },
  });

  const task = await createTask(db, {
    projectId: project.id,
    title: "Afficher une liste de lecture",
    objective: "Objectif d'origine.",
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: ["La liste s'affiche"],
    documentReferences: [],
    validationCommands: [],
  });
  assert.ok(task !== null);

  return { project, sessionId: session.id, taskId: task.id };
}

/** Envoie un message, avec le faux fournisseur et le faux repository. */
async function sendTurn(
  project: { id: string; name: string; repositoryPath: string },
  sessionId: string,
  payload: Record<string, unknown>,
) {
  const session = await getArchitectSession(db, sessionId);
  assert.ok(session !== null);

  return sendArchitectMessage(db, {
    session,
    projectName: project.name,
    repositoryPath: project.repositoryPath,
    message: "J'abandonne l'export PDF.",
    tasks: [],
    memories: [],
    structuredState: await loadStructuredState(db, project),
    projectId: project.id,
    planTools: TOOLS,
    planningState: await loadReplanPlanningState(db, project.id),
    model: "modele-de-test",
    environment: {},
    ports: REPOSITORY_PORTS,
    provider: new FakeArchitectProvider([success(payload)]),
    expectedMessageCount: session.messages.length,
  });
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-replan-functional-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("A. un tour propose un changement complet", () => {
  it("produit une seule carte, et ne modifie rien", async () => {
    const { project, sessionId, taskId } = await newPlannedProject();
    const before = await listTasksByProject(db, project.id);

    const sent = await sendTurn(project, sessionId, turnPayload({ existingTaskId: taskId }));
    assert.ok(sent.ok, JSON.stringify(sent));

    const proposal = await getPendingReplanProposal(db, project.id);
    assert.notEqual(proposal, null);
    assert.notEqual(proposal?.projectUpdateId, null, "la mise a jour du projet est liee");

    // Une proposition ne modifie rien : ni les taches, ni le plan.
    assert.deepEqual(await listTasksByProject(db, project.id), before);
    assert.equal(
      (await db.projectV1Plan.findUnique({ where: { projectId: project.id } }))?.goal,
      PLAN.goal,
    );
  });

  it("refuse une seconde proposition tant que la premiere attend", async () => {
    const { project, sessionId, taskId } = await newPlannedProject();
    assert.ok((await sendTurn(project, sessionId, turnPayload({ existingTaskId: taskId }))).ok);

    // Le tour aboutit — la conversation continue — mais aucune seconde
    // proposition n'est ecrite : l'utilisateur ne saurait pas laquelle il relit.
    const second = await sendTurn(project, sessionId, turnPayload({ existingTaskId: taskId }));
    assert.ok(second.ok);
    assert.equal(await db.architectReplanProposal.count({ where: { projectId: project.id } }), 1);
  });
});

describe("B. revue, edition humaine, puis application", () => {
  it("applique le projet et ses taches en une fois", async () => {
    syncCalls = [];
    const { project, sessionId, taskId } = await newPlannedProject();
    assert.ok((await sendTurn(project, sessionId, turnPayload({ existingTaskId: taskId }))).ok);

    const proposal = await getPendingReplanProposal(db, project.id);
    assert.ok(proposal !== null);

    const change = await loadReplanChange(
      db,
      project,
      proposal,
      await loadStructuredState(db, project),
    );

    // Un seul geste, une seule page : le plan produit et les taches futures.
    assert.equal(change.changesPlan, true);
    assert.equal(change.changesBrief, false);
    assert.equal(change.diff.summary.updated, 1);
    assert.equal(change.diff.summary.added, 1);

    // L'humain corrige le titre propose avant d'appliquer.
    const items: ReplanReviewItem[] = change.items.map((item) =>
      item.tempId === null
        ? item
        : { ...item, values: { ...item.values, title: "Partager par lien public" } },
    );

    const applied = await applyReplanChange(
      db,
      project,
      {
        proposalId: proposal.id,
        items,
        projectUpdate: {
          brief: null,
          plan: {
            goal: "Partager une liste de lecture.",
            inScope: ["Partage par lien"],
            outOfScope: ["Export PDF"],
            technicalDirection: "Application web simple.",
            milestones: ["Le partage est utilisable"],
          },
        },
      },
      RECORDING_SYNC,
    );

    assert.ok(applied.ok, applied.ok ? "" : applied.message);
    assert.equal(
      (await db.projectV1Plan.findUnique({ where: { projectId: project.id } }))?.goal,
      "Partager une liste de lecture.",
    );

    const tasks = await listTasksByProject(db, project.id);
    assert.equal(tasks.length, 2);
    // C'est le titre de l'humain qui est applique, jamais celui du fournisseur.
    assert.ok(tasks.some((task) => task.title === "Partager par lien public"));
    assert.equal((await getTaskById(db, taskId))?.objective, "Un objectif reecrit par l'architecte.");

    // La dependance vers la tache existante a bien ete ecrite.
    const created = applied.outcome.created[0];
    assert.ok(created !== undefined);
    const edges = await db.taskDependency.findMany({
      where: { taskId: created.taskId },
      select: { dependsOnTaskId: true },
    });
    assert.deepEqual(
      edges.map((edge) => edge.dependsOnTaskId),
      [taskId],
    );

    // Seuls les documents des taches reellement changees sont touches.
    assert.deepEqual(syncCalls, [
      { created: [created.code], rewritten: ["TASK-001"], removed: [] },
    ]);
  });
});

describe("C. le passe reste intact", () => {
  it("laisse une tache terminee inchangee, et permet de l'attendre", async () => {
    const { project, sessionId, taskId } = await newPlannedProject();
    const run = await createRun(db, {
      taskId,
      projectId: project.id,
      runnerRunId: "3f2504e0-4f89-41d3-9a0c-0305e82c3501",
      prompt: "Prompt",
      promptSha256: "f".repeat(64),
    });
    assert.ok(run.ok);
    const before = await getTaskById(db, taskId);

    // La tache est desormais verrouillee : la cible ne la designe plus, elle
    // l'attend seulement.
    const sent = await sendTurn(project, sessionId, {
          ...turnPayload({ existingTaskId: taskId }),
          replan: {
            mode: REPLAN_MODE.PROPOSED,
            rationale: "Une suite au travail deja fait.",
            futureTasks: [
              {
                existingTaskId: null,
                tempId: "N1",
                title: "Partager une liste par lien",
                priority: TASK_PRIORITY.MEDIUM,
                objective: "Permettre le partage par lien.",
                context: null,
                acceptanceCriteria: [
                  {
                    text: "Le lien ouvre la liste.",
                    verificationMode: VERIFICATION_MODE.HUMAN,
                    humanInstructions: "Ouvrir le lien.",
                    validationCommandIndexes: [],
                  },
                ],
                outOfScope: [],
                documentReferences: [],
                validationCommands: [],
                dependsOn: [taskId],
              },
            ],
          },
    });
    assert.ok(sent.ok, JSON.stringify(sent));

    const proposal = await getPendingReplanProposal(db, project.id);
    assert.ok(proposal !== null);
    const change = await loadReplanChange(
      db,
      project,
      proposal,
      await loadStructuredState(db, project),
    );

    const applied = await applyReplanChange(
      db,
      project,
      { proposalId: proposal.id, items: change.items, projectUpdate: change.update === null ? null : { brief: null, plan: null } },
      RECORDING_SYNC,
    );

    assert.ok(applied.ok, applied.ok ? "" : applied.message);
    assert.deepEqual(await getTaskById(db, taskId), before, "la tache verrouillee n'a pas bouge");
  });
});

describe("D et E. statuts", () => {
  it("ramene une tache prete en brouillon quand son contrat change", async () => {
    const { project, sessionId, taskId } = await newPlannedProject();
    assert.ok((await updateTaskStatus(db, taskId, project.id, TASK_STATUS.READY)).ok);
    assert.ok((await sendTurn(project, sessionId, turnPayload({ existingTaskId: taskId }))).ok);

    const proposal = await getPendingReplanProposal(db, project.id);
    assert.ok(proposal !== null);
    const change = await loadReplanChange(
      db,
      project,
      proposal,
      await loadStructuredState(db, project),
    );

    const applied = await applyReplanChange(
      db,
      project,
      {
        proposalId: proposal.id,
        items: change.items,
        projectUpdate: { brief: null, plan: PLAN },
      },
      RECORDING_SYNC,
    );

    assert.ok(applied.ok, applied.ok ? "" : applied.message);
    assert.equal((await getTaskById(db, taskId))?.status, TASK_STATUS.DRAFT);
  });

  it("laisse une tache prete prete quand seul l'ordre change", async () => {
    syncCalls = [];
    const { project, sessionId, taskId } = await newPlannedProject();
    const second = await createTask(db, {
      projectId: project.id,
      title: "Seconde tache",
      objective: "Objectif d'origine.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: ["Un critere"],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(second !== null);
    assert.ok((await updateTaskStatus(db, taskId, project.id, TASK_STATUS.READY)).ok);
    assert.ok((await updateTaskStatus(db, second.id, project.id, TASK_STATUS.READY)).ok);

    const planning = await loadReplanPlanningState(db, project.id);
    const items = planning.tasks
      .filter((task) => task.classified.editable)
      .flatMap((task, index) => {
        const item = taskToReviewItem(task, `r${String(index)}`);
        return item === null ? [] : [item];
      })
      .reverse();

    assert.ok(
      (
        await sendTurn(project, sessionId, {
          ...turnPayload({ existingTaskId: taskId }),
          projectUpdate: null,
          replan: {
            mode: REPLAN_MODE.PROPOSED,
            rationale: "Le partage passe avant.",
            futureTasks: [],
          },
        })
      ).ok,
    );

    const proposal = await getPendingReplanProposal(db, project.id);
    assert.ok(proposal !== null);

    const applied = await applyReplanChange(
      db,
      project,
      { proposalId: proposal.id, items, projectUpdate: null },
      RECORDING_SYNC,
    );

    assert.ok(applied.ok, applied.ok ? "" : applied.message);
    assert.equal(applied.outcome.updated.length, 0);
    assert.equal(applied.outcome.reordered, 2);
    assert.equal((await getTaskById(db, taskId))?.status, TASK_STATUS.READY);
    assert.equal((await getTaskById(db, second.id))?.status, TASK_STATUS.READY);
    // Un reordonnancement ne reecrit aucun document : l'ordre du plan n'y figure
    // pas, et un repository modifie sans raison arreterait une file.
    assert.deepEqual(syncCalls, [{ created: [], rewritten: [], removed: [] }]);
  });
});

describe("F et G. peremption", () => {
  it("refuse quand la tache a ete inscrite en file depuis", async () => {
    const { project, sessionId, taskId } = await newPlannedProject();
    assert.ok((await updateTaskStatus(db, taskId, project.id, TASK_STATUS.READY)).ok);
    assert.ok((await sendTurn(project, sessionId, turnPayload({ existingTaskId: taskId }))).ok);

    const proposal = await getPendingReplanProposal(db, project.id);
    assert.ok(proposal !== null);
    const change = await loadReplanChange(
      db,
      project,
      proposal,
      await loadStructuredState(db, project),
    );

    await enqueueTask(db, { projectId: project.id, taskId });

    const applied = await applyReplanChange(
      db,
      project,
      { proposalId: proposal.id, items: change.items, projectUpdate: { brief: null, plan: PLAN } },
      RECORDING_SYNC,
    );

    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? false : applied.stale, true);
    assert.notEqual(await db.taskQueueEntry.findUnique({ where: { taskId } }), null);
  });

  it("refuse quand une execution est apparue depuis", async () => {
    const { project, sessionId, taskId } = await newPlannedProject();
    assert.ok((await sendTurn(project, sessionId, turnPayload({ existingTaskId: taskId }))).ok);

    const proposal = await getPendingReplanProposal(db, project.id);
    assert.ok(proposal !== null);
    const change = await loadReplanChange(
      db,
      project,
      proposal,
      await loadStructuredState(db, project),
    );

    const run = await createRun(db, {
      taskId,
      projectId: project.id,
      runnerRunId: "3f2504e0-4f89-41d3-9a0c-0305e82c3502",
      prompt: "Prompt",
      promptSha256: "f".repeat(64),
    });
    assert.ok(run.ok);

    const applied = await applyReplanChange(
      db,
      project,
      { proposalId: proposal.id, items: change.items, projectUpdate: { brief: null, plan: PLAN } },
      RECORDING_SYNC,
    );

    assert.equal(applied.ok, false);
    assert.equal((await getTaskById(db, taskId))?.objective, "Objectif d'origine.");
  });
});

describe("H. abandon combine", () => {
  it("ecarte les deux propositions, et ne modifie rien", async () => {
    const { project, sessionId, taskId } = await newPlannedProject();
    assert.ok((await sendTurn(project, sessionId, turnPayload({ existingTaskId: taskId }))).ok);

    const proposal = await getPendingReplanProposal(db, project.id);
    assert.ok(proposal !== null);
    const before = await listTasksByProject(db, project.id);

    const dismissed = await dismissReplanChange(db, project, proposal.id);
    assert.ok(dismissed.ok);
    assert.equal(
      (await db.architectProjectUpdate.findUnique({ where: { id: dismissed.projectUpdateId ?? "" } }))
        ?.status,
      "DISMISSED",
    );
    assert.deepEqual(await listTasksByProject(db, project.id), before);
    assert.equal(
      (await db.projectV1Plan.findUnique({ where: { projectId: project.id } }))?.goal,
      PLAN.goal,
    );
    assert.equal(await getPendingReplanProposal(db, project.id), null);
  });
});

describe("I. dix applications simultanees", () => {
  it("n'en laisse aboutir qu'une", async () => {
    const { project, sessionId, taskId } = await newPlannedProject();
    assert.ok((await sendTurn(project, sessionId, turnPayload({ existingTaskId: taskId }))).ok);

    const proposal = await getPendingReplanProposal(db, project.id);
    assert.ok(proposal !== null);
    const change = await loadReplanChange(
      db,
      project,
      proposal,
      await loadStructuredState(db, project),
    );

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        applyReplanChange(
          db,
          project,
          {
            proposalId: proposal.id,
            items: change.items,
            projectUpdate: { brief: null, plan: PLAN },
          },
          RECORDING_SYNC,
        ).catch(() => ({ ok: false as const, message: "erreur" })),
      ),
    );

    assert.equal(results.filter((result) => result.ok).length, 1);
    // Une seule tache creee, et aucun code attribue deux fois.
    const tasks = await listTasksByProject(db, project.id);
    assert.equal(tasks.length, 2);
    assert.equal(new Set(tasks.map((task) => task.code)).size, tasks.length);
  });
});

describe("J. amorcage jamais lance", () => {
  it("refuse un changement de projet tant que TASK-000 n'a pas tourne", async () => {
    const { project, sessionId, taskId } = await newPlannedProject();
    const { createBootstrapTask } = await import("@nox/database");
    const bootstrap = await createBootstrapTask(db, {
      projectId: project.id,
      title: "Amorcage",
      objective: "Preparer les fondations.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.HIGH,
      acceptanceCriteria: ["Le socle compile"],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(bootstrap.ok);

    assert.ok((await sendTurn(project, sessionId, turnPayload({ existingTaskId: taskId }))).ok);
    const proposal = await getPendingReplanProposal(db, project.id);
    assert.ok(proposal !== null);
    const change = await loadReplanChange(
      db,
      project,
      proposal,
      await loadStructuredState(db, project),
    );

    const applied = await applyReplanChange(
      db,
      project,
      {
        proposalId: proposal.id,
        items: change.items,
        projectUpdate: {
          brief: null,
          plan: {
            goal: "Partager une liste de lecture.",
            inScope: ["Partage par lien"],
            outOfScope: ["Export PDF"],
            technicalDirection: "Application web simple.",
            milestones: ["Le partage est utilisable"],
          },
        },
      },
      RECORDING_SYNC,
    );

    // TASK-000 a ete redigee a partir de l'etat produit d'alors : changer cet
    // etat avant qu'elle n'ait tourne la laisserait preparer des fondations pour
    // un projet qui n'existe plus.
    assert.equal(applied.ok, false);
    assert.ok(applied.ok ? false : applied.message.includes("TASK-000"));
    // Ni reecrite, ni supprimee, ni lancee.
    assert.equal((await getTaskById(db, bootstrap.task.id))?.objective, "Preparer les fondations.");
    assert.equal(
      (await db.projectV1Plan.findUnique({ where: { projectId: project.id } }))?.goal,
      PLAN.goal,
    );
  });
});

describe("K. une file active n'est pas touchee", () => {
  it("n'annule, ne demarre et ne desinscrit rien", async () => {
    const { project, sessionId, taskId } = await newPlannedProject();
    const other = await createTask(db, {
      projectId: project.id,
      title: "En file",
      objective: "Objectif d'origine.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: ["Un critere"],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(other !== null);
    assert.ok((await updateTaskStatus(db, other.id, project.id, TASK_STATUS.READY)).ok);
    await enqueueTask(db, { projectId: project.id, taskId: other.id });
    assert.ok((await setQueueActive(db, project.id, true)).ok);

    assert.ok((await sendTurn(project, sessionId, turnPayload({ existingTaskId: taskId }))).ok);
    const proposal = await getPendingReplanProposal(db, project.id);
    assert.ok(proposal !== null);
    const change = await loadReplanChange(
      db,
      project,
      proposal,
      await loadStructuredState(db, project),
    );

    const queueBefore = await db.taskQueueEntry.findMany({ where: { projectId: project.id } });
    const applied = await applyReplanChange(
      db,
      project,
      { proposalId: proposal.id, items: change.items, projectUpdate: { brief: null, plan: PLAN } },
      RECORDING_SYNC,
    );

    assert.ok(applied.ok, applied.ok ? "" : applied.message);
    assert.deepEqual(
      await db.taskQueueEntry.findMany({ where: { projectId: project.id } }),
      queueBefore,
      "la file n'a pas bouge",
    );
    assert.equal(
      await db.run.count({ where: { task: { projectId: project.id } } }),
      0,
      "aucune execution",
    );
    // Une tache en file est verrouillee, donc absente de la cible : son contrat
    // reste exactement celui qui a ete autorise.
    assert.equal((await getTaskById(db, other.id))?.objective, "Objectif d'origine.");
    // Les taches nouvelles naissent hors file.
    for (const created of applied.outcome.created) {
      assert.equal(await db.taskQueueEntry.findUnique({ where: { taskId: created.taskId } }), null);
    }
  });
});

describe("L. aucun appel de trop", () => {
  it("ne consulte le fournisseur que pour un tour, jamais pour une revue", async () => {
    providerCalls = 0;
    const { project, sessionId, taskId } = await newPlannedProject();
    assert.ok((await sendTurn(project, sessionId, turnPayload({ existingTaskId: taskId }))).ok);
    assert.equal(providerCalls, 1, "un tour, un appel");

    const proposal = await getPendingReplanProposal(db, project.id);
    assert.ok(proposal !== null);
    // Relire, comparer, appliquer, ecarter : zero appel.
    const change = await loadReplanChange(
      db,
      project,
      proposal,
      await loadStructuredState(db, project),
    );
    await applyReplanChange(
      db,
      project,
      { proposalId: proposal.id, items: change.items, projectUpdate: { brief: null, plan: PLAN } },
      RECORDING_SYNC,
    );
    await dismissReplanChange(db, project, proposal.id);

    assert.equal(providerCalls, 1, "aucun appel supplementaire");
    assert.equal(
      (await getPendingReplanProposal(db, project.id))?.status ?? null,
      null,
      "plus aucune proposition en attente",
    );
    void REPLAN_PROPOSAL_STATUS;
  });
});
