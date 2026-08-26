/**
 * Edition d'une tache future : contrat, plan de verification, dependances et
 * statut, d'un bloc.
 *
 * ## Une seule operation logique
 *
 * Un enregistrement peut changer quatre choses a la fois : la specification, la
 * facon dont chaque critere se verifie, le graphe de dependances, et le statut —
 * `READY` redevient `DRAFT` des que le contrat bouge. Les quatre vivent dans la
 * meme transaction, et la validation entiere precede la premiere ecriture.
 *
 * L'etat « objectif enregistre, dependance refusee, statut a moitie change »
 * n'existe pas. Il n'aurait pas ete rattrapable : l'utilisateur aurait vu un
 * message d'erreur devant une tache deja a moitie modifiee, sans savoir laquelle
 * des deux moities faisait foi.
 *
 * ## Le plan de verification fait partie du contrat
 *
 * Changer un critere de `HUMAN` a `AUTOMATED` change ce que NOX fera de la tache
 * — jusqu'a la terminer sans personne. C'est donc une modification du contrat au
 * meme titre qu'un objectif reecrit : elle entre dans la revision optimiste, et
 * elle ramene une tache `READY` en `DRAFT`.
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
  COMMAND_EXECUTION_MODE,
  TASK_EDIT_ERROR,
  TASK_DEPENDENCY_ERROR,
  VERIFICATION_MODE,
  checkTaskEditable,
  checkTaskDependencyPair,
  formatTaskCode,
  isCommandExecutionMode,
  isTaskKind,
  isTaskStatus,
  isVerificationMode,
  normalizeDependencyIds,
  sameDependencySet,
  taskStatusAfterEdit,
  type CommandExecutionMode,
  type DevelopmentTaskDetail,
  type TaskDependencyErrorCode,
  type TaskEditErrorCode,
  type TaskPriority,
  type VerificationMode,
  type VerificationPlan,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";
import { hasAnyCycle, readProjectDependencyEdges } from "./task-dependencies.js";
import { getTaskById } from "./tasks.js";
import { readVerificationPlan, writeVerificationPlan } from "./verification-plan.js";

/**
 * Un critere d'acceptation soumis, avec la facon dont il se verifie.
 *
 * `commandPositions` designe des **indices** dans `validationCommands`, jamais
 * des identifiants de base : a l'enregistrement, les commandes sont recreees et
 * changent d'identifiant. La position est la seule chose que le formulaire et la
 * base partagent avant l'ecriture.
 */
export type TaskEditCriterionInput = {
  text: string;
  verificationMode: VerificationMode;
  /** Consigne au testeur. N'a de sens que pour un critere humain. */
  humanInstructions: string | null;
  commandPositions: readonly number[];
};

/** Une commande de validation soumise, avec ce que NOX a le droit d'en faire. */
export type TaskEditCommandInput = {
  command: string;
  executionMode: CommandExecutionMode;
};

/** Specification soumise, deja validee par le formulaire. */
export type TaskEditInput = {
  title: string;
  objective: string;
  context: string | null;
  outOfScope: string | null;
  priority: TaskPriority;
  acceptanceCriteria: readonly TaskEditCriterionInput[];
  documentReferences: readonly string[];
  validationCommands: readonly TaskEditCommandInput[];
  /** Identifiants des taches attendues, deja dedoublonnes. */
  dependsOnTaskIds: readonly string[];
};

/**
 * Etat de la tache tel qu'il compte pour une revision.
 *
 * Ni statut, ni dates, ni synchronisation du document : ce qui est compare est
 * le **contrat**, plan de verification compris. Sans quoi une resynchronisation
 * de Markdown, qui touche `updatedAt`, aurait perime tous les formulaires
 * ouverts.
 */
export type TaskEditSnapshot = TaskEditInput;

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

/**
 * Met un contrat sous sa forme canonique.
 *
 * Deux saisies qui decrivent la meme chose doivent produire la meme empreinte,
 * sinon un formulaire ouvert puis referme degraderait un `READY`. Trois regles,
 * appliquees des deux cotes — a la lecture de la base comme a la soumission :
 *
 * - une instruction n'existe que pour un critere humain ;
 * - une preuve n'existe que pour un critere automatise ;
 * - les positions sont dedoublonnees, triees, et celles qui ne designent aucune
 *   commande disparaissent.
 *
 * C'est cette fonction, et elle seule, qui definit ce que « le contrat n'a pas
 * change » veut dire.
 */
export function normalizeTaskEditSnapshot(snapshot: TaskEditSnapshot): TaskEditSnapshot {
  const commands = snapshot.validationCommands.map((entry) => ({
    command: entry.command,
    executionMode: isCommandExecutionMode(entry.executionMode)
      ? entry.executionMode
      : COMMAND_EXECUTION_MODE.AGENT_ONLY,
  }));

  const acceptanceCriteria = snapshot.acceptanceCriteria.map((criterion) => {
    const mode = isVerificationMode(criterion.verificationMode)
      ? criterion.verificationMode
      : VERIFICATION_MODE.HUMAN;
    const automated = mode === VERIFICATION_MODE.AUTOMATED;
    return {
      text: criterion.text,
      verificationMode: mode,
      humanInstructions: automated ? null : (criterion.humanInstructions ?? null),
      commandPositions: automated
        ? [...new Set(criterion.commandPositions)]
            .filter((position) => position >= 0 && position < commands.length)
            .sort((left, right) => left - right)
        : [],
    };
  });

  return {
    title: snapshot.title,
    objective: snapshot.objective,
    context: snapshot.context,
    outOfScope: snapshot.outOfScope,
    priority: snapshot.priority,
    acceptanceCriteria,
    documentReferences: [...snapshot.documentReferences],
    validationCommands: commands,
    dependsOnTaskIds: [...snapshot.dependsOnTaskIds],
  };
}

/**
 * Contrat d'une tache enregistree, reconstruit depuis son plan.
 *
 * Le plan porte deja les textes des criteres et des commandes : les relire
 * depuis `DevelopmentTaskDetail` donnerait la meme chose par un second chemin,
 * qui pourrait diverger.
 */
export function taskEditSnapshotOf(
  task: Pick<
    DevelopmentTaskDetail,
    "title" | "objective" | "context" | "outOfScope" | "priority" | "documentReferences"
  >,
  plan: VerificationPlan,
  dependsOnTaskIds: readonly string[],
): TaskEditSnapshot {
  const positionByCommandId = new Map(plan.commands.map((command, index) => [command.id, index]));

  return normalizeTaskEditSnapshot({
    title: task.title,
    objective: task.objective,
    context: task.context,
    outOfScope: task.outOfScope,
    priority: task.priority,
    acceptanceCriteria: plan.criteria.map((criterion) => ({
      text: criterion.text,
      verificationMode: criterion.verificationMode,
      humanInstructions: criterion.humanInstructions,
      commandPositions: criterion.commandIds
        .map((id) => positionByCommandId.get(id))
        .filter((position): position is number => position !== undefined),
    })),
    documentReferences: task.documentReferences,
    validationCommands: plan.commands.map((command) => ({
      command: command.command,
      executionMode: command.executionMode,
    })),
    dependsOnTaskIds,
  });
}

/** Les listes ordonnees sont comparees **dans l'ordre** : il fait partie du contrat. */
function sameOrderedList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function sameCriteria(
  left: readonly TaskEditCriterionInput[],
  right: readonly TaskEditCriterionInput[],
): boolean {
  return (
    left.length === right.length &&
    left.every((criterion, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        criterion.text === other.text &&
        criterion.verificationMode === other.verificationMode &&
        (criterion.humanInstructions ?? "") === (other.humanInstructions ?? "") &&
        sameNumbers(criterion.commandPositions, other.commandPositions)
      );
    })
  );
}

function sameCommands(
  left: readonly TaskEditCommandInput[],
  right: readonly TaskEditCommandInput[],
): boolean {
  return (
    left.length === right.length &&
    left.every((command, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        command.command === other.command &&
        command.executionMode === other.executionMode
      );
    })
  );
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
  const left = normalizeTaskEditSnapshot(current);
  const right = normalizeTaskEditSnapshot(next);

  return !(
    left.title === right.title &&
    left.objective === right.objective &&
    left.context === right.context &&
    left.outOfScope === right.outOfScope &&
    left.priority === right.priority &&
    sameCriteria(left.acceptanceCriteria, right.acceptanceCriteria) &&
    sameOrderedList(left.documentReferences, right.documentReferences) &&
    sameCommands(left.validationCommands, right.validationCommands) &&
    sameDependencySet(left.dependsOnTaskIds, right.dependsOnTaskIds)
  );
}

/**
 * Enregistre une nouvelle specification pour une tache jamais executee.
 *
 * ## L'ordre des refus
 *
 * Existence, gel, statut, file, peremption, puis dependances. Il est fixe et
 * teste : apprendre a l'utilisateur qu'une dependance forme un cycle alors que
 * sa tache est de toute facon figee lui ferait corriger la mauvaise chose.
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

      const currentPlan = await readVerificationPlan(tx, input.taskId);
      const currentSnapshot = taskEditSnapshotOf(current, currentPlan, currentDependencyIds);
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

      const nextSnapshot = normalizeTaskEditSnapshot({
        ...input.values,
        dependsOnTaskIds,
      });

      const changed = taskContractChanged(currentSnapshot, nextSnapshot);
      if (!changed) {
        // Rien n'a bouge : ni ecriture, ni `updatedAt`, ni degradation du statut.
        // Ouvrir un formulaire et le refermer n'est pas une modification.
        return { ok: true, task: current, changed: false };
      }

      // --- Ecritures ---------------------------------------------------------
      await tx.taskDocumentReference.deleteMany({ where: { taskId: input.taskId } });
      await tx.taskDependency.deleteMany({ where: { taskId: input.taskId } });

      await tx.task.update({
        where: { id: input.taskId },
        data: {
          title: nextSnapshot.title,
          objective: nextSnapshot.objective,
          context: nextSnapshot.context,
          outOfScope: nextSnapshot.outOfScope,
          priority: nextSnapshot.priority,
          status: taskStatusAfterEdit(row.status, true),
          documentReferences: {
            create: nextSnapshot.documentReferences.map((path, position) => ({ position, path })),
          },
          dependencies: {
            create: dependsOnTaskIds.map((dependsOnTaskId) => ({ dependsOnTaskId })),
          },
        },
      });

      // Criteres, commandes et liens passent par l'ecriture unique du plan : il
      // n'existe pas de seconde facon d'ecrire une classification, et donc pas
      // de seconde facon de se tromper.
      await writeVerificationPlan(tx, input.taskId, {
        criteria: nextSnapshot.acceptanceCriteria.map((criterion) => ({
          text: criterion.text,
          verificationMode: criterion.verificationMode,
          humanInstructions: criterion.humanInstructions,
          commandPositions: criterion.commandPositions,
        })),
        commands: nextSnapshot.validationCommands.map((command) => ({
          command: command.command,
          executionMode: command.executionMode,
        })),
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
