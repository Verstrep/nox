/**
 * Regles d'annulation d'une execution, isolees et pures.
 *
 * Ni Prisma, ni `next/server`, ni client runner : ce module decide, il n'agit
 * pas. C'est ce qui le rend testable sans base ni serveur, et c'est aussi ce qui
 * permet a la page **et** a la Server Action d'appliquer exactement la meme
 * regle — l'une pour decider d'afficher le bouton, l'autre pour decider
 * d'obeir.
 *
 * Deux endroits qui repondraient chacun a leur facon a « peut-on annuler ? »
 * finiraient par ne plus etre d'accord, et c'est toujours celui qui agit qui a
 * le dernier mot.
 */

import { RUN_STATUS, isCancellableRunStatus, type RunStatus } from "@nox/shared";

export type CancelCheck =
  | { ok: true }
  | { ok: false; reason: "already_final" | "already_cancelling" };

/**
 * Une execution peut-elle encore recevoir une demande d'arret ?
 *
 * `QUEUED` et `RUNNING` seulement. `CANCELLING` est refuse explicitement plutot
 * que confondu avec un etat final : le message a afficher n'est pas le meme —
 * « c'est deja en cours » n'est pas « c'est fini ».
 */
export function checkRunCancellation(status: RunStatus): CancelCheck {
  if (isCancellableRunStatus(status)) {
    return { ok: true };
  }
  if (status === RUN_STATUS.CANCELLING) {
    return { ok: false, reason: "already_cancelling" };
  }
  return { ok: false, reason: "already_final" };
}

/** Message francais correspondant a un refus. */
export function describeCancelRefusal(reason: "already_final" | "already_cancelling"): string {
  return reason === "already_cancelling"
    ? "L'arret est deja engage. Laissez le processus se terminer : NOX affichera le resultat des qu'il aura ferme."
    : "Cette execution est deja terminee : il n'y a plus rien a interrompre. Rafraichissez la page pour voir son resultat.";
}

/**
 * Avertissement affiche avant de confirmer.
 *
 * Volontairement en francais, et volontairement explicite sur le point qui
 * compte : NOX ne remettra pas le repository dans l'etat d'avant.
 */
export const CANCEL_WARNING =
  "Interrompre Claude Code peut laisser des modifications partielles dans le repository. " +
  "NOX ne restaurera aucun fichier automatiquement.";

/** Message affiche apres une annulation reussie. */
export const CANCELLED_NOTICE =
  "L'execution a ete annulee. Claude Code peut avoir laisse des modifications partielles. " +
  "Verifiez `git status` et `git diff` avant de remettre la tache en Ready.";
