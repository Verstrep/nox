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
  ARCHITECT_REVIEW_BLOCKER,
  ARCHITECT_REVIEW_SEVERITY,
  ARCHITECT_REVIEW_STATUS,
  ARCHITECT_REVIEW_VERDICT,
  ARCHITECT_SESSION_STATUS,
  CLAUDE_RUN_EVENT_KIND,
  GUIDED_ACTION,
  GUIDED_BLOCKER,
  GUIDED_PROGRESS_STEP,
  GUIDED_STAGE,
  PROJECT_MEMORY_CATEGORY,
  PROJECT_MEMORY_STATUS,
  REVIEW_PATCH_STATE,
  RUN_CHANGE_TYPE,
  RUN_STATUS,
  RUN_VALIDATION_STATUS,
  RUN_VALIDATION_SUMMARY,
  TASK_DOCUMENT_SYNC_STATUS,
  TASK_PRIORITY,
  TASK_STATUS,
  type ArchitectGenerationStatus,
  type ArchitectMessageRole,
  type ArchitectReviewBlocker,
  type ArchitectReviewSeverity,
  type ArchitectReviewStatus,
  type ArchitectReviewVerdict,
  type ArchitectSessionStatus,
  type ClaudeRunEventKind,
  type GuidedActionKind,
  type GuidedBlockerCode,
  type GuidedProgressStep,
  type GuidedWorkflowStage,
  type ProjectMemoryCategory,
  type ProjectMemoryStatus,
  type ReviewPatchState,
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
  MEMORY_ADDED: "Added to project memory",
  MEMORY_MODIFIED: "Memory changed",
  // Archivage et suppression produisent la meme absence : le manifest ne
  // conserve que ce qui a ete envoye, et nommer la cause reviendrait a
  // l'inventer.
  MEMORY_REMOVED: "Removed from Architect context",
  BRIEF_ADDED: "Project Brief defined",
  BRIEF_MODIFIED: "Project Brief changed",
  BRIEF_REMOVED: "Project Brief removed",
  PLAN_ADDED: "V1 Plan defined",
  PLAN_MODIFIED: "V1 Plan changed",
  PLAN_REMOVED: "V1 Plan removed",
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

/**
 * Verdicts d'une review Architecte.
 *
 * Les trois libelles portent le mot « recommended » ou « required » : aucun ne
 * doit pouvoir se lire comme une decision. « Approved » tout court laisserait
 * croire que quelque chose a ete approuve, alors que rien ne l'a ete.
 */
const ARCHITECT_REVIEW_VERDICT_LABELS: Record<ArchitectReviewVerdict, string> = {
  [ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED]: "Approve recommended",
  [ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED]: "Changes recommended",
  [ARCHITECT_REVIEW_VERDICT.HUMAN_REVIEW_REQUIRED]: "Human review required",
};

const ARCHITECT_REVIEW_SEVERITY_LABELS: Record<ArchitectReviewSeverity, string> = {
  [ARCHITECT_REVIEW_SEVERITY.BLOCKER]: "Blocker",
  [ARCHITECT_REVIEW_SEVERITY.MAJOR]: "Major",
  [ARCHITECT_REVIEW_SEVERITY.MINOR]: "Minor",
  [ARCHITECT_REVIEW_SEVERITY.NOTE]: "Note",
};

const ARCHITECT_REVIEW_STATUS_LABELS: Record<ArchitectReviewStatus, string> = {
  [ARCHITECT_REVIEW_STATUS.RUNNING]: "Running",
  [ARCHITECT_REVIEW_STATUS.COMPLETED]: "Completed",
  [ARCHITECT_REVIEW_STATUS.REFUSED]: "Refused",
  [ARCHITECT_REVIEW_STATUS.FAILED]: "Failed",
};

/**
 * Sort du patch d'un fichier dans le bundle.
 *
 * Cinq libelles distincts, parce que les cinq situations demandent cinq
 * conclusions differentes. « Contenu indisponible » partout laisserait croire a
 * une panne la ou il y a une decision — masquer un `.env` en est une.
 */
const REVIEW_PATCH_STATE_LABELS: Record<ReviewPatchState, string> = {
  [REVIEW_PATCH_STATE.INCLUDED]: "Included",
  [REVIEW_PATCH_STATE.SENSITIVE_HIDDEN]: "Content hidden",
  [REVIEW_PATCH_STATE.BINARY_UNAVAILABLE]: "Binary",
  [REVIEW_PATCH_STATE.TRUNCATED]: "Truncated",
  [REVIEW_PATCH_STATE.UNAVAILABLE]: "Unavailable",
  [REVIEW_PATCH_STATE.OMITTED_BY_LIMIT]: "Not sent",
};

/**
 * Faits qui interdisent une recommandation d'approbation.
 *
 * Chaque phrase decrit ce que l'architecte **n'a pas pu voir**, ou ce que la
 * review dit de certain. Aucune ne porte de jugement sur le travail : ce n'est
 * pas le role de la garde, et ce serait exactement l'endroit ou une machine
 * n'aurait pas a en avoir.
 */
const ARCHITECT_REVIEW_BLOCKER_LABELS: Record<ArchitectReviewBlocker, string> = {
  [ARCHITECT_REVIEW_BLOCKER.RUN_NOT_COMPLETED]:
    "Cette execution ne s'est pas terminee normalement : les changements peuvent etre partiels.",
  [ARCHITECT_REVIEW_BLOCKER.REVIEW_UNRELIABLE]:
    "L'etat Git a ete modifie d'une facon interdite pendant l'execution : la review ne decrit plus seulement ce que l'agent a produit.",
  [ARCHITECT_REVIEW_BLOCKER.REVIEW_ERROR]:
    "La capture de review a rencontre une erreur : son contenu peut etre incomplet.",
  [ARCHITECT_REVIEW_BLOCKER.SENSITIVE_FILE]:
    "Un fichier sensible a ete modifie et son contenu n'est jamais transmis.",
  [ARCHITECT_REVIEW_BLOCKER.BINARY_FILE]:
    "Un fichier binaire a ete modifie et son contenu n'est pas disponible.",
  [ARCHITECT_REVIEW_BLOCKER.TRUNCATED_PATCH]:
    "Au moins un diff a ete tronque a la capture : l'architecte n'en a lu qu'une partie.",
  [ARCHITECT_REVIEW_BLOCKER.OMITTED_FILES]:
    "Des fichiers changes ne figurent pas dans la review enregistree.",
  [ARCHITECT_REVIEW_BLOCKER.ARCHITECT_TRUNCATED]:
    "Cette review contient plus d'informations que NOX n'en a envoyees a l'architecte.",
  [ARCHITECT_REVIEW_BLOCKER.VALIDATION_FAILED]: "Une commande de validation a echoue.",
  [ARCHITECT_REVIEW_BLOCKER.VALIDATION_UNKNOWN]:
    "Une commande de validation a demarre sans qu'un resultat exploitable arrive.",
  [ARCHITECT_REVIEW_BLOCKER.VALIDATION_NOT_RUN]:
    "Une commande de validation attendue n'a jamais ete lancee.",
};

/**
 * Etapes du workflow guide.
 *
 * Les memes mots que les statuts techniques voisins, parce qu'ils decrivent la
 * meme realite vue autrement : `Reviewing` est ce que fait l'utilisateur pendant
 * qu'une tache porte le statut `Review`.
 */
const GUIDED_STAGE_LABELS: Record<GuidedWorkflowStage, string> = {
  [GUIDED_STAGE.DRAFTING]: "Drafting",
  [GUIDED_STAGE.READY_TO_RUN]: "Ready to run",
  [GUIDED_STAGE.WAITING_FOR_DEPENDENCIES]: "Waiting for dependencies",
  [GUIDED_STAGE.RUNNING]: "Running",
  [GUIDED_STAGE.RUN_FAILED]: "Run failed",
  [GUIDED_STAGE.REVIEWING]: "Reviewing",
  [GUIDED_STAGE.ARCHITECT_REVIEW]: "Architect review",
  [GUIDED_STAGE.CHANGES_REQUESTED]: "Changes requested",
  [GUIDED_STAGE.CORRECTION_READY]: "Correction ready",
  [GUIDED_STAGE.DONE]: "Done",
  [GUIDED_STAGE.BLOCKED]: "Blocked",
};

/**
 * Actions proposees par le guide.
 *
 * Trois d'entre elles menent a la page de review sous trois libelles :
 * `Review changes` quand c'est l'etape neutre, `Review manually` quand
 * l'Architecte ne peut pas aider, `Review and approve` quand il recommande
 * d'approuver. Le libelle porte **pourquoi** on y va — et c'est precisement ce
 * que le guide ajoute a un simple lien.
 *
 * `Resume Claude Code` et `Prepare correction` menent, elles, a la meme page de
 * preparation : la premiere dit que toutes les preconditions sont tenues, la
 * seconde qu'il faut aller voir. Aucune des deux ne lance quoi que ce soit.
 */
const GUIDED_ACTION_LABELS: Record<GuidedActionKind, string> = {
  [GUIDED_ACTION.OPEN_DOCUMENT]: "Open document",
  [GUIDED_ACTION.RESOLVE_DOCUMENT_SYNC]: "Resolve document sync",
  [GUIDED_ACTION.MARK_READY]: "Mark ready",
  [GUIDED_ACTION.BACK_TO_DRAFT]: "Back to draft",
  [GUIDED_ACTION.RETRY]: "Retry",
  [GUIDED_ACTION.RUN_CLAUDE]: "Run Claude Code",
  [GUIDED_ACTION.OPEN_QUEUE]: "Open queue",
  [GUIDED_ACTION.OPEN_RUN]: "Open run",
  [GUIDED_ACTION.OPEN_RUN_HISTORY]: "Open run history",
  [GUIDED_ACTION.OPEN_REVIEW]: "Review changes",
  [GUIDED_ACTION.REVIEW_MANUALLY]: "Review manually",
  [GUIDED_ACTION.REVIEW_AND_APPROVE]: "Review and approve",
  [GUIDED_ACTION.ANALYZE_WITH_ARCHITECT]: "Analyze with Architect",
  [GUIDED_ACTION.OPEN_ARCHITECT_ANALYSIS]: "Open analysis",
  [GUIDED_ACTION.USE_AS_FEEDBACK]: "Use as feedback",
  [GUIDED_ACTION.REQUEST_CHANGES]: "Request changes",
  [GUIDED_ACTION.PREPARE_CORRECTION]: "Prepare correction",
  [GUIDED_ACTION.RESUME_CLAUDE]: "Resume Claude Code",
  [GUIDED_ACTION.APPROVE]: "Approve",
  [GUIDED_ACTION.REOPEN]: "Reopen",
  [GUIDED_ACTION.DELETE_TASK]: "Delete task",
};

/**
 * Ce qui empeche d'avancer.
 *
 * Chaque phrase dit un fait **et** ce qu'il reste possible de faire. Un blocage
 * qu'on ne sait pas lever se lit comme une panne ; un blocage qui semble tout
 * arreter alors que la moitie des actions restent ouvertes se lit comme un bug.
 */
const GUIDED_BLOCKER_LABELS: Record<GuidedBlockerCode, string> = {
  [GUIDED_BLOCKER.DOCUMENT_NOT_SYNCED]:
    "Le document Markdown de cette tache n'est pas synchronise avec sa specification. Le lancement d'une execution l'exige.",
  [GUIDED_BLOCKER.ACCEPTANCE_CRITERIA_MISSING]:
    "Cette tache ne porte aucun critere d'acceptation : rien ne permettrait de dire « c'est fait ».",
  [GUIDED_BLOCKER.EXECUTION_QUEUE_PENDING]:
    "Ce projet possede une file d'execution en attente. Le lancement direct est refuse tant " +
    "qu'elle contient des taches : demarrez la file, ou retirez-en cette tache.",
  [GUIDED_BLOCKER.DEPENDENCIES_UNRESOLVED]:
    "Cette tache attend une ou plusieurs taches qui ne sont pas terminees. Son statut ne change pas pour autant : c'est le lancement qui est refuse, pas la tache qui est bloquee.",
  [GUIDED_BLOCKER.RUNNER_UNAVAILABLE]:
    "Le runner local ne repond pas. Les operations de NOX qui ne touchent pas au repository restent disponibles.",
  [GUIDED_BLOCKER.CLAUDE_UNAVAILABLE]:
    "Claude Code n'est pas disponible sur cette machine. NOX ne le suppose pas installe.",
  [GUIDED_BLOCKER.REPOSITORY_NOT_READY]:
    "Le repository n'est pas dans un etat permettant de lancer une execution.",
  [GUIDED_BLOCKER.RUN_ACTIVE]:
    "Une execution est en cours. NOX n'en lance qu'une a la fois, tous projets confondus.",
  [GUIDED_BLOCKER.REVIEW_UNAVAILABLE]:
    "Aucun instantane de review n'est enregistre pour cette execution.",
  [GUIDED_BLOCKER.OPENAI_UNAVAILABLE]:
    "La configuration OpenAI est incomplete : l'Architecte ne peut pas etre sollicite. Approve et Request changes restent utilisables.",
  [GUIDED_BLOCKER.ARCHITECT_ANALYSIS_ACTIVE]:
    "Une analyse Architecte est deja en cours sur cette execution.",
  [GUIDED_BLOCKER.ARCHITECT_LIMIT_REACHED]:
    "Le nombre maximal d'analyses est atteint pour cette execution. Les analyses deja produites restent consultables.",
  [GUIDED_BLOCKER.CORRECTION_PRECONDITION_FAILED]:
    "Une precondition de la correction ciblee n'est pas tenue.",
  [GUIDED_BLOCKER.TASK_BLOCKED]:
    "Cette tache est bloquee : un humain doit regarder le repository avant toute suite.",
};

/** Etapes de la bande de progression. */
const GUIDED_PROGRESS_STEP_LABELS: Record<GuidedProgressStep, string> = {
  [GUIDED_PROGRESS_STEP.SPECIFICATION]: "Specification",
  [GUIDED_PROGRESS_STEP.EXECUTION]: "Claude execution",
  [GUIDED_PROGRESS_STEP.REVIEW]: "Review",
  [GUIDED_PROGRESS_STEP.CORRECTION]: "Correction",
  [GUIDED_PROGRESS_STEP.DONE]: "Done",
};

/**
 * Categories de la memoire projet.
 *
 * Quatre libelles, comme quatre categories. `Knowledge` plutot que `Fact` :
 * une connaissance durable peut etre un usage, un environnement, une habitude
 * d'equipe — pas seulement un fait verifiable.
 */
const PROJECT_MEMORY_CATEGORY_LABELS: Record<ProjectMemoryCategory, string> = {
  [PROJECT_MEMORY_CATEGORY.DECISION]: "Decision",
  [PROJECT_MEMORY_CATEGORY.CONSTRAINT]: "Constraint",
  [PROJECT_MEMORY_CATEGORY.CONVENTION]: "Convention",
  [PROJECT_MEMORY_CATEGORY.KNOWLEDGE]: "Knowledge",
};

/**
 * Etat d'une entree de memoire.
 *
 * `Active` veut dire « envoyee a l'Architecte », `Archived` « conservee mais non
 * envoyee ». Les deux mots portent cette difference a eux seuls, ce qui evite
 * d'avoir a la relire ailleurs sur la page.
 */
const PROJECT_MEMORY_STATUS_LABELS: Record<ProjectMemoryStatus, string> = {
  [PROJECT_MEMORY_STATUS.ACTIVE]: "Active",
  [PROJECT_MEMORY_STATUS.ARCHIVED]: "Archived",
};

/** Description courte d'une categorie, affichee dans le formulaire. */
const PROJECT_MEMORY_CATEGORY_HINTS: Record<ProjectMemoryCategory, string> = {
  [PROJECT_MEMORY_CATEGORY.DECISION]: "Un choix deja tranche pour ce projet.",
  [PROJECT_MEMORY_CATEGORY.CONSTRAINT]: "Une limite qu'une decision future doit respecter.",
  [PROJECT_MEMORY_CATEGORY.CONVENTION]: "Une regle de conception ou de developpement.",
  [PROJECT_MEMORY_CATEGORY.KNOWLEDGE]: "Un fait durable utile a la comprehension du projet.",
};

export function projectMemoryCategoryLabel(category: ProjectMemoryCategory): string {
  return PROJECT_MEMORY_CATEGORY_LABELS[category];
}

export function projectMemoryStatusLabel(status: ProjectMemoryStatus): string {
  return PROJECT_MEMORY_STATUS_LABELS[status];
}

export function projectMemoryCategoryHint(category: ProjectMemoryCategory): string {
  return PROJECT_MEMORY_CATEGORY_HINTS[category];
}

export function guidedStageLabel(stage: GuidedWorkflowStage): string {
  return GUIDED_STAGE_LABELS[stage];
}

export function guidedActionLabel(kind: GuidedActionKind): string {
  return GUIDED_ACTION_LABELS[kind];
}

export function guidedBlockerLabel(code: GuidedBlockerCode): string {
  return GUIDED_BLOCKER_LABELS[code];
}

export function guidedProgressStepLabel(step: GuidedProgressStep): string {
  return GUIDED_PROGRESS_STEP_LABELS[step];
}

export function architectReviewVerdictLabel(verdict: ArchitectReviewVerdict): string {
  return ARCHITECT_REVIEW_VERDICT_LABELS[verdict];
}

export function architectReviewSeverityLabel(severity: ArchitectReviewSeverity): string {
  return ARCHITECT_REVIEW_SEVERITY_LABELS[severity];
}

export function architectReviewStatusLabel(status: ArchitectReviewStatus): string {
  return ARCHITECT_REVIEW_STATUS_LABELS[status];
}

export function reviewPatchStateLabel(state: ReviewPatchState): string {
  return REVIEW_PATCH_STATE_LABELS[state];
}

export function architectReviewBlockerLabel(blocker: ArchitectReviewBlocker): string {
  return ARCHITECT_REVIEW_BLOCKER_LABELS[blocker];
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
