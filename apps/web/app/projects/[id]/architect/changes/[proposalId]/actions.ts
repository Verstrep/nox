"use server";

import {
  PROJECT_UPDATE_ACTION,
  checkProjectBriefInput,
  checkProjectV1PlanInput,
  type ProjectUpdateTarget,
} from "@nox/shared";
import { getArchitectProjectUpdate, getDatabaseClient } from "@nox/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { architectUrl } from "@/lib/architect/display";
import { planRefusalMessage, readPlanList } from "@/lib/plan-display";
import { loadProject } from "@/lib/projects";
import { synchronizeReplanDocuments } from "@/lib/replan/document-sync";
import {
  applyReplanChange,
  dismissReplanChange,
  loadReplanProposal,
} from "@/lib/replan/service";
import type { ReplanReviewItem } from "@/lib/replan/target";
import { readPlanRows } from "@/lib/verification-fields";

import type { ProjectChangeApplyState, ProjectChangeDismissState } from "./form-state";

const UNKNOWN_MESSAGE =
  "Ce changement n'existe pas dans ce projet. Revenez a la conversation et rechargez la page.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Consultez les logs du serveur pour le detail.";

/** Borne de lecture d'un compteur soumis : un nombre falsifie tronque, il ne boucle pas. */
const MAX_ITEMS = 100;

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function readMany(formData: FormData, field: string): string[] {
  return formData.getAll(field).filter((entry): entry is string => typeof entry === "string");
}

/**
 * Lit la cible relue par l'humain.
 *
 * Les champs sont nommes d'apres leur **position courante** a l'ecran : le
 * serveur lit donc l'ordre valide, jamais celui du fournisseur. L'identite d'une
 * ligne — identifiant de tache ou identifiant temporaire — voyage a part, parce
 * qu'elle ne bouge pas quand la ligne se deplace.
 */
function readItems(formData: FormData): ReplanReviewItem[] {
  const declared = Number.parseInt(readField(formData, "itemCount"), 10);
  if (!Number.isInteger(declared) || declared <= 0) {
    return [];
  }

  const items: ReplanReviewItem[] = [];
  for (let index = 0; index < Math.min(declared, MAX_ITEMS); index += 1) {
    const prefix = `items.${String(index)}.`;
    const at = (field: string): string => readField(formData, `${prefix}${field}`);
    const plan = readPlanRows(formData, prefix);
    const existingTaskId = at("existingTaskId");
    const tempId = at("tempId");

    items.push({
      uid: `submitted-${String(index)}`,
      existingTaskId: existingTaskId === "" ? null : existingTaskId,
      tempId: tempId === "" ? null : tempId,
      code: at("code") === "" ? null : at("code"),
      values: {
        title: at("title"),
        priority: at("priority"),
        objective: at("objective"),
        context: at("context"),
        outOfScope: at("outOfScope"),
        documents: at("documents"),
        criteria: plan.criteria,
        commands: plan.commands,
        dependsOnTaskIds: [],
      },
      dependsOn: readMany(formData, `${prefix}dependsOn`),
    });
  }
  return items;
}

function readBrief(formData: FormData) {
  return {
    summary: readField(formData, "summary"),
    problem: readField(formData, "problem"),
    targetUsers: readField(formData, "targetUsers"),
    desiredOutcome: readField(formData, "desiredOutcome"),
    goals: readField(formData, "goals"),
    nonGoals: readField(formData, "nonGoals"),
  };
}

function readV1Plan(formData: FormData) {
  return {
    goal: readField(formData, "goal"),
    inScope: readField(formData, "inScope"),
    outOfScope: readField(formData, "outOfScope"),
    technicalDirection: readField(formData, "technicalDirection"),
    milestones: readField(formData, "milestones"),
  };
}

function revalidateAfterChange(projectId: string, sessionId: string | null): void {
  revalidatePath(`/projects/${projectId}/plan`);
  revalidatePath(`/projects/${projectId}/tasks`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/architect`);
  revalidatePath(`/projects/${projectId}/architect/changes`);
  if (sessionId !== null) {
    revalidatePath(`/projects/${projectId}/architect/${sessionId}`);
  }
}

/**
 * Applique un changement de projet.
 *
 * ## Ce que cette action ne fait pas
 *
 * Aucun appel a OpenAI, aucun lancement de Claude Code, aucune validation, aucune
 * correction, aucun `git add`, aucun commit, aucun push, aucun demarrage de file.
 * Elle ecrit une transaction SQLite, puis synchronise les documents des taches
 * qui ont reellement change.
 *
 * ## Quelles sections du projet sont ecrites
 *
 * Celles que la **proposition enregistree** declare `SET`, relues cote serveur.
 * Le navigateur ne l'annonce pas : il ne connait pas la semantique du payload du
 * fournisseur, et le laisser la declarer lui donnerait le pouvoir d'ecrire une
 * section que le modele n'avait pas proposee.
 */
export async function applyProjectChangeAction(
  previousState: ProjectChangeApplyState,
  formData: FormData,
): Promise<ProjectChangeApplyState> {
  const projectId = readField(formData, "projectId");
  const proposalId = readField(formData, "proposalId");
  const items = readItems(formData);
  const brief = readBrief(formData);
  const plan = readV1Plan(formData);
  let sessionId: string | null = null;

  const failed = (error: string, stale = false): ProjectChangeApplyState => ({
    items: items.length === 0 ? previousState.items : items,
    brief,
    plan,
    error,
    stale,
  });

  try {
    const project = await loadProject(projectId);
    if (project === null) {
      return failed(UNKNOWN_MESSAGE);
    }

    const db = getDatabaseClient();
    const proposal = await loadReplanProposal(db, project.id, proposalId);
    if (proposal === null) {
      return failed(UNKNOWN_MESSAGE);
    }

    // La cible du projet est construite a partir de ce que la proposition
    // enregistree declare changer, jamais a partir d'un champ du formulaire.
    let projectUpdate: ProjectUpdateTarget | null = null;
    if (proposal.projectUpdateId !== null) {
      const update = await getArchitectProjectUpdate(db, proposal.projectUpdateId);
      if (update === null || update.projectId !== project.id) {
        return failed(UNKNOWN_MESSAGE);
      }

      projectUpdate = { brief: null, plan: null };
      if (update.proposed.brief.action === PROJECT_UPDATE_ACTION.SET) {
        const checked = checkProjectBriefInput({
          summary: brief.summary,
          problem: brief.problem,
          targetUsers: brief.targetUsers,
          desiredOutcome: brief.desiredOutcome,
          goals: readPlanList(brief.goals),
          nonGoals: readPlanList(brief.nonGoals),
        });
        if (!checked.ok) {
          return failed(planRefusalMessage(checked.refusal));
        }
        projectUpdate.brief = checked.values;
      }
      if (update.proposed.plan.action === PROJECT_UPDATE_ACTION.SET) {
        const checked = checkProjectV1PlanInput({
          goal: plan.goal,
          inScope: readPlanList(plan.inScope),
          outOfScope: readPlanList(plan.outOfScope),
          technicalDirection: plan.technicalDirection,
          milestones: readPlanList(plan.milestones),
        });
        if (!checked.ok) {
          return failed(planRefusalMessage(checked.refusal));
        }
        projectUpdate.plan = checked.values;
      }
    }

    const applied = await applyReplanChange(
      db,
      project,
      { proposalId, items, projectUpdate },
      // Les documents sont synchronises **apres** la transaction, un par un, avec
      // les primitives de TASK-007 et TASK-024. Un echec ici ne remet aucune
      // ecriture en cause : il laisse des documents a reprendre.
      synchronizeReplanDocuments,
    );
    if (!applied.ok) {
      return failed(applied.message, applied.stale === true);
    }

    sessionId = await sessionOfProposal(project.id, proposalId);
    revalidateAfterChange(project.id, sessionId);
  } catch (error) {
    console.error("[nox] Echec de l'application d'un changement de projet :", error);
    return failed(UNEXPECTED_ERROR_MESSAGE);
  }

  // Hors du `try` : `redirect` leve une exception de controle que Next.js
  // intercepte, et l'attraper la traiterait comme un echec.
  redirect(
    sessionId === null
      ? architectUrl(projectId)
      : `/projects/${projectId}/architect/${sessionId}`,
  );
}

/**
 * Ecarte un changement de projet, mise a jour du projet comprise.
 *
 * Aucune tache modifiee, aucun brief ecrit, aucun document touche, aucun appel.
 */
export async function dismissProjectChangeAction(
  _previousState: ProjectChangeDismissState,
  formData: FormData,
): Promise<ProjectChangeDismissState> {
  const projectId = readField(formData, "projectId");
  const proposalId = readField(formData, "proposalId");
  let sessionId: string | null = null;

  try {
    const project = await loadProject(projectId);
    if (project === null) {
      return { error: UNKNOWN_MESSAGE };
    }

    const db = getDatabaseClient();
    const dismissed = await dismissReplanChange(db, project, proposalId);
    if (!dismissed.ok) {
      return { error: dismissed.message };
    }

    sessionId = await sessionOfProposal(project.id, proposalId);
    revalidateAfterChange(project.id, sessionId);
  } catch (error) {
    console.error("[nox] Echec de l'abandon d'un changement de projet :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  redirect(
    sessionId === null
      ? architectUrl(projectId)
      : `/projects/${projectId}/architect/${sessionId}`,
  );
}

/** Conversation qui a produit un changement, pour y revenir apres l'action. */
async function sessionOfProposal(projectId: string, proposalId: string): Promise<string | null> {
  const db = getDatabaseClient();
  const proposal = await loadReplanProposal(db, projectId, proposalId);
  if (proposal === null) {
    return null;
  }
  const generation = await db.architectGeneration.findUnique({
    where: { id: proposal.generationId },
    select: { sessionId: true },
  });
  return generation?.sessionId ?? null;
}
