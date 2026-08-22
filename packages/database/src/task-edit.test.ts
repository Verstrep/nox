/**
 * Edition d'une tache future.
 *
 * ## Ce que ce fichier prouve
 *
 * Que la sauvegarde est **une** operation : contrat, dependances et statut
 * changent ensemble, ou rien ne change. Une dependance refusee laisse
 * l'objectif exactement comme il etait.
 *
 * Que `READY` redevient `DRAFT` quand le contrat change, et **seulement** alors.
 *
 * Que ce qui est immuable l'est : code, numero, nature, provenance de backlog.
 *
 * Et qu'un onglet reste ne peut pas ecraser le travail d'un autre.
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
  TASK_DEPENDENCY_ERROR,
  TASK_EDIT_ERROR,
  TASK_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
} from "@nox/shared";

import {
  addTaskDependency,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  getTaskById,
  listDependencyIds,
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

/**
 * Fonction de revision de test.
 *
 * Volontairement differente de celle d'`apps/web` : ce module ne doit dependre
 * que du **contrat** d'injection, jamais d'une implementation particuliere.
 */
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

/** Revision courante d'une tache, telle que la page la calculerait. */
async function currentRevision(taskId: string): Promise<string> {
  const task = await getTaskById(db, taskId);
  assert.ok(task !== null);
  return revision({
    title: task.title,
    objective: task.objective,
    context: task.context,
    outOfScope: task.outOfScope,
    priority: task.priority,
    acceptanceCriteria: task.acceptanceCriteria,
    documentReferences: task.documentReferences,
    validationCommands: task.validationCommands,
    dependsOnTaskIds: await listDependencyIds(db, taskId),
  });
}

async function valuesOf(taskId: string, overrides: Partial<TaskEditInput> = {}): Promise<TaskEditInput> {
  const task = await getTaskById(db, taskId);
  assert.ok(task !== null);
  return {
    title: task.title,
    objective: task.objective,
    context: task.context,
    outOfScope: task.outOfScope,
    priority: task.priority,
    acceptanceCriteria: [...task.acceptanceCriteria],
    documentReferences: [...task.documentReferences],
    validationCommands: [...task.validationCommands],
    dependsOnTaskIds: await listDependencyIds(db, taskId),
    ...overrides,
  };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-task-edit-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("edition d'un brouillon", () => {
  it("enregistre les huit champs du contrat", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A");
    const other = await newTask(projectId, "B");

    const result = await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: await currentRevision(taskId),
      revision,
      values: await valuesOf(taskId, {
        title: "Titre revu",
        objective: "Objectif revu.",
        context: "Contexte ajoute.",
        outOfScope: "- Rien d'autre.",
        priority: TASK_PRIORITY.HIGH,
        acceptanceCriteria: ["Premier critere", "Second critere"],
        documentReferences: ["docs/ARCHITECTURE.md"],
        validationCommands: ["npm run test"],
        dependsOnTaskIds: [other],
      }),
    });

    assert.ok(result.ok);
    assert.equal(result.ok && result.changed, true);

    const saved = await getTaskById(db, taskId);
    assert.equal(saved?.title, "Titre revu");
    assert.equal(saved?.objective, "Objectif revu.");
    assert.equal(saved?.context, "Contexte ajoute.");
    assert.equal(saved?.outOfScope, "- Rien d'autre.");
    assert.equal(saved?.priority, TASK_PRIORITY.HIGH);
    assert.deepEqual(saved?.acceptanceCriteria, ["Premier critere", "Second critere"]);
    assert.deepEqual(saved?.documentReferences, ["docs/ARCHITECTURE.md"]);
    assert.deepEqual(saved?.validationCommands, ["npm run test"]);
    assert.deepEqual(await listDependencyIds(db, taskId), [other]);
  });

  it("conserve l'ordre des listes", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A");

    await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: await currentRevision(taskId),
      revision,
      values: await valuesOf(taskId, {
        acceptanceCriteria: ["Troisieme", "Premier", "Second"],
      }),
    });

    const saved = await getTaskById(db, taskId);
    assert.deepEqual(saved?.acceptanceCriteria, ["Troisieme", "Premier", "Second"]);
  });

  it("laisse un brouillon en brouillon", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A");

    await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: await currentRevision(taskId),
      revision,
      values: await valuesOf(taskId, { objective: "Autre objectif." }),
    });

    const saved = await getTaskById(db, taskId);
    assert.equal(saved?.status, TASK_STATUS.DRAFT);
  });
});

describe("ce qui reste immuable", () => {
  it("ne touche ni au code, ni au numero, ni a la nature, ni aux dates de creation", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A");
    const before = await db.task.findUnique({
      where: { id: taskId },
      select: { sequence: true, kind: true, createdAt: true, projectId: true },
    });

    await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: await currentRevision(taskId),
      revision,
      values: await valuesOf(taskId, { title: "Autre titre" }),
    });

    const after = await db.task.findUnique({
      where: { id: taskId },
      select: { sequence: true, kind: true, createdAt: true, projectId: true },
    });
    assert.deepEqual(after, before);
  });

  it("preserve la provenance de backlog", async () => {
    const projectId = await newProject();
    const created = await writeTaskRow(db, {
      projectId,
      sequence: 7,
      title: "Issue d'un backlog",
      objective: "Objectif initial.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: ["Verifiable"],
      documentReferences: [],
      validationCommands: [],
      backlogItemPosition: 3,
    });

    await updateFutureTask(db, {
      projectId,
      taskId: created.id,
      expectedRevision: await currentRevision(created.id),
      revision,
      values: await valuesOf(created.id, { objective: "Objectif humain." }),
    });

    const row = await db.task.findUnique({
      where: { id: created.id },
      select: { backlogProposalId: true, backlogItemPosition: true },
    });
    // Le backlog reste ce qui a ete applique a l'epoque ; la tache devient le
    // contrat courant. Les deux restent distincts.
    assert.equal(row?.backlogItemPosition, 3);
    assert.equal(row?.backlogProposalId, null);
  });

  it("n'edite jamais une tache d'un autre projet", async () => {
    const first = await newProject();
    const second = await newProject();
    const taskId = await newTask(first, "A");

    const result = await updateFutureTask(db, {
      projectId: second,
      taskId,
      expectedRevision: await currentRevision(taskId),
      revision,
      values: await valuesOf(taskId, { title: "Vole" }),
    });

    assert.equal(result.ok, false);
    assert.equal(
      result.ok === false && result.reason === "edit" && result.code,
      TASK_EDIT_ERROR.UNKNOWN_TASK,
    );
  });
});

describe("une tache en file qui change", () => {
  it("redescend en brouillon", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A");
    await updateTaskStatus(db, taskId, projectId, TASK_STATUS.READY);

    const result = await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: await currentRevision(taskId),
      revision,
      values: await valuesOf(taskId, { objective: "Objectif revu." }),
    });

    assert.ok(result.ok);
    assert.equal(result.ok && result.task.status, TASK_STATUS.DRAFT);
  });

  it("redescend aussi quand seule une dependance change", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A");
    const other = await newTask(projectId, "B");
    await updateTaskStatus(db, taskId, projectId, TASK_STATUS.READY);

    const result = await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: await currentRevision(taskId),
      revision,
      values: await valuesOf(taskId, { dependsOnTaskIds: [other] }),
    });

    assert.ok(result.ok && result.task.status === TASK_STATUS.DRAFT);
  });

  it("reste en file quand rien ne change", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A");
    await updateTaskStatus(db, taskId, projectId, TASK_STATUS.READY);
    const updatedBefore = (
      await db.task.findUnique({ where: { id: taskId }, select: { updatedAt: true } })
    )?.updatedAt;

    const result = await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: await currentRevision(taskId),
      revision,
      values: await valuesOf(taskId),
    });

    assert.ok(result.ok);
    assert.equal(result.ok && result.changed, false);
    assert.equal(result.ok && result.task.status, TASK_STATUS.READY);

    // Ni statut, ni `updatedAt` : ouvrir un formulaire puis le refermer n'est
    // pas une modification.
    const updatedAfter = (
      await db.task.findUnique({ where: { id: taskId }, select: { updatedAt: true } })
    )?.updatedAt;
    assert.deepEqual(updatedAfter, updatedBefore);
  });

  it("reste en file quand seul l'ordre des dependances change", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");
    const c = await newTask(projectId, "C");
    await addTaskDependency(db, { projectId, taskId, dependsOnTaskId: b });
    await addTaskDependency(db, { projectId, taskId, dependsOnTaskId: c });
    await updateTaskStatus(db, taskId, projectId, TASK_STATUS.READY);

    const current = await listDependencyIds(db, taskId);
    const result = await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: await currentRevision(taskId),
      revision,
      // L'ordre des dependances ne signifie rien : cocher puis recocher ne doit
      // pas degrader un contrat valide.
      values: await valuesOf(taskId, { dependsOnTaskIds: [...current].reverse() }),
    });

    assert.ok(result.ok);
    assert.equal(result.ok && result.changed, false);
    assert.equal(result.ok && result.task.status, TASK_STATUS.READY);
  });
});

describe("gel apres la premiere execution", () => {
  it("refuse d'editer une tache qui a deja tourne", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A");
    await createRun(db, {
      taskId,
      prompt: "Prompt.",
      promptSha256: "a".repeat(64),
      runnerRunId: "11111111-1111-4111-8111-111111111111",
    });

    const result = await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: await currentRevision(taskId),
      revision,
      values: await valuesOf(taskId, { objective: "Reecrit apres coup." }),
    });

    assert.equal(result.ok, false);
    assert.equal(
      result.ok === false && result.reason === "edit" && result.code,
      TASK_EDIT_ERROR.FROZEN,
    );

    const saved = await getTaskById(db, taskId);
    assert.equal(saved?.objective, "Objectif de A.");
  });

  it("reste gele apres un retour en file", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A");
    await createRun(db, {
      taskId,
      prompt: "Prompt.",
      promptSha256: "b".repeat(64),
      runnerRunId: "22222222-2222-4222-8222-222222222222",
    });
    await updateTaskStatus(db, taskId, projectId, TASK_STATUS.READY);

    const result = await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: await currentRevision(taskId),
      revision,
      values: await valuesOf(taskId, { title: "Reecrit" }),
    });

    // Le statut ressemble a celui d'une tache neuve ; son passe dit le
    // contraire.
    assert.equal(
      result.ok === false && result.reason === "edit" && result.code,
      TASK_EDIT_ERROR.FROZEN,
    );
  });

  it("refuse aussi d'ajouter une dependance", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A");
    const other = await newTask(projectId, "B");
    await createRun(db, {
      taskId,
      prompt: "Prompt.",
      promptSha256: "c".repeat(64),
      runnerRunId: "33333333-3333-4333-8333-333333333333",
    });

    const result = await addTaskDependency(db, { projectId, taskId, dependsOnTaskId: other });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, TASK_DEPENDENCY_ERROR.FROZEN);
  });
});

describe("concurrence optimiste", () => {
  it("refuse une sauvegarde partie d'une revision perimee", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A");

    // Deux onglets lisent le meme etat.
    const tabA = await currentRevision(taskId);
    const tabB = await currentRevision(taskId);

    const saveB = await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: tabB,
      revision,
      values: await valuesOf(taskId, { objective: "Version de B." }),
    });
    assert.ok(saveB.ok);

    const saveA = await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: tabA,
      revision,
      values: await valuesOf(taskId, { objective: "Version de A." }),
    });

    assert.equal(saveA.ok, false);
    assert.equal(
      saveA.ok === false && saveA.reason === "edit" && saveA.code,
      TASK_EDIT_ERROR.STALE,
    );

    // Le travail de B est preserve : A n'ecrase rien.
    const saved = await getTaskById(db, taskId);
    assert.equal(saved?.objective, "Version de B.");
  });

  it("rend la revision courante avec le refus", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A");

    const result = await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: "revision-inventee",
      revision,
      values: await valuesOf(taskId, { title: "Autre" }),
    });

    assert.equal(result.ok, false);
    assert.equal(
      result.ok === false && result.reason === "edit" && result.currentRevision,
      await currentRevision(taskId),
    );
  });

  it("ignore une resynchronisation de document dans la revision", async () => {
    const projectId = await newProject();
    const taskId = await newTask(projectId, "A");
    const opened = await currentRevision(taskId);

    // Une resynchronisation touche `updatedAt` sans changer le contrat. Une
    // revision fondee sur `updatedAt` aurait perime le formulaire ici.
    await db.task.update({
      where: { id: taskId },
      data: { documentRevision: "f".repeat(64) },
    });

    const result = await updateFutureTask(db, {
      projectId,
      taskId,
      expectedRevision: opened,
      revision,
      values: await valuesOf(taskId, { objective: "Objectif revu." }),
    });

    assert.ok(result.ok);
  });
});

describe("atomicite", () => {
  it("annule tout quand une dependance formerait un cycle", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");
    await addTaskDependency(db, { projectId, taskId: b, dependsOnTaskId: a });
    await updateTaskStatus(db, a, projectId, TASK_STATUS.READY);

    const result = await updateFutureTask(db, {
      projectId,
      taskId: a,
      expectedRevision: await currentRevision(a),
      revision,
      values: await valuesOf(a, {
        objective: "Objectif qui ne doit pas etre enregistre.",
        dependsOnTaskIds: [b],
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(
      result.ok === false && result.reason === "dependency" && result.code,
      TASK_DEPENDENCY_ERROR.CYCLE,
    );

    // Ni l'objectif, ni les dependances, ni le statut n'ont bouge.
    const saved = await getTaskById(db, a);
    assert.equal(saved?.objective, "Objectif de A.");
    assert.equal(saved?.status, TASK_STATUS.READY);
    assert.deepEqual(await listDependencyIds(db, a), []);
  });

  it("annule tout quand une dependance vise un autre projet", async () => {
    const first = await newProject();
    const second = await newProject();
    const a = await newTask(first, "A");
    const foreign = await newTask(second, "B");

    const result = await updateFutureTask(db, {
      projectId: first,
      taskId: a,
      expectedRevision: await currentRevision(a),
      revision,
      values: await valuesOf(a, {
        title: "Ne doit pas etre enregistre",
        dependsOnTaskIds: [foreign],
      }),
    });

    assert.equal(
      result.ok === false && result.reason === "dependency" && result.code,
      TASK_DEPENDENCY_ERROR.CROSS_PROJECT,
    );
    const saved = await getTaskById(db, a);
    assert.equal(saved?.title, "A");
  });

  it("annule tout quand une dependance designe la tache elle-meme", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");

    const result = await updateFutureTask(db, {
      projectId,
      taskId: a,
      expectedRevision: await currentRevision(a),
      revision,
      values: await valuesOf(a, { objective: "Perdu.", dependsOnTaskIds: [a] }),
    });

    assert.equal(
      result.ok === false && result.reason === "dependency" && result.code,
      TASK_DEPENDENCY_ERROR.SELF,
    );
    assert.equal((await getTaskById(db, a))?.objective, "Objectif de A.");
  });

  it("refuse a l'amorcage de se donner une dependance produit", async () => {
    const projectId = await newProject();
    const boot = await writeTaskRow(db, {
      projectId,
      sequence: 0,
      kind: TASK_KIND.BOOTSTRAP,
      title: "Bootstrap",
      objective: "Etablir la fondation.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.HIGH,
      acceptanceCriteria: ["Le repository demarre."],
      documentReferences: [],
      validationCommands: [],
    });
    const a = await newTask(projectId, "A");

    const result = await updateFutureTask(db, {
      projectId,
      taskId: boot.id,
      expectedRevision: await currentRevision(boot.id),
      revision,
      values: await valuesOf(boot.id, { dependsOnTaskIds: [a] }),
    });

    assert.equal(
      result.ok === false && result.reason === "dependency" && result.code,
      TASK_DEPENDENCY_ERROR.BOOTSTRAP_SOURCE,
    );
  });

  it("dedoublonne une liste soumise deux fois la meme tache", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    const b = await newTask(projectId, "B");

    // Une saisie maladroite, pas une erreur a faire remonter en violation de
    // contrainte : ce module est l'autorite, et il normalise ce qu'il recoit.
    const result = await updateFutureTask(db, {
      projectId,
      taskId: a,
      expectedRevision: await currentRevision(a),
      revision,
      values: await valuesOf(a, { dependsOnTaskIds: [b, b] }),
    });

    assert.ok(result.ok);
    assert.deepEqual(await listDependencyIds(db, a), [b]);
  });

  it("verifie le gel avant les dependances", async () => {
    const projectId = await newProject();
    const a = await newTask(projectId, "A");
    await createRun(db, {
      taskId: a,
      prompt: "Prompt.",
      promptSha256: "d".repeat(64),
      runnerRunId: "44444444-4444-4444-8444-444444444444",
    });

    // Une tache figee **et** une dependance invalide : le refus utile est le
    // gel, parce que corriger la dependance ne debloquerait rien.
    const result = await updateFutureTask(db, {
      projectId,
      taskId: a,
      expectedRevision: await currentRevision(a),
      revision,
      values: await valuesOf(a, { dependsOnTaskIds: [a] }),
    });

    assert.equal(
      result.ok === false && result.reason === "edit" && result.code,
      TASK_EDIT_ERROR.FROZEN,
    );
  });
});
