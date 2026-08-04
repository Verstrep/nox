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
  createDatabaseClient,
  createProject,
  findProjectByRepositoryPath,
  getProjectById,
  isUniqueConstraintError,
  listProjects,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
} from "../dist/index.js";

/**
 * Ces tests utilisent une base SQLite temporaire, creee a partir des vraies
 * migrations du projet. La base de developpement (`data/nox-dev.db`) n'est ni
 * lue ni modifiee.
 */
const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma",
  "migrations",
);

let workspace: string;
let db: DatabaseClient;

/** Rejoue toutes les migrations versionnees sur une base vierge. */
async function applyMigrations(databaseFile: string): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.ok(directories.length > 0, "aucune migration trouvee");

  // `node:sqlite` est fourni par Node : appliquer le DDL des migrations ne
  // necessite donc aucune dependance supplementaire.
  const sqlite = new DatabaseSync(databaseFile);
  try {
    for (const directory of directories) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, directory, "migration.sql"), "utf8");
      sqlite.exec(sql);
    }
  } finally {
    sqlite.close();
  }
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-database-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));

  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("persistance des projets", () => {
  it("part d'une base vide", async () => {
    assert.deepEqual(await listProjects(db), []);
  });

  it("cree un projet au statut DRAFT et le relit", async () => {
    const created = await createProject(db, {
      name: "Projet de test",
      description: "Une description",
      repositoryPath: path.join(workspace, "depot-a"),
    });

    assert.equal(created.status, "DRAFT");
    assert.ok(created.id.length > 0);

    const reloaded = await getProjectById(db, created.id);
    assert.equal(reloaded?.name, "Projet de test");
    assert.equal(reloaded?.description, "Une description");
    assert.equal(reloaded?.repositoryPath, path.join(workspace, "depot-a"));
  });

  it("accepte une description absente", async () => {
    const created = await createProject(db, {
      name: "Sans description",
      description: null,
      repositoryPath: path.join(workspace, "depot-b"),
    });

    assert.equal(created.description, null);
  });

  it("retourne null pour un identifiant inconnu", async () => {
    assert.equal(await getProjectById(db, "identifiant-inexistant"), null);
  });

  it("retrouve un projet par son chemin de repository", async () => {
    const repositoryPath = path.join(workspace, "depot-c");
    const created = await createProject(db, {
      name: "Recherche par chemin",
      description: null,
      repositoryPath,
    });

    const found = await findProjectByRepositoryPath(db, repositoryPath);
    assert.equal(found?.id, created.id);
    assert.equal(await findProjectByRepositoryPath(db, path.join(workspace, "jamais-vu")), null);
  });

  it("refuse deux projets sur le meme repository", async () => {
    const repositoryPath = path.join(workspace, "depot-partage");
    await createProject(db, { name: "Premier", description: null, repositoryPath });

    await assert.rejects(
      createProject(db, { name: "Second", description: null, repositoryPath }),
      (error: unknown) => {
        assert.equal(isUniqueConstraintError(error), true);
        return true;
      },
    );
  });

  it("liste les projets du plus recent au plus ancien", async () => {
    const projects = await listProjects(db);
    const names = projects.map((project) => project.name);

    assert.ok(names.includes("Projet de test"));
    assert.ok(names.includes("Sans description"));

    const timestamps = projects.map((project) => project.createdAt.getTime());
    const sorted = [...timestamps].sort((a, b) => b - a);
    assert.deepEqual(timestamps, sorted);
  });
});

describe("isUniqueConstraintError", () => {
  it("ignore les erreurs qui ne viennent pas d'une contrainte d'unicite", () => {
    assert.equal(isUniqueConstraintError(new Error("boom")), false);
    assert.equal(isUniqueConstraintError({ code: "P2025" }), false);
    assert.equal(isUniqueConstraintError(null), false);
  });
});
