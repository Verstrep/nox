/**
 * Fabrique et cache du client Prisma.
 *
 * Prisma 7 exige un driver adapter : ici `@prisma/adapter-better-sqlite3`, qui
 * ouvre le fichier SQLite local via un binding natif.
 */

import process from "node:process";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "./generated/prisma/client.js";
import { resolveDatabaseUrl } from "./paths.js";

export type DatabaseClient = PrismaClient;

/**
 * Cree un client Prisma pointant vers la base indiquee.
 *
 * `databaseUrl` est explicite dans les tests, qui utilisent une base temporaire.
 * En son absence, l'URL est resolue depuis la racine du monorepo.
 */
export function createDatabaseClient(databaseUrl?: string): DatabaseClient {
  const url = databaseUrl ?? resolveDatabaseUrl(process.env, [process.cwd()]);
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

/**
 * Cle de cache sur `globalThis`.
 *
 * En developpement, Next.js recharge les modules serveur a chaque modification.
 * Sans ce cache, chaque rechargement ouvrirait une nouvelle connexion SQLite et
 * finirait par epuiser les descripteurs de fichiers.
 */
const CLIENT_CACHE_KEY = Symbol.for("nox.database.client");

type ClientCache = { [CLIENT_CACHE_KEY]?: DatabaseClient };

/** Retourne le client partage de l'application, en le creant au premier appel. */
export function getDatabaseClient(): DatabaseClient {
  const cache = globalThis as ClientCache;
  const existing = cache[CLIENT_CACHE_KEY];
  if (existing !== undefined) {
    return existing;
  }

  const client = createDatabaseClient();
  cache[CLIENT_CACHE_KEY] = client;
  return client;
}
