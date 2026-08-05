/**
 * Contrat des documents Markdown d'un projet.
 *
 * Prolonge le contrat runner de `runner.ts` : le runner inventorie et lit les
 * fichiers, le web les affiche. Les codes d'erreur restent declares dans
 * `RUNNER_ERROR`, source unique pour toutes les routes.
 *
 * Regle structurante : **seul un chemin relatif circule**. Le chemin absolu du
 * repository ne quitte jamais le runner, et n'apparait donc jamais dans une
 * reponse ni dans le navigateur.
 */

import { createStatusGuard } from "./statuses.js";

/**
 * Familles de documents reconnues.
 *
 * `CORE` designe les documents de reference explicitement listes par NOX ; les
 * autres decoulent du dossier qui contient le fichier.
 */
export const PROJECT_DOCUMENT_CATEGORY = {
  CORE: "CORE",
  DOCUMENTATION: "DOCUMENTATION",
  DECISION: "DECISION",
  PLAN: "PLAN",
  TASK: "TASK",
} as const;

export type ProjectDocumentCategory =
  (typeof PROJECT_DOCUMENT_CATEGORY)[keyof typeof PROJECT_DOCUMENT_CATEGORY];

export const PROJECT_DOCUMENT_CATEGORIES: readonly ProjectDocumentCategory[] =
  Object.values(PROJECT_DOCUMENT_CATEGORY);

export const isProjectDocumentCategory = createStatusGuard(PROJECT_DOCUMENT_CATEGORIES);

/** Fiche d'un document, sans son contenu. */
export type ProjectDocumentSummary = {
  /** Chemin relatif a la racine du repository, separateurs `/`. */
  path: string;
  /** Nom du fichier, derive du chemin. */
  name: string;
  category: ProjectDocumentCategory;
  /** Taille en octets. */
  size: number;
  /** Date de derniere modification, au format ISO 8601. */
  updatedAt: string;
};

/** Document complet : la fiche et son contenu brut. */
export type ProjectDocumentContent = ProjectDocumentSummary & {
  content: string;
};

export type ListProjectDocumentsRequest = {
  repositoryPath: string;
};

export type ListProjectDocumentsSuccess = {
  ok: true;
  documents: ProjectDocumentSummary[];
};

export type ReadProjectDocumentRequest = {
  repositoryPath: string;
  documentPath: string;
};

export type ReadProjectDocumentSuccess = {
  ok: true;
  document: ProjectDocumentContent;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Valide le corps recu par `POST /repositories/documents/list`. */
export function parseListProjectDocumentsRequest(
  value: unknown,
): ListProjectDocumentsRequest | null {
  if (!isRecord(value) || typeof value["repositoryPath"] !== "string") {
    return null;
  }
  return { repositoryPath: value["repositoryPath"] };
}

/** Valide le corps recu par `POST /repositories/documents/read`. */
export function parseReadProjectDocumentRequest(
  value: unknown,
): ReadProjectDocumentRequest | null {
  if (
    !isRecord(value) ||
    typeof value["repositoryPath"] !== "string" ||
    typeof value["documentPath"] !== "string"
  ) {
    return null;
  }
  return {
    repositoryPath: value["repositoryPath"],
    documentPath: value["documentPath"],
  };
}

function isProjectDocumentSummary(value: unknown): value is ProjectDocumentSummary {
  return (
    isRecord(value) &&
    typeof value["path"] === "string" &&
    typeof value["name"] === "string" &&
    isProjectDocumentCategory(value["category"]) &&
    typeof value["size"] === "number" &&
    typeof value["updatedAt"] === "string"
  );
}

/** Verifie qu'une reponse JSON est un inventaire de documents valide. */
export function isListProjectDocumentsSuccess(
  value: unknown,
): value is ListProjectDocumentsSuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }
  const documents: unknown = value["documents"];
  return Array.isArray(documents) && documents.every(isProjectDocumentSummary);
}

/** Verifie qu'une reponse JSON est une lecture de document valide. */
export function isReadProjectDocumentSuccess(
  value: unknown,
): value is ReadProjectDocumentSuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }
  const document: unknown = value["document"];
  return isProjectDocumentSummary(document) && typeof (document as ProjectDocumentContent).content === "string";
}
