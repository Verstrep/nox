/**
 * Memoire projet : ce que NOX retient volontairement d'un projet.
 *
 * ## Le probleme que ce module resout
 *
 * L'Architecte reconstruit sa comprehension du projet a partir de documents
 * entiers et des dix dernieres taches. C'est precis, et c'est insuffisant. Une
 * decision comme « le runner ne contient jamais de logique produit » vit
 * quelque part dans un `DECISIONS.md` de trois mille lignes, ou dans une
 * conversation fermee il y a deux semaines. Elle depend alors de la capacite du
 * modele a la retrouver — c'est-a-dire de la chance.
 *
 * Une entree de memoire dit ce qui compte, et seulement ce qui compte.
 *
 * ## Conversation n'est pas memoire
 *
 * C'est l'invariant central de TASK-017. Une conversation peut contenir « on
 * pourrait peut-etre utiliser Redis ». Cela ne doit jamais devenir « Project
 * memory : use Redis ». Une hesitation n'est pas une decision, et un modele qui
 * transformerait l'une en l'autre fabriquerait un contexte que personne n'a
 * relu.
 *
 * Rien n'entre donc en memoire sans une action humaine explicite : ni une
 * proposition de l'architecte, ni une observation de review, ni un compte rendu
 * de Claude Code, ni une tache, ni un document.
 *
 * ## Deux etats, et pas de troisieme
 *
 * `ACTIVE` est envoye a l'architecte, `ARCHIVED` ne l'est pas. Il n'existe pas
 * d'etat intermediaire — « active mais pas retenue faute de place » — parce
 * qu'une interface qui annoncerait « 42 entrees actives » alors que douze
 * seulement partent ne dirait plus rien de ce que l'architecte connait.
 *
 * C'est aussi pourquoi le budget est verifie **a l'ecriture** : mieux vaut
 * refuser une activation que la laisser passer et la trahir silencieusement au
 * moment de l'envoi.
 */

import { createStatusGuard } from "./statuses.js";

/**
 * Nature d'une entree de memoire.
 *
 * Quatre categories, volontairement. `PREFERENCE`, `TODO`, `IDEA`, `BUG`,
 * `NOTE` ne sont pas absentes par oubli : une tache et un bug ont deja leurs
 * propres objets metier, et une memoire qui accueillerait des idees deviendrait
 * un bloc-notes — donc un texte que personne ne relit et que l'architecte
 * recevrait quand meme.
 */
export const PROJECT_MEMORY_CATEGORY = {
  /** Un choix volontaire, deja tranche. */
  DECISION: "DECISION",
  /** Une limite qu'une decision future doit respecter. */
  CONSTRAINT: "CONSTRAINT",
  /** Une regle de conception ou de developpement. */
  CONVENTION: "CONVENTION",
  /** Un fait durable utile a la comprehension du projet. */
  KNOWLEDGE: "KNOWLEDGE",
} as const;

export type ProjectMemoryCategory =
  (typeof PROJECT_MEMORY_CATEGORY)[keyof typeof PROJECT_MEMORY_CATEGORY];

export const PROJECT_MEMORY_CATEGORIES: readonly ProjectMemoryCategory[] =
  Object.values(PROJECT_MEMORY_CATEGORY);

export const isProjectMemoryCategory = createStatusGuard(PROJECT_MEMORY_CATEGORIES);

/**
 * Etat d'une entree.
 *
 * `ARCHIVED` plutot que `Delete` seul : une decision peut cesser de s'appliquer
 * tout en restant un fait important de l'histoire du projet. « Nous avions
 * choisi SQLite pour l'etat local » explique la forme actuelle du code, meme
 * quand ce n'est plus vrai.
 */
export const PROJECT_MEMORY_STATUS = {
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
} as const;

export type ProjectMemoryStatus =
  (typeof PROJECT_MEMORY_STATUS)[keyof typeof PROJECT_MEMORY_STATUS];

export const PROJECT_MEMORY_STATUSES: readonly ProjectMemoryStatus[] =
  Object.values(PROJECT_MEMORY_STATUS);

export const isProjectMemoryStatus = createStatusGuard(PROJECT_MEMORY_STATUSES);

/**
 * Bornes de la memoire.
 *
 * Des constantes, jamais des variables d'environnement : elles decident de ce
 * qui quitte la machine et de ce qui sera facture. Une limite reglable depuis un
 * `.env` n'en est plus une.
 *
 * `activeChars` vaut 48 Kio, soit un peu plus du tiers du budget total de
 * contexte de l'Architecte (128 Kio). C'est assez pour plusieurs dizaines de
 * decisions ecrites serre, et assez peu pour que les documents du projet gardent
 * la place qui leur revient.
 */
export const PROJECT_MEMORY_LIMITS = {
  /** Une ligne, lisible d'un coup d'oeil dans une liste. */
  title: 160,
  /** Le texte durable a retenir. */
  content: 4 * 1024,
  /** Pourquoi cette memoire existe. Facultatif. */
  rationale: 2 * 1024,
  /** Budget total des entrees actives, mesure apres sanitation. */
  activeChars: 48 * 1024,
  /** Nombre d'entrees par projet, actives et archivees confondues. */
  entries: 100,
} as const;

/** Prefixe du code affiche d'une entree de memoire. */
export const MEMORY_CODE_PREFIX = "MEM-";

/**
 * Derive le code affiche d'une entree a partir de son numero.
 *
 * Meme regle que les taches et les executions : le code n'est pas stocke, il se
 * recalcule a partir d'un `sequence` immuable. Modifier `MEM-003` ne produit
 * jamais `MEM-004`.
 */
export function formatProjectMemoryCode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Numero de memoire invalide : ${String(sequence)}`);
  }
  return `${MEMORY_CODE_PREFIX}${String(sequence).padStart(3, "0")}`;
}

/** Une entree de memoire, telle que l'interface la lit. */
export type ProjectMemoryEntry = {
  id: string;
  projectId: string;
  /** Numero attribue a la creation, unique dans le projet et jamais modifie. */
  sequence: number;
  /** Derive de `sequence`, jamais stocke : `MEM-001`. */
  code: string;
  category: ProjectMemoryCategory;
  title: string;
  content: string;
  rationale: string | null;
  status: ProjectMemoryStatus;
  /** Date ISO 8601. */
  createdAt: string;
  /** Date ISO 8601. */
  updatedAt: string;
};

/** Ce qu'un formulaire propose, avant toute validation. */
export type ProjectMemoryInput = {
  category: string;
  title: string;
  content: string;
  rationale: string;
  status: string;
};

/** Champ refuse, et pourquoi. La paire suffit a formuler un message precis. */
export type ProjectMemoryRefusal = {
  field: "category" | "title" | "content" | "rationale" | "status";
  reason: "required" | "too_long" | "unknown" | "multiline" | "control_character";
};

/**
 * Normalise un texte de memoire.
 *
 * Les fins de ligne sont ramenees a `\n` et les espaces de bord retires. Rien
 * d'autre : le texte que l'utilisateur relira dans six mois doit etre celui
 * qu'il a ecrit, et une revision reproductible exige une forme unique.
 */
export function normalizeProjectMemoryText(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

/**
 * Un titre tient sur une ligne.
 *
 * Ce n'est pas une coquetterie : le titre sert d'identite de l'entree dans une
 * liste, dans une preview et dans un prompt. Un titre multiligne y casserait la
 * lecture partout a la fois.
 */
function isSingleLine(value: string): boolean {
  return !value.includes("\n");
}

/**
 * Refuse les octets qui casseraient une ecriture ou un affichage.
 *
 * Tabulation, saut de ligne et retour chariot sont conserves : ils portent la
 * structure du texte. Les autres caracteres de controle ne portent rien.
 *
 * Le test passe par les points de code plutot que par une expression reguliere :
 * une classe de caracteres de controle litterale est illisible, et le lint la
 * refuse pour cette raison meme.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const printable = code >= 0x20 && code !== 0x7f;
    const structural = code === 0x09 || code === 0x0a || code === 0x0d;
    if (!printable && !structural) {
      return true;
    }
  }
  return false;
}

/**
 * Valeurs normalisees d'une entree, prêtes a etre ecrites.
 *
 * `rationale` vaut `null` lorsqu'il est vide : un champ facultatif absent et un
 * champ facultatif rempli de blancs sont la meme chose, et les distinguer en
 * base ferait deux revisions pour un seul contenu.
 */
export type ProjectMemoryValues = {
  category: ProjectMemoryCategory;
  title: string;
  content: string;
  rationale: string | null;
  status: ProjectMemoryStatus;
};

export type ProjectMemoryCheck =
  | { ok: true; values: ProjectMemoryValues }
  | { ok: false; refusal: ProjectMemoryRefusal };

/**
 * Valide et normalise une entree de memoire.
 *
 * Fonction pure, sans acces a la base : c'est la meme qui garde le formulaire et
 * la Server Action. Deux implementations divergeraient, et c'est l'interface qui
 * aurait raison a tort.
 *
 * Le **budget** n'est pas verifie ici : il depend des autres entrees du projet
 * et du texte sanitise, deux choses que cette fonction ne connait pas.
 */
export function checkProjectMemoryInput(input: ProjectMemoryInput): ProjectMemoryCheck {
  if (!isProjectMemoryCategory(input.category)) {
    return { ok: false, refusal: { field: "category", reason: "unknown" } };
  }
  if (!isProjectMemoryStatus(input.status)) {
    return { ok: false, refusal: { field: "status", reason: "unknown" } };
  }

  const title = normalizeProjectMemoryText(input.title);
  if (title === "") {
    return { ok: false, refusal: { field: "title", reason: "required" } };
  }
  if (!isSingleLine(title)) {
    return { ok: false, refusal: { field: "title", reason: "multiline" } };
  }
  if (title.length > PROJECT_MEMORY_LIMITS.title) {
    return { ok: false, refusal: { field: "title", reason: "too_long" } };
  }
  if (hasControlCharacter(title)) {
    return { ok: false, refusal: { field: "title", reason: "control_character" } };
  }

  const content = normalizeProjectMemoryText(input.content);
  if (content === "") {
    return { ok: false, refusal: { field: "content", reason: "required" } };
  }
  if (content.length > PROJECT_MEMORY_LIMITS.content) {
    return { ok: false, refusal: { field: "content", reason: "too_long" } };
  }
  if (hasControlCharacter(content)) {
    return { ok: false, refusal: { field: "content", reason: "control_character" } };
  }

  const rationale = normalizeProjectMemoryText(input.rationale);
  if (rationale.length > PROJECT_MEMORY_LIMITS.rationale) {
    return { ok: false, refusal: { field: "rationale", reason: "too_long" } };
  }
  if (hasControlCharacter(rationale)) {
    return { ok: false, refusal: { field: "rationale", reason: "control_character" } };
  }

  return {
    ok: true,
    values: {
      category: input.category,
      title,
      content,
      rationale: rationale === "" ? null : rationale,
      status: input.status,
    },
  };
}

/**
 * Une entree telle qu'elle part vers l'Architecte.
 *
 * Deja sanitisee et deja bornee par l'appelant. `revision` decrit **ce texte**,
 * pas la ligne en base : un contenu masque par la sanitation produit une autre
 * revision que le contenu brut, ce qui est exactement ce qu'on veut — la
 * revision doit decrire ce que le fournisseur a reellement recu.
 */
export type ArchitectPromptMemory = {
  code: string;
  category: ProjectMemoryCategory;
  revision: string;
  title: string;
  content: string;
  rationale: string | null;
};

/**
 * Taille comptee d'une entree dans le budget actif.
 *
 * Seul le texte est compte — titre, contenu, justification. Ni le code, ni la
 * categorie, ni les balises du prompt : ce sont des constantes de format, et les
 * inclure ferait dependre le budget de l'utilisateur d'un choix de mise en
 * page de NOX.
 */
export function projectMemoryChars(memory: {
  title: string;
  content: string;
  rationale: string | null;
}): number {
  return memory.title.length + memory.content.length + (memory.rationale?.length ?? 0);
}
