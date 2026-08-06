"use server";

import { createTask, getDatabaseClient, getProjectById } from "@nox/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { taskUrl } from "@/lib/task-display";
import { readTaskSubmission, type TaskFormValues } from "@/lib/task-input";
import { applyTaskDocumentSync } from "@/lib/tasks";

import type { CreateTaskState } from "./form-state";

const UNKNOWN_PROJECT_MESSAGE =
  "Ce projet n'existe plus dans NOX. Revenez au tableau de bord et rouvrez-le.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue pendant l'enregistrement. La tache n'a pas ete creee ; " +
  "consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function readValues(formData: FormData): TaskFormValues {
  return {
    title: readField(formData, "title"),
    priority: readField(formData, "priority"),
    objective: readField(formData, "objective"),
    context: readField(formData, "context"),
    outOfScope: readField(formData, "outOfScope"),
    documents: readField(formData, "documents"),
    criteria: readField(formData, "criteria"),
    commands: readField(formData, "commands"),
  };
}

/**
 * Cree une tache structuree, puis tente d'ecrire son document Markdown.
 *
 * Les deux etapes sont volontairement dissociees. La premiere est
 * transactionnelle et ne depend que de SQLite ; la seconde passe par le runner
 * et peut echouer pour des raisons qui n'ont rien a voir avec la tache — runner
 * arrete, droits, disque. Faire dependre l'existence de la tache du succes de
 * l'ecriture ferait perdre une specification entiere a cause d'un processus
 * oublie dans un autre terminal.
 *
 * La redirection a donc lieu **dans tous les cas** : la page de detail affiche
 * l'etat reel de la synchronisation et propose de reessayer.
 */
export async function createTaskAction(
  _previousState: CreateTaskState,
  formData: FormData,
): Promise<CreateTaskState> {
  const projectId = readField(formData, "projectId");
  const values = readValues(formData);

  const submission = readTaskSubmission(values);
  if (!submission.ok) {
    return { values, error: submission.message };
  }

  const db = getDatabaseClient();

  let created;
  let repositoryPath: string;
  try {
    const project = await getProjectById(db, projectId);
    if (project === null) {
      return { values, error: UNKNOWN_PROJECT_MESSAGE };
    }
    repositoryPath = project.repositoryPath;

    created = await createTask(db, { projectId: project.id, ...submission.input });
    if (created === null) {
      return { values, error: UNKNOWN_PROJECT_MESSAGE };
    }
  } catch (error) {
    console.error("[nox] Echec de la creation d'une tache :", error);
    return { values, error: UNEXPECTED_ERROR_MESSAGE };
  }

  // A partir d'ici la tache existe. Plus aucun echec ne renvoie au formulaire :
  // une seconde soumission la creerait en double, avec un numero different.
  try {
    await applyTaskDocumentSync(created, repositoryPath);
  } catch (error) {
    // La synchronisation enregistre normalement ses propres echecs ; si elle n'y
    // parvient pas, la tache reste `PENDING` et la page de detail proposera de
    // reessayer. Rien n'est perdu.
    console.error("[nox] Echec de la synchronisation du document de tache :", error);
  }

  revalidatePath(`/projects/${projectId}/tasks`);
  revalidatePath(`/projects/${projectId}`);
  redirect(taskUrl(projectId, created.id));
}
