import js from "@eslint/js";
import nextConfig from "eslint-config-next";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Configuration ESLint unique pour l'ensemble du monorepo.
 *
 * Un seul fichier plat couvre les workspaces :
 * - les regles TypeScript s'appliquent partout ;
 * - les regles Next.js / React / accessibilite sont limitees a `apps/web`.
 *
 * L'entree `next/typescript` de `eslint-config-next` est volontairement ecartee :
 * elle redeclare le plugin `@typescript-eslint`, deja fourni ici par
 * `typescript-eslint`, ce que la configuration plate d'ESLint refuse.
 */
const nextWebRules = nextConfig
  .filter((entry) => entry.name === "next")
  .map((entry) => ({ ...entry, files: ["apps/web/**/*.{js,jsx,mjs,ts,tsx}"] }));

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/next-env.d.ts",
      "**/*.tsbuildinfo",
      // Client Prisma genere : reecrit a chaque `db:generate`.
      "packages/database/src/generated/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Runner, packages et fichiers de configuration : contexte Node.js.
  {
    files: ["apps/runner/**/*.ts", "packages/**/*.ts", "**/*.mjs"],
    languageOptions: { globals: globals.node },
  },

  // Application web : regles Next.js, React et accessibilite.
  ...nextWebRules,
  {
    files: ["apps/web/**/*.{ts,tsx,mjs}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    settings: { next: { rootDir: "apps/web" } },
  },

  // Analyse typee : declaree en dernier pour que le parser TypeScript prime sur
  // celui fourni par `eslint-config-next`.
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      eqeqeq: ["error", "smart"],
    },
  },
);
