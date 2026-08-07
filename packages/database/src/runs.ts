/**
 * Acces aux donnees des executions.
 *
 * Comme pour les projets et les taches, le client Prisma est passe en parametre
 * et les fonctions retournent des types metier de `@nox/shared`.
 *
 * ## Ce module possede une regle a lui
 *
 * **Un etat final ne redevient jamais actif.** C'est ce qui rend le polling
 * idempotent : le web interroge le runner en boucle, et rien ne garantit que
 * deux reponses arrivent dans l'ordre ou qu'un onglet oublie ne rejoue pas une
 * reponse perimee. Sans cette regle, une reponse tardive pourrait rouvrir une
 * execution que la base avait deja conclue — et remettre la tache en `RUNNING`
 * alors que l'utilisateur relit deja son resultat.
 */

import {
  ACTIVE_RUN_STATUSES,
  RUN_LIMITS,
  RUN_STATUS,
  TASK_STATUS,
  boundTail,
  boundText,
  canAutomateTaskStatusTransition,
  formatRunCode,
  isFinalRunStatus,
  isRunStatus,
  isTaskStatus,
  taskStatusForRunOutcome,
  type DevelopmentRunDetail,
  type DevelopmentRunSummary,
  type RunStatus,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Donnees necessaires a la creation d'une execution. */
export type CreateRunInput = {
  taskId: string;
  prompt: string;
  promptSha256: string;
  runnerRunId: string;
};

/** Etat Git rapporte par le runner. */
export type RunGitInput = {
  branch?: string | null;
  upstream?: string | null;
  headBefore?: string | null;
  headAfter?: string | null;
  diffStat?: string | null;
  changedFiles?: readonly string[] | null;
};

/**
 * Resultat d'une execution, tel que le runner le rapporte.
 *
 * Tous les champs sont facultatifs : une version de Claude Code peut ne pas
 * fournir un cout ou un identifiant de session, et NOX n'en invente aucun.
 */
export type RunOutcomeInput = {
  startedAt?: Date | null;
  finishedAt?: Date | null;
  exitCode?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  stderrTail?: string | null;
  resultText?: string | null;
  claudeSessionId?: string | null;
  durationMs?: number | null;
  durationApiMs?: number | null;
  numTurns?: number | null;
  reportedCostUsd?: number | null;
  cancellationRequestedAt?: Date | null;
  git?: RunGitInput;
};

/**
 * Levee lorsqu'une ligne stockee ne correspond plus au contrat metier.
 * Traduit une base modifiee hors de NOX, pas une erreur utilisateur.
 */
export class InvalidRunRecordError extends Error {
  constructor(id: string, field: string, value: string) {
    super(`Execution ${id} : ${field} "${value}" inconnu.`);
    this.name = "InvalidRunRecordError";
  }
}

type SummaryRow = {
  id: string;
  sequence: number;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  durationMs: number | null;
};

type DetailRow = SummaryRow & {
  taskId: string;
  prompt: string;
  promptSha256: string;
  runnerRunId: string;
  claudeSessionId: string | null;
  resultText: string | null;
  stderrTail: string | null;
  exitCode: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  durationApiMs: number | null;
  numTurns: number | null;
  reportedCostUsd: number | null;
  gitBranch: string | null;
  gitUpstream: string | null;
  gitHeadBefore: string | null;
  gitHeadAfter: string | null;
  gitDiffStat: string | null;
  changedFiles: string | null;
  cancellationRequestedAt: Date | null;
  updatedAt: Date;
};

/** Colonnes suffisantes a l'historique : ni prompt, ni compte rendu. */
const SUMMARY_SELECT = {
  id: true,
  sequence: true,
  status: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  durationMs: true,
} as const;

function readStatus(row: { id: string; status: string }): RunStatus {
  if (!isRunStatus(row.status)) {
    throw new InvalidRunRecordError(row.id, "statut", row.status);
  }
  return row.status;
}

function toSummary(row: SummaryRow): DevelopmentRunSummary {
  if (!Number.isInteger(row.sequence) || row.sequence < 1) {
    throw new InvalidRunRecordError(row.id, "numero", String(row.sequence));
  }

  return {
    id: row.id,
    code: formatRunCode(row.sequence),
    status: readStatus(row),
    startedAt: row.startedAt === null ? null : row.startedAt.toISOString(),
    finishedAt: row.finishedAt === null ? null : row.finishedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    durationMs: row.durationMs,
  };
}

/** Les fichiers modifies sont stockes en une colonne, un chemin par ligne. */
function readChangedFiles(value: string | null): string[] {
  if (value === null || value.trim() === "") {
    return [];
  }
  return value.split("\n").filter((entry) => entry !== "");
}

function toDetail(row: DetailRow): DevelopmentRunDetail {
  return {
    ...toSummary(row),
    taskId: row.taskId,
    prompt: row.prompt,
    promptSha256: row.promptSha256,
    runnerRunId: row.runnerRunId,
    claude: {
      resultText: row.resultText,
      sessionId: row.claudeSessionId,
      durationMs: row.durationMs,
      durationApiMs: row.durationApiMs,
      numTurns: row.numTurns,
      reportedCostUsd: row.reportedCostUsd,
      exitCode: row.exitCode,
    },
    git: {
      branch: row.gitBranch,
      upstream: row.gitUpstream,
      headBefore: row.gitHeadBefore,
      headAfter: row.gitHeadAfter,
      diffStat: row.gitDiffStat,
      changedFiles: readChangedFiles(row.changedFiles),
    },
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    stderrTail: row.stderrTail,
    cancellationRequestedAt:
      row.cancellationRequestedAt === null ? null : row.cancellationRequestedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Traduit un resultat en colonnes, en bornant tout ce qui vient du processus.
 *
 * Les bornes sont appliquees ici, au dernier moment avant l'ecriture : c'est le
 * seul point par lequel passe forcement tout contenu venu de l'exterieur.
 */
function toColumns(outcome: RunOutcomeInput): Record<string, unknown> {
  const columns: Record<string, unknown> = {};

  if (outcome.startedAt !== undefined) columns["startedAt"] = outcome.startedAt;
  if (outcome.finishedAt !== undefined) columns["finishedAt"] = outcome.finishedAt;
  if (outcome.exitCode !== undefined) columns["exitCode"] = outcome.exitCode;
  if (outcome.claudeSessionId !== undefined) columns["claudeSessionId"] = outcome.claudeSessionId;
  if (outcome.durationMs !== undefined) columns["durationMs"] = outcome.durationMs;
  if (outcome.durationApiMs !== undefined) columns["durationApiMs"] = outcome.durationApiMs;
  if (outcome.numTurns !== undefined) columns["numTurns"] = outcome.numTurns;
  if (outcome.reportedCostUsd !== undefined) {
    columns["reportedCostUsd"] = outcome.reportedCostUsd;
  }
  if (outcome.errorCode !== undefined) columns["errorCode"] = outcome.errorCode;
  if (outcome.cancellationRequestedAt !== undefined) {
    columns["cancellationRequestedAt"] = outcome.cancellationRequestedAt;
  }

  if (outcome.errorMessage !== undefined) {
    columns["errorMessage"] =
      outcome.errorMessage === null
        ? null
        : boundText(outcome.errorMessage, RUN_LIMITS.errorMessage);
  }
  if (outcome.resultText !== undefined) {
    columns["resultText"] =
      outcome.resultText === null ? null : boundText(outcome.resultText, RUN_LIMITS.resultText);
  }
  // La **fin** de la sortie d'erreur est conservee : c'est elle qui porte la
  // cause, le debut n'etant souvent qu'un preambule.
  if (outcome.stderrTail !== undefined) {
    columns["stderrTail"] =
      outcome.stderrTail === null ? null : boundTail(outcome.stderrTail, RUN_LIMITS.stderrTail);
  }

  const git = outcome.git;
  if (git !== undefined) {
    if (git.branch !== undefined) columns["gitBranch"] = git.branch;
    if (git.upstream !== undefined) columns["gitUpstream"] = git.upstream;
    if (git.headBefore !== undefined) columns["gitHeadBefore"] = git.headBefore;
    if (git.headAfter !== undefined) columns["gitHeadAfter"] = git.headAfter;
    if (git.diffStat !== undefined) {
      columns["gitDiffStat"] =
        git.diffStat === null ? null : boundText(git.diffStat, RUN_LIMITS.gitDiffStat);
    }
    if (git.changedFiles !== undefined) {
      columns["changedFiles"] =
        git.changedFiles === null
          ? null
          : git.changedFiles.slice(0, RUN_LIMITS.changedFiles).join("\n");
    }
  }

  return columns;
}

/** Retourne les executions d'une tache, de la plus recente a la plus ancienne. */
export async function listRunsByTask(
  db: DatabaseClient,
  taskId: string,
): Promise<DevelopmentRunSummary[]> {
  const rows = await db.run.findMany({
    where: { taskId },
    select: SUMMARY_SELECT,
    orderBy: { sequence: "desc" },
  });
  return rows.map(toSummary);
}

/** Retourne une execution complete, ou `null` si elle n'existe pas. */
export async function getRunById(
  db: DatabaseClient,
  runId: string,
): Promise<DevelopmentRunDetail | null> {
  const row = await db.run.findUnique({ where: { id: runId } });
  return row === null ? null : toDetail(row);
}

/**
 * Cree une execution au statut `QUEUED`.
 *
 * Le numero vient de `Task.nextRunSequence`, incremente par un ordre SQL
 * atomique dans la meme transaction — exactement comme les numeros de tache.
 * `count() + 1` reattribuerait `RUN-002` des qu'une execution disparaitrait, et
 * deux lancements simultanes liraient le meme total.
 *
 * Retourne `null` si la tache n'existe pas.
 */
export async function createRun(
  db: DatabaseClient,
  input: CreateRunInput,
): Promise<DevelopmentRunDetail | null> {
  const row = await db.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: input.taskId }, select: { id: true } });
    if (task === null) {
      return null;
    }

    const reserved = await tx.task.update({
      where: { id: input.taskId },
      data: { nextRunSequence: { increment: 1 } },
      select: { nextRunSequence: true },
    });

    return tx.run.create({
      data: {
        taskId: input.taskId,
        sequence: reserved.nextRunSequence - 1,
        status: RUN_STATUS.QUEUED,
        prompt: input.prompt,
        promptSha256: input.promptSha256,
        runnerRunId: input.runnerRunId,
      },
    });
  });

  return row === null ? null : toDetail(row);
}

/**
 * Marque une execution comme reellement demarree.
 *
 * Sans effet si l'execution a deja atteint un etat final : une reponse tardive
 * du runner ne doit pas rouvrir ce qui est clos.
 */
export async function markRunRunning(
  db: DatabaseClient,
  runId: string,
  startedAt: Date,
  git: RunGitInput = {},
): Promise<DevelopmentRunDetail | null> {
  return db.$transaction(async (tx) => {
    const current = await tx.run.findUnique({ where: { id: runId } });
    if (current === null) {
      return null;
    }
    if (isFinalRunStatus(readStatus(current))) {
      return toDetail(current);
    }

    const row = await tx.run.update({
      where: { id: runId },
      data: {
        status: RUN_STATUS.RUNNING,
        startedAt: current.startedAt ?? startedAt,
        ...toColumns({ git }),
      },
    });
    return toDetail(row);
  });
}

/**
 * Applique un etat final a une execution, et le repercute sur sa tache.
 *
 * Les deux ecritures vivent dans la meme transaction : un run conclu dont la
 * tache serait restee `RUNNING` afficherait un travail en cours qui n'existe
 * plus, et rien ne le corrigerait ensuite.
 *
 * La transition de la tache passe par `canAutomateTaskStatusTransition` : une
 * tache que l'utilisateur aurait deja fait sortir de `RUNNING` n'est pas
 * ecrasee.
 */
async function finalizeRun(
  db: DatabaseClient,
  runId: string,
  status: RunStatus,
  outcome: RunOutcomeInput,
): Promise<DevelopmentRunDetail | null> {
  return db.$transaction(async (tx) => {
    const current = await tx.run.findUnique({ where: { id: runId } });
    if (current === null) {
      return null;
    }

    // Idempotence : le premier etat final gagne. Les suivants sont ignores.
    if (isFinalRunStatus(readStatus(current))) {
      return toDetail(current);
    }

    const row = await tx.run.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: outcome.finishedAt ?? new Date(),
        ...toColumns(outcome),
      },
    });

    const nextTaskStatus = taskStatusForRunOutcome(status);
    if (nextTaskStatus !== null) {
      const task = await tx.task.findUnique({
        where: { id: current.taskId },
        select: { id: true, status: true },
      });

      if (task !== null && isTaskStatus(task.status)) {
        if (canAutomateTaskStatusTransition(task.status, nextTaskStatus)) {
          await tx.task.update({ where: { id: task.id }, data: { status: nextTaskStatus } });
        }
      }
    }

    return toDetail(row);
  });
}

/** L'execution s'est terminee normalement : la tache passe en relecture. */
export function completeRun(
  db: DatabaseClient,
  runId: string,
  outcome: RunOutcomeInput = {},
): Promise<DevelopmentRunDetail | null> {
  return finalizeRun(db, runId, RUN_STATUS.COMPLETED, outcome);
}

/** L'execution a echoue : la tache passe en echec. */
export function failRun(
  db: DatabaseClient,
  runId: string,
  outcome: RunOutcomeInput = {},
): Promise<DevelopmentRunDetail | null> {
  return finalizeRun(db, runId, RUN_STATUS.FAILED, outcome);
}

/** L'execution est bloquee — limite Claude, delai depasse, suivi perdu. */
export function blockRun(
  db: DatabaseClient,
  runId: string,
  outcome: RunOutcomeInput = {},
): Promise<DevelopmentRunDetail | null> {
  return finalizeRun(db, runId, RUN_STATUS.BLOCKED, outcome);
}

/**
 * Enregistre qu'un arret a ete demande.
 *
 * N'est **pas** une finalisation : le processus vit encore, et la tache reste
 * `RUNNING`. Ce que cette fonction ecrit, c'est le fait qu'un humain a decide
 * d'interrompre — un fait que rien d'autre ne porte, et qui doit survivre a un
 * redemarrage du runner.
 *
 * Sans effet sur une execution deja terminee : une annulation arrivee trop tard
 * ne doit pas rouvrir ce qui est clos, ni reecrire le statut qui l'a conclue.
 */
export async function markRunCancelling(
  db: DatabaseClient,
  runId: string,
  requestedAt: Date,
): Promise<DevelopmentRunDetail | null> {
  return db.$transaction(async (tx) => {
    const current = await tx.run.findUnique({ where: { id: runId } });
    if (current === null) {
      return null;
    }
    if (isFinalRunStatus(readStatus(current))) {
      return toDetail(current);
    }

    const row = await tx.run.update({
      where: { id: runId },
      data: {
        status: RUN_STATUS.CANCELLING,
        // La premiere demande fait foi : un second clic ne redate pas la
        // decision, il la repete.
        cancellationRequestedAt: current.cancellationRequestedAt ?? requestedAt,
      },
    });
    return toDetail(row);
  });
}

/**
 * Etat rapporte par le runner, deja traduit en vocabulaire metier.
 *
 * Le web ne transmet pas la reponse HTTP brute : il en extrait ce qui a du sens
 * pour la base, et c'est cette forme-la qui circule.
 */
export type RunnerRunReport = RunOutcomeInput & { status: RunStatus };

/**
 * Reconcilie une execution avec ce que le runner en dit.
 *
 * Seul point d'ecriture du polling. Idempotent par construction : appele deux
 * fois avec le meme rapport, il produit le meme etat ; appele avec un rapport
 * perime apres un etat final, il ne change rien.
 */
export function updateRunFromRunner(
  db: DatabaseClient,
  runId: string,
  report: RunnerRunReport,
): Promise<DevelopmentRunDetail | null> {
  const { status, ...outcome } = report;

  if (isFinalRunStatus(status)) {
    return finalizeRun(db, runId, status, outcome);
  }

  if (status === RUN_STATUS.RUNNING) {
    return markRunRunning(db, runId, outcome.startedAt ?? new Date(), outcome.git ?? {});
  }

  if (status === RUN_STATUS.CANCELLING) {
    return markRunCancelling(db, runId, outcome.cancellationRequestedAt ?? new Date());
  }

  // `QUEUED` : le runner a accepte l'execution mais le processus n'a pas encore
  // demarre. Rien a ecrire — la ligne est deja dans cet etat.
  return getRunById(db, runId);
}

/**
 * Indique si une tache a une execution active.
 *
 * La V1 n'autorise qu'un seul run actif, tous projets confondus ; cette fonction
 * repond a la question locale, l'unicite globale etant tranchee par le runner,
 * seul a voir le processus reel.
 */
export async function hasActiveRun(db: DatabaseClient, taskId: string): Promise<boolean> {
  const active = await db.run.findFirst({
    // `CANCELLING` compte comme actif : le processus n'est pas mort, et rien ne
    // doit pouvoir en lancer un second pendant qu'il ferme.
    where: { taskId, status: { in: [...ACTIVE_RUN_STATUSES] } },
    select: { id: true },
  });
  return active !== null;
}

/**
 * Marque une tache comme en cours d'execution.
 *
 * Passe par la table des transitions automatisees : `READY → RUNNING` est la
 * seule entree possible, et elle n'est jamais accessible a un clic.
 */
export async function startTaskExecution(
  db: DatabaseClient,
  taskId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId }, select: { status: true } });
    if (task === null || !isTaskStatus(task.status)) {
      return false;
    }
    if (!canAutomateTaskStatusTransition(task.status, TASK_STATUS.RUNNING)) {
      return false;
    }
    await tx.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.RUNNING } });
    return true;
  });
}

/**
 * Ramene une tache a `READY` apres un lancement refuse avant demarrage.
 *
 * Sans cela, un refus du runner laisserait la tache en `RUNNING` pour un
 * processus qui n'a jamais existe.
 */
export async function cancelTaskExecution(db: DatabaseClient, taskId: string): Promise<void> {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { status: true } });
  if (task !== null && task.status === TASK_STATUS.RUNNING) {
    await db.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.READY } });
  }
}
