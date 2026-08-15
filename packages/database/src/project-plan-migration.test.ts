/**
 * La migration de TASK-021 sur une base qui contient deja des donnees.
 *
 * ## Pourquoi ce test existe
 *
 * Parce que « la migration passe sur ma base locale » ne prouve rien quand cette
 * base est recente ou vide. Ce qui doit etre prouve est autre chose : une base
 * construite au schema **d'avant** TASK-021, remplie de projets, de taches,
 * d'une conversation Architecte avec ses tours et ses messages, et d'entrees de
 * memoire, traverse la migration sans qu'une seule ligne bouge.
 *
 * Le test applique donc toutes les migrations **anterieures** a TASK-021, ecrit
 * des donnees, puis applique celles de TASK-021 et compare ligne a ligne —
 * identifiants compris.
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
 * Migrations introduites par TASK-021, dans l'ordre.
 *
 * Il y en a deux : les tables de l'etat structure, puis la colonne qui conserve
 * ce que l'utilisateur a reellement applique. Les nommer plutot que de prendre
 * « la derniere » garde au test son sens le jour ou une TASK-022 en ajoutera une
 * troisieme.
 */
const TASK_021 = [
  "20260814120000_add_project_plan",
  "20260814180000_add_project_update_applied",
];

let workspace: string;
let directories: string[];

async function migrationSql(name: string): Promise<string> {
  return readFile(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-plan-migration-"));
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("migration de TASK-021 sur une base historique", () => {
  it("laisse toutes les donnees anterieures intactes", async () => {
    // Les migrations de TASK-021 ferment bien la marche : si une autre venait
    // s'intercaler, ce test cesserait de prouver ce qu'il annonce.
    assert.deepEqual(
      directories.slice(-TASK_021.length),
      TASK_021,
      "TASK-021 ferme la liste des migrations",
    );

    const file = path.join(workspace, "historique.db");
    const db = new DatabaseSync(file);

    try {
      // --- Schema d'avant TASK-021 ---------------------------------------
      for (const directory of directories.slice(0, -TASK_021.length)) {
        db.exec(await migrationSql(directory));
      }

      // --- Des donnees representatives ------------------------------------
      const now = "2026-08-01T10:00:00.000Z";
      db.exec(`
        INSERT INTO "Project" ("id","name","description","repositoryPath","status","createdAt","updatedAt","nextTaskSequence","nextMemorySequence","mainArchitectSessionId")
        VALUES ('proj-1','Suivi de lectures','Un projet reel','D:/depots/lectures','ACTIVE','${now}','${now}',3,2,'sess-1');

        INSERT INTO "Task" ("id","projectId","sequence","title","priority","objective","context","outOfScope","status","documentPath","documentSyncStatus","createdAt","updatedAt")
        VALUES ('task-1','proj-1',1,'Filtrer les livres','MEDIUM','Retrouver un livre','La liste est brute',NULL,'COMPLETED','tasks/TASK-001.md','SYNCED','${now}','${now}'),
               ('task-2','proj-1',2,'Trier les livres','LOW','Ordonner la liste',NULL,NULL,'READY','tasks/TASK-002.md','SYNCED','${now}','${now}');

        INSERT INTO "ArchitectSession" ("id","projectId","sequence","requestText","clarificationText","conversationVersion","kind","status","nextGenerationSequence","createdAt","updatedAt")
        VALUES ('sess-1','proj-1',1,'',NULL,2,'PROJECT','OPEN',3,'${now}','${now}');

        INSERT INTO "ArchitectGeneration" ("id","sessionId","sequence","model","promptVersion","inputHash","contextManifestJson","status","turnState","createdAt")
        VALUES ('gen-1','sess-1',1,'gpt-5-mini','architect/3','abc','{"schemaVersion":1,"sources":[],"totalChars":0,"missing":[]}','CONTINUE','CONTINUE','${now}'),
               ('gen-2','sess-1',2,'gpt-5-mini','architect/3','def','{"schemaVersion":1,"sources":[],"totalChars":0,"missing":[]}','PROPOSAL_READY','PROPOSAL_READY','${now}');

        INSERT INTO "ArchitectMessage" ("id","sessionId","generationId","sequence","role","content","createdAt")
        VALUES ('msg-1','sess-1','gen-1',1,'USER','Par quoi commencer ?','${now}'),
               ('msg-2','sess-1','gen-1',2,'ARCHITECT','Par le plus petit increment.','${now}'),
               ('msg-3','sess-1','gen-2',3,'USER','Propose une tache.','${now}'),
               ('msg-4','sess-1','gen-2',4,'ARCHITECT','Voici ce que je propose.','${now}');

        INSERT INTO "ProjectMemoryEntry" ("id","projectId","sequence","category","title","content","rationale","status","createdAt","updatedAt")
        VALUES ('mem-1','proj-1',1,'DECISION','SQLite','La base reste locale.','Aucun serveur.','ACTIVE','${now}','${now}');
      `);

      /** Photographie ordonnee d'une table. */
      const snapshot = (table: string): unknown[] =>
        db.prepare(`SELECT * FROM "${table}" ORDER BY "id"`).all();

      const before = {
        projects: snapshot("Project"),
        tasks: snapshot("Task"),
        sessions: snapshot("ArchitectSession"),
        generations: snapshot("ArchitectGeneration"),
        messages: snapshot("ArchitectMessage"),
        memories: snapshot("ProjectMemoryEntry"),
      };

      // --- Les migrations de TASK-021 -------------------------------------
      for (const directory of TASK_021) {
        db.exec(await migrationSql(directory));
      }

      const after = {
        projects: snapshot("Project"),
        tasks: snapshot("Task"),
        sessions: snapshot("ArchitectSession"),
        generations: snapshot("ArchitectGeneration"),
        messages: snapshot("ArchitectMessage"),
        memories: snapshot("ProjectMemoryEntry"),
      };

      // Ligne a ligne, identifiants compris : rien n'a bouge.
      assert.deepEqual(after, before, "aucune ligne anterieure n'a change");

      // Les comptes, redits explicitement : une comparaison profonde qui
      // porterait sur deux tables vides passerait aussi.
      assert.equal(after.projects.length, 1);
      assert.equal(after.tasks.length, 2);
      assert.equal(after.sessions.length, 1);
      assert.equal(after.generations.length, 2);
      assert.equal(after.messages.length, 4);
      assert.equal(after.memories.length, 1);

      // --- L'etat structure nait vide -------------------------------------
      const count = (table: string): number => {
        const row = db.prepare(`SELECT COUNT(*) AS total FROM "${table}"`).get() as {
          total: number;
        };
        return row.total;
      };

      assert.equal(count("ProjectBrief"), 0, "aucun brief n'est invente");
      assert.equal(count("ProjectV1Plan"), 0, "aucun plan n'est invente");
      assert.equal(count("ArchitectProjectUpdate"), 0, "aucune proposition n'est inventee");
    } finally {
      db.close();
    }
  });

  it("accueille un brief et un plan sur le projet existant", async () => {
    // La migration ne se contente pas de ne rien casser : les nouvelles tables
    // doivent reellement accepter des lignes rattachees aux projets d'avant.
    const file = path.join(workspace, "ecriture.db");
    const db = new DatabaseSync(file);

    try {
      for (const directory of directories) {
        db.exec(await migrationSql(directory));
      }

      const now = "2026-08-01T10:00:00.000Z";
      db.exec(`
        INSERT INTO "Project" ("id","name","description","repositoryPath","status","createdAt","updatedAt","nextTaskSequence","nextMemorySequence","mainArchitectSessionId")
        VALUES ('proj-1','Suivi de lectures',NULL,'D:/depots/lectures','ACTIVE','${now}','${now}',1,1,NULL);

        INSERT INTO "ProjectBrief" ("id","projectId","summary","problem","targetUsers","desiredOutcome","goalsJson","nonGoalsJson","createdAt","updatedAt")
        VALUES ('brief-1','proj-1','Un suivi de lectures.','Rien ne centralise mes lectures.','Moi seul.','Savoir ce que j''ai lu.','["Enregistrer un livre"]','["Reseau social"]','${now}','${now}');

        INSERT INTO "ProjectV1Plan" ("id","projectId","goal","technicalDirection","inScopeJson","outOfScopeJson","milestonesJson","createdAt","updatedAt")
        VALUES ('plan-1','proj-1','Suivre une annee de lectures.','Application web simple.','["Liste"]','["Mobile"]','["La liste est utilisable"]','${now}','${now}');
      `);

      const brief = db.prepare(`SELECT * FROM "ProjectBrief"`).get() as { projectId: string };
      const plan = db.prepare(`SELECT * FROM "ProjectV1Plan"`).get() as { projectId: string };
      assert.equal(brief.projectId, "proj-1");
      assert.equal(plan.projectId, "proj-1");

      // Un projet supprime emporte son etat structure : pas d'orphelin.
      db.exec(`PRAGMA foreign_keys = ON; DELETE FROM "Project" WHERE "id" = 'proj-1';`);
      const remaining = db.prepare(`SELECT COUNT(*) AS total FROM "ProjectBrief"`).get() as {
        total: number;
      };
      assert.equal(remaining.total, 0, "le brief disparait avec son projet");
    } finally {
      db.close();
    }
  });
});
