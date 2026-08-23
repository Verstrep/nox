"use server";

import { getDatabaseClient } from "@nox/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { deleteProjectFromNox, renameProjectInNox } from "@/lib/project-lifecycle";

import type { DeleteProjectState, RenameProjectState } from "./form-state";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Consultez les logs du serveur pour le détail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Renomme un projet.
 *
 * Le formulaire ne transporte que l'identifiant du projet et le nom saisi.
 * Aucun appel au fournisseur, aucun Claude Code, aucune commande Git : c'est
 * une ecriture SQLite, et la page fonctionne runner arrete.
 */
export async function renameProjectAction(
  _previousState: RenameProjectState,
  formData: FormData,
): Promise<RenameProjectState> {
  const projectId = readField(formData, "projectId");
  const name = readField(formData, "name");

  let outcome;
  try {
    outcome = await renameProjectInNox(getDatabaseClient(), projectId, name);
  } catch (error) {
    console.error("[nox] Echec du renommage d'un projet :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, notice: null };
  }

  if (!outcome.ok) {
    return { error: outcome.message, notice: null };
  }

  // Une sauvegarde sans changement ne ment pas sur ce qu'elle a fait : rien n'a
  // ete ecrit, et la phrase le dit.
  if (!outcome.changed) {
    return { error: null, notice: "Le nom est inchangé : rien n'a été enregistré." };
  }

  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/settings`);
  return { error: null, notice: `Le projet s'appelle désormais « ${outcome.name} ».` };
}

/**
 * Supprime un projet de NOX.
 *
 * ## Ce que le navigateur envoie
 *
 * Deux valeurs : l'identifiant du projet et le nom recopie a la main. Ni chemin
 * de repository, ni chemin de document, ni liste d'artefacts, ni revision, ni
 * drapeau de forcage. Le serveur relit tout le reste en base au moment d'agir —
 * ce qui rend un formulaire altere sans prise sur les fichiers supprimes.
 *
 * ## Ce qu'elle ne fait jamais
 *
 * Aucun appel OpenAI, aucun Claude Code, aucune commande Git. Elle ne supprime
 * ni code source, ni `.git`, ni documentation applicative : seuls les documents
 * `tasks/TASK-xxx.md` dont NOX a enregistre la revision sont retires.
 */
export async function deleteProjectAction(
  _previousState: DeleteProjectState,
  formData: FormData,
): Promise<DeleteProjectState> {
  const projectId = readField(formData, "projectId");
  const confirmationName = readField(formData, "confirmationName");

  let outcome;
  try {
    outcome = await deleteProjectFromNox(getDatabaseClient(), projectId, confirmationName);
  } catch (error) {
    console.error("[nox] Echec de la suppression d'un projet :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  if (!outcome.ok) {
    return { error: outcome.message };
  }

  revalidatePath("/");
  // La confirmation voyage dans l'URL, sous forme de **compteurs** : le projet
  // n'existe plus, et il n'y a donc plus aucune ligne ou l'accrocher. Le texte,
  // lui, est reconstruit par le tableau de bord — une URL forgee ne peut pas
  // faire afficher une phrase arbitraire.
  redirect(
    `/?deleted=1&removed=${String(outcome.removed)}&modified=${String(outcome.modified)}`,
  );
}
