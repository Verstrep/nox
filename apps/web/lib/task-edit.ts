/**
 * Edition d'une tache future, cote `apps/web`.
 *
 * Deux choses ici, et rien d'autre : la **revision** d'un contrat de tache, et
 * la traduction entre le formulaire et la specification enregistrable.
 *
 * ## Pourquoi une revision de contenu plutot que `updatedAt`
 *
 * `updatedAt` change pour des raisons qui n'ont rien a voir avec le contrat :
 * une resynchronisation du document Markdown le touche, une transition de statut
 * aussi. Deux onglets ouverts se seraient donc perimes mutuellement sans que
 * personne n'ait rien modifie — et l'utilisateur aurait appris a ignorer le
 * message.
 *
 * L'empreinte porte donc exactement ce que l'editeur peut changer : le titre, la
 * priorite, l'objectif, le contexte, le hors perimetre, les documents, le
 * **plan de verification** — texte, mode et preuves de chaque critere, mode
 * d'execution de chaque commande — et l'ensemble des dependances. Le statut n'y
 * figure pas : il est **derive** de l'edition, pas une entree de celle-ci.
 *
 * ## Ce que cette empreinte n'est pas
 *
 * Une primitive de securite. SHA-256 nu, comme l'empreinte de contexte de
 * l'Architecte, et pour la meme raison : elle sert a detecter une divergence,
 * pas a autoriser une ecriture. L'empreinte du dossier de travail, elle, decide
 * d'une execution — c'est pour cela qu'elle est un HMAC. Ne pas confondre les
 * deux.
 */

import {
  normalizeTaskEditSnapshot,
  taskEditSnapshotOf,
  type TaskEditCommandInput,
  type TaskEditCriterionInput,
  type TaskEditInput,
  type TaskEditSnapshot,
} from "@nox/database";
import {
  MAX_HUMAN_INSTRUCTIONS_LENGTH,
  TASK_EDIT_ERROR,
  isCommandExecutionMode,
  isVerificationMode,
  normalizeDependencyIds,
  type DevelopmentTaskDetail,
  type TaskEditErrorCode,
  type VerificationPlan,
} from "@nox/shared";
import { createHash } from "node:crypto";

import { TASK_QUEUED_MESSAGE } from "./queue-display.ts";
import type { TaskEditFormValues } from "./verification-fields.ts";
import { readTaskSubmission, type TaskFormValues, type TaskInputResult } from "./task-input.ts";

/**
 * Version de l'empreinte, pour qu'un changement de forme ne passe pas inapercu.
 *
 * Passee a `2` avec TASK-027 : le plan de verification entre dans le contrat, et
 * un formulaire ouvert avant ce changement ne doit pas pouvoir enregistrer comme
 * si de rien n'etait.
 */
export const TASK_EDIT_REVISION_VERSION = "task-contract/2";

/**
 * Serialise un champ avec sa longueur.
 *
 * Le prefixe de longueur empeche deux contenus differents de produire la meme
 * chaine — « ab » + « c » et « a » + « bc » se distinguent. C'est la meme
 * precaution que pour les autres empreintes de NOX.
 */
function field(value: string): string {
  return `${String(value.length)}:${value}`;
}

function list(entries: readonly string[]): string {
  return `${String(entries.length)}[${entries.map(field).join("")}]`;
}

/**
 * Empreinte du contrat d'une tache.
 *
 * Deterministe et sensible a l'ordre des listes — l'ordre fait partie de la
 * specification, un agent les lira dans cet ordre. Les dependances font
 * exception : elles sont triees avant d'entrer dans l'empreinte, parce que leur
 * ordre ne signifie rien.
 *
 * Le contrat est **normalise** avant d'etre serialise : deux saisies qui
 * decrivent la meme chose donnent la meme empreinte, sans quoi rouvrir un
 * formulaire suffirait a le perimer.
 */
export function taskEditRevision(snapshot: TaskEditSnapshot): string {
  const canonical = normalizeTaskEditSnapshot(snapshot);

  const payload = [
    TASK_EDIT_REVISION_VERSION,
    field(canonical.title),
    field(canonical.priority),
    field(canonical.objective),
    field(canonical.context ?? ""),
    field(canonical.outOfScope ?? ""),
    list(
      canonical.acceptanceCriteria.map((criterion) =>
        [
          field(criterion.text),
          field(criterion.verificationMode),
          field(criterion.humanInstructions ?? ""),
          list(criterion.commandPositions.map(String)),
        ].join(""),
      ),
    ),
    list(canonical.documentReferences),
    list(
      canonical.validationCommands.map((command) =>
        [field(command.command), field(command.executionMode)].join(""),
      ),
    ),
    list([...canonical.dependsOnTaskIds].sort((left, right) => left.localeCompare(right))),
  ].join("|");

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Empreinte d'une tache relue, accompagnee de son plan et de ses dependances. */
export function taskRevisionOf(
  task: DevelopmentTaskDetail,
  plan: VerificationPlan,
  dependsOnTaskIds: readonly string[],
): string {
  return taskEditRevision(taskEditSnapshotOf(task, plan, dependsOnTaskIds));
}

/**
 * Les lignes de formulaire vivent dans `verification-fields.ts`.
 *
 * Ce module-ci calcule une revision : il depend de `node:crypto` et du paquet
 * de donnees. Un Client Component qui l'importerait pour une fabrique de ligne
 * vide entrainerait le client Prisma dans le bundle du navigateur. Les types
 * sont donc reexportes ici pour le confort des appelants serveur, et les
 * valeurs restent la-bas.
 */
export type {
  TaskEditCommandRow,
  TaskEditCriterionRow,
  TaskEditFormValues,
} from "./verification-fields.ts";

/** Cles stables produites pour un prefill : elles ne survivent pas a la page. */
function rowKey(prefix: string, index: number): string {
  return `${prefix}${String(index)}`;
}

/** Prefill du formulaire a partir de la tache et de son plan enregistres. */
export function taskEditFormValues(
  task: DevelopmentTaskDetail,
  plan: VerificationPlan,
  dependsOnTaskIds: readonly string[],
): TaskEditFormValues {
  const keyByCommandId = new Map(
    plan.commands.map((command, index) => [command.id, rowKey("v", index)]),
  );

  return {
    title: task.title,
    priority: task.priority,
    objective: task.objective,
    context: task.context ?? "",
    outOfScope: task.outOfScope ?? "",
    documents: task.documentReferences.join("\n"),
    criteria: plan.criteria.map((criterion, index) => ({
      key: rowKey("c", index),
      text: criterion.text,
      verificationMode: criterion.verificationMode,
      humanInstructions: criterion.humanInstructions ?? "",
      commandKeys: criterion.commandIds
        .map((id) => keyByCommandId.get(id))
        .filter((key): key is string => key !== undefined),
    })),
    commands: plan.commands.map((command, index) => ({
      key: rowKey("v", index),
      command: command.command,
      executionMode: command.executionMode,
    })),
    dependsOnTaskIds: [...dependsOnTaskIds],
  };
}

export type TaskEditSubmission =
  | { ok: true; input: TaskEditInput }
  | { ok: false; message: string };

const UNKNOWN_MODE_MESSAGE =
  "Chaque critere doit etre declare automatise ou humain. Rechargez la page : " +
  "une valeur inconnue n'est jamais interpretee.";

const UNKNOWN_EXECUTION_MODE_MESSAGE =
  "Chaque commande doit indiquer si NOX a le droit de l'executer. Rechargez la page.";

const INSTRUCTIONS_TOO_LONG_MESSAGE =
  `Une instruction de verification humaine ne peut pas depasser ${String(MAX_HUMAN_INSTRUCTIONS_LENGTH)} caracteres.`;

/**
 * Valide une soumission d'edition.
 *
 * Le contrat textuel passe **exactement** par le validateur de la creation :
 * memes bornes, meme filtrage des chemins de documents, meme refus des commandes
 * chainees. Un second format de tache aurait fini par diverger, et l'un des deux
 * aurait ete le moins verifie. Les lignes vides sont retirees **avant** cette
 * validation, pour que les classifications restent alignees sur les textes qui
 * en sortent.
 *
 * Ce qui est valide ici est la **forme** du plan : des modes connus, des
 * instructions bornees, des preuves qui designent des commandes soumises. Sa
 * **coherence** — un critere automatise sans preuve, une preuve qui n'est pas
 * autonome — appartient a `checkVerificationPlan`, qui la verifie au passage en
 * `READY`. Un brouillon a le droit d'etre incomplet ; c'est meme sa raison
 * d'etre.
 *
 * Les identifiants de dependances ne sont ici que **normalises** : leur
 * existence, leur projet, leur nature et les cycles se verifient en base, avec
 * l'etat courant sous les yeux. Le navigateur n'a aucune autorite sur ce point.
 */
export function readTaskEditSubmission(values: TaskEditFormValues): TaskEditSubmission {
  const criterionRows = values.criteria.filter((row) => row.text.trim() !== "");
  const commandRows = values.commands.filter((row) => row.command.trim() !== "");

  const submission: TaskInputResult = readTaskSubmission({
    title: values.title,
    priority: values.priority,
    objective: values.objective,
    context: values.context,
    outOfScope: values.outOfScope,
    documents: values.documents,
    criteria: criterionRows.map((row) => row.text.trim()).join("\n"),
    commands: commandRows.map((row) => row.command.trim()).join("\n"),
  } satisfies TaskFormValues);

  if (!submission.ok) {
    return { ok: false, message: submission.message };
  }

  // Une position, pas un identifiant : les commandes sont recreees a chaque
  // enregistrement, donc leur identifiant de base n'existe pas encore.
  const positionByKey = new Map(commandRows.map((row, index) => [row.key, index]));

  const validationCommands: TaskEditCommandInput[] = [];
  for (const [index, row] of commandRows.entries()) {
    if (!isCommandExecutionMode(row.executionMode)) {
      return { ok: false, message: UNKNOWN_EXECUTION_MODE_MESSAGE };
    }
    const command = submission.input.validationCommands[index];
    if (command === undefined) {
      return { ok: false, message: UNKNOWN_EXECUTION_MODE_MESSAGE };
    }
    validationCommands.push({ command, executionMode: row.executionMode });
  }

  const acceptanceCriteria: TaskEditCriterionInput[] = [];
  for (const [index, row] of criterionRows.entries()) {
    if (!isVerificationMode(row.verificationMode)) {
      return { ok: false, message: UNKNOWN_MODE_MESSAGE };
    }
    const text = submission.input.acceptanceCriteria[index];
    if (text === undefined) {
      return { ok: false, message: UNKNOWN_MODE_MESSAGE };
    }

    const instructions = row.humanInstructions.trim();
    if (instructions.length > MAX_HUMAN_INSTRUCTIONS_LENGTH) {
      return { ok: false, message: INSTRUCTIONS_TOO_LONG_MESSAGE };
    }

    acceptanceCriteria.push({
      text,
      verificationMode: row.verificationMode,
      humanInstructions: instructions === "" ? null : instructions,
      commandPositions: row.commandKeys
        .map((key) => positionByKey.get(key))
        .filter((position): position is number => position !== undefined),
    });
  }

  return {
    ok: true,
    // Normalise ici, une fois : le module de base compare des contrats
    // canoniques, et l'empreinte se calcule sur la meme forme.
    input: normalizeTaskEditSnapshot({
      title: submission.input.title,
      objective: submission.input.objective,
      context: submission.input.context,
      outOfScope: submission.input.outOfScope,
      priority: submission.input.priority,
      acceptanceCriteria,
      documentReferences: submission.input.documentReferences,
      validationCommands,
      dependsOnTaskIds: normalizeDependencyIds(values.dependsOnTaskIds),
    }),
  };
}

/** Message d'un refus d'edition. */
export function taskEditRefusalMessage(code: TaskEditErrorCode): string {
  switch (code) {
    case TASK_EDIT_ERROR.UNKNOWN_TASK:
      return "Cette tache n'existe pas dans ce projet. Revenez au backlog et rouvrez-la.";
    case TASK_EDIT_ERROR.FROZEN:
      return (
        "Cette tache possede un historique d'execution : sa specification est figee. " +
        "Une demande de correction — « Request changes » — reste la facon de faire evoluer " +
        "un travail deja produit."
      );
    case TASK_EDIT_ERROR.STATUS_NOT_EDITABLE:
      return (
        "Seule une tache en brouillon ou en file peut etre modifiee ici. " +
        "Ramenez-la dans l'un de ces deux etats avant de reessayer."
      );
    case TASK_EDIT_ERROR.STALE:
      return (
        "Cette tache a change depuis l'ouverture du formulaire. Rechargez la page avant " +
        "d'enregistrer : NOX n'ecrase pas une modification qu'il n'a pas su vous montrer."
      );
    case TASK_EDIT_ERROR.QUEUED:
      return TASK_QUEUED_MESSAGE;
  }
}
