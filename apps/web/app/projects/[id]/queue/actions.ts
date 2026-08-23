"use server";

import {
  dequeueTask,
  enqueueTask,
  getDatabaseClient,
  moveQueueEntry,
  setQueueActive,
} from "@nox/database";
import { revalidatePath } from "next/cache";

import { advanceQueue } from "@/lib/queue";
import { dispatchMessage, queueErrorMessage } from "@/lib/queue-display";

import type { QueueActionState } from "./form-state";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Consultez les logs du serveur pour le détail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function revalidateQueue(projectId: string, taskId: string | null = null): void {
  revalidatePath(`/projects/${projectId}/queue`);
  revalidatePath(`/projects/${projectId}/tasks`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  if (taskId !== null) {
    revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  }
}

/**
 * Inscrit une tache dans la file.
 *
 * **Ne lance rien** quand la file est en pause : l'inscription est une
 * intention, pas un depart. Quand la file est deja active, l'autorisation
 * existe deja — un avancement est alors tente, et l'interface le dit avant le
 * clic plutot qu'apres.
 *
 * Le navigateur envoie deux identifiants. Le statut, la nature, l'existence
 * d'une execution active et l'appartenance a la file sont relus en base, dans la
 * transaction qui ecrit.
 */
export async function enqueueTaskAction(
  _previousState: QueueActionState,
  formData: FormData,
): Promise<QueueActionState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");

  try {
    const db = getDatabaseClient();
    const result = await enqueueTask(db, { projectId, taskId });
    if (!result.ok) {
      return { error: queueErrorMessage(result.code), notice: null };
    }

    // La file deja active porte l'autorisation : inscrire une tache dedans peut
    // donc la faire partir tout de suite. C'est annonce, pas subi.
    const dispatch = await advanceQueue(db, projectId);

    revalidateQueue(projectId, taskId);
    return {
      error: null,
      notice: result.created
        ? `Tâche inscrite dans la file. ${dispatchMessage(dispatch.outcome)}`
        : "Cette tâche était déjà inscrite dans la file.",
    };
  } catch (error) {
    console.error("[nox] Echec d'une inscription dans la file :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, notice: null };
  }
}

/**
 * Retire une tache de la file.
 *
 * Ne change **aucun** statut : « cette tache ne bloque plus cette file » n'est
 * pas « cette tache est abandonnee ». Refuse tant qu'une execution travaille
 * dessus. Vider la file referme son autorisation.
 */
export async function dequeueTaskAction(
  _previousState: QueueActionState,
  formData: FormData,
): Promise<QueueActionState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");

  try {
    const result = await dequeueTask(getDatabaseClient(), { projectId, taskId });
    if (!result.ok) {
      return { error: queueErrorMessage(result.code), notice: null };
    }

    revalidateQueue(projectId, taskId);
    return {
      error: null,
      notice: result.emptied
        ? "Tâche retirée. La file est vide : elle repasse en pause."
        : "Tâche retirée de la file. Son statut n'a pas changé.",
    };
  } catch (error) {
    console.error("[nox] Echec d'un retrait de la file :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, notice: null };
  }
}

/**
 * Deplace une entree d'un cran.
 *
 * L'ordre de la file n'est qu'une preference : les dependances restent
 * autoritaires, et une entree qui attend sera sautee quelle que soit sa
 * position. Deplacer ne change ni le code, ni le numero, ni la provenance d'une
 * tache — et n'appelle personne.
 */
export async function moveQueueEntryAction(
  _previousState: QueueActionState,
  formData: FormData,
): Promise<QueueActionState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const direction = readField(formData, "direction");

  if (direction !== "up" && direction !== "down") {
    return { error: "Direction inconnue.", notice: null };
  }

  try {
    const result = await moveQueueEntry(getDatabaseClient(), { projectId, taskId, direction });
    if (!result.ok) {
      return { error: queueErrorMessage(result.code), notice: null };
    }

    revalidateQueue(projectId, taskId);
    return { error: null, notice: null };
  } catch (error) {
    console.error("[nox] Echec d'un deplacement dans la file :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, notice: null };
  }
}

/**
 * Ouvre l'autorisation permanente et tente un premier avancement.
 *
 * C'est le geste humain qui compte : a partir d'ici, NOX peut lancer les taches
 * **deja inscrites** quand elles deviennent eligibles, sans redemander. Il ne
 * lance jamais une tache qui n'est pas dans la file, et jamais plus d'une a la
 * fois.
 *
 * Si rien n'est eligible, la file reste active et l'ecran dit ce qu'elle attend.
 */
export async function startQueueAction(
  _previousState: QueueActionState,
  formData: FormData,
): Promise<QueueActionState> {
  const projectId = readField(formData, "projectId");

  try {
    const db = getDatabaseClient();
    const activated = await setQueueActive(db, projectId, true);
    if (!activated.ok) {
      return { error: queueErrorMessage(activated.code), notice: null };
    }

    const dispatch = await advanceQueue(db, projectId);
    revalidateQueue(projectId);
    return { error: null, notice: dispatchMessage(dispatch.outcome) };
  } catch (error) {
    console.error("[nox] Echec du demarrage de la file :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, notice: null };
  }
}

/**
 * Referme l'autorisation permanente.
 *
 * **N'annule aucune execution.** Un processus en cours continue jusqu'a sa fin :
 * la pause ne concerne que ce qui partirait apres lui. Annuler serait une
 * seconde decision, et elle a son propre bouton.
 */
export async function pauseQueueAction(
  _previousState: QueueActionState,
  formData: FormData,
): Promise<QueueActionState> {
  const projectId = readField(formData, "projectId");

  try {
    const paused = await setQueueActive(getDatabaseClient(), projectId, false);
    if (!paused.ok) {
      return { error: queueErrorMessage(paused.code), notice: null };
    }

    revalidateQueue(projectId);
    return {
      error: null,
      notice:
        "File mise en pause. Une exécution déjà lancée continue : la pause ne concerne que les " +
        "démarrages suivants.",
    };
  } catch (error) {
    console.error("[nox] Echec de la mise en pause de la file :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, notice: null };
  }
}

/**
 * Relance le dispatcher sans rien changer d'autre.
 *
 * Ni l'ordre, ni les taches, ni l'autorisation : cette action appelle le meme
 * dispatcher que les autres evenements. Elle sert surtout apres un commit fait a
 * la main hors de NOX — le repository redevient propre, et la file peut repartir
 * sans qu'aucun evenement applicatif ne se soit produit entre-temps.
 */
export async function tryNextQueueAction(
  _previousState: QueueActionState,
  formData: FormData,
): Promise<QueueActionState> {
  const projectId = readField(formData, "projectId");

  try {
    const dispatch = await advanceQueue(getDatabaseClient(), projectId);
    revalidateQueue(projectId);
    return {
      error: null,
      notice: dispatch.message ?? dispatchMessage(dispatch.outcome),
    };
  } catch (error) {
    console.error("[nox] Echec d'une tentative d'avancement de la file :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, notice: null };
  }
}
