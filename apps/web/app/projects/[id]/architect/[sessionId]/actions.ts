"use server";

import {
  clearArchitectTurnDraft,
  getArchitectSession,
  getDatabaseClient,
  getProjectById,
  type ArchitectSessionView,
} from "@nox/database";
import {
  ARCHITECT_ERROR,
  ARCHITECT_LIMITS,
  checkArchitectText,
  normalizeArchitectText,
  type ArchitectErrorCode,
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
import { reviewArchitectTurn, sendArchitectTurn } from "@/lib/architect/service";
import { taskUrl } from "@/lib/task-display";
import { applyTaskDocumentSync } from "@/lib/tasks";
import type { TaskFormValues } from "@/lib/task-input";

import type { ComposerState, CreateFromProposalState } from "./form-state";

const UNKNOWN_MESSAGE =
  "Cette conversation n'existe plus. Revenez a la liste des conversations et recommencez.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

type LoadedSession = {
  project: { id: string; name: string; repositoryPath: string };
  session: ArchitectSessionView;
};

/**
 * Relit projet et conversation depuis la base.
 *
 * Le navigateur ne fournit que deux identifiants. Le chemin du repository, le
 * modele, le prompt, le schema et le contexte sont derives ici — un formulaire
 * n'en porte aucun, et n'en portera jamais.
 */
async function loadSession(
  projectId: string,
  sessionId: string,
): Promise<LoadedSession | null> {
  const db = getDatabaseClient();
  const project = await getProjectById(db, projectId);
  if (project === null) {
    return null;
  }
  const session = await getArchitectSession(db, sessionId);
  if (session === null || session.projectId !== projectId) {
    return null;
  }
  return { project, session };
}

/** Rafraichit les pages qu'un tour peut avoir changees. */
function revalidateSession(projectId: string, sessionId: string): void {
  revalidatePath(architectSessionUrl(projectId, sessionId));
  revalidatePath(`/projects/${projectId}/architect`);
}

function composerFailure(code: ArchitectErrorCode, message: string): ComposerState {
  return { error: describeArchitectError(code), message };
}

/**
 * Prepare le prochain tour : `Review context`.
 *
 * **Aucun appel au fournisseur.** Cette action lit le repository par le runner,
 * assemble le contexte, calcule son empreinte et enregistre le brouillon. C'est
 * un second clic — `Send to Architect` — qui declenchera l'appel facture.
 */
export async function reviewTurnAction(
  _previousState: ComposerState,
  formData: FormData,
): Promise<ComposerState> {
  const projectId = readField(formData, "projectId");
  const sessionId = readField(formData, "sessionId");
  const submitted = normalizeArchitectText(readField(formData, "message"));

  try {
    const loaded = await loadSession(projectId, sessionId);
    if (loaded === null) {
      return { error: UNKNOWN_MESSAGE, message: submitted };
    }
    if (!loaded.session.conversational) {
      return composerFailure(ARCHITECT_ERROR.ARCHITECT_SESSION_LEGACY, submitted);
    }
    if (loaded.session.appliedTaskId !== null) {
      return composerFailure(ARCHITECT_ERROR.ARCHITECT_ALREADY_APPLIED, submitted);
    }

    // Au premier tour, le message est celui d'ouverture, relu en base. Le
    // navigateur n'en envoie donc aucun : c'est ce qui garantit que le texte
    // affiche dans la liste des conversations et le premier message du
    // transcript ne peuvent pas diverger.
    const opening = loaded.session.messages.length === 0;
    const message = opening ? loaded.session.requestText : submitted;

    const refusal = checkArchitectText(message, ARCHITECT_LIMITS.request);
    if (refusal !== null) {
      return {
        error: describeArchitectTextRefusal(refusal, ARCHITECT_LIMITS.request),
        message,
      };
    }

    const db = getDatabaseClient();
    const config = loadArchitectConfig(process.env);

    const prepared = await reviewArchitectTurn(db, {
      session: loaded.session,
      projectName: loaded.project.name,
      repositoryPath: loaded.project.repositoryPath,
      message,
      tasks: await loadRecentArchitectTasks(db, projectId),
      // Le modele n'entre que dans l'empreinte d'entree : une configuration
      // incomplete n'empeche ni de preparer, ni de relire ce qui partirait.
      model: config.ok ? config.config.model : "",
      environment: process.env,
    });

    revalidateSession(projectId, sessionId);

    if (prepared.ok) {
      return { error: null, message: "" };
    }
    return {
      error: "code" in prepared ? describeArchitectError(prepared.code) : prepared.message,
      message,
    };
  } catch (error) {
    console.error("[nox] Echec de la preparation d'un tour Architecte :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, message: submitted };
  }
}

/**
 * Envoie le tour prepare : `Send to Architect`.
 *
 * Le message vient du **brouillon relu en base**, jamais du formulaire : c'est
 * ainsi qu'on garantit d'envoyer le texte qui a ete prévisualisé. Le contexte
 * est reconstruit et recompare juste avant l'appel — entre l'affichage de la
 * preview et ce clic, un fichier a pu etre enregistre.
 */
export async function sendTurnAction(
  _previousState: ComposerState,
  formData: FormData,
): Promise<ComposerState> {
  const projectId = readField(formData, "projectId");
  const sessionId = readField(formData, "sessionId");

  try {
    const loaded = await loadSession(projectId, sessionId);
    if (loaded === null) {
      return { error: UNKNOWN_MESSAGE, message: "" };
    }

    const config = loadArchitectConfig(process.env);
    if (!config.ok) {
      return composerFailure(ARCHITECT_ERROR.ARCHITECT_NOT_CONFIGURED, "");
    }

    const db = getDatabaseClient();
    const outcome = await sendArchitectTurn(db, {
      session: loaded.session,
      projectName: loaded.project.name,
      repositoryPath: loaded.project.repositoryPath,
      tasks: await loadRecentArchitectTasks(db, projectId),
      model: config.config.model,
      provider: new OpenAIArchitectProvider({ apiKey: config.config.apiKey }),
      environment: process.env,
    });

    revalidateSession(projectId, sessionId);

    if (outcome.ok) {
      return { error: null, message: "" };
    }
    return {
      error: "code" in outcome ? describeArchitectError(outcome.code) : outcome.message,
      message: "",
    };
  } catch (error) {
    console.error("[nox] Echec d'un tour Architecte :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, message: "" };
  }
}

/**
 * Abandonne le tour prepare : `Cancel`.
 *
 * Un brouillon abandonne ne laisse aucune trace dans la conversation. Il n'a
 * jamais ete envoye ; l'inscrire comme message raconterait un echange qui n'a
 * pas eu lieu.
 */
export async function cancelTurnAction(
  _previousState: ComposerState,
  formData: FormData,
): Promise<ComposerState> {
  const projectId = readField(formData, "projectId");
  const sessionId = readField(formData, "sessionId");

  try {
    const loaded = await loadSession(projectId, sessionId);
    if (loaded === null) {
      return { error: UNKNOWN_MESSAGE, message: "" };
    }
    const message = loaded.session.pendingTurn?.messageText ?? "";
    await clearArchitectTurnDraft(getDatabaseClient(), sessionId);
    revalidateSession(projectId, sessionId);
    // Le texte revient dans le composer : l'utilisateur a annule un envoi, pas
    // sa redaction.
    return { error: null, message };
  } catch (error) {
    console.error("[nox] Echec de l'abandon d'un tour Architecte :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, message: "" };
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
 * Cree la tache de la derniere proposition, relue et eventuellement modifiee.
 *
 * Les champs viennent du formulaire — l'utilisateur a pu les modifier, c'est le
 * but — et sont **entierement revalides** cote serveur. La creation elle-meme
 * passe par le pipeline de TASK-007 : meme numero, meme document, meme statut
 * `DRAFT`.
 *
 * Une proposition que la conversation a depassee n'est plus creable : le statut
 * de la session n'est alors plus `PROPOSAL_READY`, et la reservation echoue.
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
    const loaded = await loadSession(projectId, sessionId);
    if (loaded === null) {
      return { error: UNKNOWN_MESSAGE, values };
    }

    const db = getDatabaseClient();
    const applied = await applyArchitectProposal(db, { sessionId, projectId, values });
    if (!applied.ok) {
      return { error: applied.message, values };
    }

    // A partir d'ici la tache existe. La synchronisation de son document suit
    // exactement le chemin de TASK-007 : un echec laisse la tache intacte, et sa
    // page proposera de reessayer.
    try {
      await applyTaskDocumentSync(applied.task, loaded.project.repositoryPath);
    } catch (error) {
      console.error("[nox] Echec de la synchronisation du document de tache :", error);
    }

    revalidatePath(`/projects/${projectId}/tasks`);
    revalidateSession(projectId, sessionId);
    destination = taskUrl(projectId, applied.task.id);
  } catch (error) {
    console.error("[nox] Echec de la creation d'une tache depuis l'Architecte :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, values };
  }

  redirect(destination);
}
