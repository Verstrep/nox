import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

/**
 * Next.js ne lit les fichiers `.env` que depuis le dossier de l'application.
 * NOX conserve un seul `.env` a la racine du monorepo, partage avec le runner et
 * avec Prisma : il est donc charge ici, avant le demarrage du serveur.
 *
 * `process.loadEnvFile` est fourni par Node — aucune dependance necessaire.
 * Les variables deja definies dans le shell restent prioritaires.
 */
function loadRepositoryEnvFile(): void {
  const appDir = path.dirname(fileURLToPath(import.meta.url));
  try {
    process.loadEnvFile(path.resolve(appDir, "..", "..", ".env"));
  } catch {
    // Aucun `.env` a la racine : les variables du shell font foi.
  }
}

loadRepositoryEnvFile();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * `@nox/database` embarque le client Prisma genere et le binding natif de
   * `better-sqlite3`. Ces modules doivent etre charges par Node a l'execution,
   * pas inclus dans le bundle serveur : un binaire `.node` n'est pas bundlable.
   */
  serverExternalPackages: ["@nox/database", "@prisma/client", "better-sqlite3"],
};

export default nextConfig;
