/**
 * La migration de TASK-022 sur une base qui contient deja des donnees.
 *
 * ## Pourquoi ce test existe
 *
 * Parce que « la migration passe sur ma base locale » ne prouve rien quand cette
 * base est recente ou vide. Ce qui doit etre prouve est autre chose : une base
 * construite au schema **d'avant** TASK-022 — avec un projet, un brief, un plan
 * de V1, de la memoire, des taches, une conversation Architecte, ses tours, ses
 * messages et une proposition de mise a jour — traverse la migration sans
 * qu'une seule ligne bouge.
 *
 * Le test applique donc toutes les migrations **anterieures** a TASK-022, ecrit
 * des donnees representatives, puis applique celle de TASK-022 et compare ligne
 * a ligne — identifiants compris.
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
 * Migration introduite par TASK-022.
 *
 * La nommer plutot que de prendre « la derniere » garde au test son sens le
 * jour ou une TASK-023 en ajoutera une autre.
 */
const TASK_022 = "20260815120000_add_backlog_planning";

let workspace: string;
let directories: string[];
let index: number;

async function migrationSql(name: string): Promise<string> {
  return readFile(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-backlog-migration-"));
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  index = directories.indexOf(TASK_022);
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const NOW = "2026-08-01T10:00:00.000Z";

/** Un projet complet au schema d'avant TASK-022. */
const HISTORIC_DATA = `
  INSERT INTO "Project" ("id","name","description","repositoryPath","status","createdAt","updatedAt","nextTaskSequence","nextMemorySequence","mainArchitectSessionId")
  VALUES ('proj-1','Suivi de lectures','Un projet reel','D:/depots/lectures','ACTIVE','${NOW}','${NOW}',3,2,'sess-1');

  INSERT INTO "Task" ("id","projectId","sequence","title","priority","objective","context","outOfScope","status","documentPath","documentSyncStatus","createdAt","updatedAt")
  VALUES ('task-1','proj-1',1,'Filtrer les livres','MEDIUM','Retrouver un livre','La liste est brute',NULL,'COMPLETED','tasks/TASK-001.md','SYNCED','${NOW}','${NOW}'),
         ('task-2','proj-1',2,'Trier les livres','LOW','Ordonner la liste',NULL,NULL,'READY','tasks/TASK-002.md','SYNCED','${NOW}','${NOW}');

  INSERT INTO "TaskAcceptanceCriterion" ("id","taskId","position","text")
  VALUES ('crit-1','task-1',0,'Un filtre par auteur existe');

  INSERT INTO "ArchitectSession" ("id","projectId","sequence","requestText","clarificationText","conversationVersion","kind","status","nextGenerationSequence","createdAt","updatedAt")
  VALUES ('sess-1','proj-1',1,'',NULL,2,'PROJECT','OPEN',3,'${NOW}','${NOW}');

  INSERT INTO "ArchitectGeneration" ("id","sessionId","sequence","model","promptVersion","inputHash","contextManifestJson","status","turnState","createdAt")
  VALUES ('gen-1','sess-1',1,'gpt-5-mini','architect/4','abc','{"schemaVersion":1,"sources":[],"totalChars":0,"missing":[]}','CONTINUE','CONTINUE','${NOW}'),
         ('gen-2','sess-1',2,'gpt-5-mini','architect/4','def','{"schemaVersion":1,"sources":[],"totalChars":0,"missing":[]}','PROPOSAL_READY','PROPOSAL_READY','${NOW}');

  INSERT INTO "ArchitectMessage" ("id","sessionId","generationId","sequence","role","content","createdAt")
  VALUES ('msg-1','sess-1','gen-1',1,'USER','Par quoi commencer ?','${NOW}'),
         ('msg-2','sess-1','gen-1',2,'ARCHITECT','Par le plus petit increment.','${NOW}');

  INSERT INTO "ProjectMemoryEntry" ("id","projectId","sequence","category","title","content","rationale","status","createdAt","updatedAt")
  VALUES ('mem-1','proj-1',1,'DECISION','SQLite','La base reste locale.','Aucun serveur.','ACTIVE','${NOW}','${NOW}');

  INSERT INTO "ProjectBrief" ("id","projectId","summary","problem","targetUsers","desiredOutcome","goalsJson","nonGoalsJson","createdAt","updatedAt")
  VALUES ('brief-1','proj-1','Un suivi de lectures.','Rien ne centralise mes lectures.','Moi seul.','Savoir ce que j''ai lu.','["Enregistrer un livre"]','["Reseau social"]','${NOW}','${NOW}');

  INSERT INTO "ProjectV1Plan" ("id","projectId","goal","technicalDirection","inScopeJson","outOfScopeJson","milestonesJson","createdAt","updatedAt")
  VALUES ('plan-1','proj-1','Suivre une annee de lectures.','Application web simple.','["Liste"]','["Mobile"]','["La liste est utilisable"]','${NOW}','${NOW}');

  INSERT INTO "ArchitectProjectUpdate" ("id","generationId","projectId","status","reason","proposedJson","appliedJson","baseBriefRevision","basePlanRevision","createdAt")
  VALUES ('upd-1','gen-2','proj-1','APPLIED','Le perimetre a change.','{"reason":"Le perimetre a change."}','{"brief":null,"plan":null}','rev-brief','rev-plan','${NOW}');
`;

describe("migration de TASK-022 sur une base historique", () => {
  it("laisse toutes les donnees anterieures intactes", async () => {
    assert.ok(index >= 0, "la migration de TASK-022 existe");

    const file = path.join(workspace, "historique.db");
    const db = new DatabaseSync(file);

    try {
      // --- Schema d'avant TASK-022 ----------------------------------------
      for (const directory of directories.slice(0, index)) {
        db.exec(await migrationSql(directory));
      }

      db.exec(HISTORIC_DATA);

      /** Photographie ordonnee d'une table. */
      const snapshot = (table: string): unknown[] =>
        db.prepare(`SELECT * FROM "${table}" ORDER BY "id"`).all();

      const tables = [
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
      ];

      const before = Object.fromEntries(tables.map((table) => [table, snapshot(table)]));

      // --- La migration de TASK-022 ---------------------------------------
      db.exec(await migrationSql(TASK_022));

      const after = Object.fromEntries(tables.map((table) => [table, snapshot(table)]));

      // `Project` gagne trois colonnes : la comparaison se fait donc sur les
      // colonnes d'avant, une a une. Toutes les autres tables sont comparees
      // telles quelles.
      const { Project: projectsAfter, ...othersAfter } = after;
      const { Project: projectsBefore, ...othersBefore } = before;

      // `Task` gagne aussi deux colonnes : meme traitement.
      const { Task: tasksAfter, ...restAfter } = othersAfter;
      const { Task: tasksBefore, ...restBefore } = othersBefore;

      assert.deepEqual(restAfter, restBefore, "aucune ligne anterieure n'a change");

      const project = (projectsAfter as Record<string, unknown>[])[0];
      const projectBefore = (projectsBefore as Record<string, unknown>[])[0];
      assert.ok(project !== undefined && projectBefore !== undefined);
      for (const [column, value] of Object.entries(projectBefore)) {
        assert.deepEqual(project[column], value, `Project.${column} inchangee`);
      }

      const tasks = tasksAfter as Record<string, unknown>[];
      const tasksOld = tasksBefore as Record<string, unknown>[];
      assert.equal(tasks.length, tasksOld.length);
      for (const [position, old] of tasksOld.entries()) {
        for (const [column, value] of Object.entries(old)) {
          assert.deepEqual(tasks[position]?.[column], value, `Task.${column} inchangee`);
        }
      }

      // --- Les nouvelles colonnes naissent neutres ------------------------
      assert.equal(project["nextBacklogSequence"], 1, "le compteur part a un");
      assert.equal(project["activeBacklogGenerationId"], null, "aucune planification en vol");
      assert.equal(project["pendingBacklogProposalId"], null, "aucune proposition en attente");

      for (const task of tasks) {
        assert.equal(task["backlogProposalId"], null, "aucune tache n'est attribuee a un backlog");
        assert.equal(task["backlogItemPosition"], null);
      }

      // --- Les nouvelles tables naissent vides ----------------------------
      const count = (table: string): number => {
        const row = db.prepare(`SELECT COUNT(*) AS total FROM "${table}"`).get() as {
          total: number;
        };
        return row.total;
      };

      assert.equal(count("ArchitectBacklogGeneration"), 0, "aucune planification n'est inventee");
      assert.equal(count("ArchitectBacklogProposal"), 0, "aucun backlog n'est invente");
    } finally {
      db.close();
    }
  });

  it("accueille une planification et un backlog sur le projet existant", async () => {
    // La migration ne se contente pas de ne rien casser : les nouvelles tables
    // doivent reellement accepter des lignes rattachees aux projets d'avant.
    const file = path.join(workspace, "ecriture.db");
    const db = new DatabaseSync(file);

    try {
      for (const directory of directories) {
        db.exec(await migrationSql(directory));
      }

      db.exec(HISTORIC_DATA);
      db.exec(`
        INSERT INTO "ArchitectBacklogGeneration" ("id","projectId","sequence","status","model","promptVersion","inputHash","contextManifestJson","planningFingerprint","baseTaskInventoryRevision","baseMemoryRevision","createdAt")
        VALUES ('bg-1','proj-1',1,'READY','gpt-5-mini','backlog/1','hash','{"schemaVersion":1,"sources":[],"totalChars":0,"missing":[],"taskInventoryRevision":"inv"}','fp','inv','mem','${NOW}');

        INSERT INTO "ArchitectBacklogProposal" ("id","generationId","projectId","status","message","taskCount","providerJson","createdAt")
        VALUES ('bp-1','bg-1','proj-1','APPLIED','Trois increments.',3,'{"schemaVersion":1,"message":"Trois increments.","tasks":[]}','${NOW}');

        UPDATE "Task" SET "backlogProposalId" = 'bp-1', "backlogItemPosition" = 0 WHERE "id" = 'task-2';
      `);

      const proposal = db.prepare(`SELECT * FROM "ArchitectBacklogProposal"`).get() as {
        projectId: string;
        taskCount: number;
      };
      assert.equal(proposal.projectId, "proj-1");
      assert.equal(proposal.taskCount, 3);

      const task = db.prepare(`SELECT * FROM "Task" WHERE "id" = 'task-2'`).get() as {
        backlogProposalId: string | null;
        backlogItemPosition: number | null;
      };
      assert.equal(task.backlogProposalId, "bp-1", "la provenance se retrouve depuis la tache");
      assert.equal(task.backlogItemPosition, 0);

      // Un projet supprime emporte ses planifications : pas d'orphelin.
      db.exec(`PRAGMA foreign_keys = ON;`);
      db.exec(`UPDATE "Task" SET "backlogProposalId" = NULL WHERE "id" = 'task-2';`);
      db.exec(`DELETE FROM "Project" WHERE "id" = 'proj-1';`);

      const remaining = db
        .prepare(`SELECT COUNT(*) AS total FROM "ArchitectBacklogGeneration"`)
        .get() as { total: number };
      assert.equal(remaining.total, 0, "la planification disparait avec son projet");
    } finally {
      db.close();
    }
  });

  it("empeche deux projets de partager une proposition en attente", async () => {
    // L'unicite est structurelle : deux projets ne peuvent pas pointer la meme
    // proposition, et un projet n'en pointe qu'une.
    const file = path.join(workspace, "unicite.db");
    const db = new DatabaseSync(file);

    try {
      for (const directory of directories) {
        db.exec(await migrationSql(directory));
      }

      db.exec(`
        INSERT INTO "Project" ("id","name","description","repositoryPath","status","createdAt","updatedAt","nextTaskSequence","nextMemorySequence","mainArchitectSessionId","nextBacklogSequence","activeBacklogGenerationId","pendingBacklogProposalId")
        VALUES ('p-1','A',NULL,'D:/a','ACTIVE','${NOW}','${NOW}',1,1,NULL,1,NULL,'shared'),
               ('p-2','B',NULL,'D:/b','ACTIVE','${NOW}','${NOW}',1,1,NULL,1,NULL,NULL);
      `);

      assert.throws(() => {
        db.exec(`UPDATE "Project" SET "pendingBacklogProposalId" = 'shared' WHERE "id" = 'p-2';`);
      }, "l'index unique refuse deux pointeurs identiques");

      // Deux `null` restent permis : c'est l'etat normal de tous les projets.
      db.exec(`UPDATE "Project" SET "pendingBacklogProposalId" = NULL WHERE "id" = 'p-1';`);
      const rows = db
        .prepare(`SELECT COUNT(*) AS total FROM "Project" WHERE "pendingBacklogProposalId" IS NULL`)
        .get() as { total: number };
      assert.equal(rows.total, 2);
    } finally {
      db.close();
    }
  });
});
