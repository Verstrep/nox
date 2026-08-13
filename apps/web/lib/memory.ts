/**
 * Memoire projet, cote serveur.
 *
 * ## Ce que ce module fait
 *
 * Il relit la memoire d'un projet et applique les ecritures demandees par
 * l'utilisateur. Rien d'autre.
 *
 * ## Ce qu'il ne fait jamais
 *
 * Aucun appel a OpenAI, aucun appel a Claude Code, aucun appel au runner, aucune
 * ecriture de fichier, aucune commande Git. Une memoire est une ligne SQLite,
 * et la page Memory doit fonctionner runner arrete et sans configuration
 * OpenAI — c'est meme la premiere chose que verifie le test fonctionnel.
 *
 * ## Le nettoyeur, ici, sert a mesurer
 *
 * Le budget porte sur le texte **reellement envoye** a l'Architecte, donc apres
 * sanitation. Ce module construit donc le meme nettoyeur que la preparation d'un
 * tour, et le passe a la couche d'ecriture. Deux mesures differentes — l'une a
 * l'ecriture, l'autre a l'envoi — finiraient par autoriser une entree que le
 * contexte ne pourrait pas transporter.
 */

import {
  createProjectMemory,
  deleteProjectMemory,
  getDatabaseClient,
  getProjectMemory,
  listActiveProjectMemories,
  listProjectMemories,
  projectMemoryStats,
  setProjectMemoryStatus,
  updateProjectMemory,
  type MemoryWriteResult,
  type ProjectMemoryStats,
} from "@nox/database";
import type {
  ProjectMemoryEntry,
  ProjectMemoryStatus,
  ProjectMemoryValues,
} from "@nox/shared";
import { connection } from "next/server";

import { createArchitectSanitizer } from "./architect/sanitize.ts";

/**
 * Nettoyeur applique pour mesurer le budget.
 *
 * Exactement celui de la preparation d'un tour Architecte : meme racine de
 * repository, meme environnement. C'est ce qui garantit qu'une entree acceptee
 * a l'ecriture tiendra dans le contexte au moment de l'envoi.
 */
function memorySanitizer(repositoryPath: string): (value: string) => string {
  return createArchitectSanitizer({
    repositoryRoot: repositoryPath,
    environment: process.env,
  });
}

/** Ce que la page Memory affiche : les entrees et l'etat du budget. */
export type ProjectMemoryView = {
  entries: ProjectMemoryEntry[];
  stats: ProjectMemoryStats;
};

/** Lit la memoire d'un projet, avec son budget consomme. */
export async function loadProjectMemory(project: {
  id: string;
  repositoryPath: string;
}): Promise<ProjectMemoryView> {
  await connection();

  const db = getDatabaseClient();
  const sanitize = memorySanitizer(project.repositoryPath);

  const [entries, stats] = await Promise.all([
    listProjectMemories(db, project.id),
    projectMemoryStats(db, project.id, sanitize),
  ]);

  return { entries, stats };
}

/** Lit une entree, ou `null` si elle n'existe pas. */
export async function loadMemoryEntry(memoryId: string): Promise<ProjectMemoryEntry | null> {
  await connection();
  return getProjectMemory(getDatabaseClient(), memoryId);
}

/**
 * Entrees actives d'un projet, dans l'ordre des codes.
 *
 * Isolee pour la meme raison que `loadRecentArchitectTasks` : la page de
 * preparation et l'envoi doivent voir **exactement** la meme memoire. Deux
 * lectures, meme voisines, feraient afficher une preview differente de ce qui
 * part — c'est-a-dire un mensonge, sur la seule page dont le role est de dire la
 * verite.
 */
export async function loadActiveProjectMemories(
  projectId: string,
): Promise<ProjectMemoryEntry[]> {
  await connection();
  return listActiveProjectMemories(getDatabaseClient(), projectId);
}

/** Cree une entree. Le budget est verifie dans la transaction d'ecriture. */
export async function createMemoryEntry(
  project: { id: string; repositoryPath: string },
  values: ProjectMemoryValues,
): Promise<MemoryWriteResult> {
  await connection();
  return createProjectMemory(getDatabaseClient(), {
    projectId: project.id,
    values,
    sanitize: memorySanitizer(project.repositoryPath),
  });
}

/** Modifie une entree. Le code et le projet ne changent jamais. */
export async function updateMemoryEntry(
  project: { id: string; repositoryPath: string },
  memoryId: string,
  values: ProjectMemoryValues,
): Promise<MemoryWriteResult> {
  await connection();
  return updateProjectMemory(getDatabaseClient(), {
    memoryId,
    values,
    sanitize: memorySanitizer(project.repositoryPath),
  });
}

/** Archive ou restaure une entree, sans toucher a son texte. */
export async function setMemoryEntryStatus(
  project: { id: string; repositoryPath: string },
  memoryId: string,
  status: ProjectMemoryStatus,
): Promise<MemoryWriteResult> {
  await connection();
  return setProjectMemoryStatus(getDatabaseClient(), {
    memoryId,
    status,
    sanitize: memorySanitizer(project.repositoryPath),
  });
}

/** Supprime une entree. Aucun effet Git, aucun appel IA. */
export async function deleteMemoryEntry(memoryId: string): Promise<boolean> {
  await connection();
  return deleteProjectMemory(getDatabaseClient(), memoryId);
}
