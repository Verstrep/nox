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
  RUNNER_ERROR_DETAIL_LIMIT,
  RUNNER_SERVICE_NAME,
  boundErrorDetail,
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
  BOOTSTRAP_TASK_CODE,
  BOOTSTRAP_TASK_SEQUENCE,
  RESERVED_TASK_STATUSES,
  TASK_CODE_PREFIX,
  TASK_DOCUMENT_SYNC_STATUS,
  TASK_DOCUMENT_SYNC_STATUSES,
  TASK_KIND,
  TASK_KINDS,
  TASK_PRIORITIES,
  TASK_PRIORITY,
  allowedTaskStatusTransitions,
  canTransitionTaskStatus,
  formatTaskCode,
  isManagedTaskDocumentPath,
  isReservedTaskStatus,
  isTaskCode,
  isTaskDocumentSyncStatus,
  isTaskKind,
  isTaskPriority,
  taskDocumentPath,
  taskPriorityRank,
} from "./tasks.js";

export type {
  DevelopmentTaskDetail,
  DevelopmentTaskSummary,
  TaskDocumentSyncStatus,
  TaskKind,
  TaskPriority,
  TaskSpecification,
} from "./tasks.js";

export {
  FOUNDATIONAL_DOCUMENTS,
  REPOSITORY_INSPECTION_MAX_ENTRIES,
  REPOSITORY_MANIFEST_FILES,
  REPOSITORY_SHAPE,
  REPOSITORY_SHAPES,
  REPOSITORY_SOURCE_DIRECTORIES,
  classifyRepository,
  isInspectRepositorySuccess,
  isRepositoryInspection,
  isRepositoryShape,
  parseInspectRepositoryRequest,
} from "./repository-inspection.js";

export type {
  InspectRepositoryRequest,
  InspectRepositorySuccess,
  RepositoryInspection,
  RepositoryShape,
} from "./repository-inspection.js";

export {
  BOOTSTRAP_SPEC_LIMITS,
  BOOTSTRAP_SPEC_VERSION,
  BOOTSTRAP_TASK_TITLE,
  buildBootstrapTaskSpec,
} from "./bootstrap.js";

export type {
  BootstrapSpecInput,
  BootstrapTaskSpec,
  BootstrapUpcomingTask,
} from "./bootstrap.js";

export { renderTaskMarkdown } from "./task-markdown.js";
export type { TaskMarkdownDependency } from "./task-markdown.js";

export { repositoryLockKey, sameRepository } from "./repository-identity.js";

export {
  ACTIVE_RUN_STATUSES,
  FINAL_RUN_STATUSES,
  RUN_CODE_PREFIX,
  RUN_LIMITS,
  boundTail,
  boundText,
  canAutomateTaskStatusTransition,
  formatRunCode,
  isCancellableRunStatus,
  isFinalRunStatus,
  isRunnerRunId,
  taskStatusForRunOutcome,
} from "./runs.js";

export {
  CLAUDE_RUN_EVENT_KIND,
  CLAUDE_RUN_EVENT_KINDS,
  ESSENTIAL_EVENT_KINDS,
  RUN_EVENT_LIMITS,
  TRUNCATION_EVENT_DETAIL,
  TRUNCATION_EVENT_LABEL,
  isClaudeRunEvent,
  isClaudeRunEventKind,
  isEssentialEventKind,
} from "./claude-events.js";

export type {
  ClaudeRunEvent,
  ClaudeRunEventDraft,
  ClaudeRunEventKind,
} from "./claude-events.js";

export type {
  DevelopmentRunDetail,
  DevelopmentRunSummary,
  RunClaudeReport,
  RunGitState,
} from "./runs.js";

export {
  CLAUDE_BASE_ALLOWED_TOOLS,
  CLAUDE_BOOTSTRAP_DENIED_COMMANDS,
  CLAUDE_BOOTSTRAP_SETUP_PROGRAMS,
  CLAUDE_DENIED_COMMANDS,
  CLAUDE_GIT_READ_ONLY_COMMANDS,
  MAX_VALIDATION_COMMAND_LENGTH,
  buildClaudeToolPolicy,
  checkValidationCommand,
  formatBashRule,
} from "./claude-commands.js";

export type {
  ClaudeToolPolicy,
  ClaudeToolPolicyResult,
  CommandRefusal,
} from "./claude-commands.js";

export {
  TASK_DEPENDENCIES_UNRESOLVED,
  TASK_DEPENDENCY_ERROR,
  TASK_DEPENDENCY_ERROR_CODES,
  TASK_DEPENDENCY_LIMIT,
  checkTaskDependencyPair,
  createsDependencyCycle,
  dependencyPathExists,
  isDependencySatisfied,
  isTaskDependencyErrorCode,
  normalizeDependencyIds,
  sameDependencySet,
  summarizeTaskDependencies,
} from "./task-dependencies.js";

export type {
  TaskDependencyEdge,
  TaskDependencyEndpoint,
  TaskDependencyErrorCode,
  TaskDependencyLink,
  TaskDependencyRef,
  TaskDependencySummary,
} from "./task-dependencies.js";

export {
  EDITABLE_TASK_STATUSES,
  TASK_EDIT_ERROR,
  TASK_EDIT_ERROR_CODES,
  checkTaskEditable,
  isEditableTaskStatus,
  isTaskEditErrorCode,
  taskStatusAfterEdit,
} from "./task-edit.js";

export type { TaskEditEligibility, TaskEditErrorCode, TaskEditGate } from "./task-edit.js";

export {
  BOOTSTRAP_SETUP_STEP,
  renderClaudeExecutionPrompt,
  validationReportSections,
} from "./claude-prompt.js";

export {
  FEEDBACK_CLOSE,
  FEEDBACK_OPEN,
  renderClaudeCorrectionPrompt,
} from "./claude-correction-prompt.js";

export type { CorrectionPromptInput } from "./claude-correction-prompt.js";

export {
  CORRECTION_ATTEMPT_STATUS,
  CORRECTION_ATTEMPT_STATUSES,
  CORRECTION_EVIDENCE_LIMITS,
  CORRECTION_REFUSAL,
  CORRECTION_REFUSAL_CODES,
  CORRECTION_SOURCE,
  CORRECTION_SOURCES,
  CORRECTION_STAGE,
  CORRECTION_STAGES,
  CORRECTION_TRUNCATION_NOTICE,
  MAX_AUTOMATED_CORRECTION_ATTEMPTS,
  RUN_PROVENANCE,
  attemptHoldsPlace,
  checkAutomaticCorrection,
  checkHumanCorrection,
  deriveCorrectionCycle,
  isCorrectionAttemptStatus,
  isCorrectionSource,
  queueBlockedByCorrection,
  runProvenance,
} from "./correction-cycle.js";

export type {
  AutomaticCorrectionDecision,
  AutomaticCorrectionFacts,
  CorrectionAttemptFacts,
  CorrectionAttemptStatus,
  CorrectionCycleFacts,
  CorrectionCycleState,
  CorrectionRefusalCode,
  CorrectionSource,
  CorrectionStage,
  RunProvenance,
} from "./correction-cycle.js";

export {
  DELIVERY_LIMITS,
  DELIVERY_POLICIES,
  DELIVERY_POLICY,
  DELIVERY_REFUSAL,
  DELIVERY_REFUSAL_CODES,
  DELIVERY_STATUS,
  DELIVERY_STATUSES,
  DELIVERY_TRAILER_KEY,
  DELIVERY_TRIGGER,
  DELIVERY_TRIGGERS,
  buildDeliveryCommitMessage,
  candidatePaths,
  checkDeliveryEligibility,
  checkDeliveryPush,
  checkDeliveryWrite,
  deliveryHasCommit,
  deliverySatisfied,
  deliverySubject,
  deliveryTrailer,
  isDeletedEntry,
  isDeliveryPolicy,
  isDeliveryRefusalCode,
  isDeliveryStatus,
  isDeliveryTrigger,
  isUntrackedEntry,
  policyAllowsAutomatic,
  policyAllowsLocalAhead,
  policyRequiresPush,
  readDeliveryPolicy,
  readDeliveryStatus,
  readDeliveryTrigger,
  reconcilesExistingCommit,
  reconcilesExistingPush,
  sensitiveNewPaths,
} from "./git-delivery.js";

export type {
  DeliveryCandidateEntry,
  DeliveryEligibility,
  DeliveryEligibilityFacts,
  DeliveryPolicy,
  DeliveryPushFacts,
  DeliveryRefusalCode,
  DeliveryStatus,
  DeliveryTrigger,
  DeliveryUpstream,
  DeliveryWriteDecision,
  DeliveryWriteFacts,
} from "./git-delivery.js";

export {
  isDeliveryCommitSuccess,
  isDeliveryInspectSuccess,
  isDeliveryPushSuccess,
  parseDeliveryCommitRequest,
  parseDeliveryInspectRequest,
  parseDeliveryPushRequest,
} from "./git-delivery-runner.js";

export type {
  DeliveryCommitRequest,
  DeliveryCommitSuccess,
  DeliveryInspectRequest,
  DeliveryInspectSuccess,
  DeliveryInspection,
  DeliveryPushRequest,
  DeliveryPushSuccess,
} from "./git-delivery-runner.js";

export { renderCorrectionEvidence, renderFrozenContract } from "./correction-evidence.js";

export type {
  CorrectionCommandEvidence,
  CorrectionCriterionEvidence,
  CorrectionEvidence,
} from "./correction-evidence.js";

export {
  RESUME_REFUSAL,
  REVIEW_FEEDBACK_LIMITS,
  RUN_KIND,
  RUN_KINDS,
  WORKSPACE_FINGERPRINT_VERSION,
  checkResumeCandidate,
  checkReviewFeedback,
  isRunKind,
  isRunWorkspaceFingerprint,
  normalizeReviewFeedback,
} from "./corrections.js";

export type {
  ResumeCandidate,
  ResumeRefusal,
  ReviewFeedbackRefusal,
  RunKind,
  RunWorkspaceFingerprint,
} from "./corrections.js";

export {
  isClaudeCorrectionPreflightSuccess,
  isClaudePreflightSuccess,
  isClaudeRunCancelSuccess,
  isClaudeRunEventsSuccess,
  isClaudeRunReviewSuccess,
  isClaudeRunStatusSuccess,
  isStartClaudeRunSuccess,
  parseClaudeCorrectionPreflightRequest,
  parseClaudePreflightRequest,
  parseClaudeRunCancelRequest,
  parseClaudeRunEventsRequest,
  parseClaudeRunReviewRequest,
  parseClaudeRunStatusRequest,
  parseStartClaudeRunRequest,
} from "./claude.js";

export type {
  ClaudeCorrectionPreflightRequest,
  ClaudeCorrectionPreflightSuccess,
  ClaudePreflightGit,
  ClaudePreflightRequest,
  ClaudePreflightSuccess,
  ClaudeRunCancelRequest,
  ClaudeRunCancelSuccess,
  ClaudeRunEventsRequest,
  ClaudeRunEventsSuccess,
  ClaudeRunReviewRequest,
  ClaudeRunReviewSuccess,
  ClaudeRunSnapshot,
  ClaudeRunStatusRequest,
  ClaudeRunStatusSuccess,
  StartClaudeRunRequest,
  StartClaudeRunSuccess,
} from "./claude.js";

export {
  PATCH_TRUNCATION_NOTICE,
  REVIEW_LIMITS,
  RUN_CHANGE_TYPE,
  RUN_CHANGE_TYPES,
  RUN_VALIDATION_STATUS,
  RUN_VALIDATION_STATUSES,
  RUN_VALIDATION_SUMMARY,
  isAbsoluteLikePath,
  isRunFileChange,
  isRunReviewSnapshot,
  isRunValidationResultView,
  isSensitiveRepositoryPath,
  summarizeRunValidations,
  totalRunReview,
} from "./review.js";

export type {
  RunChangeType,
  RunFileChange,
  RunReviewSnapshot,
  RunReviewTotals,
  RunValidationResultView,
  RunValidationStatus,
  RunValidationSummary,
} from "./review.js";

export {
  isCreateTaskDocumentSuccess,
  isDeleteProjectDocumentsSuccess,
  isDeleteTaskDocumentSuccess,
  parseCreateTaskDocumentRequest,
  parseDeleteProjectDocumentsRequest,
  parseDeleteTaskDocumentRequest,
} from "./task-documents.js";

export type {
  CreateTaskDocumentRequest,
  CreateTaskDocumentSuccess,
  DeleteProjectDocumentsRequest,
  DeleteProjectDocumentsSuccess,
  DeleteTaskDocumentRequest,
  DeleteTaskDocumentSuccess,
  ProjectTaskArtifact,
} from "./task-documents.js";

export {
  EXECUTION_QUEUE_ERROR,
  LAUNCH_REFUSAL,
  EXECUTION_QUEUE_PENDING,
  QUEUE_DISPATCH,
  QUEUE_STATE,
  QUEUE_STATES,
  TASK_IS_QUEUED,
  checkQueueCandidate,
  deriveQueueState,
  isQueueBarrier,
  isQueueEntryEligible,
  isQueueLockedStatusChange,
  isQueueState,
  selectNextQueueEntry,
  selectQueueBarrier,
} from "./execution-queue.js";

export type {
  ExecutionQueueErrorCode,
  LaunchOutcome,
  LaunchRefusalCode,
  QueueCandidate,
  QueueCandidateCheck,
  QueueDispatchOutcome,
  QueueEntryFacts,
  QueueMoveDirection,
  QueueReadModel,
  QueueRepositoryReadiness,
  QueueState,
} from "./execution-queue.js";

export {
  PROJECT_DELETION_ERROR,
  TASK_ARTIFACT_OUTCOME,
  countModifiedArtifacts,
  countRemovedArtifacts,
  hasRefusedArtifact,
  projectDeletionConfirmed,
} from "./project-deletion.js";

export type {
  ProjectDeletionErrorCode,
  TaskArtifactOutcome,
  TaskArtifactReport,
} from "./project-deletion.js";

export {
  ARCHITECT_CONVERSATION_VERSION,
  ARCHITECT_ERROR,
  ARCHITECT_ERROR_CODES,
  ARCHITECT_GENERATION_STATUS,
  ARCHITECT_GENERATION_STATUSES,
  ARCHITECT_LIMITS,
  ARCHITECT_MESSAGE_ROLE,
  ARCHITECT_MESSAGE_ROLES,
  ARCHITECT_PROPOSAL_STATUS,
  ARCHITECT_PROPOSAL_STATUSES,
  ARCHITECT_SCHEMA_NAME,
  ARCHITECT_SCHEMA_VERSION,
  ARCHITECT_SESSION_KIND,
  ARCHITECT_SESSION_KINDS,
  ARCHITECT_SESSION_STATUS,
  ARCHITECT_SESSION_STATUSES,
  ARCHITECT_TURN_SCHEMA_VERSION,
  ARCHITECT_TURN_SCHEMA_VERSION_V3,
  ARCHITECT_TURN_SCHEMA_VERSION_V4,
  ARCHITECT_TURN_SCHEMA_VERSION_V5,
  ARCHITECT_TURN_SCHEMA_VERSION_V6,
  architectSchemaCarriesMemories,
  architectSchemaCarriesProjectUpdate,
  architectSchemaCarriesReplan,
  ARCHITECT_TURN_STATE,
  ARCHITECT_TURN_STATES,
  EMPTY_ARCHITECT_USAGE,
  architectSessionGenerationLimit,
  architectTurnSchemaVersion,
  buildArchitectTurnSchema,
  checkArchitectText,
  isArchitectContextManifest,
  isArchitectErrorCode,
  isArchitectGenerationStatus,
  isArchitectMessageRole,
  isArchitectProposalStatus,
  isArchitectSessionKind,
  isArchitectSessionStatus,
  isArchitectTurnState,
  normalizeArchitectText,
  readArchitectProposal,
  readArchitectTurn,
} from "./architect.js";

export type {
  ArchitectContextManifest,
  ArchitectContextSource,
  ArchitectErrorCode,
  ArchitectGenerationStatus,
  ArchitectMessageRole,
  ArchitectProposalRefusal,
  ArchitectProposalResult,
  ArchitectProposalStatus,
  ArchitectSessionKind,
  ArchitectSessionStatus,
  ArchitectTaskProposal,
  ArchitectTurnSchemaVersion,
  ArchitectTextRefusal,
  ArchitectTurn,
  ArchitectTurnResult,
  ArchitectTurnState,
  ArchitectUsage,
} from "./architect.js";

export {
  ARCHITECT_PROMPT_VERSION,
  CONVERSATION_CLOSE,
  CONVERSATION_OPEN,
  DOCUMENT_CLOSE,
  DOCUMENT_OPEN,
  MEMORY_CLOSE,
  MEMORY_OPEN,
  MESSAGE_CLOSE,
  MESSAGE_OPEN,
  USER_MESSAGE_CLOSE,
  USER_MESSAGE_OPEN,
  ARCHITECT_PROMPT_VERSION_V4,
  ARCHITECT_PROMPT_VERSION_V5,
  ARCHITECT_PROMPT_VERSION_V7,
  ARCHITECT_PROMPT_VERSION_V8,
  ARCHITECT_PROMPT_VERSION_V9,
  ARCHITECT_PROMPT_VERSION_V10,
  ARCHITECT_PROMPT_VERSION_V11,
  ARCHITECT_PROMPT_VERSION_V12,
  ARCHITECT_PROMPT_VERSION_V6,
  BRIEF_CLOSE,
  BRIEF_OPEN,
  PLAN_CLOSE,
  PLAN_OPEN,
  architectPromptVersion,
  neutralizeArchitectMarkers,
  renderArchitectPrompt,
} from "./architect-prompt.js";

export type {
  ArchitectPrompt,
  ArchitectPromptDocument,
  ArchitectPromptInput,
  ArchitectPromptMessage,
  ArchitectPromptTask,
} from "./architect-prompt.js";

export {
  ARCHITECT_REVIEW_BLOCKER,
  ARCHITECT_REVIEW_BLOCKERS,
  ARCHITECT_REVIEW_CRITERION_BASE,
  ARCHITECT_REVIEW_LIMITS,
  ARCHITECT_REVIEW_SCHEMA_NAME,
  ARCHITECT_REVIEW_SCHEMA_VERSION,
  ARCHITECT_REVIEW_SEVERITIES,
  ARCHITECT_REVIEW_SEVERITY,
  ARCHITECT_REVIEW_STATUS,
  ARCHITECT_REVIEW_STATUSES,
  ARCHITECT_REVIEW_VERDICT,
  ARCHITECT_REVIEW_VERDICTS,
  architectCriterionLabel,
  architectReviewBlockers,
  buildArchitectReviewSchema,
  guardArchitectReviewVerdict,
  isArchitectReviewBlocker,
  isArchitectReviewManifest,
  isArchitectReviewSeverity,
  isArchitectReviewStatus,
  isArchitectReviewVerdict,
  readArchitectReviewOutput,
} from "./architect-review.js";

export type {
  ArchitectReviewBlocker,
  ArchitectReviewFacts,
  ArchitectReviewFinding,
  ArchitectReviewGuardResult,
  ArchitectReviewManifest,
  ArchitectReviewOutput,
  ArchitectReviewReferences,
  ArchitectReviewRefusal,
  ArchitectReviewResult,
  ArchitectReviewSeverity,
  ArchitectReviewStatus,
  ArchitectReviewVerdict,
} from "./architect-review.js";

export {
  ARCHITECT_REVIEW_PROMPT_VERSION,
  REVIEW_FILE_CLOSE,
  REVIEW_FILE_OPEN,
  REVIEW_PATCH_NOTICE,
  REVIEW_PATCH_STATE,
  REVIEW_VALIDATION_CLOSE,
  REVIEW_VALIDATION_OPEN,
  neutralizeReviewMarkers,
  renderArchitectReviewPrompt,
} from "./architect-review-prompt.js";

export type {
  ArchitectReviewBundle,
  ArchitectReviewPrompt,
  ReviewPatchState,
  ReviewPromptFile,
  ReviewPromptRun,
  ReviewPromptTask,
  ReviewPromptValidation,
} from "./architect-review-prompt.js";

export {
  MEMORY_CODE_PREFIX,
  PROJECT_MEMORY_ACTION,
  PROJECT_MEMORY_ACTIONS,
  PROJECT_MEMORY_CATEGORIES,
  PROJECT_MEMORY_CATEGORY,
  PROJECT_MEMORY_LIMITS,
  PROJECT_MEMORY_STATUS,
  PROJECT_MEMORY_STATUSES,
  checkProjectMemoryInput,
  checkProjectMemoryProposal,
  formatProjectMemoryCode,
  isProjectMemoryAction,
  isProjectMemoryCategory,
  isProjectMemoryCode,
  isProjectMemoryStatus,
  normalizeProjectMemoryText,
  projectMemoryChars,
} from "./project-memory.js";

export type {
  ArchitectPromptMemory,
  ProjectMemoryAction,
  ProjectMemoryCategory,
  ProjectMemoryCheck,
  ProjectMemoryEntry,
  ProjectMemoryInput,
  ProjectMemoryProposal,
  ProjectMemoryProposalCheck,
  ProjectMemoryProposalRefusal,
  ProjectMemoryRefusal,
  ProjectMemoryStatus,
  ProjectMemoryValues,
} from "./project-memory.js";

export {
  ARCHITECT_BRIEF_IDENTIFIER,
  ARCHITECT_V1_PLAN_IDENTIFIER,
} from "./architect.js";

export {
  ARCHITECT_PROJECT_UPDATE_STATUS,
  ARCHITECT_PROJECT_UPDATE_STATUSES,
  PROJECT_PLAN_LIMITS,
  PROJECT_UPDATE_ACTION,
  PROJECT_UPDATE_ACTIONS,
  PROJECT_UPDATE_REASON_LIMIT,
  checkProjectBriefInput,
  checkProjectV1PlanInput,
  isArchitectProjectUpdateStatus,
  isProjectBriefEmpty,
  isProjectUpdateAction,
  isProjectV1PlanEmpty,
  normalizeProjectPlanList,
  normalizeProjectPlanText,
  projectBriefChars,
  projectUpdateTarget,
  projectUpdateTouchesSomething,
  projectV1PlanChars,
  readArchitectProjectUpdate,
  unchangedProjectUpdateSection,
} from "./project-plan.js";

export type {
  ArchitectProjectUpdateProposal,
  ArchitectProjectUpdateResult,
  ArchitectProjectUpdateStatus,
  ArchitectPromptBrief,
  ArchitectPromptV1Plan,
  ProjectBrief,
  ProjectBriefCheck,
  ProjectBriefInput,
  ProjectPlanField,
  ProjectPlanRefusal,
  ProjectUpdateAction,
  ProjectUpdateRefusal,
  ProjectUpdateSection,
  ProjectUpdateTarget,
  ProjectV1Plan,
  ProjectV1PlanCheck,
  ProjectV1PlanInput,
} from "./project-plan.js";

export {
  ARCHITECT_BACKLOG_GENERATION_STATUS,
  ARCHITECT_BACKLOG_GENERATION_STATUSES,
  ARCHITECT_BACKLOG_LIMITS,
  ARCHITECT_BACKLOG_MAX_OUTPUT_TOKENS,
  ARCHITECT_BACKLOG_PROPOSAL_STATUS,
  ARCHITECT_BACKLOG_PROPOSAL_STATUSES,
  ARCHITECT_BACKLOG_SCHEMA_NAME,
  ARCHITECT_BACKLOG_SCHEMA_VERSION,
  BACKLOG_CODE_PREFIX,
  buildArchitectBacklogSchema,
  formatBacklogCode,
  isArchitectBacklogGenerationStatus,
  isArchitectBacklogProposalStatus,
  isBacklogContextManifest,
  readArchitectBacklogProposal,
  ARCHITECT_BACKLOG_SCHEMA_NAME_2,
  ARCHITECT_BACKLOG_SCHEMA_VERSION_2,
  buildArchitectBacklogSchemaV2,
  readAnyArchitectBacklogProposal,
  readArchitectBacklogProposalV2,
  upgradeBacklogProposal,
  ARCHITECT_BACKLOG_SCHEMA_NAME_3,
  ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
  buildArchitectBacklogSchemaV3,
  readArchitectBacklogProposalV3,
  readBacklogDependsOn,
  upgradeBacklogProposalV2,
} from "./backlog.js";

export type {
  ArchitectBacklogGenerationStatus,
  ArchitectBacklogProposal,
  ArchitectBacklogProposalStatus,
  ArchitectBacklogRefusal,
  ArchitectBacklogResult,
  ArchitectBacklogTaskProposal,
  BacklogContextManifest,
  BacklogContextSource,
  BacklogInventoryTask,
  ArchitectBacklogCommandProposal,
  ArchitectBacklogCriterionProposal,
  ArchitectBacklogProposalV2,
  ArchitectBacklogProposalV3,
  ArchitectBacklogResultV3,
  ArchitectBacklogTaskProposalV3,
  ArchitectBacklogResultV2,
  ArchitectBacklogTaskProposalV2,
} from "./backlog.js";

export {
  ARCHITECT_BACKLOG_DIAGNOSTIC_LIMITS,
  ARCHITECT_BACKLOG_FAILURE,
  architectBacklogFailureCategory,
  describeBacklogDiagnosticField,
  sanitizeBacklogDiagnosticText,
} from "./backlog-diagnostic.js";

export type {
  ArchitectBacklogDiagnostic,
  ArchitectBacklogFailureCategory,
} from "./backlog-diagnostic.js";

export {
  ARCHITECT_DIAGNOSTIC_FIELD,
  ARCHITECT_DIAGNOSTIC_LIMITS,
  ARCHITECT_TURN_FAILURE,
  ARCHITECT_TURN_FAILURE_CATEGORIES,
  architectDiagnosticFieldLabel,
  architectTurnFailureCategory,
  architectTurnFailureCode,
  sanitizeArchitectDiagnosticText,
} from "./architect-diagnostic.js";

export type {
  ArchitectTurnDiagnostic,
  ArchitectTurnFailureCategory,
} from "./architect-diagnostic.js";

export {
  BACKLOG_PROMPT_VERSION,
  BACKLOG_PROMPT_VERSION_1,
  BACKLOG_PROMPT_VERSION_2,
  BACKLOG_PROMPT_VERSION_3,
  BACKLOG_PROMPT_VERSION_4,
  EXISTING_TASK_CLOSE,
  EXISTING_TASK_OPEN,
  renderBacklogPrompt,
} from "./backlog-prompt.js";

export type { BacklogPrompt, BacklogPromptInput } from "./backlog-prompt.js";

export {
  renderPromptBrief,
  renderPromptDocument,
  renderPromptMemory,
  renderPromptV1Plan,
  renderPromptEditableTask,
} from "./architect-prompt.js";

export {
  PROJECT_UPDATE_FIELD_KIND,
  buildArchitectProjectUpdateReview,
} from "./project-update-review.js";

export type {
  ProjectUpdateFieldKind,
  ProjectUpdateReview,
  ProjectUpdateReviewField,
  ProjectUpdateReviewSection,
} from "./project-update-review.js";

export {
  GUIDED_ACTION,
  GUIDED_ACTION_KINDS,
  GUIDED_BLOCKER,
  GUIDED_BLOCKER_CODES,
  GUIDED_PROGRESS_STEP,
  GUIDED_PROGRESS_STEPS,
  GUIDED_STAGE,
  GUIDED_STAGES,
  deriveGuidedWorkflowState,
  guidedActionCallsOpenAI,
  guidedActionStartsClaude,
  isGuidedBlockerCode,
  isGuidedWorkflowStage,
  selectGuidedCurrentRun,
} from "./guided-workflow.js";

export type {
  GuidedAction,
  GuidedActionKind,
  GuidedAnalysisFact,
  GuidedArchitectFact,
  GuidedBlocker,
  GuidedBlockerCode,
  GuidedCorrectionFact,
  GuidedCorrectionReadiness,
  GuidedLaunchReadiness,
  GuidedQueueFact,
  GuidedProgressEntry,
  GuidedProgressState,
  GuidedProgressStep,
  GuidedRunFact,
  GuidedWorkflowFacts,
  GuidedWorkflowStage,
  GuidedWorkflowState,
} from "./guided-workflow.js";

export {
  PROJECT_DOCUMENT_CATEGORIES,
  PROJECT_DOCUMENT_CATEGORY,
  isCreateProjectDocumentSuccess,
  isDeleteProjectDocumentSuccess,
  isListProjectDocumentsSuccess,
  isProjectDocumentCategory,
  isProjectDocumentRevision,
  isReadProjectDocumentSuccess,
  isUpdateProjectDocumentSuccess,
  parseCreateProjectDocumentRequest,
  parseDeleteProjectDocumentRequest,
  parseListProjectDocumentsRequest,
  parseReadProjectDocumentRequest,
  parseUpdateProjectDocumentRequest,
} from "./documents.js";

export type {
  CreateProjectDocumentRequest,
  CreateProjectDocumentSuccess,
  DeleteProjectDocumentRequest,
  DeleteProjectDocumentSuccess,
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

export {
  AUTONOMOUS_VALIDATION_OUTPUT_LIMIT,
  AUTONOMOUS_VALIDATION_PROGRAMS,
  AUTONOMOUS_VALIDATION_STATUS,
  AUTONOMOUS_VALIDATION_STATUSES,
  AUTONOMOUS_VALIDATION_TIMEOUT_MS,
  AUTO_COMPLETION_REFUSAL,
  COMMAND_EXECUTION_MODE,
  COMMAND_EXECUTION_MODES,
  CRITERION_VERIFICATION_RESULT,
  DEFAULT_HUMAN_INSTRUCTIONS,
  MAX_AUTONOMOUS_COMMANDS_PER_RUN,
  MAX_HUMAN_INSTRUCTIONS_LENGTH,
  MAX_OVERRIDE_REASON_LENGTH,
  REVIEW_DECISION_SOURCE,
  REVIEW_WAIT,
  REVIEW_WAIT_KINDS,
  REVIEW_DECISION_SOURCES,
  TASK_VERIFICATION_OUTCOME,
  TASK_VERIFICATION_OUTCOMES,
  VALIDATION_BATCH_STATUS,
  VALIDATION_BATCH_STATUSES,
  VALIDATION_EVIDENCE_SOURCE,
  VALIDATION_EVIDENCE_SOURCES,
  VERIFICATION_MODE,
  VERIFICATION_MODES,
  VERIFICATION_PLAN_ERROR,
  autonomousCommandsFor,
  checkAutoCompletion,
  checkAutonomousCommand,
  checkVerificationPlan,
  deriveCriterionResult,
  deriveCriterionResults,
  deriveTaskVerificationOutcome,
  humanCriteriaOf,
  isAutonomousValidationStatus,
  isBatchFinal,
  isCommandExecutionMode,
  isReviewDecisionSource,
  isTaskVerificationOutcome,
  isValidationBatchStatus,
  isValidationEvidenceSource,
  isValidationFailure,
  isVerificationMode,
  parseValidationCommand,
  planAllowsAutoCompletion,
  planRequiresHuman,
} from "./verification.js";

export type {
  AutoCompletionDecision,
  AutoCompletionFacts,
  AutoCompletionRefusalCode,
  AutonomousCommandOutcome,
  AutonomousValidationStatus,
  CommandExecutionMode,
  CriterionVerificationResult,
  CriterionVerificationView,
  ParsedCommand,
  ReviewDecisionSource,
  ReviewWait,
  ReviewWaitKind,
  TaskVerificationOutcome,
  ValidationBatchStatus,
  ValidationEvidenceSource,
  VerificationMode,
  VerificationPlan,
  VerificationPlanCheck,
  VerificationPlanCommand,
  VerificationPlanCriterion,
  VerificationPlanErrorCode,
  VerificationPlanIssue,
} from "./verification.js";

export {
  TRACKED_STATE_FILE_LIMIT,
  VALIDATION_OUTPUT_LIMIT,
  boundOutput,
  isRunValidationSuccess,
  isTrackedStateSuccess,
  parseRunValidationRequest,
  parseTrackedStateRequest,
} from "./validation-runner.js";

export type {
  RunValidationRequest,
  RunValidationSuccess,
  TrackedStateRequest,
  TrackedStateSuccess,
} from "./validation-runner.js";

// --- Replanification (TASK-032) ----------------------------------------------

export {
  REPLAN_CHANGE,
  REPLAN_CHANGES,
  REPLAN_FIELD,
  REPLAN_FIELDS,
  REPLAN_LIMITS,
  REPLAN_MAX_OUTPUT_TOKENS,
  REPLAN_MODE,
  REPLAN_MODES,
  REPLAN_PROMPT_VERSION,
  REPLAN_PROPOSAL_STATUS,
  REPLAN_PROPOSAL_STATUSES,
  REPLAN_SCHEMA_VERSION,
  buildReplanSchema,
  checkReplanTargetGraph,
  isReplanChange,
  isReplanMode,
  isReplanProposal,
  isReplanProposalStatus,
  readArchitectReplan,
} from "./replan.js";

export type {
  ArchitectPromptEditableTask,
  ArchitectPromptLockedTask,
  ArchitectPromptPlanningState,
} from "./architect-prompt.js";

export type {
  ArchitectReplan,
  ReplanChange,
  ReplanField,
  ReplanMode,
  ReplanProposal,
  ReplanProposalStatus,
  ReplanRefusal,
  ReplanResult,
  ReplanSourceState,
  ReplanSourceTask,
  ReplanTargetTask,
} from "./replan.js";

export {
  REPLAN_LOCK_REASON,
  REPLAN_LOCK_REASONS,
  REPLAN_UNAVAILABLE,
  classifyReplanTask,
  classifyReplanTasks,
  isReplanLockReason,
  lockedTaskIsHistorical,
  replanAvailability,
} from "./replan-classification.js";

export type {
  ReplanAvailability,
  ReplanClassifiedTask,
  ReplanLockReason,
  ReplanTaskFacts,
  ReplanUnavailableCode,
} from "./replan-classification.js";

export {
  VERIFICATION_REFRESH_LIMITS,
  VERIFICATION_REFRESH_MAX_OUTPUT_TOKENS,
  VERIFICATION_REFRESH_PROMPT_VERSION,
  VERIFICATION_REFRESH_REFUSAL,
  VERIFICATION_REFRESH_SCHEMA_NAME,
  VERIFICATION_REFRESH_SCHEMA_VERSION,
  VERIFICATION_REFRESH_STATUS,
  VERIFICATION_REFRESH_STATUSES,
  buildVerificationRefreshSchema,
  isVerificationRefreshStatus,
  readVerificationRefreshProposal,
  renderVerificationRefreshPrompt,
} from "./verification-refresh.js";

export type {
  VerificationRefreshCommand,
  VerificationRefreshCriterion,
  VerificationRefreshPrompt,
  VerificationRefreshPromptInput,
  VerificationRefreshProposal,
  VerificationRefreshRefusal,
  VerificationRefreshRefusalCode,
  VerificationRefreshResult,
  VerificationRefreshStatus,
  VerificationRefreshTarget,
  VerificationRefreshTask,
} from "./verification-refresh.js";
