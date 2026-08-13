/**
 * Tests de la persistance de la memoire projet.
 *
 * Base temporaire, isolee, detruite a la fin : la base de developpement n'est
 * jamais ouverte par ces tests. Le package compile est importe volontairement —
 * c'est l'artefact que le web consomme reellement.
 *
 * Deux proprietes structurent ce fichier. **Un numero n'est jamais reattribue** :
 * supprimer `MEM-002` ne rend pas ce code disponible, sans quoi deux manifests
 * Architecte designeraient deux decisions differentes sous le meme nom. Et
 * **le budget est verifie a l'ecriture** : une entree active qui ne tiendrait
 * pas dans le contexte est refusee, jamais tronquee a l'envoi.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  PROJECT_MEMORY_CATEGORY,
  PROJECT_MEMORY_LIMITS,
  PROJECT_MEMORY_STATUS,
  type ProjectMemoryValues,
} from "@nox/shared";

import {
  createDatabaseClient,
  createProject,
  deleteProjectMemory,
  getProjectMemory,
  listActiveProjectMemories,
  listProjectMemories,
  projectMemoryStats,
  sanitizedMemoryChars,
  setProjectMemoryStatus,
  toDatabaseFilePath,
  toSqliteUrl,
  updateProjectMemory,
  createProjectMemory,
  type DatabaseClient,
} from "../dist/index.js";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma",
  "migrations",
);

/** Nettoyeur neutre : le budget se mesure alors sur le texte brut. */
const IDENTITY = (value: string): string => value;

/** Nettoyeur qui masque, pour verifier que le budget suit le texte **envoye**. */
const MASKING = (value: string): string => value.replaceAll("SECRET", "*");

let workspace: string;
let db: DatabaseClient;
let counter = 0;

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

async function newProject(): Promise<string> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  return project.id;
}

function values(overrides: Partial<ProjectMemoryValues> = {}): ProjectMemoryValues {
  return {
    category: PROJECT_MEMORY_CATEGORY.DECISION,
    title: "Les appels OpenAI exigent un apercu",
    content: "Chaque appel Architecte est precede d'un apercu explicite.",
    rationale: null,
    status: PROJECT_MEMORY_STATUS.ACTIVE,
    ...overrides,
  };
}

/** Une entree dont le texte sanitise fait exactement `chars` caracteres. */
function sized(chars: number, overrides: Partial<ProjectMemoryValues> = {}): ProjectMemoryValues {
  const title = "T";
  return values({ title, content: "c".repeat(chars - title.length), rationale: null, ...overrides });
}

function create(projectId: string, entry: ProjectMemoryValues, sanitize = IDENTITY) {
  return createProjectMemory(db, { projectId, values: entry, sanitize });
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-memory-db-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));

  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("createProjectMemory", () => {
  it("numerote les entrees a partir de MEM-001", async () => {
    const projectId = await newProject();

    const first = await create(projectId, values());
    assert.ok(first.ok);
    assert.equal(first.entry.code, "MEM-001");
    assert.equal(first.entry.sequence, 1);

    const second = await create(projectId, values({ title: "Seconde" }));
    assert.ok(second.ok);
    assert.equal(second.entry.code, "MEM-002");
  });

  it("recommence a MEM-001 dans un autre projet", async () => {
    const other = await newProject();
    const created = await create(other, values());
    assert.ok(created.ok);
    assert.equal(created.entry.code, "MEM-001");
  });

  it("enregistre les quatre categories", async () => {
    const projectId = await newProject();
    for (const category of Object.values(PROJECT_MEMORY_CATEGORY)) {
      const created = await create(projectId, values({ category }));
      assert.ok(created.ok);
      assert.equal(created.entry.category, category);
    }
  });

  it("accepte une entree directement archivee", async () => {
    const projectId = await newProject();
    const created = await create(projectId, values({ status: PROJECT_MEMORY_STATUS.ARCHIVED }));
    assert.ok(created.ok);
    assert.equal(created.entry.status, PROJECT_MEMORY_STATUS.ARCHIVED);
  });

  it("conserve le texte multiligne et l'Unicode tels quels", async () => {
    const projectId = await newProject();
    const content = "Premiere ligne\n\nSeconde ligne — avec un tiret cadratin et ✅";
    const created = await create(projectId, values({ content, rationale: "Parce que ç'est utile." }));
    assert.ok(created.ok);
    assert.equal(created.entry.content, content);
    assert.equal(created.entry.rationale, "Parce que ç'est utile.");
  });

  it("refuse un projet inconnu", async () => {
    const created = await create("projet-inexistant", values());
    assert.ok(!created.ok);
    assert.equal(created.reason, "not_found");
  });

  it("attribue deux codes differents a deux creations simultanees", async () => {
    const projectId = await newProject();

    const [a, b] = await Promise.all([
      create(projectId, values({ title: "A" })),
      create(projectId, values({ title: "B" })),
    ]);

    assert.ok(a.ok);
    assert.ok(b.ok);
    assert.notEqual(a.entry.code, b.entry.code);
  });

  it("refuse au-dela de la limite d'entrees", async () => {
    const projectId = await newProject();
    // Les entrees archivees comptent dans cette limite : elle protege la table,
    // pas le contexte.
    for (let index = 0; index < PROJECT_MEMORY_LIMITS.entries; index += 1) {
      const created = await create(
        projectId,
        values({ title: `Entree ${String(index)}`, status: PROJECT_MEMORY_STATUS.ARCHIVED }),
      );
      assert.ok(created.ok);
    }

    const extra = await create(projectId, values({ status: PROJECT_MEMORY_STATUS.ARCHIVED }));
    assert.ok(!extra.ok);
    assert.equal(extra.reason, "entries");
  });
});

describe("budget des entrees actives", () => {
  it("part de zero", async () => {
    const projectId = await newProject();
    const stats = await projectMemoryStats(db, projectId, IDENTITY);
    assert.equal(stats.activeChars, 0);
    assert.equal(stats.total, 0);
  });

  it("accepte une entree exactement a la limite", async () => {
    const projectId = await newProject();
    const created = await create(projectId, sized(PROJECT_MEMORY_LIMITS.activeChars));
    assert.ok(created.ok);

    const stats = await projectMemoryStats(db, projectId, IDENTITY);
    assert.equal(stats.activeChars, PROJECT_MEMORY_LIMITS.activeChars);
  });

  it("refuse un depassement d'un seul caractere", async () => {
    const projectId = await newProject();
    const created = await create(projectId, sized(PROJECT_MEMORY_LIMITS.activeChars + 1));
    assert.ok(!created.ok);
    assert.equal(created.reason, "budget");
  });

  it("additionne plusieurs entrees actives", async () => {
    const projectId = await newProject();
    const half = Math.floor(PROJECT_MEMORY_LIMITS.activeChars / 2);

    assert.ok((await create(projectId, sized(half))).ok);
    assert.ok((await create(projectId, sized(half))).ok);

    const third = await create(projectId, sized(half));
    assert.ok(!third.ok);
    assert.equal(third.reason, "budget");
  });

  it("ne compte pas les entrees archivees", async () => {
    const projectId = await newProject();
    assert.ok(
      (await create(projectId, sized(PROJECT_MEMORY_LIMITS.activeChars, {
        status: PROJECT_MEMORY_STATUS.ARCHIVED,
      }))).ok,
    );

    const stats = await projectMemoryStats(db, projectId, IDENTITY);
    assert.equal(stats.activeChars, 0);
    assert.equal(stats.archived, 1);

    // Le budget reste donc entierement disponible.
    assert.ok((await create(projectId, sized(PROJECT_MEMORY_LIMITS.activeChars))).ok);
  });

  it("archiver libere le budget", async () => {
    const projectId = await newProject();
    const first = await create(projectId, sized(PROJECT_MEMORY_LIMITS.activeChars));
    assert.ok(first.ok);

    const refused = await create(projectId, sized(100));
    assert.ok(!refused.ok);

    const archived = await setProjectMemoryStatus(db, {
      memoryId: first.entry.id,
      status: PROJECT_MEMORY_STATUS.ARCHIVED,
      sanitize: IDENTITY,
    });
    assert.ok(archived.ok);

    assert.ok((await create(projectId, sized(100))).ok);
  });

  it("refuse une restauration qui depasserait le budget", async () => {
    const projectId = await newProject();
    const archivedEntry = await create(
      projectId,
      sized(PROJECT_MEMORY_LIMITS.activeChars, { status: PROJECT_MEMORY_STATUS.ARCHIVED }),
    );
    assert.ok(archivedEntry.ok);
    assert.ok((await create(projectId, sized(100))).ok);

    const restored = await setProjectMemoryStatus(db, {
      memoryId: archivedEntry.entry.id,
      status: PROJECT_MEMORY_STATUS.ACTIVE,
      sanitize: IDENTITY,
    });
    assert.ok(!restored.ok);
    assert.equal(restored.reason, "budget");

    // L'entree n'a pas bouge : un refus ne modifie rien.
    const reloaded = await getProjectMemory(db, archivedEntry.entry.id);
    assert.equal(reloaded?.status, PROJECT_MEMORY_STATUS.ARCHIVED);
  });

  it("refuse une modification active qui depasserait le budget", async () => {
    const projectId = await newProject();
    const small = await create(projectId, sized(100));
    assert.ok(small.ok);

    const grown = await updateProjectMemory(db, {
      memoryId: small.entry.id,
      values: sized(PROJECT_MEMORY_LIMITS.activeChars + 1),
      sanitize: IDENTITY,
    });
    assert.ok(!grown.ok);
    assert.equal(grown.reason, "budget");
  });

  it("n'additionne pas l'ancienne et la nouvelle version d'une meme entree", async () => {
    const projectId = await newProject();
    // Une entree qui occupe deja presque tout le budget doit pouvoir etre
    // modifiee sans que son ancienne taille soit comptee en double.
    const entry = await create(projectId, sized(PROJECT_MEMORY_LIMITS.activeChars - 10));
    assert.ok(entry.ok);

    const edited = await updateProjectMemory(db, {
      memoryId: entry.entry.id,
      values: sized(PROJECT_MEMORY_LIMITS.activeChars - 10, { title: "T" }),
      sanitize: IDENTITY,
    });
    assert.ok(edited.ok);
  });

  it("autorise une entree archivee au-dessus du budget", async () => {
    const projectId = await newProject();
    assert.ok((await create(projectId, sized(PROJECT_MEMORY_LIMITS.activeChars))).ok);

    const huge = await create(
      projectId,
      sized(PROJECT_MEMORY_LIMITS.activeChars, { status: PROJECT_MEMORY_STATUS.ARCHIVED }),
    );
    assert.ok(huge.ok);

    // Et sa modification reste possible tant qu'elle reste archivee.
    const edited = await updateProjectMemory(db, {
      memoryId: huge.entry.id,
      values: sized(PROJECT_MEMORY_LIMITS.activeChars, {
        status: PROJECT_MEMORY_STATUS.ARCHIVED,
        title: "T",
      }),
      sanitize: IDENTITY,
    });
    assert.ok(edited.ok);
  });

  it("mesure le budget sur le texte sanitise, pas sur le texte stocke", async () => {
    const projectId = await newProject();
    const entry = values({ title: "T", content: "SECRET", rationale: null });

    // « SECRET » (6 caracteres) devient « * » (1) : le budget compte 2, pas 7.
    assert.equal(sanitizedMemoryChars(entry, MASKING), 2);
    assert.equal(sanitizedMemoryChars(entry, IDENTITY), 7);

    const created = await create(projectId, entry, MASKING);
    assert.ok(created.ok);
    // Le texte stocke, lui, reste celui de l'utilisateur.
    assert.equal(created.entry.content, "SECRET");

    const stats = await projectMemoryStats(db, projectId, MASKING);
    assert.equal(stats.activeChars, 2);
  });
});

describe("lecture", () => {
  it("liste dans l'ordre des codes, jamais par date de modification", async () => {
    const projectId = await newProject();
    const first = await create(projectId, values({ title: "Premiere" }));
    assert.ok(first.ok);
    assert.ok((await create(projectId, values({ title: "Seconde" }))).ok);

    // La premiere est modifiee en dernier : elle doit rester en tete.
    await updateProjectMemory(db, {
      memoryId: first.entry.id,
      values: values({ title: "Premiere, corrigee" }),
      sanitize: IDENTITY,
    });

    const entries = await listProjectMemories(db, projectId);
    assert.deepEqual(
      entries.map((entry) => entry.code),
      ["MEM-001", "MEM-002"],
    );
  });

  it("ne retourne que les entrees actives quand on le demande", async () => {
    const projectId = await newProject();
    assert.ok((await create(projectId, values({ title: "Active" }))).ok);
    assert.ok(
      (await create(projectId, values({ title: "Archivee", status: PROJECT_MEMORY_STATUS.ARCHIVED })))
        .ok,
    );

    const active = await listActiveProjectMemories(db, projectId);
    assert.equal(active.length, 1);
    assert.equal(active[0]?.title, "Active");
  });

  it("ne melange jamais deux projets", async () => {
    const a = await newProject();
    const b = await newProject();
    assert.ok((await create(a, values({ title: "A" }))).ok);
    assert.ok((await create(b, values({ title: "B" }))).ok);

    const entries = await listProjectMemories(db, a);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.title, "A");
  });
});

describe("modification", () => {
  it("ne change ni le code, ni le projet", async () => {
    const projectId = await newProject();
    const created = await create(projectId, values());
    assert.ok(created.ok);

    const updated = await updateProjectMemory(db, {
      memoryId: created.entry.id,
      values: values({
        category: PROJECT_MEMORY_CATEGORY.CONVENTION,
        title: "Autre titre",
        content: "Autre contenu.",
        rationale: "Une justification.",
      }),
      sanitize: IDENTITY,
    });

    assert.ok(updated.ok);
    assert.equal(updated.entry.code, created.entry.code);
    assert.equal(updated.entry.projectId, projectId);
    assert.equal(updated.entry.category, PROJECT_MEMORY_CATEGORY.CONVENTION);
    assert.equal(updated.entry.rationale, "Une justification.");
  });

  it("archive puis restaure sans toucher au texte", async () => {
    const projectId = await newProject();
    const created = await create(projectId, values({ content: "Texte d'origine." }));
    assert.ok(created.ok);

    const archived = await setProjectMemoryStatus(db, {
      memoryId: created.entry.id,
      status: PROJECT_MEMORY_STATUS.ARCHIVED,
      sanitize: IDENTITY,
    });
    assert.ok(archived.ok);
    assert.equal(archived.entry.status, PROJECT_MEMORY_STATUS.ARCHIVED);
    assert.equal(archived.entry.content, "Texte d'origine.");

    const restored = await setProjectMemoryStatus(db, {
      memoryId: created.entry.id,
      status: PROJECT_MEMORY_STATUS.ACTIVE,
      sanitize: IDENTITY,
    });
    assert.ok(restored.ok);
    assert.equal(restored.entry.status, PROJECT_MEMORY_STATUS.ACTIVE);
    assert.equal(restored.entry.content, "Texte d'origine.");
  });

  it("refuse une entree inconnue", async () => {
    const updated = await updateProjectMemory(db, {
      memoryId: "memoire-inexistante",
      values: values(),
      sanitize: IDENTITY,
    });
    assert.ok(!updated.ok);
    assert.equal(updated.reason, "not_found");
  });
});

describe("suppression", () => {
  it("supprime une entree, sans rendre son numero", async () => {
    const projectId = await newProject();
    const first = await create(projectId, values({ title: "Premiere" }));
    const second = await create(projectId, values({ title: "Seconde" }));
    assert.ok(first.ok);
    assert.ok(second.ok);

    assert.equal(await deleteProjectMemory(db, second.entry.id), true);
    assert.equal(await getProjectMemory(db, second.entry.id), null);

    // Le compteur ne recule pas : la suivante prend MEM-003, jamais MEM-002.
    const third = await create(projectId, values({ title: "Troisieme" }));
    assert.ok(third.ok);
    assert.equal(third.entry.code, "MEM-003");
  });

  it("retourne faux pour une entree deja absente", async () => {
    assert.equal(await deleteProjectMemory(db, "memoire-inexistante"), false);
  });

  it("libere le budget", async () => {
    const projectId = await newProject();
    const entry = await create(projectId, sized(PROJECT_MEMORY_LIMITS.activeChars));
    assert.ok(entry.ok);

    await deleteProjectMemory(db, entry.entry.id);
    const stats = await projectMemoryStats(db, projectId, IDENTITY);
    assert.equal(stats.activeChars, 0);
  });
});

describe("suppression d'un projet", () => {
  it("emporte sa memoire", async () => {
    const projectId = await newProject();
    const created = await create(projectId, values());
    assert.ok(created.ok);

    await db.project.delete({ where: { id: projectId } });

    assert.equal(await getProjectMemory(db, created.entry.id), null);
    assert.equal((await listProjectMemories(db, projectId)).length, 0);
  });
});
