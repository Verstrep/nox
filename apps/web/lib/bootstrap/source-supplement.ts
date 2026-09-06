/**
 * Relecture en base du supplement de source d'un amorcage.
 *
 * La decision elle-meme vit dans `source-recovery.ts`, qui est pur et testable
 * sans base. Ce module ne fait que lui apporter ce qu'il faut lire : l'etat
 * structure du projet et sa memoire.
 *
 * ## Il sort tot, et c'est le cas normal
 *
 * Une correction sur une tache produite ordinaire n'a rien a restituer. Le
 * controle de nature se fait donc **avant** toute lecture : la quasi-totalite
 * des corrections ne paie aucune requete de plus.
 */

import { TASK_KIND, TASK_STATUS, type DevelopmentTaskDetail } from "@nox/shared";
import { listActiveProjectMemories, type DatabaseClient } from "@nox/database";

import { loadStructuredState } from "../project-plan.ts";

import {
  prepareBootstrapSourceSupplement,
  type BootstrapSupplementOutcome,
} from "./source-recovery.ts";

export type BootstrapSupplementQuery = {
  task: DevelopmentTaskDetail;
  project: { id: string; repositoryPath: string };
  environment: Record<string, string | undefined>;
};

/**
 * Le supplement qu'une correction de cette tache doit porter, le cas echeant.
 *
 * Lecture seule : ni ecriture, ni runner, ni fournisseur. Un projet dont le
 * brief ou le plan a change depuis la creation de la tache obtient un refus
 * nomme, jamais une fusion silencieuse.
 */
export async function loadBootstrapSourceSupplement(
  db: DatabaseClient,
  query: BootstrapSupplementQuery,
): Promise<BootstrapSupplementOutcome> {
  if (query.task.kind !== TASK_KIND.BOOTSTRAP) {
    return { ok: false, reason: "not_bootstrap" };
  }
  if (query.task.status === TASK_STATUS.COMPLETED) {
    return { ok: false, reason: "task_completed" };
  }

  const [structuredState, memories] = await Promise.all([
    loadStructuredState(db, query.project),
    listActiveProjectMemories(db, query.project.id),
  ]);

  return prepareBootstrapSourceSupplement({
    task: query.task,
    repositoryPath: query.project.repositoryPath,
    structuredState,
    memories,
    environment: query.environment,
  });
}
