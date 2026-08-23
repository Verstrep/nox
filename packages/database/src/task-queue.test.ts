/**
 * Persistance de la file d'execution.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'une tache n'entre qu'une fois dans une file, y compris sous deux
 * inscriptions **simultanees** — la garantie est l'index unique, pas une lecture
 * suivie d'une ecriture. Que deux inscriptions concurrentes obtiennent deux
 * positions distinctes, parce que la position vient d'un compteur reserve dans
 * la transaction.
 *
 * Qu'une seule execution peut naitre d'appels simultanes sur le meme
 * repository : c'est le point de serialisation persistant de la file, et un
 * verrou en memoire ne le remplacerait pas.
 *
 * Que l'inscription **gele** la tache : plus d'edition, plus de suppression,
 * plus de mise de cote a la main — sans que rien ne change son statut.
 *
 * Et que `COMPLETED`, et lui seul, retire une entree de la file.
 *
 * Base temporaire, aucun reseau, aucun fournisseur.
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
  EXECUTION_QUEUE_ERROR,
  TASK_EDIT_ERROR,
  TASK_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
} from "@nox/shared";

import {
  addTaskDependency,
  countQueueEntries,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  deleteTaskWithoutRuns,
  dequeueTask,
  enqueueTask,
  failRun,
  isQueueActive,
  isTaskQueued,
  listDependencyIds,
  listQueueEntries,
  moveQueueEntry,
  queuePositionOf,
  setQueueActive,
  toDatabaseFilePath,
  toSqliteUrl,
  updateFutureTask,
  updateTaskStatus,
  writeTaskRow,
  type DatabaseClient,
  type TaskEditInput,
  type TaskEditSnapshot,
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
let runCounter = 0;

function revision(snapshot: TaskEditSnapshot): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...snapshot,
        dependsOnTaskIds: [...snapshot.dependsOnTaskIds].sort((a, b) => a.localeCompare(b)),
      }),
      "utf8",
    )
    .digest("hex");
}

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

/** Une tache prete a etre inscrite : `READY`, normale, sans execution. */
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
  const ready = await updateTaskStatus(db, task.id, projectId, TASK_STATUS.READY);
  assert.ok(ready.ok);
  return task.id;
}

async function newRun(projectId: string, taskId: string) {
  runCounter += 1;
  const suffix = String(runCounter).padStart(12, "0");
  return createRun(db, {
    projectId,
    taskId,
    prompt: "Prompt.",
    promptSha256: "a".repeat(64),
    runnerRunId: `3f2504e0-4f89-41d3-9a0c-${suffix}`,
  });
}

async function codes(projectId: string): Promise<string[]> {
  return (await listQueueEntries(db, projectId)).map((entry) => entry.code);
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-queue-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("inscription", () => {
  it("inscrit une tache prete sans toucher a son statut", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");

    const result = await enqueueTask(db, { projectId, taskId });
    assert.ok(result.ok);
    assert.equal(result.ok && result.created, true);

    // Le statut ne bouge pas : la file est une intention, pas un etat de travail.
    const task = await db.task.findUnique({ where: { id: taskId }, select: { status: true } });
    assert.equal(task?.status, TASK_STATUS.READY);
    assert.equal(await isTaskQueued(db, taskId), true);
  });

  it("n'active pas la file", async () => {
    // Inscrire ne lance rien : l'autorisation reste fermee tant qu'un humain ne
    // l'ouvre pas.
    const projectId = await newProject();
    await enqueueTask(db, { projectId, taskId: await newReadyTask(projectId, "A") });
    assert.equal(await isQueueActive(db, projectId), false);
  });

  it("est idempotente : deux fois la meme tache, une seule entree", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");

    const first = await enqueueTask(db, { projectId, taskId });
    const second = await enqueueTask(db, { projectId, taskId });

    assert.equal(first.ok && first.created, true);
    // Un double-clic n'est pas une faute : le resultat recherche est atteint.
    assert.ok(second.ok);
    assert.equal(second.ok && second.created, false);
    assert.equal(await countQueueEntries(db, projectId), 1);
  });

  it("refuse une tache d'amorcage", async () => {
    const projectId = await newProject();
    const bootstrap = await writeTaskRow(db, {
      projectId,
      sequence: 0,
      kind: TASK_KIND.BOOTSTRAP,
      title: "Bootstrap project repository",
      objective: "Etablir la fondation.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.HIGH,
      acceptanceCriteria: ["Le repository demarre."],
      documentReferences: [],
      validationCommands: [],
    });
    await updateTaskStatus(db, bootstrap.id, projectId, TASK_STATUS.READY);

    const result = await enqueueTask(db, { projectId, taskId: bootstrap.id });
    assert.equal(result.ok, false);
    assert.equal(
      result.ok === false && result.code,
      EXECUTION_QUEUE_ERROR.BOOTSTRAP_NOT_QUEUEABLE,
    );
    assert.equal(await countQueueEntries(db, projectId), 0);
  });

  it("refuse une tache qui n'est pas prete", async () => {
    const projectId = await newProject();
    const task = await createTask(db, {
      projectId,
      title: "Brouillon",
      objective: "Objectif.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: ["verifiable"],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(task !== null);

    const result = await enqueueTask(db, { projectId, taskId: task.id });
    assert.equal(result.ok === false && result.code, EXECUTION_QUEUE_ERROR.TASK_NOT_READY);
  });

  it("refuse une tache dont une execution travaille deja", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    assert.ok((await newRun(projectId, taskId)).ok);

    const result = await enqueueTask(db, { projectId, taskId });
    assert.equal(result.ok === false && result.code, EXECUTION_QUEUE_ERROR.TASK_HAS_ACTIVE_RUN);
  });

  it("refuse une tache d'un autre projet", async () => {
    const mine = await newProject();
    const other = await newProject();
    const taskId = await newReadyTask(other, "A");

    const result = await enqueueTask(db, { projectId: mine, taskId });
    assert.equal(result.ok === false && result.code, EXECUTION_QUEUE_ERROR.TASK_NOT_FOUND);
  });

  it("accepte une tache dont les dependances ne sont pas terminees", async () => {
    // Volontaire : on prepare une file avant que ses prerequis soient finis. Les
    // dependances decideront au lancement, pas a l'inscription.
    const projectId = await newProject();
    const a = await newReadyTask(projectId, "A");
    const b = await newReadyTask(projectId, "B");
    assert.ok((await addTaskDependency(db, { projectId, taskId: a, dependsOnTaskId: b })).ok);

    assert.ok((await enqueueTask(db, { projectId, taskId: a })).ok);
  });
});

describe("concurrence", () => {
  it("ne cree qu'une entree sous deux inscriptions simultanees", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");

    const results = await Promise.all([
      enqueueTask(db, { projectId, taskId }),
      enqueueTask(db, { projectId, taskId }),
    ]);

    // Aucune exception brute de contrainte : les deux appels rendent un
    // resultat, et un seul a cree.
    assert.ok(results.every((result) => result.ok));
    assert.equal(results.filter((result) => result.ok && result.created).length, 1);
    assert.equal(await countQueueEntries(db, projectId), 1);
  });

  it("donne des positions distinctes a deux taches inscrites en meme temps", async () => {
    const projectId = await newProject();
    const a = await newReadyTask(projectId, "A");
    const b = await newReadyTask(projectId, "B");
    const c = await newReadyTask(projectId, "C");

    await Promise.all([
      enqueueTask(db, { projectId, taskId: a }),
      enqueueTask(db, { projectId, taskId: b }),
      enqueueTask(db, { projectId, taskId: c }),
    ]);

    const sequences = (await listQueueEntries(db, projectId)).map((entry) => entry.sequence);
    assert.equal(sequences.length, 3);
    assert.equal(new Set(sequences).size, 3, `positions en double : ${sequences.join(", ")}`);
  });

  it("ne cree qu'une execution sous deux lancements simultanes", async () => {
    // Le point de serialisation persistant du dispatcher : deux avancements
    // peuvent choisir deux taches eligibles differentes, un seul ressort avec
    // une execution.
    const projectId = await newProject();
    const a = await newReadyTask(projectId, "A");
    const b = await newReadyTask(projectId, "B");

    const created = await Promise.all([newRun(projectId, a), newRun(projectId, b)]);

    assert.equal(created.filter((result) => result.ok).length, 1);
    assert.equal(await db.run.count({ where: { task: { projectId } } }), 1);
  });
});

describe("retrait", () => {
  it("retire l'entree sans changer le statut de la tache", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });

    const result = await dequeueTask(db, { projectId, taskId });
    assert.ok(result.ok);
    assert.equal(result.ok && result.emptied, true);

    const task = await db.task.findUnique({ where: { id: taskId }, select: { status: true } });
    assert.equal(task?.status, TASK_STATUS.READY);
  });

  it("referme l'autorisation quand la file se vide", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });
    await setQueueActive(db, projectId, true);

    await dequeueTask(db, { projectId, taskId });

    // Une file vide ne conserve aucune autorisation dormante : la prochaine
    // inscription devra passer par un nouveau `Start queue`.
    assert.equal(await isQueueActive(db, projectId), false);
  });

  it("laisse l'autorisation ouverte tant qu'il reste des entrees", async () => {
    const projectId = await newProject();
    const a = await newReadyTask(projectId, "A");
    const b = await newReadyTask(projectId, "B");
    await enqueueTask(db, { projectId, taskId: a });
    await enqueueTask(db, { projectId, taskId: b });
    await setQueueActive(db, projectId, true);

    await dequeueTask(db, { projectId, taskId: a });
    assert.equal(await isQueueActive(db, projectId), true);
  });

  it("refuse tant qu'une execution travaille sur la tache", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });
    assert.ok((await newRun(projectId, taskId)).ok);

    const result = await dequeueTask(db, { projectId, taskId });
    assert.equal(result.ok === false && result.code, EXECUTION_QUEUE_ERROR.TASK_HAS_ACTIVE_RUN);
    assert.equal(await countQueueEntries(db, projectId), 1);
  });

  it("permet de retirer une tache en echec", async () => {
    // Le cas qui debloque une file arretee : la tache a echoue, aucune execution
    // ne tourne, l'utilisateur la sort de la file.
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });
    const run = await newRun(projectId, taskId);
    assert.ok(run.ok);
    await db.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.RUNNING } });
    await failRun(db, run.run.id);

    const result = await dequeueTask(db, { projectId, taskId });
    assert.ok(result.ok);
    const task = await db.task.findUnique({ where: { id: taskId }, select: { status: true } });
    assert.equal(task?.status, TASK_STATUS.FAILED);
  });

  it("refuse une tache qui n'est pas inscrite", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");

    const result = await dequeueTask(db, { projectId, taskId });
    assert.equal(result.ok === false && result.code, EXECUTION_QUEUE_ERROR.ENTRY_NOT_FOUND);
  });
});

describe("ordre", () => {
  async function threeQueued(): Promise<{ projectId: string; ids: string[] }> {
    const projectId = await newProject();
    const ids: string[] = [];
    for (const title of ["A", "B", "C"]) {
      const taskId = await newReadyTask(projectId, title);
      ids.push(taskId);
      await enqueueTask(db, { projectId, taskId });
    }
    return { projectId, ids };
  }

  it("conserve l'ordre d'inscription", async () => {
    const { projectId } = await threeQueued();
    assert.deepEqual(await codes(projectId), ["TASK-001", "TASK-002", "TASK-003"]);
  });

  it("remonte une entree d'un cran", async () => {
    const { projectId, ids } = await threeQueued();
    const result = await moveQueueEntry(db, {
      projectId,
      taskId: ids[2] ?? "",
      direction: "up",
    });

    assert.ok(result.ok);
    assert.deepEqual(await codes(projectId), ["TASK-001", "TASK-003", "TASK-002"]);
  });

  it("descend une entree d'un cran", async () => {
    const { projectId, ids } = await threeQueued();
    await moveQueueEntry(db, { projectId, taskId: ids[0] ?? "", direction: "down" });
    assert.deepEqual(await codes(projectId), ["TASK-002", "TASK-001", "TASK-003"]);
  });

  it("ne fait rien en bout de file, sans erreur", async () => {
    const { projectId, ids } = await threeQueued();
    const result = await moveQueueEntry(db, { projectId, taskId: ids[0] ?? "", direction: "up" });

    assert.ok(result.ok);
    assert.equal(result.ok && result.moved, false);
    assert.deepEqual(await codes(projectId), ["TASK-001", "TASK-002", "TASK-003"]);
  });

  it("ne touche ni au code, ni au numero, ni a la provenance", async () => {
    const { projectId, ids } = await threeQueued();
    const before = await db.task.findMany({
      where: { projectId },
      select: { id: true, sequence: true, backlogProposalId: true, backlogItemPosition: true },
      orderBy: { sequence: "asc" },
    });

    await moveQueueEntry(db, { projectId, taskId: ids[2] ?? "", direction: "up" });

    const after = await db.task.findMany({
      where: { projectId },
      select: { id: true, sequence: true, backlogProposalId: true, backlogItemPosition: true },
      orderBy: { sequence: "asc" },
    });
    assert.deepEqual(after, before);
  });

  it("refuse de deplacer une entree dont le travail est commence", async () => {
    const { projectId, ids } = await threeQueued();
    await db.task.update({ where: { id: ids[0] ?? "" }, data: { status: TASK_STATUS.RUNNING } });

    const result = await moveQueueEntry(db, {
      projectId,
      taskId: ids[1] ?? "",
      direction: "up",
    });
    assert.equal(result.ok === false && result.code, EXECUTION_QUEUE_ERROR.TASK_HAS_ACTIVE_RUN);
  });

  it("donne la position affichee d'une tache", async () => {
    const { projectId, ids } = await threeQueued();
    assert.equal(await queuePositionOf(db, projectId, ids[1] ?? ""), 2);
    assert.equal(await queuePositionOf(db, projectId, "inconnue"), null);
  });
});

describe("autorisation", () => {
  it("refuse d'activer une file vide", async () => {
    const projectId = await newProject();
    const result = await setQueueActive(db, projectId, true);

    // Une autorisation qui ne porte sur rien survivrait a la file, et
    // s'appliquerait a la premiere tache inscrite ensuite.
    assert.equal(result.ok === false && result.code, EXECUTION_QUEUE_ERROR.QUEUE_EMPTY);
    assert.equal(await isQueueActive(db, projectId), false);
  });

  it("ouvre et referme l'autorisation", async () => {
    const projectId = await newProject();
    await enqueueTask(db, { projectId, taskId: await newReadyTask(projectId, "A") });

    assert.ok((await setQueueActive(db, projectId, true)).ok);
    assert.equal(await isQueueActive(db, projectId), true);

    assert.ok((await setQueueActive(db, projectId, false)).ok);
    assert.equal(await isQueueActive(db, projectId), false);
  });

  it("n'annule aucune execution en se refermant", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });
    await setQueueActive(db, projectId, true);
    const run = await newRun(projectId, taskId);
    assert.ok(run.ok);

    await setQueueActive(db, projectId, false);

    // La pause ne concerne que les demarrages suivants.
    const stored = await db.run.findUnique({ where: { id: run.run.id }, select: { status: true } });
    assert.equal(stored?.status, "QUEUED");
  });
});

describe("echec d'une execution", () => {
  it("referme l'autorisation de la file", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });
    await setQueueActive(db, projectId, true);

    const run = await newRun(projectId, taskId);
    assert.ok(run.ok);
    await db.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.RUNNING } });
    await failRun(db, run.run.id);

    // NOX ne passe jamais a la tache suivante apres un echec, et l'entree reste
    // en place pour qu'on sache laquelle a echoue.
    assert.equal(await isQueueActive(db, projectId), false);
    assert.equal(await countQueueEntries(db, projectId), 1);
  });

  it("ne touche pas a la file d'un projet dont la tache n'est pas inscrite", async () => {
    const projectId = await newProject();
    const queued = await newReadyTask(projectId, "A");
    const loose = await newReadyTask(projectId, "B");
    await enqueueTask(db, { projectId, taskId: queued });
    await setQueueActive(db, projectId, true);

    const run = await newRun(projectId, loose);
    assert.ok(run.ok);
    await db.task.update({ where: { id: loose }, data: { status: TASK_STATUS.RUNNING } });
    await failRun(db, run.run.id);

    assert.equal(await isQueueActive(db, projectId), true);
  });
});

describe("gel d'une tache inscrite", () => {
  it("retire l'entree quand la tache est acceptee", async () => {
    const projectId = await newProject();
    const a = await newReadyTask(projectId, "A");
    const b = await newReadyTask(projectId, "B");
    await enqueueTask(db, { projectId, taskId: a });
    await enqueueTask(db, { projectId, taskId: b });
    await setQueueActive(db, projectId, true);

    const done = await updateTaskStatus(db, a, projectId, TASK_STATUS.COMPLETED);
    assert.ok(done.ok);
    assert.equal(done.ok && done.dequeued, true);
    assert.deepEqual(await codes(projectId), ["TASK-002"]);
    // Il reste une entree : l'autorisation ne se referme pas.
    assert.equal(await isQueueActive(db, projectId), true);
  });

  it("referme l'autorisation quand la derniere entree est acceptee", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });
    await setQueueActive(db, projectId, true);

    await updateTaskStatus(db, taskId, projectId, TASK_STATUS.COMPLETED);

    assert.equal(await countQueueEntries(db, projectId), 0);
    assert.equal(await isQueueActive(db, projectId), false);
  });

  it("refuse un retour en brouillon", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });

    const result = await updateTaskStatus(db, taskId, projectId, TASK_STATUS.DRAFT);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "queued");

    const task = await db.task.findUnique({ where: { id: taskId }, select: { status: true } });
    assert.equal(task?.status, TASK_STATUS.READY);
  });

  it("refuse une mise de cote", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });

    const result = await updateTaskStatus(db, taskId, projectId, TASK_STATUS.BLOCKED);
    assert.equal(result.ok === false && result.reason, "queued");
  });

  it("redevient modifiable apres un retrait", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });
    await dequeueTask(db, { projectId, taskId });

    const result = await updateTaskStatus(db, taskId, projectId, TASK_STATUS.DRAFT);
    assert.ok(result.ok);
  });

  it("refuse l'edition du contrat", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });

    const current = await db.task.findUnique({
      where: { id: taskId },
      select: { title: true, objective: true, context: true, outOfScope: true, priority: true },
    });
    assert.ok(current !== null);

    const values: TaskEditInput = {
      title: current.title,
      objective: "Reecrit apres inscription.",
      context: current.context,
      outOfScope: current.outOfScope,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: ["A est verifiable"],
      documentReferences: [],
      validationCommands: [],
      dependsOnTaskIds: await listDependencyIds(db, taskId),
    };

    const result = await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: revision({ ...values, objective: current.objective }),
      revision,
      values,
    });

    assert.equal(result.ok, false);
    assert.equal(
      result.ok === false && result.reason === "edit" && result.code,
      TASK_EDIT_ERROR.QUEUED,
    );

    const saved = await db.task.findUnique({ where: { id: taskId }, select: { objective: true } });
    assert.equal(saved?.objective, current.objective);
  });

  it("refuse la suppression", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });

    const result = await deleteTaskWithoutRuns(db, projectId, taskId);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "queued");
    assert.equal(await db.task.count({ where: { id: taskId } }), 1);
  });

  it("redevient supprimable apres un retrait", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });
    await dequeueTask(db, { projectId, taskId });

    assert.ok((await deleteTaskWithoutRuns(db, projectId, taskId)).ok);
  });
});

describe("lecture", () => {
  it("rend les dependances de chaque entree", async () => {
    const projectId = await newProject();
    const a = await newReadyTask(projectId, "A");
    const b = await newReadyTask(projectId, "B");
    assert.ok((await addTaskDependency(db, { projectId, taskId: a, dependsOnTaskId: b })).ok);
    await enqueueTask(db, { projectId, taskId: a });

    const entries = await listQueueEntries(db, projectId);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.dependsOn.length, 1);
    assert.equal(entries[0]?.dependsOn[0]?.code, "TASK-002");
    // Le statut de la dependance vient de la base, jamais d'une colonne de file.
    assert.equal(entries[0]?.dependsOn[0]?.status, TASK_STATUS.READY);
  });

  it("ne voit pas la file d'un autre projet", async () => {
    const mine = await newProject();
    const other = await newProject();
    await enqueueTask(db, { projectId: other, taskId: await newReadyTask(other, "A") });

    assert.deepEqual(await listQueueEntries(db, mine), []);
    assert.equal(await countQueueEntries(db, mine), 0);
  });
});

// ---------------------------------------------------------------------------
// La barriere survit a une reouverture.
//
// `Task.status` ne sait pas distinguer une tache rouverte d'une tache jamais
// lancee : les deux sont `READY`. `TaskQueueEntry.startedAt` porte cette
// difference, et il est persiste — un redemarrage du serveur ne doit pas
// l'effacer.
// ---------------------------------------------------------------------------

describe("cycle d'une inscription", () => {
  /**
   * Rejoue un `Reopen` : l'execution se termine, la tache passe en relecture,
   * puis un humain la renvoie a `READY`.
   *
   * `REVIEW` est un statut reserve, pose par le pipeline et jamais a la main —
   * il est donc ecrit directement, comme ailleurs dans ce fichier. La transition
   * qui compte, `REVIEW` vers `READY`, passe bien par `updateTaskStatus`.
   */
  async function reopen(projectId: string, taskId: string, runId: string): Promise<void> {
    await failRun(db, runId);
    await db.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.REVIEW } });
    const reopened = await updateTaskStatus(db, taskId, projectId, TASK_STATUS.READY);
    assert.ok(reopened.ok);
  }
  it("nait sans avoir rien commence", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });

    const [row] = await listQueueEntries(db, projectId);
    assert.equal(row?.started, false);
  });

  it("est datee par la creation d'une execution, dans la meme transaction", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });

    const run = await newRun(projectId, taskId);
    assert.ok(run.ok);

    const [row] = await listQueueEntries(db, projectId);
    assert.equal(row?.started, true);
  });

  it("reste marquee apres une reouverture", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });

    const run = await newRun(projectId, taskId);
    assert.ok(run.ok);
    // Retour a `READY`, exactement comme une tache jamais lancee.
    await reopen(projectId, taskId, run.run.id);

    const [row] = await listQueueEntries(db, projectId);
    assert.equal(row?.status, TASK_STATUS.READY);
    assert.equal(row?.started, true, "l'inscription se souvient d'avoir commence");
  });

  it("ne date pas l'inscription d'une autre tache", async () => {
    const projectId = await newProject();
    const marked = await newReadyTask(projectId, "A");
    const untouched = await newReadyTask(projectId, "B");
    await enqueueTask(db, { projectId, taskId: marked });
    await enqueueTask(db, { projectId, taskId: untouched });

    const run = await newRun(projectId, marked);
    assert.ok(run.ok);

    const entries = await listQueueEntries(db, projectId);
    assert.equal(entries.find((entry) => entry.taskId === marked)?.started, true);
    assert.equal(entries.find((entry) => entry.taskId === untouched)?.started, false);
  });

  it("laisse un lancement hors file sans effet", async () => {
    // Le marquage est conditionnel a l'existence d'une inscription : une tache
    // lancee a la main dans un projet sans file ne produit aucune ligne.
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");

    const run = await newRun(projectId, taskId);
    assert.ok(run.ok);
    assert.equal(await countQueueEntries(db, projectId), 0);
  });

  it("repart de zero quand la tache est reinscrite", async () => {
    // Retirer puis reinscrire cree une ligne neuve : la question posee est
    // « cette inscription a-t-elle commence », jamais « cette tache a-t-elle un
    // passe ».
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });

    const run = await newRun(projectId, taskId);
    assert.ok(run.ok);
    await reopen(projectId, taskId, run.run.id);

    const removed = await dequeueTask(db, { projectId, taskId });
    assert.ok(removed.ok);
    await enqueueTask(db, { projectId, taskId });

    const [row] = await listQueueEntries(db, projectId);
    assert.equal(row?.started, false);
  });

  it("garde la date du premier depart, pas du dernier", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });

    const first = await newRun(projectId, taskId);
    assert.ok(first.ok);
    const stamped = await db.taskQueueEntry.findUnique({
      where: { taskId },
      select: { startedAt: true },
    });
    await reopen(projectId, taskId, first.run.id);

    const second = await newRun(projectId, taskId);
    assert.ok(second.ok);
    const after = await db.taskQueueEntry.findUnique({
      where: { taskId },
      select: { startedAt: true },
    });
    assert.deepEqual(after?.startedAt, stamped?.startedAt);
  });

  it("disparait avec l'acceptation de la tache", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });

    const run = await newRun(projectId, taskId);
    assert.ok(run.ok);
    await reopen(projectId, taskId, run.run.id);
    const done = await updateTaskStatus(db, taskId, projectId, TASK_STATUS.COMPLETED);
    assert.ok(done.ok);

    assert.equal(await isTaskQueued(db, taskId), false);
    assert.equal(await isQueueActive(db, projectId), false);
  });

  it("refuse de deplacer une entree qui a commence", async () => {
    // Deplacer la barriere ne changerait rien a ce qui se passe, et laisserait
    // croire le contraire — y compris quand son statut est revenu a `READY`.
    const projectId = await newProject();
    const first = await newReadyTask(projectId, "A");
    const second = await newReadyTask(projectId, "B");
    await enqueueTask(db, { projectId, taskId: first });
    await enqueueTask(db, { projectId, taskId: second });

    const run = await newRun(projectId, first);
    assert.ok(run.ok);
    await reopen(projectId, first, run.run.id);

    const moved = await moveQueueEntry(db, { projectId, taskId: first, direction: "down" });
    assert.equal(moved.ok, false);
    assert.equal(
      moved.ok === false && moved.code,
      EXECUTION_QUEUE_ERROR.TASK_HAS_ACTIVE_RUN,
    );
    assert.deepEqual(await codes(projectId), await codes(projectId));
  });

  it("autorise le retrait humain d'une entree rouverte", async () => {
    const projectId = await newProject();
    const taskId = await newReadyTask(projectId, "A");
    await enqueueTask(db, { projectId, taskId });

    const run = await newRun(projectId, taskId);
    assert.ok(run.ok);
    await reopen(projectId, taskId, run.run.id);

    const removed = await dequeueTask(db, { projectId, taskId });
    assert.ok(removed.ok);
    assert.equal(await isTaskQueued(db, taskId), false);

    // Le statut et l'historique restent : retirer de la file n'abandonne rien.
    const task = await db.task.findUnique({ where: { id: taskId }, select: { status: true } });
    assert.equal(task?.status, TASK_STATUS.READY);
    assert.equal(await db.run.count({ where: { taskId } }), 1);
  });
});
