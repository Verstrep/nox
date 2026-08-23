/**
 * Lecture des projets pour les Server Components.
 *
 * `connection()` marque le point ou le rendu cesse d'etre prerendu : sans lui,
 * Next.js executerait les requetes SQLite pendant le build, sur une base qui
 * n'existe pas forcement a ce moment-la. C'est la methode documentee pour les
 * drivers synchrones comme `better-sqlite3`.
 */

import {
  getDatabaseClient,
  getProjectById,
  listProjects,
  loadProjectDashboardFacts,
  type Project,
} from "@nox/database";
import { connection } from "next/server";

import { TASK_STATUSES, type TaskStatus } from "@nox/shared";

import {
  projectCard,
  sortProjectCards,
  type ProjectCard,
  type ProjectCardFacts,
} from "./project-dashboard.ts";

export async function loadProjects(): Promise<Project[]> {
  await connection();
  return listProjects(getDatabaseClient());
}

export async function loadProject(id: string): Promise<Project | null> {
  await connection();
  return getProjectById(getDatabaseClient(), id);
}

/**
 * Cartes du tableau de bord, deja ordonnees.
 *
 * Quatre requetes au total, quel que soit le nombre de projets : les faits sont
 * lus en lots puis regroupes. Aucun repository n'est ouvert, le runner n'est pas
 * interroge, et aucun appel au fournisseur n'a lieu — ouvrir la page d'accueil
 * ne coute que SQLite.
 */
export async function loadProjectCards(): Promise<ProjectCard[]> {
  await connection();
  const db = getDatabaseClient();
  const projects = await listProjects(db);
  const facts = await loadProjectDashboardFacts(
    db,
    projects.map((project) => project.id),
  );

  const cards: ProjectCard[] = [];
  for (const project of projects) {
    const entry = facts.get(project.id);
    // La couche de donnees garantit une entree par identifiant demande ; ce
    // repli existe pour que la page d'accueil ne depende pas de cette promesse.
    cards.push(projectCard(project, entry ?? emptyFacts()));
  }

  return sortProjectCards(cards);
}

function emptyFacts(): ProjectCardFacts {
  return {
    briefSummary: null,
    taskCounts: Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
      TaskStatus,
      number
    >,
    taskTotal: 0,
    bootstrapStatus: null,
    readyWaitingOnDependencies: 0,
    lastTaskActivityAt: null,
  };
}
