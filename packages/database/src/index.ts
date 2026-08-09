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
  InvalidRunReviewRecordError,
  getRunReview,
  hasRunReview,
  markRunReviewFailed,
  saveRunReview,
  seedRunValidations,
  type RunReview,
} from "./run-review.js";

export {
  cancelTaskCorrection,
  createReviewFeedback,
  getFeedbackForCorrectionRun,
  getReviewFeedback,
  getRunResumeContext,
  listFeedbacksForSourceRun,
  startCorrectionFromFeedback,
  startTaskCorrection,
  type CreateFeedbackResult,
  type ReviewFeedbackView,
  type RunResumeContext,
  type StartCorrectionResult,
} from "./review-feedback.js";

export {
  DATABASE_URL_ENV_VAR,
  databaseFileExists,
  findRepositoryRoot,
  resolveDatabaseUrl,
  toDatabaseFilePath,
  toSqliteUrl,
} from "./paths.js";
