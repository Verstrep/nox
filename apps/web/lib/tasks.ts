/**
 * Lecture et synchronisation des taches pour les Server Components et les
 * Server Actions.
 *
 * Comme `lib/projects.ts`, ces fonctions appellent `connection()` : sans lui,
 * Next.js interrogerait SQLite pendant le build, sur une base qui n'existe pas
 * forcement a ce moment-la.
 *
 * Les taches vivent en base : leur lecture ne depend pas du runner, et le
 * backlog reste donc consultable runner arrete.
 */

import {
  countProjectDependencies,
  countQueueEntries,
  getDatabaseClient,
  getTaskById,
  listDependencyCandidates,
  listTaskDependencies,
  isQueueActive,
  listQueueEntries,
  listTasksByProject,
  markTaskDocumentConflict,
  markTaskDocumentError,
  markTaskDocumentSynced,
  readVerificationPlan,
  type ProjectDependencyCounts,
} from "@nox/database";
import {
  isQueueBarrier,
  summarizeTaskDependencies,
  type DevelopmentTaskDetail,
  type DevelopmentTaskSummary,
  type TaskDependencyRef,
  type TaskDependencySummary,
  type TaskMarkdownDependency,
} from "@nox/shared";
import { connection } from "next/server";

import {
  createTaskDocument,
  readProjectDocument,
  updateProjectDocument,
} from "./runner/client.ts";
import {
  resynchronizeTaskDocument,
  synchronizeTaskDocument,
  type SynchronizableTask,
  type TaskSyncPorts,
} from "./task-sync.ts";

/** Retourne le backlog d'un projet, deja ordonne pour l'affichage. */
export async function loadProjectTasks(projectId: string): Promise<DevelopmentTaskSummary[]> {
  await connection();
  return listTasksByProject(getDatabaseClient(), projectId);
}

/** Retourne une tache complete, ou `null` si elle n'existe pas. */
export async function loadTask(taskId: string): Promise<DevelopmentTaskDetail | null> {
  await connection();
  return getTaskById(getDatabaseClient(), taskId);
}

/**
 * Resume des dependances d'une tache, dans les deux sens.
 *
 * Derive a chaque appel a partir des statuts courants : rien n'est stocke, et
 * rouvrir une tache terminee change la reponse au rendu suivant.
 */
export async function loadTaskDependencies(taskId: string): Promise<TaskDependencySummary> {
  await connection();
  return summarizeTaskDependencies(await listTaskDependencies(getDatabaseClient(), taskId));
}

/** Taches du projet proposables comme dependance, ordonnees par code. */
export async function loadDependencyCandidates(
  projectId: string,
): Promise<TaskDependencyRef[]> {
  await connection();
  return listDependencyCandidates(getDatabaseClient(), projectId);
}

/** Compteurs par tache, pour la liste du projet. Une requete, jamais une par ligne. */
export async function loadProjectDependencyCounts(
  projectId: string,
): Promise<ProjectDependencyCounts> {
  await connection();
  return countProjectDependencies(getDatabaseClient(), projectId);
}

/**
 * Etat de la file autour d'une tache.
 *
 * Entierement derive : la position vient de l'ordre des entrees, jamais d'une
 * colonne. Aucune sonde du repository — la page d'une tache n'a pas besoin de
 * savoir si le repository est propre pour dire qu'elle est inscrite.
 */
export type TaskQueueState = {
  queued: boolean;
  /** Position affichee, a partir de 1. `null` quand la tache n'est pas inscrite. */
  position: number | null;
  active: boolean;
  queuedCount: number;
  /**
   * Cette tache **est** la barriere courante de la file.
   *
   * C'est-a-dire : son inscription a deja lance une execution, et la tache n'a
   * pas ete acceptee. La file l'attend, et n'ira pas plus loin sans elle. Le cas
   * qui rend ce champ necessaire est une tache rouverte : elle est `READY`, mais
   * elle n'est pas disponible pour autant.
   */
  isCurrent: boolean;
};

export async function loadTaskQueueState(
  projectId: string,
  taskId: string,
): Promise<TaskQueueState> {
  await connection();
  const db = getDatabaseClient();
  const [entries, active] = await Promise.all([
    listQueueEntries(db, projectId),
    isQueueActive(db, projectId),
  ]);

  const index = entries.findIndex((entry) => entry.taskId === taskId);
  // La barriere est la premiere entree dont le cycle a commence, ou dont la
  // tache a quitte `READY`. Une seule implementation de cette question vit dans
  // `@nox/shared` ; celle-ci l'appelle plutot que de la redire.
  const barrier = entries.find(isQueueBarrier) ?? null;

  return {
    queued: index !== -1,
    position: index === -1 ? null : index + 1,
    active,
    queuedCount: entries.length,
    isCurrent: barrier !== null && barrier.taskId === taskId,
  };
}

/** Nombre de taches inscrites dans la file d'un projet. */
export async function loadQueuedCount(projectId: string): Promise<number> {
  await connection();
  return countQueueEntries(getDatabaseClient(), projectId);
}

/** Identifiants des taches inscrites, pour marquer une liste. */
export async function loadQueuedTaskIds(projectId: string): Promise<Map<string, number>> {
  await connection();
  const entries = await listQueueEntries(getDatabaseClient(), projectId);
  return new Map(entries.map((entry, index) => [entry.taskId, index + 1]));
}

/** Acces reels au runner ; remplaces par des doublures dans les tests. */
const RUNNER_PORTS: TaskSyncPorts = {
  createDocument: (repositoryPath, taskCode, content) =>
    createTaskDocument(repositoryPath, taskCode, content),
  readDocument: (repositoryPath, documentPath) =>
    readProjectDocument(repositoryPath, documentPath),
  updateDocument: (repositoryPath, documentPath, content, expectedRevision) =>
    updateProjectDocument(repositoryPath, documentPath, content, expectedRevision),
};

/**
 * Tente de creer le document de la tache et enregistre le resultat.
 *
 * La tache existe deja quand cette fonction est appelee : aucun echec ici ne la
 * remet en cause. C'est ce qui permet de creer une tache runner arrete, puis de
 * reessayer plus tard sans avoir rien ressaisi.
 *
 * Le message conserve en base vient de `describeRunnerFailure` : il est deja
 * destine a l'utilisateur et ne contient ni chemin absolu, ni jeton, ni trace.
 */
export async function applyTaskDocumentSync(
  task: DevelopmentTaskDetail,
  repositoryPath: string,
  ports: TaskSyncPorts = RUNNER_PORTS,
): Promise<DevelopmentTaskDetail> {
  const db = getDatabaseClient();
  // Le plan de verification fait partie du contrat ecrit dans le document.
  const verificationPlan = await readVerificationPlan(db, task.id);
  const outcome = await synchronizeTaskDocument(
    repositoryPath,
    { ...task, verificationPlan },
    ports,
  );

  switch (outcome.kind) {
    case "synced":
      return markTaskDocumentSynced(db, task.id, outcome.path, outcome.revision);
    case "conflict":
      return markTaskDocumentConflict(db, task.id, outcome.message);
    case "error":
      return markTaskDocumentError(db, task.id, outcome.message);
  }
}

/**
 * Reecrit le document d'une tache dont la specification vient de changer.
 *
 * Appelee **apres** la transaction, jamais dedans : NOX ne pretend a aucune
 * atomicite entre SQLite et un systeme de fichiers. Un echec laisse une tache
 * correcte et un document a reprendre — etat visible, jamais silencieux.
 */
export async function applyTaskDocumentResync(
  task: DevelopmentTaskDetail,
  repositoryPath: string,
  dependencies: readonly TaskMarkdownDependency[],
  ports: TaskSyncPorts = RUNNER_PORTS,
): Promise<DevelopmentTaskDetail> {
  const db = getDatabaseClient();
  const verificationPlan = await readVerificationPlan(db, task.id);
  const synchronizable: SynchronizableTask = { ...task, dependencies, verificationPlan };
  const outcome = await resynchronizeTaskDocument(
    repositoryPath,
    synchronizable,
    task.documentRevision,
    ports,
  );

  switch (outcome.kind) {
    case "synced":
      return markTaskDocumentSynced(db, task.id, outcome.path, outcome.revision);
    case "conflict":
      return markTaskDocumentConflict(db, task.id, outcome.message);
    case "error":
      return markTaskDocumentError(db, task.id, outcome.message);
  }
}
