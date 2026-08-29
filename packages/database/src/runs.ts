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
import { countActiveRepositoryRuns } from "./repository-lock.js";
import { markQueueEntryStarted } from "./task-queue.js";

/** Donnees necessaires a la creation d'une execution. */
export type CreateRunInput = {
  /** Relu dans la transaction : une tache d'un autre projet est introuvable. */
  projectId: string;
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
  kind: string;
};

type DetailRow = SummaryRow & {
  taskId: string;
  parentRunId: string | null;
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
  kind: true,
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
    kind: row.kind,
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
    parentRunId: row.parentRunId,
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

/**
 * Ce qu'il faut savoir de chaque execution d'une tache pour situer le travail.
 *
 * ## Une seule requete, et aucune empreinte
 *
 * Le workflow guide a besoin, pour chaque execution, de savoir si un instantane
 * de review existe, si une session Claude a ete rapportee, si une empreinte de
 * dossier de travail a ete enregistree, et si une correction en est deja nee.
 * Les demander une execution a la fois produirait une requete par ligne sur une
 * page qui en affiche parfois dix.
 *
 * `hasFingerprint` et `hasSession` sont des **booleens**, jamais les valeurs.
 * L'empreinte est un secret derive : elle n'a aucune raison de circuler, et une
 * valeur qu'on n'expose pas ne peut pas fuir.
 */
export type TaskRunFact = {
  id: string;
  /** Derive de `sequence` : `RUN-001`. */
  code: string;
  status: RunStatus;
  /** Valeur de `RunKind`, telle qu'elle est stockee. */
  kind: string;
  parentRunId: string | null;
  errorCode: string | null;
  hasReview: boolean;
  hasSession: boolean;
  hasFingerprint: boolean;
  /** Une correction a deja ete lancee depuis cette execution. */
  hasCorrection: boolean;
};

/** Executions d'une tache, de la plus recente a la plus ancienne. */
export async function listTaskRunFacts(
  db: DatabaseClient,
  taskId: string,
): Promise<TaskRunFact[]> {
  const rows = await db.run.findMany({
    where: { taskId },
    orderBy: { sequence: "desc" },
    select: {
      id: true,
      sequence: true,
      status: true,
      kind: true,
      parentRunId: true,
      errorCode: true,
      reviewCapturedAt: true,
      claudeSessionId: true,
      workspaceFingerprint: true,
    },
  });

  const parents = new Set(
    rows.map((row) => row.parentRunId).filter((value): value is string => value !== null),
  );

  return rows.map((row) => {
    if (!Number.isInteger(row.sequence) || row.sequence < 1) {
      throw new InvalidRunRecordError(row.id, "numero", String(row.sequence));
    }
    return {
      id: row.id,
      code: formatRunCode(row.sequence),
      status: readStatus(row),
      kind: row.kind,
      parentRunId: row.parentRunId,
      errorCode: row.errorCode,
      hasReview: row.reviewCapturedAt !== null,
      hasSession: row.claudeSessionId !== null && row.claudeSessionId.trim() !== "",
      hasFingerprint: row.workspaceFingerprint !== null,
      hasCorrection: parents.has(row.id),
    };
  });
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
export type CreateRunResult =
  | { ok: true; run: DevelopmentRunDetail }
  | { ok: false; reason: "not_found" | "active_run" };

/**
 * Levee pour annuler la transaction quand une autre execution a gagne.
 *
 * Un simple retour en echec **validerait** la transaction, et laisserait la
 * ligne d'execution qu'on vient d'ecrire. Seule une exception la fait annuler.
 * C'est laid, et c'est le seul moyen — la meme mecanique qu'en TASK-024 pour
 * les cycles de dependances, pour la meme raison.
 */
class ConcurrentRunError extends Error {}

/** Levee pour annuler quand la tache n'existe pas sous le verrou. */
class RunPreconditionError extends Error {
  constructor(readonly reason: "not_found") {
    super(reason);
  }
}

export async function createRun(
  db: DatabaseClient,
  input: CreateRunInput,
): Promise<CreateRunResult> {
  return db
    .$transaction(async (tx): Promise<CreateRunResult> => {
      // `projectId` fait partie du filtre : une tache d'un autre projet est
      // introuvable, exactement comme une tache inexistante. Le statut, lui,
      // n'est pas verifie ici : c'est une precondition de workflow, et elle
      // appartient au lanceur. Cette transaction ne garantit qu'une chose, mais
      // elle la garantit vraiment — une seule execution active par repository
      // canonique, projets confondus.
      const task = await tx.task.findFirst({
        where: { id: input.taskId, projectId: input.projectId },
        select: { id: true },
      });
      if (task === null) {
        throw new RunPreconditionError("not_found");
      }

      // L'ecriture d'abord, la verification ensuite. Verifier puis ecrire est
      // faux sous concurrence : deux appels liraient chacun « aucune execution
      // active », et en creeraient deux. En reservant le numero puis en ecrivant
      // la ligne, on prend le verrou d'ecriture de SQLite ; le perdant relit
      // alors une base qui contient deja l'execution du gagnant.
      const reserved = await tx.task.update({
        where: { id: input.taskId },
        data: { nextRunSequence: { increment: 1 } },
        select: { nextRunSequence: true },
      });

      const row = await tx.run.create({
        data: {
          taskId: input.taskId,
          sequence: reserved.nextRunSequence - 1,
          status: RUN_STATUS.QUEUED,
          prompt: input.prompt,
          promptSha256: input.promptSha256,
          runnerRunId: input.runnerRunId,
        },
      });

      // Une seule execution active par repository. C'est le point de
      // serialisation persistant de la file : deux avancements simultanes
      // passent tous les deux les preconditions, mais un seul ressort d'ici avec
      // une execution. Un verrou en memoire ne tiendrait pas un redemarrage, ni
      // deux processus.
      //
      // Le domaine du verrou est le **repository canonique**, pas le projet :
      // deux projets qui viseraient le meme dossier — ce que TASK-025 interdit,
      // mais qu'une base forgee rend possible — restent exclus l'un de l'autre.
      // Deux repositories differents, eux, ne s'attendent plus : c'est ce que
      // TASK-031 change.
      //
      // Le runner refait ce controle de son cote, sur les processus reels. Les
      // deux barrieres sont independantes, et c'est voulu.
      const others = await countActiveRepositoryRuns(tx, input.projectId, row.id);
      if (others > 0) {
        throw new ConcurrentRunError();
      }

      // Si cette tache est inscrite dans une file, son inscription vient de
      // commencer son cycle. Le marquage est **dans** cette transaction : une
      // execution creee sans lui laisserait la file croire, apres une
      // reouverture, qu'elle a affaire a une tache jamais commencee.
      await markQueueEntryStarted(tx, input.taskId);

      return { ok: true, run: toDetail(row) };
    })
    .catch((error: unknown): CreateRunResult => {
      if (error instanceof ConcurrentRunError) {
        return { ok: false, reason: "active_run" };
      }
      if (error instanceof RunPreconditionError) {
        return { ok: false, reason: error.reason };
      }
      throw error;
    });
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
/**
 * Issues d'execution qui retirent l'autorisation permanente de la file.
 *
 * `COMPLETED` n'y figure pas : une execution qui se termine normalement mene la
 * tache en review, ce qui est une etape du travail et non un incident. La file
 * attendra la decision humaine, mais elle reste autorisee.
 */
const PAUSING_RUN_STATUSES: readonly RunStatus[] = [
  RUN_STATUS.FAILED,
  RUN_STATUS.BLOCKED,
  RUN_STATUS.CANCELLED,
];

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

    // Une execution issue de la file qui echoue, se bloque ou est interrompue
    // retire l'autorisation permanente. NOX ne passe **jamais** a la tache
    // suivante apres un echec : un travail qui s'est mal termine demande un
    // regard humain, et l'entree reste en place pour qu'on sache laquelle.
    //
    // Ce controle vit ici, dans la meme transaction que le statut de la tache,
    // parce que c'est le seul endroit ou une execution devient definitivement
    // finale — quel que soit le chemin qui l'y a menee.
    if (PAUSING_RUN_STATUSES.includes(status)) {
      const queued = await tx.taskQueueEntry.findUnique({
        where: { taskId: current.taskId },
        select: { projectId: true },
      });
      if (queued !== null) {
        await tx.project.update({
          where: { id: queued.projectId },
          data: { executionQueueActive: false },
        });
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
 * Question **locale** : elle ne dit rien du repository, seulement de cette
 * tache. L'exclusion d'execution, elle, porte sur le repository canonique et
 * vit dans `repository-lock.ts` ; le runner la refait sur les processus reels.
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
