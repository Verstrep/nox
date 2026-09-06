"use server";

import { getDatabaseClient, reserveCorrection } from "@nox/database";
import { CORRECTION_REFUSAL, CORRECTION_SOURCE } from "@nox/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { correctionRefusalMessage } from "@/lib/correction-display";
import { launchCorrection } from "@/lib/correction-launch";
import { runUrl } from "@/lib/run-display";

import type { StartFailureCorrectionState } from "./form-state";

const UNKNOWN_MESSAGE =
  "Cette correction ne designe rien de connu. Revenez a l'execution et recommencez.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue avant le lancement. Aucune execution n'a demarre ; " +
  "consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Reprend une execution qui a echoue, sur le travail qu'elle a laisse.
 *
 * ## Ce qu'elle n'est pas
 *
 * Ce n'est pas `Retry`. `Retry` remet la tache en file et repart d'un repository
 * **propre** : c'est le geste qui convient quand le travail partiel n'a pas
 * d'interet, ou quand on prefere recommencer. Cette action-ci fait l'inverse —
 * elle exige que le dossier de travail soit **exactement** celui que l'echec a
 * laisse, et reprend la session Claude a cet endroit.
 *
 * ## Ce que le navigateur envoie
 *
 * Trois identifiants. Ni prompt, ni diagnostic, ni chemin, ni empreinte. Tout
 * est relu en base au lancement, et le runner recalcule l'empreinte du dossier
 * de travail juste avant de lancer le processus.
 *
 * ## Aucun feedback n'est enregistre
 *
 * Parce qu'il n'y en a pas : personne n'a relu ce travail. Inventer un texte
 * pour remplir la colonne ferait mentir l'historique — « pourquoi RUN-002
 * existe-t-il ? » doit repondre « RUN-001 s'est arrete en cours de route ».
 */
export async function startFailureCorrectionAction(
  _previousState: StartFailureCorrectionState,
  formData: FormData,
): Promise<StartFailureCorrectionState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const runId = readField(formData, "runId");

  const db = getDatabaseClient();
  let destination: string;

  try {
    // La reservation **est** le verrou. Deux clics simultanes, ou deux onglets,
    // n'en obtiennent qu'une : l'index unique tranche, et le perdant recoit un
    // refus nomme plutot qu'une seconde execution.
    const reserved = await reserveCorrection(db, {
      taskId,
      sourceRunId: runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
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
    console.error("[nox] Echec du lancement d'une reprise apres echec :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  redirect(destination);
}
