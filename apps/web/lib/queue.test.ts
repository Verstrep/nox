/**
 * Avancement de la file d'execution.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'un appel demarre **au plus une** execution, et seulement quand tout est
 * reuni. Que chaque refus est nomme plutot que devine : file en pause, file
 * vide, barriere en review, dependances non satisfaites, repository non pret,
 * execution deja active, tache courante en echec.
 *
 * Et surtout ce que la file **ne fait pas** : elle ne contourne ni le preflight
 * Git, ni la review humaine, et elle ne saute jamais par-dessus une tache qui
 * s'est mal terminee.
 *
 * Base temporaire, runner remplace par des doublures, aucun Claude, aucun
 * fournisseur.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { QUEUE_DISPATCH, TASK_PRIORITY, TASK_STATUS } from "@nox/shared";
import {
  addTaskDependency,
  createDatabaseClient,
  createProject,
  createTask,
  enqueueTask,
  setQueueActive,
  toDatabaseFilePath,
  toSqliteUrl,
  updateTaskStatus,
  type DatabaseClient,
} from "@nox/database";

import { advanceQueue, type QueueDispatchPorts } from "./queue.ts";

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

async function newProject(): Promise<string> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  return project.id;
}

async function newReadyTask(projectId: string, title: string): Promise<string> {
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
  assert.ok((await updateTaskStatus(db, task.id, projectId, TASK_STATUS.READY)).ok);
  return task.id;
}

/** Preflight qui accepte, et lanceur qui enregistre ce qu'on lui demande. */
function ports(overrides: Partial<QueueDispatchPorts> = {}): {
  ports: QueueDispatchPorts;
  launched: string[];
  probed: string[];
} {
  const launched: string[] = [];
  const probed: string[] = [];

  const base: QueueDispatchPorts = {
    preflight: (repositoryPath: string) => {
      probed.push(repositoryPath);
      return Promise.resolve({
        ok: true as const,
        value: {
          ok: true as const,
          claude: { available: true as const, version: "1.0.0" },
          git: {
            branch: "main",
            upstream: "origin/main",
            head: "a".repeat(40),
            clean: true,
            ahead: 0,
            behind: 0,
          },
        },
      });
    },
    launch: (_db, input) => {
      launched.push(input.taskId);
      return Promise.resolve({ ok: true as const, runId: `run-${input.taskId}` });
    },
  };

  return { ports: { ...base, ...overrides }, launched, probed };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-dispatch-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("advanceQueue — refus gratuits", () => {
  it("dit `EMPTY` sur une file vide, sans sonder le repository", async () => {
    const projectId = await newProject();
    const { ports: doubles, probed, launched } = ports();

    const result = await advanceQueue(db, projectId, doubles);

    assert.equal(result.outcome, QUEUE_DISPATCH.EMPTY);
    assert.deepEqual(probed, []);
    assert.deepEqual(launched, []);
  });

  it("dit `PAUSED` quand l'autorisation n'est pas ouverte", async () => {
    const projectId = await newProject();
    await enqueueTask(db, { projectId, taskId: await newReadyTask(projectId, "A") });
    const { ports: doubles, probed, launched } = ports();

    const result = await advanceQueue(db, projectId, doubles);

    // Une file en pause ne coute rien : ni requete au runner, ni inspection.
    assert.equal(result.outcome, QUEUE_DISPATCH.PAUSED);
    assert.deepEqual(probed, []);
    assert.deepEqual(launched, []);
  });

  it("referme l'autorisation d'une file devenue vide", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });
    await setQueueActive(db, projectId, true);
    // La derniere entree disparait sans passer par le retrait : la file reste
    // marquee active en base.
    await db.taskQueueEntry.deleteMany({ where: { projectId } });

    const result = await advanceQueue(db, projectId, ports().ports);

    assert.equal(result.outcome, QUEUE_DISPATCH.EMPTY);
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { executionQueueActive: true },
    });
    assert.equal(project?.executionQueueActive, false);
  });
});

describe("advanceQueue — demarrage", () => {
  it("lance la premiere entree eligible", async () => {
    const projectId = await newProject();
    const a = await newReadyTask(projectId, "A");
    const b = await newReadyTask(projectId, "B");
    await enqueueTask(db, { projectId, taskId: a });
    await enqueueTask(db, { projectId, taskId: b });
    await setQueueActive(db, projectId, true);

    const { ports: doubles, launched } = ports();
    const result = await advanceQueue(db, projectId, doubles);

    assert.equal(result.outcome, QUEUE_DISPATCH.STARTED);
    assert.equal(result.taskId, a);
    // Une seule execution par appel : la file n'est jamais videe d'un coup.
    assert.deepEqual(launched, [a]);
  });

  it("saute une entree bloquee sans figer la file", async () => {
    const projectId = await newProject();
    const blocked = await newReadyTask(projectId, "Bloquee");
    const prerequisite = await newReadyTask(projectId, "Prerequis");
    const free = await newReadyTask(projectId, "Libre");
    assert.ok(
      (await addTaskDependency(db, { projectId, taskId: blocked, dependsOnTaskId: prerequisite }))
        .ok,
    );

    // L'entree qui attend est **premiere** : c'est tout l'interet du test.
    await enqueueTask(db, { projectId, taskId: blocked });
    await enqueueTask(db, { projectId, taskId: free });
    await setQueueActive(db, projectId, true);

    const { ports: doubles, launched } = ports();
    const result = await advanceQueue(db, projectId, doubles);

    assert.equal(result.taskId, free);
    assert.deepEqual(launched, [free]);
  });

  it("transmet le HEAD du preflight au lanceur", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });
    await setQueueActive(db, projectId, true);

    let head = "";
    const { ports: doubles } = ports();
    await advanceQueue(db, projectId, {
      ...doubles,
      launch: (_db, input) => {
        head = input.expectedGitHead;
        return Promise.resolve({ ok: true as const, runId: "run-1" });
      },
    });

    assert.equal(head, "a".repeat(40));
  });
});

describe("advanceQueue — barrieres", () => {
  it("dit `WAITING_DEPENDENCIES` quand rien n'est eligible", async () => {
    const projectId = await newProject();
    const waiting = await newReadyTask(projectId, "Attend");
    const prerequisite = await newReadyTask(projectId, "Prerequis");
    assert.ok(
      (await addTaskDependency(db, { projectId, taskId: waiting, dependsOnTaskId: prerequisite }))
        .ok,
    );
    await enqueueTask(db, { projectId, taskId: waiting });
    await setQueueActive(db, projectId, true);

    const { ports: doubles, probed, launched } = ports();
    const result = await advanceQueue(db, projectId, doubles);

    assert.equal(result.outcome, QUEUE_DISPATCH.WAITING_DEPENDENCIES);
    // Inutile de sonder le repository pour une file qui n'a rien a lancer.
    assert.deepEqual(probed, []);
    assert.deepEqual(launched, []);
  });

  it("repart des que la dependance est terminee", async () => {
    const projectId = await newProject();
    const waiting = await newReadyTask(projectId, "Attend");
    const prerequisite = await newReadyTask(projectId, "Prerequis");
    assert.ok(
      (await addTaskDependency(db, { projectId, taskId: waiting, dependsOnTaskId: prerequisite }))
        .ok,
    );
    await enqueueTask(db, { projectId, taskId: waiting });
    await setQueueActive(db, projectId, true);

    await updateTaskStatus(db, prerequisite, projectId, TASK_STATUS.COMPLETED);

    const { ports: doubles, launched } = ports();
    const result = await advanceQueue(db, projectId, doubles);

    assert.equal(result.outcome, QUEUE_DISPATCH.STARTED);
    assert.deepEqual(launched, [waiting]);
  });

  it("dit `WAITING_REVIEW` et ne lance pas la suivante", async () => {
    const projectId = await newProject();
    const current = await newReadyTask(projectId, "Courante");
    const next = await newReadyTask(projectId, "Suivante");
    await enqueueTask(db, { projectId, taskId: current });
    await enqueueTask(db, { projectId, taskId: next });
    await setQueueActive(db, projectId, true);
    await db.task.update({ where: { id: current }, data: { status: TASK_STATUS.REVIEW } });

    const { ports: doubles, launched } = ports();
    const result = await advanceQueue(db, projectId, doubles);

    // Une execution terminee n'est pas un travail accepte : la file attend.
    assert.equal(result.outcome, QUEUE_DISPATCH.WAITING_REVIEW);
    assert.equal(result.taskId, current);
    assert.deepEqual(launched, []);
  });

  it("dit `ACTIVE_RUN` quand la barriere travaille encore", async () => {
    const projectId = await newProject();
    const current = await newReadyTask(projectId, "Courante");
    const next = await newReadyTask(projectId, "Suivante");
    await enqueueTask(db, { projectId, taskId: current });
    await enqueueTask(db, { projectId, taskId: next });
    await setQueueActive(db, projectId, true);
    await db.task.update({ where: { id: current }, data: { status: TASK_STATUS.RUNNING } });

    const { ports: doubles, launched } = ports();
    const result = await advanceQueue(db, projectId, doubles);

    assert.equal(result.outcome, QUEUE_DISPATCH.ACTIVE_RUN);
    assert.deepEqual(launched, []);
  });

  it("dit `FAILED_CURRENT` et ne saute jamais par-dessus", async () => {
    const projectId = await newProject();
    const current = await newReadyTask(projectId, "Courante");
    const next = await newReadyTask(projectId, "Suivante");
    await enqueueTask(db, { projectId, taskId: current });
    await enqueueTask(db, { projectId, taskId: next });
    await setQueueActive(db, projectId, true);
    await db.task.update({ where: { id: current }, data: { status: TASK_STATUS.FAILED } });

    const { ports: doubles, launched } = ports();
    const result = await advanceQueue(db, projectId, doubles);

    assert.equal(result.outcome, QUEUE_DISPATCH.FAILED_CURRENT);
    assert.equal(result.taskId, current);
    assert.deepEqual(launched, []);
  });

  it("repart apres le retrait de l'entree en echec", async () => {
    const projectId = await newProject();
    const current = await newReadyTask(projectId, "Courante");
    const next = await newReadyTask(projectId, "Suivante");
    await enqueueTask(db, { projectId, taskId: current });
    await enqueueTask(db, { projectId, taskId: next });
    await setQueueActive(db, projectId, true);
    await db.task.update({ where: { id: current }, data: { status: TASK_STATUS.FAILED } });

    await db.taskQueueEntry.deleteMany({ where: { taskId: current } });

    const { ports: doubles, launched } = ports();
    const result = await advanceQueue(db, projectId, doubles);

    assert.equal(result.outcome, QUEUE_DISPATCH.STARTED);
    assert.deepEqual(launched, [next]);
  });
});

describe("advanceQueue — repository", () => {
  it("dit `WAITING_REPOSITORY` sans rien lancer", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });
    await setQueueActive(db, projectId, true);

    const { ports: doubles, launched } = ports();
    const result = await advanceQueue(db, projectId, {
      ...doubles,
      preflight: () =>
        Promise.resolve({
          ok: false as const,
          failure: { kind: "runner_error" as const, code: "REPOSITORY_DIRTY" as const },
        }),
    });

    // La file n'affaiblit pas le preflight : un repository sale arrete la
    // progression, il ne la contourne pas.
    assert.equal(result.outcome, QUEUE_DISPATCH.WAITING_REPOSITORY);
    assert.deepEqual(launched, []);
    // L'autorisation reste ouverte : rien n'a echoue, la file attend.
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { executionQueueActive: true },
    });
    assert.equal(project?.executionQueueActive, true);
  });

  it("rapporte un refus du pipeline sans le reinterpreter", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });
    await setQueueActive(db, projectId, true);

    const { ports: doubles } = ports();
    const result = await advanceQueue(db, projectId, {
      ...doubles,
      launch: () =>
        Promise.resolve({
          ok: false as const,
          code: "NOT_SYNCED" as const,
          message: "Document non synchronise.",
        }),
    });

    assert.equal(result.outcome, QUEUE_DISPATCH.REFUSED);
    assert.equal(result.message, "Document non synchronise.");
  });

  it("traduit un refus pour execution active", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });
    await setQueueActive(db, projectId, true);

    const { ports: doubles } = ports();
    const result = await advanceQueue(db, projectId, {
      ...doubles,
      launch: () =>
        Promise.resolve({
          ok: false as const,
          code: "ACTIVE_RUN" as const,
          message: "Une execution est deja en cours.",
        }),
    });

    assert.equal(result.outcome, QUEUE_DISPATCH.ACTIVE_RUN);
  });
});

// ---------------------------------------------------------------------------
// Une tache rouverte reste la barriere de sa file.
//
// C'est le cas que `Task.status` ne sait pas exprimer : apres un `Reopen`, la
// tache est `READY`, comme une tache jamais lancee. Ces tests verifient que le
// dispatcher ne s'y trompe pas — ni en la relancant, ni en la depassant.
// ---------------------------------------------------------------------------

describe("advanceQueue — element courant rouvert", () => {
  /** Une file active dont la premiere entree a deja lance, puis ete rouverte. */
  async function reopenedQueue(): Promise<{ projectId: string; first: string; second: string }> {
    const projectId = await newProject();
    const first = await newReadyTask(projectId, "A");
    const second = await newReadyTask(projectId, "B");
    await enqueueTask(db, { projectId, taskId: first });
    await enqueueTask(db, { projectId, taskId: second });
    await setQueueActive(db, projectId, true);

    // L'inscription porte la marque de son depart ; la tache est revenue a
    // `READY`. C'est exactement l'etat laisse par un `Reopen`.
    await db.taskQueueEntry.update({
      where: { taskId: first },
      data: { startedAt: new Date() },
    });

    return { projectId, first, second };
  }

  it("ne relance pas la tache rouverte", async () => {
    const { projectId, first } = await reopenedQueue();
    const { ports: doubles, launched, probed } = ports();

    const result = await advanceQueue(db, projectId, doubles);

    assert.equal(result.outcome, QUEUE_DISPATCH.WAITING_CURRENT_TASK);
    assert.equal(result.taskId, first);
    assert.deepEqual(launched, [], "aucune execution");
    assert.deepEqual(probed, [], "et le refus ne coute meme pas une inspection");
  });

  it("ne demarre pas la suivante a sa place", async () => {
    const { projectId, second } = await reopenedQueue();
    const { ports: doubles, launched } = ports();

    await advanceQueue(db, projectId, doubles);

    assert.equal(launched.includes(second), false);
    const task = await db.task.findUnique({ where: { id: second }, select: { status: true } });
    assert.equal(task?.status, TASK_STATUS.READY);
  });

  it("ne cede pas a un evenement sans rapport", async () => {
    // Une inscription supplementaire appelle le dispatcher, file active : c'est
    // le chemin par lequel une barriere mal derivee produirait un lancement
    // surprise.
    const { projectId, first } = await reopenedQueue();
    const third = await newReadyTask(projectId, "C");
    const { ports: doubles, launched } = ports();

    assert.ok((await enqueueTask(db, { projectId, taskId: third })).ok);
    const result = await advanceQueue(db, projectId, doubles);

    assert.deepEqual(launched, []);
    assert.equal(result.outcome, QUEUE_DISPATCH.WAITING_CURRENT_TASK);
    assert.equal(result.taskId, first);
    assert.equal(await db.taskQueueEntry.count({ where: { projectId } }), 3);
  });

  it("ne cede pas davantage a un appel repete", async () => {
    // « Try next » n'est pas un bouton de reprise : dix clics ne valent pas une
    // decision humaine sur la tache elle-meme.
    const { projectId } = await reopenedQueue();
    const { ports: doubles, launched } = ports();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await advanceQueue(db, projectId, doubles);
      assert.equal(result.outcome, QUEUE_DISPATCH.WAITING_CURRENT_TASK);
    }
    assert.deepEqual(launched, []);
  });

  it("laisse la file active : ce n'est pas un incident", async () => {
    const { projectId } = await reopenedQueue();

    await advanceQueue(db, projectId, ports().ports);

    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { executionQueueActive: true },
    });
    assert.equal(project?.executionQueueActive, true);
  });

  it("repart des que la barriere est retiree", async () => {
    const { projectId, first, second } = await reopenedQueue();
    await db.taskQueueEntry.delete({ where: { taskId: first } });
    const { ports: doubles, launched } = ports();

    const result = await advanceQueue(db, projectId, doubles);

    assert.equal(result.outcome, QUEUE_DISPATCH.STARTED);
    assert.deepEqual(launched, [second]);
  });

  it("repart des que la tache rouverte est acceptee", async () => {
    const { projectId, first, second } = await reopenedQueue();
    assert.ok((await updateTaskStatus(db, first, projectId, TASK_STATUS.COMPLETED)).ok);
    const { ports: doubles, launched } = ports();

    const result = await advanceQueue(db, projectId, doubles);

    assert.equal(result.outcome, QUEUE_DISPATCH.STARTED);
    assert.deepEqual(launched, [second]);
  });

  it("survit a un redemarrage : la marque est en base, pas en memoire", async () => {
    const { projectId, first } = await reopenedQueue();
    // Un client neuf, comme apres un redemarrage du serveur : aucun etat de
    // processus n'est partage avec le precedent.
    const fresh = createDatabaseClient(toSqliteUrl(path.join(workspace, "test.db")));
    try {
      const { ports: doubles, launched } = ports();
      const result = await advanceQueue(fresh, projectId, doubles);

      assert.equal(result.outcome, QUEUE_DISPATCH.WAITING_CURRENT_TASK);
      assert.equal(result.taskId, first);
      assert.deepEqual(launched, []);
    } finally {
      await fresh.$disconnect();
    }
  });
});
