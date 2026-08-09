/**
 * Acces aux donnees du feedback de review et des corrections ciblees.
 *
 * ## Deux garanties portees par ce module
 *
 * 1. **Un feedback vaut pour une seule correction.** Le verrou n'est pas une
 *    verification suivie d'une ecriture — un double clic passerait entre les
 *    deux —, c'est une mise a jour conditionnelle dans une transaction, doublee
 *    d'un index unique sur `correctionRunId`. Meme un appel direct a Prisma
 *    echouerait.
 * 2. **Un feedback est historique.** Il n'est ni modifiable apres usage, ni
 *    supprime en cascade. Six mois plus tard, « pourquoi RUN-002 existe-t-il ? »
 *    n'a qu'une bonne reponse : le texte exact que l'utilisateur avait ecrit.
 *
 * ## Ce qui ne sort jamais d'ici
 *
 * L'empreinte du dossier de travail. `getRunResumeContext` la lit pour le
 * serveur, et rien de ce qui alimente une page ne la contient : elle n'a aucune
 * raison d'atteindre un navigateur, et une valeur qu'on n'expose pas ne peut pas
 * fuir.
 */

import {
  RUN_KIND,
  RUN_STATUS,
  REVIEW_FEEDBACK_LIMITS,
  TASK_STATUS,
  checkReviewFeedback,
  formatRunCode,
  isTaskStatus,
  normalizeReviewFeedback,
  type DevelopmentRunDetail,
  type ReviewFeedbackRefusal,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";
import { getRunById } from "./runs.js";

/** Un feedback de review, tel que l'interface le relit. */
export type ReviewFeedbackView = {
  id: string;
  taskId: string;
  sourceRunId: string;
  /** Code de l'execution relue : `RUN-001`. */
  sourceRunCode: string;
  text: string;
  correctionRunId: string | null;
  /** Code de la correction lancee, lorsqu'il y en a une. */
  correctionRunCode: string | null;
  createdAt: string;
  usedAt: string | null;
};

type FeedbackRow = {
  id: string;
  taskId: string;
  sourceRunId: string;
  text: string;
  correctionRunId: string | null;
  createdAt: Date;
  usedAt: Date | null;
  sourceRun: { sequence: number };
  correctionRun: { sequence: number } | null;
};

const FEEDBACK_INCLUDE = {
  sourceRun: { select: { sequence: true } },
  correctionRun: { select: { sequence: true } },
} as const;

function toView(row: FeedbackRow): ReviewFeedbackView {
  return {
    id: row.id,
    taskId: row.taskId,
    sourceRunId: row.sourceRunId,
    sourceRunCode: formatRunCode(row.sourceRun.sequence),
    text: row.text,
    correctionRunId: row.correctionRunId,
    correctionRunCode:
      row.correctionRun === null ? null : formatRunCode(row.correctionRun.sequence),
    createdAt: row.createdAt.toISOString(),
    usedAt: row.usedAt === null ? null : row.usedAt.toISOString(),
  };
}

export type CreateFeedbackResult =
  | { ok: true; feedback: ReviewFeedbackView }
  | { ok: false; reason: "not_found" | "invalid"; refusal?: ReviewFeedbackRefusal };

/**
 * Enregistre un feedback de review.
 *
 * L'execution source doit appartenir a la tache : la relation est verifiee ici
 * plutot que supposee, parce que les deux identifiants viennent d'un formulaire.
 * Le texte est normalise puis revalide — la validation cote client est un
 * confort, jamais une garantie.
 */
export async function createReviewFeedback(
  db: DatabaseClient,
  input: { taskId: string; sourceRunId: string; text: string },
): Promise<CreateFeedbackResult> {
  const text = normalizeReviewFeedback(input.text);
  const refusal = checkReviewFeedback(text);
  if (refusal !== null) {
    return { ok: false, reason: "invalid", refusal };
  }

  const source = await db.run.findUnique({
    where: { id: input.sourceRunId },
    select: { id: true, taskId: true },
  });
  if (source === null || source.taskId !== input.taskId) {
    return { ok: false, reason: "not_found" };
  }

  const row = await db.reviewFeedback.create({
    data: {
      taskId: input.taskId,
      sourceRunId: input.sourceRunId,
      // Une seconde borne, apres celle du contrat : la couche d'ecriture ne fait
      // pas confiance a l'appelant, meme quand l'appelant est NOX.
      text: text.slice(0, REVIEW_FEEDBACK_LIMITS.maxLength),
    },
    include: FEEDBACK_INCLUDE,
  });

  return { ok: true, feedback: toView(row) };
}

/** Retourne un feedback, ou `null`. */
export async function getReviewFeedback(
  db: DatabaseClient,
  feedbackId: string,
): Promise<ReviewFeedbackView | null> {
  const row = await db.reviewFeedback.findUnique({
    where: { id: feedbackId },
    include: FEEDBACK_INCLUDE,
  });
  return row === null ? null : toView(row);
}

/** Feedbacks ecrits depuis une execution donnee, du plus ancien au plus recent. */
export async function listFeedbacksForSourceRun(
  db: DatabaseClient,
  sourceRunId: string,
): Promise<ReviewFeedbackView[]> {
  const rows = await db.reviewFeedback.findMany({
    where: { sourceRunId },
    include: FEEDBACK_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toView);
}

/** Feedback qui a declenche une correction, ou `null` pour un run initial. */
export async function getFeedbackForCorrectionRun(
  db: DatabaseClient,
  correctionRunId: string,
): Promise<ReviewFeedbackView | null> {
  const row = await db.reviewFeedback.findUnique({
    where: { correctionRunId },
    include: FEEDBACK_INCLUDE,
  });
  return row === null ? null : toView(row);
}

/**
 * Ce qu'il faut, cote serveur, pour decider d'une reprise.
 *
 * **Ne doit jamais alimenter un rendu.** `workspaceFingerprint` est un secret
 * derive : il ne dit rien a l'utilisateur, et l'exposer offrirait a un attaquant
 * la valeur exacte a reproduire.
 */
export type RunResumeContext = {
  runId: string;
  taskId: string;
  runCode: string;
  status: string;
  errorCode: string | null;
  claudeSessionId: string | null;
  workspaceFingerprint: string | null;
  workspaceFingerprintVersion: string | null;
  gitBranch: string | null;
  gitHeadAfter: string | null;
  hasReview: boolean;
  hasCorrection: boolean;
};

/** Lit le contexte de reprise d'une execution, ou `null` si elle n'existe pas. */
export async function getRunResumeContext(
  db: DatabaseClient,
  runId: string,
): Promise<RunResumeContext | null> {
  const row = await db.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      taskId: true,
      sequence: true,
      status: true,
      errorCode: true,
      claudeSessionId: true,
      workspaceFingerprint: true,
      workspaceFingerprintVersion: true,
      gitBranch: true,
      gitHeadAfter: true,
      reviewCapturedAt: true,
    },
  });
  if (row === null) {
    return null;
  }

  const correction = await db.run.findFirst({
    where: { parentRunId: runId },
    select: { id: true },
  });

  return {
    runId: row.id,
    taskId: row.taskId,
    runCode: formatRunCode(row.sequence),
    status: row.status,
    errorCode: row.errorCode,
    claudeSessionId: row.claudeSessionId,
    workspaceFingerprint: row.workspaceFingerprint,
    workspaceFingerprintVersion: row.workspaceFingerprintVersion,
    gitBranch: row.gitBranch,
    gitHeadAfter: row.gitHeadAfter,
    hasReview: row.reviewCapturedAt !== null,
    hasCorrection: correction !== null,
  };
}

export type StartCorrectionResult =
  | { ok: true; run: DevelopmentRunDetail }
  | { ok: false; reason: "not_found" | "already_used" | "mismatch" };

/**
 * Cree l'execution de correction et consomme le feedback, en une transaction.
 *
 * Les deux ecritures sont indissociables. Un run cree sans feedback consomme
 * autoriserait un second lancement ; un feedback consomme sans run laisserait
 * l'utilisateur devant un texte inutilisable. La mise a jour du feedback est
 * **conditionnelle** — `correctionRunId: null` fait partie du `where` — de sorte
 * que deux appels simultanes ne peuvent pas la reussir tous les deux.
 */
export async function startCorrectionFromFeedback(
  db: DatabaseClient,
  input: {
    feedbackId: string;
    taskId: string;
    parentRunId: string;
    prompt: string;
    promptSha256: string;
    runnerRunId: string;
    resumedFromSessionId: string;
  },
): Promise<StartCorrectionResult> {
  const outcome = await db.$transaction(async (tx) => {
    const feedback = await tx.reviewFeedback.findUnique({
      where: { id: input.feedbackId },
      select: { id: true, taskId: true, sourceRunId: true, correctionRunId: true },
    });
    if (feedback === null) {
      return { ok: false, reason: "not_found" } as const;
    }
    if (feedback.taskId !== input.taskId || feedback.sourceRunId !== input.parentRunId) {
      // Le feedback ne decrit pas l'execution qu'on pretend corriger : refus, et
      // surtout pas une correction silencieuse des identifiants recus.
      return { ok: false, reason: "mismatch" } as const;
    }
    if (feedback.correctionRunId !== null) {
      return { ok: false, reason: "already_used" } as const;
    }

    const reserved = await tx.task.update({
      where: { id: input.taskId },
      data: { nextRunSequence: { increment: 1 } },
      select: { nextRunSequence: true },
    });

    const run = await tx.run.create({
      data: {
        taskId: input.taskId,
        sequence: reserved.nextRunSequence - 1,
        status: RUN_STATUS.QUEUED,
        kind: RUN_KIND.CORRECTION,
        parentRunId: input.parentRunId,
        resumedFromSessionId: input.resumedFromSessionId,
        prompt: input.prompt,
        promptSha256: input.promptSha256,
        runnerRunId: input.runnerRunId,
      },
      select: { id: true },
    });

    // Le verrou : la condition `correctionRunId: null` fait partie du `where`.
    // Un second appel concurrent verra zero ligne mise a jour et repartira.
    const claimed = await tx.reviewFeedback.updateMany({
      where: { id: input.feedbackId, correctionRunId: null },
      data: { correctionRunId: run.id, usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new FeedbackAlreadyUsedError(input.feedbackId);
    }

    return { ok: true, runId: run.id } as const;
  }).catch((error: unknown) => {
    if (error instanceof FeedbackAlreadyUsedError) {
      return { ok: false, reason: "already_used" } as const;
    }
    throw error;
  });

  if (!outcome.ok) {
    return outcome;
  }

  const run = await getRunById(db, outcome.runId);
  return run === null ? { ok: false, reason: "not_found" } : { ok: true, run };
}

/** Levee dans la transaction pour annuler la creation d'un run en double. */
class FeedbackAlreadyUsedError extends Error {
  constructor(feedbackId: string) {
    super(`Feedback ${feedbackId} deja utilise.`);
    this.name = "FeedbackAlreadyUsedError";
  }
}

/**
 * Fait passer une tache de `REVIEW` a `RUNNING` pour une correction.
 *
 * Volontairement separee de `startTaskExecution`, et volontairement etroite :
 * `REVIEW → RUNNING` n'existe ni dans les transitions manuelles, ni dans les
 * transitions automatisees generiques. L'ouvrir la-bas rendrait cette bascule
 * possible depuis n'importe quel bouton ; ici, elle n'est atteignable que par le
 * lancement d'une correction.
 */
export async function startTaskCorrection(
  db: DatabaseClient,
  taskId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId }, select: { status: true } });
    if (task === null || !isTaskStatus(task.status) || task.status !== TASK_STATUS.REVIEW) {
      return false;
    }
    await tx.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.RUNNING } });
    return true;
  });
}

/**
 * Ramene une tache a `REVIEW` apres une correction refusee avant demarrage.
 *
 * Le pendant de `cancelTaskExecution` pour une reprise : sans elle, un refus du
 * runner laisserait la tache en `RUNNING` pour un processus qui n'a jamais
 * existe — et l'utilisateur ne pourrait plus relire la review qu'il venait de
 * quitter.
 */
export async function cancelTaskCorrection(db: DatabaseClient, taskId: string): Promise<void> {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { status: true } });
  if (task !== null && task.status === TASK_STATUS.RUNNING) {
    await db.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.REVIEW } });
  }
}
