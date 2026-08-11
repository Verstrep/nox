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

import type { ArchitectContextChangeKind } from "./architect/context-diff.ts";

import {
  ARCHITECT_GENERATION_STATUS,
  ARCHITECT_MESSAGE_ROLE,
  ARCHITECT_SESSION_STATUS,
  CLAUDE_RUN_EVENT_KIND,
  RUN_CHANGE_TYPE,
  RUN_STATUS,
  RUN_VALIDATION_STATUS,
  RUN_VALIDATION_SUMMARY,
  TASK_DOCUMENT_SYNC_STATUS,
  TASK_PRIORITY,
  TASK_STATUS,
  type ArchitectGenerationStatus,
  type ArchitectMessageRole,
  type ArchitectSessionStatus,
  type ClaudeRunEventKind,
  type RunChangeType,
  type RunStatus,
  type RunValidationStatus,
  type RunValidationSummary,
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

/**
 * Statuts d'execution.
 *
 * `Cancelling` porte des points de suspension : c'est le seul statut de la liste
 * qui decrive une action en cours plutot qu'un etat atteint, et les trois points
 * disent au premier coup d'oeil qu'il faut attendre.
 */
const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  [RUN_STATUS.QUEUED]: "Queued",
  [RUN_STATUS.RUNNING]: "Running",
  [RUN_STATUS.CANCELLING]: "Cancelling…",
  [RUN_STATUS.BLOCKED]: "Blocked",
  [RUN_STATUS.FAILED]: "Failed",
  [RUN_STATUS.CANCELLED]: "Cancelled",
  [RUN_STATUS.COMPLETED]: "Completed",
};

/**
 * Nature d'un evenement de la timeline.
 *
 * Ces libelles ne remplacent pas le `label` de l'evenement — qui dit ce qui
 * s'est passe — mais le classent. Ils sont lus par les lecteurs d'ecran, ou la
 * couleur ne dit rien.
 */
const RUN_EVENT_KIND_LABELS: Record<ClaudeRunEventKind, string> = {
  [CLAUDE_RUN_EVENT_KIND.STATUS]: "Status",
  [CLAUDE_RUN_EVENT_KIND.ASSISTANT_MESSAGE]: "Message",
  [CLAUDE_RUN_EVENT_KIND.TOOL_STARTED]: "Tool",
  [CLAUDE_RUN_EVENT_KIND.TOOL_COMPLETED]: "Tool",
  [CLAUDE_RUN_EVENT_KIND.VALIDATION]: "Validation",
  [CLAUDE_RUN_EVENT_KIND.WARNING]: "Warning",
  [CLAUDE_RUN_EVENT_KIND.ERROR]: "Error",
  [CLAUDE_RUN_EVENT_KIND.RESULT]: "Result",
  [CLAUDE_RUN_EVENT_KIND.TRUNCATED]: "Truncated",
};

/**
 * Nature d'un changement de fichier.
 *
 * `Untracked` reste distinct d'`Added` : Git ne les traite pas pareil, et
 * l'utilisateur non plus — le second est deja dans l'index, le premier attend
 * encore qu'on decide de son sort.
 */
const RUN_CHANGE_TYPE_LABELS: Record<RunChangeType, string> = {
  [RUN_CHANGE_TYPE.ADDED]: "Added",
  [RUN_CHANGE_TYPE.MODIFIED]: "Modified",
  [RUN_CHANGE_TYPE.DELETED]: "Deleted",
  [RUN_CHANGE_TYPE.RENAMED]: "Renamed",
  [RUN_CHANGE_TYPE.COPIED]: "Copied",
  [RUN_CHANGE_TYPE.TYPE_CHANGED]: "Type changed",
  [RUN_CHANGE_TYPE.UNTRACKED]: "Untracked",
};

/**
 * Marqueur d'une ligne de la liste de fichiers.
 *
 * Les memes lettres que `git status`, parce que c'est le vocabulaire que
 * l'utilisateur a deja dans son terminal. Il est **double** d'un libelle complet
 * lu par les lecteurs d'ecran : une lettre seule ne se prononce pas.
 */
const RUN_CHANGE_TYPE_MARKS: Record<RunChangeType, string> = {
  [RUN_CHANGE_TYPE.ADDED]: "A",
  [RUN_CHANGE_TYPE.MODIFIED]: "M",
  [RUN_CHANGE_TYPE.DELETED]: "D",
  [RUN_CHANGE_TYPE.RENAMED]: "R",
  [RUN_CHANGE_TYPE.COPIED]: "C",
  [RUN_CHANGE_TYPE.TYPE_CHANGED]: "T",
  [RUN_CHANGE_TYPE.UNTRACKED]: "?",
};

/**
 * Etat d'une commande de validation.
 *
 * `Not run` est un libelle a part entiere, pas un tiret : une commande jamais
 * lancee est une information, et l'afficher comme une donnee manquante la ferait
 * passer pour un defaut d'affichage.
 */
const RUN_VALIDATION_STATUS_LABELS: Record<RunValidationStatus, string> = {
  [RUN_VALIDATION_STATUS.NOT_RUN]: "Not run",
  [RUN_VALIDATION_STATUS.RUNNING]: "Running",
  [RUN_VALIDATION_STATUS.PASSED]: "Passed",
  [RUN_VALIDATION_STATUS.FAILED]: "Failed",
  [RUN_VALIDATION_STATUS.UNKNOWN]: "Unknown",
};

/** Etat global des validations d'une execution. */
const RUN_VALIDATION_SUMMARY_LABELS: Record<RunValidationSummary, string> = {
  [RUN_VALIDATION_SUMMARY.NONE]: "None expected",
  [RUN_VALIDATION_SUMMARY.PASSED]: "Passed",
  [RUN_VALIDATION_SUMMARY.FAILED]: "Failed",
  [RUN_VALIDATION_SUMMARY.INCOMPLETE]: "Incomplete",
  [RUN_VALIDATION_SUMMARY.UNKNOWN]: "Unknown",
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

/**
 * Etat d'une session Architecte.
 *
 * `Proposal ready` porte le mot « proposal » a dessein : `Ready` seul se
 * confondrait avec le statut de tache du meme nom, qui ne dit pas du tout la
 * meme chose — l'un annonce qu'une proposition est prete a etre relue, l'autre
 * qu'une tache est prete a etre lancee.
 */
const ARCHITECT_SESSION_STATUS_LABELS: Record<ArchitectSessionStatus, string> = {
  [ARCHITECT_SESSION_STATUS.OPEN]: "Open",
  [ARCHITECT_SESSION_STATUS.GENERATING]: "Generating…",
  [ARCHITECT_SESSION_STATUS.CONTINUE]: "In discussion",
  [ARCHITECT_SESSION_STATUS.NEEDS_INPUT]: "Needs input",
  [ARCHITECT_SESSION_STATUS.PROPOSAL_READY]: "Proposal ready",
  [ARCHITECT_SESSION_STATUS.APPLIED]: "Applied",
  [ARCHITECT_SESSION_STATUS.FAILED]: "Failed",
};

/** Issue d'une generation, dans l'historique d'une session. */
const ARCHITECT_GENERATION_STATUS_LABELS: Record<ArchitectGenerationStatus, string> = {
  [ARCHITECT_GENERATION_STATUS.RUNNING]: "Running",
  [ARCHITECT_GENERATION_STATUS.PROPOSAL_READY]: "Proposal ready",
  [ARCHITECT_GENERATION_STATUS.CONTINUE]: "Discussion",
  [ARCHITECT_GENERATION_STATUS.NEEDS_INPUT]: "Needs input",
  [ARCHITECT_GENERATION_STATUS.REFUSED]: "Refused",
  [ARCHITECT_GENERATION_STATUS.FAILED]: "Failed",
};

/**
 * Sort d'une source dans le contexte envoye.
 *
 * `Omitted` et `Truncated` sont distincts : le premier dit que le document
 * existe mais que rien n'en est parti, le second qu'il en est parti une partie.
 * Les confondre ferait croire a un envoi qui n'a pas eu lieu.
 */
const ARCHITECT_SOURCE_STATUS_LABELS: Record<ArchitectSourceStatus, string> = {
  INCLUDED: "Included",
  TRUNCATED: "Truncated",
  OMITTED: "Omitted",
  MISSING: "Missing",
};

/** Sort possible d'une source du contexte. */
export type ArchitectSourceStatus = "INCLUDED" | "TRUNCATED" | "OMITTED" | "MISSING";

/**
 * Nature d'un changement de contexte entre deux tours.
 *
 * Les libelles disent un **fait**, jamais une consequence : NOX ne sait pas
 * pourquoi un document a change, et n'a pas a le supposer.
 */
const ARCHITECT_CONTEXT_CHANGE_LABELS: Record<ArchitectContextChangeKind, string> = {
  ADDED: "Added",
  REMOVED: "Removed",
  MODIFIED: "Modified",
  TRUNCATION_CHANGED: "Truncation changed",
  TASK_ADDED: "Added to recent context",
  TASK_MODIFIED: "Specification changed",
  TASK_REMOVED: "Removed from recent context",
};

/** Auteur d'un message, tel que le fil l'affiche. */
const ARCHITECT_MESSAGE_ROLE_LABELS: Record<ArchitectMessageRole, string> = {
  [ARCHITECT_MESSAGE_ROLE.USER]: "You",
  [ARCHITECT_MESSAGE_ROLE.ARCHITECT]: "Architect",
};

export function architectContextChangeLabel(kind: ArchitectContextChangeKind): string {
  return ARCHITECT_CONTEXT_CHANGE_LABELS[kind];
}

export function architectMessageRoleLabel(role: ArchitectMessageRole): string {
  return ARCHITECT_MESSAGE_ROLE_LABELS[role];
}

export function architectSessionStatusLabel(status: ArchitectSessionStatus): string {
  return ARCHITECT_SESSION_STATUS_LABELS[status];
}

export function architectGenerationStatusLabel(status: ArchitectGenerationStatus): string {
  return ARCHITECT_GENERATION_STATUS_LABELS[status];
}

export function architectSourceStatusLabel(status: ArchitectSourceStatus): string {
  return ARCHITECT_SOURCE_STATUS_LABELS[status];
}

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status];
}

export function runStatusLabel(status: RunStatus): string {
  return RUN_STATUS_LABELS[status];
}

export function runEventKindLabel(kind: ClaudeRunEventKind): string {
  return RUN_EVENT_KIND_LABELS[kind];
}

export function runChangeTypeLabel(changeType: RunChangeType): string {
  return RUN_CHANGE_TYPE_LABELS[changeType];
}

export function runChangeTypeMark(changeType: RunChangeType): string {
  return RUN_CHANGE_TYPE_MARKS[changeType];
}

export function runValidationStatusLabel(status: RunValidationStatus): string {
  return RUN_VALIDATION_STATUS_LABELS[status];
}

export function runValidationSummaryLabel(summary: RunValidationSummary): string {
  return RUN_VALIDATION_SUMMARY_LABELS[summary];
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
