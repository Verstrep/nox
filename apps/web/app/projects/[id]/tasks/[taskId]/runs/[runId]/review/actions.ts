"use server";

import { getDatabaseClient, type ReviewDecisionInput } from "@nox/database";
import { TASK_STATUS } from "@nox/shared";
import { revalidatePath } from "next/cache";

import { runAutonomousValidation } from "@/lib/autonomous-validation";
import { REVIEW_APPROVAL_ERROR, checkReviewApproval } from "@/lib/review-decision";
import { applyTaskTransitionWithDefaultClient } from "@/lib/task-lifecycle";

import type { ReviewDecisionState, RetryValidationState } from "./form-state";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function isText(value: FormDataEntryValue): value is string {
  return typeof value === "string" && value !== "";
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
  const runId = readField(formData, "runId");
  const decision = readField(formData, "decision");

  if (decision !== "approve" && decision !== "reopen") {
    return { error: "Decision inconnue." };
  }

  // La decision est traduite ici, en interne : le navigateur ne choisit pas un
  // statut, il choisit entre deux intentions.
  const status = decision === "approve" ? TASK_STATUS.COMPLETED : TASK_STATUS.READY;

  try {
    let approval: ReviewDecisionInput | undefined;

    if (decision === "approve") {
      // Tout est relu ici : le lot, ses resultats, les criteres humains reels.
      // Le formulaire ne fait que designer des identifiants, et un bouton
      // desactive cote client ne prouve rien.
      const check = await checkReviewApproval(getDatabaseClient(), {
        runId,
        taskId,
        confirmedCriterionIds: formData.getAll("humanCriterion").filter(isText),
        overrideReason: readField(formData, "overrideReason"),
        override: readField(formData, "override") === "1",
      });

      if (!check.ok) {
        return {
          error: check.message,
          overrideRequired: check.code === REVIEW_APPROVAL_ERROR.OVERRIDE_REQUIRED,
        };
      }

      approval = {
        runId,
        source: check.source,
        overrideReason: check.overrideReason,
        confirmations: check.confirmations,
      };
    }

    const outcome = await applyTaskTransitionWithDefaultClient({
      projectId,
      taskId,
      status,
      decision: approval,
    });
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

const RETRY_REFUSED_MESSAGE =
  "Cette validation ne peut pas etre relancee. Rechargez la page : une reprise n'existe que " +
  "lorsque NOX n'a pas pu obtenir de preuve, jamais lorsqu'une commande a reellement echoue.";

/**
 * Rejoue les validations autonomes d'une execution.
 *
 * ## Ce que cette action fait, et ce qu'elle ne fait pas
 *
 * Elle relance **les memes commandes**, celles du contrat de la tache, relues en
 * base. Elle n'appelle ni OpenAI, ni Claude Code, ne cree aucun commit et ne
 * touche pas a Git. Ce n'est pas une nouvelle execution : c'est la meme preuve,
 * demandee une seconde fois parce que la premiere n'a pas pu etre obtenue.
 *
 * ## Ce que le navigateur envoie
 *
 * Trois identifiants. Ni commande, ni chemin, ni delai, ni option. Un formulaire
 * forge ne peut donc pas transformer une reprise en autre chose.
 *
 * ## Pourquoi le refus n'est pas decide ici
 *
 * `reserveValidationBatch` n'ouvre une tentative que sur un lot `ERROR`, et le
 * fait par une mise a jour conditionnelle. Deux clics simultanes n'en produisent
 * donc qu'une, et cette action n'a pas a rejouer ce controle : elle constate.
 */
export async function retryValidationAction(
  _previousState: RetryValidationState,
  formData: FormData,
): Promise<RetryValidationState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const runId = readField(formData, "runId");

  try {
    const outcome = await runAutonomousValidation(getDatabaseClient(), runId, { retry: true });
    if (outcome.ran === false) {
      return { error: RETRY_REFUSED_MESSAGE };
    }
  } catch (error) {
    console.error("[nox] Echec de la reprise d'un lot de validation :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  revalidatePath(`/projects/${projectId}/tasks`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/queue`);

  return { error: null };
}
