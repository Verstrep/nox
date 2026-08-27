/**
 * File d'execution d'un projet.
 *
 * ## Ce que la file est, et ce qu'elle n'est pas
 *
 * Elle est une **intention** : « je veux que ces taches s'executent, dans cet
 * ordre ». Elle n'est pas un ordonnanceur autonome. Mettre une tache en file ne
 * lance rien ; seul un `Start queue` explicite ouvre une autorisation, et cette
 * autorisation reste soumise a tout ce qui existait avant elle — statut de la
 * tache, dependances, review humaine, preflight Git, unicite de l'execution
 * active.
 *
 * ## Deux notions separees, comme en TASK-024
 *
 * `Task.status` dit **ou en est le travail**. L'appartenance a la file dit
 * **s'il est autorise a partir**. Il n'existe donc aucun statut `QUEUED` : une
 * tache en file reste `READY`, et c'est la ligne `TaskQueueEntry` qui porte
 * l'information. Confondre les deux aurait produit un statut qui change sans
 * geste humain, exactement ce que D-302 a refuse pour les dependances.
 *
 * ## Ce module est pur
 *
 * Ni base, ni disque, ni reseau, ni React. Il porte le vocabulaire, les refus,
 * et la selection deterministe de la prochaine tache — celle qu'un test peut
 * verifier sans rien demarrer.
 */

import { TASK_KIND, type TaskKind } from "./tasks.js";
import { TASK_STATUS, createStatusGuard, type TaskStatus } from "./statuses.js";
import type { TaskDependencyLink } from "./task-dependencies.js";

/** Refus possibles des operations de file. */
export const EXECUTION_QUEUE_ERROR = {
  /** La tache n'existe pas dans ce projet. */
  TASK_NOT_FOUND: "QUEUE_TASK_NOT_FOUND",
  /** Seule une tache `READY` peut entrer dans la file. */
  TASK_NOT_READY: "QUEUE_TASK_NOT_READY",
  /** Elle y est deja : l'operation est idempotente, pas une erreur. */
  TASK_ALREADY_QUEUED: "TASK_ALREADY_QUEUED",
  /** L'amorcage ne passe jamais par la file. */
  BOOTSTRAP_NOT_QUEUEABLE: "BOOTSTRAP_TASK_NOT_QUEUEABLE",
  /** Une execution travaille deja sur cette tache. */
  TASK_HAS_ACTIVE_RUN: "QUEUE_CURRENT_TASK_ACTIVE",
  /** Aucune entree ne porte ce couple projet/tache. */
  ENTRY_NOT_FOUND: "QUEUE_ENTRY_NOT_FOUND",
  /** La file ne contient rien a demarrer. */
  QUEUE_EMPTY: "QUEUE_EMPTY",
} as const;

export type ExecutionQueueErrorCode =
  (typeof EXECUTION_QUEUE_ERROR)[keyof typeof EXECUTION_QUEUE_ERROR];

/**
 * Une tache en file ne se modifie pas.
 *
 * La mettre en file, c'est autoriser l'execution de **son contrat actuel**. Le
 * reecrire ensuite reviendrait a lancer autre chose que ce qui a ete autorise.
 * Le refus est explicite plutot qu'un retrait silencieux : sortir une tache de
 * la file est une decision, pas un effet de bord d'un clic sur « Edit ».
 */
export const TASK_IS_QUEUED = "TASK_IS_QUEUED";

/**
 * Un lancement manuel initial ne double pas une file preparee.
 *
 * Ne concerne **que** le premier lancement d'une tache. Une correction termine
 * un travail deja commence : elle n'est pas un nouvel element de planification,
 * et ce refus ne la touche jamais.
 */
export const EXECUTION_QUEUE_PENDING = "EXECUTION_QUEUE_PENDING";

/**
 * Etat derive de la file, tel que l'ecran l'annonce.
 *
 * Aucune de ces valeurs n'est stockee : elles se recalculent a chaque lecture a
 * partir des entrees, des statuts et de l'etat du repository.
 */
export const QUEUE_STATE = {
  /** L'autorisation n'est pas ouverte. */
  PAUSED: "PAUSED",
  /** Aucune entree. Une file vide est toujours en pause. */
  EMPTY: "EMPTY",
  /** Des entrees attendent, et un `Start queue` suffirait. */
  READY_TO_START: "READY_TO_START",
  /** Une execution travaille sur l'element courant. */
  RUNNING: "RUNNING",
  /** L'element courant attend une decision humaine. */
  WAITING_REVIEW: "WAITING_REVIEW",
  /** Aucune entree n'est eligible : toutes attendent une dependance. */
  WAITING_DEPENDENCIES: "WAITING_DEPENDENCIES",
  /** Une tache pourrait partir, mais le repository n'est pas pret. */
  WAITING_REPOSITORY: "WAITING_REPOSITORY",
  /** L'element courant a echoue ou a ete interrompu. */
  FAILED_CURRENT: "FAILED_CURRENT",
  /**
   * L'element courant a ete rouvert : il attend une reprise humaine.
   *
   * Distinct de `FAILED_CURRENT` : rien n'a echoue. Une relecture a demande des
   * changements, et la tache est repartie dans son propre workflow. Dire
   * « echec » ici serait faux, et dire « prete a demarrer » serait pire.
   */
  WAITING_CURRENT_TASK: "WAITING_CURRENT_TASK",
} as const;

export type QueueState = (typeof QUEUE_STATE)[keyof typeof QUEUE_STATE];

export const QUEUE_STATES: readonly QueueState[] = Object.values(QUEUE_STATE);

export const isQueueState = createStatusGuard(QUEUE_STATES);

/**
 * Issue d'une tentative d'avancement.
 *
 * Le resultat est **dit**, jamais devine : l'appelant ne doit pas avoir a
 * relire dix tables pour savoir pourquoi rien n'est parti.
 */
export const QUEUE_DISPATCH = {
  /** Une execution vient de demarrer. Au plus une par appel. */
  STARTED: "STARTED",
  /** La file n'est pas active. */
  PAUSED: "PAUSED",
  /** La file est vide. */
  EMPTY: "EMPTY",
  /** L'element courant attend une decision humaine. */
  WAITING_REVIEW: "WAITING_REVIEW",
  /** Aucune entree eligible : les dependances ne sont pas terminees. */
  WAITING_DEPENDENCIES: "WAITING_DEPENDENCIES",
  /** Le repository n'est pas dans un etat permettant de lancer. */
  WAITING_REPOSITORY: "WAITING_REPOSITORY",
  /**
   * Le travail precedent n'a pas encore ete livre.
   *
   * Distinct de `WAITING_REPOSITORY`, et pour une raison qui compte : celui-la
   * dit « le repository n'est pas propre », celui-ci dit « la politique Git de
   * ce projet n'est pas encore satisfaite ». Le premier se regle dans un
   * terminal, le second sur la surface de livraison — et NOX sait laquelle des
   * deux s'applique.
   */
  WAITING_DELIVERY: "WAITING_DELIVERY",
  /** Une execution est deja active. */
  ACTIVE_RUN: "ACTIVE_RUN",
  /** L'element courant a echoue : la file ne saute jamais par-dessus. */
  FAILED_CURRENT: "FAILED_CURRENT",
  /**
   * L'element courant est rouvert et attend sa reprise.
   *
   * La file ne le relance pas elle-meme : reprendre un travail refuse est une
   * decision, et elle se prend sur la page de la tache. « Try next » n'est pas
   * un bouton de reprise.
   */
  WAITING_CURRENT_TASK: "WAITING_CURRENT_TASK",
  /** Le lancement a ete refuse par le pipeline existant. */
  REFUSED: "REFUSED",
} as const;

export type QueueDispatchOutcome = (typeof QUEUE_DISPATCH)[keyof typeof QUEUE_DISPATCH];

/**
 * Une entree de file, accompagnee de ce qui decide de son sort.
 *
 * `dependencies` porte les dependances **non satisfaites**, derivees du statut
 * courant des taches attendues — jamais stockees.
 */
export type QueueEntryFacts = {
  taskId: string;
  code: string;
  title: string;
  sequence: number;
  status: TaskStatus;
  waiting: readonly TaskDependencyLink[];
  /**
   * Une execution est deja nee de cette inscription.
   *
   * C'est la seule chose que le statut ne sait pas dire. Une tache rouverte
   * redevient `READY`, exactement comme une tache jamais lancee : sans ce fait,
   * la file les confondrait, et relancerait la premiere en croyant demarrer la
   * seconde. Il est **persiste** — `TaskQueueEntry.startedAt` — parce qu'un
   * redemarrage du serveur ne doit pas effacer la difference.
   */
  started: boolean;
};

/**
 * Une entree est-elle l'element courant de la file ?
 *
 * Deux facons de l'etre, et il faut les deux. La tache a quitte `READY` — elle
 * travaille, elle attend une relecture, elle a echoue. Ou bien une execution est
 * **deja nee de cette inscription**, meme si la tache est revenue a `READY`.
 *
 * Le second cas est celui d'un `Reopen`. Sans lui, une tache dont le travail a
 * ete refuse redeviendrait une entree ordinaire, indiscernable d'une tache
 * jamais commencee — et la file la relancerait au premier evenement venu, ou
 * passerait a la suivante par-dessus un travail en cours de reprise.
 *
 * La barriere ne tombe qu'a l'acceptation, moment ou l'entree disparait, ou sur
 * retrait humain explicite. `COMPLETED` figure ici par prudence : une entree ne
 * devrait jamais survivre a l'acceptation de sa tache.
 */
export function isQueueBarrier(entry: Pick<QueueEntryFacts, "status" | "started">): boolean {
  if (entry.status === TASK_STATUS.COMPLETED) {
    return false;
  }
  return entry.started || entry.status !== TASK_STATUS.READY;
}

/**
 * Une entree est-elle prete a partir **d'elle-meme** ?
 *
 * Trois conditions : la tache est `READY`, aucune de ses dependances n'attend,
 * et son inscription n'a encore rien lance. Le reste — repository, execution
 * active, permissions — n'est pas propre a l'entree et se verifie une fois, pour
 * la file entiere.
 *
 * La troisieme condition est ce qui empeche un redemarrage automatique : une
 * tache rouverte est `READY` et sans dependance en attente, donc parfaitement
 * eligible en apparence. Elle ne repart pourtant que sur un geste humain, par
 * son propre workflow de tache.
 */
export function isQueueEntryEligible(entry: QueueEntryFacts): boolean {
  return (
    entry.status === TASK_STATUS.READY && entry.waiting.length === 0 && !entry.started
  );
}

/**
 * Choisit la prochaine tache a lancer.
 *
 * **Sans blocage de tete.** La premiere entree eligible part, meme si des
 * entrees plus anciennes attendent une dependance. Une file qui s'arreterait sur
 * son premier element bloque immobiliserait tout le travail restant pour une
 * raison qui ne le concerne pas — et l'ordre de file n'est qu'une preference,
 * alors que les dependances font autorite.
 *
 * L'entree sautee **reste a sa place** : son tour viendra quand ses prerequis
 * seront termines.
 *
 * Retourne `null` quand rien n'est eligible.
 */
export function selectNextQueueEntry(
  entries: readonly QueueEntryFacts[],
): QueueEntryFacts | null {
  const ordered = [...entries].sort((left, right) => left.sequence - right.sequence);
  return ordered.find(isQueueEntryEligible) ?? null;
}

/** L'element courant de la file, s'il y en a un. */
export function selectQueueBarrier(
  entries: readonly QueueEntryFacts[],
): QueueEntryFacts | null {
  const ordered = [...entries].sort((left, right) => left.sequence - right.sequence);
  return ordered.find((entry) => isQueueBarrier(entry)) ?? null;
}

/** Lecture compacte de la file, entierement derivee. */
export type QueueReadModel = {
  active: boolean;
  entries: readonly QueueEntryFacts[];
  queuedCount: number;
  /** L'entree dont le travail est commence et pas encore accepte. */
  current: QueueEntryFacts | null;
  eligibleCount: number;
  waitingDependencyCount: number;
  /**
   * La prochaine tache qui partirait, si tout le reste le permettait.
   *
   * Toujours `null` tant qu'une barriere tient : rien ne passe devant l'element
   * courant, et un modele de lecture qui en designerait un quand meme finirait
   * par etre cru.
   */
  nextEligible: QueueEntryFacts | null;
  state: QueueState;
};

/**
 * Etat de disponibilite du repository, tel que l'appelant l'a constate.
 *
 * `unknown` est distinct de `not_ready` : ne pas avoir demande n'est pas avoir
 * recu un refus. Le tableau de bord ne sonde pas, la page de la file oui.
 */
export type QueueRepositoryReadiness = "ready" | "not_ready" | "unknown";

/**
 * Derive l'etat de la file.
 *
 * Pure et deterministe : ni base, ni runner, ni fournisseur. L'ordre des tests
 * est celui des questions qu'un utilisateur se pose — « pourquoi rien ne part
 * ? » — de la cause la plus proche a la plus lointaine.
 */
export function deriveQueueState(input: {
  active: boolean;
  entries: readonly QueueEntryFacts[];
  repository?: QueueRepositoryReadiness;
}): QueueReadModel {
  const entries = [...input.entries].sort((left, right) => left.sequence - right.sequence);
  const current = selectQueueBarrier(entries);
  // La barriere prime : tant qu'un travail commence n'est pas accepte, il n'y a
  // pas de « prochaine ». La question ne se pose qu'une fois la voie libre.
  const nextEligible = current === null ? selectNextQueueEntry(entries) : null;
  const eligibleCount = entries.filter(isQueueEntryEligible).length;
  const waitingDependencyCount = entries.filter(
    (entry) => entry.status === TASK_STATUS.READY && entry.waiting.length > 0,
  ).length;

  return {
    active: input.active,
    entries,
    queuedCount: entries.length,
    current,
    eligibleCount,
    waitingDependencyCount,
    nextEligible,
    state: queueState({
      active: input.active,
      empty: entries.length === 0,
      current,
      nextEligible,
      repository: input.repository ?? "unknown",
    }),
  };
}

function queueState(input: {
  active: boolean;
  empty: boolean;
  current: QueueEntryFacts | null;
  nextEligible: QueueEntryFacts | null;
  repository: QueueRepositoryReadiness;
}): QueueState {
  if (input.empty) {
    return QUEUE_STATE.EMPTY;
  }

  // L'element courant prime sur l'activation : une tache en cours ou en review
  // decrit mieux la situation que « en pause ». Ce que la pause change, c'est ce
  // qui se passera **apres** — et l'ecran le dit a cote.
  if (input.current !== null) {
    switch (input.current.status) {
      case TASK_STATUS.RUNNING:
        return QUEUE_STATE.RUNNING;
      case TASK_STATUS.REVIEW:
        return QUEUE_STATE.WAITING_REVIEW;
      // Rouverte : elle est `READY`, et pourtant elle n'est pas disponible. Son
      // travail a commence et n'a pas ete accepte ; la file l'attend, elle ne la
      // relance pas.
      case TASK_STATUS.READY:
        return QUEUE_STATE.WAITING_CURRENT_TASK;
      case TASK_STATUS.FAILED:
      case TASK_STATUS.BLOCKED:
        return QUEUE_STATE.FAILED_CURRENT;
      default:
        return QUEUE_STATE.FAILED_CURRENT;
    }
  }

  if (!input.active) {
    return QUEUE_STATE.PAUSED;
  }

  if (input.nextEligible === null) {
    return QUEUE_STATE.WAITING_DEPENDENCIES;
  }

  return input.repository === "not_ready"
    ? QUEUE_STATE.WAITING_REPOSITORY
    : QUEUE_STATE.READY_TO_START;
}

/** Etat d'une tache candidate a l'entree en file, relu en base. */
export type QueueCandidate = {
  status: TaskStatus;
  kind: TaskKind;
  hasActiveRun: boolean;
  alreadyQueued: boolean;
};

export type QueueCandidateCheck =
  | { ok: true }
  | { ok: false; code: ExecutionQueueErrorCode };

/**
 * Une tache peut-elle entrer dans la file ?
 *
 * Les dependances ne figurent **pas** ici, et c'est voulu : on prepare une file
 * avant que ses prerequis soient termines. Elles decideront au lancement, pas a
 * l'inscription.
 *
 * L'ordre des refus va du plus structurel au plus circonstanciel : une tache
 * d'amorcage ne sera jamais queueable, alors qu'une tache non prete le
 * redeviendra.
 */
export function checkQueueCandidate(candidate: QueueCandidate): QueueCandidateCheck {
  if (candidate.kind === TASK_KIND.BOOTSTRAP) {
    return { ok: false, code: EXECUTION_QUEUE_ERROR.BOOTSTRAP_NOT_QUEUEABLE };
  }
  if (candidate.alreadyQueued) {
    return { ok: false, code: EXECUTION_QUEUE_ERROR.TASK_ALREADY_QUEUED };
  }
  if (candidate.status !== TASK_STATUS.READY) {
    return { ok: false, code: EXECUTION_QUEUE_ERROR.TASK_NOT_READY };
  }
  if (candidate.hasActiveRun) {
    return { ok: false, code: EXECUTION_QUEUE_ERROR.TASK_HAS_ACTIVE_RUN };
  }
  return { ok: true };
}

/**
 * Statuts qu'un humain ne peut pas poser sur une tache en file.
 *
 * `DRAFT` et `BLOCKED` sont les deux facons de retirer une tache du jeu. Les
 * poser sur une tache autorisee a s'executer contredirait cette autorisation
 * sans la retirer. Les autres transitions manuelles restent ouvertes :
 * `Approve` doit fonctionner, `Reopen` aussi, `Retry` egalement.
 */
const QUEUE_LOCKED_STATUSES: readonly TaskStatus[] = [TASK_STATUS.DRAFT, TASK_STATUS.BLOCKED];

export function isQueueLockedStatusChange(target: TaskStatus): boolean {
  return QUEUE_LOCKED_STATUSES.includes(target);
}

/** Sens d'un deplacement dans la file. */
export type QueueMoveDirection = "up" | "down";

/**
 * Refus possibles d'un lancement d'execution.
 *
 * Ce vocabulaire vit ici plutot que dans le lanceur pour que le dispatcher
 * puisse le lire sans importer le moteur : un module qui n'a besoin que d'un
 * code d'erreur ne doit pas tirer avec lui tout ce que ce moteur importe.
 */
export const LAUNCH_REFUSAL = {
  UNKNOWN_TASK: "UNKNOWN_TASK",
  NOT_READY: "NOT_READY",
  NOT_SYNCED: "NOT_SYNCED",
  NO_CRITERIA: "NO_CRITERIA",
  DEPENDENCIES: "DEPENDENCIES",
  POLICY: "POLICY",
  /** Une autre execution est deja active sur ce repository. */
  ACTIVE_RUN: "ACTIVE_RUN",
  /** Le runner a refuse le demarrage. */
  RUNNER: "RUNNER",
} as const;

export type LaunchRefusalCode = (typeof LAUNCH_REFUSAL)[keyof typeof LAUNCH_REFUSAL];

export type LaunchOutcome =
  | { ok: true; runId: string }
  | { ok: false; code: LaunchRefusalCode; message: string };
