"use server";

import {
  cancelTaskExecution,
  createRun,
  failRun,
  getDatabaseClient,
  getProjectById,
  getTaskById,
  markRunRunning,
  startTaskExecution,
} from "@nox/database";
import {
  RUNNER_ERROR,
  TASK_DOCUMENT_SYNC_STATUS,
  TASK_STATUS,
  buildClaudeToolPolicy,
} from "@nox/shared";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { runUrl } from "@/lib/run-display";
import { buildExecutionPrompt } from "@/lib/run-prompt";
import { startClaudeRun } from "@/lib/runner/client";
import { describeRunnerFailure } from "@/lib/runner/errors";

import type { StartRunState } from "./form-state";

const UNKNOWN_TASK_MESSAGE =
  "Cette tache n'existe pas dans ce projet. Revenez au backlog et rouvrez-la.";

const NOT_READY_MESSAGE =
  "Seule une tache au statut « Prete » peut etre lancee. Rechargez la page pour voir son statut actuel.";

const NOT_SYNCED_MESSAGE =
  "Le document Markdown de cette tache n'est pas synchronise. Claude Code doit pouvoir le lire : creez-le avant de lancer.";

const NO_CRITERIA_MESSAGE =
  "Cette tache n'a aucun critere d'acceptation. Sans critere, personne ne pourra dire si l'execution a reussi.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue avant le lancement. Aucune execution n'a demarre ; " +
  "consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Lance une execution Claude Code sur une tache.
 *
 * ## Ce que le navigateur envoie, et ce qu'il n'envoie pas
 *
 * Il envoie trois valeurs : l'identifiant du projet, celui de la tache, et le
 * `HEAD` attendu — obtenu du preflight, et de toute facon revalide par le
 * runner. Il n'envoie **ni** chemin de repository, **ni** prompt, **ni** liste
 * d'outils, **ni** commande. Le prompt est regenere ici a partir de la tache en
 * base, et les commandes sont relues de la meme facon : un formulaire altere ne
 * peut donc pas elargir ce que l'agent aura le droit de faire.
 *
 * ## L'ordre des ecritures
 *
 * Le run est cree avant l'appel au runner, et la tache ne passe en `RUNNING`
 * qu'apres acceptation. Un refus laisse donc une trace consultable — le run
 * porte son echec — sans jamais afficher un travail en cours qui n'existe pas.
 */
export async function startRunAction(
  _previousState: StartRunState,
  formData: FormData,
): Promise<StartRunState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const expectedGitHead = readField(formData, "expectedGitHead");

  if (expectedGitHead.trim() === "") {
    return { error: "Verification prealable manquante. Rechargez la page avant de lancer." };
  }

  const db = getDatabaseClient();
  let destination: string;

  try {
    const task = await getTaskById(db, taskId);
    // Le projet fait partie du filtre, pas d'une verification apres coup : une
    // tache d'un autre projet est introuvable, exactement comme une tache
    // inexistante.
    if (task === null || task.projectId !== projectId) {
      return { error: UNKNOWN_TASK_MESSAGE };
    }

    if (task.status !== TASK_STATUS.READY) {
      return { error: NOT_READY_MESSAGE };
    }

    if (task.documentSyncStatus !== TASK_DOCUMENT_SYNC_STATUS.SYNCED) {
      return { error: NOT_SYNCED_MESSAGE };
    }

    if (task.acceptanceCriteria.length === 0) {
      return { error: NO_CRITERIA_MESSAGE };
    }

    // Les commandes sont verifiees ici pour produire un message precis ; le
    // runner les revalidera de toute facon avant d'en faire des permissions.
    const policy = buildClaudeToolPolicy(task.validationCommands);
    if (!policy.ok) {
      return {
        error: `La commande « ${policy.refusal.command} » ne peut pas etre autorisee : ${policy.refusal.reason}`,
      };
    }

    const project = await getProjectById(db, projectId);
    if (project === null) {
      return { error: UNKNOWN_TASK_MESSAGE };
    }

    // Le prompt est regenere maintenant, a partir de la base : ce n'est pas
    // celui qu'affichait la page qui est envoye, meme s'il lui est identique.
    const { prompt, sha256 } = buildExecutionPrompt(task);

    const runnerRunId = randomUUID();
    const run = await createRun(db, { taskId, prompt, promptSha256: sha256, runnerRunId });
    if (run === null) {
      return { error: UNKNOWN_TASK_MESSAGE };
    }

    const started = await startClaudeRun({
      runId: runnerRunId,
      repositoryPath: project.repositoryPath,
      prompt,
      expectedGitHead,
      validationCommands: [...task.validationCommands],
    });

    if (!started.ok) {
      // L'execution n'a jamais demarre : le run garde la trace de l'echec, et
      // la tache reste disponible pour un nouvel essai.
      await failRun(db, run.id, {
        errorCode:
          started.failure.kind === "runner_error"
            ? started.failure.code
            : RUNNER_ERROR.CLAUDE_START_FAILED,
        errorMessage: describeRunnerFailure(started.failure),
        finishedAt: new Date(),
      });
      await cancelTaskExecution(db, taskId);

      revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
      return { error: describeRunnerFailure(started.failure) };
    }

    await markRunRunning(db, run.id, new Date(started.value.startedAt));
    await startTaskExecution(db, taskId);

    revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
    revalidatePath(`/projects/${projectId}/tasks`);
    destination = runUrl(projectId, taskId, run.id);
  } catch (error) {
    console.error("[nox] Echec du lancement d'une execution :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  redirect(destination);
}
