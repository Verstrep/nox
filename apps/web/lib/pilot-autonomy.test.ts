/**
 * Le workflow autonome, rejoue sur le scenario du premier pilote reel.
 *
 * ## Ce que ce fichier parcourt
 *
 * La chaine entiere apres le travail de l'agent, sur une vraie base :
 *
 * ```text
 * validation autonome → decision → livraison Git → avancement de la file
 * ```
 *
 * Les tests unitaires prouvent chaque piece separement. Celui-ci prouve
 * qu'elles s'emboitent, et surtout **ou la chaine s'arrete** : un critere
 * humain, une preuve en echec, une panne d'infrastructure, un push refuse. Ce
 * sont les quatre endroits ou un workflow trop autonome ferait le plus de
 * degats.
 *
 * ## Aucun appel reel
 *
 * Faux runner, base temporaire, repositories simules. Zero OpenAI, zero Claude
 * Code, zero reseau, zero push. C'est la regle de tous les tests automatises de
 * NOX, et elle n'a pas d'exception ici.
 *
 * ## Le scenario, et pourquoi c'est celui-la
 *
 * TripKit. `TASK-001` melange six criteres automatises et deux humains :
 * elle doit revenir a un humain. `TASK-002` est entierement automatisee et
 * passe : elle doit se terminer seule, et livrer selon la politique du projet.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AUTONOMOUS_VALIDATION_STATUS,
  COMMAND_EXECUTION_MODE,
  CRITERION_VERIFICATION_RESULT,
  DELIVERY_POLICY,
  DELIVERY_STATUS,
  DELIVERY_TRIGGER,
  RUNNER_ERROR,
  REVIEW_DECISION_SOURCE,
  TASK_PRIORITY,
  TASK_STATUS,
  TASK_VERIFICATION_OUTCOME,
  VALIDATION_BATCH_STATUS,
  summarizeTaskDependencies,
  VERIFICATION_MODE,
  deriveCriterionResults,
  deriveTaskVerificationOutcome,
  type DeliveryInspection,
  type DeliveryPolicy,
} from "@nox/shared";
import {
  completeRun,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  enqueueTask,
  getLatestDeliveryForTask,
  addTaskDependency,
  getLatestValidationBatch,
  getTaskById,
  listTaskDependencies,
  readVerificationPlan,
  setProjectDeliveryPolicy,
  setQueueActive,
  startTaskExecution,
  toDatabaseFilePath,
  toSqliteUrl,
  updateTaskStatus,
  writeVerificationPlan,
  type DatabaseClient,
} from "@nox/database";

import { runAutonomousValidation, type AutonomousValidationPorts } from "./autonomous-validation.ts";
import { maybeDeliver, retryDeliveryPush, runDelivery, type DeliveryPorts } from "./git-delivery.ts";

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

// ---------------------------------------------------------------------------
// Le faux runner de validation
// ---------------------------------------------------------------------------

type CommandOutcome = { exitCode: number | null; timedOut?: boolean };

/**
 * Le runner, remplace par une doublure.
 *
 * `spawn` simule l'impossibilite de creer le processus : c'est exactement
 * `VALIDATION_SPAWN_FAILED`, la panne que HOTFIX-002 a corrigee et dont le
 * scenario 6 verifie qu'elle ne vaut jamais une preuve.
 */
function validationPorts(options: {
  outcomes?: Record<string, CommandOutcome>;
  spawnFails?: boolean;
  mutates?: boolean;
}): AutonomousValidationPorts & { commands: string[] } {
  const commands: string[] = [];
  let state = 0;

  return {
    commands,
    run: (request) => {
      commands.push(request.command);
      if (options.spawnFails === true) {
        return Promise.resolve({
          ok: false,
          failure: { kind: "runner_error", code: RUNNER_ERROR.VALIDATION_SPAWN_FAILED },
        } as never);
      }
      if (options.mutates === true) {
        state += 1;
      }
      const outcome = options.outcomes?.[request.command] ?? { exitCode: 0 };
      return Promise.resolve({
        ok: true,
        value: {
          ok: true,
          exitCode: outcome.exitCode,
          timedOut: outcome.timedOut ?? false,
          durationMs: 42,
          stdout: "",
          stdoutTruncated: false,
          stderr: "",
          stderrTruncated: false,
        },
      } as never);
    },
    trackedState: () =>
      Promise.resolve({
        ok: true,
        value: { ok: true, digest: `digest-${String(state)}`, files: [] },
      } as never),
  };
}

// ---------------------------------------------------------------------------
// Le faux runner de livraison
// ---------------------------------------------------------------------------

const CANDIDATE = [{ code: " M", path: "src/expenses.ts" }] as const;

function inspection(overrides: Partial<DeliveryInspection> = {}): DeliveryInspection {
  return {
    branch: "main",
    head: "a".repeat(40),
    headParents: [],
    headTrailerMatches: false,
    upstreamRemote: "origin",
    upstreamRef: "refs/heads/main",
    upstreamCommit: "a".repeat(40),
    indexDirty: false,
    entries: [...CANDIDATE],
    omittedEntries: 0,
    fingerprint: "b".repeat(64),
    identityComplete: true,
    signingConfigured: false,
    hooks: [],
    ...overrides,
  };
}

type DeliveryLog = { commits: number; pushes: number };

/**
 * Le runner de livraison, remplace par une doublure qui compte ses ecritures.
 *
 * `reset()` rend le meme repository avec un push qui ne refuse plus : c'est ce
 * que produit un `Retry push` apres qu'un incident distant a ete regle. Le
 * commit local, lui, reste en place — et c'est tout l'objet du scenario 10.
 */
function deliveryPorts(options: { pushFails?: boolean } = {}): DeliveryPorts & {
  log: DeliveryLog;
  reset: () => DeliveryPorts;
} {
  const log: DeliveryLog = { commits: 0, pushes: 0 };
  let committed = false;
  let pushFails = options.pushFails === true;

  return {
    log,
    reset() {
      pushFails = false;
      return this;
    },
    inspect: () =>
      Promise.resolve({
        ok: true,
        value: {
          ok: true,
          inspection: inspection(
            committed
              ? { head: "c".repeat(40), headParents: ["a".repeat(40)], headTrailerMatches: true, entries: [] }
              : {},
          ),
        },
      } as never),
    commit: () => {
      log.commits += 1;
      committed = true;
      return Promise.resolve({
        ok: true,
        value: {
          ok: true,
          commitSha: "c".repeat(40),
          alreadyCommitted: false,
          worktreeClean: true,
          failureCode: null,
          failureDetail: null,
        },
      } as never);
    },
    push: () => {
      log.pushes += 1;
      if (pushFails) {
        return Promise.resolve({
          ok: true,
          value: {
            ok: true,
            pushed: false,
            alreadyPushed: false,
            remote: "origin",
            remoteRef: "refs/heads/main",
            failureCode: RUNNER_ERROR.DELIVERY_PUSH_REJECTED,
            failureDetail: null,
          },
        } as never);
      }
      return Promise.resolve({
        ok: true,
        value: {
          ok: true,
          pushed: true,
          alreadyPushed: false,
          remote: "origin",
          remoteRef: "refs/heads/main",
          failureCode: null,
          failureDetail: null,
        },
      } as never);
    },
  };
}

// ---------------------------------------------------------------------------
// Le decor
// ---------------------------------------------------------------------------

type Fixture = {
  project: { id: string; name: string; repositoryPath: string };
  taskId: string;
  runId: string;
};

type Shape = {
  /** Nombre de criteres automatises. */
  automated: number;
  /** Nombre de criteres humains. */
  human: number;
  commands?: readonly string[];
};

async function newProject(policy: DeliveryPolicy = DELIVERY_POLICY.MANUAL) {
  counter += 1;
  const project = await createProject(db, {
    name: `TripKit ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  if (policy !== DELIVERY_POLICY.MANUAL) {
    assert.ok((await setProjectDeliveryPolicy(db, project.id, policy)).ok);
  }
  return project;
}

/** Une tache dont l'execution vient de se terminer : `REVIEW`, run `COMPLETED`. */
async function newRunAwaitingReview(
  project: { id: string; name: string; repositoryPath: string },
  shape: Shape,
  title = "Gerer les notes de frais et leur total",
): Promise<Fixture> {
  const commands = shape.commands ?? ["npm test"];
  const criteria = [
    ...Array.from({ length: shape.automated }, (_, index) => `Critere automatise ${String(index + 1)}`),
    ...Array.from({ length: shape.human }, (_, index) => `Critere humain ${String(index + 1)}`),
  ];

  const task = await createTask(db, {
    projectId: project.id,
    title,
    objective: `Objectif de ${title}.`,
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: criteria,
    documentReferences: [],
    validationCommands: [...commands],
  });
  assert.ok(task !== null);

  await writeVerificationPlan(db, task.id, {
    criteria: criteria.map((text, index) => ({
      text,
      verificationMode:
        index < shape.automated ? VERIFICATION_MODE.AUTOMATED : VERIFICATION_MODE.HUMAN,
      humanInstructions: index < shape.automated ? null : "Ouvrir l'ecran et regarder.",
      commandPositions: index < shape.automated ? [0] : [],
    })),
    commands: commands.map((command) => ({
      command,
      executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS,
    })),
  });

  assert.ok((await updateTaskStatus(db, task.id, project.id, TASK_STATUS.READY)).ok);
  assert.ok(await startTaskExecution(db, task.id));

  counter += 1;
  const run = await createRun(db, {
    projectId: project.id,
    taskId: task.id,
    prompt: "Prompt de test.",
    promptSha256: "e".repeat(64),
    runnerRunId: `runner-${String(counter)}`,
  });
  assert.ok(run.ok, JSON.stringify(run));
  assert.ok((await completeRun(db, run.run.id)) !== null);

  return { project, taskId: task.id, runId: run.run.id };
}

/** Le code seul : l'entete d'un module nomme ce qu'il refuse, et c'est voulu. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/.*$/gmu, " ");
}

/** Une tache prete, inscrite dans la file : de quoi rendre la file activable. */
async function enqueueNext(projectId: string, title: string): Promise<string> {
  const task = await createTask(db, {
    projectId,
    title,
    objective: `Objectif de ${title}.`,
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: ["Un critere"],
    documentReferences: [],
    validationCommands: [],
  });
  assert.ok(task !== null);
  assert.ok((await updateTaskStatus(db, task.id, projectId, TASK_STATUS.READY)).ok);
  assert.ok((await enqueueTask(db, { projectId, taskId: task.id })).ok);
  return task.id;
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-pilot-autonomy-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// ---------------------------------------------------------------------------
// Scenario 3 — TASK-001 : verification mixte
// ---------------------------------------------------------------------------

describe("Scenario 3 — six preuves passent, deux criteres restent humains", () => {
  it("ne se termine pas seule, et attend un humain", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(
      project,
      { automated: 6, human: 2 },
      "Gerer les deplacements et leurs hotels",
    );

    const outcome = await runAutonomousValidation(db, fixture.runId, {}, validationPorts({}));
    assert.ok(outcome.ran);
    assert.equal(outcome.batchStatus, VALIDATION_BATCH_STATUS.PASSED);
    assert.equal(outcome.autoCompleted, false, "un seul critere humain suffit a rendre la main");

    const task = await getTaskById(db, fixture.taskId);
    assert.equal(task?.status, TASK_STATUS.REVIEW);
  });

  it("prouve les six criteres automatises, et ne coche aucun critere humain", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 6, human: 2 });
    await runAutonomousValidation(db, fixture.runId, {}, validationPorts({}));

    const plan = await readVerificationPlan(db, fixture.taskId);
    const batch = await getLatestValidationBatch(db, fixture.runId);
    assert.ok(batch !== null);
    const results = deriveCriterionResults(
      plan,
      batch.results
        .filter((entry) => entry.commandId !== null)
        .map((entry) => ({ commandId: entry.commandId ?? "", status: entry.status })),
    );

    assert.equal(
      results.filter((entry) => entry.result === CRITERION_VERIFICATION_RESULT.PASSED).length,
      6,
    );
    assert.equal(
      results.filter((entry) => entry.result === CRITERION_VERIFICATION_RESULT.HUMAN).length,
      2,
      "NOX ne coche jamais un critere humain lui-meme",
    );
    assert.equal(
      deriveTaskVerificationOutcome(results),
      TASK_VERIFICATION_OUTCOME.HUMAN_REQUIRED,
    );
  });

  it("ne declenche aucune livraison", async () => {
    const project = await newProject(DELIVERY_POLICY.AUTO_COMMIT);
    const fixture = await newRunAwaitingReview(project, { automated: 6, human: 2 });
    await runAutonomousValidation(db, fixture.runId, {}, validationPorts({}));

    assert.equal(await getLatestDeliveryForTask(db, fixture.taskId), null);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — TASK-002 : automatisation complete
// ---------------------------------------------------------------------------

describe("Scenario 4 — sept preuves passent, aucun critere humain", () => {
  it("se termine sans clic, et l'historique dit que personne n'a clique", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });

    const ports = validationPorts({});
    const outcome = await runAutonomousValidation(db, fixture.runId, {}, ports);

    assert.ok(outcome.ran);
    assert.equal(outcome.batchStatus, VALIDATION_BATCH_STATUS.PASSED);
    assert.equal(outcome.autoCompleted, true);

    const task = await getTaskById(db, fixture.taskId);
    assert.equal(task?.status, TASK_STATUS.COMPLETED);

    const decision = await db.runReviewDecision.findFirst({ where: { runId: fixture.runId } });
    assert.equal(decision?.source, REVIEW_DECISION_SOURCE.AUTOMATED);
    assert.equal(decision?.overrideReason, null, "une completion automatique n'est pas un passage en force");
  });

  it("execute la commande enregistree, telle qu'elle est enregistree", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });
    const ports = validationPorts({});
    await runAutonomousValidation(db, fixture.runId, {}, ports);

    assert.deepEqual(ports.commands, ["npm test"]);
  });

  it("prouve les sept criteres, sans aucun critere humain", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });
    await runAutonomousValidation(db, fixture.runId, {}, validationPorts({}));

    const plan = await readVerificationPlan(db, fixture.taskId);
    const batch = await getLatestValidationBatch(db, fixture.runId);
    assert.ok(batch !== null);
    const results = deriveCriterionResults(
      plan,
      batch.results
        .filter((entry) => entry.commandId !== null)
        .map((entry) => ({ commandId: entry.commandId ?? "", status: entry.status })),
    );

    assert.equal(results.length, 7);
    assert.ok(results.every((entry) => entry.result === CRITERION_VERIFICATION_RESULT.PASSED));
    assert.equal(deriveTaskVerificationOutcome(results), TASK_VERIFICATION_OUTCOME.AUTO_PASSED);
  });

  it("ne demande son avis a personne", async () => {
    // Aucun appel Architecte, aucun Claude supplementaire : la regle est
    // deterministe, et une regle deterministe ne consulte pas.
    const source = await readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "autonomous-validation.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/.*$/gmu, " ");
    for (const forbidden of ["OpenAI", "architect", "refreshVerification", "startClaudeRun"]) {
      assert.equal(code.includes(forbidden), false, forbidden);
    }
  });

  it("refuse de se terminer seule si la validation a modifie le repository", async () => {
    // La preuve a change le travail qu'elle evaluait : ce qui a ete valide n'est
    // plus tout a fait ce qui serait livre.
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });

    const outcome = await runAutonomousValidation(
      db,
      fixture.runId,
      {},
      validationPorts({ mutates: true }),
    );

    assert.ok(outcome.ran);
    assert.equal(outcome.autoCompleted, false);
    assert.equal((await getTaskById(db, fixture.taskId))?.status, TASK_STATUS.REVIEW);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — une preuve echoue
// ---------------------------------------------------------------------------

describe("Scenario 5 — npm test rend 1", () => {
  it("ne se termine pas seule, et le lot est en echec", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });

    const outcome = await runAutonomousValidation(
      db,
      fixture.runId,
      {},
      validationPorts({ outcomes: { "npm test": { exitCode: 1 } } }),
    );

    assert.ok(outcome.ran);
    assert.equal(outcome.batchStatus, VALIDATION_BATCH_STATUS.FAILED);
    assert.equal(outcome.autoCompleted, false);
    assert.equal((await getTaskById(db, fixture.taskId))?.status, TASK_STATUS.REVIEW);
  });

  it("laisse les criteres en echec, jamais en « non verifie »", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });
    await runAutonomousValidation(
      db,
      fixture.runId,
      {},
      validationPorts({ outcomes: { "npm test": { exitCode: 1 } } }),
    );

    const plan = await readVerificationPlan(db, fixture.taskId);
    const batch = await getLatestValidationBatch(db, fixture.runId);
    assert.ok(batch !== null);
    const results = deriveCriterionResults(
      plan,
      batch.results
        .filter((entry) => entry.commandId !== null)
        .map((entry) => ({ commandId: entry.commandId ?? "", status: entry.status })),
    );

    assert.ok(results.every((entry) => entry.result === CRITERION_VERIFICATION_RESULT.FAILED));
    assert.equal(deriveTaskVerificationOutcome(results), TASK_VERIFICATION_OUTCOME.AUTO_FAILED);
  });

  it("ne declenche aucune livraison", async () => {
    const project = await newProject(DELIVERY_POLICY.AUTO_COMMIT);
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });
    await runAutonomousValidation(
      db,
      fixture.runId,
      {},
      validationPorts({ outcomes: { "npm test": { exitCode: 1 } } }),
    );

    assert.equal(await getLatestDeliveryForTask(db, fixture.taskId), null);
  });

  it("ouvre la boucle de correction de TASK-028, sans la contourner", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });
    const outcome = await runAutonomousValidation(
      db,
      fixture.runId,
      {},
      validationPorts({ outcomes: { "npm test": { exitCode: 1 } } }),
    );

    assert.ok(outcome.ran);
    // La file est en pause : la correction est **prete** et attend un geste.
    // C'est exactement l'autorisation bornee de TASK-028, ni plus, ni moins.
    assert.notEqual(outcome.correction, null);
    assert.equal(outcome.correction?.started, false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — incertitude d'infrastructure
// ---------------------------------------------------------------------------

describe("Scenario 6 — VALIDATION_SPAWN_FAILED", () => {
  it("ne vaut jamais une reussite", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });

    const outcome = await runAutonomousValidation(
      db,
      fixture.runId,
      {},
      validationPorts({ spawnFails: true }),
    );

    assert.ok(outcome.ran);
    assert.equal(outcome.batchStatus, VALIDATION_BATCH_STATUS.ERROR);
    assert.equal(outcome.autoCompleted, false);
    assert.equal((await getTaskById(db, fixture.taskId))?.status, TASK_STATUS.REVIEW);
  });

  it("laisse les criteres « non verifies », jamais « faux »", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });
    await runAutonomousValidation(db, fixture.runId, {}, validationPorts({ spawnFails: true }));

    const plan = await readVerificationPlan(db, fixture.taskId);
    const batch = await getLatestValidationBatch(db, fixture.runId);
    assert.ok(batch !== null);
    const results = deriveCriterionResults(
      plan,
      batch.results
        .filter((entry) => entry.commandId !== null)
        .map((entry) => ({ commandId: entry.commandId ?? "", status: entry.status })),
    );

    assert.ok(
      results.every((entry) => entry.result === CRITERION_VERIFICATION_RESULT.NOT_VERIFIED),
      "« je n'ai pas pu regarder » n'est pas « j'ai regarde et c'est faux »",
    );
    assert.equal(deriveTaskVerificationOutcome(results), TASK_VERIFICATION_OUTCOME.AUTO_ERROR);
  });

  it("enregistre la panne, et ne declenche aucune livraison", async () => {
    const project = await newProject(DELIVERY_POLICY.AUTO_COMMIT_PUSH);
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });
    await runAutonomousValidation(db, fixture.runId, {}, validationPorts({ spawnFails: true }));

    const batch = await getLatestValidationBatch(db, fixture.runId);
    assert.equal(batch?.errorCode, RUNNER_ERROR.VALIDATION_SPAWN_FAILED);
    assert.equal(await getLatestDeliveryForTask(db, fixture.taskId), null);
  });

  it("traite un depassement de delai comme un echec, pas comme une panne", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });

    const outcome = await runAutonomousValidation(
      db,
      fixture.runId,
      {},
      validationPorts({ outcomes: { "npm test": { exitCode: null, timedOut: true } } }),
    );

    assert.equal(outcome.ran && outcome.batchStatus, VALIDATION_BATCH_STATUS.FAILED);
    const batch = await getLatestValidationBatch(db, fixture.runId);
    assert.equal(batch?.results[0]?.status, AUTONOMOUS_VALIDATION_STATUS.TIMED_OUT);
  });
});

// ---------------------------------------------------------------------------
// Scenarios 7 a 10 — la livraison
// ---------------------------------------------------------------------------

/** Termine une tache a la main, comme un humain qui accepte une review. */
async function acceptByHuman(fixture: Fixture): Promise<void> {
  const moved = await updateTaskStatus(db, fixture.taskId, fixture.project.id, TASK_STATUS.COMPLETED, {
    decision: {
      runId: fixture.runId,
      source: REVIEW_DECISION_SOURCE.HUMAN,
      overrideReason: null,
      confirmations: [],
    },
  });
  assert.ok(moved.ok);
}

describe("Scenario 7 — politique MANUAL", () => {
  it("n'ecrit rien dans Git, et enregistre le candidat", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 1, human: 1 });
    await acceptByHuman(fixture);

    const ports = deliveryPorts();
    const result = await maybeDeliver(db, { projectId: project.id, taskId: fixture.taskId }, ports);

    assert.equal(result.attempted, false);
    assert.equal(ports.log.commits, 0);
    assert.equal(ports.log.pushes, 0);

    // Le candidat existe : c'est ce qui donne aux boutons manuels quelque chose
    // a livrer, et a l'ecran quelque chose a montrer.
    const delivery = await getLatestDeliveryForTask(db, fixture.taskId);
    assert.equal(delivery?.status, DELIVERY_STATUS.PENDING);
    assert.equal(delivery?.policy, DELIVERY_POLICY.MANUAL);
    assert.deepEqual(delivery?.candidate, [...CANDIDATE]);
  });

  it("laisse les actions manuelles utiliser exactement le meme moteur", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 1, human: 1 });
    await acceptByHuman(fixture);

    const ports = deliveryPorts();
    await maybeDeliver(db, { projectId: project.id, taskId: fixture.taskId }, ports);
    const delivery = await getLatestDeliveryForTask(db, fixture.taskId);
    assert.ok(delivery !== null);

    const committed = await runDelivery(
      db,
      { deliveryId: delivery.id, trigger: DELIVERY_TRIGGER.MANUAL },
      ports,
    );

    assert.ok(committed.ok, JSON.stringify(committed));
    assert.equal(ports.log.commits, 1);
    assert.equal(ports.log.pushes, 0, "« Commit validated changes » ne pousse pas");
    assert.equal(committed.delivery.status, DELIVERY_STATUS.COMMITTED);
  });

  it("n'ajoute aucun chemin d'ecriture Git libre", async () => {
    // Le nouveau chemin d'interface ne doit pas contourner TASK-029 : la surface
    // de livraison est la seule, et elle n'expose aucune commande brute.
    const actions = withoutComments(
      await readFile(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
          "app",
          "projects",
          "[id]",
          "tasks",
          "[taskId]",
          "delivery",
          "actions.ts",
        ),
        "utf8",
      ),
    );
    for (const forbidden of ["git add", "git commit", "git push", "execFile", "child_process"]) {
      assert.equal(actions.includes(forbidden), false, forbidden);
    }

    // Et la surface reutilise bien le moteur unique, plutot qu'un chemin a elle.
    assert.ok(actions.includes("runDelivery"));
    assert.ok(actions.includes("retryDeliveryPush"));
  });
});

describe("Scenario 8 — politique AUTO_COMMIT", () => {
  it("commite une fois, ne pousse pas", async () => {
    const project = await newProject(DELIVERY_POLICY.AUTO_COMMIT);
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });

    await runAutonomousValidation(db, fixture.runId, {}, validationPorts({}));
    assert.equal((await getTaskById(db, fixture.taskId))?.status, TASK_STATUS.COMPLETED);

    const ports = deliveryPorts();
    const delivered = await maybeDeliver(
      db,
      { projectId: project.id, taskId: fixture.taskId },
      ports,
    );

    assert.ok(delivered.attempted);
    assert.equal(delivered.delivered, true);
    assert.equal(ports.log.commits, 1);
    assert.equal(ports.log.pushes, 0);
    assert.equal(delivered.delivery.status, DELIVERY_STATUS.COMMITTED);
    assert.equal(delivered.delivery.trigger, DELIVERY_TRIGGER.AUTOMATIC);
  });

  it("prepare exactement les chemins du candidat", async () => {
    const project = await newProject(DELIVERY_POLICY.AUTO_COMMIT);
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });
    await runAutonomousValidation(db, fixture.runId, {}, validationPorts({}));

    const ports = deliveryPorts();
    await maybeDeliver(db, { projectId: project.id, taskId: fixture.taskId }, ports);

    const delivery = await getLatestDeliveryForTask(db, fixture.taskId);
    assert.deepEqual(delivery?.candidate, [...CANDIDATE]);
  });

  it("reste idempotent : une seconde tentative ne produit pas un second commit", async () => {
    const project = await newProject(DELIVERY_POLICY.AUTO_COMMIT);
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });
    await runAutonomousValidation(db, fixture.runId, {}, validationPorts({}));

    const ports = deliveryPorts();
    await maybeDeliver(db, { projectId: project.id, taskId: fixture.taskId }, ports);
    await maybeDeliver(db, { projectId: project.id, taskId: fixture.taskId }, ports);

    assert.equal(ports.log.commits, 1, "une livraison produit au plus un commit");
  });
});

describe("Scenario 9 — politique AUTO_COMMIT_PUSH", () => {
  it("commite puis pousse, sans jamais forcer", async () => {
    const project = await newProject(DELIVERY_POLICY.AUTO_COMMIT_PUSH);
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });
    await runAutonomousValidation(db, fixture.runId, {}, validationPorts({}));

    const ports = deliveryPorts();
    const delivered = await maybeDeliver(
      db,
      { projectId: project.id, taskId: fixture.taskId },
      ports,
    );

    assert.ok(delivered.attempted);
    assert.equal(delivered.delivered, true);
    assert.equal(ports.log.commits, 1);
    assert.equal(ports.log.pushes, 1);
    assert.equal(delivered.delivery.status, DELIVERY_STATUS.DELIVERED);
  });
});

describe("Scenario 10 — le push echoue", () => {
  it("ne transforme pas une implementation validee en echec", async () => {
    const project = await newProject(DELIVERY_POLICY.AUTO_COMMIT_PUSH);
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });
    await runAutonomousValidation(db, fixture.runId, {}, validationPorts({}));

    const ports = deliveryPorts({ pushFails: true });
    const delivered = await maybeDeliver(
      db,
      { projectId: project.id, taskId: fixture.taskId },
      ports,
    );

    assert.ok(delivered.attempted);
    assert.equal(delivered.delivered, false);

    // Le code produit **est** valide, et la tache reste terminee. Seul l'etat de
    // livraison porte l'echec : ce sont deux concepts differents.
    const task = await getTaskById(db, fixture.taskId);
    assert.equal(task?.status, TASK_STATUS.COMPLETED);
    assert.notEqual(task?.status, TASK_STATUS.FAILED);
  });

  it("conserve le commit local, et rend le push reprenable", async () => {
    const project = await newProject(DELIVERY_POLICY.AUTO_COMMIT_PUSH);
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });
    await runAutonomousValidation(db, fixture.runId, {}, validationPorts({}));

    const failing = deliveryPorts({ pushFails: true });
    await maybeDeliver(db, { projectId: project.id, taskId: fixture.taskId }, failing);

    const delivery = await getLatestDeliveryForTask(db, fixture.taskId);
    assert.ok(delivery !== null);
    assert.notEqual(delivery.commitSha, null, "le commit local survit a un push refuse");
    assert.equal(failing.log.commits, 1);

    // La reprise relit le **meme** repository : le commit local est la, et
    // `HEAD` porte le trailer de cette livraison. C'est ce qui permet a NOX de
    // reconnaitre son propre commit plutot que d'en creer un second.
    const retried = await retryDeliveryPush(db, delivery.id, failing.reset());
    assert.ok(retried.ok, JSON.stringify(retried));
    assert.equal(retried.delivery.status, DELIVERY_STATUS.DELIVERED);
    assert.equal(retried.delivery.commitSha, delivery.commitSha, "aucun second commit");
  });

  it("n'ecrit aucune commande destructrice, ni aucun push force", async () => {
    const source = await readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "git-delivery.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/.*$/gmu, " ");
    for (const forbidden of ["force", "reset", "rebase", "pull", "restore", "checkout"]) {
      assert.equal(code.includes(forbidden), false, forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 11 — les dependances
// ---------------------------------------------------------------------------

describe("Scenario 11 — TASK-002 attend TASK-001", () => {
  it("empeche la seconde tache de partir avant la premiere", async () => {
    const project = await newProject();
    const first = await newRunAwaitingReview(
      project,
      { automated: 1, human: 0 },
      "Gerer les deplacements et leurs hotels",
    );
    const second = await createTask(db, {
      projectId: project.id,
      title: "Gerer les notes de frais et leur total",
      objective: "Etendre le modele et la fiche.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: ["Le total s'affiche"],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(second !== null);

    const edge = await addTaskDependency(db, {
      projectId: project.id,
      taskId: second.id,
      dependsOnTaskId: first.taskId,
    });
    assert.ok(edge.ok, JSON.stringify(edge));

    // La premiere n'est pas terminee : la seconde n'est pas eligible. Seul
    // `COMPLETED` satisfait une dependance — ni `READY`, ni `REVIEW`.
    const blocked = summarizeTaskDependencies(await listTaskDependencies(db, second.id));
    assert.equal(blocked.allSatisfied, false);
    assert.deepEqual(
      blocked.waiting.map((entry) => entry.code),
      ["TASK-001"],
    );
  });

  it("la libere une fois la premiere terminee", async () => {
    const project = await newProject();
    const first = await newRunAwaitingReview(
      project,
      { automated: 1, human: 0 },
      "Gerer les deplacements et leurs hotels",
    );
    const second = await createTask(db, {
      projectId: project.id,
      title: "Gerer les notes de frais et leur total",
      objective: "Etendre le modele et la fiche.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: ["Le total s'affiche"],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(second !== null);
    assert.ok(
      (
        await addTaskDependency(db, {
          projectId: project.id,
          taskId: second.id,
          dependsOnTaskId: first.taskId,
        })
      ).ok,
    );

    await runAutonomousValidation(db, first.runId, {}, validationPorts({}));
    assert.equal((await getTaskById(db, first.taskId))?.status, TASK_STATUS.COMPLETED);

    const freed = summarizeTaskDependencies(await listTaskDependencies(db, second.id));
    assert.equal(freed.allSatisfied, true);
  });

  it("laisse un autre repository parfaitement independant", async () => {
    const blocked = await newProject();
    const other = await newProject();

    const first = await newRunAwaitingReview(blocked, { automated: 1, human: 1 });
    const elsewhere = await newRunAwaitingReview(other, { automated: 1, human: 0 });

    // Une tache qui attend dans un projet n'empeche rien dans un autre : ce sont
    // deux repositories, donc deux verrous d'execution distincts.
    const outcome = await runAutonomousValidation(db, elsewhere.runId, {}, validationPorts({}));
    assert.ok(outcome.ran);
    assert.equal(outcome.autoCompleted, true);
    assert.equal((await getTaskById(db, first.taskId))?.status, TASK_STATUS.REVIEW);
  });
});

// ---------------------------------------------------------------------------
// Scenario 12 — ce que Claude Code a lance
// ---------------------------------------------------------------------------

describe("Scenario 12 — la commande de validation de Claude Code", () => {
  it("reconnait la commande exacte, et refuse la ligne a tuyau", async () => {
    const { readBashCommand } = await import(
      "../../runner/src/claude/stream/bash-command.ts"
    );

    const exact = readBashCommand("npm test", ["npm test", "npm run build"]);
    assert.equal(exact.validations.length, 1);
    assert.equal(exact.validations[0], "npm test");

    // Dans un tuyau, le code de sortie observable est celui de `tail` : la
    // commande peut echouer et la ligne rendre zero. NOX refuse d'y voir une
    // execution, et c'est ce refus qui empeche de fabriquer une preuve.
    const piped = readBashCommand("npm test 2>&1 | tail -60", ["npm test"]);
    assert.deepEqual(piped.validations, []);
  });

  it("demande explicitement l'execution litterale dans le prompt d'execution", async () => {
    const { renderClaudeExecutionPrompt } = await import("@nox/shared");
    const prompt = renderClaudeExecutionPrompt({
      code: "TASK-002",
      title: "Gerer les notes de frais",
      objective: "Un objectif.",
      context: null,
      outOfScope: null,
      acceptanceCriteria: ["Le total s'affiche"],
      documentReferences: [],
      validationCommands: ["npm test"],
      documentPath: "tasks/TASK-002.md",
      kind: "NORMAL",
    });

    assert.match(prompt, /\*\*exactement\*\* telle qu'elle est/u);
    assert.match(prompt, /sans tuyau, sans redirection, sans enveloppe/u);
    assert.match(prompt, /l'ex\u00e9cution litt\u00e9rale doit avoir eu/u);
  });

  it("interdit a l'agent de modifier le document de sa propre tache", async () => {
    const { renderClaudeExecutionPrompt } = await import("@nox/shared");
    const prompt = renderClaudeExecutionPrompt({
      code: "TASK-002",
      title: "Gerer les notes de frais",
      objective: "Un objectif.",
      context: null,
      outOfScope: null,
      acceptanceCriteria: ["Le total s'affiche"],
      documentReferences: [],
      validationCommands: [],
      documentPath: "tasks/TASK-002.md",
      kind: "NORMAL",
    });

    assert.match(prompt, /ne modifie pas le document de cette tâche/u);
    assert.match(prompt, /ne se cochent pas/u);
  });

  it("ne fait jamais d'un resultat rapporte par Claude Code une preuve", async () => {
    // La garantie est structurelle : `deriveCriterionResults` ne recoit que des
    // lots executes par NOX. Ce test la rejoue sur le plan reel du pilote.
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });

    const plan = await readVerificationPlan(db, fixture.taskId);
    const results = deriveCriterionResults(plan, []);
    assert.ok(
      results.every((entry) => entry.result === CRITERION_VERIFICATION_RESULT.NOT_VERIFIED),
      "sans lot de NOX, aucun critere n'est verifie",
    );
    assert.equal((await getTaskById(db, fixture.taskId))?.status, TASK_STATUS.REVIEW);
  });
});

// ---------------------------------------------------------------------------
// La file
// ---------------------------------------------------------------------------

describe("la file poursuit apres une completion automatique", () => {
  it("avance vers la tache suivante quand la politique est satisfaite", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 7, human: 0 });

    // Une file active, avec une tache inscrite : c'est l'autorisation permanente
    // de TASK-026, donnee par un geste humain.
    await enqueueNext(project.id, "Une tache suivante");
    assert.ok((await setQueueActive(db, project.id, true)).ok);

    const outcome = await runAutonomousValidation(db, fixture.runId, {}, validationPorts({}));
    assert.ok(outcome.ran);
    assert.equal(outcome.autoCompleted, true);
    assert.notEqual(outcome.dispatch, null, "l'avancement a bien ete tente");
  });

  it("n'avance pas quand la tache revient a un humain", async () => {
    const project = await newProject();
    const fixture = await newRunAwaitingReview(project, { automated: 6, human: 2 });
    await enqueueNext(project.id, "Une tache suivante");
    assert.ok((await setQueueActive(db, project.id, true)).ok);

    const outcome = await runAutonomousValidation(db, fixture.runId, {}, validationPorts({}));
    assert.ok(outcome.ran);
    assert.equal(outcome.dispatch, null, "aucune tentative d'avancement");
  });
});
