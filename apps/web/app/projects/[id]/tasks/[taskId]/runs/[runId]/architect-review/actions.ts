"use server";

import { ARCHITECT_ERROR } from "@nox/shared";
import { getDatabaseClient } from "@nox/database";
import process from "node:process";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { loadArchitectConfig } from "@/lib/architect/config";
import { ARCHITECT_OPERATION, describeArchitectError } from "@/lib/architect/errors";
import { OpenAIArchitectProvider } from "@/lib/architect/openai";
import { architectAnalysisUrl, architectReviewUrl } from "@/lib/architect/review-display";
import { loadArchitectReviewContext } from "@/lib/architect/review-load";
import { analyzeArchitectReview } from "@/lib/architect/review-service";
import { reviewUrl } from "@/lib/review-display";

import type { AnalyzeReviewState } from "./form-state";

const UNKNOWN_MESSAGE =
  "Cette execution n'existe plus, ou sa review n'est plus lisible. Revenez a la review.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Lance l'analyse : `Analyze review`.
 *
 * C'est le **seul** endroit de NOX qui declenche un appel de review, et il n'est
 * atteignable que par un clic. Ni le chargement d'une page, ni la fin d'une
 * execution, ni un rafraichissement ne passent par ici.
 *
 * Le navigateur ne fournit que trois identifiants et l'empreinte affichee par
 * la preview. Le chemin du repository, la specification, les patches, le modele,
 * le prompt et le schema sont derives cote serveur — un formulaire n'en porte
 * aucun, et n'en portera jamais.
 */
export async function analyzeReviewAction(
  _previousState: AnalyzeReviewState,
  formData: FormData,
): Promise<AnalyzeReviewState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const runId = readField(formData, "runId");
  const expectedInputHash = readField(formData, "inputHash");

  let destination: string;
  try {
    const context = await loadArchitectReviewContext(projectId, taskId, runId);
    if (context === null) {
      return { error: UNKNOWN_MESSAGE };
    }
    if (context.review.capturedAt === null) {
      return { error: describeArchitectError(ARCHITECT_ERROR.ARCHITECT_REVIEW_UNAVAILABLE) };
    }

    const config = loadArchitectConfig(process.env);
    if (!config.ok) {
      return { error: describeArchitectError(ARCHITECT_ERROR.ARCHITECT_NOT_CONFIGURED) };
    }

    const outcome = await analyzeArchitectReview(getDatabaseClient(), {
      runId: context.runId,
      task: context.task,
      run: context.run,
      review: context.review,
      repositoryPath: context.project.repositoryPath,
      model: config.config.model,
      environment: process.env,
      provider: new OpenAIArchitectProvider({ apiKey: config.config.apiKey }),
      expectedInputHash,
    });

    revalidatePath(architectReviewUrl(projectId, taskId, runId));
    revalidatePath(reviewUrl(projectId, taskId, runId));

    if (!outcome.ok) {
      return { error: describeArchitectError(outcome.code, ARCHITECT_OPERATION.REVIEW) };
    }

    destination = architectAnalysisUrl(projectId, taskId, runId, outcome.analysis.id);
  } catch (error) {
    console.error("[nox] Echec d'une analyse de review Architecte :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  redirect(destination);
}
