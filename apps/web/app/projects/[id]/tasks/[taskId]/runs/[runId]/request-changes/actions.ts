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

import { loadCorrectionContext } from "@/lib/correction-cycle";
import {
  correctionEvidenceUrl,
  correctionUrl,
  resumeRefusalMessage,
} from "@/lib/correction-display";
import { failedCriteriaOf } from "@/lib/correction-evidence";

import type { RequestChangesState } from "./form-state";

const UNKNOWN_MESSAGE =
  "Cette execution n'existe pas dans cette tache. Revenez au backlog et rouvrez-la.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Aucun feedback n'a ete enregistre ; consultez les logs " +
  "du serveur pour le detail.";

const HUMAN_CHECK_NEEDS_TEXT_MESSAGE =
  "Vous avez signale un critere que seul un humain peut verifier. NOX n'en possede aucune " +
  "preuve : dites precisement ce que vous avez observe, sans quoi la correction repartirait a " +
  "l'aveugle.";

const HUMAN_CHECK_UNKNOWN_MESSAGE =
  "Un critere signale ne correspond a aucun critere humain de cette tache. Rechargez la page.";

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
  const humanCriterionIds = formData
    .getAll("humanCriterion")
    .filter((value): value is string => typeof value === "string" && value !== "");

  const db = getDatabaseClient();
  let destination = "";

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

    // Ce que NOX possede deja. Les preuves automatisees rendent le texte
    // **facultatif** : elles partent de toute facon, et recopier un code de
    // sortie a la main n'ajouterait rien qu'une occasion de se tromper.
    const cycle = await loadCorrectionContext(db, { runId, taskId });
    const evidenceAvailable = cycle !== null && failedCriteriaOf(cycle.review).length > 0;

    // Les criteres humains sont relus en base : le formulaire designe des
    // identifiants, il n'en definit pas la liste.
    const known = new Set((cycle?.review.humanCriteria ?? []).map((criterion) => criterion.id));
    if (humanCriterionIds.some((id) => !known.has(id))) {
      return { error: HUMAN_CHECK_UNKNOWN_MESSAGE, text };
    }

    const evidenceOnly = text.trim() === "" && evidenceAvailable;
    if (text.trim() === "" && humanCriterionIds.length > 0) {
      // Un critere humain signale sans un mot d'explication ferait repartir la
      // correction a l'aveugle : NOX n'a aucune preuve de ce qui n'allait pas.
      return { error: HUMAN_CHECK_NEEDS_TEXT_MESSAGE, text };
    }

    if (evidenceOnly) {
      // Aucun feedback n'est ecrit : il n'y en a pas. Inventer un texte pour
      // remplir la colonne ferait mentir l'historique — « pourquoi RUN-002
      // existe-t-il ? » doit repondre « les preuves de NOX », pas une phrase
      // que personne n'a tapee.
      destination = correctionEvidenceUrl(projectId, taskId, runId);
    } else {
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
      destination = correctionUrl(projectId, taskId, runId, created.feedback.id, humanCriterionIds);
    }

    revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  } catch (error) {
    console.error("[nox] Echec de l'enregistrement d'un feedback de review :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, text };
  }

  redirect(destination);
}
