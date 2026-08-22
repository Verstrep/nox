/**
 * Edition d'une tache future, avant sa premiere execution.
 *
 * ## Ce que cet editeur est, et ce qu'il n'est pas
 *
 * Il corrige un contrat **qui n'a pas encore servi**. Un backlog applique
 * materialise des taches d'un coup ; on en relit une, on y voit un detail
 * discutable, et on veut le changer sans regenerer le lot entier.
 *
 * Il ne reecrit **jamais** une tache qui a deja tourne. Une specification
 * executee est un fait historique : le prompt envoye, la review capturee et les
 * validations enregistrees s'y rattachent. La modifier apres coup ferait mentir
 * tout ce qui la cite. Les corrections d'un travail deja produit passent par
 * `Request changes` et `Reopen`, qui existent deja — NOX n'a pas besoin d'une
 * seconde facon de reecrire une tache.
 *
 * ## Le seul critere : aucune execution
 *
 * Pas « le statut est brouillon », pas « la tache est recente » : `runCount === 0`.
 * Une tache passee en `FAILED` puis rouverte a un historique, donc elle est
 * figee, meme si son statut ressemble a celui d'une tache neuve. Le statut dit
 * ou en est le travail ; le nombre d'executions dit s'il a commence.
 *
 * Module **pur** : ni base, ni disque, ni reseau.
 */

import { TASK_STATUS, createStatusGuard, type TaskStatus } from "./statuses.js";

/** Refus possibles d'une edition. */
export const TASK_EDIT_ERROR = {
  /** La tache n'existe pas dans ce projet. */
  UNKNOWN_TASK: "TASK_EDIT_UNKNOWN_TASK",
  /** Elle possede un historique d'execution : sa specification est figee. */
  FROZEN: "TASK_EDIT_FROZEN",
  /** Son statut n'est pas un statut d'avant-execution. */
  STATUS_NOT_EDITABLE: "TASK_EDIT_STATUS_NOT_EDITABLE",
  /** Elle a change depuis l'ouverture du formulaire. */
  STALE: "TASK_EDIT_STALE",
} as const;

export type TaskEditErrorCode = (typeof TASK_EDIT_ERROR)[keyof typeof TASK_EDIT_ERROR];

export const TASK_EDIT_ERROR_CODES: readonly TaskEditErrorCode[] = Object.values(TASK_EDIT_ERROR);

export const isTaskEditErrorCode = createStatusGuard(TASK_EDIT_ERROR_CODES);

/**
 * Statuts depuis lesquels une tache peut etre editee.
 *
 * Deux, et deliberement pas davantage. `RUNNING`, `REVIEW`, `FAILED` et
 * `COMPLETED` supposent tous une execution, donc tombent deja sous la regle du
 * gel. `BLOCKED` peut n'en supposer aucune — une tache mise de cote a la main —
 * mais l'y ajouter demanderait de decider ce que « editer une tache bloquee »
 * signifie, et rien ne le demande aujourd'hui : les transitions existantes
 * ramenent la tache en brouillon, ou l'editeur redevient disponible.
 */
export const EDITABLE_TASK_STATUSES: readonly TaskStatus[] = [
  TASK_STATUS.DRAFT,
  TASK_STATUS.READY,
];

export const isEditableTaskStatus = createStatusGuard(EDITABLE_TASK_STATUSES);

/** Etat de la tache au moment ou l'edition est demandee. */
export type TaskEditEligibility = {
  status: TaskStatus;
  /** Nombre d'executions, relu en base. Jamais recu du navigateur. */
  runCount: number;
};

export type TaskEditGate = { ok: true } | { ok: false; code: TaskEditErrorCode };

/**
 * La tache peut-elle passer par l'editeur de tache future ?
 *
 * Le gel est verifie **avant** le statut : une tache rouverte apres un echec est
 * `READY` avec un historique, et lui repondre « statut non editable » serait
 * faux. Ce qui l'empeche, c'est son passe, pas son etat actuel.
 */
export function checkTaskEditable(state: TaskEditEligibility): TaskEditGate {
  if (state.runCount > 0) {
    return { ok: false, code: TASK_EDIT_ERROR.FROZEN };
  }
  if (!isEditableTaskStatus(state.status)) {
    return { ok: false, code: TASK_EDIT_ERROR.STATUS_NOT_EDITABLE };
  }
  return { ok: true };
}

/**
 * Statut apres une edition.
 *
 * `READY` est un contrat qu'un humain a valide pour execution. Si son contenu
 * change, la validation ne porte plus sur rien : la tache redescend en `DRAFT`,
 * et il faut la remettre en file explicitement.
 *
 * Une sauvegarde qui ne change rien ne change donc rien — statut compris. Ce
 * n'est pas une optimisation : degrader `READY` parce qu'un formulaire a ete
 * ouvert puis referme serait une punition pour avoir relu.
 */
export function taskStatusAfterEdit(status: TaskStatus, contractChanged: boolean): TaskStatus {
  if (status === TASK_STATUS.READY && contractChanged) {
    return TASK_STATUS.DRAFT;
  }
  return status;
}
