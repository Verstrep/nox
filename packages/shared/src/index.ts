/**
 * Point d'entree public de `@nox/shared`.
 *
 * Ce package ne contient que du code sans dependance : types, constantes et
 * petites fonctions utilitaires partageables par l'application web et par le
 * runner local. Il n'importe ni Node, ni React.
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

export {
  RUNNER_ERROR,
  RUNNER_ERROR_CODES,
  RUNNER_SERVICE_NAME,
  isResolveRepositorySuccess,
  isRunnerErrorCode,
  isRunnerErrorResponse,
  isRunnerHealthResponse,
  parseResolveRepositoryRequest,
} from "./runner.js";

export type {
  ResolveRepositoryRequest,
  ResolveRepositoryResponse,
  ResolveRepositorySuccess,
  RunnerErrorCode,
  RunnerErrorResponse,
  RunnerHealthResponse,
} from "./runner.js";

export {
  PROJECT_DOCUMENT_CATEGORIES,
  PROJECT_DOCUMENT_CATEGORY,
  isListProjectDocumentsSuccess,
  isProjectDocumentCategory,
  isReadProjectDocumentSuccess,
  parseListProjectDocumentsRequest,
  parseReadProjectDocumentRequest,
} from "./documents.js";

export type {
  ListProjectDocumentsRequest,
  ListProjectDocumentsSuccess,
  ProjectDocumentCategory,
  ProjectDocumentContent,
  ProjectDocumentSummary,
  ReadProjectDocumentRequest,
  ReadProjectDocumentSuccess,
} from "./documents.js";

/** Version courante du socle NOX, partagee par les workspaces. */
export const NOX_VERSION = "0.1.0";
