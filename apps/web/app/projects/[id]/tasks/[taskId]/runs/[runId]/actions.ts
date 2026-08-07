"use server";

import {
  getDatabaseClient,
  getRunById,
  getTaskById,
  markRunCancelling,
} from "@nox/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { checkRunCancellation, describeCancelRefusal } from "@/lib/run-cancel";
import { runUrl } from "@/lib/run-display";
import { cancelClaudeRun } from "@/lib/runner/client";
import { describeRunnerFailure } from "@/lib/runner/errors";

const UNKNOWN_RUN_MESSAGE =
  "Cette execution n'existe pas dans cette tache. Revenez a la tache et rouvrez-la.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue pendant la demande d'arret. L'execution n'a peut-etre " +
  "pas ete interrompue : rechargez la page pour voir son etat reel.";

export type CancelRunState = { error: string | null };

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Demande l'arret d'une execution en cours.
 *
 * ## Ce que le navigateur envoie, et ce qu'il n'envoie pas
 *
 * Trois identifiants : projet, tache, execution. Rien d'autre. **Aucun
 * identifiant de processus**, aucun chemin de repository, aucun jeton, aucun
 * signal systeme, aucune commande `taskkill`, aucun delai, aucune option de
 * forcage. Le seul pouvoir qu'a le formulaire est de designer une execution que
 * NOX connait deja ; la maniere de l'arreter appartient entierement au runner.
 *
 * ## Ce que cette action ne fait pas
 *
 * Elle ne conclut pas l'execution. Elle enregistre une demande et rend la main :
 * c'est la terminaison reelle du processus qui produira `CANCELLED`, et c'est le
 * runner qui la constatera. Ecrire `CANCELLED` ici reviendrait a affirmer une
 * mort qu'on n'a pas vue.
 *
 * Elle ne restaure rien non plus. Ni `git reset`, ni `git restore`, ni
 * suppression de fichier : les modifications partielles laissees par Claude Code
 * sont exactement ce que l'utilisateur doit pouvoir relire.
 */
export async function cancelRunAction(
  _previousState: CancelRunState,
  formData: FormData,
): Promise<CancelRunState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const runId = readField(formData, "runId");

  const db = getDatabaseClient();

  try {
    const run = await getRunById(db, runId);
    if (run === null || run.taskId !== taskId) {
      return { error: UNKNOWN_RUN_MESSAGE };
    }

    // La chaine projet → tache → execution est verifiee entierement : un
    // identifiant devine ne doit pas permettre d'arreter le run d'un autre
    // projet.
    const task = await getTaskById(db, taskId);
    if (task === null || task.projectId !== projectId) {
      return { error: UNKNOWN_RUN_MESSAGE };
    }

    // Meme regle que celle qui decide d'afficher le bouton : la page peut avoir
    // ete rendue il y a cinq minutes, l'execution a pu se terminer depuis.
    const check = checkRunCancellation(run.status);
    if (!check.ok) {
      return { error: describeCancelRefusal(check.reason) };
    }

    const cancelled = await cancelClaudeRun(run.runnerRunId);
    if (!cancelled.ok) {
      return { error: describeRunnerFailure(cancelled.failure) };
    }

    // La base n'apprend `CANCELLING` qu'apres que le runner a accepte : sans
    // cet ordre, un refus laisserait une execution marquee « en cours d'arret »
    // alors que rien n'aurait ete demande a personne.
    await markRunCancelling(db, run.id, new Date(cancelled.value.cancellationRequestedAt));

    revalidatePath(runUrl(projectId, taskId, runId));
    revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  } catch (error) {
    console.error("[nox] Echec d'une demande d'annulation :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  // Retour a la page sans la confirmation ouverte : l'utilisateur voit
  // immediatement `Cancelling` et la timeline poursuit son fil.
  redirect(runUrl(projectId, taskId, runId));
}
