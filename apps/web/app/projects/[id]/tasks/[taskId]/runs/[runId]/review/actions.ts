"use server";

import { TASK_STATUS } from "@nox/shared";
import { revalidatePath } from "next/cache";

import { applyTaskTransitionWithDefaultClient } from "@/lib/task-lifecycle";

import type { ReviewDecisionState } from "./form-state";

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
 *
 * ## Ce qu'`Approve` declenche
 *
 * Accepter une tache est le seul evenement qui fait avancer la file
 * d'execution : son inscription disparait, et NOX tente de lancer la suivante.
 * « Tente » est le mot juste — la file peut etre en pause, la tache suivante
 * peut attendre une dependance, et le repository peut porter des modifications
 * non commitees. Aucun de ces cas n'est une erreur.
 *
 * `Reopen`, lui, ne libere rien : la tache redevient prete, garde sa place en
 * tete de file, et rien ne repart sans un geste explicite.
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
    const outcome = await applyTaskTransitionWithDefaultClient({ projectId, taskId, status });
    if (!outcome.ok) {
      return { error: outcome.message };
    }
  } catch (error) {
    console.error("[nox] Echec d'une decision de review :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  revalidatePath(`/projects/${projectId}/tasks`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/queue`);

  return { error: null, decided: decision };
}
