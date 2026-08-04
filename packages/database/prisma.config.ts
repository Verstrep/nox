import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { defineConfig } from "prisma/config";

import { resolveDatabaseUrl } from "./src/paths.ts";

/**
 * Configuration du CLI Prisma.
 *
 * L'URL de la base n'est volontairement pas ecrite dans `schema.prisma` : elle
 * est calculee ici a partir de la racine du monorepo, afin que `prisma migrate`,
 * `prisma studio` et l'application Next.js visent toujours le meme fichier,
 * quel que soit le repertoire courant.
 */
const packageDir = path.dirname(fileURLToPath(import.meta.url));

loadLocalEnvFile();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: resolveDatabaseUrl(process.env, [packageDir, process.cwd()]),
  },
});

/**
 * Charge le `.env` de la racine s'il existe, sans dependance externe :
 * `process.loadEnvFile` est fourni par Node depuis la 20.12.
 */
function loadLocalEnvFile(): void {
  const repositoryRoot = path.resolve(packageDir, "..", "..");
  try {
    process.loadEnvFile(path.join(repositoryRoot, ".env"));
  } catch {
    // Aucun `.env` local : les valeurs par defaut suffisent.
  }
}
