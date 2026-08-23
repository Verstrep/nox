import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Le package compile est importe volontairement : c'est l'artefact que consomme
// `apps/web`, et le client Prisma genere n'est resolvable qu'une fois compile.
import {
  InvalidTaskRecordError,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  deleteTaskWithoutRuns,
  getTaskById,
  isUniqueConstraintError,
  listTasksByProject,
  markTaskDocumentConflict,
  markTaskDocumentError,
  markTaskDocumentSynced,
  toDatabaseFilePath,
  toSqliteUrl,
  updateTaskStatus,
  type CreateTaskInput,
  type DatabaseClient,
} from "../dist/index.js";

/**
 * Base SQLite temporaire, creee a partir des vraies migrations du projet. La
 * base de developpement (`data/nox-dev.db`) n'est ni lue ni modifiee.
 */
const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma",
  "migrations",
);

let workspace: string;
let databaseFile: string;
let db: DatabaseClient;

async function applyMigrations(target: string): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const sqlite = new DatabaseSync(target);
  try {
    for (const directory of directories) {
      sqlite.exec(await readFile(path.join(MIGRATIONS_DIR, directory, "migration.sql"), "utf8"));
    }
  } finally {
    sqlite.close();
  }
}

let projectCounter = 0;

async function newProject(): Promise<string> {
  projectCounter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(projectCounter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(projectCounter)}`),
  });
  return project.id;
}

function specification(projectId: string, overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    projectId,
    title: "Une tache",
    objective: "Un objectif verifiable.",
    context: null,
    outOfScope: null,
    priority: "MEDIUM",
    acceptanceCriteria: ["Premier critere."],
    documentReferences: [],
    validationCommands: [],
    ...overrides,
  };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-tasks-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  databaseFile = toDatabaseFilePath(databaseUrl);

  await applyMigrations(databaseFile);
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("allocation des numeros de tache", () => {
  it("attribue TASK-001 a la premiere tache d'un projet", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));

    assert.equal(task?.code, "TASK-001");
    assert.equal(task?.documentPath, "tasks/TASK-001.md");
  });

  it("incremente le numero a chaque creation", async () => {
    const projectId = await newProject();

    const first = await createTask(db, specification(projectId, { title: "Premiere" }));
    const second = await createTask(db, specification(projectId, { title: "Seconde" }));
    const third = await createTask(db, specification(projectId, { title: "Troisieme" }));

    assert.deepEqual([first?.code, second?.code, third?.code], [
      "TASK-001",
      "TASK-002",
      "TASK-003",
    ]);
  });

  it("n'attribue jamais deux fois le meme numero, meme en creation concurrente", async () => {
    const projectId = await newProject();

    const created = await Promise.all(
      Array.from({ length: 15 }, (_, index) =>
        createTask(db, specification(projectId, { title: `Tache ${String(index)}` })),
      ),
    );

    const codes = created.map((task) => task?.code);
    assert.equal(new Set(codes).size, codes.length, `codes en double : ${codes.join(", ")}`);
    assert.deepEqual([...codes].sort(), [...codes].sort());
    assert.equal((await listTasksByProject(db, projectId)).length, 15);
  });

  it("garde un compteur independant par projet", async () => {
    const first = await newProject();
    const second = await newProject();

    await createTask(db, specification(first));
    await createTask(db, specification(first));
    const other = await createTask(db, specification(second));

    // Le second projet repart de 1 : le compteur appartient au projet, pas a la
    // base.
    assert.equal(other?.code, "TASK-001");
  });

  it("ne reutilise pas un numero libere", async () => {
    const projectId = await newProject();

    const first = await createTask(db, specification(projectId));
    assert.ok(first !== null);
    await db.task.delete({ where: { id: first.id } });

    const next = await createTask(db, specification(projectId));
    // Un trou est prefere a la reutilisation d'un identifiant ayant pu circuler
    // dans Git ou dans un log.
    assert.equal(next?.code, "TASK-002");
  });

  it("refuse un projet inconnu sans lever", async () => {
    assert.equal(await createTask(db, specification("projet-inexistant")), null);
  });

  it("interdit deux taches de meme numero dans un projet", async () => {
    const projectId = await newProject();
    const existing = await createTask(db, specification(projectId));
    assert.ok(existing !== null);

    await assert.rejects(
      db.task.create({
        data: {
          projectId,
          sequence: 1,
          title: "Doublon",
          objective: "Objectif",
          status: "DRAFT",
          priority: "MEDIUM",
          documentPath: "tasks/TASK-001.md",
          documentSyncStatus: "PENDING",
        },
      }),
      (error: unknown) => {
        assert.equal(isUniqueConstraintError(error), true);
        return true;
      },
    );
  });
});

describe("enregistrement d'une tache", () => {
  it("part du statut DRAFT et de la priorite demandee", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId, { priority: "CRITICAL" }));

    assert.equal(task?.status, "DRAFT");
    assert.equal(task?.priority, "CRITICAL");
    assert.equal(task?.documentSyncStatus, "PENDING");
    assert.equal(task?.documentRevision, null);
    assert.equal(task?.documentSyncError, null);
  });

  it("conserve l'ordre de saisie des trois listes", async () => {
    const projectId = await newProject();
    const task = await createTask(
      db,
      specification(projectId, {
        acceptanceCriteria: ["Zeta", "Alpha", "Mu"],
        documentReferences: ["docs/Z.md", "CLAUDE.md", "docs/A.md"],
        validationCommands: ["npm run build", "npm run test", "npm run lint"],
      }),
    );
    assert.ok(task !== null);

    const reloaded = await getTaskById(db, task.id);

    // Relu depuis la base, et non depuis l'objet retourne a la creation : c'est
    // l'ordre stocke qui doit tenir.
    assert.deepEqual([...(reloaded?.acceptanceCriteria ?? [])], ["Zeta", "Alpha", "Mu"]);
    assert.deepEqual(
      [...(reloaded?.documentReferences ?? [])],
      ["docs/Z.md", "CLAUDE.md", "docs/A.md"],
    );
    assert.deepEqual(
      [...(reloaded?.validationCommands ?? [])],
      ["npm run build", "npm run test", "npm run lint"],
    );
  });

  it("accepte un contexte et un hors perimetre absents", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));

    assert.equal(task?.context, null);
    assert.equal(task?.outOfScope, null);
  });

  it("retourne null pour une tache inconnue", async () => {
    assert.equal(await getTaskById(db, "tache-inexistante"), null);
  });

  it("ordonne le backlog : en cours d'abord, puis urgence, puis numero", async () => {
    const projectId = await newProject();

    const low = await createTask(db, specification(projectId, { priority: "LOW" }));
    const critical = await createTask(db, specification(projectId, { priority: "CRITICAL" }));
    const mediumFirst = await createTask(db, specification(projectId, { priority: "MEDIUM" }));
    const mediumSecond = await createTask(db, specification(projectId, { priority: "MEDIUM" }));
    const doneCritical = await createTask(db, specification(projectId, { priority: "CRITICAL" }));

    assert.ok(doneCritical !== null);
    await updateTaskStatus(db, doneCritical.id, projectId, "READY");
    await updateTaskStatus(db, doneCritical.id, projectId, "COMPLETED");

    const backlog = await listTasksByProject(db, projectId);

    assert.deepEqual(
      backlog.map((task) => task.id),
      [critical?.id, mediumFirst?.id, mediumSecond?.id, low?.id, doneCritical.id],
    );
  });
});

describe("transitions de statut", () => {
  it("applique une transition autorisee", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);

    const result = await updateTaskStatus(db, task.id, projectId, "READY");

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.task.status : null, "READY");
    assert.equal((await getTaskById(db, task.id))?.status, "READY");
  });

  it("refuse une transition interdite sans rien modifier", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);

    const result = await updateTaskStatus(db, task.id, projectId, "COMPLETED");

    assert.deepEqual(result, { ok: false, reason: "forbidden_transition" });
    assert.equal((await getTaskById(db, task.id))?.status, "DRAFT");
  });

  it("refuse un statut reserve aux executions", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);

    for (const reserved of ["RUNNING", "FAILED", "REVIEW"] as const) {
      const result = await updateTaskStatus(db, task.id, projectId, reserved);
      assert.deepEqual(result, { ok: false, reason: "forbidden_transition" });
    }

    assert.equal((await getTaskById(db, task.id))?.status, "DRAFT");
  });

  it("traite une tache d'un autre projet comme inexistante", async () => {
    const owner = await newProject();
    const stranger = await newProject();
    const task = await createTask(db, specification(owner));
    assert.ok(task !== null);

    const result = await updateTaskStatus(db, task.id, stranger, "READY");

    // Meme reponse qu'un identifiant inconnu : l'appelant ne doit pas pouvoir
    // constater que la tache existe ailleurs.
    assert.deepEqual(result, { ok: false, reason: "not_found" });
    assert.equal((await getTaskById(db, task.id))?.status, "DRAFT");
  });

  it("traite un identifiant inconnu comme introuvable", async () => {
    const projectId = await newProject();
    const result = await updateTaskStatus(db, "tache-inexistante", projectId, "READY");

    assert.deepEqual(result, { ok: false, reason: "not_found" });
  });

  it("parcourt un cycle complet de transitions autorisees", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);

    for (const step of ["BLOCKED", "READY", "COMPLETED", "READY", "DRAFT"] as const) {
      const result = await updateTaskStatus(db, task.id, projectId, step);
      assert.equal(result.ok, true, `transition vers ${step} refusee`);
    }

    assert.equal((await getTaskById(db, task.id))?.status, "DRAFT");
  });
});

describe("etat de synchronisation du document", () => {
  const REVISION = "a".repeat(64);

  it("enregistre une synchronisation reussie", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);

    const synced = await markTaskDocumentSynced(db, task.id, task.documentPath, REVISION);

    assert.equal(synced.documentSyncStatus, "SYNCED");
    assert.equal(synced.documentRevision, REVISION);
    assert.equal(synced.documentSyncError, null);
  });

  it("conserve la tache lorsqu'une erreur est enregistree", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId, { title: "Survivante" }));
    assert.ok(task !== null);

    const failed = await markTaskDocumentError(db, task.id, "Le runner ne repond pas.");

    assert.equal(failed.documentSyncStatus, "ERROR");
    assert.equal(failed.documentSyncError, "Le runner ne repond pas.");
    assert.equal(failed.documentRevision, null);
    // La specification est intacte : c'est tout l'interet de dissocier les deux
    // etapes.
    assert.equal(failed.title, "Survivante");
    assert.deepEqual([...failed.acceptanceCriteria], ["Premier critere."]);
  });

  it("enregistre un conflit puis l'efface apres une reprise reussie", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);

    const conflicted = await markTaskDocumentConflict(db, task.id, "Emplacement occupe.");
    assert.equal(conflicted.documentSyncStatus, "CONFLICT");
    assert.equal(conflicted.documentSyncError, "Emplacement occupe.");

    const recovered = await markTaskDocumentSynced(db, task.id, task.documentPath, REVISION);
    assert.equal(recovered.documentSyncStatus, "SYNCED");
    assert.equal(recovered.documentSyncError, null);
  });
});

describe("validation des lignes lues en base", () => {
  /** Modifie une colonne hors de Prisma, comme le ferait une edition manuelle. */
  function corrupt(taskId: string, column: string, value: string): void {
    const sqlite = new DatabaseSync(databaseFile);
    try {
      sqlite.prepare(`UPDATE "Task" SET "${column}" = ? WHERE "id" = ?`).run(value, taskId);
    } finally {
      sqlite.close();
    }
  }

  it("refuse un statut inconnu", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);

    corrupt(task.id, "status", "ARCHIVED");

    await assert.rejects(getTaskById(db, task.id), InvalidTaskRecordError);
  });

  it("refuse une priorite inconnue", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);

    corrupt(task.id, "priority", "URGENT");

    await assert.rejects(listTasksByProject(db, projectId), InvalidTaskRecordError);
  });

  it("refuse un etat de synchronisation inconnu", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);

    corrupt(task.id, "documentSyncStatus", "STALE");

    await assert.rejects(getTaskById(db, task.id), InvalidTaskRecordError);
  });

  it("refuse un numero de tache impossible", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);

    // `0` n'est plus impossible depuis TASK-023 : il est reserve a l'amorcage.
    // Un negatif, lui, ne peut venir d'aucun chemin de code.
    corrupt(task.id, "sequence", "-1");

    await assert.rejects(getTaskById(db, task.id), InvalidTaskRecordError);
  });

  it("accepte le numero reserve a l'amorcage", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);

    corrupt(task.id, "sequence", "0");

    const read = await getTaskById(db, task.id);
    assert.ok(read !== null);
    assert.equal(read.code, "TASK-000");
  });

  it("refuse une nature de tache inconnue", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);

    corrupt(task.id, "kind", "EXPERIMENTAL");

    await assert.rejects(getTaskById(db, task.id), InvalidTaskRecordError);
  });
});

describe("deleteTaskWithoutRuns", () => {
  /** Cree une execution minimale, suffisante pour bloquer une suppression. */
  async function addRun(projectId: string, taskId: string): Promise<void> {
    const created = await createRun(db, {
      projectId,
      taskId,
      prompt: "# Prompt\n",
      promptSha256: "c".repeat(64),
      runnerRunId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });
    assert.ok(created.ok);
  }

  it("supprime une tache sans execution", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);

    const result = await deleteTaskWithoutRuns(db, projectId, task.id);

    assert.deepEqual(result, { ok: true });
    assert.equal(await getTaskById(db, task.id), null);
  });

  it("supprime ses criteres, ses references et ses commandes", async () => {
    const projectId = await newProject();
    const task = await createTask(
      db,
      specification(projectId, {
        acceptanceCriteria: ["Premier critere.", "Second critere."],
        documentReferences: ["docs/ARCHITECTURE.md", "docs/DECISIONS.md"],
        validationCommands: ["npm run test", "npm run lint"],
      }),
    );
    assert.ok(task !== null);

    await deleteTaskWithoutRuns(db, projectId, task.id);

    // Les enfants sont comptes directement : passer par `getTaskById` ne
    // prouverait rien, la tache ayant disparu.
    assert.equal(await db.taskAcceptanceCriterion.count({ where: { taskId: task.id } }), 0);
    assert.equal(await db.taskDocumentReference.count({ where: { taskId: task.id } }), 0);
    assert.equal(await db.taskValidationCommand.count({ where: { taskId: task.id } }), 0);
  });

  it("refuse une tache possedant une execution", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);
    await addRun(projectId, task.id);

    const result = await deleteTaskWithoutRuns(db, projectId, task.id);

    assert.deepEqual(result, { ok: false, reason: "has_runs" });
    assert.notEqual(await getTaskById(db, task.id), null);
    assert.equal(await db.run.count({ where: { taskId: task.id } }), 1);
  });

  it("refuse une tache d'un autre projet", async () => {
    const projectId = await newProject();
    const otherProjectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);

    // Meme reponse qu'une tache inexistante : un identifiant devine ne doit pas
    // reveler son existence ailleurs.
    const result = await deleteTaskWithoutRuns(db, otherProjectId, task.id);

    assert.deepEqual(result, { ok: false, reason: "not_found" });
    assert.notEqual(await getTaskById(db, task.id), null);
  });

  it("refuse une tache inexistante", async () => {
    const projectId = await newProject();
    const result = await deleteTaskWithoutRuns(db, projectId, "identifiant-inexistant");

    assert.deepEqual(result, { ok: false, reason: "not_found" });
  });

  it("ne touche pas aux autres taches du projet", async () => {
    const projectId = await newProject();
    const first = await createTask(db, specification(projectId, { title: "Premiere" }));
    const second = await createTask(db, specification(projectId, { title: "Seconde" }));
    assert.ok(first !== null && second !== null);

    await deleteTaskWithoutRuns(db, projectId, first.id);

    assert.equal(await getTaskById(db, first.id), null);
    assert.notEqual(await getTaskById(db, second.id), null);
    assert.equal((await listTasksByProject(db, projectId)).length, 1);
  });

  it("laisse le compteur de numerotation inchange", async () => {
    const projectId = await newProject();
    const first = await createTask(db, specification(projectId, { title: "Premiere" }));
    const second = await createTask(db, specification(projectId, { title: "Seconde" }));
    const third = await createTask(db, specification(projectId, { title: "Troisieme" }));
    assert.ok(first !== null && second !== null && third !== null);
    assert.deepEqual([first.code, second.code, third.code], [
      "TASK-001",
      "TASK-002",
      "TASK-003",
    ]);

    const before = await db.project.findUnique({
      where: { id: projectId },
      select: { nextTaskSequence: true },
    });

    await deleteTaskWithoutRuns(db, projectId, first.id);

    const after = await db.project.findUnique({
      where: { id: projectId },
      select: { nextTaskSequence: true },
    });
    assert.equal(after?.nextTaskSequence, before?.nextTaskSequence);
  });

  it("ne reattribue jamais un numero supprime", async () => {
    const projectId = await newProject();
    const first = await createTask(db, specification(projectId, { title: "Premiere" }));
    const second = await createTask(db, specification(projectId, { title: "Seconde" }));
    const third = await createTask(db, specification(projectId, { title: "Troisieme" }));
    assert.ok(first !== null && second !== null && third !== null);

    await deleteTaskWithoutRuns(db, projectId, first.id);

    // Le scenario exact de TASK-009 : TASK-001 supprimee, la suivante est
    // TASK-004. Un trou est prefere a un identifiant qui designerait deux
    // travaux differents dans Git et dans les logs.
    const next = await createTask(db, specification(projectId, { title: "Quatrieme" }));
    assert.equal(next?.code, "TASK-004");
    assert.equal(next?.documentPath, "tasks/TASK-004.md");
  });

  it("met a jour les statistiques du projet", async () => {
    const projectId = await newProject();
    const first = await createTask(db, specification(projectId, { title: "Premiere" }));
    const second = await createTask(db, specification(projectId, { title: "Seconde" }));
    assert.ok(first !== null && second !== null);
    assert.equal((await listTasksByProject(db, projectId)).length, 2);

    await deleteTaskWithoutRuns(db, projectId, first.id);

    const remaining = await listTasksByProject(db, projectId);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.code, "TASK-002");
  });

  it("empeche par contrainte la perte accidentelle d'executions", async () => {
    const projectId = await newProject();
    const task = await createTask(db, specification(projectId));
    assert.ok(task !== null);
    await addRun(projectId, task.id);

    // Contournement volontaire de la regle metier : la relation `Restrict`
    // doit tenir meme si quelqu'un appelle Prisma directement.
    await assert.rejects(db.task.delete({ where: { id: task.id } }));

    assert.notEqual(await getTaskById(db, task.id), null);
    assert.equal(await db.run.count({ where: { taskId: task.id } }), 1);
  });

  it("annule tout si la transaction echoue", async () => {
    const projectId = await newProject();
    const task = await createTask(
      db,
      specification(projectId, {
        acceptanceCriteria: ["Un critere."],
        validationCommands: ["npm run test"],
      }),
    );
    assert.ok(task !== null);

    // Une execution creee apres la lecture de l'appelant : la verification
    // refaite dans la transaction la voit, et rien n'est supprime.
    await addRun(projectId, task.id);
    const result = await deleteTaskWithoutRuns(db, projectId, task.id);

    assert.deepEqual(result, { ok: false, reason: "has_runs" });
    const survivor = await getTaskById(db, task.id);
    assert.notEqual(survivor, null);
    assert.deepEqual(survivor?.acceptanceCriteria, ["Un critere."]);
    assert.deepEqual(survivor?.validationCommands, ["npm run test"]);
  });
});
