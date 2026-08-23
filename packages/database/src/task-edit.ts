/**
 * Edition d'une tache future : specification, dependances et statut, d'un bloc.
 *
 * ## Une seule operation logique
 *
 * Un enregistrement peut changer trois choses a la fois : le contrat, le graphe
 * de dependances, et le statut — `READY` redevient `DRAFT` des que le contrat
 * bouge. Les trois vivent dans la meme transaction, et la validation entiere
 * precede la premiere ecriture.
 *
 * L'etat « objectif enregistre, dependance refusee, statut a moitie change »
 * n'existe pas. Il n'aurait pas ete rattrapable : l'utilisateur aurait vu un
 * message d'erreur devant une tache deja a moitie modifiee, sans savoir laquelle
 * des deux moities faisait foi.
 *
 * ## La revision est injectee
 *
 * Comme pour le brief et le plan de V1, la fonction de revision vient de
 * `apps/web` : elle s'appuie sur `node:crypto`, et ce paquet doit rester
 * utilisable par un script. La transaction relit l'etat courant, recalcule sa
 * revision avec la fonction fournie, et compare — jamais l'inverse.
 *
 * ## Le Markdown n'est pas ici
 *
 * SQLite d'abord, disque ensuite, comme partout ailleurs dans NOX. Aucune
 * pretention d'atomicite entre une transaction et un systeme de fichiers : le
 * document se resynchronise apres, et son echec laisse une tache correcte avec
 * un document a reprendre.
 */

import {
  TASK_EDIT_ERROR,
  TASK_DEPENDENCY_ERROR,
  checkTaskEditable,
  checkTaskDependencyPair,
  formatTaskCode,
  isTaskKind,
  isTaskStatus,
  normalizeDependencyIds,
  sameDependencySet,
  taskStatusAfterEdit,
  type DevelopmentTaskDetail,
  type TaskDependencyErrorCode,
  type TaskEditErrorCode,
  type TaskPriority,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";
import { hasAnyCycle, readProjectDependencyEdges } from "./task-dependencies.js";
import { getTaskById } from "./tasks.js";

/** Specification soumise, deja validee par le formulaire. */
export type TaskEditInput = {
  title: string;
  objective: string;
  context: string | null;
  outOfScope: string | null;
  priority: TaskPriority;
  acceptanceCriteria: readonly string[];
  documentReferences: readonly string[];
  validationCommands: readonly string[];
  /** Identifiants des taches attendues, deja dedoublonnes. */
  dependsOnTaskIds: readonly string[];
};

/**
 * Etat de la tache tel qu'il compte pour une revision.
 *
 * Ni statut, ni dates, ni synchronisation du document : ce qui est compare est
 * le **contrat**. Sans quoi une resynchronisation de Markdown, qui touche
 * `updatedAt`, aurait perime tous les formulaires ouverts.
 */
export type TaskEditSnapshot = {
  title: string;
  objective: string;
  context: string | null;
  outOfScope: string | null;
  priority: TaskPriority;
  acceptanceCriteria: readonly string[];
  documentReferences: readonly string[];
  validationCommands: readonly string[];
  dependsOnTaskIds: readonly string[];
};

/** Fonction de revision, injectee depuis `apps/web`. */
export type TaskEditRevision = (snapshot: TaskEditSnapshot) => string;

export type TaskEditResult =
  | { ok: true; task: DevelopmentTaskDetail; changed: boolean }
  | { ok: false; reason: "edit"; code: TaskEditErrorCode; currentRevision?: string }
  | { ok: false; reason: "dependency"; code: TaskDependencyErrorCode };

class EditCycleError extends Error {
  constructor() {
    super("Cette dependance creerait un cycle.");
    this.name = "EditCycleError";
  }
}

function snapshotOf(
  task: DevelopmentTaskDetail,
  dependsOnTaskIds: readonly string[],
): TaskEditSnapshot {
  return {
    title: task.title,
    objective: task.objective,
    context: task.context,
    outOfScope: task.outOfScope,
    priority: task.priority,
    acceptanceCriteria: task.acceptanceCriteria,
    documentReferences: task.documentReferences,
    validationCommands: task.validationCommands,
    dependsOnTaskIds,
  };
}

/** Les listes ordonnees sont comparees **dans l'ordre** : il fait partie du contrat. */
function sameOrderedList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/**
 * La sauvegarde change-t-elle reellement le contrat ?
 *
 * Les dependances sont comparees comme un **ensemble** : leur ordre n'a aucune
 * signification, et une case cochee puis recochee ne doit pas degrader un
 * `READY`. Les criteres, les documents et les commandes, eux, sont ordonnes —
 * un agent les lira dans cet ordre.
 */
export function taskContractChanged(
  current: TaskEditSnapshot,
  next: TaskEditSnapshot,
): boolean {
  return !(
    current.title === next.title &&
    current.objective === next.objective &&
    current.context === next.context &&
    current.outOfScope === next.outOfScope &&
    current.priority === next.priority &&
    sameOrderedList(current.acceptanceCriteria, next.acceptanceCriteria) &&
    sameOrderedList(current.documentReferences, next.documentReferences) &&
    sameOrderedList(current.validationCommands, next.validationCommands) &&
    sameDependencySet(current.dependsOnTaskIds, next.dependsOnTaskIds)
  );
}

/**
 * Enregistre une nouvelle specification pour une tache jamais executee.
 *
 * ## L'ordre des refus
 *
 * Existence, gel, statut, peremption, puis dependances. Il est fixe et teste :
 * apprendre a l'utilisateur qu'une dependance forme un cycle alors que sa tache
 * est de toute facon figee lui ferait corriger la mauvaise chose.
 */
export async function updateFutureTask(
  db: DatabaseClient,
  input: {
    projectId: string;
    taskId: string;
    values: TaskEditInput;
    expectedRevision: string;
    revision: TaskEditRevision;
  },
): Promise<TaskEditResult> {
  return db
    .$transaction(async (tx): Promise<TaskEditResult> => {
      const row = await tx.task.findFirst({
        where: { id: input.taskId, projectId: input.projectId },
        select: { id: true, projectId: true, sequence: true, kind: true, status: true },
      });
      if (row === null) {
        return { ok: false, reason: "edit", code: TASK_EDIT_ERROR.UNKNOWN_TASK };
      }
      if (!isTaskStatus(row.status) || !isTaskKind(row.kind)) {
        return { ok: false, reason: "edit", code: TASK_EDIT_ERROR.UNKNOWN_TASK };
      }

      // Relu **dans** la transaction : la page a pu s'afficher avant qu'une
      // execution ne demarre.
      const runCount = await tx.run.count({ where: { taskId: input.taskId } });
      const gate = checkTaskEditable({ status: row.status, runCount });
      if (!gate.ok) {
        return { ok: false, reason: "edit", code: gate.code };
      }

      // Une tache inscrite dans la file autorise l'execution de **son contrat
      // actuel**. Le reecrire lancerait autre chose que ce qui a ete autorise ;
      // le retrait de la file reste un geste humain, distinct de l'edition.
      const queued = await tx.taskQueueEntry.findUnique({
        where: { taskId: input.taskId },
        select: { id: true },
      });
      if (queued !== null) {
        return { ok: false, reason: "edit", code: TASK_EDIT_ERROR.QUEUED };
      }

      const current = await getTaskById(tx, input.taskId);
      if (current === null) {
        return { ok: false, reason: "edit", code: TASK_EDIT_ERROR.UNKNOWN_TASK };
      }

      const currentDependencyIds = (
        await tx.taskDependency.findMany({
          where: { taskId: input.taskId },
          select: { dependsOnTaskId: true },
        })
      ).map((entry) => entry.dependsOnTaskId);

      const currentSnapshot = snapshotOf(current, currentDependencyIds);
      const currentRevision = input.revision(currentSnapshot);
      if (currentRevision !== input.expectedRevision) {
        return {
          ok: false,
          reason: "edit",
          code: TASK_EDIT_ERROR.STALE,
          currentRevision,
        };
      }

      // Deduplique **ici**, et pas seulement dans le formulaire : ce module est
      // l'autorite, et une liste soumise deux fois la meme tache est une saisie
      // maladroite, pas une erreur a faire remonter en violation de contrainte.
      const dependsOnTaskIds = normalizeDependencyIds(input.values.dependsOnTaskIds);

      // --- Validation complete des dependances, avant toute ecriture ---------
      for (const dependsOnTaskId of dependsOnTaskIds) {
        if (dependsOnTaskId === input.taskId) {
          return { ok: false, reason: "dependency", code: TASK_DEPENDENCY_ERROR.SELF };
        }
        const target = await tx.task.findUnique({
          where: { id: dependsOnTaskId },
          select: { id: true, projectId: true, kind: true },
        });
        if (target === null) {
          return { ok: false, reason: "dependency", code: TASK_DEPENDENCY_ERROR.UNKNOWN_TASK };
        }
        if (target.projectId !== row.projectId) {
          return { ok: false, reason: "dependency", code: TASK_DEPENDENCY_ERROR.CROSS_PROJECT };
        }
        if (!isTaskKind(target.kind)) {
          return { ok: false, reason: "dependency", code: TASK_DEPENDENCY_ERROR.UNKNOWN_TASK };
        }
        const pair = checkTaskDependencyPair({
          task: { id: row.id, projectId: row.projectId, kind: row.kind },
          dependsOn: { id: target.id, projectId: target.projectId, kind: target.kind },
        });
        if (pair !== null) {
          return { ok: false, reason: "dependency", code: pair };
        }
      }

      const nextSnapshot = snapshotOf(
        {
          ...current,
          title: input.values.title,
          objective: input.values.objective,
          context: input.values.context,
          outOfScope: input.values.outOfScope,
          priority: input.values.priority,
          acceptanceCriteria: input.values.acceptanceCriteria,
          documentReferences: input.values.documentReferences,
          validationCommands: input.values.validationCommands,
        },
        dependsOnTaskIds,
      );

      const changed = taskContractChanged(currentSnapshot, nextSnapshot);
      if (!changed) {
        // Rien n'a bouge : ni ecriture, ni `updatedAt`, ni degradation du statut.
        // Ouvrir un formulaire et le refermer n'est pas une modification.
        return { ok: true, task: current, changed: false };
      }

      // --- Ecritures ---------------------------------------------------------
      await tx.taskAcceptanceCriterion.deleteMany({ where: { taskId: input.taskId } });
      await tx.taskDocumentReference.deleteMany({ where: { taskId: input.taskId } });
      await tx.taskValidationCommand.deleteMany({ where: { taskId: input.taskId } });
      await tx.taskDependency.deleteMany({ where: { taskId: input.taskId } });

      await tx.task.update({
        where: { id: input.taskId },
        data: {
          title: input.values.title,
          objective: input.values.objective,
          context: input.values.context,
          outOfScope: input.values.outOfScope,
          priority: input.values.priority,
          status: taskStatusAfterEdit(row.status, true),
          acceptanceCriteria: {
            create: input.values.acceptanceCriteria.map((text, position) => ({ position, text })),
          },
          documentReferences: {
            create: input.values.documentReferences.map((path, position) => ({ position, path })),
          },
          validationCommands: {
            create: input.values.validationCommands.map((command, position) => ({
              position,
              command,
            })),
          },
          dependencies: {
            create: dependsOnTaskIds.map((dependsOnTaskId) => ({ dependsOnTaskId })),
          },
        },
      });

      // Le cycle se juge sur le graphe **ecrit**, comme pour un ajout unitaire :
      // c'est la seule lecture qui contienne aussi ce qu'une transaction
      // concurrente vient de valider.
      const edges = await readProjectDependencyEdges(tx, row.projectId);
      if (hasAnyCycle(edges)) {
        throw new EditCycleError();
      }

      const saved = await getTaskById(tx, input.taskId);
      if (saved === null) {
        return { ok: false, reason: "edit", code: TASK_EDIT_ERROR.UNKNOWN_TASK };
      }
      return { ok: true, task: saved, changed: true };
    })
    .catch((error: unknown): TaskEditResult => {
      if (error instanceof EditCycleError) {
        return { ok: false, reason: "dependency", code: TASK_DEPENDENCY_ERROR.CYCLE };
      }
      throw error;
    });
}

/** Code affichable d'une tache, sans charger tout son detail. */
export async function readTaskCode(
  db: DatabaseClient,
  taskId: string,
): Promise<string | null> {
  const row = await db.task.findUnique({ where: { id: taskId }, select: { sequence: true } });
  return row === null ? null : formatTaskCode(row.sequence);
}
