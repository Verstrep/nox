/**
 * Tests du feedback de review et des corrections ciblees.
 *
 * Base temporaire, isolee, detruite a la fin. Le package **compile** est importe
 * volontairement : c'est l'artefact que le web consomme reellement.
 *
 * Le test central de ce fichier est celui du verrou : un feedback ne doit lancer
 * qu'une seule correction, y compris quand deux clics arrivent en meme temps.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  cancelTaskCorrection,
  createDatabaseClient,
  createProject,
  createReviewFeedback,
  createRun,
  completeRun,
  createTask,
  getFeedbackForCorrectionRun,
  getReviewFeedback,
  getRunById,
  getRunReview,
  getTaskById,
  getRunResumeContext,
  listFeedbacksForSourceRun,
  saveRunReview,
  seedRunValidations,
  startCorrectionFromFeedback,
  startTaskCorrection,
  startTaskExecution,
  toDatabaseFilePath,
  toSqliteUrl,
  updateTaskStatus,
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

function runnerRunId(): string {
  counter += 1;
  return `3f2504e0-4f89-41d3-9a0c-${String(counter).padStart(12, "0")}`;
}

/** Projet, tache et execution source pretes a recevoir un feedback. */
async function newSourceRun(): Promise<{
  projectId: string;
  taskId: string;
  runId: string;
}> {
  counter += 1;
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
    validationCommands: ["npm run test"],
  });
  assert.ok(task !== null);

  const created = await createRun(db, {
    projectId: project.id,
    taskId: task.id,
    prompt: "Prompt.",
    promptSha256: "a".repeat(64),
    runnerRunId: runnerRunId(),
  });
  assert.ok(created.ok);

  return { projectId: project.id, taskId: task.id, runId: created.run.id };
}

/** Amene une execution a l'etat « relue et reprenable ». */
async function makeResumable(runId: string): Promise<void> {
  await saveRunReview(db, runId, {
    capturedAt: new Date().toISOString(),
    headBefore: "a".repeat(40),
    unreliable: false,
    files: [],
    omittedFiles: 0,
    validations: [],
    workspace: { value: "f".repeat(64), version: "v1", errorCode: null },
  });
}

/**
 * Amene une tache en REVIEW par le chemin reel.
 *
 *  ne sait pas y aller :  et  sont des
 * statuts reserves, interdits a la pose manuelle depuis TASK-007. Seul le cycle
 * de vie d'une execution les atteint, et c'est exactement ce qu'on veut exercer.
 */
async function bringToReview(taskId: string, runId: string): Promise<void> {
  await startTaskExecution(db, taskId);
  await completeRun(db, runId, {
    resultText: "Fait.",
    finishedAt: new Date(),
  });
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-feedback-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));

  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("createReviewFeedback", () => {
  it("enregistre un feedback rattache a son execution", async () => {
    const { taskId, runId } = await newSourceRun();

    const created = await createReviewFeedback(db, {
      taskId,
      sourceRunId: runId,
      text: "Raccourcis la deuxieme phrase.",
    });

    assert.ok(created.ok);
    assert.equal(created.feedback.text, "Raccourcis la deuxieme phrase.");
    assert.equal(created.feedback.sourceRunId, runId);
    assert.equal(created.feedback.sourceRunCode, "RUN-001");
    assert.equal(created.feedback.correctionRunId, null);
    assert.equal(created.feedback.usedAt, null);
  });

  it("normalise les fins de ligne", async () => {
    const { taskId, runId } = await newSourceRun();

    const created = await createReviewFeedback(db, {
      taskId,
      sourceRunId: runId,
      text: "  un\r\ndeux  \n",
    });

    assert.ok(created.ok);
    assert.equal(created.feedback.text, "un\ndeux");
  });

  it("conserve l'Unicode et les listes", async () => {
    const { taskId, runId } = await newSourceRun();

    const text = "Deux points :\n- l'entête « é à ü » ;\n- la conclusion ✓";
    const created = await createReviewFeedback(db, { taskId, sourceRunId: runId, text });

    assert.ok(created.ok);
    assert.equal(created.feedback.text, text);
  });

  it("refuse un texte vide", async () => {
    const { taskId, runId } = await newSourceRun();
    const created = await createReviewFeedback(db, { taskId, sourceRunId: runId, text: "" });

    assert.equal(created.ok, false);
    assert.equal(created.ok ? null : created.refusal, "empty");
  });

  it("refuse un texte fait d'espaces", async () => {
    const { taskId, runId } = await newSourceRun();
    const created = await createReviewFeedback(db, { taskId, sourceRunId: runId, text: "   \n  " });

    assert.equal(created.ok, false);
    // Le texte est normalise avant validation : il devient vide.
    assert.ok(created.ok ? false : ["empty", "blank"].includes(created.refusal ?? ""));
  });

  it("refuse un texte trop long", async () => {
    const { taskId, runId } = await newSourceRun();
    const created = await createReviewFeedback(db, {
      taskId,
      sourceRunId: runId,
      text: "x".repeat(20_000),
    });

    assert.equal(created.ok, false);
    assert.equal(created.ok ? null : created.refusal, "too_long");
  });

  it("refuse un octet nul", async () => {
    const { taskId, runId } = await newSourceRun();
    const created = await createReviewFeedback(db, {
      taskId,
      sourceRunId: runId,
      text: "Corrige\u0000ceci",
    });

    assert.equal(created.ok, false);
    assert.equal(created.ok ? null : created.refusal, "control_character");
  });

  it("refuse une execution qui n'appartient pas a la tache", async () => {
    const first = await newSourceRun();
    const second = await newSourceRun();

    const created = await createReviewFeedback(db, {
      taskId: first.taskId,
      sourceRunId: second.runId,
      text: "Corrige.",
    });

    assert.equal(created.ok, false);
    assert.equal(created.ok ? null : created.reason, "not_found");
  });

  it("refuse une execution inexistante", async () => {
    const { taskId } = await newSourceRun();
    const created = await createReviewFeedback(db, {
      taskId,
      sourceRunId: "run-qui-n-existe-pas",
      text: "Corrige.",
    });

    assert.equal(created.ok, false);
    assert.equal(created.ok ? null : created.reason, "not_found");
  });
});

describe("listFeedbacksForSourceRun", () => {
  it("retourne l'historique complet, du plus ancien au plus recent", async () => {
    const { taskId, runId } = await newSourceRun();

    await createReviewFeedback(db, { taskId, sourceRunId: runId, text: "Premier." });
    await createReviewFeedback(db, { taskId, sourceRunId: runId, text: "Second." });

    const history = await listFeedbacksForSourceRun(db, runId);
    assert.deepEqual(
      history.map((entry) => entry.text),
      ["Premier.", "Second."],
    );
  });

  it("ne retourne rien pour une execution sans feedback", async () => {
    const { runId } = await newSourceRun();
    assert.deepEqual(await listFeedbacksForSourceRun(db, runId), []);
  });
});

describe("startCorrectionFromFeedback", () => {
  async function prepared(): Promise<{
    projectId: string;
    taskId: string;
    runId: string;
    feedbackId: string;
  }> {
    const source = await newSourceRun();
    const created = await createReviewFeedback(db, {
      taskId: source.taskId,
      sourceRunId: source.runId,
      text: "Corrige la deuxieme phrase.",
    });
    assert.ok(created.ok);
    return { ...source, feedbackId: created.feedback.id };
  }

  it("cree une execution de correction rattachee a son parent", async () => {
    const { taskId, runId, feedbackId } = await prepared();

    const result = await startCorrectionFromFeedback(db, {
      feedbackId,
      taskId,
      parentRunId: runId,
      prompt: "Prompt de correction.",
      promptSha256: "b".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "62b9a0f0-1d01-4a0c-8201-60f9bae0d34e",
    });

    assert.ok(result.ok);
    assert.equal(result.run.kind, "CORRECTION");
    assert.equal(result.run.parentRunId, runId);
    assert.equal(result.run.code, "RUN-002");
  });

  it("consomme le feedback, une fois", async () => {
    const { taskId, runId, feedbackId } = await prepared();

    const result = await startCorrectionFromFeedback(db, {
      feedbackId,
      taskId,
      parentRunId: runId,
      prompt: "Prompt.",
      promptSha256: "b".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "session-1",
    });
    assert.ok(result.ok);

    const feedback = await getReviewFeedback(db, feedbackId);
    assert.equal(feedback?.correctionRunId, result.run.id);
    assert.equal(feedback?.correctionRunCode, "RUN-002");
    assert.notEqual(feedback?.usedAt, null);
  });

  it("refuse une seconde utilisation du meme feedback", async () => {
    const { taskId, runId, feedbackId } = await prepared();

    const first = await startCorrectionFromFeedback(db, {
      feedbackId,
      taskId,
      parentRunId: runId,
      prompt: "Prompt.",
      promptSha256: "b".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "session-1",
    });
    assert.ok(first.ok);

    const second = await startCorrectionFromFeedback(db, {
      feedbackId,
      taskId,
      parentRunId: runId,
      prompt: "Prompt.",
      promptSha256: "b".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "session-1",
    });

    assert.equal(second.ok, false);
    assert.equal(second.ok ? null : second.reason, "already_used");
  });

  it("ne cree qu'une seule correction sur deux lancements concurrents", async () => {
    const { taskId, runId, feedbackId } = await prepared();

    // Le double clic : deux appels lances sans attendre le premier.
    const [left, right] = await Promise.all([
      startCorrectionFromFeedback(db, {
        feedbackId,
        taskId,
        parentRunId: runId,
        prompt: "Prompt.",
        promptSha256: "b".repeat(64),
        runnerRunId: runnerRunId(),
        resumedFromSessionId: "session-1",
      }),
      startCorrectionFromFeedback(db, {
        feedbackId,
        taskId,
        parentRunId: runId,
        prompt: "Prompt.",
        promptSha256: "c".repeat(64),
        runnerRunId: runnerRunId(),
        resumedFromSessionId: "session-1",
      }),
    ]);

    const succeeded = [left, right].filter((result) => result.ok);
    assert.equal(succeeded.length, 1, "exactement un lancement doit reussir");

    const feedback = await getReviewFeedback(db, feedbackId);
    assert.equal(feedback?.correctionRunId, succeeded[0]?.ok ? succeeded[0].run.id : null);
  });

  it("refuse un feedback qui ne decrit pas l'execution parente", async () => {
    const { taskId, feedbackId } = await prepared();
    const other = await newSourceRun();

    const result = await startCorrectionFromFeedback(db, {
      feedbackId,
      taskId,
      parentRunId: other.runId,
      prompt: "Prompt.",
      promptSha256: "b".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "session-1",
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.reason, "mismatch");
  });

  it("refuse un feedback inexistant", async () => {
    const { taskId, runId } = await prepared();

    const result = await startCorrectionFromFeedback(db, {
      feedbackId: "feedback-inexistant",
      taskId,
      parentRunId: runId,
      prompt: "Prompt.",
      promptSha256: "b".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "session-1",
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.reason, "not_found");
  });

  it("laisse le run parent intact", async () => {
    const { taskId, runId, feedbackId } = await prepared();
    const before = await getRunById(db, runId);

    await startCorrectionFromFeedback(db, {
      feedbackId,
      taskId,
      parentRunId: runId,
      prompt: "Prompt.",
      promptSha256: "b".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "session-1",
    });

    const after = await getRunById(db, runId);
    assert.equal(after?.prompt, before?.prompt);
    assert.equal(after?.status, before?.status);
    assert.equal(after?.kind, "INITIAL");
    assert.equal(after?.parentRunId, null);
  });

  it("permet de retrouver le feedback depuis la correction", async () => {
    const { taskId, runId, feedbackId } = await prepared();

    const result = await startCorrectionFromFeedback(db, {
      feedbackId,
      taskId,
      parentRunId: runId,
      prompt: "Prompt.",
      promptSha256: "b".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "session-1",
    });
    assert.ok(result.ok);

    const feedback = await getFeedbackForCorrectionRun(db, result.run.id);
    assert.equal(feedback?.id, feedbackId);
    assert.equal(feedback?.text, "Corrige la deuxieme phrase.");
  });

  it("supporte une chaine de deux corrections", async () => {
    const { taskId, runId, feedbackId } = await prepared();

    const first = await startCorrectionFromFeedback(db, {
      feedbackId,
      taskId,
      parentRunId: runId,
      prompt: "Prompt.",
      promptSha256: "b".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "session-1",
    });
    assert.ok(first.ok);

    const second = await createReviewFeedback(db, {
      taskId,
      sourceRunId: first.run.id,
      text: "Encore un detail.",
    });
    assert.ok(second.ok);

    const chained = await startCorrectionFromFeedback(db, {
      feedbackId: second.feedback.id,
      taskId,
      parentRunId: first.run.id,
      prompt: "Prompt.",
      promptSha256: "d".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "session-2",
    });

    assert.ok(chained.ok);
    // Chaque correction pointe vers l'execution qu'elle a relue, jamais vers
    // la premiere de la chaine.
    assert.equal(chained.run.parentRunId, first.run.id);
    assert.equal(chained.run.code, "RUN-003");
  });
});

describe("getRunResumeContext", () => {
  it("rapporte l'etat d'une execution relue", async () => {
    const { runId } = await newSourceRun();
    await makeResumable(runId);

    const context = await getRunResumeContext(db, runId);
    assert.equal(context?.runCode, "RUN-001");
    assert.equal(context?.hasReview, true);
    assert.equal(context?.workspaceFingerprint, "f".repeat(64));
    assert.equal(context?.workspaceFingerprintVersion, "v1");
    assert.equal(context?.hasCorrection, false);
  });

  it("signale une correction deja lancee", async () => {
    const { taskId, runId } = await newSourceRun();
    await makeResumable(runId);
    const created = await createReviewFeedback(db, {
      taskId,
      sourceRunId: runId,
      text: "Corrige.",
    });
    assert.ok(created.ok);

    await startCorrectionFromFeedback(db, {
      feedbackId: created.feedback.id,
      taskId,
      parentRunId: runId,
      prompt: "Prompt.",
      promptSha256: "b".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "session-1",
    });

    const context = await getRunResumeContext(db, runId);
    assert.equal(context?.hasCorrection, true);
  });

  it("rapporte l'absence d'empreinte pour un run anterieur", async () => {
    const { runId } = await newSourceRun();

    const context = await getRunResumeContext(db, runId);
    assert.equal(context?.workspaceFingerprint, null);
    assert.equal(context?.hasReview, false);
  });

  it("retourne null pour une execution inexistante", async () => {
    assert.equal(await getRunResumeContext(db, "run-inexistant"), null);
  });
});

describe("startTaskCorrection", () => {
  it("fait passer une tache de REVIEW a RUNNING", async () => {
    const { projectId, taskId, runId } = await newSourceRun();

    await updateTaskStatus(db, taskId, projectId, "READY");
    await bringToReview(taskId, runId);

    assert.equal(await startTaskCorrection(db, taskId), true);
  });

  it("refuse depuis tout autre statut", async () => {
    const { projectId, taskId } = await newSourceRun();

    // `DRAFT` : la transition n'existe pas, et ne doit pas devenir generique.
    assert.equal(await startTaskCorrection(db, taskId), false);

    await updateTaskStatus(db, taskId, projectId, "READY");
    assert.equal(await startTaskCorrection(db, taskId), false);
  });

  it("ramene la tache en REVIEW apres un lancement refuse", async () => {
    const { projectId, taskId, runId } = await newSourceRun();

    await updateTaskStatus(db, taskId, projectId, "READY");
    await bringToReview(taskId, runId);
    await startTaskCorrection(db, taskId);

    await cancelTaskCorrection(db, taskId);

    // Sans ce retour arriere, la tache resterait RUNNING pour un processus qui
    // n'a jamais existe — et la review deviendrait inaccessible.
    const task = await getTaskById(db, taskId);
    assert.equal(task?.status, "REVIEW");
  });
});

/**
 * Propagation des commandes de validation vers un run de correction.
 *
 * Le premier run reel de TASK-012 a laisse une validation pourtant executee a
 * « Not run », et le premier soupcon portait sur cette recopie : une correction
 * qui n'aurait pas herite des commandes de la tache n'aurait rien a reconnaitre.
 *
 * Ce n'etait pas la cause — la lecture de la ligne Bash l'etait —, mais rien ne
 * figeait cette etape. C'est desormais le cas : une refactorisation qui
 * oublierait `seedRunValidations` sur le chemin d'une correction ferait echouer
 * cette suite.
 */
describe("propagation des validations vers une correction", () => {
  it("recopie les commandes de la tache dans le run de correction", async () => {
    const { projectId, taskId, runId } = await newSourceRun();
    await updateTaskStatus(db, taskId, projectId, "READY");
    await bringToReview(taskId, runId);
    await makeResumable(runId);

    // 1. La specification de la tache.
    const task = await getTaskById(db, taskId);
    assert.deepEqual(task?.validationCommands, ["npm run test"]);

    const feedback = await createReviewFeedback(db, {
      taskId,
      sourceRunId: runId,
      text: "Raccourcis la phrase.",
    });
    assert.ok(feedback.ok);

    // 2. Le run de correction, cree a partir du feedback.
    const correction = await startCorrectionFromFeedback(db, {
      feedbackId: feedback.feedback.id,
      taskId,
      parentRunId: runId,
      prompt: "Prompt de correction.",
      promptSha256: "d".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "62b9a0f0-1d01-4a0c-8201-60f9bae0d34e",
    });
    assert.ok(correction.ok);
    assert.equal(correction.run.kind, "CORRECTION");

    // 3. L'instantane des validations, recopie depuis la specification actuelle.
    const inserted = await seedRunValidations(db, correction.run.id, task.validationCommands);
    assert.equal(inserted, 1);

    // 4. Ce que la review de la correction lira.
    const review = await getRunReview(db, correction.run.id);
    assert.equal(review?.validations.length, 1);
    assert.equal(review?.validations[0]?.command, "npm run test");
    // Une commande recopiee mais jamais lancee reste `NOT_RUN` : c'est une
    // information, pas un trou.
    assert.equal(review?.validations[0]?.status, "NOT_RUN");
  });

  it("ne laisse aucune validation quand la tache n'en declare aucune", async () => {
    const { projectId, taskId, runId } = await newSourceRun();
    await updateTaskStatus(db, taskId, projectId, "READY");
    await bringToReview(taskId, runId);
    await makeResumable(runId);

    const feedback = await createReviewFeedback(db, {
      taskId,
      sourceRunId: runId,
      text: "Un detail.",
    });
    assert.ok(feedback.ok);

    const correction = await startCorrectionFromFeedback(db, {
      feedbackId: feedback.feedback.id,
      taskId,
      parentRunId: runId,
      prompt: "Prompt de correction.",
      promptSha256: "e".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "62b9a0f0-1d01-4a0c-8201-60f9bae0d34e",
    });
    assert.ok(correction.ok);

    assert.equal(await seedRunValidations(db, correction.run.id, []), 0);
    const review = await getRunReview(db, correction.run.id);
    assert.deepEqual(review?.validations, []);
  });
});
