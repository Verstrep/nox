"use server";

import {
  getDatabaseClient,
  getProjectById,
  listTaskDependencies,
  updateFutureTask,
} from "@nox/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { dependencyRefusalMessage } from "@/lib/task-dependencies";
import { taskUrl } from "@/lib/task-display";
import {
  readTaskEditSubmission,
  taskEditRefusalMessage,
  taskEditRevision,
  type TaskEditFormValues,
} from "@/lib/task-edit";
import { applyTaskDocumentResync } from "@/lib/tasks";
import { readPlanRows } from "@/lib/verification-fields";

import type { EditTaskState } from "./form-state";

const UNKNOWN_PROJECT_MESSAGE =
  "Ce projet n'existe plus dans NOX. Revenez au tableau de bord et rouvrez-le.";

const MISSING_REVISION_MESSAGE =
  "Formulaire incomplet. Rechargez la page avant d'enregistrer.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue pendant l'enregistrement. La tache n'a pas ete modifiee ; " +
  "consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function readStrings(formData: FormData, field: string): string[] {
  return formData.getAll(field).filter((entry): entry is string => typeof entry === "string");
}

function readValues(formData: FormData): TaskEditFormValues {
  // Le plan passe par le lecteur partage : l'editeur de tache et la revue d'un
  // backlog envoient exactement les memes champs, et un second decodage aurait
  // fini par accepter ce que l'autre refuse.
  const plan = readPlanRows(formData, "");

  return {
    title: readField(formData, "title"),
    priority: readField(formData, "priority"),
    objective: readField(formData, "objective"),
    context: readField(formData, "context"),
    outOfScope: readField(formData, "outOfScope"),
    documents: readField(formData, "documents"),
    criteria: plan.criteria,
    commands: plan.commands,
    // `getAll` plutot que `get` : les dependances sont des cases a cocher, et il
    // y en a autant que de cases cochees.
    dependsOnTaskIds: readStrings(formData, "dependsOnTaskIds"),
  };
}

/**
 * Enregistre une nouvelle specification pour une tache jamais executee.
 *
 * ## Ce que le navigateur envoie
 *
 * Les champs saisis, les identifiants coches, et une revision. Rien d'autre :
 * ni statut, ni code, ni nature, ni provenance. Tout ce qui est immuable est
 * relu en base, et la revision ne peut qu'obtenir un refus — jamais elargir
 * quoi que ce soit.
 *
 * ## Aucune IA, aucun Claude Code
 *
 * Enregistrer une tache est une ecriture SQLite, suivie — si le contrat a
 * change — d'une reecriture de son document Markdown. Ni OpenAI, ni Claude Code,
 * ni commit, ni push. La page fonctionne runner arrete : seule la
 * resynchronisation echouera, et elle le dira.
 *
 * ## L'ordre des deux etapes
 *
 * Transaction d'abord, document ensuite, comme partout ailleurs dans NOX. Aucune
 * pretention d'atomicite entre SQLite et un systeme de fichiers : un echec
 * d'ecriture laisse une tache correcte et un document a reprendre, etat que la
 * page de la tache affiche.
 *
 * ## En cas de refus, le formulaire est rendu
 *
 * Un cycle refuse ne doit pas faire perdre l'objectif qu'on venait de reecrire.
 * Les valeurs saisies repartent telles quelles vers le formulaire.
 */
export async function editTaskAction(
  _previousState: EditTaskState,
  formData: FormData,
): Promise<EditTaskState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const expectedRevision = readField(formData, "expectedRevision");
  const values = readValues(formData);

  if (expectedRevision.trim() === "") {
    return { values, error: MISSING_REVISION_MESSAGE };
  }

  const submission = readTaskEditSubmission(values);
  if (!submission.ok) {
    return { values, error: submission.message };
  }

  const db = getDatabaseClient();

  try {
    const project = await getProjectById(db, projectId);
    if (project === null) {
      return { values, error: UNKNOWN_PROJECT_MESSAGE };
    }

    const result = await updateFutureTask(db, {
      projectId: project.id,
      taskId,
      values: submission.input,
      expectedRevision,
      revision: taskEditRevision,
    });

    if (!result.ok) {
      return {
        values,
        error:
          result.reason === "edit"
            ? taskEditRefusalMessage(result.code)
            : dependencyRefusalMessage(result.code),
      };
    }

    // Le document n'est reecrit que si le contrat a change : une sauvegarde sans
    // modification ne doit produire aucun diff Git.
    if (result.changed) {
      const dependencies = await listTaskDependencies(db, taskId);
      try {
        await applyTaskDocumentResync(
          result.task,
          project.repositoryPath,
          dependencies.dependsOn.map((entry) => ({ code: entry.code, title: entry.title })),
        );
      } catch (error) {
        // La resynchronisation enregistre normalement ses propres echecs. Si elle
        // n'y parvient pas, la tache reste correcte et sa page proposera de
        // reessayer : rien n'est perdu.
        console.error("[nox] Echec de la resynchronisation du document de tache :", error);
      }
    }
  } catch (error) {
    console.error("[nox] Echec de l'edition d'une tache :", error);
    return { values, error: UNEXPECTED_ERROR_MESSAGE };
  }

  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  revalidatePath(`/projects/${projectId}/tasks`);
  revalidatePath(`/projects/${projectId}`);
  redirect(taskUrl(projectId, taskId));
}
