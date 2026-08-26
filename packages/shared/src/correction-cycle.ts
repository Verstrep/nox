/**
 * Cycle de correction d'une tache : sources, bornes, eligibilite.
 *
 * ## Ce que ce module existe pour empecher
 *
 * Qu'une boucle se ferme toute seule. `validation echoue -> correction ->
 * validation echoue -> correction` consommerait du temps, du quota et des
 * modifications de repository jusqu'a ce que quelque chose casse. La borne
 * n'est pas un reglage de confort : c'est la garantie produit qui rend
 * l'automatisme acceptable.
 *
 * ## Deux sources, et elles ne se melangent pas
 *
 * `HUMAN_FEEDBACK` : quelqu'un a lu et a demande quelque chose.
 * `AUTOMATED_VALIDATION` : NOX possede lui-meme la preuve d'un echec, et n'a
 * besoin de personne pour la recopier. Les fondre dans une seule chaine de
 * feedback ferait perdre **qui** a decide de relancer — l'information qu'on
 * cherche six mois plus tard.
 *
 * ## Ce qu'une correction ne fait jamais
 *
 * Elle ne touche pas au contrat de la tache. Ni les criteres, ni leur mode de
 * verification, ni les commandes, ni leur mode d'execution, ni les liens entre
 * les deux. Une correction essaie de satisfaire le contrat gele ; elle ne le
 * renegocie pas. Si le contrat est mauvais, c'est un humain qui le dit — par un
 * passage en force, ou en terminant le cycle puis en editant une tache future.
 *
 * ## Ce module est pur
 *
 * Ni base, ni disque, ni reseau, ni React. Il porte le vocabulaire, la borne et
 * la decision ; tout ce qu'un test peut verifier sans rien lancer.
 */

import { RUN_KIND } from "./corrections.js";
import { QUEUE_STATE, type QueueState } from "./execution-queue.js";
import { TASK_KIND, type TaskKind } from "./tasks.js";
import {
  RUN_STATUS,
  TASK_STATUS,
  createStatusGuard,
  type RunStatus,
  type TaskStatus,
} from "./statuses.js";
import {
  TASK_VERIFICATION_OUTCOME,
  VALIDATION_BATCH_STATUS,
  type TaskVerificationOutcome,
  type ValidationBatchStatus,
} from "./verification.js";

// ---------------------------------------------------------------------------
// 1. Vocabulaire
// ---------------------------------------------------------------------------

/**
 * Pourquoi une correction a ete lancee.
 *
 * Deux valeurs, fermees. Une troisieme — « mixte », « inconnue » — serait
 * l'endroit ou l'on rangerait ce qu'on n'a pas su attribuer, et il faudrait
 * bien l'attribuer au moment de decider si la borne automatique s'applique.
 */
export const CORRECTION_SOURCE = {
  /** Un humain a demande une correction depuis la review. */
  HUMAN_FEEDBACK: "HUMAN_FEEDBACK",
  /** NOX possede une preuve autonome d'echec et repart de lui-meme. */
  AUTOMATED_VALIDATION: "AUTOMATED_VALIDATION",
} as const;

export type CorrectionSource = (typeof CORRECTION_SOURCE)[keyof typeof CORRECTION_SOURCE];

export const CORRECTION_SOURCES: readonly CorrectionSource[] = Object.values(CORRECTION_SOURCE);

export const isCorrectionSource = createStatusGuard(CORRECTION_SOURCES);

/**
 * Etat d'une reservation de correction.
 *
 * `RESERVED` est l'autorisation prise, avant tout lancement. C'est elle qui
 * survit a un arret du serveur web entre la decision et la creation de
 * l'execution : sans elle, on ne saurait pas si une correction avait deja ete
 * decidee, et deux constatations successives pourraient en lancer deux.
 */
export const CORRECTION_ATTEMPT_STATUS = {
  /** Prise, pas encore lancee. */
  RESERVED: "RESERVED",
  /** Une execution de correction lui est rattachee. */
  LAUNCHED: "LAUNCHED",
  /** Rendue sans avoir rien lance : les conditions ne tenaient plus. */
  ABANDONED: "ABANDONED",
} as const;

export type CorrectionAttemptStatus =
  (typeof CORRECTION_ATTEMPT_STATUS)[keyof typeof CORRECTION_ATTEMPT_STATUS];

export const CORRECTION_ATTEMPT_STATUSES: readonly CorrectionAttemptStatus[] =
  Object.values(CORRECTION_ATTEMPT_STATUS);

export const isCorrectionAttemptStatus = createStatusGuard(CORRECTION_ATTEMPT_STATUSES);

/** Une reservation occupe-t-elle encore la place ? */
export function attemptHoldsPlace(status: CorrectionAttemptStatus): boolean {
  return status !== CORRECTION_ATTEMPT_STATUS.ABANDONED;
}

// ---------------------------------------------------------------------------
// 2. La borne
// ---------------------------------------------------------------------------

/**
 * Corrections automatiques autorisees dans un cycle de travail.
 *
 * Deux, en plus de l'execution initiale. Un meme test peut echouer pour une
 * raison que Claude Code ne comprend pas ; sans borne, la boucle irait jusqu'a
 * epuiser le quota ou le repository. Deux tentatives suffisent a rattraper ce
 * qui se rattrape ; au-dela, l'echec est structurel et il faut un humain.
 *
 * Une constante, jamais un reglage d'interface : une borne qu'on peut desserrer
 * depuis un formulaire n'est plus une borne. C'est la meme regle que pour les
 * delais de validation autonome.
 */
export const MAX_AUTOMATED_CORRECTION_ATTEMPTS = 2;

/**
 * Bornes du contexte de correction transmis a Claude Code.
 *
 * Le budget total prime : au-dela, les preuves sont coupees et la troncature
 * est **annoncee** dans le prompt lui-meme. Une sortie de test enorme ne doit
 * jamais evincer le contrat de la tache, qui est ce qu'il faut satisfaire.
 */
export const CORRECTION_EVIDENCE_LIMITS = {
  /** Budget total de la section de preuves, en caracteres. */
  total: 32_768,
  /** Part conservee de chaque flux, par commande. */
  perStream: 4_000,
  /** Fichiers suivis nommes lorsqu'une validation a modifie le depot. */
  mutatedFiles: 40,
} as const;

/** Marqueur pose par NOX a la place de ce qu'il a coupe. */
export const CORRECTION_TRUNCATION_NOTICE = "[...] sortie tronquee par NOX";

// ---------------------------------------------------------------------------
// 3. Eligibilite d'une correction automatique
// ---------------------------------------------------------------------------

/**
 * Pourquoi NOX ne relance pas Claude Code de lui-meme.
 *
 * Chaque code repond a une question differente, et aucun ne se confond avec un
 * autre. « La file est en pause » et « la borne est atteinte » demandent deux
 * gestes humains differents ; les afficher tous les deux comme « impossible »
 * ferait chercher au mauvais endroit.
 */
export const CORRECTION_REFUSAL = {
  /** Un amorcage ne se corrige jamais tout seul. */
  BOOTSTRAP: "CORRECTION_BOOTSTRAP",
  /** L'execution ne s'est pas terminee normalement. */
  RUN_NOT_COMPLETED: "CORRECTION_RUN_NOT_COMPLETED",
  /** La tache n'attend pas de decision. */
  TASK_NOT_IN_REVIEW: "CORRECTION_TASK_NOT_IN_REVIEW",
  /** La review a deja ete conclue. */
  ALREADY_DECIDED: "CORRECTION_ALREADY_DECIDED",
  /** Le plan de verification n'est pas exploitable. */
  PLAN_INVALID: "CORRECTION_PLAN_INVALID",
  /** Le lot de validations n'est pas termine. */
  BATCH_NOT_FINAL: "CORRECTION_BATCH_NOT_FINAL",
  /** Aucune preuve autonome n'a echoue : il n'y a rien a corriger. */
  NO_VALIDATION_FAILURE: "CORRECTION_NO_VALIDATION_FAILURE",
  /**
   * Toutes les preuves sont passees, mais la validation a modifie le depot.
   *
   * La tache aurait pu se terminer seule. Ce qui l'en empeche est un defaut du
   * travail — et NOX ne le corrige pourtant pas de lui-meme : le dossier de
   * travail ne correspond plus a celui qui a ete relu, et une reprise exige
   * qu'il corresponde exactement. Reancrer cette empreinte sur l'etat
   * d'apres-validation reviendrait a elargir le contrat de reprise ; NOX
   * prefere le dire et rendre la main.
   */
  REPOSITORY_MUTATED: "CORRECTION_REPOSITORY_MUTATED",
  /**
   * NOX n'a pas pu obtenir de preuve.
   *
   * Une panne d'infrastructure ne dit rien du code. Le geste qui s'applique est
   * `Retry automated validation`, pas une correction.
   */
  VALIDATION_ERROR: "CORRECTION_VALIDATION_ERROR",
  /** La tache n'est pas la barriere courante d'une file. */
  NOT_QUEUED: "CORRECTION_NOT_QUEUED",
  /** La file existe mais n'autorise rien. */
  QUEUE_PAUSED: "CORRECTION_QUEUE_PAUSED",
  /** Deux corrections automatiques ont deja eu lieu dans ce cycle. */
  LIMIT_REACHED: "CORRECTION_LIMIT_REACHED",
  /** Une correction est deja reservee ou lancee sur cette execution. */
  ALREADY_RESERVED: "CORRECTION_ALREADY_RESERVED",
} as const;

export type CorrectionRefusalCode =
  (typeof CORRECTION_REFUSAL)[keyof typeof CORRECTION_REFUSAL];

export const CORRECTION_REFUSAL_CODES: readonly CorrectionRefusalCode[] =
  Object.values(CORRECTION_REFUSAL);

/**
 * Tout ce dont la decision depend, relu au moment de decider.
 *
 * Aucun de ces faits ne vient du navigateur : ils sont tous relus en base ou
 * derives de ce qui l'est. Un onglet ne peut donc ni accorder une autorisation,
 * ni faire croire qu'une preuve est passee.
 */
export type AutomaticCorrectionFacts = {
  taskKind: TaskKind;
  taskStatus: TaskStatus;
  runStatus: RunStatus;
  /** Une decision de review a deja ete enregistree sur cette execution. */
  decided: boolean;
  planValid: boolean;
  batchStatus: ValidationBatchStatus | null;
  outcome: TaskVerificationOutcome;
  /** La tache est inscrite dans la file **et** en est la barriere courante. */
  queueCurrent: boolean;
  /** La file de ce projet porte une autorisation permanente. */
  queueActive: boolean;
  /** Corrections automatiques deja engagees dans ce cycle de travail. */
  automatedAttempts: number;
  /** Une reservation occupe deja cette execution source. */
  attemptReserved: boolean;
  /**
   * Une validation autonome a **reellement** modifie des fichiers suivis.
   *
   * Deux empreintes connues et differentes, jamais deux empreintes inconnues :
   * « je n'ai pas pu regarder » n'est pas « quelque chose a bouge », et
   * demander a Claude Code de reparer une ignorance ne repare rien.
   */
  repositoryMutated: boolean;
};

export type AutomaticCorrectionDecision =
  | { eligible: true; attempt: number }
  | { eligible: false; code: CorrectionRefusalCode };

/**
 * NOX peut-il relancer Claude Code de lui-meme sur cette execution ?
 *
 * ## L'ordre des refus
 *
 * Du plus structurel au plus circonstanciel : un amorcage ne sera jamais
 * eligible, une file en pause pourrait le redevenir au prochain clic. Cet ordre
 * decide aussi du message affiche, et c'est voulu — on montre d'abord ce qu'il
 * faut regler en premier.
 *
 * ## Pourquoi l'echec doit etre `FAILED` **et** `AUTO_FAILED`
 *
 * Un lot `ERROR` porte au moins une commande que NOX n'a pas pu lancer. La
 * preuve est incomplete, meme si une autre commande a bel et bien echoue a
 * cote : corriger sur une image partielle reviendrait a demander a Claude Code
 * de reparer ce qu'on n'a pas fini de regarder. Le geste qui s'applique est la
 * reprise de la validation.
 */
export function checkAutomaticCorrection(
  facts: AutomaticCorrectionFacts,
): AutomaticCorrectionDecision {
  // L'amorcage en premier, pour qu'aucune suite de conditions ne puisse un jour
  // l'y amener. Il recoit des permissions elargies ; sa relecture reste humaine.
  if (facts.taskKind === TASK_KIND.BOOTSTRAP) {
    return refuse(CORRECTION_REFUSAL.BOOTSTRAP);
  }
  if (facts.runStatus !== RUN_STATUS.COMPLETED) {
    return refuse(CORRECTION_REFUSAL.RUN_NOT_COMPLETED);
  }
  if (facts.taskStatus !== TASK_STATUS.REVIEW) {
    return refuse(CORRECTION_REFUSAL.TASK_NOT_IN_REVIEW);
  }
  if (facts.decided) {
    return refuse(CORRECTION_REFUSAL.ALREADY_DECIDED);
  }
  if (!facts.planValid) {
    return refuse(CORRECTION_REFUSAL.PLAN_INVALID);
  }
  if (facts.batchStatus === null) {
    return refuse(CORRECTION_REFUSAL.NO_VALIDATION_FAILURE);
  }
  if (
    facts.batchStatus === VALIDATION_BATCH_STATUS.PENDING ||
    facts.batchStatus === VALIDATION_BATCH_STATUS.RUNNING
  ) {
    return refuse(CORRECTION_REFUSAL.BATCH_NOT_FINAL);
  }
  if (
    facts.batchStatus === VALIDATION_BATCH_STATUS.ERROR ||
    facts.outcome === TASK_VERIFICATION_OUTCOME.AUTO_ERROR
  ) {
    return refuse(CORRECTION_REFUSAL.VALIDATION_ERROR);
  }
  // Une seule situation ouvre une correction automatique : une preuve que NOX a
  // obtenue lui-meme a echoue.
  //
  // La mutation du depot par la validation en est proche — la tache aurait pu se
  // terminer seule, et le defaut est reel — mais elle recoit son propre refus.
  // Une reprise exige que le dossier de travail soit **exactement** celui qui a
  // ete relu ; apres une validation qui l'a modifie, il ne l'est plus. NOX le
  // nomme et rend la main plutot que d'engager une correction qu'il sait
  // condamnee, ou d'elargir le contrat de reprise pour la sauver.
  if (facts.outcome !== TASK_VERIFICATION_OUTCOME.AUTO_FAILED) {
    return refuse(
      facts.outcome === TASK_VERIFICATION_OUTCOME.AUTO_PASSED && facts.repositoryMutated
        ? CORRECTION_REFUSAL.REPOSITORY_MUTATED
        : CORRECTION_REFUSAL.NO_VALIDATION_FAILURE,
    );
  }
  if (facts.attemptReserved) {
    return refuse(CORRECTION_REFUSAL.ALREADY_RESERVED);
  }
  // L'autorisation permanente de la file, et rien d'autre. Une tache lancee a la
  // main n'en a jamais recu, et une file en pause a explicitement retire la
  // sienne pour la suite.
  if (!facts.queueCurrent) {
    return refuse(CORRECTION_REFUSAL.NOT_QUEUED);
  }
  if (!facts.queueActive) {
    return refuse(CORRECTION_REFUSAL.QUEUE_PAUSED);
  }
  if (facts.automatedAttempts >= MAX_AUTOMATED_CORRECTION_ATTEMPTS) {
    return refuse(CORRECTION_REFUSAL.LIMIT_REACHED);
  }

  return { eligible: true, attempt: facts.automatedAttempts + 1 };
}

function refuse(code: CorrectionRefusalCode): AutomaticCorrectionDecision {
  return { eligible: false, code };
}

/**
 * Une correction demandee par un humain est-elle possible ?
 *
 * Volontairement plus permissive que la precedente : elle ne demande ni file,
 * ni autorisation, ni echec de validation. Un humain peut corriger parce qu'il
 * a vu quelque chose que personne n'a mesure — c'est exactement ce que
 * `HUMAN_FEEDBACK` veut dire. La borne automatique, elle, ne s'applique pas :
 * elle borne l'automatisme, pas les gestes humains.
 */
export function checkHumanCorrection(
  facts: Pick<
    AutomaticCorrectionFacts,
    "taskStatus" | "runStatus" | "decided" | "batchStatus" | "attemptReserved"
  >,
): AutomaticCorrectionDecision {
  if (facts.runStatus !== RUN_STATUS.COMPLETED) {
    return refuse(CORRECTION_REFUSAL.RUN_NOT_COMPLETED);
  }
  if (facts.taskStatus !== TASK_STATUS.REVIEW) {
    return refuse(CORRECTION_REFUSAL.TASK_NOT_IN_REVIEW);
  }
  if (facts.decided) {
    return refuse(CORRECTION_REFUSAL.ALREADY_DECIDED);
  }
  // Lancer une correction pendant qu'une preuve est en train d'etre obtenue
  // produirait une reprise fondee sur un resultat qu'on n'a pas encore.
  if (
    facts.batchStatus === VALIDATION_BATCH_STATUS.PENDING ||
    facts.batchStatus === VALIDATION_BATCH_STATUS.RUNNING
  ) {
    return refuse(CORRECTION_REFUSAL.BATCH_NOT_FINAL);
  }
  if (facts.attemptReserved) {
    return refuse(CORRECTION_REFUSAL.ALREADY_RESERVED);
  }
  return { eligible: true, attempt: 0 };
}

// ---------------------------------------------------------------------------
// 4. Etat affiche du cycle
// ---------------------------------------------------------------------------

/**
 * Ou en est le cycle de correction d'une tache.
 *
 * Derive, jamais persiste — comme l'etat de la file et le resultat des
 * criteres. Un compteur stocke se mettrait a mentir des la premiere
 * reouverture d'une tache terminee.
 */
export const CORRECTION_STAGE = {
  /** Aucune correction en jeu. */
  NONE: "NONE",
  /** Une correction a ete decidee et n'a pas encore d'execution. */
  RESERVED: "RESERVED",
  /** Une correction tourne. */
  RUNNING: "RUNNING",
  /** Une correction est possible, et attend un geste humain. */
  READY: "READY",
  /** La borne automatique est atteinte : un humain doit reprendre la main. */
  LIMIT_REACHED: "LIMIT_REACHED",
} as const;

export type CorrectionStage = (typeof CORRECTION_STAGE)[keyof typeof CORRECTION_STAGE];

export const CORRECTION_STAGES: readonly CorrectionStage[] = Object.values(CORRECTION_STAGE);

/** Une tentative du cycle courant, telle que la review l'affiche. */
export type CorrectionAttemptFacts = {
  id: string;
  source: CorrectionSource;
  status: CorrectionAttemptStatus;
  /** Rang de la correction automatique, a partir de 1 ; `0` pour un humain. */
  automatedAttempt: number;
  correctionRunId: string | null;
};

export type CorrectionCycleFacts = {
  attempts: readonly CorrectionAttemptFacts[];
  /** Une execution du cycle tourne encore. */
  running: boolean;
  /** Une correction — humaine ou automatique — est possible maintenant. */
  correctionAvailable: boolean;
  automatic: AutomaticCorrectionDecision;
};

/** Ce que l'interface annonce du cycle. */
export type CorrectionCycleState = {
  stage: CorrectionStage;
  /** Corrections automatiques deja engagees. */
  automatedAttempts: number;
  /** Borne, recopiee pour que l'affichage n'ait pas a la reimporter. */
  maxAutomatedAttempts: number;
  /** Source de la derniere correction du cycle, ou `null`. */
  lastSource: CorrectionSource | null;
  /** Refus courant d'une correction automatique, ou `null` si elle est possible. */
  refusal: CorrectionRefusalCode | null;
};

/**
 * Resume le cycle en un etat affichable.
 *
 * Pure et deterministe : elle ne lit rien, ne decide rien et n'autorise rien.
 * Un etat affiche n'a jamais autorise un lancement dans NOX, et ce n'est pas
 * ici que ca commencera.
 */
export function deriveCorrectionCycle(facts: CorrectionCycleFacts): CorrectionCycleState {
  const engaged = facts.attempts.filter(
    (attempt) =>
      attempt.source === CORRECTION_SOURCE.AUTOMATED_VALIDATION &&
      attemptHoldsPlace(attempt.status),
  );
  const last = facts.attempts.filter((attempt) => attemptHoldsPlace(attempt.status)).at(-1) ?? null;

  const state = {
    automatedAttempts: engaged.length,
    maxAutomatedAttempts: MAX_AUTOMATED_CORRECTION_ATTEMPTS,
    lastSource: last?.source ?? null,
    refusal: facts.automatic.eligible ? null : facts.automatic.code,
  };

  if (facts.running) {
    return { ...state, stage: CORRECTION_STAGE.RUNNING };
  }

  const reserved = facts.attempts.find(
    (attempt) => attempt.status === CORRECTION_ATTEMPT_STATUS.RESERVED,
  );
  if (reserved !== undefined) {
    return { ...state, stage: CORRECTION_STAGE.RESERVED };
  }

  // La borne ne se signale que lorsqu'elle est la seule chose qui bloque : dire
  // « limite atteinte » a quelqu'un dont la validation est simplement en cours
  // l'enverrait chercher un probleme qui n'existe pas.
  if (!facts.automatic.eligible && facts.automatic.code === CORRECTION_REFUSAL.LIMIT_REACHED) {
    return { ...state, stage: CORRECTION_STAGE.LIMIT_REACHED };
  }

  if (facts.correctionAvailable) {
    return { ...state, stage: CORRECTION_STAGE.READY };
  }

  return { ...state, stage: CORRECTION_STAGE.NONE };
}

/**
 * La file est-elle arretee par une borne de correction atteinte ?
 *
 * Sert au libelle de l'element courant : `deriveQueueState` reste pure et ne
 * sait rien des lots de validation, exactement comme pour `REVIEW_WAIT`. C'est
 * l'affichage qui precise, a partir de ce qui a deja ete charge.
 */
export function queueBlockedByCorrection(state: QueueState, stage: CorrectionStage): boolean {
  return state === QUEUE_STATE.WAITING_REVIEW && stage === CORRECTION_STAGE.LIMIT_REACHED;
}

/** D'ou vient une execution, telle que sa page l'annonce. */
export const RUN_PROVENANCE = {
  INITIAL: "INITIAL",
  HUMAN_CORRECTION: "HUMAN_CORRECTION",
  AUTOMATIC_CORRECTION: "AUTOMATIC_CORRECTION",
  /** Correction anterieure a TASK-028 : la source n'a jamais ete enregistree. */
  LEGACY_CORRECTION: "LEGACY_CORRECTION",
} as const;

export type RunProvenance = (typeof RUN_PROVENANCE)[keyof typeof RUN_PROVENANCE];

/**
 * Provenance d'une execution.
 *
 * Une correction historique n'a pas de source : elle est annoncee comme
 * historique, jamais en erreur. Inventer `HUMAN_FEEDBACK` serait plausible et
 * faux — toutes les corrections d'avant TASK-028 partaient bien d'un feedback,
 * mais l'affirmer reviendrait a ecrire dans l'histoire ce qu'on n'a pas releve.
 */
export function runProvenance(kind: string, source: CorrectionSource | null): RunProvenance {
  // Une valeur illisible est traitee comme initiale : c'est celle qui ne
  // pretend rien. `DevelopmentRunDetail.kind` est une chaine, parce qu'elle
  // vient d'une colonne — la refermer ici inventerait une garantie que la base
  // ne donne pas.
  if (kind !== RUN_KIND.CORRECTION) {
    return RUN_PROVENANCE.INITIAL;
  }
  switch (source) {
    case CORRECTION_SOURCE.AUTOMATED_VALIDATION:
      return RUN_PROVENANCE.AUTOMATIC_CORRECTION;
    case CORRECTION_SOURCE.HUMAN_FEEDBACK:
      return RUN_PROVENANCE.HUMAN_CORRECTION;
    default:
      return RUN_PROVENANCE.LEGACY_CORRECTION;
  }
}
