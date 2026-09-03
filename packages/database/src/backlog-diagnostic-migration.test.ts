/**
 * La migration de HOTFIX-001 sur une base qui contient deja une planification.
 *
 * ## Pourquoi ce test existe
 *
 * Parce que la ligne que ce hotfix doit **preserver** existe reellement : le
 * pilote TripKit possede un `BACKLOG-001 FAILED gpt-5-mini`, et cette ligne
 * raconte l'appel qui a eu lieu. Une migration qui la reecrirait pour afficher
 * le nouveau modele par defaut transformerait l'historique en publicite.
 *
 * ## Ce que la migration apporte, et surtout ce qu'elle ne fait pas
 *
 * Deux colonnes nullables, et rien d'autre. Aucune ligne n'est ecrite, aucun
 * modele n'est renomme, aucune cause d'echec n'est reconstruite depuis les logs.
 * Une generation d'avant HOTFIX-001 reste echouee sans diagnostic — un etat que
 * l'ecran sait afficher, et qu'il ne faut pas confondre avec « aucune cause ».
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
 * Migration introduite par HOTFIX-001.
 *
 * La nommer plutot que de prendre « la derniere » garde au test son sens le jour
 * ou une autre s'y ajoutera.
 */
const HOTFIX_001 = "20260903090000_add_backlog_failure_diagnostic";

let workspace: string;
let directories: string[];
let index: number;

async function migrationSql(name: string): Promise<string> {
  return readFile(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-backlog-diagnostic-migration-"));
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  index = directories.indexOf(HOTFIX_001);
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const NOW = "2026-09-02T10:00:00.000Z";

/**
 * Un projet avec deux planifications, dont l'echec du pilote.
 *
 * `bg-1` porte exactement la forme observee : `FAILED`, `gpt-5-mini`, 11035
 * jetons, et aucune cause enregistree.
 */
const HISTORIC_DATA = `
  INSERT INTO "Project" ("id","name","description","repositoryPath","status","createdAt","updatedAt","nextTaskSequence","nextMemorySequence","mainArchitectSessionId","nextBacklogSequence","activeBacklogGenerationId","pendingBacklogProposalId","executionQueueActive","nextQueueSequence","deliveryPolicy")
  VALUES ('proj-1','TripKit','Un projet pilote','D:/depots/tripkit','ACTIVE','${NOW}','${NOW}',1,1,NULL,2,NULL,NULL,0,1,'MANUAL');

  INSERT INTO "ArchitectBacklogGeneration" ("id","projectId","sequence","status","model","promptVersion","inputHash","contextManifestJson","planningFingerprint","baseTaskInventoryRevision","baseMemoryRevision","totalTokens","errorCode","createdAt","finishedAt")
  VALUES ('bg-1','proj-1',1,'FAILED','gpt-5-mini','backlog/2','hash','{"schemaVersion":1,"sources":[],"totalChars":0,"missing":[],"taskInventoryRevision":"inv"}','fp','inv','mem',11035,'ARCHITECT_OUTPUT_INVALID','${NOW}','${NOW}');
`;

async function historicDatabase(name: string): Promise<DatabaseSync> {
  const db = new DatabaseSync(path.join(workspace, name));
  for (const directory of directories.slice(0, index)) {
    db.exec(await migrationSql(directory));
  }
  db.exec(HISTORIC_DATA);
  return db;
}

function rows(db: DatabaseSync, sql: string): Record<string, unknown>[] {
  // `node:sqlite` rend des objets sans prototype : les recopier evite de
  // comparer des formes plutot que des donnees.
  return (db.prepare(sql).all() as Record<string, unknown>[]).map((row) => ({ ...row }));
}

describe("migration de HOTFIX-001 sur une base historique", () => {
  it("laisse la generation historique intacte, hors les colonnes ajoutees", async () => {
    assert.ok(index >= 0, "la migration de HOTFIX-001 existe");

    const db = await historicDatabase("historique.db");
    try {
      const query = `SELECT * FROM "ArchitectBacklogGeneration" ORDER BY "id"`;
      const before = rows(db, query);

      db.exec(await migrationSql(HOTFIX_001));

      const after = rows(db, query).map((row) => {
        const { errorField: _field, errorDetail: _detail, ...rest } = row;
        return rest;
      });

      assert.deepEqual(after, before);
    } finally {
      db.close();
    }
  });

  it("conserve le modele reellement utilise par la generation d'alors", async () => {
    // Le point central de ce fichier : `BACKLOG-001` reste `gpt-5-mini`. Le
    // nouveau modele par defaut gouverne les appels a venir, pas ceux qui ont
    // deja eu lieu.
    const db = await historicDatabase("modele.db");
    try {
      db.exec(await migrationSql(HOTFIX_001));

      assert.deepEqual(
        rows(db, `SELECT "id","status","model","totalTokens" FROM "ArchitectBacklogGeneration"`),
        [{ id: "bg-1", status: "FAILED", model: "gpt-5-mini", totalTokens: 11035 }],
      );
    } finally {
      db.close();
    }
  });

  it("ne reconstruit aucune cause d'echec", async () => {
    // NOX ne fabrique pas retroactivement un diagnostic qu'il n'a jamais
    // persiste : « cause non enregistree » est un etat, pas une occasion d'en
    // inventer une.
    const db = await historicDatabase("diagnostic.db");
    try {
      db.exec(await migrationSql(HOTFIX_001));

      assert.deepEqual(
        rows(db, `SELECT "errorField","errorDetail" FROM "ArchitectBacklogGeneration"`),
        [{ errorField: null, errorDetail: null }],
      );
    } finally {
      db.close();
    }
  });

  it("n'ajoute aucune ligne", async () => {
    const db = await historicDatabase("lignes.db");
    try {
      db.exec(await migrationSql(HOTFIX_001));

      for (const table of ["Project", "ArchitectBacklogGeneration"]) {
        const total = db.prepare(`SELECT COUNT(*) AS total FROM "${table}"`).get() as {
          total: number;
        };
        assert.equal(total.total, 1, `${table} a change de taille`);
      }
    } finally {
      db.close();
    }
  });

  it("n'ajoute que deux colonnes, toutes deux nullables", async () => {
    const db = await historicDatabase("colonnes.db");
    try {
      const before = rows(db, `PRAGMA table_info("ArchitectBacklogGeneration")`);
      db.exec(await migrationSql(HOTFIX_001));
      const after = rows(db, `PRAGMA table_info("ArchitectBacklogGeneration")`);

      const added = after.filter(
        (column) => !before.some((existing) => existing["name"] === column["name"]),
      );
      assert.deepEqual(
        added.map((column) => column["name"]),
        ["errorField", "errorDetail"],
      );
      for (const column of added) {
        assert.equal(column["notnull"], 0, `${String(column["name"])} doit rester nullable`);
        assert.equal(column["dflt_value"], null);
      }
    } finally {
      db.close();
    }
  });
});
