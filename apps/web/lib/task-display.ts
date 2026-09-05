/**
 * Tons, comptages et URL des taches.
 *
 * Ce module n'importe ni Prisma, ni le client runner : il est donc utilisable
 * par un Client Component, ce que `lib/tasks.ts` ne peut pas etre.
 *
 * Les **libelles** n'y sont plus : ils vivent tous dans `lib/labels.ts` depuis
 * TASK-009. Un ton est une decision d'affichage propre aux taches ; un libelle
 * est une traduction, et il n'en existe qu'une par valeur dans tout NOX.
 */

import {
  TASK_STATUS,
  TASK_STATUSES,
  type DevelopmentTaskSummary,
  type TaskStatus,
} from "@nox/shared";

import type { BadgeTone } from "@/components/StatusBadge";

import { taskStatusLabel } from "./labels.ts";

/**
 * Ton de chaque statut de tache.
 *
 * ## Ce que le premier pilote reel a montre
 *
 * Son utilisateur devait lire chaque pastille pour savoir ou en etait son
 * projet. `COMPLETED` s'affichait `muted` — le ton le plus efface de la
 * palette — et `BLOCKED` comme `FAILED` portaient le gris `neutral` d'un statut
 * ordinaire. Une liste de taches doit se **survoler** : ce qui est fini et ce
 * qui est casse sont les deux choses qu'on y cherche, et c'etaient justement
 * les deux qui ne ressortaient pas.
 *
 * ## Pourquoi ces tons-la
 *
 * `accent` — le teal de NOX — garde un seul role : quelque chose se passe en ce
 * moment. Il reste donc a `RUNNING`, et le quitte partout ailleurs. `READY` le
 * portait aussi, ce qui faisait ressembler une tache en attente a une tache en
 * cours ; elle prend `info`, qui dit « disponible » sans dire « en train de ».
 *
 * `REVIEW` passe en `warn` parce que c'est le statut qui **demande quelque
 * chose a un humain** : c'est la seule ligne d'une liste sur laquelle
 * l'utilisateur doit agir lui-meme.
 *
 * La couleur n'est jamais seule : `StatusBadge` rend toujours le libelle, et
 * c'est lui qui distingue `Blocked` de `Failed`, que le ton confond
 * volontairement — les deux appellent la meme reaction.
 */
const STATUS_TONES: Record<TaskStatus, BadgeTone> = {
  [TASK_STATUS.DRAFT]: "muted",
  [TASK_STATUS.READY]: "info",
  [TASK_STATUS.RUNNING]: "accent",
  [TASK_STATUS.BLOCKED]: "danger",
  [TASK_STATUS.FAILED]: "danger",
  [TASK_STATUS.REVIEW]: "warn",
  [TASK_STATUS.COMPLETED]: "success",
};

export function taskStatusTone(status: TaskStatus): BadgeTone {
  return STATUS_TONES[status];
}

/**
 * Ordre d'affichage d'une repartition par statut.
 *
 * Celui du workflow, pas celui de l'alphabet ni celui de l'enum : on lit une
 * ligne de gauche a droite comme on lit l'avancement d'un projet.
 *
 * Il vit ici — et non dans le module du tableau de bord, ou il a ete ecrit —
 * parce que la page d'accueil et la liste des taches affichent desormais la
 * meme repartition. Deux ordres pour la meme information finiraient par
 * diverger, et deux ecrans raconteraient alors deux avancements differents.
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

/**
 * L'avancement d'un projet, en une ligne : « 3 Done · 1 Running · 4 Draft ».
 *
 * Derivee des taches reelles a chaque rendu, comme tout le reste : aucun
 * compteur n'est stocke, et il ne doit pas en apparaitre. Un total mis en cache
 * deviendrait faux a la premiere tache rouverte, et le seul moyen de s'en
 * apercevoir serait de le recalculer.
 *
 * `null` quand le projet n'a aucune tache : une ligne vide sous un titre
 * n'apprend rien que la liste vide juste en dessous ne dise deja.
 */
export function taskSummaryLine(counts: Record<TaskStatus, number>): string | null {
  const parts = taskBreakdown(counts).map(breakdownLabel);
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * Compte les taches par statut.
 *
 * Tous les statuts sont presents, y compris a zero : une table complete evite a
 * l'appelant de distinguer « aucune tache bloquee » de « statut inconnu ».
 */
export function countTasksByStatus(
  tasks: readonly DevelopmentTaskSummary[],
): Record<TaskStatus, number> {
  const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
    TaskStatus,
    number
  >;
  for (const task of tasks) {
    counts[task.status] += 1;
  }
  return counts;
}

/**
 * Lit un statut depuis un parametre d'URL.
 *
 * Une valeur inconnue — ou repetee — ne leve pas : elle est simplement ignoree,
 * et le backlog s'affiche sans filtre. Un lien errone ne doit pas produire une
 * page d'erreur.
 */
export function readStatusFilter(value: string | string[] | undefined): TaskStatus | null {
  if (typeof value !== "string") {
    return null;
  }
  return (TASK_STATUSES as readonly string[]).includes(value) ? (value as TaskStatus) : null;
}

/** URL de la page de detail d'une tache. */
export function taskUrl(projectId: string, taskId: string): string {
  return `/projects/${projectId}/tasks/${taskId}`;
}

/** URL du backlog, eventuellement filtre par statut. */
export function backlogUrl(projectId: string, status: TaskStatus | null = null): string {
  const base = `/projects/${projectId}/tasks`;
  return status === null ? base : `${base}?status=${status}`;
}

/**
 * URL de l'editeur d'une tache future.
 *
 * Construite cote serveur a partir de deux identifiants, comme toutes les
 * autres : aucune URL ne voyage depuis le navigateur.
 */
export function taskEditUrl(projectId: string, taskId: string): string {
  return `${taskUrl(projectId, taskId)}/edit`;
}
