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
  experimental: {
    /**
     * Les Server Actions de NOX transportent un document Markdown entier, et la
     * limite par defaut de Next.js est de 1 Mo — juste en dessous du 1 Mio
     * qu'accepte le runner. Un document de taille legitime echouait donc avec
     * une erreur 500 opaque, au lieu du message « taille maximale » prevu.
     *
     * La valeur retenue correspond a la limite de corps de la route d'ecriture
     * du runner : les deux bornes disent desormais la meme chose, et c'est le
     * runner — seul a voir les octets reels — qui tranche.
     */
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
