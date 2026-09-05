/**
 * Affichage du tableau de bord des projets.
 *
 * ## Ce que la page d'accueil doit repondre
 *
 * Quels projets existent, lequel ouvrir, ou en est chacun, comment en creer un.
 * Rien d'autre. Ce module traduit des faits deja derives en libelles ; il ne
 * lit ni base, ni disque, ni runner, et n'appelle aucun fournisseur.
 *
 * ## Ce qui a disparu, et pourquoi
 *
 * L'ancienne page racontait l'avancement de NOX lui-meme : version codee en
 * dur, « phase courante », socle technique, prochaines grandes etapes. C'etait
 * juste au moment ou ces lignes ont ete ecrites, faux quelques taches plus tard,
 * et jamais utile a quelqu'un qui veut ouvrir un projet. Un tableau de bord qui
 * decrit l'outil au lieu du travail ne se maintient pas : il se perime.
 *
 * Pur et sans dependance : ni base, ni React, ni reseau.
 */

import {
  TASK_STATUS,
  type DeliveryPolicy,
  type ProjectStatus,
  type TaskStatus,
} from "@nox/shared";

import { deliveryPolicyLabel } from "./delivery-display.ts";
import { taskStatusLabel } from "./labels.ts";
// La repartition par statut vit dans `task-display.ts` depuis TASK-034 : la
// liste des taches l'affiche desormais aussi, et un second ordre finirait par
// diverger de celui-ci.
import { taskBreakdown } from "./task-display.ts";

/** Faits d'un projet, tels que la couche de donnees les derive. */
export type ProjectCardFacts = {
  briefSummary: string | null;
  taskCounts: Record<TaskStatus, number>;
  taskTotal: number;
  bootstrapStatus: TaskStatus | null;
  readyWaitingOnDependencies: number;
  lastTaskActivityAt: Date | null;
  queuedCount: number;
  queueActive: boolean;
  activeRun: { taskCode: string; isCorrection: boolean } | null;
  validating: boolean;
  deliveryPolicy: DeliveryPolicy;
  blockingDelivery: { taskCode: string } | null;
};

/**
 * Ce qu'un projet est en train de faire, en une valeur.
 *
 * Une liste fermee, et derivee : aucune de ces valeurs n'est stockee, et aucune
 * ne decrit NOX dans son ensemble. Plusieurs projets peuvent afficher
 * `RUNNING` au meme instant — c'est le fait que TASK-031 rend possible, et que
 * cette liste doit pouvoir representer sans mentir.
 */
export const PROJECT_EXECUTION_STATE = {
  /** Claude Code travaille sur ce projet. */
  RUNNING: "RUNNING",
  /** Claude Code reprend un travail refuse par une preuve. */
  CORRECTING: "CORRECTING",
  /** NOX execute lui-meme les commandes de validation. */
  VALIDATING: "VALIDATING",
  /** Un travail attend une decision humaine. */
  WAITING_REVIEW: "WAITING_REVIEW",
  /** Un travail valide n'est pas livre, et la file ne passe pas outre. */
  WAITING_DELIVERY: "WAITING_DELIVERY",
  /** La file porte une autorisation, et rien ne l'occupe en ce moment. */
  QUEUE_ACTIVE: "QUEUE_ACTIVE",
  /** Des taches sont inscrites, mais la file n'autorise rien. */
  QUEUE_PAUSED: "QUEUE_PAUSED",
  /** Une tache s'est mal terminee et attend une reprise. */
  BLOCKED: "BLOCKED",
  /** Rien ne travaille, rien n'attend. */
  IDLE: "IDLE",
} as const;

export type ProjectExecutionState =
  (typeof PROJECT_EXECUTION_STATE)[keyof typeof PROJECT_EXECUTION_STATE];

/** Ce que la carte affiche de l'activite d'un projet. */
export type ProjectExecutionBadge = {
  state: ProjectExecutionState;
  label: string;
  /** Precision affichee a cote du libelle, ou `null` s'il n'y en a pas. */
  detail: string | null;
};

/**
 * Ton d'affichage d'un etat d'execution.
 *
 * `BLOCKED` a quitte `warn` pour `danger` en TASK-034 : une attente et un
 * incident ne se lisent pas pareil. Les deux `WAITING_*` restent `warn` — ils
 * disent « quelqu'un doit agir », pas « quelque chose s'est mal passe ».
 */
export function executionTone(
  state: ProjectExecutionState,
): "accent" | "neutral" | "muted" | "warn" | "danger" {
  switch (state) {
    case PROJECT_EXECUTION_STATE.RUNNING:
    case PROJECT_EXECUTION_STATE.CORRECTING:
    case PROJECT_EXECUTION_STATE.VALIDATING:
      return "accent";
    case PROJECT_EXECUTION_STATE.BLOCKED:
      return "danger";
    case PROJECT_EXECUTION_STATE.WAITING_REVIEW:
    case PROJECT_EXECUTION_STATE.WAITING_DELIVERY:
      return "warn";
    case PROJECT_EXECUTION_STATE.QUEUE_ACTIVE:
      return "neutral";
    case PROJECT_EXECUTION_STATE.QUEUE_PAUSED:
    case PROJECT_EXECUTION_STATE.IDLE:
      return "muted";
  }
}

/**
 * Le badge, en un seul morceau de texte.
 *
 * Compose ici plutot que dans le JSX, pour la meme raison que
 * `breakdownLabel` : `{label} {detail}` produirait plusieurs enfants React,
 * donc des separateurs de commentaire dans le HTML rendu — et le badge
 * cesserait d'etre cherchable, dans un test comme dans un navigateur.
 */
export function executionBadgeLabel(badge: ProjectExecutionBadge): string {
  return badge.detail === null ? badge.label : `${badge.label} · ${badge.detail}`;
}

/**
 * Le resume, en une phrase.
 *
 * Il n'apparait qu'a partir de deux projets : sur un seul, il repeterait la
 * carte qui se trouve juste en dessous.
 */
export function executionSummaryLabel(summary: ExecutionSummary): string | null {
  if (summary.projects < 2) {
    return null;
  }
  const parts = [
    `${String(summary.projects)} projets`,
    `${String(summary.running)} Claude en cours`,
    `${String(summary.activeQueues)} files actives`,
    `${String(summary.waitingForHuman)} en attente humaine`,
  ];
  return parts.join(" · ");
}

/** Une carte de projet, prete a etre rendue. */
export type ProjectCard = {
  id: string;
  name: string;
  status: ProjectStatus;
  repositoryPath: string;
  /** Resume du brief, borne pour la carte, ou `null` s'il n'y a pas de brief. */
  summary: string | null;
  taskTotal: number;
  /** Repartition affichee, dans l'ordre du workflow, statuts vides omis. */
  breakdown: readonly { status: TaskStatus; count: number }[];
  bootstrapLabel: string;
  waitingOnDependencies: number;
  /** Taches inscrites dans la file d'execution du projet. */
  queuedCount: number;
  /** L'autorisation permanente de la file est-elle ouverte ? */
  queueActive: boolean;
  /** Ce que ce projet fait en ce moment, entierement derive. */
  execution: ProjectExecutionBadge;
  /** Politique de livraison Git, propre a ce projet. */
  deliveryLabel: string;
  lastActivityAt: Date;
};

/**
 * Longueur du resume affiche sur une carte.
 *
 * Le brief peut aller jusqu'a deux kilo-octets ; une carte ne peut pas. La
 * coupure se fait sur un mot, et le texte complet reste a un clic — la page du
 * plan le porte en entier.
 */
export const CARD_SUMMARY_MAX_LENGTH = 180;

/** Coupe un resume sans casser un mot, et signale la coupure. */
export function cardSummary(summary: string | null): string | null {
  if (summary === null) {
    return null;
  }
  const text = summary.replace(/\s+/gu, " ").trim();
  if (text === "") {
    return null;
  }
  if (text.length <= CARD_SUMMARY_MAX_LENGTH) {
    return text;
  }
  const cut = text.slice(0, CARD_SUMMARY_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Etat d'amorcage affiche sur une carte.
 *
 * Aucune seconde machine a etats : des que `TASK-000` existe, c'est **son**
 * statut qui s'affiche, avec le libelle deja utilise partout ailleurs. Son
 * absence se dit « Not prepared », qui est un fait et non une erreur.
 */
export function bootstrapCardLabel(bootstrapStatus: TaskStatus | null): string {
  return bootstrapStatus === null ? "Not prepared" : taskStatusLabel(bootstrapStatus);
}

/** « 6 Tasks », « 1 Task », « 0 Tasks » — jamais un etat vide technique. */
export function taskTotalLabel(total: number): string {
  return `${String(total)} ${total === 1 ? "Task" : "Tasks"}`;
}

/**
 * Phrase d'attente, ou `null` si rien n'attend.
 *
 * Un signalement, pas un ordonnanceur : le tableau de bord dit qu'une tache
 * prete ne peut pas demarrer, il ne choisit pas laquelle lancer.
 */
export function waitingLabel(count: number): string | null {
  if (count === 0) {
    return null;
  }
  return count === 1
    ? "1 tâche prête attend une dépendance"
    : `${String(count)} tâches prêtes attendent une dépendance`;
}

/**
 * Ce qu'un projet fait, en une valeur.
 *
 * L'ordre des questions est celui de l'urgence de lecture : ce qui tourne, puis
 * ce qui attend un humain, puis ce qui attend Git, puis l'etat de la file. Il
 * n'y a aucune autorite ici — la carte decrit, elle n'ordonnance pas, et ce
 * qu'elle affiche pour un projet ne dit rien des autres.
 */
export function projectExecutionBadge(facts: ProjectCardFacts): ProjectExecutionBadge {
  if (facts.activeRun !== null) {
    return facts.activeRun.isCorrection
      ? {
          state: PROJECT_EXECUTION_STATE.CORRECTING,
          label: "Correcting",
          detail: facts.activeRun.taskCode,
        }
      : {
          state: PROJECT_EXECUTION_STATE.RUNNING,
          label: "Claude running",
          detail: facts.activeRun.taskCode,
        };
  }

  if (facts.validating) {
    return { state: PROJECT_EXECUTION_STATE.VALIDATING, label: "Validating", detail: null };
  }

  if (facts.taskCounts[TASK_STATUS.REVIEW] > 0) {
    return {
      state: PROJECT_EXECUTION_STATE.WAITING_REVIEW,
      label: "Waiting for human validation",
      detail: null,
    };
  }

  if (facts.blockingDelivery !== null) {
    return {
      state: PROJECT_EXECUTION_STATE.WAITING_DELIVERY,
      label: "Git delivery pending",
      detail: facts.blockingDelivery.taskCode,
    };
  }

  if (facts.taskCounts[TASK_STATUS.FAILED] > 0 || facts.taskCounts[TASK_STATUS.BLOCKED] > 0) {
    return { state: PROJECT_EXECUTION_STATE.BLOCKED, label: "Blocked", detail: null };
  }

  if (facts.queuedCount > 0) {
    return facts.queueActive
      ? { state: PROJECT_EXECUTION_STATE.QUEUE_ACTIVE, label: "Queue active", detail: null }
      : { state: PROJECT_EXECUTION_STATE.QUEUE_PAUSED, label: "Queue paused", detail: null };
  }

  return { state: PROJECT_EXECUTION_STATE.IDLE, label: "Idle", detail: null };
}

/**
 * Resume derive de plusieurs projets.
 *
 * Aucun etat nouveau : trois comptages sur des cartes deja construites. Il
 * repond a la seule question qu'une liste de cartes ne repond pas d'un coup
 * d'oeil quand elle s'allonge — combien travaillent, et combien m'attendent.
 */
export type ExecutionSummary = {
  projects: number;
  /** Projets sur lesquels Claude Code travaille en ce moment. */
  running: number;
  /** Projets dont une file porte une autorisation permanente. */
  activeQueues: number;
  /** Projets qui attendent un geste humain. */
  waitingForHuman: number;
};

export function executionSummary(cards: readonly ProjectCard[]): ExecutionSummary {
  const running = cards.filter(
    (card) =>
      card.execution.state === PROJECT_EXECUTION_STATE.RUNNING ||
      card.execution.state === PROJECT_EXECUTION_STATE.CORRECTING,
  ).length;
  const waitingForHuman = cards.filter(
    (card) =>
      card.execution.state === PROJECT_EXECUTION_STATE.WAITING_REVIEW ||
      card.execution.state === PROJECT_EXECUTION_STATE.WAITING_DELIVERY ||
      card.execution.state === PROJECT_EXECUTION_STATE.BLOCKED,
  ).length;

  return {
    projects: cards.length,
    running,
    activeQueues: cards.filter((card) => card.queueActive).length,
    waitingForHuman,
  };
}

/** Construit la carte d'un projet a partir de ses faits derives. */
export function projectCard(
  project: {
    id: string;
    name: string;
    status: ProjectStatus;
    repositoryPath: string;
    updatedAt: Date;
  },
  facts: ProjectCardFacts,
): ProjectCard {
  const lastActivityAt =
    facts.lastTaskActivityAt !== null && facts.lastTaskActivityAt > project.updatedAt
      ? facts.lastTaskActivityAt
      : project.updatedAt;

  return {
    id: project.id,
    name: project.name,
    status: project.status,
    repositoryPath: project.repositoryPath,
    summary: cardSummary(facts.briefSummary),
    taskTotal: facts.taskTotal,
    breakdown: taskBreakdown(facts.taskCounts),
    bootstrapLabel: bootstrapCardLabel(facts.bootstrapStatus),
    waitingOnDependencies: facts.readyWaitingOnDependencies,
    queuedCount: facts.queuedCount,
    queueActive: facts.queueActive,
    execution: projectExecutionBadge(facts),
    deliveryLabel: deliveryPolicyLabel(facts.deliveryPolicy),
    lastActivityAt,
  };
}

/**
 * Ordonne les cartes, de la plus recemment active a la plus ancienne.
 *
 * L'activite retenue combine la ligne du projet et ses taches : `updatedAt` seul
 * ne bougerait pas quand une execution change le statut d'une tache, et le
 * projet le plus travaille de la semaine se retrouverait en bas. A egalite —
 * deux projets crees dans la meme seconde — le nom tranche, pour que l'ordre
 * reste le meme d'un rendu a l'autre.
 */
export function sortProjectCards(cards: readonly ProjectCard[]): ProjectCard[] {
  return [...cards].sort((left, right) => {
    const delta = right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
    return delta !== 0 ? delta : left.name.localeCompare(right.name);
  });
}
