/**
 * Le rafraichissement des plans de verification, de bout en bout.
 *
 * ## Le scenario, et pourquoi c'est celui-la
 *
 * Celui du premier pilote reel, TripKit, rejoue sur une vraie base :
 *
 * ```text
 * avant TASK-000 : TASK-001 → 8 HUMAN,  TASK-002 → 7 HUMAN
 * apres TASK-000 : npm test et npm run build existent
 * attendu        : TASK-001 → 6 AUTO / 2 HUMAN,  TASK-002 → 7 AUTO / 0 HUMAN
 * ```
 *
 * Ce resultat, le pilote l'a obtenu — mais seulement parce que son utilisateur
 * savait qu'il fallait retourner dans la conversation Architecte et demander
 * une replanification des seuls plans de verification. C'est cette connaissance
 * prealable que TASK-033 supprime.
 *
 * ## Aucun appel reel
 *
 * Faux fournisseur, faux repository, base temporaire. Zero OpenAI, zero Claude
 * Code, zero reseau — la regle de tous les tests automatises de NOX.
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
  TASK_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
  VERIFICATION_MODE,
  VERIFICATION_REFRESH_REFUSAL,
  VERIFICATION_REFRESH_SCHEMA_NAME,
  VERIFICATION_REFRESH_SCHEMA_VERSION,
  VERIFICATION_REFRESH_STATUS,
  type ArchitectPromptBrief,
  type ArchitectPromptV1Plan,
  type ProjectBriefInput,
  type ProjectV1PlanInput,
} from "@nox/shared";
import {
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  getTaskById,
  listTasksByProject,
  readVerificationPlan,
  saveProjectBrief,
  saveProjectV1Plan,
  toDatabaseFilePath,
  toSqliteUrl,
  updateTaskStatus,
  writeTaskRow,
  writeVerificationPlan,
  type DatabaseClient,
  type ProjectPlanTools,
} from "@nox/database";

import { FakeArchitectProvider, type ArchitectProviderResult } from "../architect/provider.ts";
import type { ArchitectRepositoryPorts } from "../architect/service.ts";
import { maybeRefreshVerificationPlans } from "./service.ts";

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
    brief: (brief: ArchitectPromptBrief) => hashOf(["brief", brief.summary]),
    plan: (plan: ArchitectPromptV1Plan) => hashOf(["plan", plan.goal]),
  },
};

const BRIEF: ProjectBriefInput = {
  summary: "Un carnet de deplacements professionnels.",
  problem: "Mes notes de deplacement sont eparpillees.",
  targetUsers: "Moi seul.",
  desiredOutcome: "Retrouver un deplacement et ses frais.",
  goals: ["Enregistrer un deplacement"],
  nonGoals: ["Synchronisation multi-appareils"],
};

const PLAN: ProjectV1PlanInput = {
  goal: "Suivre mes deplacements et leurs frais.",
  inScope: ["Deplacements", "Notes de frais"],
  outOfScope: ["Mobile"],
  technicalDirection: "Application web locale.",
  milestones: ["Les deplacements sont utilisables"],
};

/** Le repository apres l'amorcage : un README qui documente les commandes. */
const AFTER_BOOTSTRAP: ArchitectRepositoryPorts = {
  listDocuments: () =>
    Promise.resolve({
      ok: true,
      value: [
        { path: "README.md", title: "README", category: "ROOT", bytes: 120, modifiedAt: null },
      ] as never,
    }),
  readDocument: (_repository: string, documentPath: string) =>
    Promise.resolve({
      ok: true,
      value: {
        path: documentPath,
        content: "# TripKit\n\n- `npm test`\n- `npm run build`\n",
        revision: "a".repeat(64),
      },
    }),
};

/** Le repository injoignable : le runner est arrete. */
const UNREACHABLE: ArchitectRepositoryPorts = {
  listDocuments: () =>
    Promise.resolve({ ok: false, failure: { kind: "unreachable" } as never }),
  readDocument: () => Promise.resolve({ ok: false, failure: { kind: "unreachable" } as never }),
};

function success(raw: unknown): ArchitectProviderResult {
  return {
    ok: true,
    value: {
      raw,
      responseId: "resp_test",
      usage: { inputTokens: 900, outputTokens: 300, totalTokens: 1200, cachedInputTokens: null },
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

type Pilot = {
  project: { id: string; name: string; repositoryPath: string };
  bootstrapId: string;
  first: string;
  second: string;
};

/**
 * L'etat exact du pilote juste apres l'acceptation de `TASK-000`.
 *
 * Deux taches futures, entierement humaines — ce que le planificateur produit
 * necessairement sur un repository vide, et ce qu'il a raison de produire.
 */
async function newPilot(options: { humanOnly?: boolean } = {}): Promise<Pilot> {
  counter += 1;
  const project = await createProject(db, {
    name: `TripKit ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });

  assert.ok((await saveProjectBrief(db, { projectId: project.id, values: BRIEF, tools: TOOLS })).ok);
  assert.ok((await saveProjectV1Plan(db, { projectId: project.id, values: PLAN, tools: TOOLS })).ok);
  await appliedBacklog(project.id);

  const bootstrap = await createBootstrap(project.id);
  const first = await futureTask(project.id, "Gerer les deplacements et leurs hotels", 8, options);
  const second = await futureTask(project.id, "Gerer les notes de frais et leur total", 7, options);

  return { project, bootstrapId: bootstrap, first, second };
}

/** Un backlog applique : la condition de replanification d'un projet. */
async function appliedBacklog(projectId: string): Promise<void> {
  const generation = await db.architectBacklogGeneration.create({
    data: {
      projectId,
      sequence: 1,
      status: "PROPOSAL_READY",
      model: "modele-de-test",
      promptVersion: "backlog/3",
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
      projectId,
      status: "APPLIED",
      message: "Backlog initial.",
      taskCount: 2,
      providerJson: "{}",
      appliedAt: new Date(),
    },
  });
}

/** `TASK-000`, acceptee : l'evenement qui declenche tout. */
async function createBootstrap(projectId: string): Promise<string> {
  const bootstrap = await writeTaskRow(db, {
    projectId,
    sequence: 0,
    kind: TASK_KIND.BOOTSTRAP,
    title: "Bootstrap project repository",
    objective: "Etablir la fondation technique.",
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.HIGH,
    acceptanceCriteria: ["Le repository demarre."],
    documentReferences: [],
    validationCommands: [],
  });
  // Le statut passe par la table des transitions, jamais par une ecriture
  // directe : `DRAFT` puis `READY` puis `COMPLETED`, exactement le chemin
  // qu'un humain emprunte quand il accepte un amorcage.
  for (const status of [TASK_STATUS.READY, TASK_STATUS.COMPLETED]) {
    const moved = await updateTaskStatus(db, bootstrap.id, projectId, status);
    assert.ok(moved.ok, `transition vers ${status}`);
  }
  return bootstrap.id;
}

/** Une tache future, entierement humaine avant le rafraichissement. */
async function futureTask(
  projectId: string,
  title: string,
  criteria: number,
  options: { humanOnly?: boolean },
): Promise<string> {
  const task = await createTask(db, {
    projectId,
    title,
    objective: `Objectif de ${title}.`,
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: Array.from({ length: criteria }, (_, index) => `${title} — critere ${String(index + 1)}`),
    documentReferences: [],
    validationCommands: [],
  });
  assert.ok(task !== null);

  await writeVerificationPlan(db, task.id, {
    criteria: task.acceptanceCriteria.map((text) => ({
      text,
      verificationMode:
        options.humanOnly === false ? VERIFICATION_MODE.AUTOMATED : VERIFICATION_MODE.HUMAN,
      humanInstructions: options.humanOnly === false ? null : "Verifier a la main.",
      commandPositions: options.humanOnly === false ? [0] : [],
    })),
    commands:
      options.humanOnly === false
        ? [{ command: "npm test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS }]
        : [],
  });

  return task.id;
}

/** La reponse du pilote, telle que l'Architecte l'avait rendue. */
function refreshPayload(pilot: Pilot, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const automated = {
    verificationMode: VERIFICATION_MODE.AUTOMATED,
    humanInstructions: null,
    validationCommandIndexes: [0],
  };
  const human = {
    verificationMode: VERIFICATION_MODE.HUMAN,
    humanInstructions: "Ouvrir la fiche et regarder la mise en page.",
    validationCommandIndexes: [],
  };
  const commands = [
    { command: "npm test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
    { command: "npm run build", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
  ];

  return {
    schemaVersion: VERIFICATION_REFRESH_SCHEMA_VERSION,
    message: "6 criteres passent en AUTOMATED sur TASK-001, 2 restent humains ; TASK-002 est entierement automatisee.",
    tasks: [
      {
        taskId: pilot.first,
        criteria: [automated, automated, human, human, automated, automated, automated, automated],
        validationCommands: commands,
      },
      {
        taskId: pilot.second,
        criteria: Array.from({ length: 7 }, () => automated),
        validationCommands: commands,
      },
    ],
    ...overrides,
  };
}

function refresh(
  pilot: Pilot,
  provider: FakeArchitectProvider,
  ports: ArchitectRepositoryPorts = AFTER_BOOTSTRAP,
) {
  return maybeRefreshVerificationPlans(db, {
    project: pilot.project,
    taskId: pilot.bootstrapId,
    provider,
    model: "modele-de-test",
    environment: {},
    ports,
  });
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-refresh-pilot-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("Scenario 1 — TripKit greenfield", () => {
  it("reclasse exactement ce que le pilote avait obtenu a la main", async () => {
    const pilot = await newPilot();
    const provider = new FakeArchitectProvider([success(refreshPayload(pilot))]);

    const result = await refresh(pilot, provider);
    assert.ok(result.attempted, JSON.stringify(result));
    assert.equal(result.refresh.status, VERIFICATION_REFRESH_STATUS.APPLIED);

    const first = await readVerificationPlan(db, pilot.first);
    const second = await readVerificationPlan(db, pilot.second);

    assert.equal(
      first.criteria.filter((c) => c.verificationMode === VERIFICATION_MODE.AUTOMATED).length,
      6,
    );
    assert.equal(
      first.criteria.filter((c) => c.verificationMode === VERIFICATION_MODE.HUMAN).length,
      2,
    );
    assert.equal(
      second.criteria.filter((c) => c.verificationMode === VERIFICATION_MODE.AUTOMATED).length,
      7,
    );
    assert.equal(
      second.criteria.filter((c) => c.verificationMode === VERIFICATION_MODE.HUMAN).length,
      0,
    );
  });

  it("passe exactement un appel au fournisseur", async () => {
    const pilot = await newPilot();
    const provider = new FakeArchitectProvider([success(refreshPayload(pilot))]);

    await refresh(pilot, provider);

    assert.equal(provider.refreshCalls.length, 1);
    assert.equal(provider.turnCalls.length, 0, "aucun tour de conversation");
    assert.equal(provider.backlogCalls.length, 0, "aucune planification");
    assert.equal(provider.reviewCalls.length, 0, "aucune review");

    const call = provider.refreshCalls[0];
    assert.ok(call !== undefined);
    assert.equal(call.schemaName, VERIFICATION_REFRESH_SCHEMA_NAME);
    assert.equal("tools" in call, false, "aucun outil n'est declare");
  });

  it("ne modifie aucun champ produit", async () => {
    const pilot = await newPilot();
    const before = await listTasksByProject(db, pilot.project.id);
    const beforePlan = await readVerificationPlan(db, pilot.first);

    await refresh(pilot, new FakeArchitectProvider([success(refreshPayload(pilot))]));

    const after = await listTasksByProject(db, pilot.project.id);
    assert.deepEqual(
      after.map((task) => [task.code, task.title, task.status, task.priority]),
      before.map((task) => [task.code, task.title, task.status, task.priority]),
      "codes, titres, statuts et priorites sont intacts",
    );

    const afterPlan = await readVerificationPlan(db, pilot.first);
    assert.deepEqual(
      afterPlan.criteria.map((criterion) => criterion.text),
      beforePlan.criteria.map((criterion) => criterion.text),
      "le texte de chaque critere est identique, octet pour octet",
    );
    assert.deepEqual(
      afterPlan.criteria.map((criterion) => criterion.position),
      beforePlan.criteria.map((criterion) => criterion.position),
      "l'ordre des criteres est intact",
    );

    for (const task of after) {
      const dependencies = await db.taskDependency.count({ where: { taskId: task.id } });
      assert.equal(dependencies, 0, "aucune dependance n'a ete creee ni retiree");
      const queued = await db.taskQueueEntry.count({ where: { taskId: task.id } });
      assert.equal(queued, 0, "aucune inscription en file");
    }
  });

  it("enregistre le cout, comme les autres appels Architecte", async () => {
    const pilot = await newPilot();
    await refresh(pilot, new FakeArchitectProvider([success(refreshPayload(pilot))]));

    const row = await db.verificationRefresh.findFirst({ where: { projectId: pilot.project.id } });
    assert.ok(row !== null);
    assert.equal(row.inputTokens, 900);
    assert.equal(row.outputTokens, 300);
    assert.equal(row.totalTokens, 1200);
    assert.equal(row.model, "modele-de-test");
    assert.equal(row.promptVersion, "verification-refresh/1");
    assert.equal(row.changedTaskCount, 2);
    assert.equal(row.automatedCount, 13);
    assert.equal(row.humanCount, 2);
  });

  it("refuse un second declenchement, sans appeler personne", async () => {
    const pilot = await newPilot();
    await refresh(pilot, new FakeArchitectProvider([success(refreshPayload(pilot))]));

    // Un amorcage rouvert puis re-accepte ne repaie pas un appel — y compris
    // sur le plan que le premier rafraichissement vient de produire, dont
    // l'empreinte differe forcement de celle qui a ete enregistree.
    const again = new FakeArchitectProvider([]);
    const second = await refresh(pilot, again);

    assert.equal(again.refreshCalls.length, 0, "zero appel");
    assert.deepEqual(second, {
      attempted: false,
      code: VERIFICATION_REFRESH_REFUSAL.ALREADY_DONE,
    });
  });

  it("ne rafraichit rien quand tout est deja automatise", async () => {
    const pilot = await newPilot({ humanOnly: false });
    const provider = new FakeArchitectProvider([]);

    const result = await refresh(pilot, provider);
    assert.deepEqual(result, {
      attempted: false,
      code: VERIFICATION_REFRESH_REFUSAL.NOTHING_TO_IMPROVE,
    });
    assert.equal(provider.refreshCalls.length, 0);
  });

  it("ne se declenche pas sur une tache qui n'est pas un amorcage", async () => {
    const pilot = await newPilot();
    const provider = new FakeArchitectProvider([]);

    const result = await maybeRefreshVerificationPlans(db, {
      project: pilot.project,
      taskId: pilot.first,
      provider,
      model: "modele-de-test",
      environment: {},
      ports: AFTER_BOOTSTRAP,
    });

    assert.deepEqual(result, {
      attempted: false,
      code: VERIFICATION_REFRESH_REFUSAL.NOT_BOOTSTRAP,
    });
    assert.equal(provider.refreshCalls.length, 0);
  });

  it("ne se declenche pas tant que l'amorcage n'est pas accepte", async () => {
    const pilot = await newPilot();
    await db.task.update({
      where: { id: pilot.bootstrapId },
      data: { status: TASK_STATUS.REVIEW },
    });

    const provider = new FakeArchitectProvider([]);
    const result = await refresh(pilot, provider);

    assert.deepEqual(result, {
      attempted: false,
      code: VERIFICATION_REFRESH_REFUSAL.BOOTSTRAP_NOT_ACCEPTED,
    });
    assert.equal(provider.refreshCalls.length, 0);
  });

  it("ne se declenche pas quand une execution occupe le repository", async () => {
    const pilot = await newPilot();
    const ready = await updateTaskStatus(db, pilot.first, pilot.project.id, TASK_STATUS.READY);
    assert.ok(ready.ok);
    const run = await createRun(db, {
      projectId: pilot.project.id,
      taskId: pilot.first,
      prompt: "Prompt de test.",
      promptSha256: "e".repeat(64),
      runnerRunId: `runner-${String(counter)}`,
    });
    assert.ok(run.ok, JSON.stringify(run));

    const provider = new FakeArchitectProvider([]);
    const result = await refresh(pilot, provider);

    assert.deepEqual(result, {
      attempted: false,
      code: VERIFICATION_REFRESH_REFUSAL.REPOSITORY_BUSY,
    });
    assert.equal(provider.refreshCalls.length, 0);
  });

  it("ne se declenche pas quand le repository ne repond pas", async () => {
    const pilot = await newPilot();
    const provider = new FakeArchitectProvider([]);

    const result = await refresh(pilot, provider, UNREACHABLE);

    assert.deepEqual(result, {
      attempted: false,
      code: VERIFICATION_REFRESH_REFUSAL.CONTEXT_UNAVAILABLE,
    });
    assert.equal(provider.refreshCalls.length, 0);
  });

  it("synchronise le document des seules taches changees", async () => {
    const pilot = await newPilot();
    const synced: string[][] = [];

    await maybeRefreshVerificationPlans(db, {
      project: pilot.project,
      taskId: pilot.bootstrapId,
      provider: new FakeArchitectProvider([
        success({
          ...refreshPayload(pilot),
          tasks: [(refreshPayload(pilot)["tasks"] as unknown[])[0]],
        }),
      ]),
      model: "modele-de-test",
      environment: {},
      ports: AFTER_BOOTSTRAP,
      syncDocuments: (_db, _project, taskIds) => {
        synced.push([...taskIds]);
        return Promise.resolve();
      },
    });

    assert.deepEqual(synced, [[pilot.first]], "seule la tache reecrite est resynchronisee");
  });
});

describe("Scenario 2 — le fournisseur sort du contrat", () => {
  it("refuse toute la proposition, sans modifier une seule tache", async () => {
    const pilot = await newPilot();
    const before = await readVerificationPlan(db, pilot.first);

    const body = refreshPayload(pilot);
    const tasks = body["tasks"] as Record<string, unknown>[];
    tasks[0] = { ...tasks[0], title: "Un titre reecrit", objective: "Un objectif reecrit" };

    const provider = new FakeArchitectProvider([success(body)]);
    const result = await refresh(pilot, provider);

    assert.ok(result.attempted);
    assert.equal(result.refresh.status, VERIFICATION_REFRESH_STATUS.REFUSED);
    assert.deepEqual(result.changedTaskIds, []);

    const after = await readVerificationPlan(db, pilot.first);
    assert.deepEqual(after, before, "aucune tache n'a bouge");

    // Aucune tache modifiee, y compris celle qui etait valide : un backlog de
    // verification est une unite, exactement comme un backlog de taches.
    const second = await readVerificationPlan(db, pilot.second);
    assert.equal(
      second.criteria.every((c) => c.verificationMode === VERIFICATION_MODE.HUMAN),
      true,
    );
  });

  it("enregistre un diagnostic explicite, et ne reessaie jamais", async () => {
    const pilot = await newPilot();
    const body = refreshPayload(pilot);
    const tasks = body["tasks"] as Record<string, unknown>[];
    tasks[0] = { ...tasks[0], dependsOn: [pilot.second] };

    const provider = new FakeArchitectProvider([success(body)]);
    const result = await refresh(pilot, provider);

    assert.ok(result.attempted);
    assert.equal(provider.refreshCalls.length, 1, "un seul appel : aucun reessai automatique");
    assert.equal(result.refresh.errorField, "tasks.0.dependsOn");
    assert.match(String(result.refresh.errorDetail), /hors contrat/u);
  });

  it("conclut proprement quand le fournisseur echoue", async () => {
    const pilot = await newPilot();
    const provider = new FakeArchitectProvider([
      { ok: false, code: "ARCHITECT_PROVIDER_ERROR" },
    ]);

    const result = await refresh(pilot, provider);
    assert.ok(result.attempted);
    assert.equal(result.refresh.status, VERIFICATION_REFRESH_STATUS.FAILED);
    assert.equal(result.refresh.errorCode, "ARCHITECT_PROVIDER_ERROR");

    const plan = await readVerificationPlan(db, pilot.first);
    assert.equal(
      plan.criteria.every((c) => c.verificationMode === VERIFICATION_MODE.HUMAN),
      true,
      "les taches restent exactement ce qu'elles etaient",
    );
  });

  it("laisse la reservation posee : un echec ne rouvre pas un appel", async () => {
    const pilot = await newPilot();
    await refresh(pilot, new FakeArchitectProvider([{ ok: false, code: "ARCHITECT_TIMEOUT" }]));

    const again = new FakeArchitectProvider([success(refreshPayload(pilot))]);
    const second = await refresh(pilot, again);

    assert.deepEqual(second, {
      attempted: false,
      code: VERIFICATION_REFRESH_REFUSAL.ALREADY_DONE,
    });
    assert.equal(again.refreshCalls.length, 0, "le meme etat ne se paie pas deux fois");
  });
});

describe("l'amorcage lui-meme n'est jamais touche", () => {
  it("ne reecrit ni son contrat, ni son statut", async () => {
    const pilot = await newPilot();
    const before = await getTaskById(db, pilot.bootstrapId);
    await refresh(pilot, new FakeArchitectProvider([success(refreshPayload(pilot))]));
    const after = await getTaskById(db, pilot.bootstrapId);

    assert.equal(after?.status, before?.status);
    assert.equal(after?.title, before?.title);
    assert.equal(after?.objective, before?.objective);
    assert.equal(after?.code, "TASK-000");
  });
});
