/**
 * Acces aux donnees du feedback de review et des corrections ciblees.
 *
 * ## Deux garanties portees par ce module
 *
 * 1. **Un feedback vaut pour une seule correction.** Le verrou n'est pas une
 *    verification suivie d'une ecriture — un double clic passerait entre les
 *    deux —, c'est une mise a jour conditionnelle dans une transaction, doublee
 *    d'un index unique sur `correctionRunId`. Meme un appel direct a Prisma
 *    echouerait. Cette mise a jour vit dans `correction-attempts.ts`, avec la
 *    creation de l'execution qu'elle accompagne : les deux ecritures sont
 *    indissociables, et une seule transaction doit les porter.
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
  REVIEW_FEEDBACK_LIMITS,
  TASK_STATUS,
  checkReviewFeedback,
  formatRunCode,
  isTaskStatus,
  normalizeReviewFeedback,
  RUN_STATUS,
  type ReviewFeedbackRefusal,
  type TaskStatus,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

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
  /** Code de sortie, pour nommer ce qui a cede sur une execution en echec. */
  exitCode: number | null;
  /** Categorie enregistree, ou `null` avant HOTFIX-006. */
  failureCategory: string | null;
  claudeSessionId: string | null;
  workspaceFingerprint: string | null;
  workspaceFingerprintVersion: string | null;
  /**
   * Empreintes par entree, serialisees.
   *
   * Contrairement a `workspaceFingerprint`, elles ne sont pas un secret : ce
   * sont des chemins relatifs et des HMAC tronques. Elles restent malgre tout
   * hors des rendus, pour une raison plus simple — rien, a l'ecran, n'en a
   * besoin. Seul le preflight du runner les recoit, et seulement pour formuler
   * un refus deja pris.
   */
  workspaceEntries: string | null;
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
      exitCode: true,
      failureCategory: true,
      claudeSessionId: true,
      workspaceFingerprint: true,
      workspaceFingerprintVersion: true,
      workspaceEntries: true,
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
    exitCode: row.exitCode,
    failureCategory: row.failureCategory,
    claudeSessionId: row.claudeSessionId,
    workspaceFingerprint: row.workspaceFingerprint,
    workspaceFingerprintVersion: row.workspaceFingerprintVersion,
    workspaceEntries: row.workspaceEntries,
    gitBranch: row.gitBranch,
    gitHeadAfter: row.gitHeadAfter,
    hasReview: row.reviewCapturedAt !== null,
    hasCorrection: correction !== null,
  };
}

/**
 * Statuts depuis lesquels une correction demarre sans condition.
 *
 * `REVIEW` est le cas de TASK-011 : un humain a relu et demande des changements.
 * `FAILED` s'y ajoute depuis HOTFIX-006. Personne n'a rien relu dans ce cas —
 * l'execution a cede toute seule — mais le travail partiel est bien la, et
 * l'obliger a repartir d'un dossier propre revenait a le jeter.
 *
 * `READY` n'y figure **pas**, et ne doit pas y figurer : il est accepte
 * conditionnellement, plus bas, et seulement pour un `Retry` qui n'a jamais
 * demarre. L'ajouter ici rendrait reprenable n'importe quelle tache prete.
 *
 * La bascule reste **etroite** pour la meme raison qu'avant : ces transitions
 * n'existent ni dans les transitions manuelles, ni dans les transitions
 * automatisees generiques. Les ouvrir la-bas les rendrait atteignables depuis
 * n'importe quel bouton.
 */
const CORRECTABLE_TASK_STATUSES: readonly TaskStatus[] = [
  TASK_STATUS.REVIEW,
  TASK_STATUS.FAILED,
];

/**
 * Fait passer une tache de `REVIEW` ou `FAILED` a `RUNNING` pour une correction.
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
  /**
   * Execution dont la correction repart.
   *
   * Facultative pour les deux cas historiques, qui se decident sur le seul
   * statut. Indispensable au cas `READY` : c'est elle qui prouve qu'un `Retry`
   * n'a jamais demarre, et la preuve est refaite **ici**, dans la transaction
   * qui ecrit. Un appelant qui aurait raison il y a trois secondes n'est pas une
   * garantie ; relire l'est.
   */
  sourceRunId?: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId }, select: { status: true } });
    if (task === null || !isTaskStatus(task.status)) {
      return false;
    }

    if (!CORRECTABLE_TASK_STATUSES.includes(task.status)) {
      // Le seul autre statut accepte est `READY`, et uniquement quand l'echec
      // vise est encore le dernier fait de la tache. Une tache prete dont une
      // execution plus recente existe attend un lancement neuf, pas la reprise
      // d'une session ancienne.
      if (task.status !== TASK_STATUS.READY || sourceRunId === undefined) {
        return false;
      }

      const source = await tx.run.findFirst({
        where: { id: sourceRunId, taskId },
        select: { id: true, status: true },
      });
      if (source === null || source.status !== RUN_STATUS.FAILED) {
        return false;
      }

      // Meme question que `isLatestRunForTask`, et meme filtre : la correction
      // qu'on est en train de lancer descend de cette execution, et vient d'etre
      // creee. La compter ferait echouer la bascule a chaque fois.
      const latest = await tx.run.findFirst({
        where: {
          taskId,
          OR: [{ parentRunId: null }, { parentRunId: { not: sourceRunId } }],
        },
        orderBy: { sequence: "desc" },
        select: { id: true },
      });
      if (latest === null || latest.id !== sourceRunId) {
        return false;
      }
    }

    await tx.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.RUNNING } });
    return true;
  });
}

/**
 * Rend a une tache le statut d'ou la correction l'avait tiree.
 *
 * Le pendant de `cancelTaskExecution` pour une reprise : sans elle, un refus du
 * runner laisserait la tache en `RUNNING` pour un processus qui n'a jamais
 * existe — et l'utilisateur ne pourrait plus relire la review qu'il venait de
 * quitter.
 *
 * Depuis HOTFIX-006, le statut de retour est **transmis** plutot que suppose.
 * Une correction peut desormais partir d'une tache en echec, et la ramener a
 * `REVIEW` lui ferait annoncer un travail a relire que personne n'a produit.
 * `REVIEW` reste le defaut : c'est le seul cas qui existait avant, et un
 * appelant qui ne dit rien decrit ce cas-la.
 */
export async function cancelTaskCorrection(
  db: DatabaseClient,
  taskId: string,
  previousStatus: TaskStatus = TASK_STATUS.REVIEW,
): Promise<void> {
  // Un statut de retour hors de la liste correctable serait une erreur
  // d'appelant, pas une donnee : la tache retombe alors sur `REVIEW`, qui ne
  // ment sur rien de plus que ce que faisait la version precedente.
  const target = CORRECTABLE_TASK_STATUSES.includes(previousStatus)
    ? previousStatus
    : TASK_STATUS.REVIEW;

  const task = await db.task.findUnique({ where: { id: taskId }, select: { status: true } });
  if (task !== null && task.status === TASK_STATUS.RUNNING) {
    await db.task.update({ where: { id: taskId }, data: { status: target } });
  }
}
