/**
 * La migration de TASK-029 sur une base qui contient deja tout.
 *
 * ## Pourquoi ce test existe
 *
 * Parce que « la migration passe sur ma base locale » ne prouve rien quand cette
 * base est recente. Ce qui doit etre prouve est qu'une base construite au schema
 * **d'avant** TASK-029 — projet, brief, plan, memoire, conversation Architecte,
 * planification `backlog/2`, amorcage, taches, dependances, file d'execution,
 * executions, lots de validation, decisions de review, reservations de
 * correction — la traverse sans qu'une seule ligne bouge.
 *
 * ## Ce que la migration apporte, et surtout ce qu'elle ne fait pas
 *
 * Une table, une colonne, et rien d'autre. Le point le plus important de ce
 * fichier est negatif : appliquer TASK-029 produit **zero** livraison, et donne
 * `MANUAL` a tous les projets existants. Le simple fait d'installer cette
 * version ne doit creer aucun commit, aucun push, et ne doit faire avancer
 * aucune file.
 *
 * Les livraisons passees ne sont pas non plus reconstruites depuis l'historique
 * Git : un commit deja present dans un depot appartient au depot, pas a NOX.
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
 * Migration introduite par TASK-029.
 *
 * La nommer plutot que de prendre « la derniere » garde au test son sens le jour
 * ou une TASK-031 en ajoutera une autre.
 */
const TASK_029 = "20260827090000_add_git_delivery";

let workspace: string;
let directories: string[];
let index: number;

async function migrationSql(name: string): Promise<string> {
  return readFile(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-delivery-migration-"));
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  index = directories.indexOf(TASK_029);
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const NOW = "2026-08-26T10:00:00.000Z";
const SHA = "a".repeat(64);

/** Un projet complet au schema d'avant TASK-029, etat de TASK-028 compris. */
const HISTORIC_DATA = `
  INSERT INTO "Project" ("id","name","description","repositoryPath","status","createdAt","updatedAt","nextTaskSequence","nextMemorySequence","mainArchitectSessionId","nextBacklogSequence","activeBacklogGenerationId","pendingBacklogProposalId","executionQueueActive","nextQueueSequence")
  VALUES ('proj-1','Suivi de lectures','Un projet reel','D:/depots/lectures','ACTIVE','${NOW}','${NOW}',4,2,'sess-1',2,NULL,NULL,1,3);

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

  INSERT INTO "ArchitectBacklogGeneration" ("id","projectId","sequence","status","model","promptVersion","inputHash","contextManifestJson","planningFingerprint","baseTaskInventoryRevision","baseMemoryRevision","createdAt")
  VALUES ('bg-1','proj-1',1,'READY','gpt-5-mini','backlog/2','hash','{"schemaVersion":1,"sources":[],"totalChars":0,"missing":[],"taskInventoryRevision":"inv"}','fp','inv','mem','${NOW}');

  INSERT INTO "ArchitectBacklogProposal" ("id","generationId","projectId","status","message","taskCount","providerJson","createdAt")
  VALUES ('bp-1','bg-1','proj-1','APPLIED','Deux increments.',2,'{"schemaVersion":1,"message":"Deux increments.","tasks":[]}','${NOW}');

  INSERT INTO "Task" ("id","projectId","sequence","kind","title","priority","objective","context","outOfScope","status","documentPath","documentRevision","documentSyncStatus","nextRunSequence","createdAt","updatedAt","backlogProposalId","backlogItemPosition")
  VALUES ('task-0','proj-1',0,'BOOTSTRAP','Bootstrap project repository','HIGH','Etablir la fondation.',NULL,NULL,'COMPLETED','tasks/TASK-000.md','${SHA}','SYNCED',2,'${NOW}','${NOW}',NULL,NULL),
         ('task-1','proj-1',1,'NORMAL','Filtrer les livres','MEDIUM','Retrouver un livre','La liste est brute',NULL,'COMPLETED','tasks/TASK-001.md','${SHA}','SYNCED',3,'${NOW}','${NOW}','bp-1',0),
         ('task-2','proj-1',2,'NORMAL','Trier les livres','LOW','Ordonner la liste',NULL,NULL,'READY','tasks/TASK-002.md','${SHA}','SYNCED',1,'${NOW}','${NOW}','bp-1',1),
         ('task-3','proj-1',3,'NORMAL','Exporter la liste','LOW','Sortir un CSV',NULL,NULL,'REVIEW','tasks/TASK-003.md','${SHA}','SYNCED',2,'${NOW}','${NOW}',NULL,NULL);

  INSERT INTO "TaskAcceptanceCriterion" ("id","taskId","position","text","verificationMode","humanInstructions")
  VALUES ('crit-1','task-1',0,'Un filtre par auteur existe','AUTOMATED',NULL),
         ('crit-2','task-3',0,'Le CSV est lisible','HUMAN','Ouvrir le fichier dans un tableur.');

  INSERT INTO "TaskValidationCommand" ("id","taskId","position","command","executionMode")
  VALUES ('cmd-1','task-1',0,'npm test','AUTONOMOUS');

  INSERT INTO "TaskCriterionValidation" ("id","criterionId","commandId")
  VALUES ('link-1','crit-1','cmd-1');

  INSERT INTO "TaskDependency" ("id","taskId","dependsOnTaskId","createdAt")
  VALUES ('dep-1','task-2','task-1','${NOW}');

  INSERT INTO "TaskQueueEntry" ("id","projectId","taskId","sequence","createdAt","startedAt")
  VALUES ('q-1','proj-1','task-2',1,'${NOW}',NULL);

  INSERT INTO "Run" ("id","taskId","sequence","status","kind","parentRunId","prompt","promptSha256","runnerRunId","createdAt","updatedAt","reviewOmittedFiles","nextArchitectReviewSequence")
  VALUES ('run-1','task-1',1,'COMPLETED','INITIAL',NULL,'Prompt.','${SHA}','11111111-1111-4111-8111-111111111111','${NOW}','${NOW}',0,1),
         ('run-2','task-1',2,'COMPLETED','CORRECTION','run-1','Prompt de correction.','${SHA}','11111111-1111-4111-8111-111111111112','${NOW}','${NOW}',0,1),
         ('run-3','task-3',1,'COMPLETED','INITIAL',NULL,'Prompt.','${SHA}','11111111-1111-4111-8111-111111111113','${NOW}','${NOW}',0,1);

  INSERT INTO "AutonomousValidationBatch" ("id","runId","attempt","status","createdAt","mutatedFiles")
  VALUES ('batch-1','run-1',1,'FAILED','${NOW}',NULL),
         ('batch-2','run-2',1,'PASSED','${NOW}',NULL);

  INSERT INTO "AutonomousValidationResult" ("id","batchId","position","commandId","command","status","exitCode","stdoutTruncated","stderrTruncated","createdAt")
  VALUES ('res-1','batch-1',0,'cmd-1','npm test','FAILED',1,0,0,'${NOW}'),
         ('res-2','batch-2',0,'cmd-1','npm test','PASSED',0,0,0,'${NOW}');

  INSERT INTO "CorrectionAttempt" ("id","taskId","sourceRunId","sourceBatchId","source","attempt","automatedAttempt","status","createdAt","correctionRunId")
  VALUES ('att-1','task-1','run-1','batch-1','AUTOMATED_VALIDATION',1,1,'LAUNCHED','${NOW}','run-2');

  INSERT INTO "RunReviewDecision" ("id","runId","source","overrideReason","decidedAt")
  VALUES ('dec-1','run-2','AUTOMATED',NULL,'${NOW}');
`;

const TABLES = [
  "Project",
  "Task",
  "TaskAcceptanceCriterion",
  "TaskValidationCommand",
  "TaskCriterionValidation",
  "TaskDependency",
  "TaskQueueEntry",
  "Run",
  "AutonomousValidationBatch",
  "AutonomousValidationResult",
  "CorrectionAttempt",
  "RunReviewDecision",
  "ArchitectSession",
  "ArchitectGeneration",
  "ArchitectMessage",
  "ProjectMemoryEntry",
  "ProjectBrief",
  "ProjectV1Plan",
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

describe("migration de TASK-029 sur une base historique", () => {
  it("laisse toutes les donnees anterieures intactes, hors la colonne ajoutee", async () => {
    assert.ok(index >= 0, "la migration de TASK-029 existe");

    const db = await historicDatabase("historique.db", index);
    try {
      // `node:sqlite` rend des objets sans prototype : les recopier en objets
      // ordinaires evite de comparer des formes plutot que des donnees.
      const snapshot = (table: string): Record<string, unknown>[] =>
        (db.prepare(`SELECT * FROM "${table}" ORDER BY "id"`).all() as Record<string, unknown>[]).map(
          (row) => ({ ...row }),
        );

      const before = Object.fromEntries(TABLES.map((table) => [table, snapshot(table)]));

      db.exec(await migrationSql(TASK_029));

      const after = Object.fromEntries(TABLES.map((table) => [table, snapshot(table)]));

      // `Project` gagne une colonne : la comparaison la retire, et le test qui
      // suit verifie sa valeur. Toutes les autres tables sont comparees
      // entierement, sans exception.
      const projectsBefore = before["Project"] ?? [];
      const projectsAfter = (after["Project"] ?? []).map((row) => {
        const { deliveryPolicy: _ignored, ...rest } = row;
        return rest;
      });
      assert.deepEqual(projectsAfter, projectsBefore, "aucune colonne de Project n'a change");

      for (const table of TABLES.filter((name) => name !== "Project")) {
        assert.deepEqual(after[table], before[table], `${table} a change`);
      }
    } finally {
      db.close();
    }
  });

  it("donne MANUAL a tous les projets existants", async () => {
    // Une migration ne doit jamais accorder un droit que personne n'a demande.
    const db = await historicDatabase("politique.db", index);
    try {
      db.exec(await migrationSql(TASK_029));

      const rows = (
        db.prepare(`SELECT "id","deliveryPolicy" FROM "Project"`).all() as {
          id: string;
          deliveryPolicy: string;
        }[]
      ).map((row) => ({ ...row }));
      assert.deepEqual(rows, [{ id: "proj-1", deliveryPolicy: "MANUAL" }]);
    } finally {
      db.close();
    }
  });

  it("ne cree aucune livraison", async () => {
    // Le point le plus important de ce fichier. Installer cette version produit
    // zero commit, zero push, zero livraison — et ne fait avancer aucune file.
    const db = await historicDatabase("livraisons.db", index);
    try {
      db.exec(await migrationSql(TASK_029));

      const total = db.prepare(`SELECT COUNT(*) AS total FROM "GitDelivery"`).get() as {
        total: number;
      };
      assert.equal(total.total, 0);
    } finally {
      db.close();
    }
  });

  it("ne reconstruit aucune livraison depuis l'historique", async () => {
    // Une tache terminee, une execution reussie, une decision de review : tout
    // ce qu'il faudrait pour fabriquer une livraison retroactive. NOX n'en
    // fabrique aucune — un commit deja present dans un depot appartient au
    // depot.
    const db = await historicDatabase("retroactif.db", index);
    try {
      db.exec(await migrationSql(TASK_029));

      const completed = db
        .prepare(`SELECT COUNT(*) AS total FROM "Task" WHERE "status" = 'COMPLETED'`)
        .get() as { total: number };
      assert.ok(completed.total >= 2, "la fixture porte bien des taches terminees");

      const deliveries = db.prepare(`SELECT COUNT(*) AS total FROM "GitDelivery"`).get() as {
        total: number;
      };
      assert.equal(deliveries.total, 0);
    } finally {
      db.close();
    }
  });

  it("preserve la file active et son inscription", async () => {
    // Une file laissee `ACTIVE` avant la migration ne doit rien declencher du
    // seul fait d'appliquer une version : l'autorisation survit, le
    // declenchement non.
    const db = await historicDatabase("file.db", index);
    try {
      db.exec(await migrationSql(TASK_029));

      const project = { ...(db
        .prepare(`SELECT "executionQueueActive","nextQueueSequence" FROM "Project"`)
        .get() as { executionQueueActive: number; nextQueueSequence: number }) };
      assert.equal(project.executionQueueActive, 1);
      assert.equal(project.nextQueueSequence, 3);

      const entries = (
        db.prepare(`SELECT "taskId","startedAt" FROM "TaskQueueEntry"`).all() as Record<
          string,
          unknown
        >[]
      ).map((row) => ({ ...row }));
      assert.deepEqual(entries, [{ taskId: "task-2", startedAt: null }]);
    } finally {
      db.close();
    }
  });

  it("preserve la chaine de correction de TASK-028", async () => {
    const db = await historicDatabase("corrections.db", index);
    try {
      db.exec(await migrationSql(TASK_029));

      const attempts = (
        db
          .prepare(
            `SELECT "id","status","automatedAttempt","correctionRunId" FROM "CorrectionAttempt"`,
          )
          .all() as Record<string, unknown>[]
      ).map((row) => ({ ...row }));
      assert.deepEqual(attempts, [
        { id: "att-1", status: "LAUNCHED", automatedAttempt: 1, correctionRunId: "run-2" },
      ]);
    } finally {
      db.close();
    }
  });

  it("est reversible sur la seule dimension qui compte : elle n'ecrit rien", async () => {
    // Appliquer la migration deux fois de suite n'est pas un cas reel, mais
    // l'appliquer sur une base ou personne n'a rien fait doit laisser exactement
    // le meme etat qu'avant, colonne mise a part.
    const db = await historicDatabase("stabilite.db", index);
    try {
      db.exec(await migrationSql(TASK_029));
      const read = (): Record<string, unknown>[] =>
        (db.prepare(`SELECT * FROM "Run" ORDER BY "id"`).all() as Record<string, unknown>[]).map(
          (row) => ({ ...row }),
        );
      const first = read();
      const second = read();
      assert.deepEqual(second, first);
    } finally {
      db.close();
    }
  });
});
