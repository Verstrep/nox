/**
 * Libelles et URL d'un changement de projet.
 *
 * Comme partout dans NOX, les libelles sont centralises : un statut affiche a
 * deux endroits differents ne doit pas pouvoir s'y lire de deux facons. Les URL
 * sont construites ici pour la meme raison — une route recopiee a la main dans
 * six composants finit par ne plus exister dans l'un d'eux.
 *
 * Pur : ni base, ni reseau, ni React.
 */

import {
  REPLAN_CHANGE,
  REPLAN_FIELD,
  REPLAN_LOCK_REASON,
  REPLAN_PROPOSAL_STATUS,
  type ReplanChange,
  type ReplanField,
  type ReplanLockReason,
} from "@nox/shared";

/** La revue combinee d'un changement de projet. */
export function projectChangeUrl(projectId: string, proposalId: string): string {
  return `/projects/${projectId}/architect/changes/${proposalId}`;
}

/** L'historique des changements de projet. */
export function projectChangesUrl(projectId: string): string {
  return `/projects/${projectId}/architect/changes`;
}

/** L'inspection technique d'un changement. */
export function projectChangeInspectUrl(projectId: string, proposalId: string): string {
  return `/projects/${projectId}/architect/changes/${proposalId}/inspect`;
}

/** Le sort d'un element, en un mot. */
export function replanChangeLabel(change: ReplanChange): string {
  switch (change) {
    case REPLAN_CHANGE.KEEP:
      return "Unchanged";
    case REPLAN_CHANGE.UPDATE:
      return "Updated";
    case REPLAN_CHANGE.REMOVE:
      return "Removed";
    case REPLAN_CHANGE.ADD:
      return "Added";
  }
}

/** Nom lisible d'un champ du contrat. */
export function replanFieldLabel(field: ReplanField): string {
  switch (field) {
    case REPLAN_FIELD.TITLE:
      return "Titre";
    case REPLAN_FIELD.PRIORITY:
      return "Priorite";
    case REPLAN_FIELD.OBJECTIVE:
      return "Objectif";
    case REPLAN_FIELD.CONTEXT:
      return "Contexte";
    case REPLAN_FIELD.OUT_OF_SCOPE:
      return "Hors perimetre";
    case REPLAN_FIELD.CRITERIA:
      return "Criteres d'acceptation";
    case REPLAN_FIELD.DOCUMENTS:
      return "Documents";
    case REPLAN_FIELD.COMMANDS:
      return "Commandes de validation";
  }
}

/** Statut d'une proposition, tel que l'ecran l'annonce. */
export function replanStatusLabel(status: string): string {
  switch (status) {
    case REPLAN_PROPOSAL_STATUS.APPLIED:
      return "Applied";
    case REPLAN_PROPOSAL_STATUS.DISMISSED:
      return "Dismissed";
    default:
      return "Pending";
  }
}

/**
 * Pourquoi une tache n'est pas replanifiable.
 *
 * Nommee, jamais reduite a « verrouillee » : « cette tache a deja tourne » et
 * « cette tache est inscrite en file » demandent deux gestes differents de la
 * part de l'utilisateur, et un ecran qui les confondrait le laisserait chercher.
 */
export function replanLockLabel(reason: ReplanLockReason): string {
  switch (reason) {
    case REPLAN_LOCK_REASON.BOOTSTRAP:
      return "Amorcage du repository";
    case REPLAN_LOCK_REASON.STARTED:
      return "Deja executee";
    case REPLAN_LOCK_REASON.STATUS:
      return "Statut d'apres execution";
    case REPLAN_LOCK_REASON.QUEUED:
      return "Inscrite dans la file";
  }
}

/** « 2 changes » ou « No change », sans jamais faire dire au singulier un pluriel. */
export function replanCountLabel(count: number, singular: string, plural: string): string {
  if (count === 0) {
    return `No ${singular}`;
  }
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

/**
 * Le resume d'un changement, en quelques lignes.
 *
 * Les axes sont distincts, jamais additionnes : une tache peut etre modifiee
 * **et** deplacee, et les compter deux fois dans un total unique donnerait un
 * nombre que rien ne verifie.
 */
export function replanSummaryLines(summary: {
  added: number;
  updated: number;
  removed: number;
  dependencyChanged: number;
  orderChanged: boolean;
}): string[] {
  const lines: string[] = [];
  if (summary.added > 0) {
    lines.push(replanCountLabel(summary.added, "added", "added"));
  }
  if (summary.updated > 0) {
    lines.push(replanCountLabel(summary.updated, "updated", "updated"));
  }
  if (summary.removed > 0) {
    lines.push(replanCountLabel(summary.removed, "removed", "removed"));
  }
  if (summary.dependencyChanged > 0) {
    lines.push(
      `${String(summary.dependencyChanged)} dependency ${
        summary.dependencyChanged === 1 ? "change" : "changes"
      }`,
    );
  }
  if (summary.orderChanged) {
    lines.push("order changed");
  }
  return lines;
}

/** Message affiche quand un changement ne modifierait rien. */
export const REPLAN_NO_CHANGE_MESSAGE =
  "Ce changement laisserait le plan exactement dans son etat actuel. L'appliquer ne modifierait " +
  "aucune tache et ne toucherait aucun document.";

/** Avertissement affiche au-dessus d'une revue perimee. */
export const REPLAN_STALE_MESSAGE =
  "Ce changement a ete concu a partir d'un etat plus ancien du projet. Il reste entierement " +
  "lisible, mais NOX refusera de l'appliquer : il ne fusionne jamais deux etats tout seul.";
