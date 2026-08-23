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
  type ProjectStatus,
  type TaskStatus,
} from "@nox/shared";

import { taskStatusLabel } from "./labels.ts";

/** Faits d'un projet, tels que la couche de donnees les derive. */
export type ProjectCardFacts = {
  briefSummary: string | null;
  taskCounts: Record<TaskStatus, number>;
  taskTotal: number;
  bootstrapStatus: TaskStatus | null;
  readyWaitingOnDependencies: number;
  lastTaskActivityAt: Date | null;
};

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

/**
 * Ordre d'affichage de la repartition.
 *
 * Celui du workflow, pas celui de l'alphabet ni celui de l'enum : on lit une
 * ligne de gauche a droite comme on lit l'avancement d'un projet.
 */
const BREAKDOWN_ORDER: readonly TaskStatus[] = [
  TASK_STATUS.COMPLETED,
  TASK_STATUS.REVIEW,
  TASK_STATUS.RUNNING,
  TASK_STATUS.READY,
  TASK_STATUS.DRAFT,
  TASK_STATUS.BLOCKED,
  TASK_STATUS.FAILED,
];

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

/**
 * Repartition des taches, statuts vides omis.
 *
 * Afficher « 0 Failed » sur chaque carte ferait sept colonnes de zeros et
 * noierait les deux chiffres qui comptent.
 */
export function taskBreakdown(
  counts: Record<TaskStatus, number>,
): readonly { status: TaskStatus; count: number }[] {
  return BREAKDOWN_ORDER.filter((status) => counts[status] > 0).map((status) => ({
    status,
    count: counts[status],
  }));
}

/**
 * Une entree de la repartition, en un seul morceau de texte.
 *
 * Composee ici plutot que dans le JSX : `{count} {label}` produirait trois
 * enfants React, donc des separateurs de commentaire dans le HTML rendu. La
 * pastille se lit pareil, mais son texte cesse d'etre cherchable — dans un test
 * comme dans un navigateur.
 */
export function breakdownLabel(entry: { status: TaskStatus; count: number }): string {
  return `${String(entry.count)} ${taskStatusLabel(entry.status)}`;
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
