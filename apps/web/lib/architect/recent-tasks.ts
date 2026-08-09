/**
 * Selection des taches recentes envoyees a l'Architecte.
 *
 * Isolee pour une raison precise : la page de preparation et la generation
 * doivent voir **exactement** le meme contexte. Deux selections, meme voisines,
 * feraient afficher une preview differente de ce qui part — c'est-a-dire un
 * mensonge, sur la seule page dont le role est de dire la verite.
 */

import { getTaskById, listTasksByProject, type DatabaseClient } from "@nox/database";
import type { DevelopmentTaskDetail } from "@nox/shared";

import { ARCHITECT_CONTEXT_LIMITS } from "./context.ts";

/**
 * Les dernieres taches du projet, de la plus recente a la plus ancienne.
 *
 * Le detail est relu tache par tache : le backlog ne porte ni objectif, ni
 * criteres, et c'est precisement ce qui montre a l'architecte la taille attendue
 * d'une tache dans ce projet.
 *
 * L'ordre est celui des numeros, decroissant. Il ne depend ni du statut, ni de
 * la priorite : « recent » veut dire « cree en dernier », et un backlog reordonne
 * pour l'affichage ne doit pas changer le contexte envoye.
 */
export async function loadRecentArchitectTasks(
  db: DatabaseClient,
  projectId: string,
): Promise<DevelopmentTaskDetail[]> {
  const summaries = await listTasksByProject(db, projectId);
  const recent = [...summaries]
    .sort((a, b) => b.code.localeCompare(a.code))
    .slice(0, ARCHITECT_CONTEXT_LIMITS.recentTasks);

  const details: DevelopmentTaskDetail[] = [];
  for (const summary of recent) {
    const task = await getTaskById(db, summary.id);
    if (task !== null) {
      details.push(task);
    }
  }
  return details;
}
