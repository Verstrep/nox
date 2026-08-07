/**
 * Statuts metier de NOX.
 *
 * Chaque statut est declare une seule fois, dans un objet constant.
 * Le type union et la liste des valeurs sont derives de cet objet : il n'existe
 * donc jamais de duplication entre la constante et le type.
 *
 * `enum` n'est volontairement pas utilise : les objets constants restent des
 * valeurs JavaScript ordinaires (serialisables, effacables par le type
 * stripping de Node, compatibles `isolatedModules`).
 */

/** Cycle de vie d'un projet NOX. */
export const PROJECT_STATUS = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
  ARCHIVED: "ARCHIVED",
} as const;

/** Cycle de vie d'une tache d'un projet. */
export const TASK_STATUS = {
  DRAFT: "DRAFT",
  READY: "READY",
  RUNNING: "RUNNING",
  BLOCKED: "BLOCKED",
  FAILED: "FAILED",
  REVIEW: "REVIEW",
  COMPLETED: "COMPLETED",
} as const;

/**
 * Cycle de vie d'une execution (un passage de Claude Code sur une tache).
 *
 * `CANCELLING` est le seul statut **transitoire** de la liste : il dit qu'un
 * arret a ete demande et accepte, mais que le processus n'est pas encore mort.
 * Sans lui, un clic sur « Cancel run » ne changerait rien a l'ecran pendant tout
 * le delai de grace, et l'utilisateur cliquerait une seconde fois. Il n'est
 * jamais final : c'est la terminaison reelle du processus qui produit
 * `CANCELLED`.
 */
export const RUN_STATUS = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  CANCELLING: "CANCELLING",
  BLOCKED: "BLOCKED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED",
} as const;

export type ProjectStatus = (typeof PROJECT_STATUS)[keyof typeof PROJECT_STATUS];
export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];
export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

export const PROJECT_STATUSES: readonly ProjectStatus[] = Object.values(PROJECT_STATUS);
export const TASK_STATUSES: readonly TaskStatus[] = Object.values(TASK_STATUS);
export const RUN_STATUSES: readonly RunStatus[] = Object.values(RUN_STATUS);

/**
 * Construit un garde de type verifiant qu'une valeur inconnue appartient a une
 * liste de statuts. Utilise pour valider des chaines provenant de l'exterieur
 * (requetes HTTP, fichiers, futures reponses de base de donnees).
 */
export function createStatusGuard<TStatus extends string>(
  statuses: readonly TStatus[],
): (value: unknown) => value is TStatus {
  const allowed = new Set<string>(statuses);
  return (value: unknown): value is TStatus =>
    typeof value === "string" && allowed.has(value);
}

export const isProjectStatus = createStatusGuard(PROJECT_STATUSES);
export const isTaskStatus = createStatusGuard(TASK_STATUSES);
export const isRunStatus = createStatusGuard(RUN_STATUSES);
