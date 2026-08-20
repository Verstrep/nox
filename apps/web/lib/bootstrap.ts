/**
 * Amorcage d'un projet, cote serveur.
 *
 * ## Ce que ce module fait
 *
 * Il relit ce dont un amorcage a besoin, puis delegue au service. Rien d'autre.
 *
 * ## Ce qu'il ne fait jamais
 *
 * Aucun appel a OpenAI, ni ici ni ailleurs dans l'amorcage. Aucune execution de
 * Claude Code. Aucune ecriture au chargement.
 *
 * La lecture du repository — donc l'appel au runner — n'arrive qu'au moment de
 * l'apercu, une fois les preconditions locales satisfaites : un projet sans
 * plan n'a aucune raison de faire travailler le runner.
 */

import {
  getDatabaseClient,
  listActiveProjectMemories,
  listTaskObjectives,
  listTasksByProject,
  type DatabaseClient,
} from "@nox/database";
import { connection } from "next/server";
import process from "node:process";

import type { BootstrapProjectInput } from "./bootstrap/service.ts";
import { loadAppliedBacklogCount, loadBootstrapTask } from "./bootstrap/service.ts";
import { loadStructuredState } from "./project-plan.ts";

/** Un projet, tel que ce module en a besoin. */
export type BootstrapProject = {
  id: string;
  name: string;
  repositoryPath: string;
};

/**
 * Assemble ce dont un amorcage a besoin, a partir de la base.
 *
 * Tout est relu **maintenant** : les taches, la memoire, le brief, le plan, le
 * nombre de backlogs appliques et la tache d'amorcage existante. Rien n'est
 * fige a l'ouverture de la page — un plan modifie entre l'affichage et le clic
 * doit compter au clic, pas a l'affichage.
 */
export async function loadBootstrapInput(
  db: DatabaseClient,
  project: BootstrapProject,
): Promise<BootstrapProjectInput> {
  await connection();

  const [tasks, objectives, memories, structuredState, appliedBacklogCount, existingTask] =
    await Promise.all([
      listTasksByProject(db, project.id),
      listTaskObjectives(db, project.id),
      listActiveProjectMemories(db, project.id),
      loadStructuredState(db, project),
      loadAppliedBacklogCount(db, project.id),
      loadBootstrapTask(db, project.id),
    ]);

  return {
    projectId: project.id,
    projectName: project.name,
    repositoryPath: project.repositoryPath,
    tasks,
    objectives,
    memories,
    structuredState,
    appliedBacklogCount,
    existingTask,
    environment: process.env,
  };
}

/** Relit uniquement la tache d'amorcage. Aucune sortie hors de SQLite. */
export async function loadProjectBootstrapTask(projectId: string) {
  await connection();
  return loadBootstrapTask(getDatabaseClient(), projectId);
}
