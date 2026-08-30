/**
 * L'etat de planification d'un projet, tel qu'une replanification le voit.
 *
 * ## Une seule lecture, pour trois usages
 *
 * Le contexte envoye au fournisseur, l'empreinte qui detecte la peremption, et
 * la validation de la cible reposent tous sur les memes faits. Les lire trois
 * fois produirait trois photographies prises a trois instants, et la peremption
 * cesserait de vouloir dire quelque chose.
 *
 * ## Ce que « voir » veut dire
 *
 * Les taches **verrouillees** sont vues en inventaire : ce qui existe, ou en est
 * le travail, et ce qu'elles attendent. Les taches **modifiables** sont vues en
 * entier, contrat de verification compris — sans quoi le fournisseur ne pourrait
 * pas produire un etat cible complet, seulement une approximation.
 *
 * La classification, elle, ne se decide pas ici : elle vient de
 * `classifyReplanTask`, qui applique les regles de TASK-024 et d'elles seules.
 *
 * ## Rien n'est tronque ici
 *
 * Ce module rend **tout** ce que le projet contient. Decider de ce qui tient
 * dans un budget est une autre question, tranchee plus haut, avec la
 * possibilite de refuser — jamais celle de couper en silence.
 */

import {
  classifyReplanTask,
  formatTaskCode,
  type ReplanClassifiedTask,
  type TaskKind,
  type TaskPriority,
  type TaskStatus,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";
import { taskEditSnapshotOf, type TaskEditSnapshot } from "./task-edit.js";
import { readVerificationPlans, type VerificationPlanClient } from "./verification-plan.js";

/**
 * Client minimal pour relire l'etat de planification.
 *
 * Volontairement etroit : l'application d'une replanification recalcule cet etat
 * **dans sa transaction**, et un `DatabaseClient` complet n'y est pas
 * disponible. Recalculer en dehors laisserait une fenetre entre le controle de
 * peremption et les ecritures — exactement celle qu'une transaction existe pour
 * fermer.
 */
export type ReplanStateClient = Pick<DatabaseClient, "task" | "architectBacklogProposal"> &
  VerificationPlanClient;

/**
 * Une tache du projet, avec tout ce qu'une replanification doit en savoir.
 *
 * `contract` n'est renseigne que pour une tache modifiable : recopier le contrat
 * complet de quarante taches historiques consommerait le budget qui doit revenir
 * a celles que le fournisseur peut reellement changer.
 */
export type ReplanStateTask = {
  classified: ReplanClassifiedTask;
  title: string;
  objective: string;
  priority: string;
  status: string;
  /** Codes des taches attendues, dans l'ordre des codes. */
  dependsOnCodes: string[];
  /** Identifiants des taches attendues. */
  dependsOnTaskIds: string[];
  /** Position dans le plan de travail futur, ou `null` pour l'ordre historique. */
  planningOrder: number | null;
  /** Contrat complet, uniquement pour une tache modifiable. */
  contract: TaskEditSnapshot | null;
  /** Documents references, uniquement pour une tache modifiable. */
  documentReferences: readonly string[];
  context: string | null;
  outOfScope: string | null;
};

export type ReplanPlanningState = {
  /** Toutes les taches du projet, triees comme le plan les presente. */
  tasks: ReplanStateTask[];
  /** Backlogs initiaux deja appliques : ce qui rend un projet replanifiable. */
  appliedBacklogCount: number;
};

/**
 * Ordre de presentation du plan.
 *
 * `planningOrder` d'abord quand il existe, code ensuite. Une tache sans ordre
 * enregistre n'est pas « en fin de liste » : elle est a sa place historique,
 * derriere celles qu'un humain a explicitement ordonnees. Deterministe dans tous
 * les cas — c'est ce qui permet a l'empreinte de ne pas dependre de l'ordre
 * accidentel rendu par SQLite.
 */
function comparePlanningOrder(left: ReplanStateTask, right: ReplanStateTask): number {
  const leftOrder = left.planningOrder;
  const rightOrder = right.planningOrder;

  if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (leftOrder !== null && rightOrder === null) {
    return -1;
  }
  if (leftOrder === null && rightOrder !== null) {
    return 1;
  }
  return left.classified.code.localeCompare(right.classified.code);
}

/** Lit l'etat de planification complet d'un projet. */
export async function loadReplanPlanningState(
  db: ReplanStateClient,
  projectId: string,
): Promise<ReplanPlanningState> {
  const [rows, appliedBacklogCount] = await Promise.all([
    db.task.findMany({
      where: { projectId },
      select: {
        id: true,
        sequence: true,
        kind: true,
        title: true,
        objective: true,
        context: true,
        outOfScope: true,
        status: true,
        priority: true,
        planningOrder: true,
        documentReferences: { orderBy: { position: "asc" }, select: { path: true } },
        dependencies: { select: { dependsOnTaskId: true } },
        queueEntry: { select: { id: true } },
        _count: { select: { runs: true } },
      },
    }),
    db.architectBacklogProposal.count({ where: { projectId, status: "APPLIED" } }),
  ]);

  const codeById = new Map(rows.map((row) => [row.id, formatTaskCode(row.sequence)]));

  const classified = rows.map((row) =>
    classifyReplanTask({
      id: row.id,
      code: codeById.get(row.id) ?? formatTaskCode(row.sequence),
      // Une nature illisible ne doit pas ouvrir un droit d'edition : la
      // classification retombe alors sur le refus, comme partout ailleurs.
      kind: row.kind as TaskKind,
      status: row.status as TaskStatus,
      runCount: row._count.runs,
      queued: row.queueEntry !== null,
    }),
  );

  const editableIds = classified
    .filter((entry) => entry.editable)
    .map((entry) => entry.id);
  const plans = await readVerificationPlans(db, editableIds);

  const tasks: ReplanStateTask[] = rows.map((row, index) => {
    const entry = classified[index];
    if (entry === undefined) {
      throw new Error("Classification et lignes desynchronisees.");
    }

    const dependsOnTaskIds = row.dependencies
      .map((edge) => edge.dependsOnTaskId)
      .sort((left, right) => left.localeCompare(right));
    const documentReferences = row.documentReferences.map((reference) => reference.path);
    const plan = plans.get(row.id) ?? null;

    return {
      classified: entry,
      title: row.title,
      objective: row.objective,
      priority: row.priority,
      status: row.status,
      dependsOnTaskIds,
      dependsOnCodes: dependsOnTaskIds
        .map((id) => codeById.get(id) ?? id)
        .sort((left, right) => left.localeCompare(right)),
      planningOrder: row.planningOrder,
      context: row.context,
      outOfScope: row.outOfScope,
      documentReferences,
      contract:
        entry.editable && plan !== null
          ? taskEditSnapshotOf(
              {
                title: row.title,
                objective: row.objective,
                context: row.context,
                outOfScope: row.outOfScope,
                priority: row.priority as TaskPriority,
                documentReferences,
              },
              plan,
              dependsOnTaskIds,
            )
          : null,
    };
  });

  tasks.sort(comparePlanningOrder);
  return { tasks, appliedBacklogCount };
}
