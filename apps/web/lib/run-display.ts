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

/**
 * Ton de chaque statut d'execution.
 *
 * Aligne sur celui des taches depuis TASK-034, et pour la meme raison : `Failed`
 * portait le gris d'un statut ordinaire, et une execution terminee le meme teal
 * qu'une execution en cours. L'historique d'une tache melange les deux — il
 * fallait lire chaque ligne pour savoir laquelle tournait encore.
 *
 * `accent` ne designe plus que ce qui **se passe en ce moment**. Une execution
 * terminee prend `success`, et une execution en attente `info` : la seconde est
 * disponible, elle n'est pas active.
 *
 * `CANCELLED` reste `muted` : un arret demande par un humain n'est pas un
 * incident, et le peindre en rouge ferait chercher une panne la ou il n'y en a
 * pas.
 */
const STATUS_TONES: Record<RunStatus, BadgeTone> = {
  [RUN_STATUS.QUEUED]: "info",
  [RUN_STATUS.RUNNING]: "accent",
  // `accent` comme `RUNNING` : quelque chose se passe encore, et l'oeil doit le
  // voir. Le libelle, lui, dit lequel des deux.
  [RUN_STATUS.CANCELLING]: "accent",
  [RUN_STATUS.BLOCKED]: "danger",
  [RUN_STATUS.FAILED]: "danger",
  [RUN_STATUS.CANCELLED]: "muted",
  [RUN_STATUS.COMPLETED]: "success",
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

/**
 * URL de l'inspection technique d'une execution.
 *
 * Le prompt integral et son empreinte y vivent depuis TASK-025 : ils servent au
 * debug et a la reproductibilite, pas a decider quoi faire ensuite. La page
 * d'une execution renvoie ici plutot que de derouler quarante lignes de prompt
 * entre la timeline et l'etat Git.
 */
export function runInspectUrl(projectId: string, taskId: string, runId: string): string {
  return `${runUrl(projectId, taskId, runId)}/inspect`;
}

/** URL du Route Handler interrogé par le navigateur pendant une execution. */
export function runStatusEndpoint(projectId: string, taskId: string, runId: string): string {
  return `/api/projects/${projectId}/tasks/${taskId}/runs/${runId}/status`;
}

/**
 * URL du flux SSE des evenements.
 *
 * `afterSequence` evite de renvoyer au navigateur ce qu'il a deja affiche : la
 * page rend son historique cote serveur, puis le flux reprend juste apres.
 */
export function runEventsEndpoint(
  projectId: string,
  taskId: string,
  runId: string,
  afterSequence: number,
): string {
  return `/api/projects/${projectId}/tasks/${taskId}/runs/${runId}/events?afterSequence=${String(afterSequence)}`;
}

/** Heure courte d'un evenement : `01:28:03`. */
export function formatEventTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
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
