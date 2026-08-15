"use server";

import {
  PROJECT_UPDATE_ACTION,
  checkProjectBriefInput,
  checkProjectV1PlanInput,
  type ProjectUpdateTarget,
} from "@nox/shared";
import { getDatabaseClient } from "@nox/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { architectUrl } from "@/lib/architect/display";
import {
  applyProjectUpdate,
  dismissProjectUpdate,
  loadProjectUpdate,
} from "@/lib/architect/project-update";
import { planRefusalMessage, readPlanList } from "@/lib/plan-display";
import { loadProject } from "@/lib/projects";

import type { ProjectUpdateDismissState, ProjectUpdateReviewState } from "./form-state";

const UNKNOWN_MESSAGE =
  "Cette proposition n'existe pas dans ce projet. Revenez a la conversation et rechargez la page.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Consultez les logs du serveur pour le detail.";

const STALE_MESSAGE =
  "Cette proposition a ete construite a partir d'un Project Plan plus ancien. " +
  "Le plan a change depuis : relisez l'etat actuel, et demandez une nouvelle proposition " +
  "a l'Architecte si elle reste utile. NOX ne fusionne jamais deux etats tout seul.";

const NOT_PENDING_MESSAGE =
  "Cette proposition a deja ete traitee. Rechargez la page pour voir son etat actuel.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function readValues(formData: FormData) {
  return {
    brief: {
      summary: readField(formData, "summary"),
      problem: readField(formData, "problem"),
      targetUsers: readField(formData, "targetUsers"),
      desiredOutcome: readField(formData, "desiredOutcome"),
      goals: readField(formData, "goals"),
      nonGoals: readField(formData, "nonGoals"),
    },
    plan: {
      goal: readField(formData, "goal"),
      inScope: readField(formData, "inScope"),
      outOfScope: readField(formData, "outOfScope"),
      technicalDirection: readField(formData, "technicalDirection"),
      milestones: readField(formData, "milestones"),
    },
  };
}

function revalidateAfterAction(projectId: string, sessionId: string | null): void {
  revalidatePath(`/projects/${projectId}/plan`);
  revalidatePath(`/projects/${projectId}`);
  if (sessionId !== null) {
    revalidatePath(`/projects/${projectId}/architect/${sessionId}`);
  }
  revalidatePath(`/projects/${projectId}/architect`);
}

/**
 * Applique une proposition, avec l'etat cible valide par l'utilisateur.
 *
 * ## Ce que cette action ne fait pas
 *
 * Aucun appel a OpenAI, aucun lancement de Claude Code, aucune requete au
 * runner, aucune commande Git. Appliquer une proposition ecrit deux lignes
 * SQLite et change un statut.
 *
 * ## Quelles sections sont ecrites
 *
 * Celles que la **proposition enregistree** declare `SET`, relue ici. Le
 * navigateur ne l'annonce pas : il ne connait pas la semantique du payload du
 * fournisseur, et le laisser la declarer lui donnerait le pouvoir d'ecrire une
 * section que le modele n'avait pas proposee.
 *
 * ## Ce que le serveur revalide
 *
 * Tout. Le texte edite n'est jamais passe par le fournisseur : il traverse les
 * memes bornes, la meme normalisation, la meme sanitation et le meme budget
 * qu'une saisie manuelle. Le fait que la proposition d'origine ait ete valide ne
 * prouve rien sur la valeur editee.
 */
export async function applyProjectUpdateAction(
  _previousState: ProjectUpdateReviewState,
  formData: FormData,
): Promise<ProjectUpdateReviewState> {
  const projectId = readField(formData, "projectId");
  const updateId = readField(formData, "updateId");
  const values = readValues(formData);
  let sessionId: string | null = null;

  try {
    const project = await loadProject(projectId);
    if (project === null) {
      return { values, error: UNKNOWN_MESSAGE };
    }

    const update = await loadProjectUpdate(getDatabaseClient(), project.id, updateId);
    if (update === null) {
      return { values, error: UNKNOWN_MESSAGE };
    }

    const target: ProjectUpdateTarget = { brief: null, plan: null };

    if (update.proposed.brief.action === PROJECT_UPDATE_ACTION.SET) {
      const checked = checkProjectBriefInput({
        summary: values.brief.summary,
        problem: values.brief.problem,
        targetUsers: values.brief.targetUsers,
        desiredOutcome: values.brief.desiredOutcome,
        goals: readPlanList(values.brief.goals),
        nonGoals: readPlanList(values.brief.nonGoals),
      });
      if (!checked.ok) {
        return { values, error: planRefusalMessage(checked.refusal) };
      }
      target.brief = checked.values;
    }

    if (update.proposed.plan.action === PROJECT_UPDATE_ACTION.SET) {
      const checked = checkProjectV1PlanInput({
        goal: values.plan.goal,
        inScope: readPlanList(values.plan.inScope),
        outOfScope: readPlanList(values.plan.outOfScope),
        technicalDirection: values.plan.technicalDirection,
        milestones: readPlanList(values.plan.milestones),
      });
      if (!checked.ok) {
        return { values, error: planRefusalMessage(checked.refusal) };
      }
      target.plan = checked.values;
    }

    const applied = await applyProjectUpdate(getDatabaseClient(), project, updateId, target);
    if (!applied.ok) {
      return { values, error: applyRefusalMessage(applied) };
    }

    sessionId = await sessionOfUpdate(project.id, updateId);
    revalidateAfterAction(project.id, sessionId);
  } catch (error) {
    console.error("[nox] Echec de l'application d'une mise a jour de projet :", error);
    return { values, error: UNEXPECTED_ERROR_MESSAGE };
  }

  // Retour a la conversation : c'est de la que l'utilisateur venait, et c'est
  // la que la carte passera a « applied ».
  redirect(sessionId === null ? architectUrl(projectId) : `/projects/${projectId}/architect/${sessionId}`);
}

/**
 * Ecarte une proposition.
 *
 * Aucune ecriture du brief, aucune ecriture du plan, aucun appel. La proposition
 * reste lisible : ne pas l'avoir retenue est aussi une information.
 */
export async function dismissProjectUpdateAction(
  _previousState: ProjectUpdateDismissState,
  formData: FormData,
): Promise<ProjectUpdateDismissState> {
  const projectId = readField(formData, "projectId");
  const updateId = readField(formData, "updateId");
  let sessionId: string | null = null;

  try {
    const project = await loadProject(projectId);
    if (project === null) {
      return { error: UNKNOWN_MESSAGE };
    }

    const update = await loadProjectUpdate(getDatabaseClient(), project.id, updateId);
    if (update === null) {
      return { error: UNKNOWN_MESSAGE };
    }

    const dismissed = await dismissProjectUpdate(getDatabaseClient(), project, updateId);
    if (!dismissed.ok) {
      return { error: applyRefusalMessage(dismissed) };
    }

    sessionId = await sessionOfUpdate(project.id, updateId);
    revalidateAfterAction(project.id, sessionId);
  } catch (error) {
    console.error("[nox] Echec de l'abandon d'une mise a jour de projet :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  redirect(sessionId === null ? architectUrl(projectId) : `/projects/${projectId}/architect/${sessionId}`);
}

/** Conversation qui a produit une proposition, pour y revenir apres l'action. */
async function sessionOfUpdate(projectId: string, updateId: string): Promise<string | null> {
  const update = await loadProjectUpdate(getDatabaseClient(), projectId, updateId);
  if (update === null) {
    return null;
  }
  const generation = await getDatabaseClient().architectGeneration.findUnique({
    where: { id: update.generationId },
    select: { sessionId: true },
  });
  return generation?.sessionId ?? null;
}

/** Phrase expliquant pourquoi une application ou un abandon a ete refuse. */
function applyRefusalMessage(
  result:
    | { ok: false; reason: "not_found" }
    | { ok: false; reason: "not_pending"; status: string }
    | { ok: false; reason: "stale"; currentBriefRevision: string | null; currentPlanRevision: string | null }
    | { ok: false; reason: "invalid"; field: string }
    | { ok: false; reason: "budget"; used: number; limit: number },
): string {
  switch (result.reason) {
    case "not_found":
      return UNKNOWN_MESSAGE;
    case "not_pending":
      return NOT_PENDING_MESSAGE;
    case "stale":
      return STALE_MESSAGE;
    case "invalid":
      return `Le champ « ${result.field} » est refuse. Corrigez-le avant d'appliquer.`;
    case "budget":
      return (
        "Le Project Brief et le Living V1 Plan depasseraient ensemble la place reservee a " +
        "l'etat structure du projet. Raccourcissez la proposition avant de l'appliquer."
      );
  }
}
