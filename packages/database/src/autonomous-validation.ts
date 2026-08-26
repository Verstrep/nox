/**
 * Lots de validation autonome : reservation, resultats, conclusion.
 *
 * ## Le point de serialisation
 *
 * Une execution qui se termine peut etre constatee plusieurs fois — deux
 * onglets ouverts, un sondage et un rendu, deux serveurs. Chacune de ces
 * constatations voudrait lancer les validations. Une seule doit y arriver.
 *
 * La garantie est l'index unique `(runId, attempt)`, pas une verification
 * prealable : `reserveBatch` **ecrit d'abord**, et le perdant recoit une
 * violation de contrainte plutot qu'un feu vert. Un verrou en memoire n'aurait
 * survecu ni a un redemarrage, ni a deux processus — c'est le raisonnement de
 * TASK-026 sur la file, applique a un autre point de concurrence.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il n'execute aucune commande, n'appelle pas le runner, et ne decide d'aucune
 * completion. Il enregistre ce qu'on lui rapporte.
 */

import {
  VALIDATION_BATCH_STATUS,
  isBatchFinal,
  isValidationBatchStatus,
  isAutonomousValidationStatus,
  isValidationFailure,
  AUTONOMOUS_VALIDATION_STATUS,
  type AutonomousValidationStatus,
  type ValidationBatchStatus,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Un resultat de commande, tel qu'il est relu. */
export type AutonomousValidationResultRow = {
  id: string;
  position: number;
  commandId: string | null;
  command: string;
  status: AutonomousValidationStatus;
  exitCode: number | null;
  durationMs: number | null;
  stdout: string | null;
  stdoutTruncated: boolean;
  stderr: string | null;
  stderrTruncated: boolean;
};

/** Un lot, avec ses resultats. */
export type AutonomousValidationBatchRow = {
  id: string;
  runId: string;
  attempt: number;
  status: ValidationBatchStatus;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  trackedStateBefore: string | null;
  trackedStateAfter: string | null;
  /** Fichiers suivis modifies par la validation, ou `null` si NOX l'ignore. */
  mutatedFiles: readonly string[] | null;
  results: readonly AutonomousValidationResultRow[];
};

export type ReserveBatchResult =
  | { ok: true; batchId: string; attempt: number }
  | { ok: false; reason: "already_active" | "already_done" | "not_retryable" | "run_not_found" };

/** Levee dans la transaction pour annuler une reservation en double. */
class BatchAlreadyReservedError extends Error {
  constructor() {
    super("Un lot de validation existe deja pour cette tentative.");
    this.name = "BatchAlreadyReservedError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function readBatchStatus(value: string): ValidationBatchStatus {
  // Un statut illisible est traite comme une erreur finale : il ne doit ni
  // bloquer eternellement une review, ni passer pour une reussite.
  return isValidationBatchStatus(value) ? value : VALIDATION_BATCH_STATUS.ERROR;
}

/**
 * Reserve un lot pour une execution.
 *
 * ## Premiere tentative
 *
 * Reservee sans condition humaine : elle appartient a la finalisation de
 * l'execution. Deux finalisations concurrentes visent toutes les deux la
 * tentative 1, et l'index unique en refuse une.
 *
 * ## Tentatives suivantes
 *
 * Reservees uniquement sur demande explicite, et uniquement apres une panne
 * d'infrastructure. Une commande qui a reellement echoue n'a pas de seconde
 * chance : le code n'a pas change depuis, et relancer donnerait le meme
 * resultat. C'est `Request changes` qui s'applique alors.
 */
export async function reserveValidationBatch(
  db: DatabaseClient,
  runId: string,
  options: { retry?: boolean } = {},
): Promise<ReserveBatchResult> {
  return db
    .$transaction(async (tx): Promise<ReserveBatchResult> => {
      const run = await tx.run.findUnique({ where: { id: runId }, select: { id: true } });
      if (run === null) {
        return { ok: false, reason: "run_not_found" };
      }

      const latest = await tx.autonomousValidationBatch.findFirst({
        where: { runId },
        orderBy: { attempt: "desc" },
        select: { attempt: true, status: true },
      });

      if (latest !== null) {
        const status = readBatchStatus(latest.status);
        if (!isBatchFinal(status)) {
          return { ok: false, reason: "already_active" };
        }
        if (options.retry !== true) {
          return { ok: false, reason: "already_done" };
        }
        // Seule une panne d'infrastructure ouvre une nouvelle tentative.
        if (status !== VALIDATION_BATCH_STATUS.ERROR) {
          return { ok: false, reason: "not_retryable" };
        }
      }

      const attempt = (latest?.attempt ?? 0) + 1;

      // L'ecriture est le verrou. Deux appels simultanes visent le meme numero
      // de tentative, et l'index unique n'en laisse passer qu'un.
      const batch = await tx.autonomousValidationBatch
        .create({
          data: { runId, attempt, status: VALIDATION_BATCH_STATUS.PENDING },
          select: { id: true },
        })
        .catch((error: unknown) => {
          if (isUniqueViolation(error)) {
            throw new BatchAlreadyReservedError();
          }
          throw error;
        });

      return { ok: true, batchId: batch.id, attempt };
    })
    .catch((error: unknown): ReserveBatchResult => {
      if (error instanceof BatchAlreadyReservedError) {
        return { ok: false, reason: "already_active" };
      }
      throw error;
    });
}

/** Marque le lot comme demarre, et enregistre l'etat Git constate avant. */
export async function startValidationBatch(
  db: DatabaseClient,
  batchId: string,
  trackedStateBefore: string | null,
): Promise<void> {
  await db.autonomousValidationBatch.updateMany({
    where: { id: batchId, status: VALIDATION_BATCH_STATUS.PENDING },
    data: {
      status: VALIDATION_BATCH_STATUS.RUNNING,
      startedAt: new Date(),
      trackedStateBefore,
    },
  });
}

/** Enregistre le resultat d'une commande. */
export async function recordValidationResult(
  db: DatabaseClient,
  batchId: string,
  input: {
    position: number;
    commandId: string | null;
    command: string;
    status: AutonomousValidationStatus;
    exitCode: number | null;
    durationMs: number | null;
    stdout: string | null;
    stdoutTruncated: boolean;
    stderr: string | null;
    stderrTruncated: boolean;
  },
): Promise<void> {
  await db.autonomousValidationResult.create({
    data: {
      batchId,
      position: input.position,
      commandId: input.commandId,
      command: input.command,
      status: input.status,
      exitCode: input.exitCode,
      durationMs: input.durationMs,
      stdout: input.stdout,
      stdoutTruncated: input.stdoutTruncated,
      stderr: input.stderr,
      stderrTruncated: input.stderrTruncated,
    },
  });
}

/**
 * Conclut un lot a partir de ses resultats.
 *
 * La precedence va du plus grave au moins grave, et elle est unique : une panne
 * d'infrastructure l'emporte sur un echec de commande, parce qu'elle signifie
 * qu'on n'a pas su regarder — ce qui se repare autrement.
 */
export function summarizeBatchStatus(
  statuses: readonly AutonomousValidationStatus[],
): ValidationBatchStatus {
  if (statuses.some((status) => status === AUTONOMOUS_VALIDATION_STATUS.ERROR)) {
    return VALIDATION_BATCH_STATUS.ERROR;
  }
  if (statuses.some(isValidationFailure)) {
    return VALIDATION_BATCH_STATUS.FAILED;
  }
  return VALIDATION_BATCH_STATUS.PASSED;
}

/**
 * Ferme un lot.
 *
 * Conditionnel sur `RUNNING` : un lot deja conclu ne se reecrit pas, et deux
 * conclusions concurrentes n'en produisent qu'une.
 */
export async function completeValidationBatch(
  db: DatabaseClient,
  batchId: string,
  input: {
    status: ValidationBatchStatus;
    trackedStateAfter: string | null;
    /** `null` quand NOX ne sait pas, jamais quand il sait qu'il n'y en a aucun. */
    mutatedFiles?: readonly string[] | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
): Promise<boolean> {
  const updated = await db.autonomousValidationBatch.updateMany({
    where: { id: batchId, status: { in: [VALIDATION_BATCH_STATUS.PENDING, VALIDATION_BATCH_STATUS.RUNNING] } },
    data: {
      status: input.status,
      completedAt: new Date(),
      trackedStateAfter: input.trackedStateAfter,
      mutatedFiles:
        input.mutatedFiles === undefined || input.mutatedFiles === null
          ? null
          : input.mutatedFiles.join("\n"),
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
    },
  });
  return updated.count === 1;
}

function toResultRow(row: {
  id: string;
  position: number;
  commandId: string | null;
  command: string;
  status: string;
  exitCode: number | null;
  durationMs: number | null;
  stdout: string | null;
  stdoutTruncated: boolean;
  stderr: string | null;
  stderrTruncated: boolean;
}): AutonomousValidationResultRow {
  return {
    ...row,
    status: isAutonomousValidationStatus(row.status)
      ? row.status
      : AUTONOMOUS_VALIDATION_STATUS.ERROR,
  };
}

/** Le dernier lot d'une execution, avec ses resultats, ou `null`. */
export async function getLatestValidationBatch(
  db: DatabaseClient,
  runId: string,
): Promise<AutonomousValidationBatchRow | null> {
  const batch = await db.autonomousValidationBatch.findFirst({
    where: { runId },
    orderBy: { attempt: "desc" },
    include: { results: { orderBy: { position: "asc" } } },
  });
  if (batch === null) {
    return null;
  }
  return {
    id: batch.id,
    runId: batch.runId,
    attempt: batch.attempt,
    status: readBatchStatus(batch.status),
    createdAt: batch.createdAt,
    startedAt: batch.startedAt,
    completedAt: batch.completedAt,
    errorCode: batch.errorCode,
    errorMessage: batch.errorMessage,
    trackedStateBefore: batch.trackedStateBefore,
    trackedStateAfter: batch.trackedStateAfter,
    mutatedFiles: readMutatedFiles(batch.mutatedFiles),
    results: batch.results.map(toResultRow),
  };
}

/** Tous les lots d'une execution, du plus recent au plus ancien. */
export async function listValidationBatches(
  db: DatabaseClient,
  runId: string,
): Promise<AutonomousValidationBatchRow[]> {
  const batches = await db.autonomousValidationBatch.findMany({
    where: { runId },
    orderBy: { attempt: "desc" },
    include: { results: { orderBy: { position: "asc" } } },
  });
  return batches.map((batch) => ({
    id: batch.id,
    runId: batch.runId,
    attempt: batch.attempt,
    status: readBatchStatus(batch.status),
    createdAt: batch.createdAt,
    startedAt: batch.startedAt,
    completedAt: batch.completedAt,
    errorCode: batch.errorCode,
    errorMessage: batch.errorMessage,
    trackedStateBefore: batch.trackedStateBefore,
    trackedStateAfter: batch.trackedStateAfter,
    mutatedFiles: readMutatedFiles(batch.mutatedFiles),
    results: batch.results.map(toResultRow),
  }));
}

/**
 * Relit la liste des fichiers modifies par une validation.
 *
 * `null` reste `null` : un lot anterieur a TASK-028 ne dit pas « aucun fichier »,
 * il ne dit rien. Une chaine vide, elle, veut bien dire « aucun ».
 */
function readMutatedFiles(value: string | null): string[] | null {
  if (value === null) {
    return null;
  }
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}
