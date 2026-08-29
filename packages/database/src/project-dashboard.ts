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
 * Une requete par projet ferait N+1 : cinq requetes pour cinq projets, puis
 * cinquante pour cinquante. Les requetes ci-dessous sont globales et regroupees
 * en memoire — leur nombre ne depend pas du nombre de projets. Le tableau de
 * bord reste donc a cout constant, ce qui lui permet aussi de ne rien paginer.
 *
 * ## Plusieurs projets peuvent travailler en meme temps
 *
 * Depuis TASK-031, « une execution en cours » n'est plus un fait global : c'est
 * un fait **par projet**, et plusieurs cartes peuvent l'afficher simultanement.
 * Les faits d'execution ci-dessous sont donc lus en lots, comme le reste, et
 * rattaches chacun a son projet — jamais reduits a une execution courante.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne lit aucun repository, n'interroge pas le runner, et n'appelle aucun
 * fournisseur. Ouvrir la page d'accueil ne coute rien d'autre que SQLite.
 */

import {
  ACTIVE_RUN_STATUSES,
  BOOTSTRAP_TASK_SEQUENCE,
  RUN_KIND,
  TASK_STATUS,
  TASK_STATUSES,
  VALIDATION_BATCH_STATUS,
  deliverySatisfied,
  formatTaskCode,
  isTaskStatus,
  policyAllowsAutomatic,
  readDeliveryPolicy,
  readDeliveryStatus,
  type DeliveryPolicy,
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
  /** Nombre de taches inscrites dans la file d'execution du projet. */
  queuedCount: number;
  /** L'autorisation permanente de la file est-elle ouverte ? */
  queueActive: boolean;
  /**
   * Execution Claude Code active dans ce projet, s'il y en a une.
   *
   * Plusieurs projets peuvent en avoir une au meme instant : l'exclusion porte
   * sur le repository, pas sur NOX. Aucune de ces executions n'est « la »
   * execution courante.
   */
  activeRun: ProjectActiveRunFacts | null;
  /** Un lot de validation autonome tourne-t-il dans ce projet ? */
  validating: boolean;
  /** Ce que ce projet autorise NOX a ecrire dans Git. */
  deliveryPolicy: DeliveryPolicy;
  /**
   * Livraison Git qui empeche ce projet d'avancer, s'il y en a une.
   *
   * Derivee exactement comme le refus de la file — meme regle, meme lecture :
   * un blocage Git dans un projet n'a aucun effet sur les autres.
   */
  blockingDelivery: ProjectBlockingDeliveryFacts | null;
};

/** Ce qu'on dit d'une execution active sur une carte. */
export type ProjectActiveRunFacts = {
  runId: string;
  taskId: string;
  taskCode: string;
  /** Une correction est une execution comme une autre, mais elle se dit. */
  isCorrection: boolean;
};

/** Ce qu'on dit d'une livraison qui bloque, sur une carte. */
export type ProjectBlockingDeliveryFacts = {
  taskId: string;
  taskCode: string;
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
      queuedCount: 0,
      queueActive: false,
      activeRun: null,
      validating: false,
      deliveryPolicy: readDeliveryPolicy(undefined),
      blockingDelivery: null,
    });
  }

  if (projectIds.length === 0) {
    return facts;
  }

  const ids = [...projectIds];

  // L'etat de la file vient de la ligne du projet et d'un comptage groupe :
  // aucune sonde, aucun preflight. Le tableau de bord dit combien de taches
  // attendent, il ne demande pas au runner si elles pourraient partir.
  const projects = await db.project.findMany({
    where: { id: { in: ids } },
    select: { id: true, executionQueueActive: true, deliveryPolicy: true },
  });
  for (const project of projects) {
    const entry = facts.get(project.id);
    if (entry !== undefined) {
      entry.queueActive = project.executionQueueActive;
      // Une valeur illisible est relue `MANUAL` : le defaut sur n'accorde rien,
      // y compris dans ce qu'une carte affiche.
      entry.deliveryPolicy = readDeliveryPolicy(project.deliveryPolicy);
    }
  }

  const queued = await db.taskQueueEntry.groupBy({
    by: ["projectId"],
    where: { projectId: { in: ids } },
    _count: { _all: true },
  });
  for (const row of queued) {
    const entry = facts.get(row.projectId);
    if (entry !== undefined) {
      entry.queuedCount = row._count._all;
    }
  }

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

  await loadExecutionFacts(db, ids, facts);

  return facts;
}

/**
 * Ce qui travaille en ce moment, projet par projet.
 *
 * Trois requetes groupees, quel que soit le nombre de projets : une pour les
 * executions actives, une pour les lots de validation en cours, une pour les
 * livraisons. Une requete par projet ferait exactement le N+1 que le reste de ce
 * module evite.
 */
async function loadExecutionFacts(
  db: DatabaseClient,
  ids: readonly string[],
  facts: Map<string, ProjectDashboardFacts>,
): Promise<void> {
  const runs = await db.run.findMany({
    where: {
      task: { projectId: { in: [...ids] } },
      status: { in: [...ACTIVE_RUN_STATUSES] },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      task: { select: { id: true, projectId: true, sequence: true } },
    },
  });
  for (const run of runs) {
    const entry = facts.get(run.task.projectId);
    // La premiere trouvee est conservee : l'exclusion garantit deja qu'il n'y en
    // a qu'une par repository, et en afficher une autre serait arbitraire.
    if (entry === undefined || entry.activeRun !== null) {
      continue;
    }
    entry.activeRun = {
      runId: run.id,
      taskId: run.task.id,
      taskCode: formatTaskCode(run.task.sequence),
      isCorrection: run.kind === RUN_KIND.CORRECTION,
    };
  }

  const batches = await db.autonomousValidationBatch.findMany({
    where: {
      status: { in: [VALIDATION_BATCH_STATUS.PENDING, VALIDATION_BATCH_STATUS.RUNNING] },
      run: { task: { projectId: { in: [...ids] } } },
    },
    select: { run: { select: { task: { select: { projectId: true } } } } },
  });
  for (const batch of batches) {
    const entry = facts.get(batch.run.task.projectId);
    if (entry !== undefined) {
      entry.validating = true;
    }
  }

  const deliveries = await db.gitDelivery.findMany({
    where: { projectId: { in: [...ids] } },
    orderBy: { createdAt: "desc" },
    select: {
      projectId: true,
      policy: true,
      status: true,
      task: { select: { id: true, sequence: true } },
    },
  });
  const seen = new Set<string>();
  for (const delivery of deliveries) {
    // Seule la plus recente compte, exactement comme pour le refus de la file :
    // deux lectures qui divergeraient feraient dire a la carte autre chose qu'a
    // la file.
    if (seen.has(delivery.projectId)) {
      continue;
    }
    seen.add(delivery.projectId);

    const policy = readDeliveryPolicy(delivery.policy);
    // `MANUAL` ne bloque jamais : ce mode confie la question au preflight Git,
    // et `deliverySatisfied` y rend deliberement `false` pour dire « NOX n'a
    // rien ecrit », ce qui n'est pas « la file doit attendre ».
    if (!policyAllowsAutomatic(policy)) {
      continue;
    }
    if (deliverySatisfied(policy, readDeliveryStatus(delivery.status))) {
      continue;
    }

    const entry = facts.get(delivery.projectId);
    if (entry !== undefined) {
      entry.blockingDelivery = {
        taskId: delivery.task.id,
        taskCode: formatTaskCode(delivery.task.sequence),
      };
    }
  }
}
