/**
 * La migration de TASK-023 sur une base qui contient deja des donnees.
 *
 * ## Pourquoi ce test existe
 *
 * Parce que « la migration passe sur ma base locale » ne prouve rien quand cette
 * base est recente. Ce qui doit etre prouve est autre chose : une base
 * construite au schema **d'avant** TASK-023 — projet, brief, plan, memoire,
 * taches ordinaires, planification de backlog, proposition, provenance,
 * conversation Architecte et proposition de mise a jour — traverse la migration
 * sans qu'une seule ligne bouge.
 *
 * ## Et ce qu'elle apporte
 *
 * Une colonne, avec une valeur par defaut. Chaque tache existante devient
 * `NORMAL`, ce qu'elle a toujours ete ; aucune ne devient `BOOTSTRAP` par
 * accident. Et le numero zero reste libre, donc disponible pour l'amorcage.
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
 * Migration introduite par TASK-023.
 *
 * La nommer plutot que de prendre « la derniere » garde au test son sens le
 * jour ou une TASK-024 en ajoutera une autre.
 */
const TASK_023 = "20260818090000_add_task_kind";

let workspace: string;
let directories: string[];
let index: number;

async function migrationSql(name: string): Promise<string> {
  return readFile(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-bootstrap-migration-"));
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  index = directories.indexOf(TASK_023);
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const NOW = "2026-08-01T10:00:00.000Z";

/** Un projet complet au schema d'avant TASK-023, backlog applique compris. */
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

  INSERT INTO "Task" ("id","projectId","sequence","title","priority","objective","context","outOfScope","status","documentPath","documentSyncStatus","createdAt","updatedAt","backlogProposalId","backlogItemPosition")
  VALUES ('task-1','proj-1',1,'Filtrer les livres','MEDIUM','Retrouver un livre','La liste est brute',NULL,'COMPLETED','tasks/TASK-001.md','SYNCED','${NOW}','${NOW}','bp-1',0),
         ('task-2','proj-1',2,'Trier les livres','LOW','Ordonner la liste',NULL,NULL,'READY','tasks/TASK-002.md','SYNCED','${NOW}','${NOW}','bp-1',1);

  INSERT INTO "TaskAcceptanceCriterion" ("id","taskId","position","text")
  VALUES ('crit-1','task-1',0,'Un filtre par auteur existe');
`;

const TABLES = [
  "Project",
  "Task",
  "TaskAcceptanceCriterion",
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

describe("migration de TASK-023 sur une base historique", () => {
  it("laisse toutes les donnees anterieures intactes", async () => {
    assert.ok(index >= 0, "la migration de TASK-023 existe");

    const file = path.join(workspace, "historique.db");
    const db = new DatabaseSync(file);

    try {
      // --- Schema d'avant TASK-023 ----------------------------------------
      for (const directory of directories.slice(0, index)) {
        db.exec(await migrationSql(directory));
      }

      db.exec(HISTORIC_DATA);

      const snapshot = (table: string): unknown[] =>
        db.prepare(`SELECT * FROM "${table}" ORDER BY "id"`).all();

      const before = Object.fromEntries(TABLES.map((table) => [table, snapshot(table)]));

      // --- La migration de TASK-023 ---------------------------------------
      db.exec(await migrationSql(TASK_023));

      const after = Object.fromEntries(TABLES.map((table) => [table, snapshot(table)]));

      // Seule `Task` gagne une colonne : toutes les autres tables se comparent
      // telles quelles, et doivent etre identiques au bit pres.
      const { Task: tasksAfter, ...restAfter } = after;
      const { Task: tasksBefore, ...restBefore } = before;

      assert.deepEqual(restAfter, restBefore, "aucune ligne anterieure n'a change");

      const tasks = tasksAfter as Record<string, unknown>[];
      const tasksOld = tasksBefore as Record<string, unknown>[];
      assert.equal(tasks.length, tasksOld.length);
      for (const [position, old] of tasksOld.entries()) {
        for (const [column, value] of Object.entries(old)) {
          assert.deepEqual(tasks[position]?.[column], value, `Task.${column} inchangee`);
        }
      }
    } finally {
      db.close();
    }
  });

  it("donne a chaque tache existante la nature NORMAL", async () => {
    const file = path.join(workspace, "nature.db");
    const db = new DatabaseSync(file);

    try {
      for (const directory of directories.slice(0, index)) {
        db.exec(await migrationSql(directory));
      }
      db.exec(HISTORIC_DATA);
      db.exec(await migrationSql(TASK_023));

      const rows = db.prepare(`SELECT "id","sequence","kind" FROM "Task" ORDER BY "sequence"`).all() as {
        id: string;
        sequence: number;
        kind: string;
      }[];

      assert.equal(rows.length, 2);
      for (const row of rows) {
        assert.equal(row.kind, "NORMAL", `${row.id} reste une tache ordinaire`);
        assert.notEqual(row.sequence, 0, "aucune tache historique ne porte le numero reserve");
      }
    } finally {
      db.close();
    }
  });

  it("laisse le numero zero libre, et une seule fois par projet", async () => {
    const file = path.join(workspace, "unicite.db");
    const db = new DatabaseSync(file);

    try {
      for (const directory of directories) {
        db.exec(await migrationSql(directory));
      }
      db.exec(HISTORIC_DATA);

      // Le numero reserve est disponible sur un projet qui existait deja.
      db.exec(`
        INSERT INTO "Task" ("id","projectId","sequence","kind","title","priority","objective","context","outOfScope","status","documentPath","documentSyncStatus","createdAt","updatedAt")
        VALUES ('task-0','proj-1',0,'BOOTSTRAP','Bootstrap project repository and foundational documentation','HIGH','Etablir une fondation minimale.',NULL,NULL,'DRAFT','tasks/TASK-000.md','PENDING','${NOW}','${NOW}');
      `);

      const bootstrap = db.prepare(`SELECT * FROM "Task" WHERE "sequence" = 0`).get() as {
        kind: string;
        backlogProposalId: string | null;
      };
      assert.equal(bootstrap.kind, "BOOTSTRAP");
      assert.equal(bootstrap.backlogProposalId, null, "l'amorcage ne vient d'aucun backlog");

      // Et la contrainte d'unicite refuse la seconde, sans verrou applicatif.
      assert.throws(() => {
        db.exec(`
          INSERT INTO "Task" ("id","projectId","sequence","kind","title","priority","objective","context","outOfScope","status","documentPath","documentSyncStatus","createdAt","updatedAt")
          VALUES ('task-0-bis','proj-1',0,'BOOTSTRAP','Doublon','HIGH','Ne doit pas exister.',NULL,NULL,'DRAFT','tasks/TASK-000.md','PENDING','${NOW}','${NOW}');
        `);
      }, /UNIQUE/i);

      const total = db.prepare(`SELECT COUNT(*) AS total FROM "Task" WHERE "sequence" = 0`).get() as {
        total: number;
      };
      assert.equal(total.total, 1);
    } finally {
      db.close();
    }
  });
});
