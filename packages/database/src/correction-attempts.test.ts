/**
 * Reservation et lancement d'une correction.
 *
 * ## Ce que ce fichier prouve
 *
 * Que la reservation est un **verrou persistant**, pas une verification suivie
 * d'une ecriture : dix constatations simultanees du meme echec n'en obtiennent
 * qu'une, et la garantie survivrait a un redemarrage comme a deux processus.
 *
 * Qu'une reservation rendue libere la place, sans effacer qu'elle a existe.
 *
 * Que la creation de l'execution et la consommation de la reservation sont
 * indissociables : jamais un run sans reservation consommee, jamais l'inverse.
 *
 * Et que le cycle de travail courant se lit par la chaine des executions, pas
 * par un comptage — une tache qui a deja vecu une review et une reouverture ne
 * doit pas voir sa borne consommee par son passe.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CORRECTION_ATTEMPT_STATUS, CORRECTION_SOURCE, TASK_PRIORITY } from "@nox/shared";

import {
  abandonCorrection,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  getCorrectionAttempt,
  getCorrectionAttemptForRun,
  getHeldCorrection,
  getRunById,
  listCorrectionAttempts,
  readCorrectionChain,
  reserveCorrection,
  startCorrectionRun,
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

async function applyMigrations(file: string): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const sqlite = new DatabaseSync(file);
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
  return `22222222-2222-4222-8222-${String(counter).padStart(12, "0")}`;
}

/** Une execution terminee, prete a etre corrigee. */
async function newSourceRun(): Promise<{ taskId: string; runId: string; projectId: string }> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  const task = await createTask(db, {
    projectId: project.id,
    title: `Tache ${String(counter)}`,
    objective: "Objectif.",
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: ["Verifiable"],
    documentReferences: [],
    validationCommands: [],
  });
  assert.ok(task !== null);

  const run = await createRun(db, {
    taskId: task.id,
    projectId: project.id,
    prompt: "Prompt de test.",
    promptSha256: "a".repeat(64),
    runnerRunId: runnerRunId(),
  });
  assert.ok(run.ok);
  await db.run.update({ where: { id: run.run.id }, data: { status: "COMPLETED" } });
  return { taskId: task.id, runId: run.run.id, projectId: project.id };
}

async function launch(input: {
  attemptId: string;
  taskId: string;
  parentRunId: string;
}): Promise<string | null> {
  const result = await startCorrectionRun(db, {
    attemptId: input.attemptId,
    taskId: input.taskId,
    parentRunId: input.parentRunId,
    prompt: "Prompt de correction.",
    promptSha256: "b".repeat(64),
    runnerRunId: runnerRunId(),
    resumedFromSessionId: "session-1",
  });
  return result.ok ? result.run.id : null;
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-correction-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("reservation d'une correction", () => {
  it("prend la place, avec sa source et son rang", async () => {
    const { taskId, runId } = await newSourceRun();
    const reserved = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
      automatedAttempt: 1,
    });

    assert.ok(reserved.ok);
    assert.equal(reserved.attempt.source, CORRECTION_SOURCE.AUTOMATED_VALIDATION);
    assert.equal(reserved.attempt.status, CORRECTION_ATTEMPT_STATUS.RESERVED);
    assert.equal(reserved.attempt.attempt, 1);
    assert.equal(reserved.attempt.automatedAttempt, 1);
    assert.equal(reserved.attempt.correctionRunId, null);
  });

  it("refuse une seconde reservation sur la meme execution", async () => {
    const { taskId, runId } = await newSourceRun();
    const first = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
      automatedAttempt: 1,
    });
    assert.ok(first.ok);

    const second = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.HUMAN_FEEDBACK,
    });
    assert.equal(second.ok, false);
    assert.equal(second.ok ? null : second.reason, "already_reserved");
  });

  it("n'en accorde qu'une sur dix constatations simultanees", async () => {
    // Le cas reel : dix sondages du meme lot en echec. Le verrou est l'ecriture,
    // pas une verification prealable — un mutex en memoire n'aurait survecu ni a
    // un redemarrage, ni a deux processus.
    const { taskId, runId } = await newSourceRun();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        reserveCorrection(db, {
          taskId,
          sourceRunId: runId,
          source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
          automatedAttempt: 1,
        }),
      ),
    );

    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(await db.correctionAttempt.count({ where: { sourceRunId: runId } }), 1);
  });

  it("tranche la course entre une correction automatique et une demande humaine", async () => {
    const { taskId, runId } = await newSourceRun();
    const [automatic, human] = await Promise.all([
      reserveCorrection(db, {
        taskId,
        sourceRunId: runId,
        source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
        automatedAttempt: 1,
      }),
      reserveCorrection(db, {
        taskId,
        sourceRunId: runId,
        source: CORRECTION_SOURCE.HUMAN_FEEDBACK,
      }),
    ]);

    const winners = [automatic, human].filter((result) => result.ok);
    assert.equal(winners.length, 1, "exactement une reservation doit aboutir");
    const loser = [automatic, human].find((result) => !result.ok);
    assert.equal(loser?.ok === false ? loser.reason : null, "already_reserved");
  });

  it("refuse une execution qui n'appartient pas a la tache", async () => {
    const first = await newSourceRun();
    const other = await newSourceRun();
    const reserved = await reserveCorrection(db, {
      taskId: first.taskId,
      sourceRunId: other.runId,
      source: CORRECTION_SOURCE.HUMAN_FEEDBACK,
    });
    assert.equal(reserved.ok, false);
    assert.equal(reserved.ok ? null : reserved.reason, "run_not_found");
  });
});

describe("abandon d'une reservation", () => {
  it("libere la place, et laisse la trace", async () => {
    const { taskId, runId } = await newSourceRun();
    const first = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
      automatedAttempt: 1,
    });
    assert.ok(first.ok);

    assert.equal(await abandonCorrection(db, first.attempt.id, "CORRECTION_QUEUE_PAUSED"), true);

    const abandoned = await getCorrectionAttempt(db, first.attempt.id);
    assert.equal(abandoned?.status, CORRECTION_ATTEMPT_STATUS.ABANDONED);
    assert.equal(abandoned?.refusalCode, "CORRECTION_QUEUE_PAUSED");
    assert.notEqual(abandoned?.abandonedAt, null);
    assert.equal(await getHeldCorrection(db, runId), null);

    // La place est libre : un humain peut demander sa correction ensuite.
    const second = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.HUMAN_FEEDBACK,
    });
    assert.ok(second.ok);
    assert.equal(second.attempt.attempt, 2, "le rang ne recule jamais");
  });

  it("ne rend pas une reservation deja consommee", async () => {
    const { taskId, runId } = await newSourceRun();
    const reserved = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.HUMAN_FEEDBACK,
    });
    assert.ok(reserved.ok);
    assert.notEqual(await launch({ attemptId: reserved.attempt.id, taskId, parentRunId: runId }), null);

    assert.equal(await abandonCorrection(db, reserved.attempt.id, "CORRECTION_QUEUE_PAUSED"), false);
    const attempt = await getCorrectionAttempt(db, reserved.attempt.id);
    assert.equal(attempt?.status, CORRECTION_ATTEMPT_STATUS.LAUNCHED);
  });
});

describe("lancement d'une correction", () => {
  it("cree l'execution et consomme la reservation, ensemble", async () => {
    const { taskId, runId } = await newSourceRun();
    const reserved = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
      automatedAttempt: 1,
    });
    assert.ok(reserved.ok);

    const correctionRunId = await launch({
      attemptId: reserved.attempt.id,
      taskId,
      parentRunId: runId,
    });
    assert.notEqual(correctionRunId, null);

    const run = await getRunById(db, correctionRunId as string);
    assert.equal(run?.kind, "CORRECTION");
    assert.equal(run?.parentRunId, runId);
    assert.equal(run?.code, "RUN-002");

    const attempt = await getCorrectionAttempt(db, reserved.attempt.id);
    assert.equal(attempt?.status, CORRECTION_ATTEMPT_STATUS.LAUNCHED);
    assert.equal(attempt?.correctionRunId, correctionRunId);
    assert.notEqual(attempt?.launchedAt, null);
  });

  it("refuse un second lancement depuis la meme reservation", async () => {
    const { taskId, runId } = await newSourceRun();
    const reserved = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.HUMAN_FEEDBACK,
    });
    assert.ok(reserved.ok);

    assert.notEqual(await launch({ attemptId: reserved.attempt.id, taskId, parentRunId: runId }), null);

    const second = await startCorrectionRun(db, {
      attemptId: reserved.attempt.id,
      taskId,
      parentRunId: runId,
      prompt: "Prompt.",
      promptSha256: "c".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "session-1",
    });
    assert.equal(second.ok, false);
    assert.equal(second.ok ? null : second.reason, "already_used");
  });

  it("ne cree qu'une execution sur deux lancements concurrents", async () => {
    const { taskId, runId } = await newSourceRun();
    const reserved = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.HUMAN_FEEDBACK,
    });
    assert.ok(reserved.ok);

    const [left, right] = await Promise.all([
      startCorrectionRun(db, {
        attemptId: reserved.attempt.id,
        taskId,
        parentRunId: runId,
        prompt: "Prompt.",
        promptSha256: "b".repeat(64),
        runnerRunId: runnerRunId(),
        resumedFromSessionId: "session-1",
      }),
      startCorrectionRun(db, {
        attemptId: reserved.attempt.id,
        taskId,
        parentRunId: runId,
        prompt: "Prompt.",
        promptSha256: "c".repeat(64),
        runnerRunId: runnerRunId(),
        resumedFromSessionId: "session-1",
      }),
    ]);

    assert.equal([left, right].filter((result) => result.ok).length, 1);
    assert.equal(await db.run.count({ where: { parentRunId: runId } }), 1);
  });

  it("refuse une reservation qui ne decrit pas l'execution visee", async () => {
    const first = await newSourceRun();
    const other = await newSourceRun();
    const reserved = await reserveCorrection(db, {
      taskId: first.taskId,
      sourceRunId: first.runId,
      source: CORRECTION_SOURCE.HUMAN_FEEDBACK,
    });
    assert.ok(reserved.ok);

    const result = await startCorrectionRun(db, {
      attemptId: reserved.attempt.id,
      taskId: first.taskId,
      parentRunId: other.runId,
      prompt: "Prompt.",
      promptSha256: "b".repeat(64),
      runnerRunId: runnerRunId(),
      resumedFromSessionId: "session-1",
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.reason, "mismatch");
  });

  it("laisse l'execution source strictement intacte", async () => {
    const { taskId, runId } = await newSourceRun();
    const before = await getRunById(db, runId);
    const reserved = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
      automatedAttempt: 1,
    });
    assert.ok(reserved.ok);
    await launch({ attemptId: reserved.attempt.id, taskId, parentRunId: runId });

    const after = await getRunById(db, runId);
    assert.equal(after?.prompt, before?.prompt);
    assert.equal(after?.status, before?.status);
    assert.equal(after?.kind, "INITIAL");
    assert.equal(after?.parentRunId, null);
  });

  it("permet de retrouver la reservation depuis l'execution de correction", async () => {
    const { taskId, runId } = await newSourceRun();
    const reserved = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
      automatedAttempt: 2,
    });
    assert.ok(reserved.ok);
    const correctionRunId = await launch({
      attemptId: reserved.attempt.id,
      taskId,
      parentRunId: runId,
    });

    const found = await getCorrectionAttemptForRun(db, correctionRunId as string);
    assert.equal(found?.id, reserved.attempt.id);
    assert.equal(found?.source, CORRECTION_SOURCE.AUTOMATED_VALIDATION);
    assert.equal(found?.automatedAttempt, 2);
  });

  it("ne rattache aucune reservation a une execution initiale", async () => {
    const { runId } = await newSourceRun();
    assert.equal(await getCorrectionAttemptForRun(db, runId), null);
  });
});

describe("cycle de travail courant", () => {
  it("remonte la chaine des executions, de l'initiale a la derniere", async () => {
    const { taskId, runId } = await newSourceRun();

    const firstReservation = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
      automatedAttempt: 1,
    });
    assert.ok(firstReservation.ok);
    const second = await launch({
      attemptId: firstReservation.attempt.id,
      taskId,
      parentRunId: runId,
    });
    assert.ok(second !== null);
    await db.run.update({ where: { id: second }, data: { status: "COMPLETED" } });

    const secondReservation = await reserveCorrection(db, {
      taskId,
      sourceRunId: second,
      source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
      automatedAttempt: 2,
    });
    assert.ok(secondReservation.ok);
    const third = await launch({
      attemptId: secondReservation.attempt.id,
      taskId,
      parentRunId: second,
    });
    assert.ok(third !== null);

    assert.deepEqual(await readCorrectionChain(db, third), [runId, second, third]);
    assert.deepEqual(await readCorrectionChain(db, second), [runId, second]);
    assert.deepEqual(await readCorrectionChain(db, runId), [runId]);
  });

  it("ne melange pas deux cycles de la meme tache", async () => {
    // Une tache rouverte apres une review repart d'une execution initiale
    // neuve. Compter toutes ses executions ferait consommer la borne du nouveau
    // cycle par l'ancien.
    const { taskId, runId, projectId } = await newSourceRun();
    const reserved = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
      automatedAttempt: 1,
    });
    assert.ok(reserved.ok);
    const correction = await launch({ attemptId: reserved.attempt.id, taskId, parentRunId: runId });
    assert.ok(correction !== null);
    await db.run.update({ where: { id: correction }, data: { status: "COMPLETED" } });

    const fresh = await createRun(db, {
      taskId,
      projectId,
      prompt: "Nouveau cycle.",
      promptSha256: "d".repeat(64),
      runnerRunId: runnerRunId(),
    });
    assert.ok(fresh.ok);

    assert.deepEqual(await readCorrectionChain(db, fresh.run.id), [fresh.run.id]);
    // Les reservations de l'ancien cycle existent toujours, mais elles ne sont
    // pas dans la chaine : c'est ce filtre qui protege la borne.
    const all = await listCorrectionAttempts(db, taskId);
    assert.equal(all.length, 1);
    assert.equal(all[0]?.sourceRunId, runId);
  });

  it("rend une chaine vide pour une execution inconnue", async () => {
    assert.deepEqual(await readCorrectionChain(db, "run-inexistant"), []);
  });
});

describe("lecture d'un etat historique", () => {
  it("traite une source illisible comme humaine, le defaut qui n'accorde rien", async () => {
    const { taskId, runId } = await newSourceRun();
    await db.correctionAttempt.create({
      data: {
        taskId,
        sourceRunId: runId,
        source: "SOMETHING_ELSE",
        attempt: 1,
        status: CORRECTION_ATTEMPT_STATUS.LAUNCHED,
      },
    });

    const held = await getHeldCorrection(db, runId);
    assert.equal(held?.source, CORRECTION_SOURCE.HUMAN_FEEDBACK);
  });

  it("traite un statut illisible comme abandonne : il n'occupe plus la place", async () => {
    const { taskId, runId } = await newSourceRun();
    await db.correctionAttempt.create({
      data: {
        taskId,
        sourceRunId: runId,
        source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
        attempt: 1,
        status: "WHATEVER",
      },
    });

    assert.equal(await getHeldCorrection(db, runId), null);
    const reserved = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.HUMAN_FEEDBACK,
    });
    assert.ok(reserved.ok);
  });

  it("liste les reservations d'une tache dans l'ordre de leur prise", async () => {
    const { taskId, runId } = await newSourceRun();
    const first = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
      automatedAttempt: 1,
    });
    assert.ok(first.ok);
    await abandonCorrection(db, first.attempt.id, "CORRECTION_QUEUE_PAUSED");
    const second = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.HUMAN_FEEDBACK,
    });
    assert.ok(second.ok);

    const listed = await listCorrectionAttempts(db, taskId);
    assert.equal(listed.length, 2);
    assert.equal(listed[0]?.id, first.attempt.id);
    assert.equal(listed[1]?.id, second.attempt.id);
  });
});
