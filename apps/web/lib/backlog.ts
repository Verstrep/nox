/**
 * Backlog de V1, cote serveur.
 *
 * ## Ce que ce module fait
 *
 * Il relit ce dont une planification a besoin, puis delegue au service. Rien
 * d'autre.
 *
 * ## Ce qu'il ne fait jamais
 *
 * Ouvrir la page Backlog n'appelle ni OpenAI, ni Claude Code, et n'ecrit rien.
 * `loadProjectBacklogView` lit SQLite, et seulement SQLite : la page s'affiche
 * runner arrete et sans configuration OpenAI, avec son bouton `Generate` et
 * l'explication de ce qu'il coute.
 *
 * La lecture du repository — donc l'appel au runner — n'arrive qu'au moment ou
 * elle sert vraiment : construire le contexte d'une planification, verifier la
 * fraicheur d'une proposition, ou preparer une application.
 *
 * ## Un seul assemblage
 *
 * Les taches, la memoire et l'etat structure sont relus par les memes fonctions
 * que l'Architecte, avec le meme nettoyeur et les memes revisions. C'est ce qui
 * garantit que l'empreinte comparee a l'application est de la meme nature que
 * celle enregistree a la generation.
 */

import {
  getDatabaseClient,
  listActiveProjectMemories,
  listTaskObjectives,
  listTasksByProject,
  loadProjectBacklog,
  type DatabaseClient,
  type ProjectBacklogView,
} from "@nox/database";
import { connection } from "next/server";
import process from "node:process";

import { loadArchitectConfig } from "./architect/config.ts";
import type { BacklogProjectInput } from "./backlog/service.ts";
import { loadStructuredState } from "./project-plan.ts";

/** Un projet, tel que ce module en a besoin. */
export type BacklogProject = {
  id: string;
  name: string;
  repositoryPath: string;
};

/** Lit tout ce que la page Backlog affiche. Aucune sortie hors de SQLite. */
export async function loadProjectBacklogView(
  projectId: string,
): Promise<ProjectBacklogView> {
  await connection();
  return loadProjectBacklog(getDatabaseClient(), projectId);
}

export type BacklogInputResult =
  | { ok: true; input: BacklogProjectInput }
  /** L'Architecte n'est pas configure : les **noms** manquants, jamais les valeurs. */
  | { ok: false; missing: string[] };

/**
 * Assemble ce dont une planification a besoin, a partir de la base.
 *
 * Tout est relu **maintenant** : les taches, la memoire, le brief et le plan.
 * Rien n'est fige a l'ouverture de la page, exactement comme pour un tour de
 * conversation — un plan modifie entre l'affichage et le clic doit partir avec
 * le clic, pas avec l'affichage.
 */
export async function loadBacklogInput(
  db: DatabaseClient,
  project: BacklogProject,
): Promise<BacklogInputResult> {
  const config = loadArchitectConfig(process.env);
  if (!config.ok) {
    return { ok: false, missing: config.missing };
  }

  const [tasks, objectives, memories, structuredState] = await Promise.all([
    listTasksByProject(db, project.id),
    listTaskObjectives(db, project.id),
    listActiveProjectMemories(db, project.id),
    loadStructuredState(db, project),
  ]);

  return {
    ok: true,
    input: {
      projectId: project.id,
      projectName: project.name,
      repositoryPath: project.repositoryPath,
      tasks,
      objectives,
      memories,
      structuredState,
      model: config.config.model,
      environment: process.env,
    },
  };
}
