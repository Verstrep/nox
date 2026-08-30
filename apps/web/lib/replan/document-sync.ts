/**
 * Mise en accord des documents Markdown apres un changement de projet.
 *
 * ## Pourquoi un module a part
 *
 * C'est le seul endroit du parcours qui touche le runner. L'isoler garde
 * `service.ts` — la ou vivent la validation et l'appel a la transaction —
 * executable sans Next, donc testable de bout en bout sans serveur web.
 *
 * ## La base d'abord, le disque ensuite
 *
 * Ces ecritures ont lieu **apres** la transaction, et aucune d'elles ne la
 * remet en cause. NOX ne pretend a aucune atomicite entre SQLite et un systeme
 * de fichiers : un echec ici laisse un projet correct et des documents a
 * reprendre, etat que NOX modelise et affiche.
 *
 * ## Aucune ecriture Git
 *
 * Les documents de taches sont versionnes : les reecrire peut rendre le
 * repository modifie. C'est un fait annonce, pas un probleme a reparer — il n'y
 * a ici ni `add`, ni commit, ni push.
 */

import { getTaskById, listTaskDependencies, type DatabaseClient } from "@nox/database";

import { deleteTaskDocument } from "../runner/client.ts";
import { describeRunnerFailure } from "../runner/errors.ts";
import { applyTaskDocumentResync, applyTaskDocumentSync } from "../tasks.ts";
import type { ReplanDocumentReport } from "./service.ts";

import type { ReplanApplyOutcome } from "@nox/database";

/**
 * Met les documents Markdown en accord avec ce qui vient d'etre ecrit.
 *
 * ## Seules les taches reellement changees sont reecrites
 *
 * Une tache conservee a l'identique ne voit pas son document touche, et une
 * tache qui n'a change que de place non plus : l'ordre de planification ne
 * figure pas dans le document d'une tache. Reecrire pour rien produirait un
 * repository modifie sans raison — et donc un preflight Git qui arrete une file
 * que personne n'a touchee.
 *
 * ## Une suppression retire le document que NOX a ecrit, et lui seul
 *
 * La revision vient de la base : c'est elle qui prouve que le fichier vise est
 * bien celui de NOX. Un document divergent produit un refus nomme, jamais un
 * ecrasement — exactement la primitive de TASK-007.
 */
export async function synchronizeReplanDocuments(
  db: DatabaseClient,
  project: { id: string; repositoryPath: string },
  outcome: ReplanApplyOutcome,
): Promise<ReplanDocumentReport> {
  const report: ReplanDocumentReport = {
    created: 0,
    rewritten: 0,
    removed: 0,
    problems: [],
  };

  for (const removed of outcome.removed) {
    const result = await deleteTaskDocument(
      project.repositoryPath,
      removed.code,
      removed.documentRevision,
    );
    if (result.ok) {
      report.removed += 1;
    } else {
      report.problems.push({
        code: removed.code,
        message: describeRunnerFailure(result.failure),
      });
    }
  }

  for (const created of outcome.created) {
    const task = await getTaskById(db, created.taskId);
    if (task === null) {
      continue;
    }
    const synced = await applyTaskDocumentSync(task, project.repositoryPath);
    if (synced.documentSyncError === null) {
      report.created += 1;
    } else {
      report.problems.push({ code: created.code, message: synced.documentSyncError });
    }
  }

  for (const updated of outcome.updated) {
    const task = await getTaskById(db, updated.taskId);
    if (task === null) {
      continue;
    }
    const dependencies = await listTaskDependencies(db, updated.taskId);
    const synced = await applyTaskDocumentResync(
      task,
      project.repositoryPath,
      dependencies.dependsOn,
    );
    if (synced.documentSyncError === null) {
      report.rewritten += 1;
    } else {
      report.problems.push({ code: updated.code, message: synced.documentSyncError });
    }
  }

  return report;
}
