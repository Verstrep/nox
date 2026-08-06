"use server";

import { getDatabaseClient, getProjectById } from "@nox/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { buildDocumentPath } from "@/lib/document-create";
import { documentUrl, normalizeSubmittedContent } from "@/lib/document-edit";
import { createProjectDocument } from "@/lib/runner/client";
import { describeRunnerFailure, isDocumentAlreadyExists } from "@/lib/runner/errors";

import type { CreateDocumentState } from "./form-state";

const UNKNOWN_PROJECT_MESSAGE =
  "Ce projet n'existe plus dans NOX. Revenez au tableau de bord et rouvrez-le.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue pendant la creation. Aucun fichier n'a ete ajoute ; " +
  "consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function withError(
  values: CreateDocumentState["values"],
  message: string,
  existingPath: string | null = null,
): CreateDocumentState {
  return { values, error: message, existingPath };
}

/**
 * Cree un nouveau document Markdown dans le repository du projet.
 *
 * Deux choses ne viennent jamais du navigateur, et c'est ce qui rend l'action
 * sure : le chemin du repository, relu en base a partir de `projectId`, et le
 * chemin relatif final, recompose ici a partir d'une destination validee. Un
 * prefixe falsifie dans le formulaire n'est pas lu — il n'existe pas comme
 * champ.
 *
 * En cas d'echec, destination, nom et contenu sont renvoyes dans l'etat du
 * formulaire : une erreur ne doit pas couter la saisie.
 */
export async function createDocumentAction(
  _previousState: CreateDocumentState,
  formData: FormData,
): Promise<CreateDocumentState> {
  const projectId = readField(formData, "projectId");
  const values = {
    destination: readField(formData, "destination"),
    name: readField(formData, "name"),
    content: readField(formData, "content"),
  };

  const built = buildDocumentPath(values.destination, values.name);
  if (!built.ok) {
    return withError(values, built.message);
  }

  let repositoryPath: string;
  try {
    const project = await getProjectById(getDatabaseClient(), projectId);
    if (project === null) {
      return withError(values, UNKNOWN_PROJECT_MESSAGE);
    }
    repositoryPath = project.repositoryPath;
  } catch (error) {
    console.error("[nox] Echec de la lecture du projet avant creation :", error);
    return withError(values, UNEXPECTED_ERROR_MESSAGE);
  }

  const result = await createProjectDocument(
    repositoryPath,
    built.path,
    normalizeSubmittedContent(values.content),
  );

  if (!result.ok) {
    return withError(
      values,
      describeRunnerFailure(result.failure),
      isDocumentAlreadyExists(result.failure) ? built.path : null,
    );
  }

  // L'inventaire est relu au prochain rendu : le document apparait dans la liste
  // sans qu'aucune copie n'ait ete conservee quelque part.
  revalidatePath(`/projects/${projectId}/documents`);
  redirect(documentUrl(projectId, result.value.path, { created: true }));
}
