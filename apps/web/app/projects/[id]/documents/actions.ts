"use server";

import { getDatabaseClient, getProjectById } from "@nox/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  describeDeleteFailure,
  readDocumentDeleteSubmission,
} from "@/lib/document-delete";
import {
  describeUpdateFailure,
  documentUrl,
  documentsUrl,
  readDocumentEditSubmission,
} from "@/lib/document-edit";
import { deleteProjectDocument, updateProjectDocument } from "@/lib/runner/client";

import type { DeleteDocumentState, EditDocumentState } from "./form-state";

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

const DELETE_UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue pendant la suppression. Le document n'a pas ete supprime ; " +
  "consultez les logs du serveur pour le detail.";

/**
 * Supprime un document Markdown ordinaire.
 *
 * Le formulaire ne transporte que trois valeurs : l'identifiant du projet, le
 * chemin relatif du document et la revision affichee. Le chemin du repository
 * est relu en base — un champ cache altere ne peut donc pas diriger la
 * suppression vers un autre dossier de la machine.
 *
 * Les documents de tache sont refuses ici **et** par le runner. Ce n'est pas une
 * duplication de logique : c'est la meme fonction de `@nox/shared`, appelee une
 * fois pour eviter un aller-retour certain, et une fois pour trancher.
 */
export async function deleteDocumentAction(
  _previousState: DeleteDocumentState,
  formData: FormData,
): Promise<DeleteDocumentState> {
  const projectId = readField(formData, "projectId");
  const submitted = {
    documentPath: readField(formData, "documentPath"),
    expectedRevision: readField(formData, "expectedRevision"),
  };

  const submission = readDocumentDeleteSubmission(submitted);
  if (!submission.ok) {
    return { error: submission.message, conflict: false };
  }

  const { fields } = submission;

  let repositoryPath: string;
  try {
    const project = await getProjectById(getDatabaseClient(), projectId);
    if (project === null) {
      return { error: UNKNOWN_PROJECT_MESSAGE, conflict: false };
    }
    repositoryPath = project.repositoryPath;
  } catch (error) {
    console.error("[nox] Echec de la lecture du projet avant suppression :", error);
    return { error: DELETE_UNEXPECTED_ERROR_MESSAGE, conflict: false };
  }

  const result = await deleteProjectDocument(
    repositoryPath,
    fields.documentPath,
    fields.expectedRevision,
  );

  if (!result.ok) {
    const { message, conflict } = describeDeleteFailure(result.failure);
    return { error: message, conflict };
  }

  // Retour a la liste, sans `path` : le document ouvert n'existe plus, et
  // reafficher son URL produirait aussitot une erreur de lecture.
  revalidatePath(`/projects/${projectId}/documents`);
  redirect(documentsUrl(projectId, { deleted: result.value.path }));
}
