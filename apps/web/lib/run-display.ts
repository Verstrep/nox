/**
 * Tons, URL et formats d'affichage des executions.
 *
 * Ce module n'importe ni Prisma, ni le client runner : il est donc utilisable
 * par un Client Component, ce que `lib/runs.ts` ne peut pas etre.
 *
 * Les **libelles de statut** vivent dans `lib/labels.ts` depuis TASK-009, avec
 * ceux des taches : une seule couche traduit les valeurs internes.
 */

import { RUN_STATUS, isFinalRunStatus, type RunStatus } from "@nox/shared";

import type { BadgeTone } from "@/components/StatusBadge";

const STATUS_TONES: Record<RunStatus, BadgeTone> = {
  [RUN_STATUS.QUEUED]: "muted",
  [RUN_STATUS.RUNNING]: "accent",
  [RUN_STATUS.BLOCKED]: "neutral",
  [RUN_STATUS.FAILED]: "neutral",
  [RUN_STATUS.CANCELLED]: "muted",
  [RUN_STATUS.COMPLETED]: "accent",
};

export function runStatusTone(status: RunStatus): BadgeTone {
  return STATUS_TONES[status];
}

/** Une execution non finale est encore suivie : c'est elle qu'on interroge. */
export function isRunActive(status: RunStatus): boolean {
  return !isFinalRunStatus(status);
}

/** URL de la page de preparation d'une execution. */
export function newRunUrl(projectId: string, taskId: string): string {
  return `/projects/${projectId}/tasks/${taskId}/runs/new`;
}

/** URL de la page d'une execution. */
export function runUrl(projectId: string, taskId: string, runId: string): string {
  return `/projects/${projectId}/tasks/${taskId}/runs/${runId}`;
}

/** URL du Route Handler interrogé par le navigateur pendant une execution. */
export function runStatusEndpoint(projectId: string, taskId: string, runId: string): string {
  return `/api/projects/${projectId}/tasks/${taskId}/runs/${runId}/status`;
}

/** Duree lisible, a partir d'une valeur en millisecondes. */
export function formatDuration(milliseconds: number | null): string | null {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) {
    return null;
  }

  const totalSeconds = Math.round(milliseconds / 1000);
  if (totalSeconds < 60) {
    return `${String(totalSeconds)} s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)} min ${String(seconds).padStart(2, "0")} s`;
}

/**
 * Cout rapporte par Claude Code.
 *
 * Retourne `null` lorsque l'outil ne le fournit pas : NOX n'estime jamais un
 * cout a partir d'un nombre de tours ou d'une duree.
 */
export function formatReportedCost(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return `${value.toFixed(4)} $`;
}

/** Forme courte d'un SHA Git, pour l'affichage. */
export function shortSha(value: string | null): string | null {
  if (value === null || value.length < 7) {
    return value;
  }
  return value.slice(0, 12);
}
