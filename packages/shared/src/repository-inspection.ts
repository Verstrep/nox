/**
 * Inspection grossiere d'un repository, en lecture seule.
 *
 * ## A quoi elle sert
 *
 * A repondre a une seule question, avant d'amorcer un projet : **y a-t-il deja
 * une application ici ?** Un repository quasiment vide et un repository qui
 * porte deja du code ne demandent pas le meme travail d'amorcage, et se
 * tromper de reponse est la facon la plus rapide d'ecraser le travail de
 * quelqu'un.
 *
 * ## Ce qu'elle n'est pas
 *
 * Ce n'est pas une detection de pile technique. NOX ne cherche pas a savoir
 * s'il a affaire a Next.js ou a Django : il constate la presence de marqueurs
 * connus, et laisse Claude Code lire le detail au moment ou il travaille
 * reellement dans le repository. Classer cinquante piles serait un catalogue a
 * maintenir, faux le jour ou il compte.
 *
 * ## Le runner constate, il ne conclut pas
 *
 * Cette structure ne porte que des **faits** : des chemins relatifs presents,
 * un nombre d'entrees, un booleen Git. La classification — vide, minimal,
 * application existante — est calculee cote web, ou elle est pure et testable.
 * Le runner execute ; il ne decide pas.
 *
 * ## Aucun contenu
 *
 * Rien n'est lu. Aucun octet de fichier ne quitte la machine par cette route :
 * seuls des noms d'entrees reconnues et des compteurs. Un `.env` present est
 * donc invisible ici — il ne fait partie d'aucune liste reconnue, et son
 * contenu n'est de toute facon jamais ouvert.
 */

import { createStatusGuard } from "./statuses.js";

/**
 * Manifestes de projet reconnus, a la racine.
 *
 * Liste fermee et volontairement courte : elle sert a repondre « il y a deja
 * quelque chose ici », pas a nommer la technologie. Un manifeste inconnu laisse
 * simplement les autres signaux — dossiers sources, nombre d'entrees — faire
 * leur travail.
 */
export const REPOSITORY_MANIFEST_FILES: readonly string[] = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Gemfile",
  "pubspec.yaml",
  "Package.swift",
];

/** Dossiers de code reconnus, a la racine. */
export const REPOSITORY_SOURCE_DIRECTORIES: readonly string[] = [
  "src",
  "app",
  "apps",
  "lib",
  "packages",
  "cmd",
  "internal",
  "server",
  "client",
];

/**
 * Documents fondamentaux d'un projet, et leur proprietaire.
 *
 * Cette liste est **la** reference de NOX sur la question. L'amorcage la
 * materialise, l'inspection en constate la presence, et l'Architecte lit les
 * memes chemins : trois usages, une seule liste.
 */
export const FOUNDATIONAL_DOCUMENTS: readonly string[] = [
  "README.md",
  "CLAUDE.md",
  "docs/PROJECT_BRIEF.md",
  "docs/V1_SCOPE.md",
  "docs/ARCHITECTURE.md",
  "docs/ROADMAP.md",
  "docs/DECISIONS.md",
  "docs/PROJECT_STATE.md",
];

/**
 * Nombre maximal d'entrees remontees a la racine.
 *
 * Une borne, pas un reglage : ce qui compte est de distinguer « presque vide »
 * de « bien rempli », et la centieme entree ne change plus la reponse.
 */
export const REPOSITORY_INSPECTION_MAX_ENTRIES = 200;

/** Ce que le runner constate, sans rien interpreter. */
export type RepositoryInspection = {
  /** Manifestes reconnus presents a la racine, dans l'ordre de la liste. */
  manifests: string[];
  /** Dossiers de code reconnus presents a la racine, dans l'ordre de la liste. */
  sourceDirectories: string[];
  /** Documents fondamentaux presents, dans l'ordre de la liste. */
  foundationalDocuments: string[];
  /** Le repository porte-t-il au moins un commit ? */
  hasCommits: boolean;
  /**
   * Nombre d'entrees a la racine, hors `.git`, borne.
   *
   * Le point d'interet est le bas de l'echelle : zero, deux ou trois entrees
   * decrivent un repository qui attend son amorcage.
   */
  rootEntryCount: number;
  /** La borne a-t-elle ete atteinte pendant le comptage ? */
  rootEntryCountTruncated: boolean;
};

/**
 * Ce que NOX conclut de ces faits.
 *
 * Trois etats, et la frontiere qui compte est entre les deux derniers : un
 * repository `APPLICATION` ne se reamorce pas, il s'adapte.
 */
export const REPOSITORY_SHAPE = {
  /** Rien, ou presque : ni manifeste, ni dossier de code. */
  EMPTY: "EMPTY",
  /** Quelques fichiers — souvent une documentation seule — mais aucun code. */
  MINIMAL: "MINIMAL",
  /** Une application existe deja : manifeste ou dossier de code present. */
  APPLICATION: "APPLICATION",
} as const;

export type RepositoryShape = (typeof REPOSITORY_SHAPE)[keyof typeof REPOSITORY_SHAPE];

export const REPOSITORY_SHAPES: readonly RepositoryShape[] = Object.values(REPOSITORY_SHAPE);

export const isRepositoryShape = createStatusGuard(REPOSITORY_SHAPES);

/**
 * Classe un repository a partir des faits constates.
 *
 * Pure et deterministe : ni disque, ni reseau, ni horloge. La regle tient en
 * une phrase — un manifeste **ou** un dossier de code signifie qu'une
 * application existe deja — et le doute penche du cote de la prudence : mieux
 * vaut preserver un repository qu'on croyait vide que reamorcer un repository
 * qui ne l'etait pas.
 */
export function classifyRepository(inspection: RepositoryInspection): RepositoryShape {
  if (inspection.manifests.length > 0 || inspection.sourceDirectories.length > 0) {
    return REPOSITORY_SHAPE.APPLICATION;
  }
  if (inspection.foundationalDocuments.length > 0 || inspection.rootEntryCount > 1) {
    return REPOSITORY_SHAPE.MINIMAL;
  }
  return REPOSITORY_SHAPE.EMPTY;
}

/** Corps attendu par `POST /repositories/inspect`. */
export type InspectRepositoryRequest = {
  repositoryPath: string;
};

/** Reponse de `POST /repositories/inspect` en cas de succes. */
export type InspectRepositorySuccess = {
  ok: true;
  inspection: RepositoryInspection;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** Valide le corps recu par `POST /repositories/inspect`. */
export function parseInspectRepositoryRequest(
  value: unknown,
): InspectRepositoryRequest | null {
  if (!isRecord(value) || typeof value["repositoryPath"] !== "string") {
    return null;
  }
  return { repositoryPath: value["repositoryPath"] };
}

/** Verifie la forme d'une inspection recue. */
export function isRepositoryInspection(value: unknown): value is RepositoryInspection {
  return (
    isRecord(value) &&
    isStringArray(value["manifests"]) &&
    isStringArray(value["sourceDirectories"]) &&
    isStringArray(value["foundationalDocuments"]) &&
    typeof value["hasCommits"] === "boolean" &&
    typeof value["rootEntryCount"] === "number" &&
    Number.isInteger(value["rootEntryCount"]) &&
    typeof value["rootEntryCountTruncated"] === "boolean"
  );
}

/** Verifie qu'une reponse JSON est une inspection reussie. */
export function isInspectRepositorySuccess(
  value: unknown,
): value is InspectRepositorySuccess {
  return isRecord(value) && value["ok"] === true && isRepositoryInspection(value["inspection"]);
}
