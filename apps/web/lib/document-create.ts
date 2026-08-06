/**
 * Destinations de creation et construction du chemin d'un nouveau document.
 *
 * Ce module ne touche ni au disque, ni au reseau, ni a React : il est
 * directement testable, et il est importe des deux cotes — le formulaire s'en
 * sert pour la previsualisation, la Server Action pour le chemin reel.
 *
 * Regle structurante : **le navigateur n'envoie jamais un chemin complet**. Il
 * envoie une destination — une valeur parmi cinq — et un nom relatif. Le serveur
 * recompose le chemin a partir de la destination qu'il a lui-meme validee. Un
 * prefixe falsifie dans le formulaire n'a donc aucun effet : il n'est pas lu.
 *
 * Le nom saisi n'est jamais transforme. Un nom sans `.md` est refuse avec un
 * message, pas complete en silence : l'utilisateur doit reconnaitre le fichier
 * qu'il vient de creer.
 */

import { PROJECT_DOCUMENT_CATEGORY, type ProjectDocumentCategory } from "@nox/shared";

export type DocumentDestination = {
  id: ProjectDocumentCategory;
  label: string;
  /** `root` : choix parmi des noms fixes. `directory` : saisie sous un prefixe. */
  kind: "root" | "directory";
  /** Dossier impose, pour les destinations `directory`. */
  directory: string | null;
  hint: string;
};

/**
 * Les cinq destinations proposees, alignees sur les categories de l'inventaire.
 *
 * Reutiliser les identifiants de categorie evite d'inventer un second
 * vocabulaire : ce que l'utilisateur choisit a la creation est exactement ce
 * qu'il retrouvera dans la liste.
 */
export const DOCUMENT_DESTINATIONS: readonly DocumentDestination[] = [
  {
    id: PROJECT_DOCUMENT_CATEGORY.CORE,
    label: "Document principal",
    kind: "root",
    directory: null,
    hint: "A la racine du repository. Seuls les fichiers reconnus par NOX sont proposes.",
  },
  {
    id: PROJECT_DOCUMENT_CATEGORY.DOCUMENTATION,
    label: "Documentation",
    kind: "directory",
    directory: "docs",
    hint: "Brief, perimetre, architecture, roadmap, etat du projet.",
  },
  {
    id: PROJECT_DOCUMENT_CATEGORY.DECISION,
    label: "Decision",
    kind: "directory",
    directory: "decisions",
    hint: "Une decision structurante et sa justification.",
  },
  {
    id: PROJECT_DOCUMENT_CATEGORY.PLAN,
    label: "Plan",
    kind: "directory",
    directory: "plans",
    hint: "Un plan de travail ou une note de cadrage.",
  },
  {
    id: PROJECT_DOCUMENT_CATEGORY.TASK,
    label: "Tache",
    kind: "directory",
    directory: "tasks",
    hint: "Une tache d'implementation redigee a la main.",
  },
];

/**
 * Documents racine que NOX sait reconnaitre.
 *
 * La liste est fermee : la racine d'un repository n'est pas un dossier de
 * documentation, et y laisser creer n'importe quel `.md` la transformerait en
 * fourre-tout.
 */
export const ROOT_DOCUMENT_CHOICES: readonly string[] = ["README.md", "CLAUDE.md", "AGENTS.md"];

export type DocumentPathResult =
  | { ok: true; path: string }
  | { ok: false; message: string };

/** Retrouve une destination a partir de la valeur soumise par le formulaire. */
export function findDestination(value: string): DocumentDestination | null {
  return DOCUMENT_DESTINATIONS.find((destination) => destination.id === value) ?? null;
}

const NAME_REQUIRED_MESSAGE = "Indiquez le nom du document.";
const EXTENSION_MESSAGE = "Le nom doit se terminer par « .md ».";
const ABSOLUTE_MESSAGE = "Indiquez un nom relatif, sans chemin de disque ni barre initiale.";
const TRAVERSAL_MESSAGE = "Le nom ne peut pas contenir « .. ».";

/** Detecte un schema d'URL — ce qui capte aussi `C:` sous Windows. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Construit le chemin d'un document racine, choisi dans une liste fermee. */
function buildRootPath(name: string): DocumentPathResult {
  const trimmed = name.trim();
  if (trimmed === "") {
    return { ok: false, message: "Choisissez le document a creer." };
  }

  if (!ROOT_DOCUMENT_CHOICES.includes(trimmed)) {
    return {
      ok: false,
      message: `A la racine, NOX ne cree que ${ROOT_DOCUMENT_CHOICES.join(", ")}.`,
    };
  }

  return { ok: true, path: trimmed };
}

/** Construit le chemin d'un document range sous un dossier impose. */
function buildDirectoryPath(directory: string, name: string): DocumentPathResult {
  const trimmed = name.trim();
  if (trimmed === "") {
    return { ok: false, message: NAME_REQUIRED_MESSAGE };
  }

  if (trimmed.includes("\0")) {
    return { ok: false, message: ABSOLUTE_MESSAGE };
  }

  if (URL_SCHEME.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    return { ok: false, message: ABSOLUTE_MESSAGE };
  }

  const relative = trimmed.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");

  if (relative.split("/").includes("..")) {
    return { ok: false, message: TRAVERSAL_MESSAGE };
  }

  if (relative.endsWith("/")) {
    return { ok: false, message: NAME_REQUIRED_MESSAGE };
  }

  // Repeter le prefixe est une erreur frequente. La signaler vaut mieux que de
  // le retirer en silence — ou que de creer `docs/docs/…`.
  if (relative.toLowerCase().startsWith(`${directory}/`)) {
    return {
      ok: false,
      message: `Inutile de repeter « ${directory}/ » : le prefixe est deja applique.`,
    };
  }

  if (!relative.toLowerCase().endsWith(".md")) {
    return { ok: false, message: EXTENSION_MESSAGE };
  }

  return { ok: true, path: `${directory}/${relative}` };
}

/**
 * Recompose le chemin relatif final d'un document a creer.
 *
 * Le prefixe vient de la destination validee, jamais du formulaire. Les
 * verifications faites ici servent a produire un message utile : le runner
 * revalide tout, et lui seul fait autorite.
 */
export function buildDocumentPath(destinationValue: string, name: string): DocumentPathResult {
  const destination = findDestination(destinationValue);
  if (destination === null) {
    return { ok: false, message: "Choisissez une destination valide." };
  }

  return destination.kind === "root"
    ? buildRootPath(name)
    : buildDirectoryPath(destination.directory ?? "", name);
}
