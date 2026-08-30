/**
 * Application d'un changement de projet.
 *
 * ## Ce que ce fichier prouve
 *
 * Que le passe reste intact, que le futur ne change que sur un geste humain, et
 * qu'une proposition batie sur un etat qui n'existe plus est refusee **avant**
 * la moindre ecriture.
 *
 * Les scenarios qui comptent le plus sont ceux ou l'application doit **ne rien
 * faire** : une cible identique a l'etat courant, un reordonnancement seul, une
 * proposition perimee, dix applications simultanees. Un test qui verifie qu'une
 * ecriture a eu lieu se trompe rarement ; un test qui verifie qu'aucune n'a eu
 * lieu attrape les regressions que personne ne voit.
 *
 * Base temporaire, migrations reelles. Aucun fournisseur, aucun Claude Code,
 * aucun runner, aucune commande Git.
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
  COMMAND_EXECUTION_MODE,
  REPLAN_MODE,
  REPLAN_PROPOSAL_STATUS,
  REPLAN_SCHEMA_VERSION,
  TASK_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
  VERIFICATION_MODE,
  type ArchitectPromptBrief,
  type ArchitectPromptV1Plan,
  type ProjectBriefInput,
  type ProjectV1PlanInput,
  type ReplanProposal,
} from "@nox/shared";

import {
  BOOTSTRAP_REQUIRES_REFRESH,
  applyReplanProposal,
  createArchitectSession,
  createBootstrapTask,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  dismissReplanProposal,
  enqueueTask,
  getReplanProposal,
  getTaskById,
  listReplanCreatedTasks,
  loadProjectStructuredState,
  loadReplanPlanningState,
  saveProjectBrief,
  saveProjectV1Plan,
  toDatabaseFilePath,
  toSqliteUrl,
  updateTaskStatus,
  writeReplanProposal,
  type ApplyReplanInput,
  type ApplyReplanResult,
  type DatabaseClient,
  type ProjectPlanTools,
  type ReplanApplyItem,
  type ReplanPlanningState,
  type ReplanStaleDetail,
  type TaskEditInput,
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

const SANITIZE = (value: string): string => value;

function hashOf(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part.length));
    hash.update(part, "utf8");
  }
  return hash.digest("hex");
}

const TOOLS: ProjectPlanTools = {
  sanitize: SANITIZE,
  revisions: {
    brief: (brief: ArchitectPromptBrief) =>
      hashOf(["brief", brief.summary, brief.problem, brief.targetUsers, brief.desiredOutcome]),
    plan: (plan: ArchitectPromptV1Plan) => hashOf(["plan", plan.goal, plan.technicalDirection]),
  },
};

/**
 * Empreinte de planification, injectee comme `apps/web` le fait.
 *
 * Simplifiee, mais fidele sur ce qui compte : elle couvre le contrat, le
 * verrouillage, l'ordre et les dependances de chaque tache, plus les revisions
 * du brief et du plan. C'est exactement l'ensemble des faits dont la peremption
 * depend.
 */
const FINGERPRINT: ApplyReplanInput["fingerprint"] = ({ state, briefRevision, planRevision }) =>
  hashOf([
    briefRevision ?? "no-brief",
    planRevision ?? "no-plan",
    ...state.tasks.map((task) =>
      [
        task.classified.code,
        task.classified.editable ? "editable" : `locked:${task.classified.lockReason}`,
        task.classified.status,
        String(task.classified.runCount),
        task.classified.queued ? "queued" : "free",
        task.planningOrder === null ? "-" : String(task.planningOrder),
        [...task.dependsOnTaskIds].sort((left, right) => left.localeCompare(right)).join(","),
        JSON.stringify(task.contract),
      ].join("|"),
    ),
  ]);

/**
 * Le refus d'une application, ou une erreur claire.
 *
 * Ces trois fonctions existent pour que les tests puissent lire le detail d'un
 * refus sans le supposer : un refus inattendu produit une phrase, pas une
 * exception de typage ni un `undefined` silencieux.
 */
function refusalOf(result: ApplyReplanResult): Extract<ApplyReplanResult, { ok: false }> {
  if (result.ok) {
    throw new Error("Une application a abouti alors qu'elle devait etre refusee.");
  }
  return result;
}

function staleOf(result: ApplyReplanResult): ReplanStaleDetail {
  const failure = refusalOf(result);
  if (failure.reason !== "stale") {
    throw new Error(`Refus attendu « stale », obtenu « ${failure.reason} ».`);
  }
  return failure.detail;
}

function bootstrapCodeOf(result: ApplyReplanResult): string {
  const failure = refusalOf(result);
  if (failure.reason !== "bootstrap") {
    throw new Error(`Refus attendu « bootstrap », obtenu « ${failure.reason} ».`);
  }
  return failure.code;
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

async function newGeneration(projectId: string): Promise<string> {
  const session = await createArchitectSession(db, {
    projectId,
    requestText: "Je change d'avis sur l'export.",
  });
  assert.ok(session !== null);
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

async function newTask(projectId: string, title: string): Promise<string> {
  const task = await createTask(db, {
    projectId,
    title,
    objective: `Objectif de ${title}.`,
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: [`${title} est verifiable`],
    documentReferences: [],
    validationCommands: [],
  });
  assert.ok(task !== null);
  return task.id;
}

/** Le contrat courant d'une tache, tel que la cible doit le renvoyer inchange. */
async function contractOf(projectId: string, taskId: string): Promise<TaskEditInput> {
  const state = await loadReplanPlanningState(db, projectId);
  const task = state.tasks.find((entry) => entry.classified.id === taskId);
  assert.ok(task?.contract !== null && task?.contract !== undefined);
  return task.contract;
}

/** Un element de cible qui conserve une tache existante a l'identique. */
async function keep(projectId: string, taskId: string): Promise<ReplanApplyItem> {
  const contract = await contractOf(projectId, taskId);
  return {
    existingTaskId: taskId,
    tempId: null,
    values: contract,
    dependsOnTaskIds: [...contract.dependsOnTaskIds],
    dependsOnTempIds: [],
  };
}

/** Un element de cible qui cree une tache nouvelle. */
function create(tempId: string, title: string, overrides: Partial<ReplanApplyItem> = {}): ReplanApplyItem {
  return {
    existingTaskId: null,
    tempId,
    values: {
      title,
      objective: `Objectif de ${title}.`,
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: [
        {
          text: `${title} est verifiable`,
          verificationMode: VERIFICATION_MODE.HUMAN,
          humanInstructions: "Verifier a la main.",
          commandPositions: [],
        },
      ],
      documentReferences: [],
      validationCommands: [],
      dependsOnTaskIds: [],
    },
    dependsOnTaskIds: [],
    dependsOnTempIds: [],
    ...overrides,
  };
}

function proposalOf(overrides: Partial<ReplanProposal> = {}): ReplanProposal {
  return {
    schemaVersion: REPLAN_SCHEMA_VERSION,
    mode: REPLAN_MODE.PROPOSED,
    rationale: "L'utilisateur abandonne l'export PDF.",
    futureTasks: [],
    ...overrides,
  };
}

/** Enregistre une proposition en attente, avec l'empreinte de l'etat courant. */
async function pendingProposal(
  projectId: string,
  options: { projectUpdateId?: string | null } = {},
): Promise<string> {
  const state = await loadReplanPlanningState(db, projectId);
  // Les revisions viennent de l'etat structure, exactement comme a la
  // preparation d'un tour : le controle de peremption compare deux valeurs
  // produites par le meme code, sinon il ne verifierait rien.
  const structured = await loadProjectStructuredState(db, projectId, TOOLS);
  const briefRevision = structured.brief.revision;
  const planRevision = structured.plan.revision;

  const written = await writeReplanProposal(db, {
    projectId,
    generationId: await newGeneration(projectId),
    projectUpdateId: options.projectUpdateId ?? null,
    proposal: proposalOf(),
    baseBriefRevision: briefRevision,
    basePlanRevision: planRevision,
    planningFingerprint: FINGERPRINT({ state, briefRevision, planRevision }),
  });
  assert.ok(written.ok);
  return written.proposal.id;
}

function applyInput(
  projectId: string,
  proposalId: string,
  target: readonly ReplanApplyItem[],
  overrides: Partial<ApplyReplanInput> = {},
): ApplyReplanInput {
  return {
    projectId,
    proposalId,
    target,
    projectUpdate: null,
    appliedJson: JSON.stringify({ target: target.length }),
    tools: TOOLS,
    fingerprint: FINGERPRINT,
    ...overrides,
  };
}

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

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-replan-apply-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("cible identique a l'etat courant", () => {
  it("n'ecrit rien du tout", async () => {
    // Le test le plus important du fichier. Appliquer un plan qui ne change rien
    // ne doit produire aucune mutation : ni statut degrade, ni `updatedAt`
    // deplace, ni ordre de planification invente.
    const projectId = await newProject();
    const first = await newTask(projectId, "Premiere");
    const second = await newTask(projectId, "Seconde");
    assert.ok((await updateTaskStatus(db, first, projectId, TASK_STATUS.READY)).ok);

    const before = await db.task.findMany({
      where: { projectId },
      select: { id: true, status: true, updatedAt: true, planningOrder: true },
      orderBy: { sequence: "asc" },
    });

    const proposalId = await pendingProposal(projectId);
    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [
        await keep(projectId, first),
        await keep(projectId, second),
      ]),
    );

    assert.ok(applied.ok);
    assert.deepEqual(applied.outcome.created, []);
    assert.deepEqual(applied.outcome.updated, []);
    assert.deepEqual(applied.outcome.removed, []);
    assert.equal(applied.outcome.reordered, 0);

    const after = await db.task.findMany({
      where: { projectId },
      select: { id: true, status: true, updatedAt: true, planningOrder: true },
      orderBy: { sequence: "asc" },
    });
    assert.deepEqual(after, before);
  });
});

describe("modification d'un contrat", () => {
  it("ramene une tache prete en brouillon", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "Prete");
    assert.ok((await updateTaskStatus(db, taskId, projectId, TASK_STATUS.READY)).ok);

    const proposalId = await pendingProposal(projectId);
    const item = await keep(projectId, taskId);
    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [
        { ...item, values: { ...item.values, objective: "Un autre objectif." } },
      ]),
    );

    assert.ok(applied.ok);
    assert.equal(applied.outcome.updated.length, 1);
    const task = await getTaskById(db, taskId);
    assert.equal(task?.status, TASK_STATUS.DRAFT);
    assert.equal(task?.objective, "Un autre objectif.");
  });

  it("laisse un brouillon en brouillon", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "Brouillon");

    const proposalId = await pendingProposal(projectId);
    const item = await keep(projectId, taskId);
    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [
        { ...item, values: { ...item.values, title: "Autre titre" } },
      ]),
    );

    assert.ok(applied.ok);
    assert.equal((await getTaskById(db, taskId))?.status, TASK_STATUS.DRAFT);
  });

  it("ecrit le plan de verification par le chemin unique de TASK-027", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "Verifiable");

    const proposalId = await pendingProposal(projectId);
    const item = await keep(projectId, taskId);
    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [
        {
          ...item,
          values: {
            ...item.values,
            validationCommands: [
              { command: "npm run test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
            ],
            acceptanceCriteria: [
              {
                text: "Les tests passent.",
                verificationMode: VERIFICATION_MODE.AUTOMATED,
                humanInstructions: null,
                commandPositions: [0],
              },
            ],
          },
        },
      ]),
    );

    assert.ok(applied.ok);
    const contract = await contractOf(projectId, taskId);
    assert.equal(contract.validationCommands[0]?.executionMode, COMMAND_EXECUTION_MODE.AUTONOMOUS);
    assert.deepEqual(contract.acceptanceCriteria[0]?.commandPositions, [0]);
  });
});

describe("reordonnancement", () => {
  it("laisse une tache prete prete, et n'ecrit que l'ordre", async () => {
    const projectId = await newProject();
    const first = await newTask(projectId, "Premiere");
    const second = await newTask(projectId, "Seconde");
    assert.ok((await updateTaskStatus(db, first, projectId, TASK_STATUS.READY)).ok);
    assert.ok((await updateTaskStatus(db, second, projectId, TASK_STATUS.READY)).ok);

    const proposalId = await pendingProposal(projectId);
    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [
        await keep(projectId, second),
        await keep(projectId, first),
      ]),
    );

    assert.ok(applied.ok);
    assert.equal(applied.outcome.updated.length, 0);
    assert.equal(applied.outcome.reordered, 2);

    const rows = await db.task.findMany({
      where: { projectId },
      select: { id: true, status: true, planningOrder: true },
    });
    for (const row of rows) {
      assert.equal(row.status, TASK_STATUS.READY, "un reordonnancement ne degrade aucun statut");
    }
    assert.equal(rows.find((row) => row.id === second)?.planningOrder, 0);
    assert.equal(rows.find((row) => row.id === first)?.planningOrder, 1);
  });
});

describe("creation", () => {
  it("attribue des codes neufs, et n'en recycle aucun", async () => {
    const projectId = await newProject();
    const first = await newTask(projectId, "Premiere");
    await newTask(projectId, "Seconde");

    // La premiere tache est supprimee par la cible : son numero ne doit jamais
    // etre rendu a une tache suivante.
    const before = await db.project.findUnique({
      where: { id: projectId },
      select: { nextTaskSequence: true },
    });

    const proposalId = await pendingProposal(projectId);
    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [create("N1", "Nouvelle A"), create("N2", "Nouvelle B")]),
    );

    assert.ok(applied.ok);
    assert.equal(applied.outcome.created.length, 2);
    assert.equal(applied.outcome.removed.length, 2);

    const codes = applied.outcome.created.map((task) => task.code);
    assert.deepEqual(codes, [
      `TASK-${String(before?.nextTaskSequence ?? 0).padStart(3, "0")}`,
      `TASK-${String((before?.nextTaskSequence ?? 0) + 1).padStart(3, "0")}`,
    ]);
    assert.ok(!codes.includes("TASK-001"), "un numero supprime n'est jamais rendu");
    void first;

    const created = await listReplanCreatedTasks(db, proposalId);
    assert.equal(created.length, 2);
    for (const task of created) {
      assert.equal(task.status, TASK_STATUS.DRAFT, "une tache nouvelle nait toujours en brouillon");
    }
  });

  it("resout une dependance vers une tache nouvelle du meme lot", async () => {
    const projectId = await newProject();
    const proposalId = await pendingProposal(projectId);

    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [
        create("N1", "Socle"),
        create("N2", "Dessus", { dependsOnTempIds: ["N1"] }),
      ]),
    );

    assert.ok(applied.ok);
    const [socle, dessus] = applied.outcome.created;
    assert.ok(socle !== undefined && dessus !== undefined);

    const edges = await db.taskDependency.findMany({
      where: { taskId: dessus.taskId },
      select: { dependsOnTaskId: true },
    });
    assert.deepEqual(
      edges.map((edge) => edge.dependsOnTaskId),
      [socle.taskId],
    );
  });

  it("conserve une dependance vers une tache verrouillee et terminee", async () => {
    // Une dependance deja satisfaite reste une dependance : la retirer parce
    // qu'elle est verte reecrirait un plan humain sans le dire.
    const projectId = await newProject();
    const done = await newTask(projectId, "Terminee");
    const created = await createRun(db, {
      taskId: done,
      projectId,
      runnerRunId: "3f2504e0-4f89-41d3-9a0c-0305e82c3401",
      prompt: "Prompt",
      promptSha256: "f".repeat(64),
    });
    assert.ok(created.ok);

    const proposalId = await pendingProposal(projectId);
    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [
        create("N1", "Suite", { dependsOnTaskIds: [done] }),
      ]),
    );

    assert.ok(applied.ok);
    const edges = await db.taskDependency.findMany({
      where: { taskId: applied.outcome.created[0]?.taskId ?? "" },
      select: { dependsOnTaskId: true },
    });
    assert.deepEqual(
      edges.map((edge) => edge.dependsOnTaskId),
      [done],
    );
  });
});

describe("graphe final", () => {
  it("refuse un cycle", async () => {
    const projectId = await newProject();
    const proposalId = await pendingProposal(projectId);

    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [
        create("N1", "A", { dependsOnTempIds: ["N2"] }),
        create("N2", "B", { dependsOnTempIds: ["N1"] }),
      ]),
    );

    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "graph");
    assert.equal((await db.task.count({ where: { projectId } })), 0, "aucune mutation partielle");
    assert.equal(
      (await getReplanProposal(db, projectId, proposalId))?.status,
      REPLAN_PROPOSAL_STATUS.PENDING,
    );
  });

  it("refuse une suppression que la cible attend encore", async () => {
    const projectId = await newProject();
    const socle = await newTask(projectId, "Socle");
    const dessus = await newTask(projectId, "Dessus");
    await db.taskDependency.create({ data: { taskId: dessus, dependsOnTaskId: socle } });

    const proposalId = await pendingProposal(projectId);
    const item = await keep(projectId, dessus);
    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [{ ...item, dependsOnTaskIds: [socle] }]),
    );

    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "graph");
  });

  it("refuse une tache verrouillee laissee sans ce qu'elle attend", async () => {
    const projectId = await newProject();
    const socle = await newTask(projectId, "Socle futur");
    const lance = await newTask(projectId, "Deja lance");
    await db.taskDependency.create({ data: { taskId: lance, dependsOnTaskId: socle } });
    const created = await createRun(db, {
      taskId: lance,
      projectId,
      runnerRunId: "3f2504e0-4f89-41d3-9a0c-0305e82c3402",
      prompt: "Prompt",
      promptSha256: "f".repeat(64),
    });
    assert.ok(created.ok);

    const proposalId = await pendingProposal(projectId);
    const applied = await applyReplanProposal(db, applyInput(projectId, proposalId, []));

    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "graph");
    assert.ok(await getTaskById(db, socle), "la tache visee n'a pas ete supprimee");
  });

  it("refuse une dependance vers une tache d'un autre projet", async () => {
    const alpha = await newProject();
    const beta = await newProject();
    const etrangere = await newTask(beta, "Etrangere");

    const proposalId = await pendingProposal(alpha);
    const applied = await applyReplanProposal(
      db,
      applyInput(alpha, proposalId, [create("N1", "Locale", { dependsOnTaskIds: [etrangere] })]),
    );

    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "graph");
    assert.equal(await db.task.count({ where: { projectId: alpha } }), 0);
  });
});

describe("peremption", () => {
  it("refuse quand une tache a ete inscrite dans la file depuis", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A mettre en file");
    assert.ok((await updateTaskStatus(db, taskId, projectId, TASK_STATUS.READY)).ok);

    const proposalId = await pendingProposal(projectId);
    const item = await keep(projectId, taskId);
    await enqueueTask(db, { projectId, taskId });

    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [
        { ...item, values: { ...item.values, objective: "Autre chose." } },
      ]),
    );

    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "stale");
    assert.deepEqual(
      staleOf(applied).tasks.map((task) => task.reason),
      ["QUEUED"],
    );
    // La tache n'est jamais retiree de la file pour rendre l'application
    // possible : NOX refuse, il ne defait pas un geste humain.
    assert.notEqual(await db.taskQueueEntry.findUnique({ where: { taskId } }), null);
  });

  it("refuse quand une execution est apparue depuis", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A lancer");

    const proposalId = await pendingProposal(projectId);
    const item = await keep(projectId, taskId);
    const created = await createRun(db, {
      taskId,
      projectId,
      runnerRunId: "3f2504e0-4f89-41d3-9a0c-0305e82c3403",
      prompt: "Prompt",
      promptSha256: "f".repeat(64),
    });
    assert.ok(created.ok);

    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [
        { ...item, values: { ...item.values, objective: "Autre chose." } },
      ]),
    );

    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "stale");
    // Le contrat historique n'a pas bouge d'une lettre.
    assert.equal((await getTaskById(db, taskId))?.objective, "Objectif de A lancer.");
  });

  it("refuse quand une tache future a ete editee depuis", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A editer");

    const proposalId = await pendingProposal(projectId);
    const item = await keep(projectId, taskId);
    await db.task.update({ where: { id: taskId }, data: { objective: "Edite a la main." } });

    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [item]),
    );

    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "stale");
    assert.equal(staleOf(applied).planning, true);
  });

  it("refuse quand le brief a change depuis", async () => {
    const projectId = await newProject();
    assert.ok((await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS })).ok);

    const proposalId = await pendingProposal(projectId);
    assert.ok(
      (
        await saveProjectBrief(db, {
          projectId,
          values: { ...BRIEF, summary: "Autre resume." },
          tools: TOOLS,
        })
      ).ok,
    );

    const applied = await applyReplanProposal(db, applyInput(projectId, proposalId, []));
    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "stale");
    assert.equal(staleOf(applied).brief, true);
  });

  it("refuse quand le plan a change depuis", async () => {
    const projectId = await newProject();
    assert.ok((await saveProjectV1Plan(db, { projectId, values: PLAN, tools: TOOLS })).ok);

    const proposalId = await pendingProposal(projectId);
    assert.ok(
      (
        await saveProjectV1Plan(db, {
          projectId,
          values: { ...PLAN, goal: "Un autre objectif." },
          tools: TOOLS,
        })
      ).ok,
    );

    const applied = await applyReplanProposal(db, applyInput(projectId, proposalId, []));
    assert.equal(applied.ok, false);
    assert.equal(staleOf(applied).plan, true);
  });

  it("refuse quand une tache a ete ajoutee depuis", async () => {
    const projectId = await newProject();
    const proposalId = await pendingProposal(projectId);
    await newTask(projectId, "Ajoutee entre-temps");

    const applied = await applyReplanProposal(db, applyInput(projectId, proposalId, []));
    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "stale");
  });
});

describe("changement combine", () => {
  it("ecrit le projet et ses taches dans une seule transaction", async () => {
    const projectId = await newProject();
    assert.ok((await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS })).ok);
    assert.ok((await saveProjectV1Plan(db, { projectId, values: PLAN, tools: TOOLS })).ok);
    const oldTask = await newTask(projectId, "Ancienne");

    const generationId = await newGeneration(projectId);
    const update = await db.architectProjectUpdate.create({
      data: {
        generationId,
        projectId,
        status: "PENDING",
        reason: "Le perimetre change.",
        proposedJson: JSON.stringify({ reason: "x" }),
        baseBriefRevision: null,
        basePlanRevision: null,
      },
      select: { id: true },
    });
    const proposalId = await pendingProposal(projectId, { projectUpdateId: update.id });

    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [create("N1", "Nouvelle")], {
        projectUpdate: { brief: { ...BRIEF, summary: "Le perimetre a change." }, plan: null },
      }),
    );

    assert.ok(applied.ok);
    assert.equal(applied.outcome.projectUpdateId, update.id);
    assert.equal(
      (await db.projectBrief.findUnique({ where: { projectId } }))?.summary,
      "Le perimetre a change.",
    );
    assert.equal(
      (await db.architectProjectUpdate.findUnique({ where: { id: update.id } }))?.status,
      "APPLIED",
    );
    assert.equal(await getTaskById(db, oldTask), null, "l'ancienne tache a bien ete supprimee");
    assert.equal(applied.outcome.created.length, 1);
  });

  it("ne touche ni brief ni plan quand aucune mise a jour n'est liee", async () => {
    const projectId = await newProject();
    assert.ok((await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS })).ok);
    const proposalId = await pendingProposal(projectId);

    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [create("N1", "Nouvelle")], {
        // Meme si le navigateur en envoyait un, il est ignore : c'est la
        // proposition enregistree qui decide s'il existe une mise a jour liee.
        projectUpdate: { brief: { ...BRIEF, summary: "Tentative." }, plan: null },
      }),
    );

    assert.ok(applied.ok);
    assert.equal(applied.outcome.projectUpdateId, null);
    assert.equal(
      (await db.projectBrief.findUnique({ where: { projectId } }))?.summary,
      BRIEF.summary,
    );
  });
});

describe("amorcage", () => {
  it("refuse un changement de projet tant que TASK-000 n'a pas tourne", async () => {
    const projectId = await newProject();
    assert.ok((await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS })).ok);
    const bootstrap = await createBootstrapTask(db, {
      projectId,
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

    const generationId = await newGeneration(projectId);
    const update = await db.architectProjectUpdate.create({
      data: {
        generationId,
        projectId,
        status: "PENDING",
        reason: "Le perimetre change.",
        proposedJson: JSON.stringify({ reason: "x" }),
        baseBriefRevision: null,
        basePlanRevision: null,
      },
      select: { id: true },
    });
    const proposalId = await pendingProposal(projectId, { projectUpdateId: update.id });

    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [], {
        projectUpdate: { brief: { ...BRIEF, summary: "Un autre produit." }, plan: null },
      }),
    );

    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "bootstrap");
    assert.equal(bootstrapCodeOf(applied), BOOTSTRAP_REQUIRES_REFRESH);
    // Ni reecrite, ni supprimee : NOX nomme le geste, il ne le fait pas.
    assert.equal((await getTaskById(db, bootstrap.task.id))?.kind, TASK_KIND.BOOTSTRAP);
    assert.equal(
      (await db.projectBrief.findUnique({ where: { projectId } }))?.summary,
      BRIEF.summary,
    );
  });

  it("autorise le changement quand TASK-000 a deja tourne", async () => {
    const projectId = await newProject();
    assert.ok((await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS })).ok);
    const bootstrap = await createBootstrapTask(db, {
      projectId,
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
    const created = await createRun(db, {
      taskId: bootstrap.task.id,
      projectId,
      runnerRunId: "3f2504e0-4f89-41d3-9a0c-0305e82c3404",
      prompt: "Prompt",
      promptSha256: "f".repeat(64),
    });
    assert.ok(created.ok);

    const generationId = await newGeneration(projectId);
    const update = await db.architectProjectUpdate.create({
      data: {
        generationId,
        projectId,
        status: "PENDING",
        reason: "Le perimetre change.",
        proposedJson: JSON.stringify({ reason: "x" }),
        baseBriefRevision: null,
        basePlanRevision: null,
      },
      select: { id: true },
    });
    const proposalId = await pendingProposal(projectId, { projectUpdateId: update.id });

    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [], {
        projectUpdate: { brief: { ...BRIEF, summary: "Un autre produit." }, plan: null },
      }),
    );

    assert.ok(applied.ok);
    // Le contrat de TASK-000 reste exactement ce qu'il etait.
    assert.equal(
      (await getTaskById(db, bootstrap.task.id))?.objective,
      "Preparer les fondations.",
    );
  });
});

describe("concurrence", () => {
  it("une seule application gagne sur dix tentatives simultanees", async () => {
    const projectId = await newProject();
    const proposalId = await pendingProposal(projectId);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        applyReplanProposal(
          db,
          applyInput(projectId, proposalId, [create("N1", "Nouvelle")]),
        ).catch(() => ({ ok: false as const, reason: "not_pending" as const })),
      ),
    );

    const winners = results.filter((result) => result.ok);
    assert.equal(winners.length, 1);
    assert.equal(await db.task.count({ where: { projectId } }), 1, "une seule tache creee");

    const codes = await db.task.findMany({ where: { projectId }, select: { sequence: true } });
    assert.equal(new Set(codes.map((row) => row.sequence)).size, codes.length);
  });

  it("une application et un abandon simultanes n'aboutissent pas tous les deux", async () => {
    const projectId = await newProject();
    const generationId = await newGeneration(projectId);
    const update = await db.architectProjectUpdate.create({
      data: {
        generationId,
        projectId,
        status: "PENDING",
        reason: "Le perimetre change.",
        proposedJson: JSON.stringify({ reason: "x" }),
        baseBriefRevision: null,
        basePlanRevision: null,
      },
      select: { id: true },
    });
    const proposalId = await pendingProposal(projectId, { projectUpdateId: update.id });

    const [applied, dismissed] = await Promise.all([
      applyReplanProposal(db, applyInput(projectId, proposalId, [create("N1", "Nouvelle")])).catch(
        () => ({ ok: false as const }),
      ),
      dismissReplanProposal(db, { projectId, proposalId }).catch(() => ({ ok: false as const })),
    ]);

    assert.equal(Number(applied.ok) + Number(dismissed.ok), 1);

    // Le changement lie reste coherent : jamais applique d'un cote et ecarte de
    // l'autre.
    const proposal = await getReplanProposal(db, projectId, proposalId);
    const linked = await db.architectProjectUpdate.findUnique({ where: { id: update.id } });
    assert.equal(
      proposal?.status === REPLAN_PROPOSAL_STATUS.APPLIED
        ? linked?.status
        : proposal?.status === REPLAN_PROPOSAL_STATUS.DISMISSED
          ? linked?.status
          : null,
      proposal?.status,
    );
  });
});

describe("abandon", () => {
  it("ecarte la replanification et sa mise a jour ensemble", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "Intacte");
    const generationId = await newGeneration(projectId);
    const update = await db.architectProjectUpdate.create({
      data: {
        generationId,
        projectId,
        status: "PENDING",
        reason: "Le perimetre change.",
        proposedJson: JSON.stringify({ reason: "x" }),
        baseBriefRevision: null,
        basePlanRevision: null,
      },
      select: { id: true },
    });
    const proposalId = await pendingProposal(projectId, { projectUpdateId: update.id });

    const before = await getTaskById(db, taskId);
    const dismissed = await dismissReplanProposal(db, { projectId, proposalId });

    assert.ok(dismissed.ok);
    assert.equal(dismissed.projectUpdateId, update.id);
    assert.equal(
      (await getReplanProposal(db, projectId, proposalId))?.status,
      REPLAN_PROPOSAL_STATUS.DISMISSED,
    );
    assert.equal(
      (await db.architectProjectUpdate.findUnique({ where: { id: update.id } }))?.status,
      "DISMISSED",
    );
    assert.deepEqual(await getTaskById(db, taskId), before, "aucune tache touchee");
  });

  it("refuse d'ecarter deux fois", async () => {
    const projectId = await newProject();
    const proposalId = await pendingProposal(projectId);

    assert.ok((await dismissReplanProposal(db, { projectId, proposalId })).ok);
    const second = await dismissReplanProposal(db, { projectId, proposalId });
    assert.equal(second.ok, false);
    assert.equal(second.ok ? null : second.reason, "not_pending");
  });
});

describe("payloads", () => {
  it("conserve la proposition du fournisseur intacte et distingue la cible appliquee", async () => {
    const projectId = await newProject();
    const proposalId = await pendingProposal(projectId);
    const provided = (await getReplanProposal(db, projectId, proposalId))?.providerJson;

    const applied = await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [create("N1", "Nouvelle")], {
        appliedJson: JSON.stringify({ retenu: "la version humaine" }),
      }),
    );
    assert.ok(applied.ok);

    const after = await getReplanProposal(db, projectId, proposalId);
    assert.equal(after?.providerJson, provided, "providerJson n'est jamais reecrit");
    assert.equal(after?.appliedJson, JSON.stringify({ retenu: "la version humaine" }));
    assert.notEqual(after?.appliedJson, after?.providerJson);
  });
});

describe("appartenance", () => {
  it("ne trouve pas une proposition d'un autre projet", async () => {
    const alpha = await newProject();
    const beta = await newProject();
    const proposalId = await pendingProposal(alpha);

    const applied = await applyReplanProposal(db, applyInput(beta, proposalId, []));
    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "not_found");
    assert.equal(
      (await getReplanProposal(db, alpha, proposalId))?.status,
      REPLAN_PROPOSAL_STATUS.PENDING,
    );
  });

  it("refuse de designer une tache d'un autre projet", async () => {
    const alpha = await newProject();
    const beta = await newProject();
    const etrangere = await newTask(beta, "Etrangere");
    const contract = await contractOf(beta, etrangere);

    const proposalId = await pendingProposal(alpha);
    const applied = await applyReplanProposal(
      db,
      applyInput(alpha, proposalId, [
        {
          existingTaskId: etrangere,
          tempId: null,
          values: contract,
          dependsOnTaskIds: [],
          dependsOnTempIds: [],
        },
      ]),
    );

    // Une tache d'un autre projet est simplement absente de l'etat de
    // planification relu : le controle de peremption la nomme avant meme que le
    // graphe ne soit examine, et refuse.
    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "stale");
    assert.deepEqual(
      staleOf(applied).tasks.map((task) => task.reason),
      ["MISSING"],
    );
    assert.notEqual(await getTaskById(db, etrangere), null, "aucune mutation dans l'autre projet");
  });
});

describe("etat de planification relu", () => {
  it("est celui de la transaction, pas celui de l'appelant", async () => {
    // Une garantie de forme : la fonction d'empreinte recoit un etat, et cet
    // etat vient de la base au moment d'ecrire. Le test l'observe.
    const projectId = await newProject();
    await newTask(projectId, "Observee");
    const proposalId = await pendingProposal(projectId);

    let seen: ReplanPlanningState | null = null;
    await applyReplanProposal(
      db,
      applyInput(projectId, proposalId, [], {
        fingerprint: (input) => {
          seen = input.state;
          return FINGERPRINT(input);
        },
      }),
    );

    assert.notEqual(seen, null);
    assert.equal((seen as unknown as ReplanPlanningState).tasks.length, 1);
  });
});
