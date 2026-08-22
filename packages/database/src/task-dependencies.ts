/**
 * Acces aux dependances entre taches.
 *
 * ## La convention, rappelee une derniere fois
 *
 * `taskId` **attend** `dependsOnTaskId`. Toutes les requetes de ce module
 * suivent ce sens ; les inverser produirait un graphe correct en apparence qui
 * bloquerait exactement les mauvaises taches.
 *
 * ## Le cycle se verifie dans la transaction, apres l'ecriture
 *
 * Une verification faite **avant** l'insertion, meme dans une transaction, se
 * fait sur un etat qui a pu changer : deux requetes simultanees lisent chacune
 * un graphe sans cycle, puis ecrivent chacune une arete, et le graphe final en
 * contient un.
 *
 * L'ordre retenu est donc l'inverse : on ecrit l'arete d'abord, on relit le
 * graphe **complet** ensuite, et on annule si un cycle apparait. La premiere
 * ecriture prend le verrou d'ecriture de SQLite ; la seconde transaction ne peut
 * donc ni s'intercaler, ni lire un etat anterieur a la premiere. Ce que la
 * seconde relit contient l'arete de la premiere, et son cycle est vu.
 *
 * C'est la plus petite strategie sure compatible avec le projet : aucun verrou
 * applicatif, aucune colonne de version, aucune table de fermeture transitive.
 * Elle repose sur ce que SQLite garantit deja.
 */

import {
  TASK_DEPENDENCY_ERROR,
  checkTaskDependencyPair,
  dependencyPathExists,
  formatTaskCode,
  isTaskKind,
  isTaskStatus,
  type TaskDependencyEdge,
  type TaskDependencyErrorCode,
  type TaskDependencyRef,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Surface minimale utilisee a l'interieur d'une transaction. */
export type DependencyWriteClient = Pick<DatabaseClient, "task" | "taskDependency" | "run">;

export type AddDependencyResult =
  | { ok: true; created: boolean }
  | { ok: false; code: TaskDependencyErrorCode };

export type RemoveDependencyResult =
  | { ok: true; removed: boolean }
  | { ok: false; code: TaskDependencyErrorCode };

type EndpointRow = {
  id: string;
  projectId: string;
  sequence: number;
  kind: string;
  title: string;
  status: string;
};

const ENDPOINT_SELECT = {
  id: true,
  projectId: true,
  sequence: true,
  kind: true,
  title: true,
  status: true,
} as const;

/**
 * Traduit une ligne en reference metier.
 *
 * Les chaines stockees sont revalidees, comme partout ailleurs : une base
 * modifiee a la main ne doit pas propager un statut inconnu jusqu'a l'interface.
 * Une valeur illisible fait echouer la lecture, elle n'est jamais devinee.
 */
function toRef(row: EndpointRow): TaskDependencyRef {
  if (!isTaskStatus(row.status)) {
    throw new Error(`Tache ${row.id} : statut "${row.status}" inconnu.`);
  }
  if (!isTaskKind(row.kind)) {
    throw new Error(`Tache ${row.id} : nature "${row.kind}" inconnue.`);
  }
  return {
    id: row.id,
    code: formatTaskCode(row.sequence),
    title: row.title,
    status: row.status,
    kind: row.kind,
  };
}

/**
 * Verifications semantiques, faites sur des lignes relues dans la transaction.
 *
 * Le navigateur envoie deux identifiants ; tout le reste — projet, nature,
 * existence — se relit ici. Un identifiant forge ne peut donc pas franchir une
 * frontiere de projet.
 */
async function checkEndpoints(
  tx: DependencyWriteClient,
  projectId: string,
  taskId: string,
  dependsOnTaskId: string,
): Promise<{ ok: true; task: EndpointRow; dependsOn: EndpointRow } | { ok: false; code: TaskDependencyErrorCode }> {
  if (taskId === dependsOnTaskId) {
    return { ok: false, code: TASK_DEPENDENCY_ERROR.SELF };
  }

  const [task, dependsOn] = await Promise.all([
    tx.task.findFirst({ where: { id: taskId, projectId }, select: ENDPOINT_SELECT }),
    tx.task.findUnique({ where: { id: dependsOnTaskId }, select: ENDPOINT_SELECT }),
  ]);

  // La tache qui attend est cherchee **dans** le projet : une tache d'un autre
  // projet est introuvable, exactement comme une tache inexistante.
  if (task === null) {
    return { ok: false, code: TASK_DEPENDENCY_ERROR.UNKNOWN_TASK };
  }
  if (dependsOn === null) {
    return { ok: false, code: TASK_DEPENDENCY_ERROR.UNKNOWN_TASK };
  }
  // La cible, elle, est cherchee sans filtre de projet, precisement pour pouvoir
  // distinguer « n'existe pas » de « appartient a un autre projet ». Les deux
  // refusent, mais ils n'apprennent pas la meme chose.
  if (dependsOn.projectId !== task.projectId) {
    return { ok: false, code: TASK_DEPENDENCY_ERROR.CROSS_PROJECT };
  }

  // La regle de nature vit dans `@nox/shared`, ou elle est testee sans base. Ici
  // on ne fait que lui passer ce qui vient d'etre relu.
  const pair = checkTaskDependencyPair({
    task: { id: task.id, projectId: task.projectId, kind: toRef(task).kind },
    dependsOn: {
      id: dependsOn.id,
      projectId: dependsOn.projectId,
      kind: toRef(dependsOn).kind,
    },
  });
  if (pair !== null) {
    return { ok: false, code: pair };
  }

  return { ok: true, task, dependsOn };
}

/** Toutes les aretes d'un projet, sous la forme que le detecteur de cycle attend. */
export async function readProjectDependencyEdges(
  tx: DependencyWriteClient,
  projectId: string,
): Promise<TaskDependencyEdge[]> {
  const rows = await tx.taskDependency.findMany({
    where: { task: { projectId } },
    select: { taskId: true, dependsOnTaskId: true },
  });
  return rows.map((row) => ({ taskId: row.taskId, dependsOnTaskId: row.dependsOnTaskId }));
}

/**
 * Une tache possede-t-elle un historique d'execution ?
 *
 * Relu dans la transaction : la verification de l'appelant a pu etre faite avant
 * qu'une execution ne demarre.
 */
async function isFrozen(tx: DependencyWriteClient, taskId: string): Promise<boolean> {
  const runs = await tx.run.count({ where: { taskId } });
  return runs > 0;
}

/**
 * Ajoute « taskId attend dependsOnTaskId ».
 *
 * Idempotent : ajouter deux fois la meme arete rend `created: false`, sans
 * erreur. Un double-clic n'est pas une faute de l'utilisateur.
 */
export async function addTaskDependency(
  db: DatabaseClient,
  input: { projectId: string; taskId: string; dependsOnTaskId: string },
): Promise<AddDependencyResult> {
  return db.$transaction(async (tx): Promise<AddDependencyResult> => {
    const endpoints = await checkEndpoints(tx, input.projectId, input.taskId, input.dependsOnTaskId);
    if (!endpoints.ok) {
      return endpoints;
    }

    if (await isFrozen(tx, input.taskId)) {
      return { ok: false, code: TASK_DEPENDENCY_ERROR.FROZEN };
    }

    const existing = await tx.taskDependency.findUnique({
      where: {
        taskId_dependsOnTaskId: {
          taskId: input.taskId,
          dependsOnTaskId: input.dependsOnTaskId,
        },
      },
      select: { id: true },
    });
    if (existing !== null) {
      return { ok: true, created: false };
    }

    // Ecrire d'abord. C'est cette ecriture qui prend le verrou d'ecriture, et
    // c'est elle qui rend la relecture suivante fiable.
    await tx.taskDependency.create({
      data: { taskId: input.taskId, dependsOnTaskId: input.dependsOnTaskId },
    });

    const edges = await readProjectDependencyEdges(tx, input.projectId);
    if (hasAnyCycle(edges)) {
      // Annule toute la transaction : l'arete ecrite juste au-dessus disparait
      // avec elle. Rien n'est « repare » a la main.
      throw new DependencyCycleError();
    }

    return { ok: true, created: true };
  }).catch((error: unknown): AddDependencyResult => {
    if (error instanceof DependencyCycleError) {
      return { ok: false, code: TASK_DEPENDENCY_ERROR.CYCLE };
    }
    throw error;
  });
}

/**
 * Signal interne d'annulation.
 *
 * Une exception plutot qu'un retour, parce que c'est le seul moyen de faire
 * annuler une transaction interactive Prisma : un retour, meme en echec, la
 * valide.
 */
class DependencyCycleError extends Error {
  constructor() {
    super("Cette dependance creerait un cycle.");
    this.name = "DependencyCycleError";
  }
}

/**
 * Le graphe contient-il un cycle, ou que ce soit ?
 *
 * Pose la question sur le graphe **entier** plutot que sur l'arete qu'on vient
 * d'ajouter. C'est ce qui rend la verification correcte sous concurrence : la
 * transaction perdante voit l'arete de la gagnante, meme si son propre ajout,
 * pris isolement, ne fermait rien.
 */
export function hasAnyCycle(edges: readonly TaskDependencyEdge[]): boolean {
  // Pour chaque arete « A attend B », existe-t-il un chemin qui ramene de B a A ?
  // L'arete elle-meme n'aide pas a repondre oui — elle mene de A vers B, pas
  // l'inverse — donc la parcourir avec le graphe complet est correct.
  return edges.some((edge) => dependencyPathExists(edges, edge.dependsOnTaskId, edge.taskId));
}

/** Retire une arete. Idempotent : une arete absente est une reussite. */
export async function removeTaskDependency(
  db: DatabaseClient,
  input: { projectId: string; taskId: string; dependsOnTaskId: string },
): Promise<RemoveDependencyResult> {
  return db.$transaction(async (tx): Promise<RemoveDependencyResult> => {
    const task = await tx.task.findFirst({
      where: { id: input.taskId, projectId: input.projectId },
      select: { id: true },
    });
    if (task === null) {
      return { ok: false, code: TASK_DEPENDENCY_ERROR.UNKNOWN_TASK };
    }

    if (await isFrozen(tx, input.taskId)) {
      return { ok: false, code: TASK_DEPENDENCY_ERROR.FROZEN };
    }

    const deleted = await tx.taskDependency.deleteMany({
      where: { taskId: input.taskId, dependsOnTaskId: input.dependsOnTaskId },
    });
    return { ok: true, removed: deleted.count > 0 };
  });
}

/** Ce que la page d'une tache affiche : les deux sens du graphe. */
export type TaskDependencyRows = {
  dependsOn: TaskDependencyRef[];
  dependents: TaskDependencyRef[];
};

/**
 * Dependances et dependants d'une tache, ordonnes par code.
 *
 * L'ordre est celui des numeros, pas celui de la creation des aretes : c'est
 * celui dans lequel l'utilisateur lit son backlog, et il ne change pas quand on
 * retire puis rajoute une dependance.
 */
export async function listTaskDependencies(
  db: DatabaseClient,
  taskId: string,
): Promise<TaskDependencyRows> {
  const [outgoing, incoming] = await Promise.all([
    db.taskDependency.findMany({
      where: { taskId },
      select: { dependsOn: { select: ENDPOINT_SELECT } },
    }),
    db.taskDependency.findMany({
      where: { dependsOnTaskId: taskId },
      select: { task: { select: ENDPOINT_SELECT } },
    }),
  ]);

  const bySequence = (left: TaskDependencyRef, right: TaskDependencyRef): number =>
    left.code.localeCompare(right.code);

  return {
    dependsOn: outgoing.map((row) => toRef(row.dependsOn)).sort(bySequence),
    dependents: incoming.map((row) => toRef(row.task)).sort(bySequence),
  };
}

/** Identifiants des taches attendues par une tache, dans l'ordre des codes. */
export async function listDependencyIds(
  db: DatabaseClient,
  taskId: string,
): Promise<string[]> {
  const rows = await db.taskDependency.findMany({
    where: { taskId },
    select: { dependsOn: { select: { id: true, sequence: true } } },
  });
  return rows
    .sort((left, right) => left.dependsOn.sequence - right.dependsOn.sequence)
    .map((row) => row.dependsOn.id);
}

/** Compteurs de dependances de chaque tache d'un projet, pour la liste. */
export type ProjectDependencyCounts = Map<string, { total: number; unresolved: number }>;

/**
 * Compte, pour chaque tache d'un projet, ses dependances et celles qui attendent.
 *
 * Une requete plutot qu'une par tache : la liste en affiche autant qu'il y en a,
 * et rien ici n'est persiste — les compteurs se recalculent a chaque rendu.
 */
export async function countProjectDependencies(
  db: DatabaseClient,
  projectId: string,
): Promise<ProjectDependencyCounts> {
  const rows = await db.taskDependency.findMany({
    where: { task: { projectId } },
    select: { taskId: true, dependsOn: { select: { status: true } } },
  });

  const counts: ProjectDependencyCounts = new Map();
  for (const row of rows) {
    const entry = counts.get(row.taskId) ?? { total: 0, unresolved: 0 };
    entry.total += 1;
    if (row.dependsOn.status !== "COMPLETED") {
      entry.unresolved += 1;
    }
    counts.set(row.taskId, entry);
  }
  return counts;
}

/** Taches d'un projet proposables comme dependance, ordonnees par code. */
export async function listDependencyCandidates(
  db: DatabaseClient,
  projectId: string,
): Promise<TaskDependencyRef[]> {
  const rows = await db.task.findMany({
    where: { projectId },
    select: ENDPOINT_SELECT,
    orderBy: { sequence: "asc" },
  });
  return rows.map(toRef);
}
