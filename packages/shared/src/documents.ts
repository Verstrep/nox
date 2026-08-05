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

/**
 * Empreinte du contenu d'un document, en hexadecimal minuscule.
 *
 * Calculee par le runner sur les **octets reels** du fichier. Elle n'est pas
 * derivee du chemin : deux fichiers de meme contenu partagent la meme revision,
 * ce qui est sans consequence puisqu'elle n'identifie pas un document, elle
 * decrit son etat.
 *
 * Elle peut circuler jusqu'au navigateur : elle ne revele ni chemin, ni contenu.
 */
export type ProjectDocumentRevision = string;

/** SHA-256 en hexadecimal minuscule : 64 caracteres. */
const REVISION_PATTERN = /^[0-9a-f]{64}$/;

export function isProjectDocumentRevision(value: unknown): value is ProjectDocumentRevision {
  return typeof value === "string" && REVISION_PATTERN.test(value);
}

/** Document complet : la fiche, son contenu brut et sa revision. */
export type ProjectDocumentContent = ProjectDocumentSummary & {
  content: string;
  revision: ProjectDocumentRevision;
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

/**
 * Demande de mise a jour d'un document **existant**.
 *
 * `expectedRevision` est la revision recue lors de la lecture. Le runner refuse
 * l'ecriture si le fichier a change depuis : c'est tout le mecanisme de
 * protection contre l'ecrasement d'une modification concurrente.
 *
 * Une chaine vide est un contenu parfaitement valide — vider un document est une
 * modification comme une autre.
 */
export type UpdateProjectDocumentRequest = {
  repositoryPath: string;
  documentPath: string;
  content: string;
  expectedRevision: ProjectDocumentRevision;
};

export type UpdateProjectDocumentSuccess = {
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

/**
 * Valide le corps recu par `POST /repositories/documents/update`.
 *
 * Les quatre champs doivent etre des chaines : un `content` absent ou d'un autre
 * type est un desaccord de contrat, pas une erreur d'edition. Le **format** de
 * la revision et la taille du contenu sont verifies plus loin, par le runner,
 * qui dispose de codes d'erreur dedies pour les distinguer.
 */
export function parseUpdateProjectDocumentRequest(
  value: unknown,
): UpdateProjectDocumentRequest | null {
  if (
    !isRecord(value) ||
    typeof value["repositoryPath"] !== "string" ||
    typeof value["documentPath"] !== "string" ||
    typeof value["content"] !== "string" ||
    typeof value["expectedRevision"] !== "string"
  ) {
    return null;
  }
  return {
    repositoryPath: value["repositoryPath"],
    documentPath: value["documentPath"],
    content: value["content"],
    expectedRevision: value["expectedRevision"],
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

function isProjectDocumentContent(value: unknown): value is ProjectDocumentContent {
  return (
    isProjectDocumentSummary(value) &&
    typeof (value as ProjectDocumentContent).content === "string" &&
    isProjectDocumentRevision((value as ProjectDocumentContent).revision)
  );
}

/** Verifie qu'une reponse JSON est une lecture de document valide. */
export function isReadProjectDocumentSuccess(
  value: unknown,
): value is ReadProjectDocumentSuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }
  return isProjectDocumentContent(value["document"]);
}

/**
 * Verifie qu'une reponse JSON est une mise a jour reussie.
 *
 * Meme forme que la lecture : apres ecriture, le runner relit le document et
 * renvoie sa fiche complete, avec sa **nouvelle** revision.
 */
export function isUpdateProjectDocumentSuccess(
  value: unknown,
): value is UpdateProjectDocumentSuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }
  return isProjectDocumentContent(value["document"]);
}
