/**
 * Acces aux donnees du modele `Project`.
 *
 * Le client Prisma est passe en parametre plutot que lu depuis un singleton :
 * les tests peuvent ainsi viser une base temporaire sans toucher a la base de
 * developpement.
 */

import { PROJECT_STATUS, isProjectStatus, type ProjectStatus } from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Projet tel que manipule par l'application, avec un statut valide. */
export type Project = {
  id: string;
  name: string;
  description: string | null;
  repositoryPath: string;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
};

/** Donnees necessaires a la creation d'un projet. */
export type CreateProjectInput = {
  name: string;
  description: string | null;
  repositoryPath: string;
};

/** Enregistrement brut lu en base : `status` y est une simple chaine. */
type ProjectRow = Omit<Project, "status"> & { status: string };

/**
 * Levee lorsqu'une ligne stockee ne correspond plus au contrat metier.
 * Cela traduit une base modifiee hors de NOX, pas une erreur utilisateur.
 */
export class InvalidProjectRecordError extends Error {
  constructor(id: string, status: string) {
    super(`Projet ${id} : statut "${status}" inconnu.`);
    this.name = "InvalidProjectRecordError";
  }
}

function toProject(row: ProjectRow): Project {
  if (!isProjectStatus(row.status)) {
    throw new InvalidProjectRecordError(row.id, row.status);
  }
  return { ...row, status: row.status };
}

/** Retourne tous les projets, du plus recemment cree au plus ancien. */
export async function listProjects(db: DatabaseClient): Promise<Project[]> {
  const rows = await db.project.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(toProject);
}

/** Retourne un projet par son identifiant, ou `null` s'il n'existe pas. */
export async function getProjectById(db: DatabaseClient, id: string): Promise<Project | null> {
  const row = await db.project.findUnique({ where: { id } });
  return row === null ? null : toProject(row);
}

/** Retourne le projet deja associe a ce chemin canonique, s'il existe. */
export async function findProjectByRepositoryPath(
  db: DatabaseClient,
  repositoryPath: string,
): Promise<Project | null> {
  const row = await db.project.findUnique({ where: { repositoryPath } });
  return row === null ? null : toProject(row);
}

/** Cree un projet au statut initial `DRAFT`. */
export async function createProject(
  db: DatabaseClient,
  input: CreateProjectInput,
): Promise<Project> {
  const row = await db.project.create({
    data: { ...input, status: PROJECT_STATUS.DRAFT },
  });
  return toProject(row);
}

/**
 * Reconnait la violation de contrainte d'unicite de Prisma (`P2002`).
 *
 * Le controle est fait par forme plutot qu'en important les classes d'erreur de
 * Prisma : cela evite d'exposer les internes de l'ORM aux appelants.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}
