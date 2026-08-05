"use server";

import { getDatabaseClient, getProjectById } from "@nox/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  describeUpdateFailure,
  documentUrl,
  readDocumentEditSubmission,
} from "@/lib/document-edit";
import { updateProjectDocument } from "@/lib/runner/client";

import type { EditDocumentState } from "./form-state";

const UNKNOWN_PROJECT_MESSAGE =
  "Ce projet n'existe plus dans NOX. Revenez au tableau de bord et rouvrez-le.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue pendant l'enregistrement. Le document n'a pas ete modifie ; " +
  "consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function withError(values: EditDocumentState["values"], message: string, conflict = false): EditDocumentState {
  return { values, error: message, conflict };
}

/**
 * Enregistre le nouveau contenu d'un document.
 *
 * Le point important est ce que cette fonction **ne prend pas** dans le
 * formulaire : le chemin du repository. Il est relu en base a partir de
 * l'identifiant du projet. Un champ cache modifie dans le navigateur ne peut
 * donc pas diriger l'ecriture vers un autre dossier de la machine.
 *
 * En cas d'echec, le texte saisi est renvoye dans l'etat du formulaire : une
 * erreur ne doit jamais couter a l'utilisateur ce qu'il vient d'ecrire.
 */
export async function updateDocumentAction(
  _previousState: EditDocumentState,
  formData: FormData,
): Promise<EditDocumentState> {
  const projectId = readField(formData, "projectId");
  const submitted = {
    documentPath: readField(formData, "documentPath"),
    content: readField(formData, "content"),
    expectedRevision: readField(formData, "expectedRevision"),
  };

  const submission = readDocumentEditSubmission(submitted);
  if (!submission.ok) {
    return withError(submitted, submission.message);
  }

  const { fields } = submission;

  let repositoryPath: string;
  try {
    const project = await getProjectById(getDatabaseClient(), projectId);
    if (project === null) {
      return withError(fields, UNKNOWN_PROJECT_MESSAGE);
    }
    repositoryPath = project.repositoryPath;
  } catch (error) {
    console.error("[nox] Echec de la lecture du projet avant ecriture :", error);
    return withError(fields, UNEXPECTED_ERROR_MESSAGE);
  }

  const result = await updateProjectDocument(
    repositoryPath,
    fields.documentPath,
    fields.content,
    fields.expectedRevision,
  );

  if (!result.ok) {
    const { message, conflict } = describeUpdateFailure(result.failure);
    return withError(fields, message, conflict);
  }

  // Le document est relu au prochain rendu : NOX affiche ce que contient le
  // fichier, pas ce qui vient d'etre envoye.
  revalidatePath(`/projects/${projectId}/documents`);
  redirect(documentUrl(projectId, result.value.path, { saved: true }));
}
