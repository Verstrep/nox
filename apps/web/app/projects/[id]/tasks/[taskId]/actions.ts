"use server";

import {
  deleteTaskWithoutRuns,
  listTaskDependencies,
  getDatabaseClient,
  getProjectById,
  getTaskById,
  listRunsByTask,
  updateTaskStatus,
} from "@nox/database";
import { isReservedTaskStatus, isTaskStatus } from "@nox/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { deleteTaskDocument } from "@/lib/runner/client";
import { describeRunnerFailure } from "@/lib/runner/errors";
import {
  checkTaskDeletion,
  taskHasDependentsMessage,
  TASK_HAS_RUNS_MESSAGE,
} from "@/lib/task-delete";
import { backlogUrl } from "@/lib/task-display";
import { applyTaskDocumentSync } from "@/lib/tasks";

import type { DeleteTaskState, TaskStatusState } from "./form-state";

const UNKNOWN_TASK_MESSAGE =
  "Cette tache n'existe pas dans ce projet. Revenez au backlog et rouvrez-la.";

const FORBIDDEN_TRANSITION_MESSAGE =
  "Ce changement de statut n'est pas autorise depuis l'etat actuel de la tache. " +
  "Rechargez la page pour voir les transitions possibles.";

const RESERVED_STATUS_MESSAGE =
  "Ce statut est reserve aux executions de Claude Code : il ne peut pas etre pose a la main.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function revalidateTask(projectId: string, taskId: string): void {
  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  revalidatePath(`/projects/${projectId}/tasks`);
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Change le statut d'une tache.
 *
 * Trois choses ne sont jamais acceptees telles quelles du navigateur : le
 * projet auquel la tache appartient, son code, et la legitimite de la
 * transition. Le premier sert de **filtre** de recherche — une tache d'un autre
 * projet est introuvable, pas « refusee » ; le deuxieme n'est simplement pas un
 * champ ; le troisieme est verifie par `updateTaskStatus`, seul point de
 * passage vers l'ecriture.
 *
 * Le document Markdown n'est pas regenere : le statut n'y figure pas.
 */
export async function updateTaskStatusAction(
  _previousState: TaskStatusState,
  formData: FormData,
): Promise<TaskStatusState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const status = readField(formData, "status");

  if (!isTaskStatus(status)) {
    return { error: "Statut inconnu." };
  }

  // Refus explicite avant meme la table des transitions : le message doit dire
  // *pourquoi* ces statuts sont hors de portee, pas seulement qu'ils le sont.
  if (isReservedTaskStatus(status)) {
    return { error: RESERVED_STATUS_MESSAGE };
  }

  try {
    const result = await updateTaskStatus(getDatabaseClient(), taskId, projectId, status);

    if (!result.ok) {
      return {
        error:
          result.reason === "not_found" ? UNKNOWN_TASK_MESSAGE : FORBIDDEN_TRANSITION_MESSAGE,
      };
    }
  } catch (error) {
    console.error("[nox] Echec du changement de statut d'une tache :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  revalidateTask(projectId, taskId);
  return { error: null };
}

/**
 * Relance la creation du document Markdown d'une tache.
 *
 * Aucun etat n'est retourne : la page se re-rend avec l'etat de synchronisation
 * reel, qui dit deja tout ce qu'il y a a dire. Un message separe pourrait
 * contredire la pastille affichee juste a cote.
 */
export async function retryTaskDocumentAction(formData: FormData): Promise<void> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");

  try {
    const db = getDatabaseClient();

    const task = await getTaskById(db, taskId);
    // Le projet du formulaire doit etre celui de la tache : sans ce controle,
    // un identifiant devine permettrait de declencher une ecriture dans le
    // repository d'un autre projet.
    if (task === null || task.projectId !== projectId) {
      return;
    }

    const project = await getProjectById(db, task.projectId);
    if (project === null) {
      return;
    }

    await applyTaskDocumentSync(task, project.repositoryPath);
  } catch (error) {
    console.error("[nox] Echec de la nouvelle tentative de synchronisation :", error);
  }

  revalidateTask(projectId, taskId);
}

const DELETE_DATABASE_FAILED_MESSAGE =
  "Le document Markdown de cette tache a bien ete supprime du repository, mais la tache n'a pas " +
  "pu etre retiree de la base. Les deux ne sont donc plus coherents : consultez les logs du " +
  "serveur, puis relancez la suppression — elle reprendra sans redemander le fichier.";

/**
 * Supprime une tache et son document Markdown.
 *
 * ## Ce que le navigateur envoie
 *
 * Trois valeurs, et rien d'autre : l'identifiant du projet, celui de la tache,
 * et le code recopie a la main. Ni chemin de repository, ni chemin de document,
 * ni revision, ni drapeau de forcage. Tout le reste est relu en base — le chemin
 * du repository depuis le projet, la revision depuis la tache — ce qui rend un
 * formulaire altere sans effet sur la cible.
 *
 * ## L'ordre, et pourquoi il n'est pas negociable
 *
 * Le fichier d'abord, la base ensuite. Cette operation traverse deux systemes
 * qui ne partagent aucune transaction : l'un des deux echouera un jour entre les
 * deux etapes, et le choix se resume a quelle incoherence on prefere.
 *
 * - Base d'abord : un `tasks/TASK-007.md` orphelin, que plus rien dans NOX ne
 *   designe, et qu'aucune reprise ne peut retrouver.
 * - Fichier d'abord : une tache dont le document a disparu — visible, signalee,
 *   et reprenable d'un second clic, puisque la route de suppression traite un
 *   document absent comme une reussite.
 *
 * Le second cas se repare, le premier se decouvre des mois plus tard.
 *
 * ## Le runner injoignable
 *
 * Rien n'est supprime. Une panne du runner ne doit jamais retirer une ligne de
 * la base : l'utilisateur redemarre le runner et recommence.
 */
export async function deleteTaskAction(
  _previousState: DeleteTaskState,
  formData: FormData,
): Promise<DeleteTaskState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const confirmationCode = readField(formData, "confirmationCode");

  let repositoryPath: string;
  let taskCode: string;
  let documentRevision: string | null;

  try {
    const db = getDatabaseClient();

    const task = await getTaskById(db, taskId);
    // Le projet du formulaire doit etre celui de la tache : une tache d'un autre
    // projet est traitee comme inexistante, jamais comme « refusee ».
    if (task === null || task.projectId !== projectId) {
      return { error: UNKNOWN_TASK_MESSAGE };
    }

    const project = await getProjectById(db, task.projectId);
    if (project === null) {
      return { error: UNKNOWN_TASK_MESSAGE };
    }

    const runs = await listRunsByTask(db, task.id);
    const dependents = (await listTaskDependencies(db, task.id)).dependents;
    const check = checkTaskDeletion(
      {
        code: task.code,
        status: task.status,
        documentSyncStatus: task.documentSyncStatus,
        runCount: runs.length,
        dependents,
      },
      confirmationCode,
    );
    if (!check.ok) {
      return { error: check.message };
    }

    repositoryPath = project.repositoryPath;
    taskCode = task.code;
    // La revision vient de la base, jamais du formulaire : c'est elle qui prouve
    // que le fichier vise est bien celui que NOX a ecrit.
    documentRevision = task.documentRevision;
  } catch (error) {
    console.error("[nox] Echec de la lecture avant suppression d'une tache :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  const removed = await deleteTaskDocument(repositoryPath, taskCode, documentRevision);
  if (!removed.ok) {
    // Runner arrete, conflit, fichier inattendu : la base n'est pas touchee.
    return { error: describeRunnerFailure(removed.failure) };
  }

  try {
    const result = await deleteTaskWithoutRuns(getDatabaseClient(), projectId, taskId);

    if (!result.ok) {
      // Une execution a demarre entre la verification et ici : le document est
      // deja supprime, et NOX le dit plutot que de le recreer en silence.
      return {
        error:
          result.reason === "has_runs"
            ? TASK_HAS_RUNS_MESSAGE
            : result.reason === "has_dependents"
              ? taskHasDependentsMessage(result.dependents)
              : UNKNOWN_TASK_MESSAGE,
      };
    }
  } catch (error) {
    // Le detail technique reste dans les logs du serveur : le navigateur ne
    // recoit ni chemin absolu, ni trace Prisma.
    console.error("[nox] Suppression du document reussie mais echec en base :", error);
    return { error: DELETE_DATABASE_FAILED_MESSAGE };
  }

  revalidateTask(projectId, taskId);
  revalidatePath(`/projects/${projectId}/documents`);
  redirect(backlogUrl(projectId));
}
