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
  getDatabaseClient,
  getTaskById,
  listTasksByProject,
  markTaskDocumentConflict,
  markTaskDocumentError,
  markTaskDocumentSynced,
} from "@nox/database";
import type { DevelopmentTaskDetail, DevelopmentTaskSummary } from "@nox/shared";
import { connection } from "next/server";

import { createTaskDocument, readProjectDocument } from "./runner/client.ts";
import { synchronizeTaskDocument, type TaskSyncPorts } from "./task-sync.ts";

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

/** Acces reels au runner ; remplaces par des doublures dans les tests. */
const RUNNER_PORTS: TaskSyncPorts = {
  createDocument: (repositoryPath, taskCode, content) =>
    createTaskDocument(repositoryPath, taskCode, content),
  readDocument: (repositoryPath, documentPath) =>
    readProjectDocument(repositoryPath, documentPath),
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
  const outcome = await synchronizeTaskDocument(repositoryPath, task, ports);
  const db = getDatabaseClient();

  switch (outcome.kind) {
    case "synced":
      return markTaskDocumentSynced(db, task.id, outcome.path, outcome.revision);
    case "conflict":
      return markTaskDocumentConflict(db, task.id, outcome.message);
    case "error":
      return markTaskDocumentError(db, task.id, outcome.message);
  }
}
