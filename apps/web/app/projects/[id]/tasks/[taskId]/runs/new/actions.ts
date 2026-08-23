"use server";

import { getDatabaseClient, listQueueEntries } from "@nox/database";
import { isQueueBarrier } from "@nox/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { QUEUE_PENDING_MESSAGE } from "@/lib/queue-display";
import { runUrl } from "@/lib/run-display";
import { launchTaskRun } from "@/lib/run-launch";

import type { StartRunState } from "./form-state";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue avant le lancement. Aucune execution n'a demarre ; " +
  "consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Lance une execution Claude Code sur une tache, a la main.
 *
 * ## Ce que le navigateur envoie, et ce qu'il n'envoie pas
 *
 * Il envoie trois valeurs : l'identifiant du projet, celui de la tache, et le
 * `HEAD` attendu — obtenu du preflight, et de toute facon revalide par le
 * runner. Il n'envoie **ni** chemin de repository, **ni** prompt, **ni** liste
 * d'outils, **ni** commande.
 *
 * ## La file d'execution passe avant
 *
 * Si le projet possede au moins une inscription, ce lancement **initial** est
 * refuse. La raison est l'ordre : l'utilisateur a prepare une file, et un
 * lancement direct la doublerait sans que rien ne le dise. Il lui reste deux
 * chemins evidents — demarrer la file, ou en retirer cette tache.
 *
 * ## Une exception, et une seule : la barriere courante
 *
 * Une tache rouverte apres une relecture reste la barriere de sa file : la file
 * l'attend, et ne la relancera pas d'elle-meme. C'est donc ici qu'elle repart,
 * et refuser ce lancement-la n'empecherait aucun contournement — il rendrait
 * simplement la tache injoignable jusqu'a son retrait de la file. Le refus vise
 * ce qui **double** un ordre prepare ; relancer la tache que la file attend
 * n'est pas ce cas.
 *
 * Ce refus ne concerne **que** le premier lancement d'une tache. Une correction
 * termine un travail deja commence : elle n'est pas un nouvel element de
 * planification, et elle passe par sa propre Server Action, que ce guard ne
 * touche pas.
 *
 * ## Tout le reste appartient au moteur commun
 *
 * `launchTaskRun` revalide le statut, la synchronisation, les criteres, les
 * dependances, les permissions et l'unicite de l'execution active — puis cree le
 * run, appelle le runner et met la tache en `RUNNING`. C'est exactement ce que
 * la file appelle : il n'existe pas de second moteur Claude.
 */
export async function startRunAction(
  _previousState: StartRunState,
  formData: FormData,
): Promise<StartRunState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const expectedGitHead = readField(formData, "expectedGitHead");

  if (expectedGitHead.trim() === "") {
    return { error: "Verification prealable manquante. Rechargez la page avant de lancer." };
  }

  const db = getDatabaseClient();
  let destination: string;

  try {
    // Relu en base, jamais recu du navigateur : la barriere se derive des
    // entrees et du statut des taches, au moment d'agir.
    const entries = await listQueueEntries(db, projectId);
    const barrier = entries.find(isQueueBarrier) ?? null;
    if (entries.length > 0 && barrier?.taskId !== taskId) {
      return { error: QUEUE_PENDING_MESSAGE };
    }

    const launched = await launchTaskRun(db, { projectId, taskId, expectedGitHead });

    revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
    if (!launched.ok) {
      return { error: launched.message };
    }

    revalidatePath(`/projects/${projectId}/tasks`);
    destination = runUrl(projectId, taskId, launched.runId);
  } catch (error) {
    console.error("[nox] Echec du lancement d'une execution :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  redirect(destination);
}
