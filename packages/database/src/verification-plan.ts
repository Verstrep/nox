/**
 * Lecture et ecriture du plan de verification d'une tache.
 *
 * ## Ce que ce module garantit
 *
 * Que le plan lu est celui qui est enregistre, sans interpretation : un critere
 * dont le mode est inconnu n'est pas « repare » en `HUMAN`, il est refuse par la
 * validation. Que les liens critere-commande sont des identifiants, jamais des
 * indices ni des textes — un reordonnancement ou une correction d'orthographe ne
 * doit pas deplacer une preuve.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il n'execute rien, ne decide d'aucune completion, et n'appelle ni le runner ni
 * un fournisseur. Ecrire un plan est une ecriture SQLite ; ce sont les services
 * du web qui s'en servent ensuite.
 */

import {
  COMMAND_EXECUTION_MODE,
  VERIFICATION_MODE,
  isCommandExecutionMode,
  isVerificationMode,
  type CommandExecutionMode,
  type VerificationMode,
  type VerificationPlan,
  type VerificationPlanCommand,
  type VerificationPlanCriterion,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Client minimal pour lire ou ecrire un plan dans une transaction en cours. */
export type VerificationPlanClient = Pick<
  DatabaseClient,
  "taskAcceptanceCriterion" | "taskValidationCommand" | "taskCriterionValidation"
>;

/**
 * Un critere tel qu'il est saisi, avant d'avoir un identifiant.
 *
 * `commandPositions` plutot que `commandIds` : a la creation, les commandes
 * n'ont pas encore d'identifiant. La position est la seule chose qui existe des
 * deux cotes, et elle est resolue en identifiant **dans** la transaction, une
 * fois les lignes ecrites.
 */
export type VerificationCriterionInput = {
  text: string;
  verificationMode: VerificationMode;
  humanInstructions: string | null;
  commandPositions: readonly number[];
};

/** Une commande telle qu'elle est saisie. */
export type VerificationCommandInput = {
  command: string;
  executionMode: CommandExecutionMode;
};

/**
 * Lit le plan d'une tache.
 *
 * Deux requetes, plus une pour les liens : une tache de dix criteres ne fait pas
 * onze allers-retours. Les modes illisibles sont **conserves tels quels** et
 * remplaces par une valeur de repli seulement au moment de construire l'objet ;
 * c'est la validation qui refusera, pas la lecture qui inventera.
 */
export async function readVerificationPlan(
  db: VerificationPlanClient,
  taskId: string,
): Promise<VerificationPlan> {
  const [criterionRows, commandRows] = await Promise.all([
    db.taskAcceptanceCriterion.findMany({
      where: { taskId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        position: true,
        text: true,
        verificationMode: true,
        humanInstructions: true,
      },
    }),
    db.taskValidationCommand.findMany({
      where: { taskId },
      orderBy: { position: "asc" },
      select: { id: true, position: true, command: true, executionMode: true },
    }),
  ]);

  const links =
    criterionRows.length === 0
      ? []
      : await db.taskCriterionValidation.findMany({
          where: { criterionId: { in: criterionRows.map((row) => row.id) } },
          select: { criterionId: true, commandId: true },
        });

  const commandPositions = new Map(commandRows.map((row) => [row.id, row.position]));
  const byCriterion = new Map<string, string[]>();
  for (const link of links) {
    const list = byCriterion.get(link.criterionId) ?? [];
    list.push(link.commandId);
    byCriterion.set(link.criterionId, list);
  }

  const criteria: VerificationPlanCriterion[] = criterionRows.map((row) => ({
    id: row.id,
    position: row.position,
    text: row.text,
    // Un mode illisible devient `HUMAN` : c'est la valeur qui n'autorise rien.
    // Une valeur inconnue ne doit jamais ouvrir une porte par accident.
    verificationMode: isVerificationMode(row.verificationMode)
      ? row.verificationMode
      : VERIFICATION_MODE.HUMAN,
    humanInstructions: row.humanInstructions,
    // Les liens sont rendus dans l'ordre des commandes de la tache : deux
    // lectures successives donnent la meme liste, donc la meme empreinte.
    commandIds: (byCriterion.get(row.id) ?? []).sort(
      (left, right) => (commandPositions.get(left) ?? 0) - (commandPositions.get(right) ?? 0),
    ),
  }));

  const commands: VerificationPlanCommand[] = commandRows.map((row) => ({
    id: row.id,
    position: row.position,
    command: row.command,
    executionMode: isCommandExecutionMode(row.executionMode)
      ? row.executionMode
      : COMMAND_EXECUTION_MODE.AGENT_ONLY,
  }));

  return { criteria, commands };
}

/**
 * Recrit criteres, commandes et liens d'une tache.
 *
 * Appele **dans** la transaction de son appelant — creation de tache, edition
 * d'une tache future, application d'un backlog. Le plan ne se sauvegarde jamais
 * seul : il fait partie du contrat, et un contrat a moitie ecrit n'existe pas.
 *
 * Les lignes sont supprimees puis recreees plutot que rapprochees une a une. Les
 * liens disparaissent avec elles par cascade, ce qui evite qu'un lien survive a
 * la commande qu'il designait.
 */
export async function writeVerificationPlan(
  db: VerificationPlanClient,
  taskId: string,
  input: {
    criteria: readonly VerificationCriterionInput[];
    commands: readonly VerificationCommandInput[];
  },
): Promise<void> {
  await db.taskAcceptanceCriterion.deleteMany({ where: { taskId } });
  await db.taskValidationCommand.deleteMany({ where: { taskId } });

  const commandIdByPosition = new Map<number, string>();
  for (const [position, command] of input.commands.entries()) {
    const row = await db.taskValidationCommand.create({
      data: {
        taskId,
        position,
        command: command.command,
        executionMode: command.executionMode,
      },
      select: { id: true },
    });
    commandIdByPosition.set(position, row.id);
  }

  for (const [position, criterion] of input.criteria.entries()) {
    const row = await db.taskAcceptanceCriterion.create({
      data: {
        taskId,
        position,
        text: criterion.text,
        verificationMode: criterion.verificationMode,
        // Une instruction n'a de sens que pour un critere humain. La conserver
        // sur un critere automatise laisserait un texte orphelin qui
        // reapparaitrait au prochain changement de mode.
        humanInstructions:
          criterion.verificationMode === VERIFICATION_MODE.HUMAN
            ? criterion.humanInstructions
            : null,
      },
      select: { id: true },
    });

    if (criterion.verificationMode !== VERIFICATION_MODE.AUTOMATED) {
      continue;
    }

    // Les positions en double ne produisent qu'un lien : la contrainte d'unicite
    // le garantirait de toute facon, autant ne pas la faire echouer.
    const positions = [...new Set(criterion.commandPositions)].sort((a, b) => a - b);
    for (const commandPosition of positions) {
      const commandId = commandIdByPosition.get(commandPosition);
      if (commandId === undefined) {
        // Une position qui ne designe aucune commande n'est pas ecrite. La
        // validation du plan a deja refuse ce cas ; l'ignorer ici evite de
        // creer un lien pendant si un appelant l'a contournee.
        continue;
      }
      await db.taskCriterionValidation.create({ data: { criterionId: row.id, commandId } });
    }
  }
}

/**
 * Les plans de plusieurs taches, en trois requetes.
 *
 * Pour les surfaces qui listent des taches — inventaire du planificateur, page
 * d'un projet — ou une requete par tache multiplierait les allers-retours.
 */
export async function readVerificationPlans(
  db: VerificationPlanClient,
  taskIds: readonly string[],
): Promise<Map<string, VerificationPlan>> {
  const plans = new Map<string, VerificationPlan>();
  if (taskIds.length === 0) {
    return plans;
  }

  const [criterionRows, commandRows] = await Promise.all([
    db.taskAcceptanceCriterion.findMany({
      where: { taskId: { in: [...taskIds] } },
      orderBy: { position: "asc" },
      select: {
        id: true,
        taskId: true,
        position: true,
        text: true,
        verificationMode: true,
        humanInstructions: true,
      },
    }),
    db.taskValidationCommand.findMany({
      where: { taskId: { in: [...taskIds] } },
      orderBy: { position: "asc" },
      select: { id: true, taskId: true, position: true, command: true, executionMode: true },
    }),
  ]);

  const links =
    criterionRows.length === 0
      ? []
      : await db.taskCriterionValidation.findMany({
          where: { criterionId: { in: criterionRows.map((row) => row.id) } },
          select: { criterionId: true, commandId: true },
        });

  const byCriterion = new Map<string, string[]>();
  for (const link of links) {
    const list = byCriterion.get(link.criterionId) ?? [];
    list.push(link.commandId);
    byCriterion.set(link.criterionId, list);
  }

  for (const taskId of taskIds) {
    plans.set(taskId, { criteria: [], commands: [] });
  }

  const commandPositions = new Map(commandRows.map((row) => [row.id, row.position]));

  for (const row of commandRows) {
    const plan = plans.get(row.taskId);
    if (plan === undefined) {
      continue;
    }
    (plan.commands as VerificationPlanCommand[]).push({
      id: row.id,
      position: row.position,
      command: row.command,
      executionMode: isCommandExecutionMode(row.executionMode)
        ? row.executionMode
        : COMMAND_EXECUTION_MODE.AGENT_ONLY,
    });
  }

  for (const row of criterionRows) {
    const plan = plans.get(row.taskId);
    if (plan === undefined) {
      continue;
    }
    (plan.criteria as VerificationPlanCriterion[]).push({
      id: row.id,
      position: row.position,
      text: row.text,
      verificationMode: isVerificationMode(row.verificationMode)
        ? row.verificationMode
        : VERIFICATION_MODE.HUMAN,
      humanInstructions: row.humanInstructions,
      commandIds: (byCriterion.get(row.id) ?? []).sort(
        (left, right) => (commandPositions.get(left) ?? 0) - (commandPositions.get(right) ?? 0),
      ),
    });
  }

  return plans;
}
