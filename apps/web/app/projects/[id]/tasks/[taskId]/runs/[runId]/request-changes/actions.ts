"use server";

import {
  createReviewFeedback,
  getDatabaseClient,
  getRunResumeContext,
  getTaskById,
  hasActiveRun,
} from "@nox/database";
import { checkResumeCandidate, type ReviewFeedbackRefusal } from "@nox/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { correctionUrl, resumeRefusalMessage } from "@/lib/correction-display";

import type { RequestChangesState } from "./form-state";

const UNKNOWN_MESSAGE =
  "Cette execution n'existe pas dans cette tache. Revenez au backlog et rouvrez-la.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Aucun feedback n'a ete enregistre ; consultez les logs " +
  "du serveur pour le detail.";

/** Message par nature de refus du texte. */
const REFUSAL_MESSAGES: Record<ReviewFeedbackRefusal, string> = {
  empty: "Ecrivez ce qui doit etre corrige : sans feedback, il n'y a rien a reprendre.",
  blank: "Ce feedback ne contient que des espaces. Decrivez precisement ce qui doit changer.",
  too_long:
    "Ce feedback depasse 16 Kio. Resumez les points a corriger : Claude Code possede deja tout le contexte de la tache.",
  control_character:
    "Ce feedback contient des caracteres que NOX ne sait pas transmettre surement. Collez-le en texte brut.",
};

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Enregistre un feedback de review, sans rien lancer.
 *
 * ## Deux etapes, volontairement
 *
 * Ecrire le feedback ne demarre **aucune** execution. L'utilisateur passe ensuite
 * par une page de preparation qui lui montre le prompt exact et l'etat du
 * repository avant de decider. Fusionner les deux ferait partir un processus au
 * moment ou l'on clique sur « valider mon texte », ce que personne n'attend.
 *
 * ## Ce que le navigateur envoie
 *
 * Trois identifiants et un texte. Ni session, ni chemin de repository, ni liste
 * d'outils : tout le reste est relu en base a partir de la chaine projet → tache
 * → execution, elle-meme entierement verifiee ici.
 */
export async function requestChangesAction(
  _previousState: RequestChangesState,
  formData: FormData,
): Promise<RequestChangesState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const runId = readField(formData, "runId");
  const text = readField(formData, "feedback");

  const db = getDatabaseClient();
  let destination: string;

  try {
    const task = await getTaskById(db, taskId);
    if (task === null || task.projectId !== projectId) {
      return { error: UNKNOWN_MESSAGE, text };
    }

    const context = await getRunResumeContext(db, runId);
    if (context === null || context.taskId !== taskId) {
      return { error: UNKNOWN_MESSAGE, text };
    }

    // La meme fonction que celle qui decide de l'affichage du bouton : un
    // formulaire soumis a la main ne peut pas contourner une condition que
    // l'interface avait masquee.
    const refusal = checkResumeCandidate({
      runStatus: context.status,
      taskStatus: task.status,
      errorCode: context.errorCode,
      claudeSessionId: context.claudeSessionId,
      hasReview: context.hasReview,
      hasFingerprint: context.workspaceFingerprint !== null,
      hasActiveRun: await hasActiveRun(db, taskId),
      hasCorrection: context.hasCorrection,
    });
    if (refusal !== null) {
      return { error: resumeRefusalMessage(refusal), text };
    }

    const created = await createReviewFeedback(db, { taskId, sourceRunId: runId, text });
    if (!created.ok) {
      return {
        error:
          created.reason === "not_found"
            ? UNKNOWN_MESSAGE
            : REFUSAL_MESSAGES[created.refusal ?? "empty"],
        text,
      };
    }

    revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
    destination = correctionUrl(projectId, taskId, runId, created.feedback.id);
  } catch (error) {
    console.error("[nox] Echec de l'enregistrement d'un feedback de review :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, text };
  }

  redirect(destination);
}
