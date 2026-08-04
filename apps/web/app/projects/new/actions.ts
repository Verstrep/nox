"use server";

import {
  createProject,
  findProjectByRepositoryPath,
  getDatabaseClient,
  isUniqueConstraintError,
} from "@nox/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { validateProjectDescription, validateProjectName } from "@/lib/project-input";
import { validateRepositoryPath } from "@/lib/repository-path";

import { NO_ERRORS, type CreateProjectErrors, type CreateProjectState } from "./form-state";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Consultez les logs du serveur pour le detail.";

const DATABASE_ERROR_MESSAGE =
  "Impossible d'enregistrer le projet : la base de donnees locale n'a pas repondu. " +
  "Verifiez que les migrations ont ete appliquees (npm run db:migrate).";

const ALREADY_REGISTERED_MESSAGE =
  "Ce repository est deja enregistre dans NOX (le chemin saisi pointe vers la meme racine Git).";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function withErrors(
  values: CreateProjectState["values"],
  errors: Partial<CreateProjectErrors>,
): CreateProjectState {
  return { values, errors: { ...NO_ERRORS, ...errors } };
}

/**
 * Cree un projet a partir du formulaire.
 *
 * Toute la validation est faite ici, cote serveur : la validation legere du
 * navigateur (attribut `required`) n'est qu'un confort et n'est jamais la seule
 * barriere.
 *
 * Les erreurs metier remontent dans l'etat du formulaire ; les erreurs
 * techniques sont journalisees cote serveur et resumees a l'utilisateur sans
 * detail interne.
 */
export async function createProjectAction(
  _previousState: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const values = {
    name: readField(formData, "name"),
    description: readField(formData, "description"),
    repositoryPath: readField(formData, "repositoryPath"),
  };

  const name = validateProjectName(values.name);
  const description = validateProjectDescription(values.description);

  if (!name.ok || !description.ok) {
    return withErrors(values, {
      name: name.ok ? null : name.message,
      description: description.ok ? null : description.message,
    });
  }

  const repository = await validateRepositoryPath(values.repositoryPath);
  if (!repository.ok) {
    return withErrors(values, { repositoryPath: repository.message });
  }

  const db = getDatabaseClient();
  let projectId: string;

  try {
    const existing = await findProjectByRepositoryPath(db, repository.canonicalPath);
    if (existing !== null) {
      return withErrors(values, { repositoryPath: ALREADY_REGISTERED_MESSAGE });
    }

    const project = await createProject(db, {
      name: name.name,
      description: description.description,
      repositoryPath: repository.canonicalPath,
    });
    projectId = project.id;
  } catch (error) {
    // La contrainte d'unicite reste le dernier rempart si deux soumissions
    // arrivent en meme temps : le pre-controle ci-dessus peut les laisser passer.
    if (isUniqueConstraintError(error)) {
      return withErrors(values, { repositoryPath: ALREADY_REGISTERED_MESSAGE });
    }

    console.error("[nox] Echec de la creation du projet :", error);
    return withErrors(values, {
      form: isDatabaseError(error) ? DATABASE_ERROR_MESSAGE : UNEXPECTED_ERROR_MESSAGE,
    });
  }

  revalidatePath("/");
  redirect(`/projects/${projectId}`);
}

/**
 * Distingue une panne de la base d'une erreur applicative.
 *
 * Les erreurs Prisma exposent un `code` textuel ; on ne remonte jamais ce code
 * brut au navigateur, il sert uniquement a choisir le message affiche.
 */
function isDatabaseError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}
