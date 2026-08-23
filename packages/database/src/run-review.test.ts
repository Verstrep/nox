/**
 * Tests de la persistance d'une review.
 *
 * Base temporaire, isolee, detruite a la fin : la base de developpement n'est
 * jamais ouverte par ces tests. Le package compile est importe volontairement —
 * c'est l'artefact que le web et le runner consomment reellement.
 *
 * Le test central de ce fichier est celui de l'immuabilite : une review qui se
 * laisserait reecrire ne serait plus une review, mais une vue du present.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  InvalidRunReviewRecordError,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  getRunReview,
  hasRunReview,
  markRunReviewFailed,
  saveRunReview,
  seedRunValidations,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
} from "../dist/index.js";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma",
  "migrations",
);

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

/** Cree un projet, une tache et une execution neuve. */
async function newRun(validationCommands: string[] = []): Promise<{ runId: string }> {
  counter += 1;
  const suffix = String(counter).padStart(12, "0");

  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });

  const task = await createTask(db, {
    projectId: project.id,
    title: "Une tache",
    objective: "Un objectif.",
    context: null,
    outOfScope: null,
    priority: "MEDIUM",
    acceptanceCriteria: ["Un critere."],
    documentReferences: [],
    validationCommands,
  });
  assert.ok(task !== null);

  const created = await createRun(db, {
    projectId: project.id,
    taskId: task.id,
    prompt: "Prompt.",
    promptSha256: "a".repeat(64),
    runnerRunId: `3f2504e0-4f89-41d3-9a0c-${suffix}`,
  });
  assert.ok(created.ok);

  return { runId: created.run.id };
}

function fileChange(position: number, overrides: Record<string, unknown> = {}) {
  return {
    position,
    path: `apps/web/lib/file-${String(position)}.ts`,
    previousPath: null,
    changeType: "MODIFIED" as const,
    additions: 3,
    deletions: 1,
    isBinary: false,
    isSensitive: false,
    isTruncated: false,
    patch: `@@ -1 +1 @@\n-avant ${String(position)}\n+apres ${String(position)}\n`,
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    capturedAt: "2026-08-07T12:00:00.000Z",
    headBefore: "a".repeat(40),
    unreliable: false,
    files: [fileChange(0)],
    omittedFiles: 0,
    validations: [],
    workspace: { value: "f".repeat(64), version: "v1", errorCode: null },
    ...overrides,
  };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-run-review-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));

  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("seedRunValidations", () => {
  it("recopie les commandes attendues, en attente", async () => {
    const { runId } = await newRun();

    const inserted = await seedRunValidations(db, runId, ["npm run test", "npm run lint"]);
    assert.equal(inserted, 2);

    const review = await getRunReview(db, runId);
    assert.deepEqual(
      review?.validations.map((entry) => [entry.position, entry.command, entry.status]),
      [
        [0, "npm run test", "NOT_RUN"],
        [1, "npm run lint", "NOT_RUN"],
      ],
    );
  });

  it("n'ecrit rien pour une tache sans commande", async () => {
    const { runId } = await newRun();

    assert.equal(await seedRunValidations(db, runId, []), 0);
    assert.deepEqual((await getRunReview(db, runId))?.validations, []);
  });

  it("ne recopie qu'une fois", async () => {
    const { runId } = await newRun();

    await seedRunValidations(db, runId, ["npm run test"]);
    const again = await seedRunValidations(db, runId, ["npm run build", "npm run lint"]);

    assert.equal(again, 0);
    const review = await getRunReview(db, runId);
    assert.equal(review?.validations.length, 1);
    assert.equal(review?.validations[0]?.command, "npm run test");
  });

  it("accepte deux positions portant la meme commande", async () => {
    const { runId } = await newRun();

    await seedRunValidations(db, runId, ["npm run test", "npm run test"]);

    const review = await getRunReview(db, runId);
    assert.equal(review?.validations.length, 2);
    assert.deepEqual(
      review?.validations.map((entry) => entry.position),
      [0, 1],
    );
  });
});

describe("saveRunReview", () => {
  it("enregistre les fichiers dans un ordre stable", async () => {
    const { runId } = await newRun();

    const saved = await saveRunReview(
      db,
      runId,
      snapshot({ files: [fileChange(0), fileChange(1), fileChange(2)] }),
    );
    assert.equal(saved, true);

    const review = await getRunReview(db, runId);
    assert.deepEqual(
      review?.files.map((file) => file.position),
      [0, 1, 2],
    );
    assert.deepEqual(
      review?.files.map((file) => file.path),
      [
        "apps/web/lib/file-0.ts",
        "apps/web/lib/file-1.ts",
        "apps/web/lib/file-2.ts",
      ],
    );
  });

  it("distingue une review vide d'une review absente", async () => {
    const vide = await newRun();
    const absente = await newRun();

    await saveRunReview(db, vide.runId, snapshot({ files: [] }));

    const capturee = await getRunReview(db, vide.runId);
    const jamais = await getRunReview(db, absente.runId);

    // Les deux ont zero fichier, et ne disent pourtant pas la meme chose :
    // « l'agent n'a rien modifie » contre « NOX ne sait pas ».
    assert.deepEqual(capturee?.files, []);
    assert.notEqual(capturee?.capturedAt, null);
    assert.deepEqual(jamais?.files, []);
    assert.equal(jamais?.capturedAt, null);
  });

  it("refuse de reecrire une review deja capturee", async () => {
    const { runId } = await newRun();

    await saveRunReview(db, runId, snapshot({ files: [fileChange(0)] }));
    const again = await saveRunReview(
      db,
      runId,
      snapshot({
        capturedAt: "2026-09-01T00:00:00.000Z",
        files: [fileChange(0, { path: "AUTRE.md", patch: "+ecrase" })],
      }),
    );

    assert.equal(again, false);
    const review = await getRunReview(db, runId);
    assert.equal(review?.files.length, 1);
    assert.equal(review?.files[0]?.path, "apps/web/lib/file-0.ts");
    assert.equal(review?.capturedAt, "2026-08-07T12:00:00.000Z");
  });

  it("met a jour les validations sans recreer leurs lignes", async () => {
    const { runId } = await newRun();
    await seedRunValidations(db, runId, ["npm run test", "npm run build"]);

    await saveRunReview(
      db,
      runId,
      snapshot({
        validations: [
          {
            position: 0,
            command: "npm run test",
            status: "PASSED",
            exitCode: 0,
            summary: "tout passe",
            startedAt: "2026-08-07T11:59:00.000Z",
            finishedAt: "2026-08-07T11:59:30.000Z",
          },
          {
            position: 1,
            command: "npm run build",
            status: "NOT_RUN",
            exitCode: null,
            summary: null,
            startedAt: null,
            finishedAt: null,
          },
        ],
      }),
    );

    const review = await getRunReview(db, runId);
    assert.equal(review?.validations.length, 2);
    assert.equal(review?.validations[0]?.status, "PASSED");
    assert.equal(review?.validations[0]?.exitCode, 0);
    assert.equal(review?.validations[0]?.summary, "tout passe");
    assert.equal(review?.validations[1]?.status, "NOT_RUN");
  });

  it("conserve les marques binaire, sensible et tronque", async () => {
    const { runId } = await newRun();

    await saveRunReview(
      db,
      runId,
      snapshot({
        files: [
          fileChange(0, { path: "logo.png", isBinary: true, patch: null, additions: null, deletions: null }),
          fileChange(1, { path: ".env", isSensitive: true, patch: null }),
          fileChange(2, { path: "gros.txt", isTruncated: true }),
        ],
      }),
    );

    const review = await getRunReview(db, runId);
    assert.equal(review?.files[0]?.isBinary, true);
    assert.equal(review?.files[0]?.patch, null);
    assert.equal(review?.files[1]?.isSensitive, true);
    assert.equal(review?.files[2]?.isTruncated, true);
  });

  it("n'ecrit jamais le patch d'un fichier sensible, meme si on le lui donne", async () => {
    const { runId } = await newRun();

    await saveRunReview(
      db,
      runId,
      snapshot({
        files: [fileChange(0, { path: ".env", isSensitive: true, patch: "+SECRET=valeur" })],
      }),
    );

    // La derniere barriere est ici, juste avant l'ecriture : elle ne fait pas
    // confiance a l'appelant, meme quand l'appelant est le runner.
    const review = await getRunReview(db, runId);
    assert.equal(review?.files[0]?.patch, null);
  });

  it("conserve le chemin d'origine d'un renommage", async () => {
    const { runId } = await newRun();

    await saveRunReview(
      db,
      runId,
      snapshot({
        files: [
          fileChange(0, {
            path: "nouveau.md",
            previousPath: "ancien.md",
            changeType: "RENAMED",
          }),
        ],
      }),
    );

    const review = await getRunReview(db, runId);
    assert.equal(review?.files[0]?.changeType, "RENAMED");
    assert.equal(review?.files[0]?.previousPath, "ancien.md");
  });

  it("enregistre le nombre de fichiers omis", async () => {
    const { runId } = await newRun();

    await saveRunReview(db, runId, snapshot({ omittedFiles: 42 }));

    assert.equal((await getRunReview(db, runId))?.omittedFiles, 42);
  });

  it("borne un patch demesure", async () => {
    const { runId } = await newRun();

    await saveRunReview(
      db,
      runId,
      snapshot({ files: [fileChange(0, { patch: "x".repeat(500_000) })] }),
    );

    const review = await getRunReview(db, runId);
    assert.ok((review?.files[0]?.patch?.length ?? 0) <= 262_144);
  });

  it("ne fait rien pour une execution inconnue", async () => {
    assert.equal(await saveRunReview(db, "run-qui-n-existe-pas", snapshot()), false);
  });

  it("tolere une date de capture illisible", async () => {
    const { runId } = await newRun();

    await saveRunReview(db, runId, snapshot({ capturedAt: "pas une date" }));

    // La capture a bien eu lieu : c'est cela qui compte, pas l'horodatage.
    assert.equal(await hasRunReview(db, runId), true);
  });
});

describe("markRunReviewFailed", () => {
  it("enregistre un echec de capture", async () => {
    const { runId } = await newRun();

    assert.equal(await markRunReviewFailed(db, runId, "CLAUDE_REVIEW_FAILED"), true);

    const review = await getRunReview(db, runId);
    assert.equal(review?.errorCode, "CLAUDE_REVIEW_FAILED");
    // Un echec de review n'est pas une review : la date reste nulle.
    assert.equal(review?.capturedAt, null);
  });

  it("n'efface pas une review deja capturee", async () => {
    const { runId } = await newRun();
    await saveRunReview(db, runId, snapshot());

    assert.equal(await markRunReviewFailed(db, runId, "CLAUDE_REVIEW_FAILED"), false);

    const review = await getRunReview(db, runId);
    assert.equal(review?.errorCode, null);
    assert.notEqual(review?.capturedAt, null);
  });

  it("ne fait rien pour une execution inconnue", async () => {
    assert.equal(await markRunReviewFailed(db, "inexistant", "CLAUDE_REVIEW_FAILED"), false);
  });
});

describe("getRunReview", () => {
  it("rend null pour une execution inconnue", async () => {
    assert.equal(await getRunReview(db, "inexistant"), null);
  });

  it("lit une review complete en une fois", async () => {
    const { runId } = await newRun();
    await seedRunValidations(db, runId, ["npm run test"]);
    await saveRunReview(
      db,
      runId,
      snapshot({
        files: [fileChange(0), fileChange(1)],
        omittedFiles: 3,
        validations: [
          {
            position: 0,
            command: "npm run test",
            status: "FAILED",
            exitCode: 1,
            summary: "un test casse",
            startedAt: null,
            finishedAt: null,
          },
        ],
      }),
    );

    const review = await getRunReview(db, runId);

    assert.equal(review?.files.length, 2);
    assert.equal(review?.validations.length, 1);
    assert.equal(review?.omittedFiles, 3);
    assert.equal(review?.errorCode, null);
    assert.notEqual(review?.capturedAt, null);
  });

  it("refuse une ligne dont le type de changement est inconnu", async () => {
    const { runId } = await newRun();
    await saveRunReview(db, runId, snapshot());

    const sqlite = new DatabaseSync(path.join(workspace, "test.db"));
    try {
      sqlite.exec(
        `UPDATE RunFileChange SET changeType = 'REWRITTEN' WHERE runId = '${runId}'`,
      );
    } finally {
      sqlite.close();
    }

    await assert.rejects(() => getRunReview(db, runId), InvalidRunReviewRecordError);
  });
});

describe("hasRunReview", () => {
  it("distingue capturee, echouee et jamais tentee", async () => {
    const capturee = await newRun();
    const echouee = await newRun();
    const jamais = await newRun();

    await saveRunReview(db, capturee.runId, snapshot());
    await markRunReviewFailed(db, echouee.runId, "CLAUDE_REVIEW_FAILED");

    assert.equal(await hasRunReview(db, capturee.runId), true);
    assert.equal(await hasRunReview(db, echouee.runId), false);
    assert.equal(await hasRunReview(db, jamais.runId), false);
  });

  it("rend faux pour une execution inconnue", async () => {
    assert.equal(await hasRunReview(db, "inexistant"), false);
  });
});
