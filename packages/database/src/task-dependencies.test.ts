/**
 * Persistance du graphe de dependances.
 *
 * ## Ce que ce fichier prouve
 *
 * Que le graphe reste un DAG, y compris quand deux requetes tentent de le
 * fermer **en meme temps**. C'est la garantie qui ne peut pas se tester sans
 * base : une verification applicative hors transaction la donnerait a lire comme
 * correcte tout en etant fausse.
 *
 * Que les frontieres tiennent : pas d'auto-dependance, pas de projet croise, pas
 * d'amorcage qui attendrait une tache produit, pas d'arete en double.
 *
 * Que la satisfaction se derive du statut courant, sans qu'aucune ligne ne soit
 * reecrite quand une tache terminee est rouverte.
 *
 * Et qu'une tache attendue par une autre n'est pas supprimable.
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
  TASK_DEPENDENCY_ERROR,
  TASK_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
  summarizeTaskDependencies,
} from "@nox/shared";

import {
  addTaskDependency,
  createDatabaseClient,
  createProject,
  createTask,
  deleteTaskWithoutRuns,
  hasAnyCycle,
  listDependencyCandidates,
  listDependencyIds,
  listTaskDependencies,
  removeTaskDependency,
  countProjectDependencies,
  toDatabaseFilePath,
  toSqliteUrl,
  updateTaskStatus,
  writeTaskRow,
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

/** Cree la tache d'amorcage du projet, avec son numero reserve. */
async function newBootstrapTask(projectId: string): Promise<string> {
  const task = await writeTaskRow(db, {
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
  return task.id;
}

/** « A attend B », dans le sens et l'ordre de la convention. */
function depends(projectId: string, taskId: string, dependsOnTaskId: string) {
  return addTaskDependency(db, { projectId, taskId, dependsOnTaskId });
}

async function edgeCount(): Promise<number> {
  return db.taskDependency.count();
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-deps-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("creation d'une arete", () => {
  it("enregistre « A attend B » dans ce sens", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");

    const added = await depends(projectId, a, b);
    assert.ok(added.ok);
    assert.equal(added.ok && added.created, true);

    // Le sens est verifie des deux cotes : c'est l'erreur qu'un test unilateral
    // laisserait passer.
    const fromA = await listTaskDependencies(db, a);
    assert.deepEqual(
      fromA.dependsOn.map((entry) => entry.id),
      [b],
    );
    assert.deepEqual(fromA.dependents, []);

    const fromB = await listTaskDependencies(db, b);
    assert.deepEqual(fromB.dependsOn, []);
    assert.deepEqual(
      fromB.dependents.map((entry) => entry.id),
      [a],
    );
  });

  it("est idempotente : deux fois la meme arete, une seule ligne", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");

    const first = await depends(projectId, a, b);
    const second = await depends(projectId, a, b);

    assert.equal(first.ok && first.created, true);
    // Un double-clic n'est pas une faute : le second appel reussit sans creer.
    assert.ok(second.ok);
    assert.equal(second.ok && second.created, false);

    const rows = await db.taskDependency.count({ where: { taskId: a } });
    assert.equal(rows, 1);
  });

  it("ordonne les deux listes par code", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");
    const c = await newTask(projectId, "C");

    // Ajoutees dans le desordre : l'ordre affiche ne doit pas en dependre.
    await depends(projectId, c, b);
    await depends(projectId, c, a);

    const rows = await listTaskDependencies(db, c);
    assert.deepEqual(
      rows.dependsOn.map((entry) => entry.code),
      ["TASK-001", "TASK-002"],
    );
  });
});

describe("frontieres", () => {
  it("refuse une tache qui dependrait d'elle-meme", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");

    const before = await edgeCount();
    const result = await depends(projectId, a, a);

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, TASK_DEPENDENCY_ERROR.SELF);
    assert.equal(await edgeCount(), before);
  });

  it("refuse deux projets differents, meme avec un identifiant valide", async () => {
    const first = await newProject();
    const second = await newProject();
    const a = await newTask(first, "A");
    const b = await newTask(second, "B");

    const before = await edgeCount();
    // Le navigateur pourrait forger cet identifiant ; le serveur relit les deux
    // projets et refuse.
    const result = await depends(first, a, b);

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, TASK_DEPENDENCY_ERROR.CROSS_PROJECT);
    assert.equal(await edgeCount(), before);
  });

  it("refuse une tache inexistante", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");

    const result = await depends(projectId, a, "identifiant-invente");
    assert.equal(result.ok === false && result.code, TASK_DEPENDENCY_ERROR.UNKNOWN_TASK);
  });

  it("refuse une tache qui appartient a un autre projet que celui declare", async () => {
    const first = await newProject();
    const second = await newProject();
    const a = await newTask(first, "A");
    const b = await newTask(first, "B");

    // La tache qui attend est cherchee **dans** le projet declare : declarer le
    // mauvais projet la rend introuvable.
    const result = await addTaskDependency(db, {
      projectId: second,
      taskId: a,
      dependsOnTaskId: b,
    });
    assert.equal(result.ok === false && result.code, TASK_DEPENDENCY_ERROR.UNKNOWN_TASK);
  });
});

describe("semantique de l'amorcage", () => {
  it("autorise une tache produit a attendre TASK-000", async () => {
    const projectId = await newProject();
    const boot = await newBootstrapTask(projectId);
    const a = await newTask(projectId, "A");

    const result = await depends(projectId, a, boot);
    assert.ok(result.ok);

    const rows = await listTaskDependencies(db, a);
    assert.equal(rows.dependsOn[0]?.code, "TASK-000");
    assert.equal(rows.dependsOn[0]?.kind, TASK_KIND.BOOTSTRAP);
  });

  it("refuse a TASK-000 de dependre d'une tache produit", async () => {
    const projectId = await newProject();
    const boot = await newBootstrapTask(projectId);
    const a = await newTask(projectId, "A");

    const before = await edgeCount();
    const result = await depends(projectId, boot, a);

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, TASK_DEPENDENCY_ERROR.BOOTSTRAP_SOURCE);
    assert.equal(await edgeCount(), before);
  });

  it("n'ajoute aucune dependance implicite vers l'amorcage", async () => {
    const projectId = await newProject();
    await newBootstrapTask(projectId);
    const a = await newTask(projectId, "A");

    // Creer une tache produit apres un amorcage ne cree rien : le graphe est
    // entierement explicite.
    const rows = await listTaskDependencies(db, a);
    assert.deepEqual(rows.dependsOn, []);
  });
});

describe("cycles", () => {
  it("refuse un cycle direct", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");

    assert.ok((await depends(projectId, a, b)).ok);
    const result = await depends(projectId, b, a);

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, TASK_DEPENDENCY_ERROR.CYCLE);
    // L'arete ecrite avant la detection a disparu avec la transaction.
    assert.equal(await db.taskDependency.count({ where: { taskId: b } }), 0);
  });

  it("refuse un cycle transitif", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");
    const c = await newTask(projectId, "C");

    assert.ok((await depends(projectId, a, b)).ok);
    assert.ok((await depends(projectId, b, c)).ok);

    const result = await depends(projectId, c, a);
    assert.equal(result.ok === false && result.code, TASK_DEPENDENCY_ERROR.CYCLE);
    assert.equal(await db.taskDependency.count({ where: { taskId: c } }), 0);
  });

  it("accepte un losange", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");
    const c = await newTask(projectId, "C");
    const d = await newTask(projectId, "D");

    // B et C attendent D ; A attend B et C. Aucun cycle, et c'est la forme la
    // plus courante d'un vrai backlog.
    for (const [from, to] of [
      [b, d],
      [c, d],
      [a, b],
      [a, c],
    ] as const) {
      assert.ok((await depends(projectId, from, to)).ok);
    }

    const rows = await listTaskDependencies(db, a);
    assert.equal(rows.dependsOn.length, 2);
  });

  it("ne se laisse pas fermer par deux requetes simultanees", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");

    // Le cas que le prompt de TASK-024 decrit : chacune, prise isolement, est
    // valide. Ensemble, elles formeraient un cycle.
    const [first, second] = await Promise.all([
      depends(projectId, a, b),
      depends(projectId, b, a),
    ]);

    const accepted = [first, second].filter((entry) => entry.ok).length;
    assert.equal(accepted, 1, "une seule des deux aretes est acceptee");

    const edges = await db.taskDependency.findMany({
      where: { task: { projectId } },
      select: { taskId: true, dependsOnTaskId: true },
    });
    assert.equal(edges.length, 1);
    assert.equal(hasAnyCycle(edges), false, "le graphe final ne contient aucun cycle");
  });

  it("resiste a quatre tentatives concurrentes de fermer une chaine", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");
    const c = await newTask(projectId, "C");

    assert.ok((await depends(projectId, a, b)).ok);
    assert.ok((await depends(projectId, b, c)).ok);

    const attempts = await Promise.all([
      depends(projectId, c, a),
      depends(projectId, c, a),
      depends(projectId, c, b),
      depends(projectId, c, a),
    ]);

    assert.ok(attempts.every((entry) => !entry.ok), "toutes fermeraient une boucle");

    const edges = await db.taskDependency.findMany({
      where: { task: { projectId } },
      select: { taskId: true, dependsOnTaskId: true },
    });
    assert.equal(hasAnyCycle(edges), false);
  });
});

describe("suppression d'une arete", () => {
  it("retire l'arete demandee, et elle seule", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");
    const c = await newTask(projectId, "C");

    await depends(projectId, a, b);
    await depends(projectId, a, c);

    const removed = await removeTaskDependency(db, {
      projectId,
      taskId: a,
      dependsOnTaskId: b,
    });
    assert.ok(removed.ok);
    assert.equal(removed.ok && removed.removed, true);

    assert.deepEqual(await listDependencyIds(db, a), [c]);
  });

  it("est idempotente : une arete absente est une reussite", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");

    const removed = await removeTaskDependency(db, {
      projectId,
      taskId: a,
      dependsOnTaskId: b,
    });
    assert.ok(removed.ok);
    assert.equal(removed.ok && removed.removed, false);
  });

  it("laisse les deux taches intactes", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");
    await depends(projectId, a, b);
    await removeTaskDependency(db, { projectId, taskId: a, dependsOnTaskId: b });

    assert.equal(await db.task.count({ where: { projectId } }), 2);
  });
});

describe("satisfaction derivee", () => {
  it("passe de « en attente » a « satisfaite » quand la tache se termine", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");
    await depends(projectId, b, a);

    const waiting = summarizeTaskDependencies(await listTaskDependencies(db, b));
    assert.equal(waiting.allSatisfied, false);
    assert.equal(waiting.unresolved, 1);

    await updateTaskStatus(db, a, projectId, TASK_STATUS.READY);
    await updateTaskStatus(db, a, projectId, TASK_STATUS.COMPLETED);

    // Aucune ligne n'a ete reecrite pour B : sa reponse change parce que le
    // statut de A a change.
    const satisfied = summarizeTaskDependencies(await listTaskDependencies(db, b));
    assert.equal(satisfied.allSatisfied, true);
    assert.equal(satisfied.resolved, 1);
  });

  it("redevient en attente si la tache est rouverte", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");
    await depends(projectId, b, a);

    await updateTaskStatus(db, a, projectId, TASK_STATUS.READY);
    await updateTaskStatus(db, a, projectId, TASK_STATUS.COMPLETED);
    await updateTaskStatus(db, a, projectId, TASK_STATUS.READY);

    const reopened = summarizeTaskDependencies(await listTaskDependencies(db, b));
    assert.equal(reopened.allSatisfied, false);
  });

  it("ne modifie jamais le statut de la tache dependante", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");

    await updateTaskStatus(db, b, projectId, TASK_STATUS.READY);
    await depends(projectId, b, a);

    // `BLOCKED` reste un etat metier decide par un humain. Une dependance non
    // satisfaite ne le pose jamais.
    const row = await db.task.findUnique({ where: { id: b }, select: { status: true } });
    assert.equal(row?.status, TASK_STATUS.READY);
  });

  it("compte les dependances de tout un projet en une requete", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");
    const c = await newTask(projectId, "C");

    await depends(projectId, c, a);
    await depends(projectId, c, b);
    await updateTaskStatus(db, a, projectId, TASK_STATUS.READY);
    await updateTaskStatus(db, a, projectId, TASK_STATUS.COMPLETED);

    const counts = await countProjectDependencies(db, projectId);
    assert.deepEqual(counts.get(c), { total: 2, unresolved: 1 });
    // Une tache sans dependance n'apparait pas : la liste n'affiche rien pour
    // elle.
    assert.equal(counts.get(a), undefined);
  });
});

describe("candidats proposables", () => {
  it("rend les taches du projet, ordonnees par code, amorcage compris", async () => {
    const projectId = await newProject();
    await newBootstrapTask(projectId);
    await newTask(projectId, "A");
    await newTask(projectId, "B");

    const candidates = await listDependencyCandidates(db, projectId);
    assert.deepEqual(
      candidates.map((entry) => entry.code),
      ["TASK-000", "TASK-001", "TASK-002"],
    );
  });

  it("ne rend aucune tache d'un autre projet", async () => {
    const first = await newProject();
    const second = await newProject();
    await newTask(first, "A");
    await newTask(second, "B");

    const candidates = await listDependencyCandidates(db, first);
    assert.equal(candidates.length, 1);
  });
});

describe("suppression d'une tache attendue", () => {
  it("est refusee, et nomme les taches qui attendent", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");
    await depends(projectId, b, a);

    const result = await deleteTaskWithoutRuns(db, projectId, a);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "has_dependents");
    assert.deepEqual(
      result.ok === false && result.reason === "has_dependents"
        ? result.dependents.map((entry) => entry.code)
        : [],
      ["TASK-002"],
    );

    // Ni la tache, ni l'arete n'ont bouge.
    assert.notEqual(await db.task.findUnique({ where: { id: a } }), null);
    assert.equal(await db.taskDependency.count({ where: { dependsOnTaskId: a } }), 1);
  });

  it("redevient possible une fois la dependance retiree", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");
    await depends(projectId, b, a);

    await removeTaskDependency(db, { projectId, taskId: b, dependsOnTaskId: a });
    const result = await deleteTaskWithoutRuns(db, projectId, a);

    assert.equal(result.ok, true);
    assert.equal(await db.task.findUnique({ where: { id: a } }), null);
  });

  it("emporte les aretes sortantes de la tache supprimee", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");
    await depends(projectId, a, b);

    // A attend B : supprimer A retire l'arete, qui n'a plus de sujet. Supprimer
    // B serait refuse — c'est le sens inverse.
    const result = await deleteTaskWithoutRuns(db, projectId, a);
    assert.equal(result.ok, true);
    assert.equal(await db.taskDependency.count({ where: { dependsOnTaskId: b } }), 0);
  });
});
