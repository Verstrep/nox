/**
 * Chargement de l'etat de planification pour un tour de conversation.
 *
 * Un seul point d'entree, appele a l'identique par l'apercu du contexte et par
 * l'envoi. Les deux voient donc exactement le meme plan : afficher une preview
 * construite autrement reviendrait a mentir sur ce qui part.
 *
 * Une session de **conception de tache** n'en recoit aucun. Elle ne replanifie
 * rien, son comportement est fige depuis TASK-014, et lui transmettre un plan
 * changerait retroactivement le sens de ses generations passees.
 */

import {
  ARCHITECT_SESSION_KIND,
  type ArchitectSessionKind,
} from "@nox/shared";
import {
  loadReplanPlanningState,
  type DatabaseClient,
  type ReplanPlanningState,
} from "@nox/database";

/**
 * Lit le plan de travail d'un projet, ou `null` quand il n'a pas lieu d'etre.
 *
 * La disponibilite reelle — un backlog initial applique — n'est pas tranchee
 * ici : elle l'est par `buildReplanPlanningContext`, qui possede la regle et
 * peut la refuser proprement. Ce module lit ; il ne decide pas.
 */
export async function loadReplanState(
  db: DatabaseClient,
  kind: ArchitectSessionKind,
  projectId: string,
): Promise<ReplanPlanningState | null> {
  if (kind !== ARCHITECT_SESSION_KIND.PROJECT) {
    return null;
  }
  return loadReplanPlanningState(db, projectId);
}
