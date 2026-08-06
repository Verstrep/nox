/**
 * Validation du formulaire de creation d'une tache.
 *
 * Volontairement separee de la Server Action : ce module n'importe ni Prisma, ni
 * Next.js, ni React. Il est donc testable directement, la ou une Server Action
 * ne l'est pas sans demarrer l'application.
 *
 * Rien ici ne touche au disque. Un chemin de document n'est **pas** verifie
 * comme existant : une tache peut legitimement referencer un fichier qui sera
 * cree avant son execution. Seule sa forme est controlee.
 */

import { TASK_PRIORITY, isTaskPriority, type TaskPriority } from "@nox/shared";

import { normalizeSubmittedContent } from "./document-edit.ts";

/**
 * Limites de saisie.
 *
 * Elles n'existent pas pour contrarier l'utilisateur mais pour borner ce qui
 * finira dans un fichier et, plus tard, dans un prompt : une tache dont
 * l'objectif fait dix pages n'est pas une tache, c'est un projet.
 */
export const TASK_LIMITS = {
  title: 160,
  objective: 5_000,
  context: 10_000,
  outOfScope: 5_000,
  criteria: { count: 100, length: 1_000 },
  documents: { count: 100, length: 500 },
  commands: { count: 50, length: 1_000 },
} as const;

/** Valeurs brutes du formulaire, telles que soumises. */
export type TaskFormValues = {
  title: string;
  priority: string;
  objective: string;
  context: string;
  outOfScope: string;
  /** Une ligne par document, tel que saisi. */
  documents: string;
  /** Une ligne par critere. */
  criteria: string;
  /** Une ligne par commande. */
  commands: string;
};

/** Specification validee, prete a etre enregistree. */
export type TaskSpecificationInput = {
  title: string;
  objective: string;
  context: string | null;
  outOfScope: string | null;
  priority: TaskPriority;
  acceptanceCriteria: string[];
  documentReferences: string[];
  validationCommands: string[];
};

export type TaskInputResult =
  | { ok: true; input: TaskSpecificationInput }
  | { ok: false; message: string };

export const EMPTY_TASK_FORM_VALUES: TaskFormValues = {
  title: "",
  priority: TASK_PRIORITY.MEDIUM,
  objective: "",
  context: "",
  outOfScope: "",
  documents: "",
  criteria: "",
  commands: "",
};

/** Detecte un schema d'URL — ce qui capte aussi `C:` sous Windows. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Decoupe une zone de texte en entrees, une par ligne.
 *
 * Les lignes vides disparaissent et les espaces de bord sont retires : une
 * ligne vide au milieu d'une liste est une respiration a la saisie, pas un
 * critere sans texte.
 */
export function readLines(raw: string): string[] {
  return normalizeSubmittedContent(raw)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Retire les doublons en conservant la premiere occurrence.
 *
 * L'ordre de saisie est significatif — il sera lu par un agent — donc c'est la
 * premiere position qui est gardee, jamais la derniere.
 */
function deduplicate(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  return entries.filter((entry) => (seen.has(entry) ? false : (seen.add(entry), true)));
}

/** Normalise un champ de texte libre : fins de ligne LF, sans marges. */
function readText(raw: string): string {
  return normalizeSubmittedContent(raw).trim();
}

function tooLong(label: string, limit: number): string {
  return `${label} ne peut pas depasser ${String(limit)} caracteres.`;
}

function tooMany(label: string, limit: number): string {
  return `Une tache ne peut pas comporter plus de ${String(limit)} ${label}.`;
}

/**
 * Verifie la forme d'un chemin de document de reference.
 *
 * Le disque n'est pas consulte : NOX ignore si le fichier existe, et c'est
 * volontaire. Seules les formes qui ne pourraient jamais designer un fichier du
 * repository sont refusees.
 */
function checkDocumentPath(reference: string): string | null {
  if (reference.includes("\0")) {
    return "Un chemin de document contient un caractere interdit.";
  }

  if (
    URL_SCHEME.test(reference) ||
    reference.startsWith("/") ||
    reference.startsWith("\\")
  ) {
    return `« ${reference} » doit etre un chemin relatif au repository, sans lettre de lecteur ni barre initiale.`;
  }

  if (reference.replaceAll("\\", "/").split("/").includes("..")) {
    return `« ${reference} » ne peut pas contenir « .. ».`;
  }

  if (reference.length > TASK_LIMITS.documents.length) {
    return tooLong("Un chemin de document", TASK_LIMITS.documents.length);
  }

  return null;
}

/**
 * Valide les champs du formulaire et produit une specification enregistrable.
 *
 * Retourne le **premier** probleme rencontre : corriger une erreur a la fois
 * est plus simple que de lire une liste de reproches, et l'ordre suit celui du
 * formulaire.
 */
export function readTaskSubmission(values: TaskFormValues): TaskInputResult {
  const title = readText(values.title).replace(/\s+/g, " ");
  if (title === "") {
    return { ok: false, message: "Indiquez un titre." };
  }
  if (title.length > TASK_LIMITS.title) {
    return { ok: false, message: tooLong("Le titre", TASK_LIMITS.title) };
  }

  if (!isTaskPriority(values.priority)) {
    return { ok: false, message: "Choisissez une priorite valide." };
  }

  const objective = readText(values.objective);
  if (objective === "") {
    return { ok: false, message: "Indiquez l'objectif de la tache." };
  }
  if (objective.length > TASK_LIMITS.objective) {
    return { ok: false, message: tooLong("L'objectif", TASK_LIMITS.objective) };
  }

  const context = readText(values.context);
  if (context.length > TASK_LIMITS.context) {
    return { ok: false, message: tooLong("Le contexte", TASK_LIMITS.context) };
  }

  const outOfScope = readText(values.outOfScope);
  if (outOfScope.length > TASK_LIMITS.outOfScope) {
    return { ok: false, message: tooLong("Le hors perimetre", TASK_LIMITS.outOfScope) };
  }

  const documentReferences = deduplicate(readLines(values.documents));
  if (documentReferences.length > TASK_LIMITS.documents.count) {
    return { ok: false, message: tooMany("documents a lire", TASK_LIMITS.documents.count) };
  }
  for (const reference of documentReferences) {
    const problem = checkDocumentPath(reference);
    if (problem !== null) {
      return { ok: false, message: problem };
    }
  }

  const acceptanceCriteria = readLines(values.criteria);
  if (acceptanceCriteria.length === 0) {
    return {
      ok: false,
      message: "Indiquez au moins un critere d'acceptation : sans lui, personne ne peut dire que la tache est terminee.",
    };
  }
  if (acceptanceCriteria.length > TASK_LIMITS.criteria.count) {
    return { ok: false, message: tooMany("criteres d'acceptation", TASK_LIMITS.criteria.count) };
  }
  if (acceptanceCriteria.some((entry) => entry.length > TASK_LIMITS.criteria.length)) {
    return { ok: false, message: tooLong("Un critere d'acceptation", TASK_LIMITS.criteria.length) };
  }

  const validationCommands = readLines(values.commands);
  if (validationCommands.length > TASK_LIMITS.commands.count) {
    return { ok: false, message: tooMany("commandes de validation", TASK_LIMITS.commands.count) };
  }
  if (validationCommands.some((entry) => entry.length > TASK_LIMITS.commands.length)) {
    return { ok: false, message: tooLong("Une commande de validation", TASK_LIMITS.commands.length) };
  }

  return {
    ok: true,
    input: {
      title,
      objective,
      context: context === "" ? null : context,
      outOfScope: outOfScope === "" ? null : outOfScope,
      priority: values.priority,
      acceptanceCriteria,
      documentReferences,
      validationCommands,
    },
  };
}
