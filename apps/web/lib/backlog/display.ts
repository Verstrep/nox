/**
 * Affichage du backlog de V1.
 *
 * ## Ce module ne decide de rien
 *
 * Il traduit : des URL, des libelles, et les phrases qui expliquent un refus.
 * Aucune regle metier n'y vit — les bornes, les verrous et la peremption
 * appartiennent au serveur, et les redire ici les ferait diverger le jour ou
 * l'une des deux changerait.
 *
 * Pur et sans dependance : ni base, ni React, ni reseau.
 */

import {
  ARCHITECT_BACKLOG_LIMITS,
  ARCHITECT_BACKLOG_PROPOSAL_STATUS,
  type ArchitectBacklogProposalStatus,
} from "@nox/shared";

/** Page du backlog d'un projet. */
export function backlogUrl(projectId: string): string {
  return `/projects/${projectId}/backlog`;
}

/** Revue d'une proposition de backlog. */
export function backlogReviewUrl(projectId: string, proposalId: string): string {
  return `/projects/${projectId}/backlog/${proposalId}`;
}

/** Inspection du contexte de planification. */
export function backlogContextUrl(projectId: string): string {
  return `/projects/${projectId}/backlog/context`;
}

/**
 * Etat de la surface Backlog, tel que la page l'annonce.
 *
 * Cinq etats, et ils ne se confondent pas :
 *
 * - `not_generated` : aucune planification n'a jamais abouti.
 * - `generating`    : un appel est en vol.
 * - `proposal_ready`: un backlog attend une decision, et il est encore fonde.
 * - `stale`         : un backlog attend une decision, mais le projet a change.
 * - `applied`       : le dernier backlog a produit des taches.
 * - `dismissed`     : la derniere planification a ete ecartee sans rien creer.
 */
export type BacklogSurfaceState =
  | "not_generated"
  | "generating"
  | "proposal_ready"
  | "stale"
  | "applied"
  | "dismissed";

/** Libelle affiche pour un etat de surface. */
export function backlogStateLabel(state: BacklogSurfaceState): string {
  switch (state) {
    case "generating":
      return "Generating backlog…";
    case "proposal_ready":
      return "Proposal ready";
    case "stale":
      return "Stale";
    case "applied":
      return "Applied";
    case "dismissed":
      return "Dismissed";
    default:
      return "Not generated";
  }
}

/** Libelle affiche pour le statut d'une proposition. */
export function backlogProposalStatusLabel(status: ArchitectBacklogProposalStatus): string {
  switch (status) {
    case ARCHITECT_BACKLOG_PROPOSAL_STATUS.APPLIED:
      return "Applied";
    case ARCHITECT_BACKLOG_PROPOSAL_STATUS.DISMISSED:
      return "Dismissed";
    default:
      return "Pending";
  }
}

/** Accord du decompte de taches d'un backlog. */
export function backlogTaskCountLabel(count: number): string {
  if (count === 0) {
    return "No task";
  }
  return count === 1 ? "1 task" : `${String(count)} tasks`;
}

/** Accord du decompte de taches creees. */
export function backlogCreatedCountLabel(count: number): string {
  return count === 1 ? "1 Draft task created" : `${String(count)} Draft tasks created`;
}

/**
 * Ce qui empeche une planification, dit en une phrase actionnable.
 *
 * Chaque refus decrit un **geste** : definir le plan, attendre, decider du
 * backlog en attente. Un message unique pour trois causes differentes
 * laisserait l'utilisateur sans rien a faire.
 */
export function backlogRefusalMessage(
  refusal: "no_plan" | "active" | "pending_proposal" | "not_found",
): string {
  switch (refusal) {
    case "no_plan":
      return "Definissez d'abord le Living V1 Plan : sans cible validee, un backlog n'aurait rien a atteindre.";
    case "active":
      return "Une planification est deja en cours pour ce projet. Rechargez la page dans un instant.";
    case "pending_proposal":
      return "Un backlog attend deja une decision. Appliquez-le ou ecartez-le avant d'en generer un autre.";
    default:
      return "Ce projet n'existe plus. Rechargez la page et recommencez.";
  }
}

/**
 * Ce que l'utilisateur lit quand sa proposition est perimee.
 *
 * Elle nomme les cinq sources possibles plutot qu'une seule : NOX sait que
 * l'empreinte a change, pas toujours laquelle de ses composantes. Affirmer
 * « le plan a change » quand c'est une entree de memoire enverrait chercher au
 * mauvais endroit.
 */
export const BACKLOG_STALE_MESSAGE = [
  "This backlog was generated from an older project state.",
  "Le Project Plan, la memoire, les taches existantes ou la documentation ont change depuis.",
  "Generez un nouveau backlog avant d'appliquer celui-ci.",
].join(" ");

/** Ce que l'utilisateur lit quand la fraicheur n'a pas pu etre verifiee. */
export const BACKLOG_UNKNOWN_FRESHNESS_MESSAGE =
  "NOX n'a pas pu relire le repository, et ne sait donc pas si ce backlog est encore a jour. Verifiez que le runner tourne.";

/** Avertissement de cout, affiche a cote de l'action de generation. */
export const BACKLOG_GENERATE_NOTICE = "This action calls OpenAI once.";

/** Rappel du nombre maximal d'elements, pour l'ecran de revue. */
export function backlogMaxTasksLabel(): string {
  return `${String(ARCHITECT_BACKLOG_LIMITS.tasks.max)} taches au maximum`;
}

/**
 * Deplace un element dans une liste, et rend une **nouvelle** liste.
 *
 * Pure et sans effet de bord : c'est ce qui permet de la tester sans rendre
 * quoi que ce soit, et a l'interface de la rejouer sans surprise. Un
 * deplacement hors des bornes rend la liste inchangee plutot que de la
 * reordonner de travers.
 */
export function moveBacklogItem<TItem>(
  items: readonly TItem[],
  from: number,
  to: number,
): TItem[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) {
    return [...items];
  }
  next.splice(to, 0, moved);
  return next;
}

/** Retire un element d'une liste, et rend une **nouvelle** liste. */
export function removeBacklogItem<TItem>(items: readonly TItem[], index: number): TItem[] {
  if (index < 0 || index >= items.length) {
    return [...items];
  }
  return items.filter((_unused, position) => position !== index);
}
