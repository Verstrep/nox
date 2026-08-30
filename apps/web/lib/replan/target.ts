/**
 * L'etat cible d'un changement de projet, entre le formulaire et la base.
 *
 * ## Le navigateur edite une proposition, pas une tache
 *
 * Ce qu'il envoie est un plan **souhaite** : des identifiants de taches
 * existantes, des identifiants temporaires, des contrats, des references de
 * dependance. Il ne dit jamais qu'une tache est modifiable, qu'un statut vaut
 * `READY`, qu'un code doit etre reutilise, ni qu'une peremption peut etre
 * ignoree. Ces reponses-la se relisent en base, dans la transaction qui ecrit.
 *
 * ## Un seul validateur de contrat
 *
 * Celui de l'editeur de tache future : `readTaskEditSubmission`, suivi de
 * `checkValidationCommand`. Pas une regle de plus, pas une regle de moins. Une
 * revue de replanification ne doit jamais accepter une commande `AUTONOMOUS` que
 * l'editeur normal refuserait — sinon la revue deviendrait le chemin par lequel
 * on contourne l'editeur.
 *
 * ## Les identifiants temporaires ne survivent pas a l'application
 *
 * Ils identifient une tache proposee pendant toute la revue — pour que les
 * dependances puissent la designer — et disparaissent a l'application, ou un
 * vrai code lui est attribue par `Project.nextTaskSequence`. Aucun code n'est
 * jamais recycle, et aucun n'est reserve avant l'ecriture.
 *
 * Module **pur** : ni base, ni disque, ni reseau, ni React.
 */

import type { ReplanApplyItem, ReplanStateTask, TaskEditSnapshot } from "@nox/database";
import {
  VERIFICATION_MODE,
  checkValidationCommand,
  type ReplanProposal,
  type ReplanTargetTask,
} from "@nox/shared";

import { readTaskEditSubmission } from "../task-edit.ts";
import type { TaskEditFormValues } from "../verification-fields.ts";

/**
 * Un element de la cible, tel que la revue le manipule.
 *
 * `uid` est une identite d'affichage : elle vit le temps de la revue, ne part
 * dans aucun formulaire, et n'existe pas en base. Elle sert a ce que React sache
 * quelle carte est laquelle quand on tape dedans — le probleme resolu une fois
 * pour toutes par la revue de backlog.
 */
export type ReplanReviewItem = {
  uid: string;
  /** Tache existante remplacee, ou `null` pour une creation. */
  existingTaskId: string | null;
  /** Identifiant temporaire d'une creation, ou `null`. */
  tempId: string | null;
  /** Code affiche d'une tache existante. Jamais editable, jamais renvoye. */
  code: string | null;
  values: TaskEditFormValues;
  /** References attendues : identifiants de taches existantes, ou identifiants temporaires. */
  dependsOn: string[];
};

/** Prefixe des champs d'un element dans le formulaire de revue. */
export function replanItemPrefix(index: number): string {
  return `items.${String(index)}.`;
}

/** Contrat enregistre d'une tache, sous la forme du formulaire de tache. */
export function snapshotToFormValues(
  snapshot: TaskEditSnapshot,
  keyPrefix: string,
): TaskEditFormValues {
  const commandKey = (index: number): string => `${keyPrefix}v${String(index)}`;

  return {
    title: snapshot.title,
    priority: snapshot.priority,
    objective: snapshot.objective,
    context: snapshot.context ?? "",
    outOfScope: snapshot.outOfScope ?? "",
    documents: snapshot.documentReferences.join("\n"),
    criteria: snapshot.acceptanceCriteria.map((criterion, index) => ({
      key: `${keyPrefix}c${String(index)}`,
      text: criterion.text,
      verificationMode: criterion.verificationMode,
      humanInstructions: criterion.humanInstructions ?? "",
      // Le lien designe une **ligne**, jamais un texte : deux commandes
      // identiques restent deux lignes distinctes.
      commandKeys:
        criterion.verificationMode === VERIFICATION_MODE.AUTOMATED
          ? criterion.commandPositions
              .filter((position) => position >= 0 && position < snapshot.validationCommands.length)
              .map(commandKey)
          : [],
    })),
    commands: snapshot.validationCommands.map((command, index) => ({
      key: commandKey(index),
      command: command.command,
      executionMode: command.executionMode,
    })),
    // Les dependances d'un replan vivent a part : elles peuvent designer une
    // tache qui n'existe pas encore, ce qu'un contrat de tache ne sait pas dire.
    dependsOnTaskIds: [],
  };
}

/** Un element propose par le fournisseur, sous la forme du formulaire. */
function targetTaskToFormValues(task: ReplanTargetTask, keyPrefix: string): TaskEditFormValues {
  const commandKey = (index: number): string => `${keyPrefix}v${String(index)}`;

  return {
    title: task.title,
    priority: task.priority,
    objective: task.objective,
    context: task.context ?? "",
    // Le hors perimetre est une liste chez le fournisseur et un texte dans le
    // formulaire de tache. Une ligne par entree conserve l'information sans
    // inventer de separateur que la relecture aurait a deviner.
    outOfScope: task.outOfScope.join("\n"),
    documents: task.documentReferences.join("\n"),
    criteria: task.acceptanceCriteria.map((criterion, index) => ({
      key: `${keyPrefix}c${String(index)}`,
      text: criterion.text,
      verificationMode: criterion.verificationMode,
      humanInstructions: criterion.humanInstructions ?? "",
      commandKeys:
        criterion.verificationMode === VERIFICATION_MODE.AUTOMATED
          ? criterion.validationCommandIndexes
              .filter((entry) => entry >= 0 && entry < task.validationCommands.length)
              .map(commandKey)
          : [],
    })),
    commands: task.validationCommands.map((command, index) => ({
      key: commandKey(index),
      command: command.command,
      executionMode: command.executionMode,
    })),
    dependsOnTaskIds: [],
  };
}

/**
 * La proposition du fournisseur, prete pour la revue.
 *
 * Le formulaire part de ce que l'architecte a propose ; l'utilisateur le
 * corrige avant d'appliquer, et `providerJson` n'est jamais touche.
 */
export function proposalToReviewItems(
  proposal: ReplanProposal,
  codeByTaskId: ReadonlyMap<string, string>,
): ReplanReviewItem[] {
  return proposal.futureTasks.map((task, index) => ({
    uid: `replan-item-${String(index)}`,
    existingTaskId: task.existingTaskId,
    tempId: task.tempId,
    code: task.existingTaskId === null ? null : (codeByTaskId.get(task.existingTaskId) ?? null),
    values: targetTaskToFormValues(task, `t${String(index)}`),
    dependsOn: [...task.dependsOnTaskIds, ...task.dependsOnTempIds],
  }));
}

/**
 * Une tache future existante, prete a etre **restauree** dans la cible.
 *
 * La revue doit pouvoir revenir sur une suppression avant d'appliquer : un
 * retrait accidentel ne doit pas obliger a redemander un tour a l'architecte.
 */
export function taskToReviewItem(task: ReplanStateTask, keyPrefix: string): ReplanReviewItem | null {
  if (task.contract === null) {
    return null;
  }
  return {
    uid: `replan-restore-${task.classified.id}`,
    existingTaskId: task.classified.id,
    tempId: null,
    code: task.classified.code,
    values: snapshotToFormValues(task.contract, keyPrefix),
    dependsOn: [...task.dependsOnTaskIds],
  };
}

export type ReplanTargetSubmission =
  | { ok: true; items: ReplanApplyItem[] }
  | { ok: false; message: string };

/**
 * Valide la cible soumise par un humain.
 *
 * ## Ce qui est verifie ici
 *
 * Le contrat de chaque element — par le validateur de l'editeur de tache
 * future — et la garde des commandes. Les identifiants temporaires sont
 * normalises, et les references de dependance sont resolues vers l'un des deux
 * espaces : une tache existante du projet, ou un element nouveau du meme lot.
 *
 * ## Ce qui n'est pas verifie ici
 *
 * Que la tache designee est encore modifiable, que le graphe reste acyclique,
 * qu'aucune tache verrouillee ne se retrouve orpheline. Ces trois questions
 * portent sur l'etat de la base **au moment d'ecrire**, et sont donc tranchees
 * dans la transaction — jamais ici, ou la reponse serait deja perimee.
 */
export function readReplanTargetSubmission(
  items: readonly ReplanReviewItem[],
  /** Identifiants de toutes les taches du projet, pour resoudre une reference. */
  knownTaskIds: ReadonlySet<string>,
): ReplanTargetSubmission {
  const tempIds = new Set<string>();
  for (const item of items) {
    if (item.tempId !== null && item.tempId !== "") {
      tempIds.add(item.tempId);
    }
  }

  const applied: ReplanApplyItem[] = [];

  for (const [position, item] of items.entries()) {
    const label = `Tache ${item.code ?? String(position + 1)}`;

    if ((item.existingTaskId === null) === (item.tempId === null)) {
      return {
        ok: false,
        message: `${label} : NOX ne sait pas si cet element remplace une tache existante ou s'il en cree une. Rechargez la page.`,
      };
    }

    const submission = readTaskEditSubmission(item.values);
    if (!submission.ok) {
      return { ok: false, message: `${label} : ${submission.message}` };
    }

    for (const { command } of submission.input.validationCommands) {
      const problem = checkValidationCommand(command);
      if (problem !== null) {
        return {
          ok: false,
          message: `${label} : « ${command} » ne peut pas etre autorisee : ${problem}`,
        };
      }
    }

    const dependsOnTaskIds: string[] = [];
    const dependsOnTempIds: string[] = [];
    for (const reference of item.dependsOn) {
      const trimmed = reference.trim();
      if (trimmed === "") {
        continue;
      }
      // Les identifiants temporaires d'abord : ils appartiennent a ce lot, et un
      // identifiant de base ne peut pas leur ressembler.
      if (tempIds.has(trimmed)) {
        if (!dependsOnTempIds.includes(trimmed)) {
          dependsOnTempIds.push(trimmed);
        }
        continue;
      }
      if (!knownTaskIds.has(trimmed)) {
        return {
          ok: false,
          message: `${label} attend une tache qui n'existe pas dans ce projet. Rechargez la page.`,
        };
      }
      if (!dependsOnTaskIds.includes(trimmed)) {
        dependsOnTaskIds.push(trimmed);
      }
    }

    applied.push({
      existingTaskId: item.existingTaskId,
      tempId: item.tempId,
      values: submission.input,
      dependsOnTaskIds,
      dependsOnTempIds,
    });
  }

  return { ok: true, items: applied };
}

/**
 * L'etat cible reellement applique, conserve tel quel.
 *
 * Distinct de `providerJson`, qui n'est jamais reecrit : les deux permettent de
 * comparer plus tard ce que l'architecte avait propose et ce que l'humain a
 * retenu. Les suppressions y figurent nommement — une tache disparue de la base
 * doit rester racontable.
 */
export function replanAppliedJson(input: {
  rationale: string;
  items: readonly ReplanApplyItem[];
  removed: readonly { taskId: string; code: string; title: string; contract: TaskEditSnapshot }[];
}): string {
  return JSON.stringify({
    schemaVersion: 1,
    rationale: input.rationale,
    futureTasks: input.items.map((item, position) => ({
      existingTaskId: item.existingTaskId,
      tempId: item.tempId,
      planningOrder: position,
      title: item.values.title,
      priority: item.values.priority,
      objective: item.values.objective,
      context: item.values.context,
      outOfScope: item.values.outOfScope === null ? [] : [item.values.outOfScope],
      documentReferences: [...item.values.documentReferences],
      acceptanceCriteria: item.values.acceptanceCriteria.map((criterion) => ({
        text: criterion.text,
        verificationMode: criterion.verificationMode,
        humanInstructions: criterion.humanInstructions,
        validationCommandIndexes: [...criterion.commandPositions],
      })),
      validationCommands: item.values.validationCommands.map((command) => ({
        command: command.command,
        executionMode: command.executionMode,
      })),
      dependsOnTaskIds: [...item.dependsOnTaskIds],
      dependsOnTempIds: [...item.dependsOnTempIds],
    })),
    // Une tache supprimee de la base doit rester lisible ici : son code, son
    // titre et son contrat d'alors. Sans cela, la decision serait appliquee et
    // introuvable.
    removedTasks: input.removed.map((task) => ({
      taskId: task.taskId,
      code: task.code,
      title: task.title,
      contract: task.contract,
    })),
  });
}
