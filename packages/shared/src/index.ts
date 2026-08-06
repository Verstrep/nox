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
  RESERVED_TASK_STATUSES,
  TASK_CODE_PREFIX,
  TASK_DOCUMENT_SYNC_STATUS,
  TASK_DOCUMENT_SYNC_STATUSES,
  TASK_PRIORITIES,
  TASK_PRIORITY,
  allowedTaskStatusTransitions,
  canTransitionTaskStatus,
  formatTaskCode,
  isReservedTaskStatus,
  isTaskCode,
  isTaskDocumentSyncStatus,
  isTaskPriority,
  taskDocumentPath,
  taskPriorityRank,
} from "./tasks.js";

export type {
  DevelopmentTaskDetail,
  DevelopmentTaskSummary,
  TaskDocumentSyncStatus,
  TaskPriority,
  TaskSpecification,
} from "./tasks.js";

export { renderTaskMarkdown } from "./task-markdown.js";

export {
  isCreateTaskDocumentSuccess,
  parseCreateTaskDocumentRequest,
} from "./task-documents.js";

export type {
  CreateTaskDocumentRequest,
  CreateTaskDocumentSuccess,
} from "./task-documents.js";

export {
  PROJECT_DOCUMENT_CATEGORIES,
  PROJECT_DOCUMENT_CATEGORY,
  isCreateProjectDocumentSuccess,
  isListProjectDocumentsSuccess,
  isProjectDocumentCategory,
  isProjectDocumentRevision,
  isReadProjectDocumentSuccess,
  isUpdateProjectDocumentSuccess,
  parseCreateProjectDocumentRequest,
  parseListProjectDocumentsRequest,
  parseReadProjectDocumentRequest,
  parseUpdateProjectDocumentRequest,
} from "./documents.js";

export type {
  CreateProjectDocumentRequest,
  CreateProjectDocumentSuccess,
  ListProjectDocumentsRequest,
  ListProjectDocumentsSuccess,
  ProjectDocumentCategory,
  ProjectDocumentContent,
  ProjectDocumentRevision,
  ProjectDocumentSummary,
  ReadProjectDocumentRequest,
  ReadProjectDocumentSuccess,
  UpdateProjectDocumentRequest,
  UpdateProjectDocumentSuccess,
} from "./documents.js";

/** Version courante du socle NOX, partagee par les workspaces. */
export const NOX_VERSION = "0.1.0";
