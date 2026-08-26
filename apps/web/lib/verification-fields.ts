/**
 * Le plan de verification dans un formulaire HTML.
 *
 * ## Un seul format de champs
 *
 * L'editeur de tache future et la revue d'un backlog posent la meme question —
 * comment chaque critere se verifie-t-il ? — et doivent donc l'envoyer de la
 * meme facon. Deux encodages auraient fini par diverger, et l'un des deux aurait
 * ete le moins verifie.
 *
 * ## Des cles, pas des positions
 *
 * Chaque ligne porte une cle d'interface, et le lien d'un critere vers ses
 * preuves designe **la cle d'une ligne de commande**. Supprimer la ligne du
 * milieu ne deplace donc aucune preuve, et deux commandes au texte identique
 * restent deux lignes distinctes.
 *
 * Ces cles ne sont pas des identifiants de base : elles vivent le temps du
 * formulaire, ne sont jamais persistees, et le serveur ne leur accorde aucune
 * autorite — il s'en sert seulement pour regrouper des champs.
 *
 * ## Pourquoi les types de lignes vivent **ici**
 *
 * Parce que ce module est le seul des deux qu'un Client Component puisse
 * importer. `lib/task-edit.ts` calcule une revision : il depend de
 * `node:crypto` et de `@nox/database`, donc du client Prisma. Un formulaire qui
 * l'importerait pour une simple fabrique de ligne vide entrainerait toute la
 * couche donnees dans le bundle du navigateur — exactement la frontiere que
 * NOX interdit.
 *
 * Module pur : ni base, ni React, ni reseau, ni Node.
 */

import { COMMAND_EXECUTION_MODE, VERIFICATION_MODE } from "@nox/shared";

/**
 * Une ligne de critere dans le formulaire.
 *
 * `key` est une identite **d'interface** : elle ne vient pas de la base, ne s'y
 * retrouve jamais, et sert uniquement a ce que React ne remonte pas un champ
 * quand la ligne au-dessus disparait. Une cle derivee du texte a deja fait
 * perdre le focus a chaque frappe dans le formulaire de backlog.
 *
 * Les modes sont des chaines brutes : le navigateur peut envoyer n'importe quoi,
 * et c'est le serveur qui revalide la valeur.
 */
export type TaskEditCriterionRow = {
  key: string;
  text: string;
  verificationMode: string;
  humanInstructions: string;
  /** Cles des lignes de commande qui prouvent ce critere. */
  commandKeys: readonly string[];
};

/** Une ligne de commande dans le formulaire. */
export type TaskEditCommandRow = {
  key: string;
  command: string;
  executionMode: string;
};

/** Valeurs brutes du formulaire d'edition d'une tache. */
export type TaskEditFormValues = {
  title: string;
  priority: string;
  objective: string;
  context: string;
  outOfScope: string;
  /** Une ligne par document, tel que saisi. */
  documents: string;
  criteria: readonly TaskEditCriterionRow[];
  commands: readonly TaskEditCommandRow[];
  /** Identifiants coches, dans l'ordre d'affichage. */
  dependsOnTaskIds: readonly string[];
};

/** Une ligne de critere neuve, telle que l'editeur l'ajoute. */
export function emptyCriterionRow(key: string): TaskEditCriterionRow {
  return {
    key,
    text: "",
    // `HUMAN` par defaut : c'est la valeur qui n'autorise rien. Un critere qui
    // naitrait automatise ouvrirait une porte que personne n'a demandee.
    verificationMode: VERIFICATION_MODE.HUMAN,
    humanInstructions: "",
    commandKeys: [],
  };
}

/** Une ligne de commande neuve, telle que l'editeur l'ajoute. */
export function emptyCommandRow(key: string): TaskEditCommandRow {
  return { key, command: "", executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY };
}

/** Prefixe des champs, pour un formulaire qui porte plusieurs plans. */
export type PlanFieldPrefix = string;

/** Noms des champs d'un plan, pour un prefixe donne. */
export function planFieldNames(prefix: PlanFieldPrefix) {
  return {
    criterionKey: `${prefix}criterionKey`,
    commandKey: `${prefix}commandKey`,
    criterionText: (key: string): string => `${prefix}criterionText.${key}`,
    criterionMode: (key: string): string => `${prefix}criterionMode.${key}`,
    criterionInstructions: (key: string): string => `${prefix}criterionInstructions.${key}`,
    criterionCommands: (key: string): string => `${prefix}criterionCommands.${key}`,
    commandText: (key: string): string => `${prefix}commandText.${key}`,
    commandMode: (key: string): string => `${prefix}commandMode.${key}`,
  };
}

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function readStrings(formData: FormData, field: string): string[] {
  return formData.getAll(field).filter((entry): entry is string => typeof entry === "string");
}

/**
 * Relit les cles d'une liste, dans l'ordre d'affichage.
 *
 * Les cles vides et les doublons sont ignores : ils ne peuvent venir que d'un
 * formulaire forge, et les honorer ferait apparaitre deux lignes qui partagent
 * leurs champs.
 */
function readKeys(formData: FormData, field: string): string[] {
  const seen = new Set<string>();
  return readStrings(formData, field).filter((key) =>
    key === "" || seen.has(key) ? false : (seen.add(key), true),
  );
}

/** Le plan tel qu'un formulaire l'a envoye, sans aucune interpretation. */
export type SubmittedPlanRows = {
  criteria: TaskEditCriterionRow[];
  commands: TaskEditCommandRow[];
};

/** Relit un plan depuis les champs d'un formulaire. */
export function readPlanRows(formData: FormData, prefix: PlanFieldPrefix): SubmittedPlanRows {
  const names = planFieldNames(prefix);
  return {
    criteria: readKeys(formData, names.criterionKey).map((key) => ({
      key,
      text: readField(formData, names.criterionText(key)),
      verificationMode: readField(formData, names.criterionMode(key)),
      humanInstructions: readField(formData, names.criterionInstructions(key)),
      commandKeys: readStrings(formData, names.criterionCommands(key)),
    })),
    commands: readKeys(formData, names.commandKey).map((key) => ({
      key,
      command: readField(formData, names.commandText(key)),
      executionMode: readField(formData, names.commandMode(key)),
    })),
  };
}
