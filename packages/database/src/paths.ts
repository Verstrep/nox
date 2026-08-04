/**
 * Resolution du chemin de la base SQLite locale.
 *
 * Contrainte : les commandes Prisma et l'application Next.js ne partagent pas le
 * meme repertoire courant. Faire dependre le chemin de `process.cwd()` mene donc
 * a des bases differentes selon la commande lancee.
 *
 * La strategie retenue est explicite : remonter l'arborescence depuis un
 * repertoire de depart jusqu'a trouver le `package.json` racine du monorepo
 * (celui dont le champ `name` vaut `nox`), puis ancrer le fichier de base sur
 * cette racine. Le resultat est identique quel que soit le repertoire courant.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Nom du package racine du monorepo, utilise comme marqueur de racine. */
const ROOT_PACKAGE_NAME = "nox";

/** Emplacement du fichier SQLite de developpement, relatif a la racine. */
const DEFAULT_DATABASE_RELATIVE_PATH = "data/nox-dev.db";

/** Variable d'environnement permettant de forcer une autre base. */
export const DATABASE_URL_ENV_VAR = "NOX_DATABASE_URL";

function readPackageName(manifestPath: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("name" in parsed)) {
      return null;
    }
    const { name } = parsed as { name: unknown };
    return typeof name === "string" ? name : null;
  } catch {
    // Manifeste illisible ou invalide : ce n'est pas la racine cherchee.
    return null;
  }
}

/**
 * Remonte l'arborescence depuis `startDir` jusqu'a la racine du monorepo NOX.
 * Retourne `null` si aucune racine n'est trouvee.
 */
export function findRepositoryRoot(startDir: string): string | null {
  let current = path.resolve(startDir);

  for (;;) {
    if (readPackageName(path.join(current, "package.json")) === ROOT_PACKAGE_NAME) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Construit l'URL Prisma de la base locale.
 *
 * `NOX_DATABASE_URL` est prioritaire lorsqu'elle est definie. Sinon, la base est
 * ancree sur la racine du monorepo, trouvee a partir du premier repertoire de
 * `startDirs` qui permet de la localiser.
 */
export function resolveDatabaseUrl(
  environment: Record<string, string | undefined>,
  startDirs: readonly string[],
): string {
  const override = environment[DATABASE_URL_ENV_VAR]?.trim();
  if (override !== undefined && override !== "") {
    return override;
  }

  for (const startDir of startDirs) {
    const root = findRepositoryRoot(startDir);
    if (root !== null) {
      return toSqliteUrl(path.join(root, DEFAULT_DATABASE_RELATIVE_PATH));
    }
  }

  throw new Error(
    `Racine du monorepo NOX introuvable depuis ${startDirs.join(", ")}. ` +
      `Definir ${DATABASE_URL_ENV_VAR} pour indiquer explicitement la base a utiliser.`,
  );
}

/**
 * Convertit un chemin de fichier en URL SQLite comprise par Prisma.
 *
 * Les separateurs sont normalises en `/` : sur Windows, un antislash dans une
 * URL est ambigu, alors que `better-sqlite3` accepte les deux formes.
 */
export function toSqliteUrl(filePath: string): string {
  return `file:${path.resolve(filePath).replaceAll("\\", "/")}`;
}

/** Extrait le chemin de fichier d'une URL SQLite Prisma. */
export function toDatabaseFilePath(databaseUrl: string): string {
  return databaseUrl.replace(/^file:/, "");
}

/** Verifie qu'un fichier de base existe deja a l'emplacement resolu. */
export function databaseFileExists(databaseUrl: string): boolean {
  const filePath = toDatabaseFilePath(databaseUrl);
  return filePath !== ":memory:" && existsSync(filePath);
}
