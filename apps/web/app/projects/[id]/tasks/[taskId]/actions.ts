"use server";

import {
  getDatabaseClient,
  getProjectById,
  getTaskById,
  updateTaskStatus,
} from "@nox/database";
import { isReservedTaskStatus, isTaskStatus } from "@nox/shared";
import { revalidatePath } from "next/cache";

import { applyTaskDocumentSync } from "@/lib/tasks";

import type { TaskStatusState } from "./form-state";

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
