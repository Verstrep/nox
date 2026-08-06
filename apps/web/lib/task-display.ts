/**
 * Tons, comptages et URL des taches.
 *
 * Ce module n'importe ni Prisma, ni le client runner : il est donc utilisable
 * par un Client Component, ce que `lib/tasks.ts` ne peut pas etre.
 *
 * Les **libelles** n'y sont plus : ils vivent tous dans `lib/labels.ts` depuis
 * TASK-009. Un ton est une decision d'affichage propre aux taches ; un libelle
 * est une traduction, et il n'en existe qu'une par valeur dans tout NOX.
 */

import {
  TASK_STATUS,
  TASK_STATUSES,
  type DevelopmentTaskSummary,
  type TaskStatus,
} from "@nox/shared";

import type { BadgeTone } from "@/components/StatusBadge";

const STATUS_TONES: Record<TaskStatus, BadgeTone> = {
  [TASK_STATUS.DRAFT]: "muted",
  [TASK_STATUS.READY]: "accent",
  [TASK_STATUS.RUNNING]: "accent",
  [TASK_STATUS.BLOCKED]: "neutral",
  [TASK_STATUS.FAILED]: "neutral",
  [TASK_STATUS.REVIEW]: "neutral",
  [TASK_STATUS.COMPLETED]: "muted",
};

export function taskStatusTone(status: TaskStatus): BadgeTone {
  return STATUS_TONES[status];
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
