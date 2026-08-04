/**
 * Point d'entree public de `@nox/shared`.
 *
 * Ce package ne contient que du code sans dependance : types, constantes et
 * petites fonctions utilitaires partageables par l'application web et par le
 * runner local.
 */

export {
  PROJECT_STATUS,
  PROJECT_STATUSES,
  RUN_STATUS,
  RUN_STATUSES,
  TASK_STATUS,
  TASK_STATUSES,
  createStatusGuard,
  isProjectStatus,
  isRunStatus,
  isTaskStatus,
} from "./statuses.js";

export type { ProjectStatus, RunStatus, TaskStatus } from "./statuses.js";

/** Version courante du socle NOX, partagee par les workspaces. */
export const NOX_VERSION = "0.1.0";
