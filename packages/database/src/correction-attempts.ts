/**
 * Reservation et suivi des corrections.
 *
 * ## Le point de serialisation
 *
 * Une validation qui echoue peut etre constatee plusieurs fois — deux onglets,
 * un sondage et un rendu, deux serveurs. Chacune de ces constatations voudrait
 * relancer Claude Code, et un humain peut cliquer `Request changes` au meme
 * instant. Une seule doit y arriver.
 *
 * La garantie est l'index unique `(sourceRunId, attempt)`, pas une verification
 * prealable : `reserveCorrection` **ecrit d'abord**, et le perdant recoit une
 * violation de contrainte plutot qu'un feu vert. Un verrou en memoire n'aurait
 * survecu ni a un redemarrage, ni a deux processus.
 *
 * ## Pourquoi la reservation precede le lancement
 *
 * Parce que le moment dangereux est entre « NOX decide de corriger » et
 * « l'execution existe ». Un arret du serveur web dans cet intervalle laisserait,
 * sans reservation, un echec qu'une seconde constatation relancerait. Avec elle,
 * la decision est ecrite : la reprise explicite consomme la reservation existante
 * au lieu d'en creer une deuxieme.
 *
 * ## Ce module ne lance rien
 *
 * Ni Claude Code, ni le runner, ni une commande, ni un fournisseur. Il enregistre
 * une decision prise ailleurs, et refuse la seconde.
 */

import {
  CORRECTION_ATTEMPT_STATUS,
  CORRECTION_SOURCE,
  RUN_KIND,
  RUN_STATUS,
  isCorrectionAttemptStatus,
  isCorrectionSource,
  type CorrectionAttemptStatus,
  type CorrectionRefusalCode,
  type CorrectionSource,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";
import { countActiveRepositoryRuns } from "./repository-lock.js";
import { markQueueEntryStarted } from "./task-queue.js";
import { getRunById } from "./runs.js";
import type { DevelopmentRunDetail } from "@nox/shared";

/** Une reservation de correction, telle qu'elle est relue. */
export type CorrectionAttemptRow = {
  id: string;
  taskId: string;
  sourceRunId: string;
  sourceBatchId: string | null;
  source: CorrectionSource;
  attempt: number;
  automatedAttempt: number | null;
  status: CorrectionAttemptStatus;
  refusalCode: string | null;
  createdAt: Date;
  launchedAt: Date | null;
  abandonedAt: Date | null;
  correctionRunId: string | null;
  feedbackId: string | null;
};

type AttemptRecord = {
  id: string;
  taskId: string;
  sourceRunId: string;
  sourceBatchId: string | null;
  source: string;
  attempt: number;
  automatedAttempt: number | null;
  status: string;
  refusalCode: string | null;
  createdAt: Date;
  launchedAt: Date | null;
  abandonedAt: Date | null;
  correctionRunId: string | null;
  feedbackId: string | null;
};

/**
 * Une source illisible devient `HUMAN_FEEDBACK`.
 *
 * C'est celle qui ne pretend rien de plus qu'une decision prise par quelqu'un,
 * et qui ne peut donc pas faire croire que NOX detenait une preuve. Le defaut
 * sur, comme partout ailleurs dans NOX : il n'accorde rien.
 */
function readSource(value: string): CorrectionSource {
  return isCorrectionSource(value) ? value : CORRECTION_SOURCE.HUMAN_FEEDBACK;
}

/** Un statut illisible devient `ABANDONED` : il n'occupe plus la place. */
function readStatus(value: string): CorrectionAttemptStatus {
  return isCorrectionAttemptStatus(value) ? value : CORRECTION_ATTEMPT_STATUS.ABANDONED;
}

function toRow(record: AttemptRecord): CorrectionAttemptRow {
  return {
    id: record.id,
    taskId: record.taskId,
    sourceRunId: record.sourceRunId,
    sourceBatchId: record.sourceBatchId,
    source: readSource(record.source),
    attempt: record.attempt,
    automatedAttempt: record.automatedAttempt,
    status: readStatus(record.status),
    refusalCode: record.refusalCode,
    createdAt: record.createdAt,
    launchedAt: record.launchedAt,
    abandonedAt: record.abandonedAt,
    correctionRunId: record.correctionRunId,
    feedbackId: record.feedbackId,
  };
}

/** Levee dans la transaction pour annuler une reservation en double. */
class CorrectionAlreadyReservedError extends Error {
  constructor() {
    super("Une correction est deja reservee sur cette execution.");
    this.name = "CorrectionAlreadyReservedError";
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

export type ReserveCorrectionResult =
  | { ok: true; attempt: CorrectionAttemptRow }
  | { ok: false; reason: "already_reserved" | "run_not_found" };

/**
 * Reserve une correction sur une execution relue.
 *
 * Refusee des qu'une reservation non abandonnee occupe deja cette execution :
 * c'est ce qui fait qu'une correction automatique et un `Request changes`
 * humain simultanes n'en produisent qu'une, et que le perdant recoit un refus
 * nomme plutot qu'une exception brute.
 *
 * L'ecriture est le verrou. La lecture prealable ne sert qu'a produire un refus
 * lisible ; c'est l'index unique qui tranche les cas simultanes.
 */
export async function reserveCorrection(
  db: DatabaseClient,
  input: {
    taskId: string;
    sourceRunId: string;
    sourceBatchId?: string | null;
    source: CorrectionSource;
    /** Rang affiche d'une correction automatique, ou `null` pour un humain. */
    automatedAttempt?: number | null;
    feedbackId?: string | null;
  },
): Promise<ReserveCorrectionResult> {
  const outcome = await db
    .$transaction(async (tx): Promise<{ ok: true; id: string } | { ok: false; reason: "already_reserved" | "run_not_found" }> => {
      const run = await tx.run.findUnique({
        where: { id: input.sourceRunId },
        select: { id: true, taskId: true },
      });
      if (run === null || run.taskId !== input.taskId) {
        return { ok: false, reason: "run_not_found" };
      }

      const existing = await tx.correctionAttempt.findMany({
        where: { sourceRunId: input.sourceRunId },
        select: { attempt: true, status: true },
        orderBy: { attempt: "desc" },
      });

      const held = existing.some(
        (row) => readStatus(row.status) !== CORRECTION_ATTEMPT_STATUS.ABANDONED,
      );
      if (held) {
        return { ok: false, reason: "already_reserved" };
      }

      const attempt = (existing[0]?.attempt ?? 0) + 1;

      const created = await tx.correctionAttempt
        .create({
          data: {
            taskId: input.taskId,
            sourceRunId: input.sourceRunId,
            sourceBatchId: input.sourceBatchId ?? null,
            source: input.source,
            attempt,
            automatedAttempt: input.automatedAttempt ?? null,
            status: CORRECTION_ATTEMPT_STATUS.RESERVED,
            feedbackId: input.feedbackId ?? null,
          },
          select: { id: true },
        })
        .catch((error: unknown) => {
          if (isUniqueViolation(error)) {
            throw new CorrectionAlreadyReservedError();
          }
          throw error;
        });

      return { ok: true, id: created.id };
    })
    .catch((error: unknown) => {
      if (error instanceof CorrectionAlreadyReservedError) {
        return { ok: false, reason: "already_reserved" } as const;
      }
      throw error;
    });

  if (!outcome.ok) {
    return outcome;
  }

  const row = await getCorrectionAttempt(db, outcome.id);
  return row === null ? { ok: false, reason: "run_not_found" } : { ok: true, attempt: row };
}

/** Retourne une reservation, ou `null`. */
export async function getCorrectionAttempt(
  db: DatabaseClient,
  attemptId: string,
): Promise<CorrectionAttemptRow | null> {
  const row = await db.correctionAttempt.findUnique({ where: { id: attemptId } });
  return row === null ? null : toRow(row);
}

/** Reservation qui occupe une execution source, ou `null`. */
export async function getHeldCorrection(
  db: DatabaseClient,
  sourceRunId: string,
): Promise<CorrectionAttemptRow | null> {
  const rows = await db.correctionAttempt.findMany({
    where: { sourceRunId },
    orderBy: { attempt: "desc" },
  });
  const held = rows.find(
    (row) => readStatus(row.status) !== CORRECTION_ATTEMPT_STATUS.ABANDONED,
  );
  return held === undefined ? null : toRow(held);
}

/** Reservation dont une execution de correction est nee, ou `null`. */
export async function getCorrectionAttemptForRun(
  db: DatabaseClient,
  correctionRunId: string,
): Promise<CorrectionAttemptRow | null> {
  const row = await db.correctionAttempt.findUnique({ where: { correctionRunId } });
  return row === null ? null : toRow(row);
}

/** Toutes les reservations d'une tache, de la plus ancienne a la plus recente. */
export async function listCorrectionAttempts(
  db: DatabaseClient,
  taskId: string,
): Promise<CorrectionAttemptRow[]> {
  const rows = await db.correctionAttempt.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toRow);
}

/**
 * Rend une reservation sans avoir rien lance.
 *
 * Conditionnel sur `RESERVED` : une reservation deja consommee ne se rend pas,
 * et deux abandons concurrents n'en ecrivent qu'un. La ligne reste — elle
 * raconte qu'une correction avait ete decidee puis rendue, et pourquoi. Une
 * reservation suivante prendra le rang d'apres.
 */
export async function abandonCorrection(
  db: DatabaseClient,
  attemptId: string,
  refusalCode: CorrectionRefusalCode | string,
): Promise<boolean> {
  const updated = await db.correctionAttempt.updateMany({
    where: { id: attemptId, status: CORRECTION_ATTEMPT_STATUS.RESERVED },
    data: {
      status: CORRECTION_ATTEMPT_STATUS.ABANDONED,
      abandonedAt: new Date(),
      refusalCode,
    },
  });
  return updated.count === 1;
}

export type StartCorrectionResult =
  | { ok: true; run: DevelopmentRunDetail }
  | { ok: false; reason: "not_found" | "already_used" | "mismatch" | "active_run" };

/** Levee dans la transaction pour annuler la creation d'un run en double. */
class CorrectionAlreadyLaunchedError extends Error {
  constructor() {
    super("Cette reservation a deja lance une correction.");
    this.name = "CorrectionAlreadyLaunchedError";
  }
}

/** Levee dans la transaction quand le repository travaille deja. */
class RepositoryBusyError extends Error {
  constructor() {
    super("Ce repository possede deja une execution active.");
    this.name = "RepositoryBusyError";
  }
}

/**
 * Cree l'execution de correction et consomme la reservation, en une transaction.
 *
 * Les ecritures sont indissociables. Un run cree sans reservation consommee
 * autoriserait un second lancement ; une reservation consommee sans run
 * laisserait une correction annoncee qui n'existe pas.
 *
 * Trois verrous, et ils se doublent volontairement :
 *
 * 1. la mise a jour de la reservation est **conditionnelle** sur `RESERVED` ;
 * 2. `Run.parentRunId` est unique — une execution n'est corrigee qu'une fois ;
 * 3. `CorrectionAttempt.correctionRunId` est unique.
 *
 * Le premier suffit dans le cas ordinaire ; les deux autres tiennent meme si
 * quelqu'un appelle Prisma directement.
 *
 * S'y ajoute, depuis TASK-031, l'exclusion par repository : une correction est
 * une **nouvelle execution**, et la regle « au plus une execution active par
 * repository canonique » ne connait pas d'exception. Elle est verifiee ici,
 * apres l'ecriture et dans la meme transaction, exactement comme dans
 * `createRun` — verifier avant d'ecrire laisserait passer deux appels
 * simultanes. Une execution active dans un **autre** repository ne refuse rien.
 */
export async function startCorrectionRun(
  db: DatabaseClient,
  input: {
    attemptId: string;
    taskId: string;
    parentRunId: string;
    prompt: string;
    promptSha256: string;
    runnerRunId: string;
    resumedFromSessionId: string;
  },
): Promise<StartCorrectionResult> {
  const outcome = await db
    .$transaction(async (tx) => {
      const owner = await tx.task.findUnique({
        where: { id: input.taskId },
        select: { projectId: true },
      });
      if (owner === null) {
        return { ok: false, reason: "not_found" } as const;
      }

      const attempt = await tx.correctionAttempt.findUnique({
        where: { id: input.attemptId },
        select: {
          id: true,
          taskId: true,
          sourceRunId: true,
          status: true,
          feedbackId: true,
          correctionRunId: true,
        },
      });
      if (attempt === null) {
        return { ok: false, reason: "not_found" } as const;
      }
      if (attempt.taskId !== input.taskId || attempt.sourceRunId !== input.parentRunId) {
        // La reservation ne decrit pas l'execution qu'on pretend corriger :
        // refus, et surtout pas une correction silencieuse des identifiants.
        return { ok: false, reason: "mismatch" } as const;
      }
      if (
        attempt.correctionRunId !== null ||
        readStatus(attempt.status) !== CORRECTION_ATTEMPT_STATUS.RESERVED
      ) {
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

      const claimed = await tx.correctionAttempt.updateMany({
        where: { id: input.attemptId, status: CORRECTION_ATTEMPT_STATUS.RESERVED },
        data: {
          status: CORRECTION_ATTEMPT_STATUS.LAUNCHED,
          launchedAt: new Date(),
          correctionRunId: run.id,
        },
      });
      if (claimed.count !== 1) {
        throw new CorrectionAlreadyLaunchedError();
      }

      // Le feedback humain est consomme dans la meme transaction, et de facon
      // conditionnelle : un feedback vaut pour une seule correction, et c'est
      // toujours cet index unique qui le garantit.
      if (attempt.feedbackId !== null) {
        const used = await tx.reviewFeedback.updateMany({
          where: { id: attempt.feedbackId, correctionRunId: null },
          data: { correctionRunId: run.id, usedAt: new Date() },
        });
        if (used.count !== 1) {
          throw new CorrectionAlreadyLaunchedError();
        }
      }

      // Meme exclusion que pour un lancement initial, et pour la meme raison :
      // deux Claude Code sur un meme dossier se marcheraient dessus. L'ecriture
      // precede le comptage, sinon deux appels simultanes liraient tous les deux
      // « aucune execution active ».
      const active = await countActiveRepositoryRuns(tx, owner.projectId, run.id);
      if (active > 0) {
        throw new RepositoryBusyError();
      }

      // Meme marquage que pour un lancement initial : une correction est une
      // execution nee d'une tache qui peut etre inscrite. `startedAt` ne bouge
      // plus une fois pose — le premier depart date l'inscription.
      await markQueueEntryStarted(tx, input.taskId);

      return { ok: true, runId: run.id } as const;
    })
    .catch((error: unknown) => {
      if (error instanceof CorrectionAlreadyLaunchedError) {
        return { ok: false, reason: "already_used" } as const;
      }
      if (error instanceof RepositoryBusyError) {
        return { ok: false, reason: "active_run" } as const;
      }
      throw error;
    });

  if (!outcome.ok) {
    return outcome;
  }

  const run = await getRunById(db, outcome.runId);
  return run === null ? { ok: false, reason: "not_found" } : { ok: true, run };
}

/**
 * Les executions du cycle de travail courant, de la plus ancienne a la plus
 * recente.
 *
 * ## Pourquoi une chaine plutot qu'un comptage
 *
 * Parce qu'une tache peut avoir eu une histoire avant celle-ci : un premier
 * lancement, une review, une reouverture, un second lancement. `runCount` les
 * melange tous, et une borne calculee dessus refuserait une correction
 * legitime — ou en autoriserait une de trop. Le cycle courant est la suite
 * d'executions reliees par `parentRunId` jusqu'a l'execution initiale dont
 * elles descendent.
 *
 * La chaine se lit vers l'arriere, ce qui la rend insensible a l'ordre des
 * numeros : une correction pointe toujours son parent, et une execution
 * initiale n'en a pas.
 */
export async function readCorrectionChain(
  db: DatabaseClient,
  runId: string,
): Promise<string[]> {
  const start = await db.run.findUnique({
    where: { id: runId },
    select: { id: true, taskId: true },
  });
  if (start === null) {
    return [];
  }

  const all = await db.run.findMany({
    where: { taskId: start.taskId },
    select: { id: true, parentRunId: true },
  });
  const parents = new Map(all.map((row) => [row.id, row.parentRunId]));

  const chain: string[] = [];
  let cursor: string | null = runId;
  const seen = new Set<string>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return chain.reverse();
}
