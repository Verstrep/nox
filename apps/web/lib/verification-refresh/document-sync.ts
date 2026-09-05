/**
 * Mise en accord des documents Markdown apres un rafraichissement.
 *
 * ## Pourquoi un module a part
 *
 * C'est le seul endroit du parcours qui touche le runner. L'isoler garde
 * `service.ts` — la ou vivent la reservation, l'appel et l'ecriture —
 * executable sans Next, donc testable de bout en bout sans serveur web.
 *
 * ## La base d'abord, le disque ensuite
 *
 * Ces ecritures ont lieu **apres** la transaction, et aucune d'elles ne la
 * remet en cause. NOX ne pretend a aucune atomicite entre SQLite et un systeme
 * de fichiers : un echec ici laisse un projet correct et des documents a
 * reprendre, etat que NOX modelise et affiche.
 *
 * ## Seul le plan de verification change dans le fichier
 *
 * Le document d'une tache porte son contrat entier, plan de verification
 * compris. Un rafraichissement n'en modifie qu'une section, mais le document se
 * reecrit d'un bloc — c'est la primitive de TASK-007, sous controle de revision :
 * un fichier modifie a la main produit un conflit nomme, jamais un ecrasement.
 *
 * ## Aucune ecriture Git
 *
 * Les documents de taches sont versionnes : les reecrire peut rendre le
 * repository modifie. C'est un fait annonce, pas un probleme a reparer — il n'y
 * a ici ni `add`, ni commit, ni push.
 */

import { getTaskById, listTaskDependencies, type DatabaseClient } from "@nox/database";

import { applyTaskDocumentResync } from "../tasks.ts";

/**
 * Reecrit les documents des taches dont le plan de verification vient de changer.
 *
 * Celles-la, et aucune autre : reecrire pour rien produirait un repository
 * modifie sans raison, et donc un preflight Git qui arrete une file que personne
 * n'a touchee.
 *
 * Une tache disparue entre la transaction et cet appel est ignoree plutot que
 * de faire echouer l'ensemble : elle ne peut plus avoir de document a mettre en
 * accord.
 */
export async function synchronizeRefreshedDocuments(
  db: DatabaseClient,
  project: { id: string; repositoryPath: string },
  taskIds: readonly string[],
): Promise<void> {
  for (const taskId of taskIds) {
    const task = await getTaskById(db, taskId);
    if (task === null || task.projectId !== project.id) {
      continue;
    }
    const dependencies = await listTaskDependencies(db, taskId);
    await applyTaskDocumentResync(task, project.repositoryPath, dependencies.dependsOn);
  }
}
