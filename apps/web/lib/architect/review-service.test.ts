/**
 * Tests de l'orchestration d'une analyse de review.
 *
 * Base temporaire, faux fournisseur : **aucun appel reseau, aucun quota
 * consomme**. Ce qui est verifie ici, c'est l'enchainement — ce qui est reserve,
 * ce qui est appele, ce qui est enregistre — et surtout ce qui ne l'est pas.
 *
 * Le test le plus important du fichier est celui de la garde : un fournisseur
 * qui recommande une approbation alors qu'une partie de la review lui etait
 * invisible ne doit jamais obtenir cette approbation.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHITECT_ERROR,
  ARCHITECT_REVIEW_LIMITS,
  ARCHITECT_REVIEW_SCHEMA_NAME,
  ARCHITECT_REVIEW_STATUS,
  ARCHITECT_REVIEW_VERDICT,
  type DevelopmentTaskDetail,
  type RunFileChange,
  type RunValidationResultView,
} from "@nox/shared";
import {
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  listArchitectRunReviews,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
} from "@nox/database";

import { FakeArchitectProvider, type ArchitectProviderResult } from "./provider.ts";
import type { ArchitectReviewRun, ArchitectReviewSnapshot } from "./review-bundle.ts";
import { prepareArchitectReview } from "./review-prepare.ts";
import { analyzeArchitectReview } from "./review-service.ts";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "packages",
  "database",
  "prisma",
  "migrations",
);

let workspace: string;
let db: DatabaseClient;
let counter = 0;

const ENVIRONMENT: Record<string, string | undefined> = {
  NOX_OPENAI_API_KEY: "cle-architecte-de-test-9876543210",
  NOX_RUNNER_TOKEN: "jeton-runner-de-test-0123456789",
};

const MODEL = "modele-de-test";

function reviewJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    verdict: ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED,
    summary: "Le filtre est en place et la validation passe.",
    findings: [],
    feedback: null,
    ...overrides,
  };
}

function success(raw: unknown): ArchitectProviderResult {
  return {
    ok: true,
    value: {
      raw,
      responseId: "resp_review",
      usage: {
        inputTokens: 3_200,
        outputTokens: 180,
        totalTokens: 3_380,
        cachedInputTokens: 1_024,
      },
    },
  };
}

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

function file(overrides: Partial<RunFileChange> = {}): RunFileChange {
  return {
    position: 0,
    path: "front/js/recettes.js",
    previousPath: null,
    changeType: "MODIFIED",
    additions: 12,
    deletions: 3,
    isBinary: false,
    isSensitive: false,
    isTruncated: false,
    patch: "@@ -1,3 +1,12 @@\n-const a = 1;\n+const a = 2;\n",
    ...overrides,
  };
}

function validation(overrides: Partial<RunValidationResultView> = {}): RunValidationResultView {
  return {
    position: 0,
    command: "npm run test",
    status: "PASSED",
    exitCode: 0,
    summary: "42 tests, 0 echec",
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ArchitectReviewSnapshot> = {}): ArchitectReviewSnapshot {
  return {
    capturedAt: "2026-08-11T09:00:00.000Z",
    errorCode: null,
    omittedFiles: 0,
    files: [file()],
    validations: [validation()],
    ...overrides,
  };
}

const RUN: ArchitectReviewRun = {
  code: "RUN-001",
  kind: "INITIAL",
  parentRunCode: null,
  status: "COMPLETED",
  durationMs: 120_000,
  headBefore: "19ab8c3f2d41aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  headAfter: "19ab8c3f2d41aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  errorCode: null,
};

/** Cree un projet, une tache et une execution neuve, tous isoles. */
async function newRun(): Promise<{ runId: string; task: DevelopmentTaskDetail }> {
  counter += 1;
  const suffix = String(counter).padStart(12, "0");

  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });

  const task = await createTask(db, {
    projectId: project.id,
    title: "Filtrer les recettes",
    objective: "Retrouver une recette sans defiler.",
    context: null,
    outOfScope: null,
    priority: "MEDIUM",
    acceptanceCriteria: ["Un champ filtre la liste.", "Le filtre ignore la casse."],
    documentReferences: [],
    validationCommands: ["npm run test"],
  });
  assert.ok(task !== null);

  const created = await createRun(db, {
    projectId: task.projectId,
    taskId: task.id,
    prompt: "Prompt.",
    promptSha256: "a".repeat(64),
    runnerRunId: `3f2504e0-4f89-41d3-9a0c-${suffix}`,
  });
  assert.ok(created.ok);

  return { runId: created.run.id, task };
}

type AnalyzeOptions = {
  review?: ArchitectReviewSnapshot;
  run?: ArchitectReviewRun;
  expectedInputHash?: string;
};

/** Prepare puis analyse, avec l'empreinte reelle sauf mention contraire. */
async function analyze(
  provider: FakeArchitectProvider,
  context: { runId: string; task: DevelopmentTaskDetail },
  options: AnalyzeOptions = {},
) {
  const review = options.review ?? snapshot();
  const run = options.run ?? RUN;

  const input = {
    runId: context.runId,
    task: context.task,
    run,
    review,
    repositoryPath: path.join(workspace, "depot"),
    model: MODEL,
    environment: ENVIRONMENT,
  };

  const prepared = prepareArchitectReview(input);

  return analyzeArchitectReview(db, {
    ...input,
    provider,
    expectedInputHash: options.expectedInputHash ?? prepared.inputHash,
  });
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-architect-review-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));

  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("analyzeArchitectReview", () => {
  it("enregistre une analyse complete et conserve la consommation", async () => {
    const context = await newRun();
    const provider = new FakeArchitectProvider([success(reviewJson())]);

    const outcome = await analyze(provider, context);
    assert.ok(outcome.ok);
    assert.equal(outcome.analysis.status, ARCHITECT_REVIEW_STATUS.COMPLETED);
    assert.equal(outcome.analysis.sequence, 1);
    assert.equal(outcome.analysis.code, "ANALYSIS-1");
    assert.equal(outcome.analysis.model, MODEL);
    assert.equal(outcome.analysis.usage.totalTokens, 3_380);
    assert.equal(outcome.analysis.providerResponseId, "resp_review");
  });

  it("n'appelle le fournisseur que par `analyzeRunReview`", async () => {
    const context = await newRun();
    const provider = new FakeArchitectProvider([success(reviewJson())]);

    await analyze(provider, context);

    assert.equal(provider.reviewCalls.length, 1);
    assert.equal(provider.turnCalls.length, 0);
  });

  it("transmet le schema de review, et rien d'autre", async () => {
    const context = await newRun();
    const provider = new FakeArchitectProvider([success(reviewJson())]);

    await analyze(provider, context);

    const call = provider.reviewCalls[0];
    assert.ok(call !== undefined);
    assert.equal(call.schemaName, ARCHITECT_REVIEW_SCHEMA_NAME);
    assert.equal(call.model, MODEL);
    // Aucun outil : ni dans l'entree, ni dans le schema, ni nulle part.
    assert.ok(!Object.hasOwn(call, "tools"));
    assert.ok(!Object.hasOwn(call, "previous_response_id"));
    assert.ok(!Object.hasOwn(call, "conversation"));
    assert.ok(!Object.hasOwn(call, "background"));
    assert.ok(!Object.hasOwn(call, "store"));
  });

  it("n'envoie ni cle, ni chemin absolu, ni compte rendu de Claude", async () => {
    const context = await newRun();
    const provider = new FakeArchitectProvider([success(reviewJson())]);

    await analyze(provider, context);

    const call = provider.reviewCalls[0];
    assert.ok(call !== undefined);
    const whole = `${call.instructions}\n${call.input}`;
    assert.ok(!whole.includes(ENVIRONMENT["NOX_OPENAI_API_KEY"] ?? "impossible"));
    assert.ok(!whole.includes(ENVIRONMENT["NOX_RUNNER_TOKEN"] ?? "impossible"));
    assert.ok(!whole.includes("NOX_"));
    assert.ok(!/[A-Za-z]:[\\/]/u.test(whole));
  });

  it("conserve les deux verdicts quand la garde ne change rien", async () => {
    const context = await newRun();
    const provider = new FakeArchitectProvider([success(reviewJson())]);

    const outcome = await analyze(provider, context);
    assert.ok(outcome.ok);
    assert.equal(outcome.analysis.providerVerdict, ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED);
    assert.equal(outcome.analysis.finalVerdict, ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED);
    assert.deepEqual(outcome.analysis.blockers, []);
  });

  it("degrade une approbation quand un fichier sensible a change", async () => {
    const context = await newRun();
    const provider = new FakeArchitectProvider([success(reviewJson())]);

    const outcome = await analyze(provider, context, {
      review: snapshot({ files: [file({ path: ".env", isSensitive: true, patch: null })] }),
    });
    assert.ok(outcome.ok);
    assert.equal(outcome.analysis.providerVerdict, ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED);
    assert.equal(outcome.analysis.finalVerdict, ARCHITECT_REVIEW_VERDICT.HUMAN_REVIEW_REQUIRED);
    assert.ok(outcome.analysis.blockers.includes("SENSITIVE_FILE"));
  });

  it("degrade une approbation quand une validation a echoue", async () => {
    const context = await newRun();
    const provider = new FakeArchitectProvider([success(reviewJson())]);

    const outcome = await analyze(provider, context, {
      review: snapshot({ validations: [validation({ status: "FAILED", exitCode: 1 })] }),
    });
    assert.ok(outcome.ok);
    assert.notEqual(outcome.analysis.finalVerdict, ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED);
  });

  it("degrade une approbation quand l'execution n'est pas terminee normalement", async () => {
    const context = await newRun();
    const provider = new FakeArchitectProvider([success(reviewJson())]);

    const outcome = await analyze(provider, context, { run: { ...RUN, status: "CANCELLED" } });
    assert.ok(outcome.ok);
    assert.equal(outcome.analysis.finalVerdict, ARCHITECT_REVIEW_VERDICT.HUMAN_REVIEW_REQUIRED);
  });

  it("conserve des corrections recommandees malgre un fait bloquant", async () => {
    const context = await newRun();
    const provider = new FakeArchitectProvider([
      success(
        reviewJson({
          verdict: ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED,
          feedback: "Corrige la comparaison de casse dans front/js/recettes.js.",
          findings: [
            {
              severity: "BLOCKER",
              title: "AC2 non satisfait",
              detail: "La comparaison reste sensible a la casse.",
              filePath: "front/js/recettes.js",
              acceptanceCriterionIndex: 2,
            },
          ],
        }),
      ),
    ]);

    const outcome = await analyze(provider, context, {
      review: snapshot({
        files: [file(), file({ position: 1, path: "assets/logo.png", isBinary: true, patch: null })],
      }),
    });
    assert.ok(outcome.ok);
    assert.equal(outcome.analysis.finalVerdict, ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED);
    assert.ok(outcome.analysis.blockers.includes("BINARY_FILE"));
    assert.equal(outcome.analysis.findings.length, 1);
    assert.equal(outcome.analysis.feedback, "Corrige la comparaison de casse dans front/js/recettes.js.");
  });

  it("refuse une reponse designant un fichier absent de la review", async () => {
    const context = await newRun();
    const provider = new FakeArchitectProvider([
      success(
        reviewJson({
          findings: [
            {
              severity: "MINOR",
              title: "Un fichier invente",
              detail: "Ce fichier n'existe pas.",
              filePath: "src/jamais-vu.ts",
              acceptanceCriterionIndex: null,
            },
          ],
        }),
      ),
    ]);

    const outcome = await analyze(provider, context);
    assert.ok(!outcome.ok);
    assert.equal(outcome.code, ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID);

    // L'analyse est conclue en echec : le verrou n'est jamais laisse pose.
    const analyses = await listArchitectRunReviews(db, context.runId);
    assert.equal(analyses[0]?.status, ARCHITECT_REVIEW_STATUS.FAILED);
    assert.equal(analyses[0]?.errorCode, ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID);
  });

  it("refuse une reponse designant un critere qui n'existe pas", async () => {
    const context = await newRun();
    const provider = new FakeArchitectProvider([
      success(
        reviewJson({
          findings: [
            {
              severity: "MINOR",
              title: "Un critere invente",
              detail: "Il n'y a que deux criteres.",
              filePath: null,
              acceptanceCriterionIndex: 99,
            },
          ],
        }),
      ),
    ]);

    const outcome = await analyze(provider, context);
    assert.ok(!outcome.ok);
    assert.equal(outcome.code, ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID);
  });

  it("enregistre un refus du fournisseur comme tel", async () => {
    const context = await newRun();
    const provider = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_REFUSED },
    ]);

    const outcome = await analyze(provider, context);
    assert.ok(!outcome.ok);

    const analyses = await listArchitectRunReviews(db, context.runId);
    assert.equal(analyses[0]?.status, ARCHITECT_REVIEW_STATUS.REFUSED);
  });

  it("conclut l'analyse meme quand le fournisseur leve", async () => {
    const context = await newRun();
    const provider: FakeArchitectProvider = new FakeArchitectProvider([]);

    const outcome = await analyze(provider, context);
    assert.ok(!outcome.ok);
    assert.equal(outcome.code, ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR);

    const analyses = await listArchitectRunReviews(db, context.runId);
    assert.equal(analyses[0]?.status, ARCHITECT_REVIEW_STATUS.FAILED);
  });

  it("refuse d'envoyer si l'empreinte ne correspond plus a l'apercu", async () => {
    const context = await newRun();
    const provider = new FakeArchitectProvider([success(reviewJson())]);

    const outcome = await analyze(provider, context, { expectedInputHash: "f".repeat(64) });
    assert.ok(!outcome.ok);
    assert.equal(outcome.code, ARCHITECT_ERROR.ARCHITECT_REVIEW_CHANGED);

    // Aucun appel, aucune analyse reservee, aucun quota consomme.
    assert.equal(provider.calls.length, 0);
    assert.deepEqual(await listArchitectRunReviews(db, context.runId), []);
  });

  it("conserve chaque analyse : une nouvelle n'ecrase jamais la precedente", async () => {
    const context = await newRun();

    const first = await analyze(
      new FakeArchitectProvider([
        success(
          reviewJson({
            verdict: ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED,
            feedback: "Corrige X.",
          }),
        ),
      ]),
      context,
    );
    assert.ok(first.ok);

    const second = await analyze(
      new FakeArchitectProvider([
        success(reviewJson({ verdict: ARCHITECT_REVIEW_VERDICT.HUMAN_REVIEW_REQUIRED })),
      ]),
      context,
    );
    assert.ok(second.ok);

    const analyses = await listArchitectRunReviews(db, context.runId);
    assert.equal(analyses.length, 2);
    assert.equal(analyses[0]?.sequence, 2);
    assert.equal(analyses[1]?.sequence, 1);
    assert.equal(analyses[1]?.feedback, "Corrige X.");
  });

  it("refuse au-dela de cinq analyses, echecs compris", async () => {
    const context = await newRun();

    for (let index = 0; index < ARCHITECT_REVIEW_LIMITS.analyses; index += 1) {
      const outcome = await analyze(new FakeArchitectProvider([success(reviewJson())]), context);
      assert.ok(outcome.ok, `analyse ${String(index + 1)}`);
    }

    const provider = new FakeArchitectProvider([success(reviewJson())]);
    const refused = await analyze(provider, context);
    assert.ok(!refused.ok);
    assert.equal(refused.code, ARCHITECT_ERROR.ARCHITECT_REVIEW_LIMIT);
    assert.equal(provider.calls.length, 0);
  });
});

describe("les actions de tache restent hors de portee", () => {
  it("le service d'analyse n'importe aucune fonction d'action", async () => {
    const source = await readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "review-service.ts"),
      "utf8",
    );
    // La garantie n'est pas une intention : ces fonctions ne sont pas
    // atteignables depuis ce module, et un ajout futur ferait echouer ce test.
    for (const forbidden of [
      "updateTaskStatus",
      "createReviewFeedback",
      "startCorrectionFromFeedback",
      "startTaskCorrection",
      "startTaskExecution",
      "createRun",
    ]) {
      assert.ok(!source.includes(forbidden), forbidden);
    }
  });
});
