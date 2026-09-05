/**
 * Point d'entree public de `@nox/database`.
 *
 * Tout acces a la base passe par ce package : ni `apps/web` ni `apps/runner`
 * n'importent Prisma directement.
 */

export { createDatabaseClient, getDatabaseClient, type DatabaseClient } from "./client.js";

export {
  countActiveRepositoryRuns,
  listProjectIdsSharingRepository,
} from "./repository-lock.js";
export type { RepositoryLockClient } from "./repository-lock.js";

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
  countQueueEntries,
  dequeueTask,
  enqueueTask,
  isQueueActive,
  isTaskQueued,
  listQueueEntries,
  markQueueEntryStarted,
  moveQueueEntry,
  queuePositionOf,
  setQueueActive,
  type DequeueResult,
  type MoveQueueResult,
  type QueueOperationResult,
  type SetQueueActiveResult,
  type TaskQueueEntryRow,
} from "./task-queue.js";

export {
  PROJECT_DELETION_ORDER,
  deleteProjectState,
  listOwnedTaskArtifacts,
  projectHasActiveRun,
  renameProject,
  type DeleteProjectStateResult,
  type OwnedTaskArtifact,
  type ProjectDeletionCounts,
  type ProjectDeletionTable,
  type RenameProjectResult,
} from "./project-deletion.js";

export {
  loadProjectDashboardFacts,
  type ProjectActiveRunFacts,
  type ProjectBlockingDeliveryFacts,
  type ProjectDashboardFacts,
} from "./project-dashboard.js";

export {
  InvalidTaskRecordError,
  createTask,
  deleteTaskWithoutRuns,
  getTaskById,
  listTaskObjectives,
  listTasksByProject,
  markTaskDocumentConflict,
  markTaskDocumentError,
  markTaskDocumentSynced,
  peekNextTaskSequence,
  reserveTaskSequences,
  updateTaskStatus,
  writeTaskRow,
  type BlockingDependent,
  type CreateTaskInput,
  type DeleteTaskResult,
  type TaskRowInput,
  type TaskWriteClient,
  type ReviewDecisionInput,
  type UpdateTaskStatusResult,
} from "./tasks.js";

export {
  addTaskDependency,
  countProjectDependencies,
  hasAnyCycle,
  listDependencyCandidates,
  listDependencyIds,
  listTaskDependencies,
  readProjectDependencyEdges,
  removeTaskDependency,
  type AddDependencyResult,
  type ProjectDependencyCounts,
  type RemoveDependencyResult,
  type TaskDependencyRows,
} from "./task-dependencies.js";

export {
  normalizeTaskEditSnapshot,
  readTaskCode,
  taskContractChanged,
  taskEditSnapshotOf,
  updateFutureTask,
  type TaskEditCommandInput,
  type TaskEditCriterionInput,
  type TaskEditInput,
  type TaskEditResult,
  type TaskEditRevision,
  type TaskEditSnapshot,
} from "./task-edit.js";

export {
  countAppliedBacklogProposals,
  createBootstrapTask,
  getBootstrapTask,
  type CreateBootstrapTaskResult,
} from "./bootstrap.js";

export {
  applyBacklogProposal,
  dismissBacklogProposal,
  finishBacklogGeneration,
  getBacklogGeneration,
  getBacklogProposal,
  getBacklogProposalForGeneration,
  listBacklogTasks,
  loadProjectBacklog,
  startBacklogGeneration,
} from "./architect-backlog.js";

export type {
  ApplyBacklogInput,
  ApplyBacklogResult,
  ArchitectBacklogGenerationView,
  ArchitectBacklogProposalView,
  BacklogCreatedTask,
  BacklogPlanningBase,
  BacklogTaskToCreate,
  DismissBacklogResult,
  FinishBacklogGenerationInput,
  ProjectBacklogView,
  StartBacklogGenerationInput,
  StartBacklogGenerationResult,
} from "./architect-backlog.js";

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
  listTaskRunFacts,
  markRunCancelling,
  markRunRunning,
  startTaskExecution,
  updateRunFromRunner,
  type CreateRunInput,
  type CreateRunResult,
  type RunGitInput,
  type RunOutcomeInput,
  type RunnerRunReport,
  type TaskRunFact,
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
  InvalidArchitectRecordError,
  architectProposalOfMessage,
  architectTranscriptChars,
  attachArchitectGenerationTask,
  attachArchitectTask,
  canCreateArchitectTask,
  claimArchitectGeneration,
  claimArchitectSession,
  clearArchitectTurnDraft,
  createArchitectSession,
  creatableArchitectProposal,
  ensureProjectArchitectSession,
  findArchitectSessionForTask,
  findProjectArchitectSession,
  finishArchitectGeneration,
  formatArchitectSessionCode,
  getArchitectSession,
  latestArchitectProposal,
  latestArchitectQuestions,
  listArchitectSessions,
  listArchitectSessionTasks,
  releaseArchitectGeneration,
  releaseArchitectSession,
  saveArchitectTurnDraft,
  startArchitectGeneration,
  type ArchitectSessionTask,
  type ArchitectTaskOrigin,
  type ClaimArchitectGenerationResult,
  type ClaimArchitectSessionResult,
  type ArchitectGenerationView,
  type ArchitectMessageView,
  type ArchitectPendingTurn,
  type ArchitectSessionSummary,
  type ArchitectSessionView,
  type FinishGenerationInput,
  type SaveTurnDraftInput,
  type StartGenerationInput,
  type StartGenerationResult,
} from "./architect.js";

export {
  InvalidArchitectReviewRecordError,
  finishArchitectRunReview,
  formatArchitectReviewCode,
  getArchitectReviewSummary,
  getArchitectRunReview,
  listArchitectRunReviews,
  startArchitectRunReview,
  type ArchitectReviewSummary,
  type ArchitectRunReviewView,
  type FinishArchitectReviewInput,
  type StartArchitectReviewInput,
  type StartArchitectReviewResult,
} from "./architect-review.js";

export {
  cancelTaskCorrection,
  createReviewFeedback,
  getFeedbackForCorrectionRun,
  getReviewFeedback,
  getRunResumeContext,
  listFeedbacksForSourceRun,
  startTaskCorrection,
  type CreateFeedbackResult,
  type ReviewFeedbackView,
  type RunResumeContext,
} from "./review-feedback.js";

export {
  AUTOMATIC_DELIVERY_TRIGGER,
  claimDelivery,
  findCompletionRun,
  getBlockingDelivery,
  getDeliveryForRun,
  getGitDelivery,
  getLatestDeliveryForTask,
  listProjectDeliveries,
  parseCandidate,
  readProjectDeliveryPolicy,
  recordDeliveryCommit,
  recordDeliveryFailure,
  recordDeliveryPush,
  reserveGitDelivery,
  setProjectDeliveryPolicy,
  type ClaimDeliveryResult,
  type CompletionRunFact,
  type GitDeliveryRow,
  type ReserveDeliveryResult,
  type SetDeliveryPolicyResult,
} from "./git-delivery.js";

export {
  abandonCorrection,
  getCorrectionAttempt,
  getCorrectionAttemptForRun,
  getHeldCorrection,
  listCorrectionAttempts,
  readCorrectionChain,
  reserveCorrection,
  startCorrectionRun,
  type CorrectionAttemptRow,
  type ReserveCorrectionResult,
  type StartCorrectionResult,
} from "./correction-attempts.js";

export {
  InvalidProjectMemoryRecordError,
  createProjectMemory,
  deleteProjectMemory,
  getProjectMemory,
  listActiveProjectMemories,
  listProjectMemories,
  projectMemoryStats,
  sanitizedMemoryChars,
  setProjectMemoryStatus,
  updateProjectMemory,
  type CreateProjectMemoryInput,
  type MemorySanitizer,
  type MemoryWriteRefusal,
  type MemoryWriteResult,
  type ProjectMemoryStats,
  type UpdateProjectMemoryInput,
} from "./project-memory.js";

export {
  DATABASE_URL_ENV_VAR,
  databaseFileExists,
  findRepositoryRoot,
  resolveDatabaseUrl,
  toDatabaseFilePath,
  toSqliteUrl,
} from "./paths.js";

export {
  buildStructuredStateFromRows,
  getProjectBrief,
  getProjectV1Plan,
  loadProjectStructuredState,
  readProjectPlanRows,
  sanitizedBrief,
  sanitizedBriefChars,
  sanitizedV1Plan,
  sanitizedV1PlanChars,
  saveProjectBrief,
  saveProjectV1Plan,
  writeProjectBriefRow,
  writeProjectV1PlanRow,
} from "./project-plan.js";

export type {
  ProjectPlanQueryClient,
  ProjectPlanRevisions,
  ProjectPlanRows,
  ProjectPlanSanitizer,
  ProjectPlanTools,
  ProjectPlanWriteResult,
  ProjectStructuredState,
} from "./project-plan.js";

export {
  applyArchitectProjectUpdate,
  createArchitectProjectUpdate,
  dismissArchitectProjectUpdate,
  getArchitectProjectUpdate,
  getArchitectProjectUpdateForGeneration,
  listArchitectProjectUpdatesForSession,
} from "./architect-project-update.js";

export type {
  ArchitectProjectUpdateView,
  CreateProjectUpdateResult,
  ProjectUpdateActionResult,
  ProjectUpdateBase,
} from "./architect-project-update.js";

export {
  completeValidationBatch,
  getLatestValidationBatch,
  listValidationBatches,
  recordValidationResult,
  reserveValidationBatch,
  startValidationBatch,
  summarizeBatchStatus,
  type AutonomousValidationBatchRow,
  type AutonomousValidationResultRow,
  type ReserveBatchResult,
} from "./autonomous-validation.js";

export {
  readVerificationPlan,
  readVerificationPlans,
  writeVerificationPlan,
  type VerificationCommandInput,
  type VerificationCriterionInput,
  type VerificationPlanClient,
} from "./verification-plan.js";

export {
  getPendingReplanProposal,
  getReplanProposal,
  getReplanProposalForGeneration,
  listReplanProposals,
  listReplanProposalsForSession,
  writeReplanProposal,
  type ReplanProposalRecord,
  type WriteReplanProposalInput,
  type WriteReplanProposalResult,
} from "./replan.js";

export {
  loadReplanPlanningState,
  type ReplanPlanningState,
  type ReplanStateClient,
  type ReplanStateTask,
} from "./replan-state.js";

export {
  BOOTSTRAP_REQUIRES_REFRESH,
  applyReplanProposal,
  dismissReplanProposal,
  listReplanCreatedTasks,
  type ApplyReplanInput,
  type ApplyReplanResult,
  type DismissReplanResult,
  type ReplanApplyItem,
  type ReplanAppliedTask,
  type ReplanApplyOutcome,
  type ReplanRemovedTask,
  type ReplanStaleDetail,
} from "./replan-apply.js";

export {
  applyVerificationRefresh,
  bootstrapRefreshSucceeded,
  claimVerificationRefresh,
  failVerificationRefresh,
  getLatestVerificationRefresh,
  listVerificationRefreshes,
  recordVerificationRefreshResponse,
} from "./verification-refresh.js";

export type {
  AppliedVerificationTask,
  ApplyVerificationRefreshResult,
  ClaimVerificationRefreshResult,
  VerificationRefreshRow,
} from "./verification-refresh.js";
