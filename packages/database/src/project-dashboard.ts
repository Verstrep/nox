/**
 * Donnees du tableau de bord des projets.
 *
 * ## Une lecture, pas un etat
 *
 * Rien de ce que ce module retourne n'est stocke : ni compteur de taches, ni
 * etat d'amorcage, ni « progression ». Tout se derive des lignes existantes a
 * chaque rendu. Un statut change, et la carte suit — sans qu'aucune ecriture
 * n'ait eu lieu, et sans qu'un compteur puisse mentir apres une reouverture.
 *
 * ## Pourquoi des requetes groupees
 *
 * Une requete par projet ferait N+1 : quatre requetes pour dix projets, puis
 * quarante pour cent. Les quatre requetes ci-dessous sont globales et
 * regroupees en memoire. Le tableau de bord reste donc a cout constant, ce qui
 * lui permet aussi de ne rien paginer.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne lit aucun repository, n'interroge pas le runner, et n'appelle aucun
 * fournisseur. Ouvrir la page d'accueil ne coute rien d'autre que SQLite.
 */

import {
  BOOTSTRAP_TASK_SEQUENCE,
  TASK_STATUS,
  TASK_STATUSES,
  isTaskStatus,
  type TaskStatus,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Ce qu'une carte de projet affiche, entierement derive. */
export type ProjectDashboardFacts = {
  projectId: string;
  /** Resume du brief, ou `null` si aucun brief n'est defini. */
  briefSummary: string | null;
  /** Nombre de taches par statut, tous les statuts presents. */
  taskCounts: Record<TaskStatus, number>;
  taskTotal: number;
  /** Statut de `TASK-000`, ou `null` si l'amorcage n'a pas ete prepare. */
  bootstrapStatus: TaskStatus | null;
  /**
   * Taches `READY` dont au moins une dependance n'est pas terminee.
   *
   * Le tableau de bord le signale, il ne l'ordonnance pas : la file arrivera
   * avec sa propre tache.
   */
  readyWaitingOnDependencies: number;
  /**
   * Derniere modification d'une tache du projet, ou `null` s'il n'en a aucune.
   *
   * Combinee a `Project.updatedAt` par l'appelant, elle donne une « derniere
   * activite » honnete : lancer une execution, la relire ou l'accepter change le
   * statut d'une tache, donc sa date — alors que la ligne du projet, elle, ne
   * bouge pas.
   */
  lastTaskActivityAt: Date | null;
};

function emptyCounts(): Record<TaskStatus, number> {
  return Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
    TaskStatus,
    number
  >;
}

/**
 * Retourne les faits de chaque projet, indexes par identifiant.
 *
 * Un projet sans tache, sans brief et sans amorcage possede quand meme son
 * entree : « absent » est une reponse, pas une donnee manquante.
 */
export async function loadProjectDashboardFacts(
  db: DatabaseClient,
  projectIds: readonly string[],
): Promise<Map<string, ProjectDashboardFacts>> {
  const facts = new Map<string, ProjectDashboardFacts>();
  for (const projectId of projectIds) {
    facts.set(projectId, {
      projectId,
      briefSummary: null,
      taskCounts: emptyCounts(),
      taskTotal: 0,
      bootstrapStatus: null,
      readyWaitingOnDependencies: 0,
      lastTaskActivityAt: null,
    });
  }

  if (projectIds.length === 0) {
    return facts;
  }

  const ids = [...projectIds];

  const briefs = await db.projectBrief.findMany({
    where: { projectId: { in: ids } },
    select: { projectId: true, summary: true },
  });
  for (const brief of briefs) {
    const entry = facts.get(brief.projectId);
    if (entry !== undefined) {
      entry.briefSummary = brief.summary;
    }
  }

  const tasks = await db.task.findMany({
    where: { projectId: { in: ids } },
    select: { id: true, projectId: true, sequence: true, status: true, updatedAt: true },
  });

  // Les statuts sont revalides a la relecture, comme partout ailleurs : une
  // base modifiee a la main ne doit pas propager une valeur inconnue jusqu'a
  // une carte. Une ligne illisible est ignoree plutot que de faire echouer la
  // page d'accueil entiere.
  const statusById = new Map<string, TaskStatus>();
  for (const task of tasks) {
    if (!isTaskStatus(task.status)) {
      continue;
    }
    statusById.set(task.id, task.status);
    const entry = facts.get(task.projectId);
    if (entry === undefined) {
      continue;
    }
    entry.taskCounts[task.status] += 1;
    entry.taskTotal += 1;
    if (task.sequence === BOOTSTRAP_TASK_SEQUENCE) {
      entry.bootstrapStatus = task.status;
    }
    if (entry.lastTaskActivityAt === null || task.updatedAt > entry.lastTaskActivityAt) {
      entry.lastTaskActivityAt = task.updatedAt;
    }
  }

  // Les aretes des projets affiches, en une requete. Seul `COMPLETED` satisfait
  // une dependance : c'est la meme regle qu'ailleurs, appliquee ici sur les
  // statuts qu'on vient de lire.
  const edges = await db.taskDependency.findMany({
    where: { task: { projectId: { in: ids } } },
    select: { taskId: true, dependsOnTaskId: true, task: { select: { projectId: true } } },
  });

  const waitingTaskIds = new Map<string, string>();
  for (const edge of edges) {
    if (statusById.get(edge.taskId) !== TASK_STATUS.READY) {
      continue;
    }
    if (statusById.get(edge.dependsOnTaskId) === TASK_STATUS.COMPLETED) {
      continue;
    }
    waitingTaskIds.set(edge.taskId, edge.task.projectId);
  }
  for (const projectId of waitingTaskIds.values()) {
    const entry = facts.get(projectId);
    if (entry !== undefined) {
      entry.readyWaitingOnDependencies += 1;
    }
  }

  return facts;
}
