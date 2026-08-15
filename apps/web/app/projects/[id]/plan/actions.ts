"use server";

import { checkProjectBriefInput, checkProjectV1PlanInput } from "@nox/shared";
import { getDatabaseClient } from "@nox/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { planRefusalMessage, planUrl, planWriteRefusalMessage, readPlanList } from "@/lib/plan-display";
import { saveBrief, savePlan } from "@/lib/project-plan";
import { loadProject } from "@/lib/projects";

import type {
  BriefFormState,
  BriefFormValues,
  V1PlanFormState,
  V1PlanFormValues,
} from "./form-state";

const UNKNOWN_PROJECT_MESSAGE =
  "Ce projet n'existe pas. Revenez au tableau de bord et rouvrez-le.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Lit le jeton de concurrence.
 *
 * Trois cas, et ils ne se confondent pas : une revision, `null` — « je crois
 * qu'aucun objet n'existe » — et l'absence de champ, qui desactiverait le
 * controle. Le formulaire envoie toujours l'un des deux premiers ; le troisieme
 * n'existe que pour un appelant qui sait ce qu'il fait.
 */
function readExpectedRevision(formData: FormData): string | null {
  const value = readField(formData, "expectedRevision");
  return value === "" ? null : value;
}

function revalidatePlan(projectId: string): void {
  revalidatePath(`/projects/${projectId}/plan`);
  revalidatePath(`/projects/${projectId}`);
}

function readBriefValues(formData: FormData): BriefFormValues {
  return {
    summary: readField(formData, "summary"),
    problem: readField(formData, "problem"),
    targetUsers: readField(formData, "targetUsers"),
    desiredOutcome: readField(formData, "desiredOutcome"),
    goals: readField(formData, "goals"),
    nonGoals: readField(formData, "nonGoals"),
  };
}

function readPlanValues(formData: FormData): V1PlanFormValues {
  return {
    goal: readField(formData, "goal"),
    inScope: readField(formData, "inScope"),
    outOfScope: readField(formData, "outOfScope"),
    technicalDirection: readField(formData, "technicalDirection"),
    milestones: readField(formData, "milestones"),
  };
}

/**
 * Enregistre le brief produit.
 *
 * ## Ce que cette action ne fait pas
 *
 * Aucun appel a OpenAI, aucun lancement de Claude Code, aucune requete au
 * runner, aucune ecriture de fichier, aucune commande Git. Le brief est une
 * ligne SQLite : l'enregistrer doit fonctionner runner arrete et sans
 * configuration OpenAI.
 *
 * ## Ce que le serveur refait
 *
 * Tout. Les bornes, la normalisation, la sanitation, le budget commun au brief
 * et au plan, et la comparaison de revision — le tout dans la transaction
 * d'ecriture. Le formulaire n'a fait que decouper des lignes.
 */
export async function saveBriefAction(
  _previousState: BriefFormState,
  formData: FormData,
): Promise<BriefFormState> {
  const projectId = readField(formData, "projectId");
  const values = readBriefValues(formData);

  try {
    const project = await loadProject(projectId);
    if (project === null) {
      return { values, error: UNKNOWN_PROJECT_MESSAGE };
    }

    const checked = checkProjectBriefInput({
      summary: values.summary,
      problem: values.problem,
      targetUsers: values.targetUsers,
      desiredOutcome: values.desiredOutcome,
      goals: readPlanList(values.goals),
      nonGoals: readPlanList(values.nonGoals),
    });
    if (!checked.ok) {
      return { values, error: planRefusalMessage(checked.refusal) };
    }

    const saved = await saveBrief(getDatabaseClient(), project, checked.values, readExpectedRevision(formData));
    if (!saved.ok) {
      // Le texte saisi revient avec le refus : un budget depasse ou une
      // revision perimee ne doit jamais faire perdre ce qui a ete ecrit.
      return { values, error: planWriteRefusalMessage(saved) };
    }

    revalidatePlan(project.id);
  } catch (error) {
    console.error("[nox] Echec de l'enregistrement du brief produit :", error);
    return { values, error: UNEXPECTED_ERROR_MESSAGE };
  }

  // Hors du `try` : `redirect` leve une exception de controle que Next.js
  // intercepte, et l'attraper la traiterait comme un echec.
  redirect(planUrl(projectId));
}

/** Enregistre le plan de V1. Memes garanties que le brief. */
export async function savePlanAction(
  _previousState: V1PlanFormState,
  formData: FormData,
): Promise<V1PlanFormState> {
  const projectId = readField(formData, "projectId");
  const values = readPlanValues(formData);

  try {
    const project = await loadProject(projectId);
    if (project === null) {
      return { values, error: UNKNOWN_PROJECT_MESSAGE };
    }

    const checked = checkProjectV1PlanInput({
      goal: values.goal,
      inScope: readPlanList(values.inScope),
      outOfScope: readPlanList(values.outOfScope),
      technicalDirection: values.technicalDirection,
      milestones: readPlanList(values.milestones),
    });
    if (!checked.ok) {
      return { values, error: planRefusalMessage(checked.refusal) };
    }

    const saved = await savePlan(getDatabaseClient(), project, checked.values, readExpectedRevision(formData));
    if (!saved.ok) {
      return { values, error: planWriteRefusalMessage(saved) };
    }

    revalidatePlan(project.id);
  } catch (error) {
    console.error("[nox] Echec de l'enregistrement du plan de V1 :", error);
    return { values, error: UNEXPECTED_ERROR_MESSAGE };
  }

  redirect(planUrl(projectId));
}
