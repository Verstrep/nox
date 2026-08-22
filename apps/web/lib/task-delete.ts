/**
 * Logique de la suppression d'une tache, hors Server Action.
 *
 * Volontairement separee : ce module n'importe ni Prisma, ni Next.js, ni React,
 * ce qui le rend testable directement. Une Server Action ne l'est pas sans
 * demarrer l'application.
 *
 * Rien ici ne touche au disque ni a la base. Le web ne decide que de ce qui
 * releve du metier — le code saisi correspond-il, la tache est-elle dans un etat
 * ou la suppression a un sens — pendant que le runner reste seul juge de ce qui
 * concerne le fichier reel.
 */

import {
  TASK_DOCUMENT_SYNC_STATUS,
  TASK_STATUS,
  type TaskDocumentSyncStatus,
  type TaskStatus,
} from "@nox/shared";

export const TASK_HAS_RUNS_MESSAGE =
  "Cette tache possede un historique d'execution. Elle ne peut pas etre supprimee. " +
  "Une fonctionnalite d'archivage sera ajoutee separement.";

export const TASK_RUNNING_MESSAGE =
  "Une execution est en cours sur cette tache : sa suppression est refusee tant qu'elle n'est " +
  "pas terminee.";

/**
 * Refus lorsqu'une autre tache attend celle-ci.
 *
 * Le message **nomme** les taches concernees. « Suppression impossible » sans
 * dire par qui obligerait a parcourir tout le backlog pour comprendre, et NOX
 * connait deja la reponse.
 */
export function taskHasDependentsMessage(
  dependents: readonly { code: string; title: string }[],
): string {
  const names = dependents.map((entry) => `${entry.code} — ${entry.title}`).join(" ; ");
  return (
    "Cette tache ne peut pas etre supprimee : " +
    `${names} ${dependents.length === 1 ? "en depend" : "en dependent"}. ` +
    "Retirez la dependance depuis la ou les taches concernees, puis reessayez. NOX ne " +
    "modifie pas un plan a votre place."
  );
}

export const TASK_DOCUMENT_CONFLICT_MESSAGE =
  "Le document de cette tache est en conflit : un fichier different occupe son chemin. NOX ne " +
  "supprime pas un fichier dont il ne peut pas affirmer qu'il lui appartient. Ouvrez-le et " +
  "tranchez avant de reessayer.";

export const CONFIRMATION_MISMATCH_MESSAGE =
  "Le code saisi ne correspond pas a celui de la tache. Recopiez-le exactement pour confirmer " +
  "la suppression.";

/**
 * Etat de la tache au moment ou la suppression est demandee.
 *
 * `runCount` est relu en base par l'appelant, jamais recu du navigateur : c'est
 * la seule valeur qui puisse empecher une perte d'historique.
 */
export type TaskDeletionState = {
  code: string;
  status: TaskStatus;
  documentSyncStatus: TaskDocumentSyncStatus;
  runCount: number;
  /**
   * Taches qui attendent celle-ci, relues en base.
   *
   * Verifie **avant** de toucher au document : la suppression retire d'abord le
   * fichier, puis la ligne. Decouvrir le refus au second temps aurait laisse un
   * document supprime et une tache toujours la.
   */
  dependents: readonly { code: string; title: string }[];
};

export type TaskDeletionCheck = { ok: true } | { ok: false; message: string };

/**
 * La tache peut-elle etre supprimee, et le code saisi le confirme-t-il ?
 *
 * Les trois refus sont ordonnes du plus definitif au plus circonstanciel : une
 * tache avec historique ne sera jamais supprimable par cette fonctionnalite,
 * une execution en cours finira, un conflit de document se resout. Le premier
 * message rencontre est donc celui qui apprend le plus.
 *
 * La confirmation est verifiee **en dernier** : dire a l'utilisateur qu'il a mal
 * recopie un code avant de lui apprendre que la suppression est de toute facon
 * impossible serait le faire travailler pour rien.
 */
export function checkTaskDeletion(
  state: TaskDeletionState,
  confirmationCode: string,
): TaskDeletionCheck {
  if (state.runCount > 0) {
    return { ok: false, message: TASK_HAS_RUNS_MESSAGE };
  }

  if (state.dependents.length > 0) {
    return { ok: false, message: taskHasDependentsMessage(state.dependents) };
  }

  if (state.status === TASK_STATUS.RUNNING) {
    return { ok: false, message: TASK_RUNNING_MESSAGE };
  }

  if (state.documentSyncStatus === TASK_DOCUMENT_SYNC_STATUS.CONFLICT) {
    return { ok: false, message: TASK_DOCUMENT_CONFLICT_MESSAGE };
  }

  // Comparaison exacte, aux espaces de bordure pres : un copier-coller entraine
  // souvent une espace, et la refuser pour cela n'apporterait aucune surete.
  if (confirmationCode.trim() !== state.code) {
    return { ok: false, message: CONFIRMATION_MISMATCH_MESSAGE };
  }

  return { ok: true };
}
