"use server";

import { getDatabaseClient, reserveCorrection } from "@nox/database";
import { CORRECTION_REFUSAL, CORRECTION_SOURCE } from "@nox/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { correctionRefusalMessage } from "@/lib/correction-display";
import { launchCorrection } from "@/lib/correction-launch";
import { runUrl } from "@/lib/run-display";

import type { StartEvidenceCorrectionState } from "./form-state";

const UNKNOWN_MESSAGE =
  "Cette correction ne designe rien de connu. Revenez a la review et recommencez.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue avant le lancement. Aucune execution n'a demarre ; " +
  "consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Lance une correction fondee sur les seules preuves de NOX.
 *
 * ## Pourquoi elle n'ecrit aucun feedback
 *
 * Parce qu'il n'y en a pas. L'utilisateur n'a rien ecrit — les commandes qui ont
 * echoue disaient deja tout. Inventer un texte pour remplir la colonne ferait
 * mentir l'historique : « pourquoi RUN-002 existe-t-il ? » doit repondre « les
 * preuves de NOX », pas une phrase que personne n'a tapee.
 *
 * ## Ce que le navigateur envoie
 *
 * Trois identifiants. Ni preuve, ni commande, ni sortie, ni prompt, ni chemin.
 * Le contexte est reconstruit cote serveur a partir de la base, au moment du
 * lancement.
 */
export async function startEvidenceCorrectionAction(
  _previousState: StartEvidenceCorrectionState,
  formData: FormData,
): Promise<StartEvidenceCorrectionState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const runId = readField(formData, "runId");

  const db = getDatabaseClient();
  let destination: string;

  try {
    const reserved = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.HUMAN_FEEDBACK,
    });
    if (!reserved.ok) {
      return {
        error:
          reserved.reason === "already_reserved"
            ? correctionRefusalMessage(CORRECTION_REFUSAL.ALREADY_RESERVED)
            : UNKNOWN_MESSAGE,
      };
    }

    const launched = await launchCorrection(db, {
      projectId,
      taskId,
      sourceRunId: runId,
      attemptId: reserved.attempt.id,
    });
    if (!launched.ok) {
      revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
      return { error: launched.message };
    }

    revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
    revalidatePath(`/projects/${projectId}/tasks`);
    destination = runUrl(projectId, taskId, launched.runId);
  } catch (error) {
    console.error("[nox] Echec du lancement d'une correction sur preuves :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  redirect(destination);
}
