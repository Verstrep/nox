/**
 * Acces aux donnees de la memoire projet.
 *
 * ## Trois garanties portees par ce module
 *
 * 1. **Un numero n'est jamais reattribue.** `Project.nextMemorySequence` est
 *    incremente de facon atomique dans la transaction de creation. Un
 *    `count() + 1` redonnerait `MEM-004` a une nouvelle entree des qu'une autre
 *    disparaitrait — et deux manifests Architecte designeraient alors deux
 *    decisions differentes sous le meme code.
 * 2. **Le budget est verifie dans la transaction.** Pas avant, pas apres : deux
 *    activations simultanees qui tiendraient chacune separement mais pas
 *    ensemble doivent en voir une refusee.
 * 3. **Aucune troncature silencieuse.** Une operation qui ferait depasser le
 *    budget est refusee. `ACTIVE` veut dire « envoye », sans exception, sans
 *    classement et sans selection.
 *
 * ## Pourquoi la sanitation est injectee
 *
 * Le budget se mesure sur le texte **reellement envoye**, donc apres sanitation.
 * Or le nettoyeur depend du chemin du repository et de l'environnement du
 * serveur, deux choses que `packages/database` n'a aucune raison de connaitre.
 * Il est donc passe en parametre, comme `taskRevision` l'est au constructeur de
 * contexte.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il n'appelle aucun fournisseur, n'ecrit aucun fichier, ne lance aucun
 * processus et ne touche jamais a Git. Une memoire est une ligne SQLite, et
 * rien d'autre.
 */

import {
  PROJECT_MEMORY_LIMITS,
  PROJECT_MEMORY_STATUS,
  formatProjectMemoryCode,
  isProjectMemoryCategory,
  isProjectMemoryStatus,
  projectMemoryChars,
  type ProjectMemoryEntry,
  type ProjectMemoryProposal,
  type ProjectMemoryStatus,
  type ProjectMemoryValues,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Levee lorsqu'une ligne stockee ne correspond plus au contrat metier. */
export class InvalidProjectMemoryRecordError extends Error {
  constructor(id: string, field: string, value: string) {
    super(`Memoire ${id} : ${field} "${value}" inconnu.`);
    this.name = "InvalidProjectMemoryRecordError";
  }
}

type MemoryRow = {
  id: string;
  projectId: string;
  sequence: number;
  category: string;
  title: string;
  content: string;
  rationale: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

function toEntry(row: MemoryRow): ProjectMemoryEntry {
  if (!isProjectMemoryCategory(row.category)) {
    throw new InvalidProjectMemoryRecordError(row.id, "categorie", row.category);
  }
  if (!isProjectMemoryStatus(row.status)) {
    throw new InvalidProjectMemoryRecordError(row.id, "statut", row.status);
  }
  if (!Number.isInteger(row.sequence) || row.sequence < 1) {
    throw new InvalidProjectMemoryRecordError(row.id, "numero", String(row.sequence));
  }

  return {
    id: row.id,
    projectId: row.projectId,
    sequence: row.sequence,
    code: formatProjectMemoryCode(row.sequence),
    category: row.category,
    title: row.title,
    content: row.content,
    rationale: row.rationale,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Surface minimale utilisee a l'interieur d'une transaction.
 *
 * Le client transactionnel de Prisma n'est pas un `DatabaseClient` complet : il
 * ne porte ni `$connect`, ni `$transaction`. Ce type dit exactement ce dont le
 * calcul du budget a besoin, et rien de plus.
 */
type MemoryQueryClient = Pick<DatabaseClient, "projectMemoryEntry">;

/**
 * Nettoyeur applique avant toute mesure de budget.
 *
 * Injecte plutot qu'importe : le budget porte sur ce qui quitte la machine, et
 * seul l'appelant sait comment ce texte sera nettoye.
 */
export type MemorySanitizer = (value: string) => string;

/** Taille sanitisee d'une entree, telle que le budget la compte. */
export function sanitizedMemoryChars(
  values: { title: string; content: string; rationale: string | null },
  sanitize: MemorySanitizer,
): number {
  return projectMemoryChars({
    title: sanitize(values.title),
    content: sanitize(values.content),
    rationale: values.rationale === null ? null : sanitize(values.rationale),
  });
}

/** Etat du budget d'un projet, tel que la page Memory l'affiche. */
export type ProjectMemoryStats = {
  active: number;
  archived: number;
  total: number;
  /** Caracteres sanitises des entrees actives. */
  activeChars: number;
  /** Borne dure, en caracteres. */
  activeCharsLimit: number;
  /** Borne dure du nombre d'entrees, actives et archivees confondues. */
  entriesLimit: number;
};

/** Compte les entrees et mesure le budget reellement consomme. */
export async function projectMemoryStats(
  db: DatabaseClient,
  projectId: string,
  sanitize: MemorySanitizer,
): Promise<ProjectMemoryStats> {
  const rows = await db.projectMemoryEntry.findMany({
    where: { projectId },
    orderBy: { sequence: "asc" },
  });

  let active = 0;
  let archived = 0;
  let activeChars = 0;

  for (const row of rows) {
    if (row.status === PROJECT_MEMORY_STATUS.ACTIVE) {
      active += 1;
      activeChars += sanitizedMemoryChars(row, sanitize);
    } else {
      archived += 1;
    }
  }

  return {
    active,
    archived,
    total: rows.length,
    activeChars,
    activeCharsLimit: PROJECT_MEMORY_LIMITS.activeChars,
    entriesLimit: PROJECT_MEMORY_LIMITS.entries,
  };
}

/**
 * Entrees d'un projet, dans l'ordre des codes.
 *
 * `sequence ASC`, jamais `updatedAt DESC` : un ordre qui suivrait les
 * modifications deplacerait les decisions dans le prompt a chaque correction de
 * frappe, et le contexte changerait sans que rien n'ait change.
 */
export async function listProjectMemories(
  db: DatabaseClient,
  projectId: string,
  status?: ProjectMemoryStatus,
): Promise<ProjectMemoryEntry[]> {
  const rows = await db.projectMemoryEntry.findMany({
    where: status === undefined ? { projectId } : { projectId, status },
    orderBy: { sequence: "asc" },
  });
  return rows.map(toEntry);
}

/** Entrees actives d'un projet, dans l'ordre des codes. */
export function listActiveProjectMemories(
  db: DatabaseClient,
  projectId: string,
): Promise<ProjectMemoryEntry[]> {
  return listProjectMemories(db, projectId, PROJECT_MEMORY_STATUS.ACTIVE);
}

/** Retourne une entree, ou `null` si elle n'existe pas. */
export async function getProjectMemory(
  db: DatabaseClient,
  memoryId: string,
): Promise<ProjectMemoryEntry | null> {
  const row = await db.projectMemoryEntry.findUnique({ where: { id: memoryId } });
  return row === null ? null : toEntry(row);
}

/**
 * Raisons pour lesquelles une ecriture est refusee.
 *
 * `budget` et `entries` sont distinctes : la premiere se leve en raccourcissant
 * ou en archivant, la seconde en supprimant. Les confondre produirait un message
 * qui ne dit pas quoi faire.
 */
export type MemoryWriteRefusal = "not_found" | "budget" | "entries";

export type MemoryWriteResult =
  | { ok: true; entry: ProjectMemoryEntry }
  | { ok: false; reason: MemoryWriteRefusal; activeChars?: number; requiredChars?: number };

/**
 * Somme des caracteres actifs d'un projet, en excluant une entree.
 *
 * L'exclusion sert a la modification : l'ancienne version de l'entree ne doit
 * pas etre comptee en plus de la nouvelle, sans quoi toute edition d'une grosse
 * entree paraitrait doubler sa taille.
 */
async function activeCharsExcept(
  tx: MemoryQueryClient,
  projectId: string,
  excludeId: string | null,
  sanitize: MemorySanitizer,
): Promise<number> {
  const rows = await tx.projectMemoryEntry.findMany({
    where: { projectId, status: PROJECT_MEMORY_STATUS.ACTIVE },
    select: { id: true, title: true, content: true, rationale: true },
  });

  let total = 0;
  for (const row of rows) {
    if (row.id === excludeId) {
      continue;
    }
    total += sanitizedMemoryChars(row, sanitize);
  }
  return total;
}

export type CreateProjectMemoryInput = {
  projectId: string;
  values: ProjectMemoryValues;
  sanitize: MemorySanitizer;
};

/**
 * Cree une entree, ou refuse.
 *
 * Le numero est reserve par un increment atomique du compteur du projet, dans la
 * meme transaction que la creation : deux creations simultanees obtiennent deux
 * codes differents, jamais le meme.
 *
 * Le budget n'est verifie que pour une entree `ACTIVE`. Enregistrer directement
 * en `ARCHIVED` reste possible quand le budget est plein — c'est meme la sortie
 * que l'interface propose.
 */
export async function createProjectMemory(
  db: DatabaseClient,
  input: CreateProjectMemoryInput,
): Promise<MemoryWriteResult> {
  return db.$transaction(async (tx): Promise<MemoryWriteResult> => {
    const project = await tx.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, nextMemorySequence: true },
    });
    if (project === null) {
      return { ok: false, reason: "not_found" };
    }

    const count = await tx.projectMemoryEntry.count({ where: { projectId: input.projectId } });
    if (count >= PROJECT_MEMORY_LIMITS.entries) {
      return { ok: false, reason: "entries" };
    }

    if (input.values.status === PROJECT_MEMORY_STATUS.ACTIVE) {
      const used = await activeCharsExcept(tx, input.projectId, null, input.sanitize);
      const required = sanitizedMemoryChars(input.values, input.sanitize);
      if (used + required > PROJECT_MEMORY_LIMITS.activeChars) {
        return { ok: false, reason: "budget", activeChars: used, requiredChars: required };
      }
    }

    // Echange conditionnel sur le compteur : deux creations concurrentes ne
    // peuvent pas reussir toutes deux avec le meme numero.
    const claimed = await tx.project.updateMany({
      where: { id: input.projectId, nextMemorySequence: project.nextMemorySequence },
      data: { nextMemorySequence: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      return { ok: false, reason: "not_found" };
    }

    const row = await tx.projectMemoryEntry.create({
      data: {
        projectId: input.projectId,
        sequence: project.nextMemorySequence,
        category: input.values.category,
        title: input.values.title,
        content: input.values.content,
        rationale: input.values.rationale,
        status: input.values.status,
      },
    });

    return { ok: true, entry: toEntry(row) };
  });
}

export type UpdateProjectMemoryInput = {
  memoryId: string;
  values: ProjectMemoryValues;
  sanitize: MemorySanitizer;
};

/**
 * Modifie une entree, ou refuse.
 *
 * Le code ne change jamais : `sequence` n'est pas touche, et modifier `MEM-003`
 * ne produit donc pas `MEM-004`.
 *
 * Le budget est reverifie des que le resultat est `ACTIVE` — y compris lors
 * d'une restauration. Une entree qui reste `ARCHIVED` peut au contraire depasser
 * le budget sans consequence : elle ne quitte pas la machine.
 */
export async function updateProjectMemory(
  db: DatabaseClient,
  input: UpdateProjectMemoryInput,
): Promise<MemoryWriteResult> {
  return db.$transaction(async (tx): Promise<MemoryWriteResult> => {
    const existing = await tx.projectMemoryEntry.findUnique({
      where: { id: input.memoryId },
      select: { id: true, projectId: true },
    });
    if (existing === null) {
      return { ok: false, reason: "not_found" };
    }

    if (input.values.status === PROJECT_MEMORY_STATUS.ACTIVE) {
      const used = await activeCharsExcept(tx, existing.projectId, existing.id, input.sanitize);
      const required = sanitizedMemoryChars(input.values, input.sanitize);
      if (used + required > PROJECT_MEMORY_LIMITS.activeChars) {
        return { ok: false, reason: "budget", activeChars: used, requiredChars: required };
      }
    }

    const row = await tx.projectMemoryEntry.update({
      where: { id: input.memoryId },
      data: {
        category: input.values.category,
        title: input.values.title,
        content: input.values.content,
        rationale: input.values.rationale,
        status: input.values.status,
      },
    });

    return { ok: true, entry: toEntry(row) };
  });
}

/**
 * Archive ou restaure une entree, sans toucher a son texte.
 *
 * Une restauration repasse par le budget : la place qu'occupait cette entree a
 * pu etre prise entre-temps.
 */
export async function setProjectMemoryStatus(
  db: DatabaseClient,
  input: { memoryId: string; status: ProjectMemoryStatus; sanitize: MemorySanitizer },
): Promise<MemoryWriteResult> {
  return db.$transaction(async (tx): Promise<MemoryWriteResult> => {
    const existing = await tx.projectMemoryEntry.findUnique({ where: { id: input.memoryId } });
    if (existing === null) {
      return { ok: false, reason: "not_found" };
    }

    if (input.status === PROJECT_MEMORY_STATUS.ACTIVE) {
      const used = await activeCharsExcept(tx, existing.projectId, existing.id, input.sanitize);
      const required = sanitizedMemoryChars(existing, input.sanitize);
      if (used + required > PROJECT_MEMORY_LIMITS.activeChars) {
        return { ok: false, reason: "budget", activeChars: used, requiredChars: required };
      }
    }

    const row = await tx.projectMemoryEntry.update({
      where: { id: input.memoryId },
      data: { status: input.status },
    });

    return { ok: true, entry: toEntry(row) };
  });
}

/**
 * Supprime une entree.
 *
 * Rien ne s'y oppose, pas meme un ancien manifest Architecte qui la
 * referencerait : ces manifests sont historiques, ils decrivent un envoi passe,
 * et NOX n'a jamais conserve leur contenu. Refuser une suppression pour
 * proteger une trace serait empecher l'utilisateur d'effacer une information
 * privee saisie par erreur.
 *
 * Le numero n'est pas rendu : `nextMemorySequence` ne recule jamais.
 */
export async function deleteProjectMemory(
  db: DatabaseClient,
  memoryId: string,
): Promise<boolean> {
  const deleted = await db.projectMemoryEntry.deleteMany({ where: { id: memoryId } });
  return deleted.count === 1;
}

// --- Ecriture d'une regle durable appliquee ---------------------------------

/** Surface minimale pour ecrire une entree dans une transaction en cours. */
export type MemoryWriteClient = Pick<DatabaseClient, "project" | "projectMemoryEntry">;

/**
 * Ce qu'une ecriture proposee rend a l'appelant.
 *
 * L'echec porte directement le refus a remonter : l'application d'une mise a
 * jour de projet doit pouvoir l'abandonner sans traduire un vocabulaire dans un
 * autre, et sans inventer une raison qui n'existe pas.
 */
export type ProposedMemoryWrite =
  | { ok: true; entry: ProjectMemoryEntry }
  | {
      ok: false;
      failure: { ok: false; reason: "invalid"; field: string };
    };

/**
 * Ecrit une regle durable **dans la transaction de son appelant**.
 *
 * ## Pourquoi cette fonction existe a cote de `createProjectMemory`
 *
 * Parce que celle-ci ouvre sa propre transaction. Une entree posee par
 * l'application d'une mise a jour du projet doit vivre dans **la meme** que le
 * brief et le plan : un plan qui annonce un import controle et une memoire qui
 * ne dit pas ce que « controle » veut dire serait exactement le trou que
 * HOTFIX-005 comble.
 *
 * Les regles, elles, sont identiques : meme compteur atomique, meme plafond
 * d'entrees, meme budget mesure sur le texte sanitise. Une seconde politique
 * « pour les entrees proposees » finirait par accepter ce que l'autre refuse.
 *
 * ## Une entree proposee nait toujours `ACTIVE`
 *
 * Sinon elle serait capturee et inutile : seules les entrees actives atteignent
 * l'Architecte et la planification, et c'est precisement pour y arriver qu'elle
 * a ete posee.
 */
export async function writeProposedMemory(
  tx: MemoryWriteClient,
  input: {
    projectId: string;
    proposal: ProjectMemoryProposal;
    /** Entree visee par un `UPDATE`, deja relue par l'appelant. `null` pour un `CREATE`. */
    targetId: string | null;
    sanitize: MemorySanitizer;
  },
): Promise<ProposedMemoryWrite> {
  const values: ProjectMemoryValues = {
    category: input.proposal.category,
    title: input.proposal.title,
    content: input.proposal.content,
    rationale: input.proposal.rationale,
    status: PROJECT_MEMORY_STATUS.ACTIVE,
  };

  // Le budget se mesure sur l'etat **resultant** : l'ancienne version d'une
  // entree modifiee ne compte pas en plus de la nouvelle.
  const used = await activeCharsExcept(tx, input.projectId, input.targetId, input.sanitize);
  const required = sanitizedMemoryChars(values, input.sanitize);
  if (used + required > PROJECT_MEMORY_LIMITS.activeChars) {
    // Aucune troncature, aucune entree ecartee : l'application entiere est
    // abandonnee, et c'est l'utilisateur qui decide quoi archiver.
    return { ok: false, failure: { ok: false, reason: "invalid", field: "memories.budget" } };
  }

  if (input.targetId !== null) {
    const row = await tx.projectMemoryEntry.update({
      where: { id: input.targetId },
      data: {
        category: values.category,
        title: values.title,
        content: values.content,
        rationale: values.rationale,
        // Le statut n'est pas touche : une entree archivee que l'utilisateur
        // reecrit reste archivee, et la reactiver serait une decision qu'il n'a
        // pas prise.
      },
    });
    return { ok: true, entry: toEntry(row) };
  }

  const project = await tx.project.findUnique({
    where: { id: input.projectId },
    select: { nextMemorySequence: true },
  });
  if (project === null) {
    return { ok: false, failure: { ok: false, reason: "invalid", field: "memories.project" } };
  }

  const count = await tx.projectMemoryEntry.count({ where: { projectId: input.projectId } });
  if (count >= PROJECT_MEMORY_LIMITS.entries) {
    return { ok: false, failure: { ok: false, reason: "invalid", field: "memories.entries" } };
  }

  const claimed = await tx.project.updateMany({
    where: { id: input.projectId, nextMemorySequence: project.nextMemorySequence },
    data: { nextMemorySequence: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    return { ok: false, failure: { ok: false, reason: "invalid", field: "memories.sequence" } };
  }

  const row = await tx.projectMemoryEntry.create({
    data: {
      projectId: input.projectId,
      sequence: project.nextMemorySequence,
      category: values.category,
      title: values.title,
      content: values.content,
      rationale: values.rationale,
      status: values.status,
    },
  });

  return { ok: true, entry: toEntry(row) };
}
