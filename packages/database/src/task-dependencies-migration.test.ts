/**
 * La migration de TASK-024 sur une base qui contient deja des donnees.
 *
 * ## Pourquoi ce test existe
 *
 * Pour la meme raison qu'en TASK-023 : « la migration passe sur ma base locale »
 * ne prouve rien quand cette base est recente. Ce qui doit etre prouve est
 * qu'une base construite au schema **d'avant** TASK-024 — projet, brief, plan,
 * memoire, conversation Architecte, proposition de mise a jour, planification de
 * backlog, taches avec leur provenance, `TASK-000` d'amorcage, execution et
 * review — la traverse sans qu'une seule ligne bouge.
 *
 * ## Ce que la migration apporte
 *
 * Une table, et rien d'autre. Aucune colonne ajoutee ailleurs, aucune donnee
 * lue, aucune dependance creee automatiquement : le graphe part vide, et il se
 * remplit a la main. C'est exactement ce que « les dependances sont
 * explicites » veut dire au niveau du schema.
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
 * Migration introduite par TASK-024.
 *
 * La nommer plutot que de prendre « la derniere » garde au test son sens le
 * jour ou une TASK-025 en ajoutera une autre.
 */
const TASK_024 = "20260820090000_add_task_dependencies";

let workspace: string;
let directories: string[];
let index: number;

async function migrationSql(name: string): Promise<string> {
  return readFile(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-deps-migration-"));
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  index = directories.indexOf(TASK_024);
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const NOW = "2026-08-01T10:00:00.000Z";

/** Un projet complet au schema d'avant TASK-024, amorcage et execution compris. */
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

  INSERT INTO "TaskAcceptanceCriterion" ("id","taskId","position","text")
  VALUES ('crit-1','task-1',0,'Un filtre par auteur existe');

  INSERT INTO "Run" ("id","taskId","sequence","status","prompt","promptSha256","runnerRunId","createdAt","updatedAt")
  VALUES ('run-1','task-1',1,'COMPLETED','Prompt.','${"a".repeat(64)}','11111111-1111-4111-8111-111111111111','${NOW}','${NOW}');
`;

const TABLES = [
  "Project",
  "Task",
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

async function historicDatabase(name: string, upTo: number): Promise<DatabaseSync> {
  const db = new DatabaseSync(path.join(workspace, name));
  for (const directory of directories.slice(0, upTo)) {
    db.exec(await migrationSql(directory));
  }
  db.exec(HISTORIC_DATA);
  return db;
}

describe("migration de TASK-024 sur une base historique", () => {
  it("laisse toutes les donnees anterieures intactes", async () => {
    assert.ok(index >= 0, "la migration de TASK-024 existe");

    const db = await historicDatabase("historique.db", index);
    try {
      const snapshot = (table: string): unknown[] =>
        db.prepare(`SELECT * FROM "${table}" ORDER BY "id"`).all();

      const before = Object.fromEntries(TABLES.map((table) => [table, snapshot(table)]));

      db.exec(await migrationSql(TASK_024));

      const after = Object.fromEntries(TABLES.map((table) => [table, snapshot(table)]));

      // Aucune table existante n'est modifiee : la comparaison porte sur tout,
      // sans exception ni colonne mise de cote.
      assert.deepEqual(after, before, "aucune ligne anterieure n'a change");
    } finally {
      db.close();
    }
  });

  it("ne cree aucune dependance automatiquement", async () => {
    const db = await historicDatabase("vide.db", index);
    try {
      db.exec(await migrationSql(TASK_024));

      const rows = db.prepare(`SELECT COUNT(*) AS total FROM "TaskDependency"`).get() as {
        total: number;
      };
      // Ni vers l'amorcage, ni entre les taches d'un meme backlog : le graphe
      // est explicite, et il part vide.
      assert.equal(rows.total, 0);
    } finally {
      db.close();
    }
  });

  it("preserve nature, numeros, compteur et provenance", async () => {
    const db = await historicDatabase("nature.db", index);
    try {
      db.exec(await migrationSql(TASK_024));

      const tasks = db
        .prepare(
          `SELECT "id","sequence","kind","backlogProposalId","backlogItemPosition" FROM "Task" ORDER BY "sequence"`,
        )
        .all() as {
        id: string;
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
      assert.equal(tasks[1]?.backlogItemPosition, 0);

      const project = db
        .prepare(`SELECT "nextTaskSequence" FROM "Project" WHERE "id" = 'proj-1'`)
        .get() as { nextTaskSequence: number };
      assert.equal(project.nextTaskSequence, 3, "le compteur ne recule pas");
    } finally {
      db.close();
    }
  });

  it("refuse deux fois la meme arete", async () => {
    const db = await historicDatabase("unicite.db", directories.length);
    try {
      db.exec(`
        INSERT INTO "TaskDependency" ("id","taskId","dependsOnTaskId","createdAt")
        VALUES ('dep-1','task-2','task-1','${NOW}');
      `);

      assert.throws(() => {
        db.exec(`
          INSERT INTO "TaskDependency" ("id","taskId","dependsOnTaskId","createdAt")
          VALUES ('dep-2','task-2','task-1','${NOW}');
        `);
      }, /UNIQUE/i);
    } finally {
      db.close();
    }
  });

  it("autorise la meme paire dans l'autre sens au niveau du schema", async () => {
    const db = await historicDatabase("sens.db", directories.length);
    try {
      db.exec(`
        INSERT INTO "TaskDependency" ("id","taskId","dependsOnTaskId","createdAt")
        VALUES ('dep-1','task-2','task-1','${NOW}'),
               ('dep-2','task-1','task-2','${NOW}');
      `);

      // Le schema ne connait pas les cycles : c'est la transaction applicative
      // qui les refuse, et c'est elle qui est testee ailleurs. Le dire ici evite
      // de croire a une garantie que la table ne donne pas.
      const rows = db.prepare(`SELECT COUNT(*) AS total FROM "TaskDependency"`).get() as {
        total: number;
      };
      assert.equal(rows.total, 2);
    } finally {
      db.close();
    }
  });
});
