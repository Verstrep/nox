/**
 * Tests de la persistance des analyses de review.
 *
 * Base temporaire, isolee, detruite a la fin : la base de developpement n'est
 * jamais ouverte par ces tests. Le package compile est importe volontairement —
 * c'est l'artefact que le web consomme reellement.
 *
 * Le test central de ce fichier est celui de l'immuabilite : une analyse qui se
 * laisserait reecrire ne raconterait plus ce que l'architecte avait dit ce
 * jour-la.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  finishArchitectRunReview,
  formatArchitectReviewCode,
  getArchitectReviewSummary,
  getArchitectRunReview,
  listArchitectRunReviews,
  startArchitectRunReview,
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

/** Cinq : la borne de `ARCHITECT_REVIEW_LIMITS.analyses`. */
const MAX_ANALYSES = 5;

let workspace: string;
let db: DatabaseClient;
let counter = 0;

const MANIFEST = {
  schemaVersion: 1 as const,
  runId: "run-1",
  runCode: "RUN-001",
  taskRevision: "a".repeat(64),
  reviewCapturedAt: "2026-08-11T09:00:00.000Z",
  fileCountAvailable: 3,
  fileCountIncluded: 3,
  patchCharsIncluded: 1_024,
  truncated: false,
  validationCount: 1,
};

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

/** Cree un projet, une tache et une execution neuve, tous isoles. */
async function newRun(): Promise<string> {
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
    validationCommands: [],
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

  return created.run.id;
}

async function start(runId: string) {
  return startArchitectRunReview(db, {
    runId,
    model: "modele-de-test",
    promptVersion: "architect-review/1",
    inputHash: "b".repeat(64),
    manifest: { ...MANIFEST, runId },
  });
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-architect-review-db-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));

  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("startArchitectRunReview", () => {
  it("numerote les analyses a partir de 1", async () => {
    const runId = await newRun();

    const first = await start(runId);
    assert.ok(first.ok);
    assert.equal(first.analysis.sequence, 1);
    assert.equal(first.analysis.code, "ANALYSIS-1");
    assert.equal(first.analysis.status, "RUNNING");

    await finishArchitectRunReview(db, {
      analysisId: first.analysis.id,
      status: "COMPLETED",
      providerVerdict: "APPROVE_RECOMMENDED",
      finalVerdict: "APPROVE_RECOMMENDED",
      blockers: [],
      summary: "Rien a signaler.",
      findings: [],
    });

    const second = await start(runId);
    assert.ok(second.ok);
    assert.equal(second.analysis.sequence, 2);
  });

  it("refuse une seconde analyse tant que la premiere tourne", async () => {
    const runId = await newRun();

    const first = await start(runId);
    assert.ok(first.ok);

    const second = await start(runId);
    assert.ok(!second.ok);
    assert.equal(second.reason, "active");
  });

  it("refuse une execution inconnue", async () => {
    const result = await start("run-inexistant");
    assert.ok(!result.ok);
    assert.equal(result.reason, "not_found");
  });

  it("refuse au-dela de cinq analyses, echecs compris", async () => {
    const runId = await newRun();

    for (let index = 0; index < MAX_ANALYSES; index += 1) {
      const started = await start(runId);
      assert.ok(started.ok, `analyse ${String(index + 1)}`);
      await finishArchitectRunReview(db, {
        analysisId: started.analysis.id,
        // Un echec compte : il a joint le fournisseur.
        status: "FAILED",
        errorCode: "ARCHITECT_PROVIDER_ERROR",
      });
    }

    const refused = await start(runId);
    assert.ok(!refused.ok);
    assert.equal(refused.reason, "limit");
  });

  it("ne decremente jamais le compteur, meme apres un echec", async () => {
    const runId = await newRun();

    const started = await start(runId);
    assert.ok(started.ok);
    await finishArchitectRunReview(db, {
      analysisId: started.analysis.id,
      status: "FAILED",
      errorCode: "ARCHITECT_TIMEOUT",
    });

    const next = await start(runId);
    assert.ok(next.ok);
    assert.equal(next.analysis.sequence, 2);
  });

  it("isole les executions les unes des autres", async () => {
    const first = await newRun();
    const second = await newRun();

    const a = await start(first);
    const b = await start(second);
    assert.ok(a.ok);
    assert.ok(b.ok);
    assert.equal(a.analysis.sequence, 1);
    assert.equal(b.analysis.sequence, 1);
    assert.notEqual(a.analysis.id, b.analysis.id);
  });
});

describe("finishArchitectRunReview", () => {
  it("enregistre les deux verdicts, les observations et la consommation", async () => {
    const runId = await newRun();
    const started = await start(runId);
    assert.ok(started.ok);

    const finished = await finishArchitectRunReview(db, {
      analysisId: started.analysis.id,
      status: "COMPLETED",
      providerVerdict: "APPROVE_RECOMMENDED",
      finalVerdict: "HUMAN_REVIEW_REQUIRED",
      blockers: ["BINARY_FILE", "SENSITIVE_FILE"],
      summary: "Le travail semble complet.",
      findings: [
        {
          severity: "NOTE",
          title: "Une observation",
          detail: "Un detail.",
          filePath: null,
          acceptanceCriterionIndex: 1,
        },
      ],
      feedback: null,
      providerResponseId: "resp_1",
      usage: {
        inputTokens: 3_000,
        outputTokens: 200,
        totalTokens: 3_200,
        cachedInputTokens: 1_000,
      },
    });

    assert.ok(finished !== null);
    assert.equal(finished.providerVerdict, "APPROVE_RECOMMENDED");
    assert.equal(finished.finalVerdict, "HUMAN_REVIEW_REQUIRED");
    assert.deepEqual(finished.blockers, ["BINARY_FILE", "SENSITIVE_FILE"]);
    assert.equal(finished.findings.length, 1);
    assert.equal(finished.usage.totalTokens, 3_200);
    assert.equal(finished.providerResponseId, "resp_1");
    assert.deepEqual(finished.manifest, { ...MANIFEST, runId });
    assert.equal(finished.inputHash, "b".repeat(64));
  });

  it("refuse de reecrire une analyse terminee", async () => {
    const runId = await newRun();
    const started = await start(runId);
    assert.ok(started.ok);

    const first = await finishArchitectRunReview(db, {
      analysisId: started.analysis.id,
      status: "COMPLETED",
      providerVerdict: "CHANGES_RECOMMENDED",
      finalVerdict: "CHANGES_RECOMMENDED",
      summary: "Corrige X.",
      feedback: "Corrige X.",
    });
    assert.ok(first !== null);

    const second = await finishArchitectRunReview(db, {
      analysisId: started.analysis.id,
      status: "COMPLETED",
      providerVerdict: "APPROVE_RECOMMENDED",
      finalVerdict: "APPROVE_RECOMMENDED",
      summary: "Finalement tout va bien.",
    });
    assert.equal(second, null);

    const reread = await getArchitectRunReview(db, started.analysis.id);
    assert.equal(reread?.finalVerdict, "CHANGES_RECOMMENDED");
    assert.equal(reread?.summary, "Corrige X.");
  });

  it("refuse une analyse inconnue", async () => {
    const result = await finishArchitectRunReview(db, {
      analysisId: "analyse-inexistante",
      status: "FAILED",
      errorCode: "ARCHITECT_PROVIDER_ERROR",
    });
    assert.equal(result, null);
  });

  it("enregistre un echec avec son code, sans verdict", async () => {
    const runId = await newRun();
    const started = await start(runId);
    assert.ok(started.ok);

    const finished = await finishArchitectRunReview(db, {
      analysisId: started.analysis.id,
      status: "FAILED",
      errorCode: "ARCHITECT_RATE_LIMITED",
    });

    assert.ok(finished !== null);
    assert.equal(finished.errorCode, "ARCHITECT_RATE_LIMITED");
    assert.equal(finished.providerVerdict, null);
    assert.equal(finished.finalVerdict, null);
    assert.deepEqual(finished.findings, []);
  });
});

describe("listArchitectRunReviews", () => {
  it("rend les analyses de la plus recente a la plus ancienne", async () => {
    const runId = await newRun();

    for (let index = 0; index < 3; index += 1) {
      const started = await start(runId);
      assert.ok(started.ok);
      await finishArchitectRunReview(db, {
        analysisId: started.analysis.id,
        status: "COMPLETED",
        providerVerdict: "HUMAN_REVIEW_REQUIRED",
        finalVerdict: "HUMAN_REVIEW_REQUIRED",
        summary: `Analyse ${String(index + 1)}.`,
      });
    }

    const analyses = await listArchitectRunReviews(db, runId);
    assert.deepEqual(
      analyses.map((entry) => entry.sequence),
      [3, 2, 1],
    );
  });

  it("rend une liste vide pour une execution jamais analysee", async () => {
    assert.deepEqual(await listArchitectRunReviews(db, await newRun()), []);
  });
});

describe("getArchitectReviewSummary", () => {
  it("compte les appels consommes et ceux qui restent", async () => {
    const runId = await newRun();

    const empty = await getArchitectReviewSummary(db, runId);
    assert.equal(empty.latest, null);
    assert.equal(empty.count, 0);
    assert.equal(empty.analysesLeft, MAX_ANALYSES);
    assert.equal(empty.active, false);

    const started = await start(runId);
    assert.ok(started.ok);

    const running = await getArchitectReviewSummary(db, runId);
    assert.equal(running.active, true);
    assert.equal(running.count, 1);
    assert.equal(running.analysesLeft, MAX_ANALYSES - 1);

    await finishArchitectRunReview(db, {
      analysisId: started.analysis.id,
      status: "COMPLETED",
      providerVerdict: "APPROVE_RECOMMENDED",
      finalVerdict: "APPROVE_RECOMMENDED",
      summary: "Rien a signaler.",
    });

    const done = await getArchitectReviewSummary(db, runId);
    assert.equal(done.active, false);
    assert.equal(done.latest?.finalVerdict, "APPROVE_RECOMMENDED");
  });
});

describe("formatArchitectReviewCode", () => {
  it("derive le code du numero", () => {
    assert.equal(formatArchitectReviewCode(1), "ANALYSIS-1");
    assert.equal(formatArchitectReviewCode(5), "ANALYSIS-5");
  });
});
