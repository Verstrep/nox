"use server";

import {
  getArchitectSession,
  getDatabaseClient,
  getProjectById,
  latestArchitectQuestions,
  saveArchitectClarification,
} from "@nox/database";
import {
  ARCHITECT_ERROR,
  ARCHITECT_LIMITS,
  checkArchitectText,
  normalizeArchitectText,
} from "@nox/shared";
import process from "node:process";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { applyArchitectProposal } from "@/lib/architect/apply";
import { loadArchitectConfig } from "@/lib/architect/config";
import { architectSessionUrl } from "@/lib/architect/display";
import { describeArchitectError, describeArchitectTextRefusal } from "@/lib/architect/errors";
import { OpenAIArchitectProvider } from "@/lib/architect/openai";
import { loadRecentArchitectTasks } from "@/lib/architect/recent-tasks";
import { runArchitectGeneration } from "@/lib/architect/service";
import { taskUrl } from "@/lib/task-display";
import { applyTaskDocumentSync } from "@/lib/tasks";
import type { TaskFormValues } from "@/lib/task-input";

import type { CreateFromProposalState, GenerateProposalState } from "./form-state";

const UNKNOWN_MESSAGE =
  "Cette demande n'existe plus. Revenez a la liste des demandes et recommencez.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Lance une generation, et une seule.
 *
 * ## Ce que le navigateur envoie
 *
 * Trois valeurs : l'identifiant du projet, celui de la session, et les
 * precisions eventuelles. **Rien** d'autre — ni modele, ni schema, ni prompt, ni
 * chemin de repository, ni contexte, ni cle. Tout le reste est derive ici.
 *
 * ## Aucun appel implicite
 *
 * Cette action n'est jamais declenchee par un rendu de page, un minuteur ou un
 * echec precedent. Un clic, un appel. Un echec propose de reessayer ; c'est
 * l'utilisateur qui reclique.
 */
export async function generateProposalAction(
  _previousState: GenerateProposalState,
  formData: FormData,
): Promise<GenerateProposalState> {
  const projectId = readField(formData, "projectId");
  const sessionId = readField(formData, "sessionId");
  const clarificationRaw = normalizeArchitectText(readField(formData, "clarification"));

  try {
    const db = getDatabaseClient();

    const project = await getProjectById(db, projectId);
    if (project === null) {
      return { error: UNKNOWN_MESSAGE, clarification: clarificationRaw };
    }

    const session = await getArchitectSession(db, sessionId);
    if (session === null || session.projectId !== projectId) {
      return { error: UNKNOWN_MESSAGE, clarification: clarificationRaw };
    }

    if (clarificationRaw !== "") {
      const refusal = checkArchitectText(clarificationRaw, ARCHITECT_LIMITS.clarification);
      if (refusal !== null) {
        return {
          error: describeArchitectTextRefusal(refusal, ARCHITECT_LIMITS.clarification),
          clarification: clarificationRaw,
        };
      }
      await saveArchitectClarification(db, sessionId, clarificationRaw);
    }

    // La configuration est lue ici, cote serveur, et n'est jamais rendue : seuls
    // les noms des variables manquantes atteignent l'interface.
    const config = loadArchitectConfig(process.env);
    if (!config.ok) {
      return {
        error: describeArchitectError(ARCHITECT_ERROR.ARCHITECT_NOT_CONFIGURED),
        clarification: clarificationRaw,
      };
    }

    const outcome = await runArchitectGeneration(db, {
      sessionId,
      projectName: project.name,
      repositoryPath: project.repositoryPath,
      request: session.requestText,
      clarification: clarificationRaw === "" ? session.clarificationText : clarificationRaw,
      previousQuestions: latestArchitectQuestions(session),
      tasks: await loadRecentArchitectTasks(db, projectId),
      model: config.config.model,
      provider: new OpenAIArchitectProvider({ apiKey: config.config.apiKey }),
      environment: process.env,
    });

    revalidatePath(architectSessionUrl(projectId, sessionId));
    revalidatePath(`/projects/${projectId}/architect`);

    if (outcome.ok) {
      return { error: null, clarification: "" };
    }

    return {
      error: "code" in outcome ? describeArchitectError(outcome.code) : outcome.message,
      clarification: clarificationRaw,
    };
  } catch (error) {
    console.error("[nox] Echec d'une generation Architecte :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, clarification: clarificationRaw };
  }
}

function readTaskValues(formData: FormData): TaskFormValues {
  return {
    title: readField(formData, "title"),
    priority: readField(formData, "priority"),
    objective: readField(formData, "objective"),
    context: readField(formData, "context"),
    outOfScope: readField(formData, "outOfScope"),
    documents: readField(formData, "documents"),
    criteria: readField(formData, "criteria"),
    commands: readField(formData, "commands"),
  };
}

/**
 * Cree la tache d'une proposition relue.
 *
 * Les champs viennent du formulaire — l'utilisateur a pu les modifier, c'est le
 * but — et sont **entierement revalides** cote serveur. La creation elle-meme
 * passe par le pipeline de TASK-007 : meme numero, meme document, meme statut
 * `DRAFT`.
 */
export async function createTaskFromProposalAction(
  _previousState: CreateFromProposalState,
  formData: FormData,
): Promise<CreateFromProposalState> {
  const projectId = readField(formData, "projectId");
  const sessionId = readField(formData, "sessionId");
  const values = readTaskValues(formData);

  let destination: string;
  try {
    const db = getDatabaseClient();

    const project = await getProjectById(db, projectId);
    if (project === null) {
      return { error: UNKNOWN_MESSAGE, values };
    }

    const session = await getArchitectSession(db, sessionId);
    if (session === null || session.projectId !== projectId) {
      return { error: UNKNOWN_MESSAGE, values };
    }

    const applied = await applyArchitectProposal(db, { sessionId, projectId, values });
    if (!applied.ok) {
      return { error: applied.message, values };
    }

    // A partir d'ici la tache existe. La synchronisation de son document suit
    // exactement le chemin de TASK-007 : un echec laisse la tache intacte, et sa
    // page proposera de reessayer.
    try {
      await applyTaskDocumentSync(applied.task, project.repositoryPath);
    } catch (error) {
      console.error("[nox] Echec de la synchronisation du document de tache :", error);
    }

    revalidatePath(`/projects/${projectId}/tasks`);
    revalidatePath(`/projects/${projectId}/architect`);
    revalidatePath(architectSessionUrl(projectId, sessionId));
    destination = taskUrl(projectId, applied.task.id);
  } catch (error) {
    console.error("[nox] Echec de la creation d'une tache depuis l'Architecte :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, values };
  }

  redirect(destination);
}
