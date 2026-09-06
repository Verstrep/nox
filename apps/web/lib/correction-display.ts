/**
 * Affichage de la correction ciblee.
 *
 * Fonctions pures : URL, libelles, messages de refus. Aucune ne lit la base ni le
 * disque, ce qui les rend directement testables — et surtout, ce sont les memes
 * qui decident de l'affichage d'un bouton et du message d'un refus. Deux
 * implementations divergeraient, et c'est l'interface qui aurait raison a tort.
 */

import {
  CORRECTION_REFUSAL,
  CORRECTION_SOURCE,
  CORRECTION_STAGE,
  MAX_AUTOMATED_CORRECTION_ATTEMPTS,
  RESUME_REFUSAL,
  RUN_PROVENANCE,
  type CorrectionCycleState,
  type CorrectionRefusalCode,
  type CorrectionSource,
  type ResumeRefusal,
  type RunProvenance,
} from "@nox/shared";

/** Page du formulaire de feedback d'une execution relue. */
export function requestChangesUrl(projectId: string, taskId: string, runId: string): string {
  return `/projects/${projectId}/tasks/${taskId}/runs/${runId}/request-changes`;
}

/**
 * Page de preparation d'une correction, a partir d'un feedback enregistre.
 *
 * Les criteres humains signales voyagent dans l'URL, et **seulement** eux : ce
 * sont des identifiants, revalides en base a l'ouverture de la page comme au
 * lancement. Un identifiant forge ne designe rien.
 */
export function correctionUrl(
  projectId: string,
  taskId: string,
  runId: string,
  feedbackId: string,
  humanCriterionIds: readonly string[] = [],
): string {
  const base = `/projects/${projectId}/tasks/${taskId}/runs/${runId}/corrections/${feedbackId}`;
  if (humanCriterionIds.length === 0) {
    return base;
  }
  const query = humanCriterionIds
    .map((id) => `criterion=${encodeURIComponent(id)}`)
    .join("&");
  return `${base}?${query}`;
}

/**
 * Pourquoi cette execution ne peut pas etre reprise.
 *
 * Chaque message dit ce qui bloque **et** ce que l'utilisateur peut faire. Un
 * refus qu'on ne sait pas lever est un refus qui donne l'impression d'un bug.
 */
const REFUSAL_MESSAGES: Record<ResumeRefusal, string> = {
  [RESUME_REFUSAL.RUN_NOT_COMPLETED]:
    "Cette execution ne laisse rien a reprendre. Seule une execution terminee — avec succes, ou en echec apres avoir travaille — porte un dossier de travail que NOX sait rattacher a sa session. Une execution bloquee ou annulee demande un regard avant toute suite.",
  [RESUME_REFUSAL.TASK_NOT_IN_REVIEW]:
    "Cette tache n'attend ni decision, ni reprise. Seule une tache en review ou en echec peut recevoir une correction.",
  [RESUME_REFUSAL.NO_PARTIAL_WORK]:
    "Cette execution a echoue sans rien produire : le processus n'a pas demarre, ou une limite d'utilisation a ete atteinte avant tout travail. Il n'y a pas de travail partiel a continuer — relancez la tache, ou attendez selon le cas.",
  [RESUME_REFUSAL.GIT_POLICY_VIOLATION]:
    "Cette execution a modifie l'etat Git alors que c'etait interdit. Son point de depart n'est plus identifiable, et une correction produirait un resultat ininterpretable. Verifiez le repository avant toute suite.",
  [RESUME_REFUSAL.SESSION_MISSING]:
    "Claude Code n'a rapporte aucun identifiant de session pour cette execution. Il n'y a donc aucune conversation a reprendre.",
  [RESUME_REFUSAL.REVIEW_MISSING]:
    "Cette execution n'a pas de review detaillee : elle est anterieure a la review integree. Sans instantane, NOX ne peut pas verifier que le dossier de travail est encore celui qui a ete relu.",
  [RESUME_REFUSAL.FINGERPRINT_MISSING]:
    "Cette execution est anterieure a la reprise ciblee : NOX n'a pas enregistre l'empreinte de son dossier de travail. Reconstituer cette empreinte aujourd'hui decrirait l'etat actuel en pretendant decrire celui de l'execution, ce que NOX ne fait pas.",
  [RESUME_REFUSAL.RUN_ACTIVE]:
    "Une execution est deja en cours. NOX n'en lance qu'une a la fois : attendez sa fin avant de demander une correction.",
  [RESUME_REFUSAL.ALREADY_CORRECTED]:
    "Une correction a deja ete lancee depuis cette review. Relisez la review de la correction, et repartez de la si besoin.",
};

export function resumeRefusalMessage(refusal: ResumeRefusal): string {
  return REFUSAL_MESSAGES[refusal];
}

/** Etat d'une precondition affichee sur la page de preparation. */
export type PreconditionState = "met" | "unmet";

export type Precondition = {
  label: string;
  state: PreconditionState;
  /** Precise ce qui manque, uniquement lorsque la precondition n'est pas tenue. */
  detail: string | null;
};

/**
 * Construit la liste des preconditions affichees avant un lancement.
 *
 * Les libelles restent en anglais, comme les statuts techniques de TASK-009 ;
 * les explications, elles, sont en francais. La coche n'est jamais seule : chaque
 * ligne porte un mot — `OK` ou `Blocked` — parce qu'une information qui n'existe
 * que par la couleur n'existe pas pour tout le monde.
 */
export function buildPreconditions(input: {
  taskInReview: boolean;
  runCompleted: boolean;
  sessionAvailable: boolean;
  reviewAvailable: boolean;
  workspaceMatches: boolean;
  gitUnchanged: boolean;
  claudeAvailable: boolean;
  workspaceDetail: string | null;
  /**
   * La reprise part-elle d'un echec plutot que d'une review ?
   *
   * Change deux libelles, et rien d'autre. « Task is in Review » affiche devant
   * une tache en echec ferait lire une precondition tenue comme une anomalie.
   */
  fromFailedRun?: boolean;
}): Precondition[] {
  const fromFailure = input.fromFailedRun === true;
  return [
    {
      label: fromFailure ? "Task is in Failed" : "Task is in Review",
      state: input.taskInReview ? "met" : "unmet",
      detail: null,
    },
    {
      label: fromFailure ? "Source run left partial work" : "Source run completed",
      state: input.runCompleted ? "met" : "unmet",
      detail: null,
    },
    {
      label: "Claude session available",
      state: input.sessionAvailable ? "met" : "unmet",
      detail: null,
    },
    {
      label: "Review snapshot available",
      state: input.reviewAvailable ? "met" : "unmet",
      detail: null,
    },
    {
      label: "Git branch and HEAD unchanged",
      state: input.gitUnchanged ? "met" : "unmet",
      detail: null,
    },
    {
      label: "Repository matches reviewed state",
      state: input.workspaceMatches ? "met" : "unmet",
      detail: input.workspaceMatches ? null : input.workspaceDetail,
    },
    { label: "Claude Code available", state: input.claudeAvailable ? "met" : "unmet", detail: null },
  ];
}

/** Toutes les preconditions sont-elles tenues ? */
export function allPreconditionsMet(preconditions: readonly Precondition[]): boolean {
  return preconditions.every((entry) => entry.state === "met");
}

/**
 * Extrait de feedback pour un affichage compact.
 *
 * Coupe sur la longueur, jamais sur le sens : le texte complet reste affiche
 * ailleurs sur la page. Les fins de ligne deviennent des espaces pour tenir sur
 * une ligne.
 */
export function feedbackExcerpt(text: string, maxLength = 140): string {
  const single = text.replace(/\s+/gu, " ").trim();
  return single.length <= maxLength ? single : `${single.slice(0, maxLength - 1)}…`;
}

/**
 * Page de preparation d'une correction, a partir d'une reservation.
 *
 * Une URL par reservation plutot que par feedback : depuis TASK-028, une
 * correction peut exister sans texte humain — quand les preuves de NOX
 * suffisent, il n'y a rien a recopier, donc rien a enregistrer comme feedback.
 * La reservation, elle, existe toujours.
 */
export function correctionAttemptUrl(
  projectId: string,
  taskId: string,
  runId: string,
  attemptId: string,
): string {
  return `/projects/${projectId}/tasks/${taskId}/runs/${runId}/corrections/attempt/${attemptId}`;
}

/**
 * Pourquoi une correction n'est pas possible.
 *
 * Chaque message dit ce qui bloque **et** ce que l'utilisateur peut faire. Les
 * intervertir ferait chercher au mauvais endroit : « la file est en pause » et
 * « la borne est atteinte » demandent deux gestes differents.
 */
const CORRECTION_REFUSAL_MESSAGES: Record<CorrectionRefusalCode, string> = {
  [CORRECTION_REFUSAL.BOOTSTRAP]:
    "Une tache d'amorcage ne se corrige jamais toute seule. Elle recoit des permissions elargies et pose des choix structurants : sa relecture reste humaine, et sa correction se demande a la main.",
  [CORRECTION_REFUSAL.RUN_NOT_COMPLETED]:
    "Seule une execution terminee avec succes peut etre corrigee. Une execution echouee, bloquee ou annulee a laisse un etat que NOX ne sait pas reprendre.",
  [CORRECTION_REFUSAL.TASK_NOT_IN_REVIEW]:
    "Cette tache n'attend plus de decision. Seule une tache en review peut recevoir une correction.",
  [CORRECTION_REFUSAL.ALREADY_DECIDED]:
    "Cette execution a deja ete conclue — par vous dans un autre onglet, ou par la validation automatique de NOX. Rechargez la page pour voir la decision enregistree.",
  [CORRECTION_REFUSAL.PLAN_INVALID]:
    "Le plan de verification de cette tache n'est pas exploitable. Sans lui, une correction ne saurait pas ce qu'elle doit satisfaire.",
  [CORRECTION_REFUSAL.BATCH_NOT_FINAL]:
    "La validation automatique est encore en cours. Attendez son resultat : corriger maintenant reviendrait a repartir d'une preuve qu'on est en train d'obtenir.",
  [CORRECTION_REFUSAL.NO_VALIDATION_FAILURE]:
    "Aucune preuve automatisee n'a echoue sur cette execution. Il n'y a rien que NOX puisse demander de corriger de lui-meme.",
  [CORRECTION_REFUSAL.VALIDATION_ERROR]:
    "NOX n'a pas pu obtenir de preuve : une commande n'a pas pu etre lancee. Une panne d'infrastructure ne dit rien du code — relancez la validation avant d'envisager une correction.",
  [CORRECTION_REFUSAL.REPOSITORY_MUTATED]:
    "Toutes les preuves sont passees, mais une validation a modifie des fichiers suivis pendant qu'elle evaluait le travail. Le dossier de travail n'est donc plus celui qui a ete relu, et une reprise exige qu'il le soit exactement. Reglez d'abord ce que la validation a laisse derriere elle — NOX ne restaure rien a votre place — puis decidez.",
  [CORRECTION_REFUSAL.NOT_QUEUED]:
    "Cette tache n'a pas ete lancee par une file d'execution. NOX ne relance donc jamais Claude Code de lui-meme : la correction est prete, elle attend votre clic.",
  [CORRECTION_REFUSAL.QUEUE_PAUSED]:
    "La file de ce projet est en pause. Une pause veut dire « aucun Claude automatique » : la correction reste prete, et se lance a la main.",
  [CORRECTION_REFUSAL.LIMIT_REACHED]:
    `NOX a deja tente ${String(MAX_AUTOMATED_CORRECTION_ATTEMPTS)} corrections automatiques sur ce cycle de travail. Au-dela, l'echec n'est plus quelque chose qu'une reprise repare : relisez le travail, et decidez.`,
  [CORRECTION_REFUSAL.ALREADY_RESERVED]:
    "Une correction est deja engagee sur cette execution. Rechargez la page pour voir ou elle en est.",
  [CORRECTION_REFUSAL.REPOSITORY_RUN_ACTIVE]:
    "Une execution Claude Code travaille deja sur ce repository. La correction reste prete : elle partira quand ce repository sera libre. Les autres projets ne sont pas concernes.",
  [CORRECTION_REFUSAL.NO_PARTIAL_WORK]:
    "Cette execution a echoue sans rien produire. Il n'y a pas de travail partiel a continuer : relancez la tache depuis un repository propre, ou attendez si une limite d'utilisation a ete atteinte.",
};

export function correctionRefusalMessage(code: CorrectionRefusalCode): string {
  return CORRECTION_REFUSAL_MESSAGES[code];
}

/** Libelle de la source d'une correction, tel que la review l'affiche. */
export function correctionSourceLabel(source: CorrectionSource): string {
  switch (source) {
    case CORRECTION_SOURCE.AUTOMATED_VALIDATION:
      return "Automatic validation";
    case CORRECTION_SOURCE.PROCESS_FAILURE:
      return "Failed run";
    case CORRECTION_SOURCE.HUMAN_FEEDBACK:
      return "Human feedback";
  }
}

/** Provenance d'une execution, telle que sa page l'annonce. */
export function runProvenanceLabel(provenance: RunProvenance): string {
  switch (provenance) {
    case RUN_PROVENANCE.INITIAL:
      return "Initial execution";
    case RUN_PROVENANCE.HUMAN_CORRECTION:
      return "Human-requested correction";
    case RUN_PROVENANCE.AUTOMATIC_CORRECTION:
      return "Automatic validation correction";
    case RUN_PROVENANCE.LEGACY_CORRECTION:
      return "Legacy correction";
  }
}

/**
 * Ce que l'interface annonce de l'etat du cycle.
 *
 * Les libelles restent en anglais, comme les statuts techniques ; les
 * explications, elles, sont en francais. « 1 of 2 » n'est pas decoratif : c'est
 * la borne, et l'utilisateur doit savoir combien il en reste avant que la main
 * lui revienne.
 */
export function correctionStageLabel(state: CorrectionCycleState): string {
  switch (state.stage) {
    case CORRECTION_STAGE.RUNNING:
      return state.lastSource === CORRECTION_SOURCE.AUTOMATED_VALIDATION
        ? `Automatic correction ${String(state.automatedAttempts)} of ${String(state.maxAutomatedAttempts)} running`
        : "Correction running";
    case CORRECTION_STAGE.RESERVED:
      return state.lastSource === CORRECTION_SOURCE.AUTOMATED_VALIDATION
        ? `Automatic correction ${String(state.automatedAttempts)} of ${String(state.maxAutomatedAttempts)} starting`
        : "Correction starting";
    case CORRECTION_STAGE.LIMIT_REACHED:
      return "Automatic correction limit reached";
    case CORRECTION_STAGE.READY:
      return "Correction ready";
    case CORRECTION_STAGE.NONE:
      return "No correction in progress";
  }
}

/** Phrase complementaire du bandeau, ou `null` quand le libelle suffit. */
export function correctionStageDetail(state: CorrectionCycleState): string | null {
  switch (state.stage) {
    case CORRECTION_STAGE.LIMIT_REACHED:
      return (
        `NOX a tente ${String(state.automatedAttempts)} corrections automatiques sur ce cycle, ` +
        "et ne relancera plus rien seul. Human review required."
      );
    case CORRECTION_STAGE.READY:
      return (
        "Les echecs constates par NOX sont deja rassembles : vous n'avez rien a recopier. " +
        "Ajoutez une instruction seulement si elle apporte quelque chose que les preuves ne disent pas."
      );
    case CORRECTION_STAGE.RESERVED:
      return "La correction est decidee et enregistree ; son execution demarre.";
    case CORRECTION_STAGE.RUNNING:
    case CORRECTION_STAGE.NONE:
      return null;
  }
}

/**
 * Rang affiche d'une correction automatique.
 *
 * `null` pour une correction humaine : la borne ne la concerne pas, et lui
 * coller un numero laisserait croire qu'elle consomme un essai.
 */
export function automatedAttemptLabel(
  source: CorrectionSource,
  attempt: number | null,
): string | null {
  if (source !== CORRECTION_SOURCE.AUTOMATED_VALIDATION || attempt === null || attempt < 1) {
    return null;
  }
  return `Attempt ${String(attempt)} of ${String(MAX_AUTOMATED_CORRECTION_ATTEMPTS)}`;
}

/**
 * Page de correction fondee sur les seules preuves de NOX.
 *
 * Existe parce qu'une correction humaine peut n'avoir aucun texte : quand les
 * commandes qui ont echoue disent deja tout, il n'y a rien a recopier, donc
 * rien a enregistrer comme feedback. Un `ReviewFeedback` vide n'existe pas dans
 * NOX, et ce n'est pas TASK-028 qui va en inventer un.
 */
export function correctionEvidenceUrl(
  projectId: string,
  taskId: string,
  runId: string,
): string {
  return `/projects/${projectId}/tasks/${taskId}/runs/${runId}/corrections/evidence`;
}

/**
 * Page de reprise d'une execution qui a echoue.
 *
 * Distincte de `correctionEvidenceUrl`, et pas seulement par son URL : celle-la
 * part d'une review qui a constate des preuves en echec, celle-ci d'un processus
 * qui s'est arrete avant d'avoir fini. Les melanger ferait afficher « voici ce
 * que NOX a prouve » devant un travail que personne n'a mesure.
 */
export function correctionFailureUrl(
  projectId: string,
  taskId: string,
  runId: string,
): string {
  return `/projects/${projectId}/tasks/${taskId}/runs/${runId}/corrections/failure`;
}
