/**
 * Couche de presentation des valeurs internes.
 *
 * Un seul endroit traduit un statut, une priorite ou une transition en texte
 * affichable. Un second mapping, meme minuscule, meme dans un composant isole,
 * finirait par diverger de celui-ci — et deux pages diraient alors deux choses
 * differentes du meme enregistrement.
 *
 * ## Pourquoi ces libelles sont en anglais
 *
 * NOX est une interface francaise. Ce qui passe en anglais ici est deliberement
 * etroit : les **micro-elements techniques** — pastilles d'etat, priorites,
 * petites actions. Ce sont des etiquettes, pas des phrases : elles se lisent
 * d'un coup d'oeil, elles sont courtes, et elles portent les memes noms que les
 * valeurs internes qu'elles designent. Tout ce qui explique, avertit ou
 * questionne reste en francais, la ou la nuance compte.
 *
 * D'ou des melanges assumes : « Etat de la tache : Ready », « Priorite : High ».
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne touche a aucune valeur interne. `TASK_STATUS.COMPLETED` reste
 * `COMPLETED` en base, dans les contrats et dans les transitions — seul son
 * affichage devient `Done`. Les documents Markdown deja generes ne sont pas
 * reecrits : ce sont des fichiers du repository, pas des chaines d'interface.
 */

import {
  RUN_STATUS,
  TASK_DOCUMENT_SYNC_STATUS,
  TASK_PRIORITY,
  TASK_STATUS,
  type RunStatus,
  type TaskDocumentSyncStatus,
  type TaskPriority,
  type TaskStatus,
} from "@nox/shared";

/**
 * Statuts de tache.
 *
 * `COMPLETED` s'affiche `Done` et non `Completed` : la table des executions
 * possede son propre `COMPLETED`, et deux pastilles identiques pour deux notions
 * differentes — un travail accepte, un processus termine — se confondraient sur
 * la page d'une tache, ou les deux apparaissent cote a cote.
 */
const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  [TASK_STATUS.DRAFT]: "Draft",
  [TASK_STATUS.READY]: "Ready",
  [TASK_STATUS.RUNNING]: "Running",
  [TASK_STATUS.BLOCKED]: "Blocked",
  [TASK_STATUS.FAILED]: "Failed",
  [TASK_STATUS.REVIEW]: "Review",
  [TASK_STATUS.COMPLETED]: "Done",
};

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  [RUN_STATUS.QUEUED]: "Queued",
  [RUN_STATUS.RUNNING]: "Running",
  [RUN_STATUS.BLOCKED]: "Blocked",
  [RUN_STATUS.FAILED]: "Failed",
  [RUN_STATUS.CANCELLED]: "Cancelled",
  [RUN_STATUS.COMPLETED]: "Completed",
};

const DOCUMENT_SYNC_LABELS: Record<TaskDocumentSyncStatus, string> = {
  [TASK_DOCUMENT_SYNC_STATUS.PENDING]: "Pending",
  [TASK_DOCUMENT_SYNC_STATUS.SYNCED]: "Synced",
  [TASK_DOCUMENT_SYNC_STATUS.ERROR]: "Error",
  [TASK_DOCUMENT_SYNC_STATUS.CONFLICT]: "Conflict",
};

const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TASK_PRIORITY.LOW]: "Low",
  [TASK_PRIORITY.MEDIUM]: "Medium",
  [TASK_PRIORITY.HIGH]: "High",
  [TASK_PRIORITY.CRITICAL]: "Critical",
};

/**
 * Libelle du bouton qui mene d'un statut a un autre.
 *
 * Une transition n'est pas son etat d'arrivee : passer une tache echouee en
 * `READY` se dit « Retry », passer une tache relue en `COMPLETED` se dit
 * « Approve ». Nommer le geste plutot que la destination evite les sept boutons
 * « Set ready » qui ne diraient jamais pourquoi on clique.
 *
 * La table est declaree pour **tous** les statuts de depart : un statut ajoute
 * plus tard ne peut pas passer inapercu, `Record` obligeant a le traiter. Les
 * arrivees, elles, sont partielles — la plupart des paires n'existent pas — et
 * un test verifie que chaque transition reellement autorisee par
 * `allowedTaskStatusTransitions` possede bien son libelle explicite. Le repli
 * ci-dessous n'est donc jamais atteint par une transition proposee a
 * l'utilisateur.
 */
const TASK_TRANSITION_LABELS: Record<TaskStatus, Partial<Record<TaskStatus, string>>> = {
  [TASK_STATUS.DRAFT]: {
    [TASK_STATUS.READY]: "Mark ready",
    [TASK_STATUS.BLOCKED]: "Mark blocked",
  },
  [TASK_STATUS.READY]: {
    [TASK_STATUS.DRAFT]: "Back to draft",
    [TASK_STATUS.BLOCKED]: "Mark blocked",
    [TASK_STATUS.COMPLETED]: "Mark done",
  },
  [TASK_STATUS.BLOCKED]: {
    [TASK_STATUS.DRAFT]: "Back to draft",
    [TASK_STATUS.READY]: "Mark ready",
  },
  [TASK_STATUS.COMPLETED]: {
    [TASK_STATUS.READY]: "Reopen",
  },
  // Une execution relue s'accepte ou se refait : ce sont deux decisions, pas
  // deux changements de statut interchangeables.
  [TASK_STATUS.REVIEW]: {
    [TASK_STATUS.COMPLETED]: "Approve",
    [TASK_STATUS.READY]: "Reopen",
  },
  [TASK_STATUS.FAILED]: {
    [TASK_STATUS.READY]: "Retry",
    [TASK_STATUS.BLOCKED]: "Mark blocked",
  },
  // Aucune sortie manuelle d'une execution en cours : la table est vide, comme
  // celle des transitions autorisees.
  [TASK_STATUS.RUNNING]: {},
};

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status];
}

export function runStatusLabel(status: RunStatus): string {
  return RUN_STATUS_LABELS[status];
}

export function documentSyncStatusLabel(status: TaskDocumentSyncStatus): string {
  return DOCUMENT_SYNC_LABELS[status];
}

export function taskPriorityLabel(priority: TaskPriority): string {
  return TASK_PRIORITY_LABELS[priority];
}

export function taskTransitionLabel(from: TaskStatus, to: TaskStatus): string {
  return TASK_TRANSITION_LABELS[from][to] ?? `Set ${taskStatusLabel(to)}`;
}
