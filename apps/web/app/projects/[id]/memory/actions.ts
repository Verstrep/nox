"use server";

import { checkProjectMemoryInput, isProjectMemoryStatus } from "@nox/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createMemoryEntry,
  deleteMemoryEntry,
  loadMemoryEntry,
  setMemoryEntryStatus,
  updateMemoryEntry,
} from "@/lib/memory";
import { memoryRefusalMessage, memoryUrl, memoryWriteRefusalMessage } from "@/lib/memory-display";
import { loadProject } from "@/lib/projects";

import type { MemoryActionState, MemoryFormState, MemoryFormValues } from "./form-state";

const UNKNOWN_PROJECT_MESSAGE =
  "Ce projet n'existe pas. Revenez au tableau de bord et rouvrez-le.";

const UNKNOWN_MEMORY_MESSAGE =
  "Cette entree de memoire n'existe pas dans ce projet. Revenez a la memoire et rechargez la page.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function readValues(formData: FormData): MemoryFormValues {
  return {
    category: readField(formData, "category"),
    title: readField(formData, "title"),
    content: readField(formData, "content"),
    rationale: readField(formData, "rationale"),
    status: readField(formData, "status"),
  };
}

function revalidateMemory(projectId: string): void {
  revalidatePath(`/projects/${projectId}/memory`);
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Cree une entree de memoire.
 *
 * ## Ce que cette action ne fait pas
 *
 * Aucun appel a OpenAI, aucun lancement de Claude Code, aucune requete au
 * runner, aucune ecriture de fichier, aucune commande Git. Une memoire est une
 * ligne SQLite : elle appartient a NOX, pas au repository.
 *
 * Le budget est verifie **dans la transaction d'ecriture**, jamais depuis un
 * champ cache du formulaire : le navigateur n'a aucune autorite sur ce qui tient
 * dans le contexte.
 */
export async function createMemoryAction(
  _previousState: MemoryFormState,
  formData: FormData,
): Promise<MemoryFormState> {
  const projectId = readField(formData, "projectId");
  const values = readValues(formData);

  try {
    const project = await loadProject(projectId);
    if (project === null) {
      return { values, error: UNKNOWN_PROJECT_MESSAGE };
    }

    const checked = checkProjectMemoryInput(values);
    if (!checked.ok) {
      return { values, error: memoryRefusalMessage(checked.refusal) };
    }

    const created = await createMemoryEntry(project, checked.values);
    if (!created.ok) {
      return {
        values,
        error: memoryWriteRefusalMessage(
          created.reason,
          created.activeChars === undefined || created.requiredChars === undefined
            ? undefined
            : { activeChars: created.activeChars, requiredChars: created.requiredChars },
        ),
      };
    }

    revalidateMemory(project.id);
  } catch (error) {
    console.error("[nox] Echec de la creation d'une memoire projet :", error);
    return { values, error: UNEXPECTED_ERROR_MESSAGE };
  }

  // Hors du `try` : `redirect` leve une exception de controle que Next.js
  // intercepte, et l'attraper la traiterait comme un echec.
  redirect(memoryUrl(projectId));
}

/**
 * Modifie une entree existante.
 *
 * Le code et le projet ne sont pas modifiables : `sequence` n'est pas touche, et
 * l'appartenance au projet est verifiee ici plutot que recue du formulaire.
 * Modifier `MEM-003` ne produit jamais `MEM-004`.
 */
export async function updateMemoryAction(
  _previousState: MemoryFormState,
  formData: FormData,
): Promise<MemoryFormState> {
  const projectId = readField(formData, "projectId");
  const memoryId = readField(formData, "memoryId");
  const values = readValues(formData);

  try {
    const project = await loadProject(projectId);
    if (project === null) {
      return { values, error: UNKNOWN_PROJECT_MESSAGE };
    }

    // La chaine projet → memoire est verifiee entierement : une entree d'un
    // autre projet est introuvable, pas « refusee ».
    const existing = await loadMemoryEntry(memoryId);
    if (existing === null || existing.projectId !== project.id) {
      return { values, error: UNKNOWN_MEMORY_MESSAGE };
    }

    const checked = checkProjectMemoryInput(values);
    if (!checked.ok) {
      return { values, error: memoryRefusalMessage(checked.refusal) };
    }

    const updated = await updateMemoryEntry(project, memoryId, checked.values);
    if (!updated.ok) {
      return {
        values,
        error: memoryWriteRefusalMessage(
          updated.reason,
          updated.activeChars === undefined || updated.requiredChars === undefined
            ? undefined
            : { activeChars: updated.activeChars, requiredChars: updated.requiredChars },
        ),
      };
    }

    revalidateMemory(project.id);
  } catch (error) {
    console.error("[nox] Echec de la modification d'une memoire projet :", error);
    return { values, error: UNEXPECTED_ERROR_MESSAGE };
  }

  redirect(memoryUrl(projectId));
}

/**
 * Archive ou restaure une entree.
 *
 * Une restauration repasse par le controle du budget : la place qu'occupait
 * cette entree a pu etre prise entre-temps, et NOX prefere refuser plutot que
 * d'activer une memoire qu'il ne pourrait pas transmettre.
 */
export async function setMemoryStatusAction(
  _previousState: MemoryActionState,
  formData: FormData,
): Promise<MemoryActionState> {
  const projectId = readField(formData, "projectId");
  const memoryId = readField(formData, "memoryId");
  const status = readField(formData, "status");

  try {
    if (!isProjectMemoryStatus(status)) {
      return { error: UNKNOWN_MEMORY_MESSAGE };
    }

    const project = await loadProject(projectId);
    if (project === null) {
      return { error: UNKNOWN_PROJECT_MESSAGE };
    }

    const existing = await loadMemoryEntry(memoryId);
    if (existing === null || existing.projectId !== project.id) {
      return { error: UNKNOWN_MEMORY_MESSAGE };
    }

    const updated = await setMemoryEntryStatus(project, memoryId, status);
    if (!updated.ok) {
      return {
        error: memoryWriteRefusalMessage(
          updated.reason,
          updated.activeChars === undefined || updated.requiredChars === undefined
            ? undefined
            : { activeChars: updated.activeChars, requiredChars: updated.requiredChars },
        ),
      };
    }

    revalidateMemory(project.id);
    return { error: null };
  } catch (error) {
    console.error("[nox] Echec du changement de statut d'une memoire projet :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }
}

/**
 * Supprime une entree, apres confirmation.
 *
 * Rien ne s'y oppose, pas meme un ancien manifest Architecte qui la
 * referencerait : ces manifests decrivent un envoi passe et n'ont jamais
 * conserve de contenu. Refuser une suppression pour proteger une trace
 * empecherait d'effacer une information privee saisie par erreur — exactement la
 * raison pour laquelle la suppression existe.
 */
export async function deleteMemoryAction(
  _previousState: MemoryActionState,
  formData: FormData,
): Promise<MemoryActionState> {
  const projectId = readField(formData, "projectId");
  const memoryId = readField(formData, "memoryId");

  try {
    const project = await loadProject(projectId);
    if (project === null) {
      return { error: UNKNOWN_PROJECT_MESSAGE };
    }

    const existing = await loadMemoryEntry(memoryId);
    if (existing === null || existing.projectId !== project.id) {
      return { error: UNKNOWN_MEMORY_MESSAGE };
    }

    await deleteMemoryEntry(memoryId);
    revalidateMemory(project.id);
    return { error: null };
  } catch (error) {
    console.error("[nox] Echec de la suppression d'une memoire projet :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }
}
