"use server";

import {
  getDatabaseClient,
  getReviewFeedback,
  reserveCorrection,
} from "@nox/database";
import { CORRECTION_REFUSAL, CORRECTION_SOURCE } from "@nox/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { correctionRefusalMessage } from "@/lib/correction-display";
import { launchCorrection } from "@/lib/correction-launch";
import { runUrl } from "@/lib/run-display";

import type { StartCorrectionState } from "./form-state";

const UNKNOWN_MESSAGE =
  "Cette demande de correction n'existe plus. Revenez a la review et recommencez.";

const ALREADY_USED_MESSAGE =
  "Ce feedback a deja servi a lancer une correction. Relisez la nouvelle review, puis ecrivez-en " +
  "un autre si besoin.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue avant le lancement. Aucune execution n'a demarre ; " +
  "consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function isText(value: FormDataEntryValue): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * Reprend la session Claude d'une execution relue pour appliquer un feedback.
 *
 * ## Ce que le navigateur envoie
 *
 * Quatre identifiants et, le cas echeant, les identifiants des criteres humains
 * signales. **Rien** d'autre — ni identifiant de session, ni chemin de
 * repository, ni empreinte, ni preuve, ni prompt, ni liste d'outils. Tout le
 * reste est relu en base, et chaque relation est reverifiee : un `runId` d'un
 * autre projet ne designe rien.
 *
 * ## Deux ecritures, dans cet ordre
 *
 * La **reservation** d'abord : elle prend la place, et c'est elle qui fait
 * qu'une correction automatique decidee au meme instant n'en produit pas une
 * seconde. Le **moteur** ensuite, qui revalide tout, passe le preflight, cree
 * l'execution et consomme la reservation dans une seule transaction.
 *
 * Une reservation qui n'aboutit pas est rendue par le moteur, avec sa raison :
 * l'utilisateur retablit son repository et reessaie avec le meme texte.
 */
export async function startCorrectionAction(
  _previousState: StartCorrectionState,
  formData: FormData,
): Promise<StartCorrectionState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const runId = readField(formData, "runId");
  const feedbackId = readField(formData, "feedbackId");

  const db = getDatabaseClient();
  let destination: string;

  try {
    const feedback = await getReviewFeedback(db, feedbackId);
    if (feedback === null || feedback.taskId !== taskId || feedback.sourceRunId !== runId) {
      return { error: UNKNOWN_MESSAGE };
    }
    if (feedback.correctionRunId !== null) {
      return { error: ALREADY_USED_MESSAGE };
    }

    const reserved = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.HUMAN_FEEDBACK,
      feedbackId,
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
      humanCriterionIds: formData.getAll("humanCriterion").filter(isText),
      humanFeedback: feedback.text,
    });
    if (!launched.ok) {
      revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
      return { error: launched.message };
    }

    revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
    revalidatePath(`/projects/${projectId}/tasks`);
    destination = runUrl(projectId, taskId, launched.runId);
  } catch (error) {
    console.error("[nox] Echec du lancement d'une correction :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  redirect(destination);
}
