"use server";

import { getDatabaseClient, updateTaskStatus } from "@nox/database";
import { TASK_STATUS } from "@nox/shared";
import { revalidatePath } from "next/cache";

import type { ReviewDecisionState } from "./form-state";

const UNKNOWN_TASK_MESSAGE =
  "Cette tache n'existe pas dans ce projet. Revenez au backlog et rouvrez-la.";

const FORBIDDEN_TRANSITION_MESSAGE =
  "Cette tache n'est plus en review : son statut a change depuis l'affichage de cette page. " +
  "Rechargez-la pour voir l'etat reel.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Accepte ou rejette le travail d'une execution.
 *
 * ## Ce que ces deux boutons ne font pas
 *
 * Ils ne creent **aucun commit**, ne lancent **aucun `git add`**, ne poussent
 * rien, ne restaurent rien et ne relancent rien. Accepter une review, dans NOX,
 * veut dire « j'ai relu, le travail me convient » — pas « enregistre-le pour
 * moi ». Le commit reste une action humaine, faite dans le terminal, avec le
 * message que l'utilisateur choisit.
 *
 * ## Ce que le navigateur envoie
 *
 * Trois identifiants, et une decision prise parmi deux valeurs fermees. Ni
 * statut cible libre, ni chemin, ni contenu. La transition passe par
 * `updateTaskStatus`, seul point de passage vers l'ecriture, qui la revalide
 * contre la table des transitions manuelles : une tache qui aurait quitte
 * `REVIEW` entre l'affichage et le clic est refusee plutot qu'ecrasee.
 */
export async function decideReviewAction(
  _previousState: ReviewDecisionState,
  formData: FormData,
): Promise<ReviewDecisionState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const decision = readField(formData, "decision");

  if (decision !== "approve" && decision !== "reopen") {
    return { error: "Decision inconnue." };
  }

  // La decision est traduite ici, en interne : le navigateur ne choisit pas un
  // statut, il choisit entre deux intentions.
  const status = decision === "approve" ? TASK_STATUS.COMPLETED : TASK_STATUS.READY;

  try {
    const result = await updateTaskStatus(getDatabaseClient(), taskId, projectId, status);

    if (!result.ok) {
      return {
        error:
          result.reason === "not_found" ? UNKNOWN_TASK_MESSAGE : FORBIDDEN_TRANSITION_MESSAGE,
      };
    }
  } catch (error) {
    console.error("[nox] Echec d'une decision de review :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  revalidatePath(`/projects/${projectId}/tasks`);
  revalidatePath(`/projects/${projectId}`);

  return { error: null, decided: decision };
}
