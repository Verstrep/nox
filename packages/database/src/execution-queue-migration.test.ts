/**
 * La migration de TASK-026 sur une base qui contient deja des donnees.
 *
 * ## Pourquoi ce test existe
 *
 * Pour la meme raison qu'en TASK-023 et TASK-024 : « la migration passe sur ma
 * base locale » ne prouve rien quand cette base est recente. Ce qui doit etre
 * prouve est qu'une base construite au schema **d'avant** TASK-026 — projet,
 * brief, plan, memoire, conversation Architecte, proposition de mise a jour,
 * planification de backlog, amorcage, taches avec leur provenance, dependances,
 * execution — la traverse sans qu'une seule ligne bouge.
 *
 * ## Ce que la migration apporte
 *
 * Deux colonnes avec une valeur par defaut, et une table. Un projet existant en
 * ressort avec une file **vide** et **en pause** : rien ne peut donc partir du
 * seul fait d'avoir migre.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma",
  "migrations",
);

/**
 * Migration introduite par TASK-026.
 *
 * La nommer plutot que de prendre « la derniere » garde au test son sens le jour
 * ou une TASK-027 en ajoutera une autre.
 */
const TASK_026 = "20260823090000_add_execution_queue";

/**
 * Correctif de TASK-026 : la barriere doit survivre a un `Reopen`.
 *
 * Une seconde migration plutot qu'une reecriture de la premiere : celle-ci
 * est deja appliquee sur les bases existantes, et son empreinte enregistree
 * ne doit pas changer.
 */
const TASK_026_FIX = "20260823140000_add_queue_entry_started_at";

let workspace: string;
let directories: string[];
let index: number;

async function migrationSql(name: string): Promise<string> {
  return readFile(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-queue-migration-"));
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  index = directories.indexOf(TASK_026);
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const NOW = "2026-08-01T10:00:00.000Z";

/** Un projet complet au schema d'avant TASK-026, dependances comprises. */
const HISTORIC_DATA = `
  INSERT INTO "Project" ("id","name","description","repositoryPath","status","createdAt","updatedAt","nextTaskSequence","nextMemorySequence","mainArchitectSessionId","nextBacklogSequence","activeBacklogGenerationId","pendingBacklogProposalId")
  VALUES ('proj-1','Suivi de lectures','Un projet reel','D:/depots/lectures','ACTIVE','${NOW}','${NOW}',3,2,'sess-1',2,NULL,NULL);

  INSERT INTO "ArchitectSession" ("id","projectId","sequence","requestText","clarificationText","conversationVersion","kind","status","nextGenerationSequence","createdAt","updatedAt")
  VALUES ('sess-1','proj-1',1,'',NULL,2,'PROJECT','OPEN',3,'${NOW}','${NOW}');

  INSERT INTO "ArchitectGeneration" ("id","sessionId","sequence","model","promptVersion","inputHash","contextManifestJson","status","turnState","createdAt")
  VALUES ('gen-1','sess-1',1,'gpt-5-mini','architect/4','abc','{"schemaVersion":1,"sources":[],"totalChars":0,"missing":[]}','CONTINUE','CONTINUE','${NOW}');

  INSERT INTO "ArchitectMessage" ("id","sessionId","generationId","sequence","role","content","createdAt")
  VALUES ('msg-1','sess-1','gen-1',1,'USER','Par quoi commencer ?','${NOW}');

  INSERT INTO "ProjectMemoryEntry" ("id","projectId","sequence","category","title","content","rationale","status","createdAt","updatedAt")
  VALUES ('mem-1','proj-1',1,'DECISION','SQLite','La base reste locale.','Aucun serveur.','ACTIVE','${NOW}','${NOW}');

  INSERT INTO "ProjectBrief" ("id","projectId","summary","problem","targetUsers","desiredOutcome","goalsJson","nonGoalsJson","createdAt","updatedAt")
  VALUES ('brief-1','proj-1','Un suivi de lectures.','Rien ne centralise mes lectures.','Moi seul.','Savoir ce que j''ai lu.','["Enregistrer un livre"]','["Reseau social"]','${NOW}','${NOW}');

  INSERT INTO "ProjectV1Plan" ("id","projectId","goal","technicalDirection","inScopeJson","outOfScopeJson","milestonesJson","createdAt","updatedAt")
  VALUES ('plan-1','proj-1','Suivre une annee de lectures.','Application web simple.','["Liste"]','["Mobile"]','["La liste est utilisable"]','${NOW}','${NOW}');

  INSERT INTO "ArchitectProjectUpdate" ("id","generationId","projectId","status","reason","proposedJson","appliedJson","baseBriefRevision","basePlanRevision","createdAt")
  VALUES ('upd-1','gen-1','proj-1','APPLIED','Le perimetre a change.','{"reason":"Le perimetre a change."}','{"brief":null,"plan":null}','rev-brief','rev-plan','${NOW}');

  INSERT INTO "ArchitectBacklogGeneration" ("id","projectId","sequence","status","model","promptVersion","inputHash","contextManifestJson","planningFingerprint","baseTaskInventoryRevision","baseMemoryRevision","createdAt")
  VALUES ('bg-1','proj-1',1,'READY','gpt-5-mini','backlog/1','hash','{"schemaVersion":1,"sources":[],"totalChars":0,"missing":[],"taskInventoryRevision":"inv"}','fp','inv','mem','${NOW}');

  INSERT INTO "ArchitectBacklogProposal" ("id","generationId","projectId","status","message","taskCount","providerJson","createdAt")
  VALUES ('bp-1','bg-1','proj-1','APPLIED','Deux increments.',2,'{"schemaVersion":1,"message":"Deux increments.","tasks":[]}','${NOW}');

  INSERT INTO "Task" ("id","projectId","sequence","kind","title","priority","objective","context","outOfScope","status","documentPath","documentSyncStatus","createdAt","updatedAt","backlogProposalId","backlogItemPosition")
  VALUES ('task-0','proj-1',0,'BOOTSTRAP','Bootstrap project repository','HIGH','Etablir la fondation.',NULL,NULL,'COMPLETED','tasks/TASK-000.md','SYNCED','${NOW}','${NOW}',NULL,NULL),
         ('task-1','proj-1',1,'NORMAL','Filtrer les livres','MEDIUM','Retrouver un livre','La liste est brute',NULL,'COMPLETED','tasks/TASK-001.md','SYNCED','${NOW}','${NOW}','bp-1',0),
         ('task-2','proj-1',2,'NORMAL','Trier les livres','LOW','Ordonner la liste',NULL,NULL,'READY','tasks/TASK-002.md','SYNCED','${NOW}','${NOW}','bp-1',1);

  INSERT INTO "TaskDependency" ("id","taskId","dependsOnTaskId","createdAt")
  VALUES ('dep-1','task-2','task-1','${NOW}');

  INSERT INTO "TaskAcceptanceCriterion" ("id","taskId","position","text")
  VALUES ('crit-1','task-1',0,'Un filtre par auteur existe');

  INSERT INTO "Run" ("id","taskId","sequence","status","prompt","promptSha256","runnerRunId","createdAt","updatedAt")
  VALUES ('run-1','task-1',1,'COMPLETED','Prompt.','${"a".repeat(64)}','11111111-1111-4111-8111-111111111111','${NOW}','${NOW}');
`;

/** Toutes les tables **anterieures** : `Project` a part, ses colonnes changent. */
const TABLES = [
  "Task",
  "TaskDependency",
  "TaskAcceptanceCriterion",
  "Run",
  "ArchitectSession",
  "ArchitectGeneration",
  "ArchitectMessage",
  "ProjectMemoryEntry",
  "ProjectBrief",
  "ProjectV1Plan",
  "ArchitectProjectUpdate",
  "ArchitectBacklogGeneration",
  "ArchitectBacklogProposal",
];

/** Colonnes de `Project` qui existaient avant TASK-026. */
const PROJECT_COLUMNS = [
  "id",
  "name",
  "description",
  "repositoryPath",
  "status",
  "createdAt",
  "updatedAt",
  "nextTaskSequence",
  "nextMemorySequence",
  "mainArchitectSessionId",
  "nextBacklogSequence",
  "activeBacklogGenerationId",
  "pendingBacklogProposalId",
];

async function historicDatabase(name: string, upTo: number): Promise<DatabaseSync> {
  const db = new DatabaseSync(path.join(workspace, name));
  for (const directory of directories.slice(0, upTo)) {
    db.exec(await migrationSql(directory));
  }
  db.exec(HISTORIC_DATA);
  return db;
}

describe("migration de TASK-026 sur une base historique", () => {
  it("laisse toutes les donnees anterieures intactes", async () => {
    assert.ok(index >= 0, "la migration de TASK-026 existe");

    const db = await historicDatabase("historique.db", index);
    try {
      const snapshot = (table: string): unknown[] =>
        db.prepare(`SELECT * FROM "${table}" ORDER BY "id"`).all();
      const projectSnapshot = (): unknown[] =>
        db
          .prepare(
            `SELECT ${PROJECT_COLUMNS.map((column) => `"${column}"`).join(",")} FROM "Project" ORDER BY "id"`,
          )
          .all();

      const before = {
        ...Object.fromEntries(TABLES.map((table) => [table, snapshot(table)])),
        Project: projectSnapshot(),
      };

      db.exec(await migrationSql(TASK_026));

      const after = {
        ...Object.fromEntries(TABLES.map((table) => [table, snapshot(table)])),
        Project: projectSnapshot(),
      };

      // Aucune table existante n'est reconstruite, aucune valeur n'est reecrite.
      assert.deepEqual(after, before, "aucune ligne anterieure n'a change");
    } finally {
      db.close();
    }
  });

  it("laisse la file vide et en pause", async () => {
    const db = await historicDatabase("vide.db", index);
    try {
      db.exec(await migrationSql(TASK_026));

      const entries = db.prepare(`SELECT COUNT(*) AS total FROM "TaskQueueEntry"`).get() as {
        total: number;
      };
      // Aucune tache n'est inscrite automatiquement : ni la tache prete, ni
      // l'amorcage, ni celles issues du backlog.
      assert.equal(entries.total, 0);

      const project = db
        .prepare(
          `SELECT "executionQueueActive","nextQueueSequence" FROM "Project" WHERE "id" = 'proj-1'`,
        )
        .get() as { executionQueueActive: number; nextQueueSequence: number };

      // Une file inactive : rien ne peut partir du seul fait d'avoir migre.
      assert.equal(project.executionQueueActive, 0);
      assert.equal(project.nextQueueSequence, 1);
    } finally {
      db.close();
    }
  });

  it("preserve nature, numeros, compteurs, provenance et dependances", async () => {
    const db = await historicDatabase("nature.db", index);
    try {
      db.exec(await migrationSql(TASK_026));

      const tasks = db
        .prepare(
          `SELECT "sequence","kind","backlogProposalId","backlogItemPosition" FROM "Task" ORDER BY "sequence"`,
        )
        .all() as {
        sequence: number;
        kind: string;
        backlogProposalId: string | null;
        backlogItemPosition: number | null;
      }[];

      assert.deepEqual(
        tasks.map((row) => [row.sequence, row.kind]),
        [
          [0, "BOOTSTRAP"],
          [1, "NORMAL"],
          [2, "NORMAL"],
        ],
      );
      assert.equal(tasks[1]?.backlogProposalId, "bp-1");

      const edges = db.prepare(`SELECT COUNT(*) AS total FROM "TaskDependency"`).get() as {
        total: number;
      };
      assert.equal(edges.total, 1, "la dependance existante survit");

      const project = db
        .prepare(`SELECT "nextTaskSequence" FROM "Project" WHERE "id" = 'proj-1'`)
        .get() as { nextTaskSequence: number };
      assert.equal(project.nextTaskSequence, 3, "le compteur ne recule pas");
    } finally {
      db.close();
    }
  });

  it("refuse deux inscriptions de la meme tache", async () => {
    const db = await historicDatabase("unicite.db", directories.length);
    try {
      db.exec(`
        INSERT INTO "TaskQueueEntry" ("id","projectId","taskId","sequence","createdAt")
        VALUES ('q-1','proj-1','task-2',1,'${NOW}');
      `);

      assert.throws(() => {
        db.exec(`
          INSERT INTO "TaskQueueEntry" ("id","projectId","taskId","sequence","createdAt")
          VALUES ('q-2','proj-1','task-2',2,'${NOW}');
        `);
      }, /UNIQUE/i);
    } finally {
      db.close();
    }
  });

  it("emporte les inscriptions avec la tache", async () => {
    // `Cascade` des deux cotes : une inscription ne decrit rien sans sa tache.
    const db = await historicDatabase("cascade.db", directories.length);
    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        INSERT INTO "TaskQueueEntry" ("id","projectId","taskId","sequence","createdAt")
        VALUES ('q-1','proj-1','task-2',1,'${NOW}');
        DELETE FROM "TaskDependency" WHERE "taskId" = 'task-2';
        DELETE FROM "Task" WHERE "id" = 'task-2';
      `);

      const entries = db.prepare(`SELECT COUNT(*) AS total FROM "TaskQueueEntry"`).get() as {
        total: number;
      };
      assert.equal(entries.total, 0);
    } finally {
      db.close();
    }
  });
});

describe("migration du correctif, sur une base qui a deja une file", () => {
  /** Une base au schema de TASK-026, avec une inscription et une file active. */
  async function queuedDatabase(name: string): Promise<DatabaseSync> {
    const db = await historicDatabase(name, directories.indexOf(TASK_026_FIX));
    db.exec(`
      INSERT INTO "TaskQueueEntry" ("id","projectId","taskId","sequence","createdAt")
      VALUES ('q-1','proj-1','task-2',1,'${NOW}');
      UPDATE "Project" SET "executionQueueActive" = 1, "nextQueueSequence" = 2 WHERE "id" = 'proj-1';
    `);
    return db;
  }

  it("laisse les inscriptions existantes intactes", async () => {
    const db = await queuedDatabase("fix-intact.db");
    try {
      const columns = ['"id"', '"projectId"', '"taskId"', '"sequence"', '"createdAt"'].join(",");
      const snapshot = (): unknown[] =>
        db.prepare(`SELECT ${columns} FROM "TaskQueueEntry" ORDER BY "id"`).all();

      const before = snapshot();
      db.exec(await migrationSql(TASK_026_FIX));

      assert.deepEqual(snapshot(), before, "aucune valeur anterieure n'a change");
    } finally {
      db.close();
    }
  });

  it("donne « pas encore commencee » aux inscriptions deja presentes", async () => {
    // La valeur sure : au pire, une entree dont l'execution tourne encore reste
    // barriere par son statut, qui suffit tant que la tache n'est pas `READY`.
    const db = await queuedDatabase("fix-null.db");
    try {
      db.exec(await migrationSql(TASK_026_FIX));

      const row = db
        .prepare(`SELECT "startedAt" FROM "TaskQueueEntry" WHERE "id" = 'q-1'`)
        .get() as { startedAt: string | null };
      assert.equal(row.startedAt, null);
    } finally {
      db.close();
    }
  });

  it("ne touche ni a l'autorisation, ni au compteur de positions", async () => {
    const db = await queuedDatabase("fix-project.db");
    try {
      db.exec(await migrationSql(TASK_026_FIX));

      const project = db
        .prepare(
          `SELECT "executionQueueActive","nextQueueSequence" FROM "Project" WHERE "id" = 'proj-1'`,
        )
        .get() as { executionQueueActive: number; nextQueueSequence: number };
      assert.equal(project.executionQueueActive, 1);
      assert.equal(project.nextQueueSequence, 2);
    } finally {
      db.close();
    }
  });

  it("conserve les index et les contraintes de la table", async () => {
    // Ajouter une colonne ne reconstruit pas la table : ce qui la protegeait la
    // protege encore.
    const db = await historicDatabase("fix-contraintes.db", directories.length);
    try {
      db.exec(`
        INSERT INTO "TaskQueueEntry" ("id","projectId","taskId","sequence","createdAt","startedAt")
        VALUES ('q-1','proj-1','task-2',1,'${NOW}','${NOW}');
      `);

      assert.throws(() => {
        db.exec(`
          INSERT INTO "TaskQueueEntry" ("id","projectId","taskId","sequence","createdAt")
          VALUES ('q-2','proj-1','task-2',2,'${NOW}');
        `);
      }, /UNIQUE/i);
    } finally {
      db.close();
    }
  });
});
