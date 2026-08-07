/**
 * Point d'entree public de `@nox/database`.
 *
 * Tout acces a la base passe par ce package : ni `apps/web` ni `apps/runner`
 * n'importent Prisma directement.
 */

export { createDatabaseClient, getDatabaseClient, type DatabaseClient } from "./client.js";

export {
  InvalidProjectRecordError,
  createProject,
  findProjectByRepositoryPath,
  getProjectById,
  isUniqueConstraintError,
  listProjects,
  type CreateProjectInput,
  type Project,
} from "./projects.js";

export {
  InvalidTaskRecordError,
  createTask,
  deleteTaskWithoutRuns,
  getTaskById,
  listTasksByProject,
  markTaskDocumentConflict,
  markTaskDocumentError,
  markTaskDocumentSynced,
  updateTaskStatus,
  type CreateTaskInput,
  type DeleteTaskResult,
  type UpdateTaskStatusResult,
} from "./tasks.js";

export {
  InvalidRunRecordError,
  blockRun,
  cancelTaskExecution,
  completeRun,
  createRun,
  failRun,
  getRunById,
  hasActiveRun,
  listRunsByTask,
  markRunCancelling,
  markRunRunning,
  startTaskExecution,
  updateRunFromRunner,
  type CreateRunInput,
  type RunGitInput,
  type RunOutcomeInput,
  type RunnerRunReport,
} from "./runs.js";

export {
  InvalidRunEventRecordError,
  appendRunEvents,
  countRunEvents,
  getLastRunEventSequence,
  listRunEvents,
} from "./run-events.js";

export {
  DATABASE_URL_ENV_VAR,
  databaseFileExists,
  findRepositoryRoot,
  resolveDatabaseUrl,
  toDatabaseFilePath,
  toSqliteUrl,
} from "./paths.js";
