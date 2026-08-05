/**
 * Categorisation et tri des documents.
 *
 * Fonctions pures, sans acces au systeme de fichiers : elles operent sur un
 * chemin relatif normalise (separateurs `/`) et sont donc testables directement.
 *
 * La categorie est deduite du **chemin**, jamais du contenu : aucune analyse de
 * titre, aucune heuristique, aucune IA. Un fichier deplace change de categorie
 * de facon previsible.
 */

import { PROJECT_DOCUMENT_CATEGORY, type ProjectDocumentCategory } from "@nox/shared";

import { CORE_DOCUMENTS } from "./constants.ts";

/**
 * Documents principaux, indexes en minuscules.
 *
 * La comparaison ignore la casse : sous Windows, `docs/readme.md` et
 * `docs/README.md` designent le meme fichier, et l'inventaire ne doit pas
 * dependre de la facon dont le systeme le rapporte.
 */
const CORE_DOCUMENT_KEYS: ReadonlySet<string> = new Set(
  CORE_DOCUMENTS.map((documentPath) => documentPath.toLowerCase()),
);

/** Categorie associee au premier segment du chemin. */
const DIRECTORY_CATEGORIES: ReadonlyMap<string, ProjectDocumentCategory> = new Map([
  ["docs", PROJECT_DOCUMENT_CATEGORY.DOCUMENTATION],
  ["decisions", PROJECT_DOCUMENT_CATEGORY.DECISION],
  ["plans", PROJECT_DOCUMENT_CATEGORY.PLAN],
  ["tasks", PROJECT_DOCUMENT_CATEGORY.TASK],
]);

/** Rang de tri des categories, du plus important au moins important. */
const CATEGORY_ORDER: Record<ProjectDocumentCategory, number> = {
  [PROJECT_DOCUMENT_CATEGORY.CORE]: 0,
  [PROJECT_DOCUMENT_CATEGORY.DOCUMENTATION]: 1,
  [PROJECT_DOCUMENT_CATEGORY.DECISION]: 2,
  [PROJECT_DOCUMENT_CATEGORY.PLAN]: 3,
  [PROJECT_DOCUMENT_CATEGORY.TASK]: 4,
};

/** Determine la categorie d'un document a partir de son chemin relatif. */
export function categorizeDocument(relativePath: string): ProjectDocumentCategory {
  if (CORE_DOCUMENT_KEYS.has(relativePath.toLowerCase())) {
    return PROJECT_DOCUMENT_CATEGORY.CORE;
  }

  const firstSegment = relativePath.split("/")[0]?.toLowerCase() ?? "";
  return DIRECTORY_CATEGORIES.get(firstSegment) ?? PROJECT_DOCUMENT_CATEGORY.DOCUMENTATION;
}

/**
 * Compare deux documents pour un tri stable : categorie d'abord, puis chemin.
 *
 * La comparaison de chemins ignore la casse et utilise l'ordre local, pour que
 * les accents se placent la ou un lecteur francophone les attend.
 */
export function compareDocuments(
  left: { path: string; category: ProjectDocumentCategory },
  right: { path: string; category: ProjectDocumentCategory },
): number {
  const byCategory = CATEGORY_ORDER[left.category] - CATEGORY_ORDER[right.category];
  if (byCategory !== 0) {
    return byCategory;
  }

  return left.path.localeCompare(right.path, "fr", { sensitivity: "base" });
}
