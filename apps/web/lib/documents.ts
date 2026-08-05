/**
 * Lecture des documents d'un projet pour les Server Components.
 *
 * Comme `lib/projects.ts`, ces fonctions appellent `connection()` : sans lui,
 * Next.js interrogerait le runner pendant le build et figerait le resultat.
 *
 * Aucune de ces fonctions ne touche au systeme de fichiers. Le web ne connait
 * du repository que le chemin stocke en base, qu'il transmet au runner.
 */

import type { ProjectDocumentCategory, ProjectDocumentContent, ProjectDocumentSummary } from "@nox/shared";
import { connection } from "next/server";

import { listProjectDocuments, readProjectDocument } from "./runner/client";
import { describeRunnerFailure, type RunnerFailure } from "./runner/errors";

export type DocumentsLoadResult =
  | { ok: true; documents: ProjectDocumentSummary[] }
  | { ok: false; message: string; failure: RunnerFailure };

export type DocumentLoadResult =
  | { ok: true; document: ProjectDocumentContent }
  | { ok: false; message: string; failure: RunnerFailure };

/** Libelles francais des categories, pour l'affichage. */
const CATEGORY_LABELS: Record<ProjectDocumentCategory, string> = {
  CORE: "Principal",
  DOCUMENTATION: "Documentation",
  DECISION: "Decision",
  PLAN: "Plan",
  TASK: "Tache",
};

export function describeCategory(category: ProjectDocumentCategory): string {
  return CATEGORY_LABELS[category];
}

/** Inventorie les documents d'un projet, sans jamais lever d'exception. */
export async function loadProjectDocuments(repositoryPath: string): Promise<DocumentsLoadResult> {
  await connection();

  const result = await listProjectDocuments(repositoryPath);
  if (result.ok) {
    return { ok: true, documents: result.value };
  }

  return { ok: false, message: describeRunnerFailure(result.failure), failure: result.failure };
}

/** Lit un document d'un projet, sans jamais lever d'exception. */
export async function loadProjectDocument(
  repositoryPath: string,
  documentPath: string,
): Promise<DocumentLoadResult> {
  await connection();

  const result = await readProjectDocument(repositoryPath, documentPath);
  if (result.ok) {
    return { ok: true, document: result.value };
  }

  return { ok: false, message: describeRunnerFailure(result.failure), failure: result.failure };
}
