"use server";

import { getDatabaseClient } from "@nox/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { loadBootstrapInput } from "@/lib/bootstrap";
import {
  BOOTSTRAP_ALREADY_EXISTS_MESSAGE,
  BOOTSTRAP_UNKNOWN_MESSAGE,
  bootstrapBlockerMessage,
} from "@/lib/bootstrap/display";
import { createProjectBootstrapTask } from "@/lib/bootstrap/service";
import { loadProject } from "@/lib/projects";
import { taskUrl } from "@/lib/task-display";
import { applyTaskDocumentSync } from "@/lib/tasks";

import type { BootstrapCreateState } from "./form-state";

const UNKNOWN_PROJECT_MESSAGE =
  "Ce projet n'existe pas. Revenez au tableau de bord et rouvrez-le.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Cree `TASK-000`.
 *
 * ## Rien ne vient du navigateur, sauf une empreinte
 *
 * Le formulaire ne transporte qu'un identifiant de projet et l'empreinte de
 * l'apercu qui vient d'etre lu. Le contexte, la specification, le titre, les
 * criteres et le numero sont tous reconstruits cote serveur au moment du clic.
 *
 * L'empreinte n'accorde aucun droit : elle ne peut qu'obtenir un refus. Un
 * onglet reste ouvert sur un etat depasse voit sa creation refusee, et rien de
 * ce qu'il envoie ne peut elargir quoi que ce soit.
 *
 * ## Elle n'appelle personne
 *
 * Zero OpenAI, zero execution de Claude Code. Le runner est lu — une fois, en
 * lecture seule — parce que l'etat du repository decide du contenu de la tache.
 */
export async function createBootstrapTaskAction(
  _previousState: BootstrapCreateState,
  formData: FormData,
): Promise<BootstrapCreateState> {
  const projectId = readField(formData, "projectId");
  const expectedFingerprint = readField(formData, "fingerprint");
  let createdTaskId: string;

  try {
    const project = await loadProject(projectId);
    if (project === null) {
      return { error: UNKNOWN_PROJECT_MESSAGE, stale: false };
    }

    const db = getDatabaseClient();
    const input = await loadBootstrapInput(db, project);
    const outcome = await createProjectBootstrapTask(db, input, expectedFingerprint);

    if (!outcome.ok) {
      switch (outcome.reason) {
        case "stale":
          return { error: null, stale: true };
        case "blocked": {
          const first = outcome.blockers[0];
          return {
            error: first === undefined ? BOOTSTRAP_UNKNOWN_MESSAGE : bootstrapBlockerMessage(first),
            stale: false,
          };
        }
        case "already_exists":
          return { error: BOOTSTRAP_ALREADY_EXISTS_MESSAGE, stale: false };
        default:
          return { error: BOOTSTRAP_UNKNOWN_MESSAGE, stale: false };
      }
    }

    // Le document suit la tache, exactement comme pour une creation ordinaire :
    // un echec ici laisse une tache complete en base, et un document a reprendre.
    await applyTaskDocumentSync(outcome.task, project.repositoryPath);
    createdTaskId = outcome.task.id;

    revalidatePath(`/projects/${projectId}/bootstrap`);
    revalidatePath(`/projects/${projectId}/tasks`);
    revalidatePath(`/projects/${projectId}`);
  } catch (error) {
    console.error("[nox] creation de la tache d'amorcage impossible", error);
    return { error: BOOTSTRAP_UNKNOWN_MESSAGE, stale: false };
  }

  redirect(taskUrl(projectId, createdTaskId));
}
