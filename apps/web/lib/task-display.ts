/**
 * Libelles et tons d'affichage des taches.
 *
 * Ce module n'importe ni Prisma, ni le client runner : il est donc utilisable
 * par un Client Component, ce que `lib/tasks.ts` ne peut pas etre.
 *
 * Les libelles sont sans accent, comme le reste de l'interface. Le document
 * Markdown genere, lui, est accentue : c'est un fichier destine a etre lu dans
 * le repository, pas une chaine d'interface.
 */

import {
  TASK_DOCUMENT_SYNC_STATUS,
  TASK_PRIORITY,
  TASK_STATUS,
  TASK_STATUSES,
  type DevelopmentTaskSummary,
  type TaskDocumentSyncStatus,
  type TaskPriority,
  type TaskStatus,
} from "@nox/shared";

import type { BadgeTone } from "@/components/StatusBadge";

const STATUS_LABELS: Record<TaskStatus, string> = {
  [TASK_STATUS.DRAFT]: "Brouillon",
  [TASK_STATUS.READY]: "Prete",
  [TASK_STATUS.RUNNING]: "En cours",
  [TASK_STATUS.BLOCKED]: "Bloquee",
  [TASK_STATUS.FAILED]: "Echouee",
  [TASK_STATUS.REVIEW]: "A relire",
  [TASK_STATUS.COMPLETED]: "Terminee",
};

const STATUS_TONES: Record<TaskStatus, BadgeTone> = {
  [TASK_STATUS.DRAFT]: "muted",
  [TASK_STATUS.READY]: "accent",
  [TASK_STATUS.RUNNING]: "accent",
  [TASK_STATUS.BLOCKED]: "neutral",
  [TASK_STATUS.FAILED]: "neutral",
  [TASK_STATUS.REVIEW]: "neutral",
  [TASK_STATUS.COMPLETED]: "muted",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TASK_PRIORITY.LOW]: "Basse",
  [TASK_PRIORITY.MEDIUM]: "Moyenne",
  [TASK_PRIORITY.HIGH]: "Haute",
  [TASK_PRIORITY.CRITICAL]: "Critique",
};

const SYNC_LABELS: Record<TaskDocumentSyncStatus, string> = {
  [TASK_DOCUMENT_SYNC_STATUS.PENDING]: "Document a creer",
  [TASK_DOCUMENT_SYNC_STATUS.SYNCED]: "Document synchronise",
  [TASK_DOCUMENT_SYNC_STATUS.ERROR]: "Document non cree",
  [TASK_DOCUMENT_SYNC_STATUS.CONFLICT]: "Emplacement occupe",
};

export function describeTaskStatus(status: TaskStatus): string {
  return STATUS_LABELS[status];
}

export function taskStatusTone(status: TaskStatus): BadgeTone {
  return STATUS_TONES[status];
}

export function describeTaskPriority(priority: TaskPriority): string {
  return PRIORITY_LABELS[priority];
}

export function describeTaskSync(status: TaskDocumentSyncStatus): string {
  return SYNC_LABELS[status];
}

/**
 * Compte les taches par statut.
 *
 * Tous les statuts sont presents, y compris a zero : une table complete evite a
 * l'appelant de distinguer « aucune tache bloquee » de « statut inconnu ».
 */
export function countTasksByStatus(
  tasks: readonly DevelopmentTaskSummary[],
): Record<TaskStatus, number> {
  const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
    TaskStatus,
    number
  >;
  for (const task of tasks) {
    counts[task.status] += 1;
  }
  return counts;
}

/**
 * Lit un statut depuis un parametre d'URL.
 *
 * Une valeur inconnue — ou repetee — ne leve pas : elle est simplement ignoree,
 * et le backlog s'affiche sans filtre. Un lien errone ne doit pas produire une
 * page d'erreur.
 */
export function readStatusFilter(value: string | string[] | undefined): TaskStatus | null {
  if (typeof value !== "string") {
    return null;
  }
  return (TASK_STATUSES as readonly string[]).includes(value) ? (value as TaskStatus) : null;
}

/** URL de la page de detail d'une tache. */
export function taskUrl(projectId: string, taskId: string): string {
  return `/projects/${projectId}/tasks/${taskId}`;
}

/** URL du backlog, eventuellement filtre par statut. */
export function backlogUrl(projectId: string, status: TaskStatus | null = null): string {
  const base = `/projects/${projectId}/tasks`;
  return status === null ? base : `${base}?status=${status}`;
}
