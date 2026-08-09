"use server";

import { createArchitectSession, getDatabaseClient, getProjectById } from "@nox/database";
import { ARCHITECT_LIMITS, checkArchitectText, normalizeArchitectText } from "@nox/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { architectSessionUrl } from "@/lib/architect/display";
import { describeArchitectTextRefusal } from "@/lib/architect/errors";

import type { NewArchitectRequestState } from "./form-state";

const UNKNOWN_PROJECT_MESSAGE =
  "Ce projet n'existe plus dans NOX. Revenez au tableau de bord et rouvrez-le.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue avant l'enregistrement. Aucune demande n'a ete creee ; " +
  "consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Ouvre une demande Architecte.
 *
 * **Aucun appel au fournisseur.** Cette action enregistre un texte et rien
 * d'autre ; c'est la page suivante qui prepare le contexte et l'affiche, et un
 * second clic qui declenche la generation. L'utilisateur voit donc toujours ce
 * qui va quitter sa machine avant que cela ne parte.
 */
export async function createArchitectSessionAction(
  _previousState: NewArchitectRequestState,
  formData: FormData,
): Promise<NewArchitectRequestState> {
  const projectId = readField(formData, "projectId");
  const raw = normalizeArchitectText(readField(formData, "request"));

  const refusal = checkArchitectText(raw, ARCHITECT_LIMITS.request);
  if (refusal !== null) {
    return { error: describeArchitectTextRefusal(refusal, ARCHITECT_LIMITS.request), text: raw };
  }

  let destination: string;
  try {
    const db = getDatabaseClient();
    const project = await getProjectById(db, projectId);
    if (project === null) {
      return { error: UNKNOWN_PROJECT_MESSAGE, text: raw };
    }

    const session = await createArchitectSession(db, { projectId: project.id, requestText: raw });
    if (session === null) {
      return { error: UNKNOWN_PROJECT_MESSAGE, text: raw };
    }

    revalidatePath(`/projects/${projectId}/architect`);
    destination = architectSessionUrl(projectId, session.id);
  } catch (error) {
    console.error("[nox] Echec de la creation d'une demande Architecte :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, text: raw };
  }

  redirect(destination);
}
