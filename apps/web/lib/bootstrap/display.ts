/**
 * Affichage de l'amorcage d'un projet.
 *
 * ## Ce module ne decide de rien
 *
 * Il traduit : des URL, des libelles, et les phrases qui expliquent un refus.
 * Les preconditions, les verrous et la peremption appartiennent au serveur ;
 * les redire ici les ferait diverger le jour ou l'une des deux changerait.
 *
 * ## Aucun second cycle de vie
 *
 * L'etat affiche est **derive** de la tache : pas de colonne, pas de machine a
 * etats parallele. `TASK-000` a deja `DRAFT`, `READY`, `RUNNING`, `REVIEW`,
 * `COMPLETED` — en inventer une seconde serie garantirait qu'un jour les deux
 * se contrediraient.
 *
 * Pur et sans dependance : ni base, ni React, ni reseau.
 */

import { TASK_STATUS, type TaskStatus } from "@nox/shared";

/** Page d'amorcage d'un projet. */
export function bootstrapUrl(projectId: string): string {
  return `/projects/${projectId}/bootstrap`;
}

/** Inspection du contexte d'amorcage. */
export function bootstrapContextUrl(projectId: string): string {
  return `/projects/${projectId}/bootstrap/context`;
}

/**
 * Etat de la surface Amorcage, tel que la page l'annonce.
 *
 * Trois etats seulement, et le troisieme delegue : des que `TASK-000` existe,
 * c'est **son** statut qui est affiche.
 */
export type BootstrapSurfaceState =
  /** Aucune tache d'amorcage, et une precondition manque. */
  | "blocked"
  /** Aucune tache d'amorcage, et tout est reuni pour en creer une. */
  | "available"
  /** La tache existe : son statut fait foi. */
  | "prepared";

export function bootstrapStateLabel(state: BootstrapSurfaceState): string {
  switch (state) {
    case "blocked":
      return "Not prepared";
    case "available":
      return "Ready to prepare";
    case "prepared":
      return "Prepared";
  }
}

/**
 * Precondition manquante, nommee.
 *
 * Un message par cause : « quelque chose manque » laisserait l'utilisateur sans
 * geste a poser, alors que chacune de ces phrases dit ou aller.
 */
export type BootstrapBlocker =
  | "brief_missing"
  | "plan_missing"
  | "backlog_missing"
  | "repository_unreachable"
  | "source_oversized";

export function bootstrapBlockerMessage(blocker: BootstrapBlocker): string {
  switch (blocker) {
    case "brief_missing":
      return "Project Brief missing — definissez le brief produit avant d'amorcer le repository.";
    case "plan_missing":
      return "Living V1 Plan missing — definissez le plan de V1 avant d'amorcer le repository.";
    case "backlog_missing":
      return "Applied V1 backlog missing — generez puis appliquez un backlog : l'amorcage prepare le repository pour ces taches-la.";
    case "repository_unreachable":
      return "Repository unreachable — NOX n'a pas pu inspecter le repository. Demarrez le runner, puis rechargez.";
    case "source_oversized":
      return (
        "Project source too large — l'etat produit valide ne tient pas dans le contrat " +
        "d'amorcage. NOX refuse de creer une tache qui ne transporterait qu'une partie du " +
        "brief, du plan ou de la memoire : reduisez-les, puis rechargez."
      );
  }
}

/**
 * Ce que le refus de fidelite dit reellement, champ compris.
 *
 * Le libelle generique ci-dessus sert la liste ; celui-ci sert la page, qui a
 * la place de nommer le champ en cause. Un refus qui ne dit pas ou regarder
 * envoie relire six ecrans.
 */
export const BOOTSTRAP_SOURCE_REFUSAL_TITLE = "Source d'amorcage non transportable";

/** L'amorcage annonce ce qu'il ne coute pas : c'est une information utile. */
export const BOOTSTRAP_FREE_NOTICE =
  "This action calls no AI. TASK-000 is built deterministically from the project state.";

/** Ce que la page explique, avant toute action. */
export const BOOTSTRAP_INTRODUCTION =
  "TASK-000 prepares the repository and foundational project documentation before product implementation tasks are executed.";

export const BOOTSTRAP_STALE_MESSAGE =
  "Le projet ou le repository a change depuis cet apercu. NOX ne cree pas une tache fondee sur un etat qui n'existe plus : rechargez la page pour obtenir un apercu a jour.";

export const BOOTSTRAP_ALREADY_EXISTS_MESSAGE =
  "Ce projet possede deja sa tache d'amorcage. Un projet n'en a qu'une : ouvrez-la plutot.";

export const BOOTSTRAP_UNKNOWN_MESSAGE =
  "NOX n'a pas pu creer la tache d'amorcage. Consultez les logs du serveur pour le detail.";

/**
 * Libelle du statut d'une tache d'amorcage, pour la carte compacte.
 *
 * Les libelles de statut restent ceux de `lib/labels.ts` : cette fonction ne
 * fait qu'y renvoyer, elle n'en cree aucun second jeu.
 */
export function bootstrapTaskDone(status: TaskStatus): boolean {
  return status === TASK_STATUS.COMPLETED;
}
