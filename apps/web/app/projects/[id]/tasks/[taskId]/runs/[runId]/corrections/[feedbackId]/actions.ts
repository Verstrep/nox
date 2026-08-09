"use server";

import {
  cancelTaskCorrection,
  failRun,
  getDatabaseClient,
  getProjectById,
  getReviewFeedback,
  getRunResumeContext,
  getTaskById,
  hasActiveRun,
  markRunRunning,
  startCorrectionFromFeedback,
  startTaskCorrection,
} from "@nox/database";
import { RUNNER_ERROR, buildClaudeToolPolicy, checkResumeCandidate } from "@nox/shared";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resumeRefusalMessage } from "@/lib/correction-display";
import { runUrl } from "@/lib/run-display";
import { buildCorrectionPrompt } from "@/lib/run-prompt";
import { snapshotRunValidations } from "@/lib/run-review";
import { claudeCorrectionPreflight, startClaudeRun } from "@/lib/runner/client";
import { describeRunnerFailure } from "@/lib/runner/errors";

import type { StartCorrectionState } from "./form-state";

const UNKNOWN_MESSAGE =
  "Cette demande de correction n'existe plus. Revenez a la review et recommencez.";

const ALREADY_USED_MESSAGE =
  "Ce feedback a deja servi a lancer une correction. Relisez la nouvelle review, puis ecrivez-en " +
  "un autre si besoin.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue avant le lancement. Aucune execution n'a demarre ; " +
  "consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Reprend la session Claude d'une execution relue pour appliquer un feedback.
 *
 * ## Ce que le navigateur envoie
 *
 * Quatre identifiants : projet, tache, execution source, feedback. **Rien**
 * d'autre — ni identifiant de session, ni chemin de repository, ni empreinte, ni
 * liste d'outils, ni argument de ligne de commande. Tout le reste est relu en
 * base a partir de ces quatre-la, et chaque relation est reverifiee : un
 * `runId` d'un autre projet ne designe rien.
 *
 * ## L'ordre des ecritures, et pourquoi il differe d'un run initial
 *
 * Le preflight de correction est appele **avant** toute ecriture. Un dossier de
 * travail qui a change entre-temps est une precondition, pas un echec
 * d'execution : il ne doit laisser ni run fantome dans l'historique, ni feedback
 * consomme. L'utilisateur retablit son repository et reessaie avec le meme texte.
 *
 * Une fois le preflight passe, le run et la consommation du feedback sont ecrits
 * dans une **seule** transaction — sans quoi un double clic lancerait deux
 * reprises de la meme session.
 *
 * Le runner revalide l'empreinte juste avant de lancer le processus. Ce second
 * controle n'est pas une redondance : entre l'affichage vert et le clic,
 * l'utilisateur a eu tout le temps d'enregistrer un fichier dans son editeur.
 */
export async function startCorrectionAction(
  _previousState: StartCorrectionState,
  formData: FormData,
): Promise<StartCorrectionState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const runId = readField(formData, "runId");
  const feedbackId = readField(formData, "feedbackId");

  const db = getDatabaseClient();
  let destination: string;

  try {
    const task = await getTaskById(db, taskId);
    if (task === null || task.projectId !== projectId) {
      return { error: UNKNOWN_MESSAGE };
    }

    const project = await getProjectById(db, projectId);
    if (project === null) {
      return { error: UNKNOWN_MESSAGE };
    }

    const feedback = await getReviewFeedback(db, feedbackId);
    if (feedback === null || feedback.taskId !== taskId || feedback.sourceRunId !== runId) {
      return { error: UNKNOWN_MESSAGE };
    }
    if (feedback.correctionRunId !== null) {
      return { error: ALREADY_USED_MESSAGE };
    }

    const context = await getRunResumeContext(db, runId);
    if (context === null || context.taskId !== taskId) {
      return { error: UNKNOWN_MESSAGE };
    }

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
      return { error: resumeRefusalMessage(refusal) };
    }

    // Les trois valeurs suivantes ne peuvent pas etre nulles ici :
    // `checkResumeCandidate` vient de le garantir. Les relire explicitement evite
    // une assertion de type, et rend le refus lisible si la garantie changeait.
    const sessionId = context.claudeSessionId;
    const fingerprint = context.workspaceFingerprint;
    const branch = context.gitBranch;
    const head = context.gitHeadAfter;
    if (sessionId === null || fingerprint === null || branch === null || head === null) {
      return { error: resumeRefusalMessage("FINGERPRINT_MISSING") };
    }

    // Les commandes sont revalidees pour produire un message precis ; le runner
    // les revalidera de toute facon avant d'en faire des permissions.
    const policy = buildClaudeToolPolicy(task.validationCommands);
    if (!policy.ok) {
      return {
        error: `La commande « ${policy.refusal.command} » ne peut pas etre autorisee : ${policy.refusal.reason}`,
      };
    }

    // Premier controle : aucune ecriture tant qu'il n'est pas passe.
    const preflight = await claudeCorrectionPreflight({
      repositoryPath: project.repositoryPath,
      expectedGitHead: head,
      expectedBranch: branch,
      expectedWorkspaceFingerprint: fingerprint,
    });
    if (!preflight.ok) {
      return { error: describeRunnerFailure(preflight.failure) };
    }

    // Le prompt est regenere ici, a partir de la base : ce n'est pas celui
    // qu'affichait la page qui part, meme s'il lui est identique.
    const { prompt, sha256 } = buildCorrectionPrompt({
      task,
      sourceRunCode: feedback.sourceRunCode,
      feedback: feedback.text,
    });

    const runnerRunId = randomUUID();
    const created = await startCorrectionFromFeedback(db, {
      feedbackId,
      taskId,
      parentRunId: runId,
      prompt,
      promptSha256: sha256,
      runnerRunId,
      resumedFromSessionId: sessionId,
    });
    if (!created.ok) {
      return {
        error: created.reason === "already_used" ? ALREADY_USED_MESSAGE : UNKNOWN_MESSAGE,
      };
    }

    // Les commandes attendues sont recopiees maintenant, comme pour un run
    // initial, et depuis la **specification actuelle** de la tache : une
    // correction doit satisfaire ce que la tache exige aujourd'hui.
    await snapshotRunValidations(created.run.id, task.validationCommands);

    const started = await startClaudeRun({
      runId: runnerRunId,
      repositoryPath: project.repositoryPath,
      prompt,
      expectedGitHead: head,
      validationCommands: [...task.validationCommands],
      correction: {
        sessionId,
        expectedBranch: branch,
        expectedWorkspaceFingerprint: fingerprint,
      },
    });

    if (!started.ok) {
      // La tache n'a jamais quitte `REVIEW` : rien a ramener en arriere de ce
      // cote. Le run, lui, garde la trace du refus — il existe deja.
      await failRun(db, created.run.id, {
        errorCode:
          started.failure.kind === "runner_error"
            ? started.failure.code
            : RUNNER_ERROR.CLAUDE_START_FAILED,
        errorMessage: describeRunnerFailure(started.failure),
        finishedAt: new Date(),
      });
      await cancelTaskCorrection(db, taskId);

      revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
      return { error: describeRunnerFailure(started.failure) };
    }

    await markRunRunning(db, created.run.id, new Date(started.value.startedAt));
    // `REVIEW → RUNNING` : une transition reservee aux corrections, et
    // atteignable par ce seul chemin.
    await startTaskCorrection(db, taskId);

    revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
    revalidatePath(`/projects/${projectId}/tasks`);
    destination = runUrl(projectId, taskId, created.run.id);
  } catch (error) {
    console.error("[nox] Echec du lancement d'une correction :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  redirect(destination);
}
