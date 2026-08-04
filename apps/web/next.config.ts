import type { NextConfig } from "next";

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
