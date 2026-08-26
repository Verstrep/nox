/**
 * Suppression de l'etat NOX d'un projet.
 *
 * ## Ce qui est supprime, et ce qui ne l'est pas
 *
 * Toutes les lignes qui appartiennent au projet, dans les vingt tables qui en
 * dependent directement ou par un enfant. Rien d'autre : le repository, son
 * code, son `.git` et sa documentation ne sont pas la responsabilite de ce
 * module — ils ne sont meme pas a sa portee.
 *
 * ## Pourquoi un ordre explicite plutot que les cascades du schema
 *
 * Sept relations du schema sont en `Restrict`, et chacune l'est pour une bonne
 * raison : `Run.task`, `ReviewFeedback.task`, `ReviewFeedback.sourceRun`,
 * `Task.backlogProposal`, `ArchitectSession.appliedTask`,
 * `ArchitectGeneration.appliedTask` et `TaskDependency.dependsOn`. Elles
 * protegent des suppressions accidentelles a l'unite — et elles refuseraient
 * exactement de la meme facon une suppression de projet, qui est pourtant
 * legitime.
 *
 * Les contourner en desactivant les contraintes, ou en reinitialisant la base,
 * n'est pas une option. Le seul geste correct est de supprimer dans l'ordre :
 * les petits-enfants, puis les enfants, puis le projet. C'est ce que fait ce
 * module, en **une** transaction, avec un ordre ecrit une seule fois.
 *
 * ## Pourquoi les compteurs sont retournes
 *
 * Chaque `deleteMany` rend son compte, et la fonction les rend tous. Ce n'est
 * pas un journal : c'est ce qui permet a un test de verifier que la liste des
 * tables couvertes est **complete**, sans reciter cette liste une seconde fois
 * ailleurs. Une table ajoutee au schema et oubliee ici doit faire echouer un
 * test, pas surgir en production.
 */

import { ACTIVE_RUN_STATUSES, formatTaskCode } from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/**
 * Tables supprimees, dans l'ordre exact ou elles doivent l'etre.
 *
 * La liste est exportee pour etre verifiee, pas pour etre parcourue : le corps
 * de la transaction nomme chaque appel Prisma, parce qu'un acces dynamique au
 * client ferait perdre le typage la ou il protege le plus.
 */
export const PROJECT_DELETION_ORDER = [
  "runEvent",
  "runFileChange",
  "runValidationResult",
  // Les preuves de TASK-027 partent avec le reste de l'execution : resultats
  // avant lots, confirmations avant decisions. Aucun de ces liens n'est
  // `Restrict`, mais l'ordre explicite reste la seule facon de rendre la
  // suppression lisible — et verifiable par un test.
  "autonomousValidationResult",
  "autonomousValidationBatch",
  "runHumanCriterionConfirmation",
  "runReviewDecision",
  "architectRunReview",
  // Les reservations de correction avant les executions qu'elles designent :
  // leurs deux liens vers `Run` sont `Restrict`, comme celui de `ReviewFeedback`.
  "correctionAttempt",
  "reviewFeedback",
  "run",
  "taskQueueEntry",
  "taskDependency",
  "architectProjectUpdate",
  "architectMessage",
  "architectGeneration",
  "architectSession",
  // Les liens critere-commande avant les deux tables qu'ils joignent.
  "taskCriterionValidation",
  "taskAcceptanceCriterion",
  "taskDocumentReference",
  "taskValidationCommand",
  "task",
  "architectBacklogProposal",
  "architectBacklogGeneration",
  "projectBrief",
  "projectV1Plan",
  "projectMemoryEntry",
  "project",
] as const;

export type ProjectDeletionTable = (typeof PROJECT_DELETION_ORDER)[number];

/** Nombre de lignes retirees, table par table. */
export type ProjectDeletionCounts = Record<ProjectDeletionTable, number>;

export type DeleteProjectStateResult =
  | { ok: true; counts: ProjectDeletionCounts }
  | { ok: false; reason: "not_found" };

/**
 * Un artefact `tasks/<code>.md` dont NOX sait qu'il l'a ecrit.
 *
 * `documentRevision` non nulle est la preuve : NOX a ecrit ce fichier a ce
 * chemin et en a relu les octets. Une tache dont la synchronisation a echoue
 * n'en a pas, et n'apparait donc pas ici — le fichier qui occuperait malgre
 * tout son chemin ne lui appartient pas.
 */
export type OwnedTaskArtifact = {
  taskCode: string;
  documentPath: string;
  expectedRevision: string;
};

/**
 * Liste les documents de taches que NOX a materialises pour ce projet.
 *
 * Aucun scan de disque, aucun motif de nom de fichier : la liste vient de la
 * base et d'elle seule. C'est ce qui garantit qu'un `tasks/TASK-999.md` etranger
 * au projet ne sera jamais candidat.
 */
export async function listOwnedTaskArtifacts(
  db: DatabaseClient,
  projectId: string,
): Promise<OwnedTaskArtifact[]> {
  const rows = await db.task.findMany({
    where: { projectId, documentRevision: { not: null } },
    select: { sequence: true, documentPath: true, documentRevision: true },
    orderBy: { sequence: "asc" },
  });

  const artifacts: OwnedTaskArtifact[] = [];
  for (const row of rows) {
    // Le filtre Prisma a deja ecarte les revisions nulles ; ce controle existe
    // pour le typage, et pour qu'une base modifiee a la main ne produise pas
    // une requete au runner sans preuve d'appartenance.
    if (row.documentRevision === null) {
      continue;
    }
    artifacts.push({
      taskCode: formatTaskCode(row.sequence),
      documentPath: row.documentPath,
      expectedRevision: row.documentRevision,
    });
  }
  return artifacts;
}

/**
 * Une execution est-elle en cours sur une tache de ce projet ?
 *
 * `CANCELLING` compte comme active, exactement comme dans `hasActiveRun` : le
 * processus n'est pas mort, et supprimer l'etat pendant qu'il ecrit dans le
 * repository creerait une course dont plus personne ne saurait raisonner.
 */
export async function projectHasActiveRun(
  db: DatabaseClient,
  projectId: string,
): Promise<boolean> {
  const active = await db.run.findFirst({
    where: { task: { projectId }, status: { in: [...ACTIVE_RUN_STATUSES] } },
    select: { id: true },
  });
  return active !== null;
}

/**
 * Supprime tout l'etat NOX d'un projet, en une transaction.
 *
 * Ne touche a aucun fichier : le nettoyage du repository a deja eu lieu quand
 * cette fonction est appelee, et c'est voulu. Supprimer la base d'abord
 * emporterait les revisions qui prouvent l'appartenance des artefacts, et plus
 * rien ne saurait quels fichiers avaient ete ecrits par NOX.
 */
export async function deleteProjectState(
  db: DatabaseClient,
  projectId: string,
): Promise<DeleteProjectStateResult> {
  return db.$transaction(async (tx): Promise<DeleteProjectStateResult> => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (project === null) {
      return { ok: false, reason: "not_found" };
    }

    const byTask = { task: { projectId } };
    const byRun = { run: { task: { projectId } } };

    const counts: ProjectDeletionCounts = {
      // Petits-enfants d'une execution.
      runEvent: (await tx.runEvent.deleteMany({ where: byRun })).count,
      runFileChange: (await tx.runFileChange.deleteMany({ where: byRun })).count,
      runValidationResult: (await tx.runValidationResult.deleteMany({ where: byRun })).count,
      // Preuves de TASK-027 : resultats avant lots, confirmations avant
      // decisions. Ce que NOX a execute lui-meme disparait avec le projet,
      // exactement comme ce que Claude a rapporte.
      autonomousValidationResult: (
        await tx.autonomousValidationResult.deleteMany({ where: { batch: { run: byTask } } })
      ).count,
      autonomousValidationBatch: (
        await tx.autonomousValidationBatch.deleteMany({ where: byRun })
      ).count,
      runHumanCriterionConfirmation: (
        await tx.runHumanCriterionConfirmation.deleteMany({ where: { decision: { run: byTask } } })
      ).count,
      runReviewDecision: (await tx.runReviewDecision.deleteMany({ where: byRun })).count,
      architectRunReview: (await tx.architectRunReview.deleteMany({ where: byRun })).count,
      // Un feedback reference une tache **et** deux executions : il part avant
      // les trois.
      correctionAttempt: (await tx.correctionAttempt.deleteMany({ where: byTask })).count,
      reviewFeedback: (await tx.reviewFeedback.deleteMany({ where: byTask })).count,
      run: (await tx.run.deleteMany({ where: byTask })).count,
      // La file avant les taches : une inscription ne survit jamais au projet,
      // et aucune autorisation d'executer ne doit rester sans son contrat.
      taskQueueEntry: (await tx.taskQueueEntry.deleteMany({ where: { projectId } })).count,
      // Les aretes avant les taches : `dependsOn` est en `Restrict`, et c'est
      // exactement la contrainte que TASK-024 a posee volontairement.
      taskDependency: (await tx.taskDependency.deleteMany({ where: byTask })).count,
      // L'Architecte avant les taches : une session et une generation peuvent
      // referencer la tache qu'elles ont fait creer, en `Restrict`.
      architectProjectUpdate: (
        await tx.architectProjectUpdate.deleteMany({ where: { projectId } })
      ).count,
      architectMessage: (
        await tx.architectMessage.deleteMany({ where: { session: { projectId } } })
      ).count,
      architectGeneration: (
        await tx.architectGeneration.deleteMany({ where: { session: { projectId } } })
      ).count,
      architectSession: (await tx.architectSession.deleteMany({ where: { projectId } })).count,
      // Listes enfant d'une tache. Les liens critere-commande partent avant les
      // deux tables qu'ils joignent.
      taskCriterionValidation: (
        await tx.taskCriterionValidation.deleteMany({ where: { criterion: { task: { projectId } } } })
      ).count,
      taskAcceptanceCriterion: (
        await tx.taskAcceptanceCriterion.deleteMany({ where: byTask })
      ).count,
      taskDocumentReference: (await tx.taskDocumentReference.deleteMany({ where: byTask })).count,
      taskValidationCommand: (await tx.taskValidationCommand.deleteMany({ where: byTask })).count,
      // Les taches avant les propositions de backlog : `backlogProposal` est en
      // `Restrict`, et une tache appliquee la designe encore.
      task: (await tx.task.deleteMany({ where: { projectId } })).count,
      architectBacklogProposal: (
        await tx.architectBacklogProposal.deleteMany({ where: { projectId } })
      ).count,
      architectBacklogGeneration: (
        await tx.architectBacklogGeneration.deleteMany({ where: { projectId } })
      ).count,
      projectBrief: (await tx.projectBrief.deleteMany({ where: { projectId } })).count,
      projectV1Plan: (await tx.projectV1Plan.deleteMany({ where: { projectId } })).count,
      projectMemoryEntry: (await tx.projectMemoryEntry.deleteMany({ where: { projectId } })).count,
      project: (await tx.project.deleteMany({ where: { id: projectId } })).count,
    };

    return { ok: true, counts };
  });
}

export type RenameProjectResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "not_found" };

/**
 * Renomme un projet.
 *
 * Le nom NOX est de la metadata locale : il ne renomme aucun dossier, ne touche
 * pas a Git, ne reecrit ni le brief, ni le plan, ni la documentation du
 * repository. `changed: false` quand le nom est deja celui-la — et rien n'est
 * ecrit, `updatedAt` compris, pour qu'une sauvegarde sans effet n'en ait pas.
 */
export async function renameProject(
  db: DatabaseClient,
  projectId: string,
  name: string,
): Promise<RenameProjectResult> {
  return db.$transaction(async (tx): Promise<RenameProjectResult> => {
    const current = await tx.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });
    if (current === null) {
      return { ok: false, reason: "not_found" };
    }
    if (current.name === name) {
      return { ok: true, changed: false };
    }
    await tx.project.update({ where: { id: projectId }, data: { name } });
    return { ok: true, changed: true };
  });
}
