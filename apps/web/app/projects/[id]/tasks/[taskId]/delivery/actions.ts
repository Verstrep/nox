"use server";

import { getDatabaseClient } from "@nox/database";
import { DELIVERY_TRIGGER } from "@nox/shared";
import { revalidatePath } from "next/cache";

import { deliveryRefusalMessage } from "@/lib/delivery-display";
import { prepareDelivery, retryDeliveryPush, runDelivery } from "@/lib/git-delivery";

import type { DeliveryActionState } from "./form-state";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Aucune écriture Git n'a été confirmée ; consultez les " +
  "logs du serveur pour le détail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function revalidate(projectId: string, taskId: string): void {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/queue`);
  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  revalidatePath(`/projects/${projectId}/tasks/${taskId}/delivery`);
}

/**
 * Livre le travail valide d'une tache, sur un geste humain.
 *
 * ## Ce que le navigateur envoie
 *
 * Trois valeurs : l'identifiant du projet, celui de la tache, et si le commit
 * doit etre pousse. Ni chemin de repository, ni branche, ni remote, ni liste de
 * fichiers, ni empreinte, ni message de commit, ni argument Git. Tout est relu
 * cote serveur a partir de la livraison enregistree — ce qui rend un formulaire
 * altere sans prise sur ce qui est ecrit.
 *
 * ## Les memes gardes que l'automatique
 *
 * Un clic humain ne desactive aucune verification. Le repository doit
 * correspondre exactement au candidat valide, l'index doit etre vide, la branche
 * doit etre la bonne, un fichier sensible nouveau bloque toujours. Manuel veut
 * dire « c'est vous qui déclenchez », jamais « les gardes sont levées ».
 *
 * Une seule difference, et elle est documentee : un hook de commit ou une
 * signature configuree font renoncer la livraison **automatique**, parce que
 * personne ne regarde. Ici quelqu'un regarde — le hook s'executera normalement,
 * NOX ne passe jamais `--no-verify`.
 */
export async function deliverAction(
  _previousState: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const deliveryId = readField(formData, "deliveryId");
  const push = readField(formData, "push") === "1";

  let outcome;
  try {
    outcome = await runDelivery(getDatabaseClient(), {
      deliveryId,
      trigger: DELIVERY_TRIGGER.MANUAL,
      push,
    });
  } catch (error) {
    console.error("[nox] Echec d'une livraison Git demandee :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, notice: null };
  }

  revalidate(projectId, taskId);

  if (!outcome.ok) {
    return { error: outcome.message, notice: null };
  }

  const sha = outcome.delivery.commitSha?.slice(0, 12) ?? "";
  return {
    error: null,
    notice: push
      ? `Commit ${sha} créé et poussé vers l'upstream de la branche.`
      : `Commit ${sha} créé. Aucun push : la branche locale est en avance sur son upstream.`,
  };
}

/**
 * Rejoue le seul push d'une livraison dont le commit existe deja.
 *
 * Zero `git add`, zero commit — la garantie est structurelle : cette action
 * appelle une fonction qui n'a aucun chemin vers la phase de commit. Reprendre
 * la livraison entiere apres un push refuse creerait un second commit identique,
 * et c'est exactement ce que ce bouton separe existe pour empecher.
 */
export async function retryPushAction(
  _previousState: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const deliveryId = readField(formData, "deliveryId");

  let outcome;
  try {
    outcome = await retryDeliveryPush(getDatabaseClient(), deliveryId);
  } catch (error) {
    console.error("[nox] Echec d'une reprise de push :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, notice: null };
  }

  revalidate(projectId, taskId);

  return outcome.ok
    ? { error: null, notice: "Le commit a été poussé vers l'upstream de la branche." }
    : { error: outcome.message, notice: null };
}

/**
 * Reinspecte le repository pour definir un candidat.
 *
 * Utile dans un seul cas : la tache a ete validee alors que le runner ne
 * repondait pas, et aucun candidat n'a pu etre enregistre. Cette action est
 * explicitement humaine, et n'ecrit rien dans Git — elle lit l'etat du
 * repository et enregistre une ligne SQLite.
 */
export async function refreshDeliveryAction(
  _previousState: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");

  let outcome;
  try {
    outcome = await prepareDelivery(getDatabaseClient(), { projectId, taskId });
  } catch (error) {
    console.error("[nox] Echec de la preparation d'une livraison :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE, notice: null };
  }

  revalidate(projectId, taskId);

  return outcome.ok
    ? { error: null, notice: "Le candidat de livraison a été relu depuis le repository." }
    : { error: deliveryRefusalMessage(outcome.code), notice: null };
}
