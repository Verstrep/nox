/**
 * Lecture des projets pour les Server Components.
 *
 * `connection()` marque le point ou le rendu cesse d'etre prerendu : sans lui,
 * Next.js executerait les requetes SQLite pendant le build, sur une base qui
 * n'existe pas forcement a ce moment-la. C'est la methode documentee pour les
 * drivers synchrones comme `better-sqlite3`.
 */

import { getDatabaseClient, getProjectById, listProjects, type Project } from "@nox/database";
import { connection } from "next/server";

export async function loadProjects(): Promise<Project[]> {
  await connection();
  return listProjects(getDatabaseClient());
}

export async function loadProject(id: string): Promise<Project | null> {
  await connection();
  return getProjectById(getDatabaseClient(), id);
}
