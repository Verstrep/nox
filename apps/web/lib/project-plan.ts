/**
 * Etat structure d'un projet, cote serveur.
 *
 * ## Ce que ce module fait
 *
 * Il cable le nettoyeur et les fonctions de revision, puis delegue a la couche
 * de persistance. Rien d'autre.
 *
 * ## Ce qu'il ne fait jamais
 *
 * Aucun appel a OpenAI, aucun appel a Claude Code, aucun appel au runner, aucune
 * ecriture de fichier, aucune commande Git. Le brief et le plan sont des lignes
 * SQLite : les lire et les ecrire doit fonctionner runner arrete et sans
 * configuration OpenAI.
 *
 * ## Un seul assemblage
 *
 * Le nettoyeur est exactement celui de la preparation d'un tour, et les
 * revisions exactement celles de l'empreinte de contexte. C'est ce qui garantit
 * qu'un brief accepte a l'ecriture tiendra dans le contexte a l'envoi, et que la
 * revision affichee est celle que le fournisseur verra.
 */

import {
  loadProjectStructuredState,
  saveProjectBrief as persistProjectBrief,
  saveProjectV1Plan as persistProjectV1Plan,
  type DatabaseClient,
  type ProjectPlanTools,
  type ProjectPlanWriteResult,
  type ProjectStructuredState,
} from "@nox/database";
import type { ProjectBriefInput, ProjectV1PlanInput } from "@nox/shared";
import process from "node:process";

import { createArchitectSanitizer } from "./architect/sanitize.ts";
import { projectBriefRevision, projectV1PlanRevision } from "./architect/fingerprint.ts";

/**
 * Nettoyeur et revisions, assembles une fois.
 *
 * Le chemin du repository entre dans le nettoyeur : c'est lui qui permet de
 * rendre relatifs les chemins internes et de masquer les chemins exterieurs.
 */
export function projectPlanTools(repositoryPath: string): ProjectPlanTools {
  return {
    sanitize: createArchitectSanitizer({
      repositoryRoot: repositoryPath,
      environment: process.env,
    }),
    revisions: { brief: projectBriefRevision, plan: projectV1PlanRevision },
  };
}

/**
 * Lit l'etat structure d'un projet.
 *
 * Isolee pour la meme raison que `loadActiveProjectMemories` : la page qui
 * inspecte le contexte et l'envoi doivent voir **exactement** le meme etat. Deux
 * lectures, meme voisines, feraient afficher un apercu different de ce qui part.
 */
export function loadStructuredState(
  db: DatabaseClient,
  project: { id: string; repositoryPath: string },
): Promise<ProjectStructuredState> {
  return loadProjectStructuredState(db, project.id, projectPlanTools(project.repositoryPath));
}

/** Enregistre le brief. `expectedRevision` est un jeton de concurrence. */
export function saveBrief(
  db: DatabaseClient,
  project: { id: string; repositoryPath: string },
  values: ProjectBriefInput,
  expectedRevision?: string | null,
): Promise<ProjectPlanWriteResult> {
  return persistProjectBrief(db, {
    projectId: project.id,
    values,
    tools: projectPlanTools(project.repositoryPath),
    expectedRevision,
  });
}

/** Enregistre le plan de V1. */
export function savePlan(
  db: DatabaseClient,
  project: { id: string; repositoryPath: string },
  values: ProjectV1PlanInput,
  expectedRevision?: string | null,
): Promise<ProjectPlanWriteResult> {
  return persistProjectV1Plan(db, {
    projectId: project.id,
    values,
    tools: projectPlanTools(project.repositoryPath),
    expectedRevision,
  });
}
