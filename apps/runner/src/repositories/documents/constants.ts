/**
 * Perimetre et limites de l'inventaire des documents Markdown.
 *
 * NOX ne parcourt volontairement **pas** tout le repository : un projet reel
 * contient des milliers de fichiers Markdown sans interet (dependances,
 * changelogs de bibliotheques, gabarits). Seuls quelques emplacements connus
 * sont inspectes, ce qui rend l'inventaire rapide, previsible et sans surprise.
 */

/** Taille maximale d'un document lisible : 1 Mio. */
export const MAX_DOCUMENT_BYTES = 1024 * 1024;

/** Nombre maximal de documents inventories. */
export const MAX_DOCUMENTS = 500;

/** Profondeur maximale de parcours a l'interieur d'un dossier inspecte. */
export const MAX_SCAN_DEPTH = 6;

/** Extension acceptee, comparee sans distinction de casse. */
export const MARKDOWN_EXTENSION = ".md";

/**
 * Documents racine reconnus.
 *
 * Les autres fichiers `.md` de la racine sont ignores : ils sont trop souvent
 * du bruit (CHANGELOG, CONTRIBUTING, LICENSE...) pour meriter une place dans un
 * inventaire destine au pilotage du projet.
 */
export const ROOT_DOCUMENTS: readonly string[] = ["CLAUDE.md", "AGENTS.md", "README.md"];

/** Dossiers inspectes recursivement, dans l'ordre de parcours. */
export const SCANNED_DIRECTORIES: readonly string[] = ["docs", "decisions", "plans", "tasks"];

/**
 * Documents consideres comme principaux (categorie `CORE`).
 *
 * La liste decrit ce que NOX sait reconnaitre, pas ce qu'un projet doit
 * contenir : seuls les fichiers reellement presents sont affiches.
 */
export const CORE_DOCUMENTS: readonly string[] = [
  "CLAUDE.md",
  "AGENTS.md",
  "README.md",
  "docs/PROJECT_BRIEF.md",
  "docs/PRODUCT_VISION.md",
  "docs/V1_SCOPE.md",
  "docs/FUNCTIONAL_SPEC.md",
  "docs/TECHNICAL_ARCHITECTURE.md",
  "docs/ARCHITECTURE.md",
  "docs/DATA_MODEL.md",
  "docs/UI_UX.md",
  "docs/TESTING_STRATEGY.md",
  "docs/SECURITY.md",
  "docs/ROADMAP.md",
  "docs/DECISIONS.md",
  "docs/PROJECT_STATE.md",
  "docs/BACKLOG.md",
];

/**
 * Dossiers jamais parcourus, quel que soit leur niveau.
 *
 * Ils contiennent du code genere ou des dependances : leur Markdown n'appartient
 * pas au projet.
 */
export const EXCLUDED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  "out",
  "vendor",
]);
