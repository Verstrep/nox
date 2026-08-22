/**
 * Boucle de developpement guidee : ou en sommes-nous, et que faire ensuite ?
 *
 * ## Une projection, jamais une seconde source de verite
 *
 * NOX possede deja tout ce qu'il faut pour repondre : `Task.status`,
 * `Run.status`, `Run.kind`, l'instantane de review, les analyses Architecte, les
 * feedbacks de correction, l'etat du document Markdown. Ce module ne stocke
 * rien, ne persiste rien et n'ajoute aucune colonne : il **derive** une
 * recommandation a partir de ces faits.
 *
 * Une colonne `currentStep` aurait paru plus simple. Elle aurait surtout fini
 * par mentir : deux representations d'une meme verite divergent toujours, et
 * c'est celle qui est ecrite qu'on croit.
 *
 * ## Recommander n'est pas autoriser
 *
 * Rien ici ne decide qu'une action est permise. Les Server Actions, les
 * transitions de `tasks.ts`, le preflight du runner et les gardes de TASK-011 a
 * TASK-015 restent les seules autorites. Le guide dit « voici ce qui a du sens
 * maintenant » ; si l'utilisateur clique sur un bouton devenu obsolete entre
 * l'affichage et le clic, c'est l'action existante qui refuse — pas le guide.
 *
 * C'est aussi ce qui rend l'affichage perime inoffensif : la page peut avoir
 * tort, l'execution non.
 *
 * ## Deterministe, hors ligne, gratuit
 *
 * Le choix de la prochaine etape ne demande rien a personne. Aucun appel OpenAI,
 * aucun appel Claude, aucune lecture de fichier, aucun acces a la base : cette
 * fonction est pure, et ses entrees sont des faits deja etablis. Demander a un
 * modele « que devrait faire l'utilisateur maintenant ? » couterait de l'argent
 * pour produire une reponse moins fiable que celle-ci — la machine d'etat locale
 * connait deja tous les faits.
 */

import type { ArchitectReviewBlocker, ArchitectReviewVerdict } from "./architect-review.js";
import { ARCHITECT_REVIEW_VERDICT } from "./architect-review.js";
import type { RunKind } from "./corrections.js";
import { RUN_KIND } from "./corrections.js";
import { isFinalRunStatus } from "./runs.js";
import { RUN_STATUS, TASK_STATUS, createStatusGuard } from "./statuses.js";
import type { RunStatus, TaskStatus } from "./statuses.js";
import type { TaskDependencyLink } from "./task-dependencies.js";
import { TASK_DOCUMENT_SYNC_STATUS } from "./tasks.js";
import type { TaskDocumentSyncStatus } from "./tasks.js";

/**
 * Ou en est la tache, du point de vue du travail — pas du point de vue de la
 * base.
 *
 * Ces valeurs ne sont **jamais** stockees. Elles n'existent que le temps d'un
 * rendu, et se recalculent entierement au suivant.
 */
export const GUIDED_STAGE = {
  /** La specification s'ecrit encore. */
  DRAFTING: "DRAFTING",
  /** La specification est arretee ; Claude Code n'est pas encore passe. */
  READY_TO_RUN: "READY_TO_RUN",
  /**
   * La specification est arretee, mais une dependance explicite n'est pas
   * terminee.
   *
   * Distincte de `READY_TO_RUN` parce que la reponse a « que faire ensuite »
   * est differente : il n'y a rien a faire **ici**, le travail attendu est
   * ailleurs. Distincte de `BLOCKED` parce que rien n'est casse — le statut de
   * la tache reste `READY`, et l'attente se resoudra d'elle-meme.
   */
  WAITING_FOR_DEPENDENCIES: "WAITING_FOR_DEPENDENCIES",
  /** Une execution est en cours. */
  RUNNING: "RUNNING",
  /** La derniere execution a echoue. */
  RUN_FAILED: "RUN_FAILED",
  /** Un travail attend une decision humaine. */
  REVIEWING: "REVIEWING",
  /** Une analyse Architecte terminee eclaire cette decision. */
  ARCHITECT_REVIEW: "ARCHITECT_REVIEW",
  /** Un feedback est enregistre ; la correction n'est pas encore lancable. */
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  /** Toutes les preconditions de reprise sont tenues. */
  CORRECTION_READY: "CORRECTION_READY",
  /** Le travail a ete accepte. */
  DONE: "DONE",
  /** Quelque chose empeche d'avancer, et un humain doit regarder. */
  BLOCKED: "BLOCKED",
} as const;

export type GuidedWorkflowStage = (typeof GUIDED_STAGE)[keyof typeof GUIDED_STAGE];

export const GUIDED_STAGES: readonly GuidedWorkflowStage[] = Object.values(GUIDED_STAGE);

export const isGuidedWorkflowStage = createStatusGuard(GUIDED_STAGES);

/**
 * Actions proposees par le guide.
 *
 * Chacune designe une surface **qui existe deja**. Le guide ne recopie aucun
 * formulaire et ne declare aucune nouvelle Server Action : il pointe vers la
 * page ou la decision se prend, et c'est la que le bouton reel se trouve.
 *
 * Trois d'entre elles menent a la meme page de review sous trois libelles
 * differents — `Review changes`, `Review manually`, `Review and approve` — et
 * ce n'est pas une redondance : le libelle porte **pourquoi** on y va, et c'est
 * exactement l'information que le guide ajoute.
 */
export const GUIDED_ACTION = {
  /** Ouvrir le document Markdown de la tache. */
  OPEN_DOCUMENT: "OPEN_DOCUMENT",
  /** Reparer la synchronisation du document. */
  RESOLVE_DOCUMENT_SYNC: "RESOLVE_DOCUMENT_SYNC",
  /** `DRAFT → READY`, decide par l'utilisateur. */
  MARK_READY: "MARK_READY",
  /** `READY → DRAFT`. */
  BACK_TO_DRAFT: "BACK_TO_DRAFT",
  /** `FAILED → READY`. */
  RETRY: "RETRY",
  /** Preparer une execution de Claude Code. */
  RUN_CLAUDE: "RUN_CLAUDE",
  /** Suivre l'execution en cours. */
  OPEN_RUN: "OPEN_RUN",
  /** Consulter l'historique des executions de la tache. */
  OPEN_RUN_HISTORY: "OPEN_RUN_HISTORY",
  /** Ouvrir la review des changements. */
  OPEN_REVIEW: "OPEN_REVIEW",
  /** Ouvrir la review parce que l'Architecte ne peut pas aider. */
  REVIEW_MANUALLY: "REVIEW_MANUALLY",
  /** Ouvrir la review a l'endroit de la decision, apres un avis favorable. */
  REVIEW_AND_APPROVE: "REVIEW_AND_APPROVE",
  /** Demander une seconde lecture a l'Architecte. */
  ANALYZE_WITH_ARCHITECT: "ANALYZE_WITH_ARCHITECT",
  /** Relire une analyse enregistree. */
  OPEN_ARCHITECT_ANALYSIS: "OPEN_ARCHITECT_ANALYSIS",
  /** Preremplir le formulaire de correction avec le feedback propose. */
  USE_AS_FEEDBACK: "USE_AS_FEEDBACK",
  /** Ecrire soi-meme une demande de correction. */
  REQUEST_CHANGES: "REQUEST_CHANGES",
  /** Ouvrir la preparation d'une correction. */
  PREPARE_CORRECTION: "PREPARE_CORRECTION",
  /** Ouvrir la preparation, dont toutes les preconditions sont tenues. */
  RESUME_CLAUDE: "RESUME_CLAUDE",
  /** Accepter le travail. */
  APPROVE: "APPROVE",
  /** Remettre une tache acceptee en file. */
  REOPEN: "REOPEN",
  /** Supprimer une tache sans historique. */
  DELETE_TASK: "DELETE_TASK",
} as const;

export type GuidedActionKind = (typeof GUIDED_ACTION)[keyof typeof GUIDED_ACTION];

export const GUIDED_ACTION_KINDS: readonly GuidedActionKind[] = Object.values(GUIDED_ACTION);

/**
 * Ce qui empeche d'avancer.
 *
 * Aucun de ces codes ne remplace une erreur metier existante : le guide
 * **traduit** un fait deja etabli ailleurs, et transporte tel quel le message
 * que la couche concernee avait deja formule.
 */
export const GUIDED_BLOCKER = {
  DOCUMENT_NOT_SYNCED: "DOCUMENT_NOT_SYNCED",
  ACCEPTANCE_CRITERIA_MISSING: "ACCEPTANCE_CRITERIA_MISSING",
  RUNNER_UNAVAILABLE: "RUNNER_UNAVAILABLE",
  CLAUDE_UNAVAILABLE: "CLAUDE_UNAVAILABLE",
  REPOSITORY_NOT_READY: "REPOSITORY_NOT_READY",
  RUN_ACTIVE: "RUN_ACTIVE",
  REVIEW_UNAVAILABLE: "REVIEW_UNAVAILABLE",
  OPENAI_UNAVAILABLE: "OPENAI_UNAVAILABLE",
  ARCHITECT_ANALYSIS_ACTIVE: "ARCHITECT_ANALYSIS_ACTIVE",
  ARCHITECT_LIMIT_REACHED: "ARCHITECT_LIMIT_REACHED",
  CORRECTION_PRECONDITION_FAILED: "CORRECTION_PRECONDITION_FAILED",
  TASK_BLOCKED: "TASK_BLOCKED",
  /** Une ou plusieurs dependances explicites ne sont pas terminees. */
  DEPENDENCIES_UNRESOLVED: "DEPENDENCIES_UNRESOLVED",
} as const;

export type GuidedBlockerCode = (typeof GUIDED_BLOCKER)[keyof typeof GUIDED_BLOCKER];

export const GUIDED_BLOCKER_CODES: readonly GuidedBlockerCode[] = Object.values(GUIDED_BLOCKER);

export const isGuidedBlockerCode = createStatusGuard(GUIDED_BLOCKER_CODES);

/** Les cinq etapes de la progression affichee. Fixes, et jamais une timeline. */
export const GUIDED_PROGRESS_STEP = {
  SPECIFICATION: "SPECIFICATION",
  EXECUTION: "EXECUTION",
  REVIEW: "REVIEW",
  CORRECTION: "CORRECTION",
  DONE: "DONE",
} as const;

export type GuidedProgressStep =
  (typeof GUIDED_PROGRESS_STEP)[keyof typeof GUIDED_PROGRESS_STEP];

export const GUIDED_PROGRESS_STEPS: readonly GuidedProgressStep[] =
  Object.values(GUIDED_PROGRESS_STEP);

/** Etat d'une etape de progression. `pending` couvre aussi « jamais atteinte ». */
export type GuidedProgressState = "done" | "current" | "pending";

export type GuidedProgressEntry = {
  step: GuidedProgressStep;
  state: GuidedProgressState;
};

/**
 * Une action proposee.
 *
 * Elle ne porte ni libelle, ni URL : le premier vit dans la couche de
 * presentation, la seconde se reconstruit cote serveur a partir des
 * identifiants ci-dessous. Un guide qui transporterait une URL toute faite
 * serait un guide dont le navigateur choisit la destination.
 */
export type GuidedAction = {
  kind: GuidedActionKind;
  /** Execution concernee, lorsque l'action en designe une. */
  runId: string | null;
  /** Analyse Architecte concernee. */
  analysisId: string | null;
  /** Feedback de review concerne. */
  feedbackId: string | null;
};

export type GuidedBlocker = {
  code: GuidedBlockerCode;
  /** Message deja formule par la couche concernee, ou `null`. */
  detail: string | null;
};

/**
 * Reponse du guide a une seule question : ou en sommes-nous maintenant ?
 *
 * `recommendedAction` vaut `null` lorsque aucune etape mecanique n'a de sens —
 * une tache terminee, ou une tache dont l'environnement empeche la suite. Un
 * guide qui recommanderait toujours quelque chose finirait par recommander
 * n'importe quoi.
 */
export type GuidedWorkflowState = {
  stage: GuidedWorkflowStage;
  /** Ce qui se passe, en une phrase factuelle. */
  summary: string;
  /** Pourquoi cette recommandation. Jamais vide, meme sans recommandation. */
  reason: string;
  recommendedAction: GuidedAction | null;
  alternativeActions: readonly GuidedAction[];
  blockers: readonly GuidedBlocker[];
  /** Faits de la garde de TASK-015, repris tels quels. */
  architectBlockers: readonly ArchitectReviewBlocker[];
  currentRunId: string | null;
  currentRunCode: string | null;
  currentRunKind: RunKind | null;
  currentRunStatus: RunStatus | null;
  progress: readonly GuidedProgressEntry[];
};

/**
 * Etat de lancement d'une nouvelle execution.
 *
 * `unknown` n'est pas un echec : c'est l'aveu que NOX n'a pas interroge le
 * runner pour ce rendu. Le confondre avec `ready` ferait annoncer un lancement
 * possible sans l'avoir verifie.
 */
export type GuidedLaunchReadiness =
  | { state: "unknown" }
  | { state: "ready" }
  | { state: "runner_unavailable"; detail: string }
  | { state: "claude_unavailable"; detail: string }
  | { state: "repository_unavailable"; detail: string };

/** Etat des preconditions de reprise, telles que TASK-012 les a calculees. */
export type GuidedCorrectionReadiness =
  | { state: "unknown" }
  | { state: "ready" }
  | { state: "blocked"; detail: string };

/** Ce qu'il faut savoir d'une execution pour situer la tache. */
export type GuidedRunFact = {
  id: string;
  code: string;
  kind: RunKind;
  status: RunStatus;
  /** Un instantane de review est enregistre pour cette execution. */
  hasReview: boolean;
  /** `checkResumeCandidate` accepte une demande de correction. */
  canRequestChanges: boolean;
  /** Message du refus de TASK-012, lorsqu'il y en a un. */
  requestChangesDetail: string | null;
};

/** Derniere analyse **terminee** de l'execution courante. */
export type GuidedAnalysisFact = {
  id: string;
  code: string;
  /** Verdict retenu par NOX, jamais celui du fournisseur. */
  verdict: ArchitectReviewVerdict;
  blockers: readonly ArchitectReviewBlocker[];
  hasFeedback: boolean;
};

export type GuidedArchitectFact = {
  /** `NOX_OPENAI_API_KEY` et `NOX_ARCHITECT_MODEL` sont renseignes. */
  configured: boolean;
  latestCompleted: GuidedAnalysisFact | null;
  /** La derniere tentative n'a pas abouti, et n'est pas `latestCompleted`. */
  lastAttemptFailed: boolean;
  /** Une analyse est en cours pour l'execution courante. */
  active: boolean;
  analysesLeft: number;
};

/** Feedback enregistre et pas encore consomme par une correction. */
export type GuidedCorrectionFact = {
  feedbackId: string;
  sourceRunId: string;
  sourceRunCode: string;
  /** Extrait court, deja borne par l'appelant. */
  excerpt: string;
  /** Refus de TASK-012, deja formule. `null` lorsque la reprise est possible. */
  refusalDetail: string | null;
  readiness: GuidedCorrectionReadiness;
};

export type GuidedWorkflowFacts = {
  taskStatus: TaskStatus;
  /**
   * Dependances explicites **non terminees**, dans l'ordre d'affichage.
   *
   * Derivees du statut courant des taches attendues, jamais stockees : rouvrir
   * une tache terminee fait reapparaitre l'attente au rendu suivant, sans
   * qu'aucune ligne ne soit reecrite.
   */
  unresolvedDependencies: readonly TaskDependencyLink[];
  documentSyncStatus: TaskDocumentSyncStatus;
  hasAcceptanceCriteria: boolean;
  /** La tache vient d'une conversation Architecte. */
  designedWithArchitect: boolean;
  /** Executions, de la plus recente a la plus ancienne. */
  runs: readonly GuidedRunFact[];
  launch: GuidedLaunchReadiness;
  architect: GuidedArchitectFact;
  correction: GuidedCorrectionFact | null;
};

/** Une action sans cible : la plupart n'en ont pas. */
function action(
  kind: GuidedActionKind,
  target: Partial<Omit<GuidedAction, "kind">> = {},
): GuidedAction {
  return {
    kind,
    runId: target.runId ?? null,
    analysisId: target.analysisId ?? null,
    feedbackId: target.feedbackId ?? null,
  };
}

function blocker(code: GuidedBlockerCode, detail: string | null = null): GuidedBlocker {
  return { code, detail };
}

/**
 * L'execution que le guide regarde : la seule active, sinon la plus recente.
 *
 * Exportee parce que l'appelant en a besoin **avant** la derivation : c'est
 * cette execution dont il lit la review, les analyses et le feedback en attente.
 * Deux selections — une pour charger, une pour deriver — finiraient par designer
 * deux executions differentes.
 *
 * `runs` est attendu de la plus recente a la plus ancienne, comme le renvoie
 * `listRunsByTask`.
 */
export function selectGuidedCurrentRun<TRun extends { status: RunStatus }>(
  runs: readonly TRun[],
): TRun | null {
  const active = runs.find((run) => !isFinalRunStatus(run.status));
  return active ?? runs[0] ?? null;
}

/**
 * Progression affichee : cinq etapes, jamais une par execution.
 *
 * Trois corrections successives ne produisent pas trois lignes. La question a
 * laquelle cette bande repond est « ou en sommes-nous maintenant », et
 * l'historique detaille des executions a deja sa page.
 */
function buildProgress(
  stage: GuidedWorkflowStage,
  correctionSeen: boolean,
): GuidedProgressEntry[] {
  const order: Record<GuidedProgressStep, GuidedProgressState> = {
    SPECIFICATION: "pending",
    EXECUTION: "pending",
    REVIEW: "pending",
    CORRECTION: "pending",
    DONE: "pending",
  };

  const mark = (done: readonly GuidedProgressStep[], current: GuidedProgressStep | null) => {
    for (const step of done) {
      order[step] = "done";
    }
    if (current !== null) {
      order[current] = "current";
    }
  };

  const S = GUIDED_PROGRESS_STEP;

  switch (stage) {
    case GUIDED_STAGE.DRAFTING:
      mark([], S.SPECIFICATION);
      break;
    // L'attente d'une dependance est une etape d'execution qui n'a pas encore
    // commence, pas un retour a la specification : celle-ci est arretee.
    case GUIDED_STAGE.READY_TO_RUN:
    case GUIDED_STAGE.WAITING_FOR_DEPENDENCIES:
      mark([S.SPECIFICATION], S.EXECUTION);
      break;
    case GUIDED_STAGE.RUNNING:
      mark([S.SPECIFICATION], correctionSeen ? S.CORRECTION : S.EXECUTION);
      if (correctionSeen) {
        order[S.EXECUTION] = "done";
        order[S.REVIEW] = "done";
      }
      break;
    case GUIDED_STAGE.RUN_FAILED:
      mark([S.SPECIFICATION], S.EXECUTION);
      break;
    case GUIDED_STAGE.REVIEWING:
    case GUIDED_STAGE.ARCHITECT_REVIEW:
      mark([S.SPECIFICATION, S.EXECUTION], S.REVIEW);
      break;
    case GUIDED_STAGE.CHANGES_REQUESTED:
    case GUIDED_STAGE.CORRECTION_READY:
      mark([S.SPECIFICATION, S.EXECUTION, S.REVIEW], S.CORRECTION);
      break;
    case GUIDED_STAGE.DONE:
      mark([S.SPECIFICATION, S.EXECUTION, S.REVIEW], S.DONE);
      if (correctionSeen) {
        order[S.CORRECTION] = "done";
      }
      break;
    case GUIDED_STAGE.BLOCKED:
      // Une tache bloquee garde la derniere etape reellement atteinte comme
      // etape courante : reculer la bande a « Specification » effacerait le
      // travail qui a bien eu lieu.
      mark([S.SPECIFICATION], correctionSeen ? S.CORRECTION : S.EXECUTION);
      if (correctionSeen) {
        order[S.EXECUTION] = "done";
        order[S.REVIEW] = "done";
      }
      break;
  }

  return GUIDED_PROGRESS_STEPS.map((step) => ({ step, state: order[step] }));
}

/** Une action IA visible : elle consommera un appel au fournisseur. */
export function guidedActionCallsOpenAI(kind: GuidedActionKind): boolean {
  return kind === GUIDED_ACTION.ANALYZE_WITH_ARCHITECT;
}

/**
 * Une action qui demarre reellement Claude Code.
 *
 * `PREPARE_CORRECTION` n'en fait pas partie : elle ouvre la page de
 * preparation, ou le lancement reste un second clic. Avertir la ou rien ne
 * demarre apprendrait a ignorer l'avertissement.
 */
export function guidedActionStartsClaude(kind: GuidedActionKind): boolean {
  return kind === GUIDED_ACTION.RUN_CLAUDE || kind === GUIDED_ACTION.RESUME_CLAUDE;
}

/**
 * Derive l'etat guide d'une tache.
 *
 * ## Ordre de priorite, et pourquoi celui-la
 *
 * ```text
 * 1. execution active          rien d'autre n'a de sens tant qu'un processus ecrit
 * 2. tache terminee            plus rien n'est attendu
 * 3. tache bloquee             un humain doit regarder avant toute suite
 * 4. tache echouee             la derniere execution n'a pas abouti
 * 5. tache en review
 *    5a. correction en attente un feedback enregistre prime sur une nouvelle analyse
 *    5b. verdict Architecte    une seconde lecture existe : elle oriente la decision
 *    5c. review disponible     sinon, la relecture — assistee ou non — est l'etape
 * 6. tache prete               la specification est arretee
 * 7. tache brouillon           elle s'ecrit encore
 * ```
 *
 * L'ordre est fixe et documente parce qu'il decide de ce que l'utilisateur lit
 * en premier. Un ordre implicite se serait mis a dependre de l'ordre des `if`.
 *
 * Fonction **pure** : aucune lecture de base, de disque, de Git, du runner, ni
 * aucun appel a un fournisseur. Appelee cent fois, elle produit cent fois le
 * meme resultat et ne change rien.
 */
export function deriveGuidedWorkflowState(facts: GuidedWorkflowFacts): GuidedWorkflowState {
  const current = selectGuidedCurrentRun(facts.runs);
  const correctionSeen = facts.runs.some((run) => run.kind === RUN_KIND.CORRECTION);
  const partial = derive(facts, current);

  return {
    ...partial,
    currentRunId: current?.id ?? null,
    currentRunCode: current?.code ?? null,
    currentRunKind: current?.kind ?? null,
    currentRunStatus: current?.status ?? null,
    progress: buildProgress(partial.stage, correctionSeen),
  };
}

type PartialState = Omit<
  GuidedWorkflowState,
  "currentRunId" | "currentRunCode" | "currentRunKind" | "currentRunStatus" | "progress"
>;

function derive(facts: GuidedWorkflowFacts, current: GuidedRunFact | null): PartialState {
  // 1. Une execution active : le repository bouge encore.
  if (current !== null && !isFinalRunStatus(current.status)) {
    return runningState(current);
  }

  switch (facts.taskStatus) {
    case TASK_STATUS.COMPLETED:
      return doneState(current, facts);
    case TASK_STATUS.BLOCKED:
      return blockedState(current, facts);
    case TASK_STATUS.FAILED:
      return failedState(current);
    case TASK_STATUS.REVIEW:
      return reviewState(facts, current);
    case TASK_STATUS.READY:
      return readyState(facts);
    case TASK_STATUS.DRAFT:
      return draftState(facts);
    // `RUNNING` sans execution active : le suivi a ete perdu, et NOX ne sait
    // plus ce que le processus a fait. Ce n'est pas une etape, c'est un blocage.
    case TASK_STATUS.RUNNING:
      return {
        stage: GUIDED_STAGE.BLOCKED,
        summary: "Cette tache est marquee en cours, mais aucune execution active ne lui correspond.",
        reason:
          "NOX a perdu le suivi du processus. Ouvrez la derniere execution pour voir ce qui a ete " +
          "enregistre, puis verifiez le repository vous-meme.",
        recommendedAction:
          current === null ? null : action(GUIDED_ACTION.OPEN_RUN, { runId: current.id }),
        alternativeActions: [],
        blockers: [blocker(GUIDED_BLOCKER.TASK_BLOCKED)],
        architectBlockers: [],
      };
  }
}

// --- 1. Execution active -----------------------------------------------------

function runningState(run: GuidedRunFact): PartialState {
  const correction = run.kind === RUN_KIND.CORRECTION;
  const cancelling = run.status === RUN_STATUS.CANCELLING;

  return {
    stage: GUIDED_STAGE.RUNNING,
    summary: correction
      ? `${run.code} corrige le travail precedent.`
      : `${run.code} est en cours.`,
    reason: cancelling
      ? "Un arret a ete demande. Le processus peut encore ecrire dans le repository : la page de " +
        "l'execution suit la fin reelle."
      : "Claude Code travaille dans le repository. La page de l'execution montre le flux en direct, " +
        "et c'est la que l'annulation se demande.",
    recommendedAction: action(GUIDED_ACTION.OPEN_RUN, { runId: run.id }),
    alternativeActions: [],
    blockers: [
      blocker(
        GUIDED_BLOCKER.RUN_ACTIVE,
        "Les decisions de review attendent la fin de cette execution, et NOX n'en lance qu'une a la fois.",
      ),
    ],
    architectBlockers: [],
  };
}

// --- 2. Tache terminee -------------------------------------------------------

function doneState(run: GuidedRunFact | null, facts: GuidedWorkflowFacts): PartialState {
  const alternatives: GuidedAction[] = [action(GUIDED_ACTION.REOPEN)];
  if (run !== null && run.hasReview) {
    alternatives.push(action(GUIDED_ACTION.OPEN_REVIEW, { runId: run.id }));
  }
  if (facts.runs.length > 0) {
    alternatives.push(action(GUIDED_ACTION.OPEN_RUN_HISTORY));
  }

  return {
    stage: GUIDED_STAGE.DONE,
    summary: "Ce travail a ete accepte.",
    reason:
      "Il n'y a plus d'etape a proposer. Le commit et le push restent des gestes humains, hors de NOX ; " +
      "rouvrir la tache est possible si quelque chose ressort plus tard.",
    recommendedAction: null,
    alternativeActions: alternatives,
    blockers: [],
    architectBlockers: [],
  };
}

// --- 3. Tache bloquee --------------------------------------------------------

function blockedState(run: GuidedRunFact | null, facts: GuidedWorkflowFacts): PartialState {
  const cancelled = run?.status === RUN_STATUS.CANCELLED;
  const lost = run?.status === RUN_STATUS.BLOCKED;

  const summary =
    run === null
      ? "Cette tache a ete mise de cote."
      : cancelled
        ? `${run.code} a ete interrompue avant sa fin.`
        : lost
          ? `NOX a cesse de suivre ${run.code}.`
          : `${run.code} n'a pas abouti.`;

  const reason =
    run === null
      ? "Aucune execution n'explique ce blocage : c'est une decision qui a ete prise a la main. " +
        "Remettez la tache en brouillon ou en file quand elle redevient pertinente."
      : run.hasReview
        ? "NOX n'a restaure aucun fichier : le repository est reste tel que l'execution l'a laisse. " +
          "Relisez ce qui a change avant de remettre la tache en file."
        : "Aucun instantane de review n'a ete capture pour cette execution. Ouvrez-la pour voir ce " +
          "que NOX a enregistre, puis verifiez le repository vous-meme.";

  const recommended =
    run === null
      ? null
      : run.hasReview
        ? action(GUIDED_ACTION.OPEN_REVIEW, { runId: run.id })
        : action(GUIDED_ACTION.OPEN_RUN, { runId: run.id });

  const alternatives: GuidedAction[] = [action(GUIDED_ACTION.MARK_READY), action(GUIDED_ACTION.BACK_TO_DRAFT)];
  if (facts.correction !== null) {
    alternatives.unshift(
      action(GUIDED_ACTION.PREPARE_CORRECTION, {
        runId: facts.correction.sourceRunId,
        feedbackId: facts.correction.feedbackId,
      }),
    );
  }

  return {
    stage: GUIDED_STAGE.BLOCKED,
    summary,
    reason,
    recommendedAction: recommended,
    alternativeActions: alternatives,
    blockers: [blocker(GUIDED_BLOCKER.TASK_BLOCKED)],
    architectBlockers: [],
  };
}

// --- 4. Tache echouee --------------------------------------------------------

function failedState(run: GuidedRunFact | null): PartialState {
  return {
    stage: GUIDED_STAGE.RUN_FAILED,
    summary: run === null ? "La derniere execution a echoue." : `${run.code} a echoue.`,
    reason:
      run !== null && run.hasReview
        ? "Les changements affiches peuvent etre partiels : NOX n'a rien restaure. Relisez-les avant " +
          "de relancer la tache."
        : "Ouvrez l'execution pour lire le compte rendu et la sortie d'erreur avant de la remettre en file.",
    recommendedAction:
      run === null
        ? null
        : run.hasReview
          ? action(GUIDED_ACTION.OPEN_REVIEW, { runId: run.id })
          : action(GUIDED_ACTION.OPEN_RUN, { runId: run.id }),
    alternativeActions: [action(GUIDED_ACTION.RETRY), action(GUIDED_ACTION.BACK_TO_DRAFT)],
    blockers: [],
    architectBlockers: [],
  };
}

// --- 5. Tache en review ------------------------------------------------------

function reviewState(facts: GuidedWorkflowFacts, current: GuidedRunFact | null): PartialState {
  if (current === null) {
    return {
      stage: GUIDED_STAGE.BLOCKED,
      summary: "Cette tache attend une decision, mais aucune execution ne lui est rattachee.",
      reason: "NOX ne sait pas quel travail relire. Remettez la tache en file pour repartir d'un etat connu.",
      recommendedAction: null,
      alternativeActions: [action(GUIDED_ACTION.REOPEN)],
      blockers: [blocker(GUIDED_BLOCKER.REVIEW_UNAVAILABLE)],
      architectBlockers: [],
    };
  }

  // 5a. Un feedback enregistre prime : la decision est deja prise, il reste a
  // l'executer. Proposer une analyse ici reviendrait a rouvrir un debat clos.
  if (facts.correction !== null) {
    return correctionState(facts.correction, current);
  }

  // 5b. Une analyse terminee existe : son verdict oriente la recommandation.
  const analysis = facts.architect.latestCompleted;
  if (analysis !== null) {
    return architectState(facts, analysis, current);
  }

  // 5c. Sinon, la relecture est l'etape — assistee si l'Architecte est
  // disponible, manuelle sinon.
  return reviewingState(facts, current);
}

/** Actions humaines toujours ouvertes sur une tache en review. */
function humanReviewActions(run: GuidedRunFact): GuidedAction[] {
  const actions: GuidedAction[] = [action(GUIDED_ACTION.OPEN_REVIEW, { runId: run.id })];
  if (run.canRequestChanges) {
    actions.push(action(GUIDED_ACTION.REQUEST_CHANGES, { runId: run.id }));
  }
  actions.push(action(GUIDED_ACTION.APPROVE, { runId: run.id }));
  return actions;
}

function reviewingState(facts: GuidedWorkflowFacts, run: GuidedRunFact): PartialState {
  const blockers: GuidedBlocker[] = [];

  if (!run.hasReview) {
    return {
      stage: GUIDED_STAGE.REVIEWING,
      summary: `${run.code} s'est terminee, mais NOX n'a pas encore d'instantane de ses changements.`,
      reason:
        "Ouvrir la review transfere l'instantane du runner vers la base, ou dit pourquoi il n'y en " +
        "aura jamais. Approve et Request changes restent possibles.",
      recommendedAction: action(GUIDED_ACTION.OPEN_REVIEW, { runId: run.id }),
      alternativeActions: humanReviewActions(run).filter(
        (entry) => entry.kind !== GUIDED_ACTION.OPEN_REVIEW,
      ),
      blockers: [blocker(GUIDED_BLOCKER.REVIEW_UNAVAILABLE)],
      architectBlockers: [],
    };
  }

  const architect = facts.architect;
  const failedNote = architect.lastAttemptFailed
    ? " La derniere tentative d'analyse n'a pas abouti."
    : "";

  if (!architect.configured) {
    blockers.push(
      blocker(
        GUIDED_BLOCKER.OPENAI_UNAVAILABLE,
        "La configuration OpenAI est incomplete : l'Architecte ne peut pas etre sollicite. Cela " +
          "n'empeche ni Approve, ni Request changes.",
      ),
    );
  } else if (architect.active) {
    blockers.push(blocker(GUIDED_BLOCKER.ARCHITECT_ANALYSIS_ACTIVE));
  } else if (architect.analysesLeft <= 0) {
    blockers.push(blocker(GUIDED_BLOCKER.ARCHITECT_LIMIT_REACHED));
  }

  const assisted = architect.configured && !architect.active && architect.analysesLeft > 0;

  return {
    stage: GUIDED_STAGE.REVIEWING,
    summary: `${run.code} s'est terminee et sa review est disponible.`,
    reason: assisted
      ? `Aucune analyse Architecte n'existe pour ${run.code}.${failedNote} Cette seconde lecture est ` +
        "facultative : vous pouvez tout aussi bien relire vous-meme, puis approuver ou demander des " +
        "corrections."
      : "L'analyse Architecte n'est pas disponible pour cette execution. Relisez les changements " +
        "vous-meme : la decision vous appartient de toute facon.",
    recommendedAction: assisted
      ? action(GUIDED_ACTION.ANALYZE_WITH_ARCHITECT, { runId: run.id })
      : action(GUIDED_ACTION.REVIEW_MANUALLY, { runId: run.id }),
    alternativeActions: assisted
      ? humanReviewActions(run)
      : humanReviewActions(run).filter((entry) => entry.kind !== GUIDED_ACTION.OPEN_REVIEW),
    blockers,
    architectBlockers: [],
  };
}

function architectState(
  facts: GuidedWorkflowFacts,
  analysis: GuidedAnalysisFact,
  run: GuidedRunFact,
): PartialState {
  const failedNote = facts.architect.lastAttemptFailed
    ? ` La derniere tentative d'analyse a echoue ; la derniere analyse exploitable est ${analysis.code}.`
    : "";

  const openAnalysis = action(GUIDED_ACTION.OPEN_ARCHITECT_ANALYSIS, {
    runId: run.id,
    analysisId: analysis.id,
  });

  switch (analysis.verdict) {
    case ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED:
      return {
        stage: GUIDED_STAGE.ARCHITECT_REVIEW,
        summary: `${analysis.code} recommande l'approbation de ${run.code}.`,
        reason:
          "L'Architecte recommande l'approbation. Relisez la review et decidez : rien n'a ete " +
          `approuve, et la tache reste en review tant que vous n'avez pas clique.${failedNote}`,
        recommendedAction: action(GUIDED_ACTION.REVIEW_AND_APPROVE, { runId: run.id }),
        alternativeActions: [
          openAnalysis,
          ...humanReviewActions(run).filter((entry) => entry.kind !== GUIDED_ACTION.APPROVE),
        ],
        blockers: [],
        architectBlockers: [],
      };

    case ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED: {
      const reusable = analysis.hasFeedback && run.canRequestChanges;
      return {
        stage: GUIDED_STAGE.ARCHITECT_REVIEW,
        summary: `${analysis.code} recommande des corrections sur ${run.code}.`,
        reason: reusable
          ? "Un feedback est propose. Il preremplit le formulaire de correction et reste entierement " +
            `modifiable : c'est votre texte qui sera transmis, et rien n'est lance avant.${failedNote}`
          : "Relisez les observations, puis decidez : ecrire vous-meme une demande de correction, ou " +
            `approuver malgre tout.${failedNote}`,
        recommendedAction: reusable
          ? action(GUIDED_ACTION.USE_AS_FEEDBACK, { runId: run.id, analysisId: analysis.id })
          : openAnalysis,
        alternativeActions: reusable
          ? [openAnalysis, ...humanReviewActions(run)]
          : humanReviewActions(run),
        blockers: run.canRequestChanges
          ? []
          : [
              blocker(
                GUIDED_BLOCKER.CORRECTION_PRECONDITION_FAILED,
                run.requestChangesDetail,
              ),
            ],
        architectBlockers: [],
      };
    }

    case ARCHITECT_REVIEW_VERDICT.HUMAN_REVIEW_REQUIRED:
      return {
        stage: GUIDED_STAGE.ARCHITECT_REVIEW,
        summary: `${analysis.code} n'a pas pu conclure sur ${run.code}.`,
        reason:
          "Une partie de la review n'etait pas accessible a l'Architecte : sa lecture ne suffit pas " +
          `a decider. Relisez les changements vous-meme.${failedNote}`,
        recommendedAction: action(GUIDED_ACTION.REVIEW_MANUALLY, { runId: run.id }),
        alternativeActions: [
          openAnalysis,
          ...humanReviewActions(run).filter((entry) => entry.kind !== GUIDED_ACTION.OPEN_REVIEW),
        ],
        blockers: [],
        architectBlockers: analysis.blockers,
      };
  }
}

function correctionState(correction: GuidedCorrectionFact, run: GuidedRunFact): PartialState {
  const target = {
    runId: correction.sourceRunId,
    feedbackId: correction.feedbackId,
  };

  // Un refus de TASK-012 est definitif pour ce feedback : session perdue, review
  // absente, empreinte manquante. Le guide le rapporte tel quel plutot que de
  // proposer une preparation qui refuserait a son tour.
  if (correction.refusalDetail !== null) {
    return {
      stage: GUIDED_STAGE.BLOCKED,
      summary: `Un feedback attend sur ${correction.sourceRunCode}, mais la reprise est impossible.`,
      reason:
        "La correction ciblee ne peut pas partir de cette execution. Relisez les changements, puis " +
        "decidez : accepter ce qui existe, ou repartir d'une nouvelle execution.",
      recommendedAction: action(GUIDED_ACTION.REVIEW_MANUALLY, { runId: run.id }),
      alternativeActions: [action(GUIDED_ACTION.APPROVE, { runId: run.id })],
      blockers: [
        blocker(GUIDED_BLOCKER.CORRECTION_PRECONDITION_FAILED, correction.refusalDetail),
      ],
      architectBlockers: [],
    };
  }

  switch (correction.readiness.state) {
    case "ready":
      return {
        stage: GUIDED_STAGE.CORRECTION_READY,
        summary: `Un feedback attend sur ${correction.sourceRunCode}, et toutes les preconditions sont tenues.`,
        reason:
          "La session Claude, l'instantane de review, la branche, le HEAD et le dossier de travail " +
          "correspondent encore a ce qui a ete relu. La reprise reste un clic humain, sur la page de " +
          "preparation.",
        recommendedAction: action(GUIDED_ACTION.RESUME_CLAUDE, target),
        alternativeActions: [
          action(GUIDED_ACTION.OPEN_REVIEW, { runId: run.id }),
          action(GUIDED_ACTION.APPROVE, { runId: run.id }),
        ],
        blockers: [],
        architectBlockers: [],
      };

    case "blocked":
      return {
        stage: GUIDED_STAGE.BLOCKED,
        summary: `Un feedback attend sur ${correction.sourceRunCode}, mais le dossier de travail a change.`,
        reason:
          "Une correction reprend exactement l'etat qui a ete relu. La page de preparation liste " +
          "chaque precondition et dit laquelle manque ; il n'existe aucune option de forcage.",
        recommendedAction: action(GUIDED_ACTION.PREPARE_CORRECTION, target),
        alternativeActions: [
          action(GUIDED_ACTION.OPEN_REVIEW, { runId: run.id }),
          action(GUIDED_ACTION.APPROVE, { runId: run.id }),
        ],
        blockers: [
          blocker(GUIDED_BLOCKER.CORRECTION_PRECONDITION_FAILED, correction.readiness.detail),
        ],
        architectBlockers: [],
      };

    case "unknown":
      return {
        stage: GUIDED_STAGE.CHANGES_REQUESTED,
        summary: `Un feedback est enregistre sur ${correction.sourceRunCode}.`,
        reason:
          "La page de preparation verifie l'etat reel du repository — branche, HEAD, dossier de " +
          "travail, session Claude — et c'est elle qui porte le lancement.",
        recommendedAction: action(GUIDED_ACTION.PREPARE_CORRECTION, target),
        alternativeActions: [
          action(GUIDED_ACTION.OPEN_REVIEW, { runId: run.id }),
          action(GUIDED_ACTION.APPROVE, { runId: run.id }),
        ],
        blockers: [],
        architectBlockers: [],
      };
  }
}

// --- 6. Tache prete ----------------------------------------------------------

/**
 * La specification est arretee, mais une dependance manque.
 *
 * Aucune action recommandee : la seule chose utile a faire se trouve sur une
 * autre tache, et le guide ne pretend pas la lancer d'ici. `Back to draft`
 * reste offert — corriger la specification pendant l'attente est legitime.
 *
 * Le statut de la tache n'est pas touche : elle reste `READY`. NOX ne confond
 * pas « ou en est le travail » avec « ce qui l'empeche de demarrer ».
 */
function waitingForDependenciesState(
  waiting: readonly TaskDependencyLink[],
): PartialState {
  const names = waiting.map((entry) => entry.code).join(", ");

  return {
    stage: GUIDED_STAGE.WAITING_FOR_DEPENDENCIES,
    summary:
      waiting.length === 1
        ? `Cette tache attend ${names}.`
        : `Cette tache attend ${String(waiting.length)} taches : ${names}.`,
    reason:
      "Une dependance n'est satisfaite que lorsque la tache attendue est terminee. " +
      "Le lancement est refuse tant que ce n'est pas le cas — y compris si vous cliquez " +
      "quand meme : le serveur revalide. Le statut de cette tache, lui, ne change pas.",
    recommendedAction: null,
    alternativeActions: [action(GUIDED_ACTION.BACK_TO_DRAFT)],
    blockers: [
      blocker(
        GUIDED_BLOCKER.DEPENDENCIES_UNRESOLVED,
        waiting
          .map((entry) => `${entry.code} — ${entry.title}`)
          .join(" · "),
      ),
    ],
    architectBlockers: [],
  };
}

function readyState(facts: GuidedWorkflowFacts): PartialState {
  // Verifie **avant** les autres blocages, et avant toute sonde : une tache qui
  // attend une autre tache n'a rien a faire du runner, et afficher « repository
  // occupe » a cote de « attend TASK-001 » melangerait deux problemes dont un
  // seul compte aujourd'hui.
  if (facts.unresolvedDependencies.length > 0) {
    return waitingForDependenciesState(facts.unresolvedDependencies);
  }

  const blockers: GuidedBlocker[] = [];

  if (facts.documentSyncStatus !== TASK_DOCUMENT_SYNC_STATUS.SYNCED) {
    blockers.push(blocker(GUIDED_BLOCKER.DOCUMENT_NOT_SYNCED));
  }
  if (!facts.hasAcceptanceCriteria) {
    blockers.push(blocker(GUIDED_BLOCKER.ACCEPTANCE_CRITERIA_MISSING));
  }

  switch (facts.launch.state) {
    case "runner_unavailable":
      blockers.push(blocker(GUIDED_BLOCKER.RUNNER_UNAVAILABLE, facts.launch.detail));
      break;
    case "claude_unavailable":
      blockers.push(blocker(GUIDED_BLOCKER.CLAUDE_UNAVAILABLE, facts.launch.detail));
      break;
    case "repository_unavailable":
      blockers.push(blocker(GUIDED_BLOCKER.REPOSITORY_NOT_READY, facts.launch.detail));
      break;
    case "ready":
    case "unknown":
      break;
  }

  const launchable = blockers.length === 0;

  return {
    stage: GUIDED_STAGE.READY_TO_RUN,
    summary: "Cette tache est prete a etre envoyee a Claude Code.",
    reason: launchable
      ? "La preparation montre le prompt exact, les commandes autorisees et l'etat du repository. " +
        "Rien ne demarre avant le clic de lancement."
      : "Le lancement n'est pas possible en l'etat. NOX ne pretend pas le contraire : corrigez ce qui " +
        "est signale ci-dessous, puis rechargez cette page.",
    recommendedAction: launchable ? action(GUIDED_ACTION.RUN_CLAUDE) : null,
    alternativeActions: [action(GUIDED_ACTION.BACK_TO_DRAFT)],
    blockers,
    architectBlockers: [],
  };
}

// --- 7. Tache brouillon ------------------------------------------------------

function draftState(facts: GuidedWorkflowFacts): PartialState {
  const synced = facts.documentSyncStatus === TASK_DOCUMENT_SYNC_STATUS.SYNCED;
  const conflict = facts.documentSyncStatus === TASK_DOCUMENT_SYNC_STATUS.CONFLICT;

  const alternatives: GuidedAction[] = [];
  if (synced || conflict) {
    alternatives.push(action(GUIDED_ACTION.OPEN_DOCUMENT));
  }
  if (facts.runs.length === 0) {
    alternatives.push(action(GUIDED_ACTION.DELETE_TASK));
  }

  if (!synced) {
    return {
      stage: GUIDED_STAGE.DRAFTING,
      summary: "La specification existe, mais son document Markdown ne la reflete pas.",
      reason:
        "Le document est l'artefact que l'agent lira dans le repository. Reparez la synchronisation " +
        "avant de mettre la tache en file : la specification en base, elle, est complete.",
      recommendedAction: action(GUIDED_ACTION.RESOLVE_DOCUMENT_SYNC),
      alternativeActions: [action(GUIDED_ACTION.MARK_READY), ...alternatives],
      blockers: [blocker(GUIDED_BLOCKER.DOCUMENT_NOT_SYNCED)],
      architectBlockers: [],
    };
  }

  if (!facts.hasAcceptanceCriteria) {
    return {
      stage: GUIDED_STAGE.DRAFTING,
      summary: "Cette tache n'a aucun critere d'acceptation.",
      reason:
        "Sans critere, personne ne pourra dire « c'est fait » sans ambiguite, et le lancement sera " +
        "refuse. C'est la seule chose qui manque.",
      recommendedAction: null,
      alternativeActions: alternatives,
      blockers: [blocker(GUIDED_BLOCKER.ACCEPTANCE_CRITERIA_MISSING)],
      architectBlockers: [],
    };
  }

  return {
    stage: GUIDED_STAGE.DRAFTING,
    summary: facts.designedWithArchitect
      ? "Cette tache vient d'une conversation Architecte et attend votre relecture."
      : "Cette tache s'ecrit encore.",
    reason:
      "Relisez l'objectif, les criteres d'acceptation et les commandes de validation, puis mettez la " +
      "tache en file. Ce passage reste un geste humain : NOX ne met jamais une tache en file tout seul.",
    recommendedAction: action(GUIDED_ACTION.MARK_READY),
    alternativeActions: alternatives,
    blockers: [],
    architectBlockers: [],
  };
}
