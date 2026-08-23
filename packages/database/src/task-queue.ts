/**
 * Persistance de la file d'execution d'un projet.
 *
 * ## Ce que ce module garantit
 *
 * Qu'une tache n'apparait qu'une fois dans une file, y compris sous deux clics
 * simultanes — la garantie est l'index unique du schema, pas une lecture suivie
 * d'une ecriture. Que deux inscriptions concurrentes obtiennent deux positions
 * distinctes, parce que la position vient d'un compteur reserve
 * transactionnellement et non d'un `MAX(sequence) + 1`. Et que l'ordre de la
 * file reste stable : un deplacement echange deux positions, il ne renumerote
 * rien.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il ne lance rien. Aucune fonction de ce fichier n'appelle le runner, ne
 * construit un prompt, ni ne cree une execution : la file enregistre une
 * intention, le dispatcher cote web decide, et le pipeline existant execute.
 */

import {
  ACTIVE_RUN_STATUSES,
  EXECUTION_QUEUE_ERROR,
  checkQueueCandidate,
  formatTaskCode,
  isTaskKind,
  isTaskStatus,
  type ExecutionQueueErrorCode,
  type QueueMoveDirection,
  type TaskDependencyRef,
  type TaskStatus,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Une entree de file, telle qu'elle est lue en base. */
export type TaskQueueEntryRow = {
  taskId: string;
  code: string;
  title: string;
  sequence: number;
  status: TaskStatus;
  /** Dependances de cette tache, avec leur statut courant. */
  dependsOn: readonly TaskDependencyRef[];
  /**
   * Une execution est deja nee de cette inscription.
   *
   * Persiste, parce que le statut ne suffit pas : une tache rouverte redevient
   * `READY` et redeviendrait indiscernable d'une tache jamais lancee — y compris
   * apres un redemarrage du serveur, ou aucune memoire de processus ne survit.
   */
  started: boolean;
};

export type QueueOperationResult =
  | { ok: true; created: boolean }
  | { ok: false; code: ExecutionQueueErrorCode };

/**
 * Contenu de la file d'un projet, ordonne.
 *
 * Une seule requete pour les entrees, une seule pour toutes leurs dependances :
 * une file de dix taches ne fait pas onze allers-retours.
 */
export async function listQueueEntries(
  db: DatabaseClient,
  projectId: string,
): Promise<TaskQueueEntryRow[]> {
  const rows = await db.taskQueueEntry.findMany({
    where: { projectId },
    orderBy: { sequence: "asc" },
    select: {
      sequence: true,
      startedAt: true,
      task: { select: { id: true, sequence: true, title: true, status: true } },
    },
  });

  if (rows.length === 0) {
    return [];
  }

  const taskIds = rows.map((row) => row.task.id);
  const edges = await db.taskDependency.findMany({
    where: { taskId: { in: taskIds } },
    orderBy: { dependsOn: { sequence: "asc" } },
    select: {
      taskId: true,
      dependsOn: { select: { id: true, sequence: true, title: true, status: true, kind: true } },
    },
  });

  const byTask = new Map<string, TaskDependencyRef[]>();
  for (const edge of edges) {
    const row = edge.dependsOn;
    if (!isTaskStatus(row.status) || !isTaskKind(row.kind)) {
      continue;
    }
    const list = byTask.get(edge.taskId) ?? [];
    list.push({
      id: row.id,
      code: formatTaskCode(row.sequence),
      title: row.title,
      status: row.status,
      kind: row.kind,
    });
    byTask.set(edge.taskId, list);
  }

  const entries: TaskQueueEntryRow[] = [];
  for (const row of rows) {
    if (!isTaskStatus(row.task.status)) {
      continue;
    }
    entries.push({
      taskId: row.task.id,
      code: formatTaskCode(row.task.sequence),
      title: row.task.title,
      sequence: row.sequence,
      status: row.task.status,
      dependsOn: byTask.get(row.task.id) ?? [],
      started: row.startedAt !== null,
    });
  }
  return entries;
}

/** Nombre d'inscriptions dans la file d'un projet. */
export function countQueueEntries(db: DatabaseClient, projectId: string): Promise<number> {
  return db.taskQueueEntry.count({ where: { projectId } });
}

/** Cette tache est-elle inscrite dans une file ? */
export async function isTaskQueued(db: DatabaseClient, taskId: string): Promise<boolean> {
  const entry = await db.taskQueueEntry.findUnique({ where: { taskId }, select: { id: true } });
  return entry !== null;
}

/** Position d'une tache dans la file de son projet, ou `null`. */
export async function queuePositionOf(
  db: DatabaseClient,
  projectId: string,
  taskId: string,
): Promise<number | null> {
  const entries = await db.taskQueueEntry.findMany({
    where: { projectId },
    orderBy: { sequence: "asc" },
    select: { taskId: true },
  });
  const index = entries.findIndex((entry) => entry.taskId === taskId);
  return index === -1 ? null : index + 1;
}

/**
 * Inscrit une tache dans la file de son projet.
 *
 * Tout est relu **dans** la transaction : le statut, la nature, l'existence
 * d'une execution active et l'appartenance a la file. Un formulaire qui aurait
 * ete rendu il y a dix minutes ne decide de rien.
 *
 * L'operation est idempotente : reinscrire une tache deja presente rend
 * `created: false` plutot qu'une erreur. C'est un double-clic, pas une faute.
 */
export async function enqueueTask(
  db: DatabaseClient,
  input: { projectId: string; taskId: string },
): Promise<QueueOperationResult> {
  return db.$transaction(async (tx): Promise<QueueOperationResult> => {
    // `projectId` fait partie du filtre : une tache d'un autre projet est
    // introuvable, exactement comme une tache inexistante.
    const task = await tx.task.findFirst({
      where: { id: input.taskId, projectId: input.projectId },
      select: { id: true, status: true, kind: true },
    });
    if (task === null || !isTaskStatus(task.status) || !isTaskKind(task.kind)) {
      return { ok: false, code: EXECUTION_QUEUE_ERROR.TASK_NOT_FOUND };
    }

    const existing = await tx.taskQueueEntry.findUnique({
      where: { taskId: input.taskId },
      select: { id: true },
    });
    const activeRuns = await tx.run.count({
      where: { taskId: input.taskId, status: { in: [...ACTIVE_RUN_STATUSES] } },
    });

    const check = checkQueueCandidate({
      status: task.status,
      kind: task.kind,
      hasActiveRun: activeRuns > 0,
      alreadyQueued: existing !== null,
    });
    if (!check.ok) {
      // Une tache deja inscrite est une reussite idempotente, pas un refus : le
      // resultat recherche — elle est dans la file — est deja atteint.
      return check.code === EXECUTION_QUEUE_ERROR.TASK_ALREADY_QUEUED
        ? { ok: true, created: false }
        : { ok: false, code: check.code };
    }

    // La position vient du compteur du projet, reserve ici. Deux inscriptions
    // simultanees obtiennent donc deux valeurs distinctes, la ou un
    // `MAX(sequence) + 1` leur aurait donne la meme.
    const reserved = await tx.project.update({
      where: { id: input.projectId },
      data: { nextQueueSequence: { increment: 1 } },
      select: { nextQueueSequence: true },
    });

    await tx.taskQueueEntry.create({
      data: {
        projectId: input.projectId,
        taskId: input.taskId,
        sequence: reserved.nextQueueSequence - 1,
      },
    });

    return { ok: true, created: true };
  });
}

/** Client minimal pour marquer une inscription, dans une transaction en cours. */
export type QueueStartWriteClient = Pick<DatabaseClient, "taskQueueEntry">;

/**
 * Note qu'une execution vient de naitre de l'inscription d'une tache.
 *
 * ## Pourquoi une seule implementation
 *
 * Deux chemins creent une execution — un lancement initial et une correction —
 * et les deux commencent le cycle d'une inscription. Deux marquages auraient
 * fini par diverger ; celui-ci est appele depuis les deux transactions, sans
 * jamais etre appele ailleurs.
 *
 * ## Pourquoi dans la transaction de l'appelant
 *
 * Parce qu'une execution creee sans marquage laisserait la file croire, apres
 * une reouverture, qu'elle a affaire a une tache jamais commencee — et la
 * relancerait. Les deux ecritures ne doivent pas pouvoir se separer.
 *
 * ## Pourquoi conditionnel
 *
 * `startedAt: null` fait partie du `where` : le premier depart date
 * l'inscription, les suivants — corrections comprises — la laissent telle
 * quelle. Aucune lecture prealable, donc aucune fenetre entre lire et ecrire.
 *
 * Une tache qui n'est pas dans une file ne met rien a jour : ce n'est pas une
 * erreur, c'est le cas ordinaire d'un lancement manuel.
 */
export async function markQueueEntryStarted(
  tx: QueueStartWriteClient,
  taskId: string,
  startedAt: Date = new Date(),
): Promise<void> {
  await tx.taskQueueEntry.updateMany({
    where: { taskId, startedAt: null },
    data: { startedAt },
  });
}

export type DequeueResult =
  | { ok: true; removed: boolean; emptied: boolean }
  | { ok: false; code: ExecutionQueueErrorCode };

/**
 * Retire une tache de la file.
 *
 * Refuse tant qu'une execution travaille sur cette tache : retirer l'entree
 * pendant qu'un processus ecrit dans le repository laisserait un travail en
 * cours que plus rien ne rattacherait a la file.
 *
 * Ne change **aucun** statut. « Cette tache ne bloque plus cette file » n'est
 * pas « cette tache est abandonnee » : elle garde son propre cycle de vie.
 *
 * Vider la file retire l'autorisation permanente : une file vide ne doit rien
 * pouvoir lancer plus tard sans un nouveau `Start queue`.
 */
export async function dequeueTask(
  db: DatabaseClient,
  input: { projectId: string; taskId: string },
): Promise<DequeueResult> {
  return db.$transaction(async (tx): Promise<DequeueResult> => {
    const entry = await tx.taskQueueEntry.findFirst({
      where: { taskId: input.taskId, projectId: input.projectId },
      select: { id: true },
    });
    if (entry === null) {
      return { ok: false, code: EXECUTION_QUEUE_ERROR.ENTRY_NOT_FOUND };
    }

    const activeRuns = await tx.run.count({
      where: { taskId: input.taskId, status: { in: [...ACTIVE_RUN_STATUSES] } },
    });
    if (activeRuns > 0) {
      return { ok: false, code: EXECUTION_QUEUE_ERROR.TASK_HAS_ACTIVE_RUN };
    }

    await tx.taskQueueEntry.delete({ where: { id: entry.id } });

    const remaining = await tx.taskQueueEntry.count({ where: { projectId: input.projectId } });
    if (remaining === 0) {
      await tx.project.update({
        where: { id: input.projectId },
        data: { executionQueueActive: false },
      });
    }

    return { ok: true, removed: true, emptied: remaining === 0 };
  });
}

export type MoveQueueResult =
  | { ok: true; moved: boolean }
  | { ok: false; code: ExecutionQueueErrorCode };

/**
 * Deplace une entree d'un cran dans la file.
 *
 * Les deux positions sont **echangees**, la file n'est pas renumerotee : les
 * valeurs de `sequence` ne sont ni contigues, ni significatives — seul leur
 * ordre l'est. Renumeroter aurait touche toutes les lignes pour deplacer une
 * seule entree.
 *
 * Une entree dont le travail est commence ne bouge pas : deplacer la barriere
 * courante ne changerait rien a ce qui est en train de se passer, et laisserait
 * croire le contraire.
 */
export async function moveQueueEntry(
  db: DatabaseClient,
  input: { projectId: string; taskId: string; direction: QueueMoveDirection },
): Promise<MoveQueueResult> {
  return db.$transaction(async (tx): Promise<MoveQueueResult> => {
    const entries = await tx.taskQueueEntry.findMany({
      where: { projectId: input.projectId },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        sequence: true,
        taskId: true,
        startedAt: true,
        task: { select: { status: true } },
      },
    });

    const index = entries.findIndex((entry) => entry.taskId === input.taskId);
    const entry = entries[index];
    if (entry === undefined) {
      return { ok: false, code: EXECUTION_QUEUE_ERROR.ENTRY_NOT_FOUND };
    }

    const neighbourIndex = input.direction === "up" ? index - 1 : index + 1;
    const neighbour = entries[neighbourIndex];
    if (neighbour === undefined) {
      // Deja en bout de file : rien a faire, et surtout pas une erreur.
      return { ok: true, moved: false };
    }

    for (const candidate of [entry, neighbour]) {
      // Une entree dont le cycle a commence ne bouge pas — y compris rouverte,
      // ou son statut est redevenu `READY`. La deplacer ne changerait rien a ce
      // qui est en cours, et laisserait croire le contraire.
      if (candidate.startedAt !== null) {
        return { ok: false, code: EXECUTION_QUEUE_ERROR.TASK_HAS_ACTIVE_RUN };
      }
      if (
        isTaskStatus(candidate.task.status) &&
        candidate.task.status !== "READY" &&
        candidate.task.status !== "COMPLETED"
      ) {
        return { ok: false, code: EXECUTION_QUEUE_ERROR.TASK_HAS_ACTIVE_RUN };
      }
    }

    // Trois ecritures plutot que deux : SQLite refuserait l'echange direct, la
    // contrainte d'unicite n'etant pas differee. La valeur intermediaire vient
    // du compteur du projet, donc n'entre jamais en collision.
    const parked = await tx.project.update({
      where: { id: input.projectId },
      data: { nextQueueSequence: { increment: 1 } },
      select: { nextQueueSequence: true },
    });
    const temporary = parked.nextQueueSequence - 1;

    await tx.taskQueueEntry.update({ where: { id: entry.id }, data: { sequence: temporary } });
    await tx.taskQueueEntry.update({
      where: { id: neighbour.id },
      data: { sequence: entry.sequence },
    });
    await tx.taskQueueEntry.update({
      where: { id: entry.id },
      data: { sequence: neighbour.sequence },
    });

    return { ok: true, moved: true };
  });
}

export type SetQueueActiveResult =
  | { ok: true; active: boolean }
  | { ok: false; code: ExecutionQueueErrorCode };

/**
 * Ouvre ou ferme l'autorisation permanente de la file.
 *
 * Activer exige au moins une entree : une autorisation qui ne porte sur rien
 * survivrait a la file elle-meme, et s'appliquerait a la premiere tache
 * inscrite ensuite — sans que personne ne l'ait voulu.
 *
 * Mettre en pause **n'annule aucune execution**. Le processus en cours continue :
 * la pause ne concerne que ce qui partirait apres lui.
 */
export async function setQueueActive(
  db: DatabaseClient,
  projectId: string,
  active: boolean,
): Promise<SetQueueActiveResult> {
  return db.$transaction(async (tx): Promise<SetQueueActiveResult> => {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (project === null) {
      return { ok: false, code: EXECUTION_QUEUE_ERROR.TASK_NOT_FOUND };
    }

    if (active) {
      const entries = await tx.taskQueueEntry.count({ where: { projectId } });
      if (entries === 0) {
        return { ok: false, code: EXECUTION_QUEUE_ERROR.QUEUE_EMPTY };
      }
    }

    await tx.project.update({ where: { id: projectId }, data: { executionQueueActive: active } });
    return { ok: true, active };
  });
}

/** L'autorisation de la file est-elle ouverte ? */
export async function isQueueActive(db: DatabaseClient, projectId: string): Promise<boolean> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { executionQueueActive: true },
  });
  return project?.executionQueueActive ?? false;
}
