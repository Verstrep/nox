/**
 * Contrat metier des taches de developpement.
 *
 * Une tache NOX n'est pas un titre dans une liste : c'est une specification
 * suffisamment complete pour qu'un agent de developpement puisse travailler sans
 * recevoir toute la conversation du projet. Ce fichier decrit sa forme, ses
 * statuts et les transitions autorisees — rien de plus. Aucune dependance a
 * Prisma, a Node ou a React : les memes types servent a la base, au web et aux
 * tests.
 *
 * `TaskStatus` n'est pas redeclare ici : il vit dans `statuses.ts` depuis
 * TASK-001, et il n'existe qu'une seule liste de statuts dans tout NOX.
 */

import type { ProjectDocumentRevision } from "./documents.js";
import { TASK_STATUS, createStatusGuard, type TaskStatus } from "./statuses.js";

/**
 * Priorite d'une tache dans le backlog.
 *
 * Quatre niveaux : moins serait insuffisant pour distinguer « a faire bientot »
 * de « bloque le reste », plus produirait des arbitrages que personne ne saurait
 * trancher de facon reproductible.
 */
export const TASK_PRIORITY = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;

export type TaskPriority = (typeof TASK_PRIORITY)[keyof typeof TASK_PRIORITY];

export const TASK_PRIORITIES: readonly TaskPriority[] = Object.values(TASK_PRIORITY);

export const isTaskPriority = createStatusGuard(TASK_PRIORITIES);

/**
 * Poids de tri d'une priorite.
 *
 * L'ordre alphabetique des identifiants ne correspond pas a l'urgence
 * (`CRITICAL` < `LOW` < `MEDIUM`) : le backlog a donc besoin d'un rang explicite.
 */
const TASK_PRIORITY_RANK: Record<TaskPriority, number> = {
  [TASK_PRIORITY.CRITICAL]: 4,
  [TASK_PRIORITY.HIGH]: 3,
  [TASK_PRIORITY.MEDIUM]: 2,
  [TASK_PRIORITY.LOW]: 1,
};

/** Rang de tri, du plus urgent au moins urgent. */
export function taskPriorityRank(priority: TaskPriority): number {
  return TASK_PRIORITY_RANK[priority];
}

/**
 * Etat du document Markdown associe a une tache.
 *
 * La tache vit en base, son document vit dans Git : les deux peuvent diverger,
 * et NOX doit pouvoir le dire plutot que de le cacher.
 *
 * - `PENDING`  : la tache existe, son document n'a pas encore ete cree.
 * - `SYNCED`   : le document existe et correspond a la specification enregistree.
 * - `ERROR`    : la creation a echoue — runner arrete, droits, disque.
 * - `CONFLICT` : un document **different** occupe deja le chemin attendu.
 */
export const TASK_DOCUMENT_SYNC_STATUS = {
  PENDING: "PENDING",
  SYNCED: "SYNCED",
  ERROR: "ERROR",
  CONFLICT: "CONFLICT",
} as const;

export type TaskDocumentSyncStatus =
  (typeof TASK_DOCUMENT_SYNC_STATUS)[keyof typeof TASK_DOCUMENT_SYNC_STATUS];

export const TASK_DOCUMENT_SYNC_STATUSES: readonly TaskDocumentSyncStatus[] =
  Object.values(TASK_DOCUMENT_SYNC_STATUS);

export const isTaskDocumentSyncStatus = createStatusGuard(TASK_DOCUMENT_SYNC_STATUSES);

/**
 * Transitions manuelles autorisees, par statut de depart.
 *
 * `RUNNING`, `FAILED` et `REVIEW` restent sans **entree** manuelle : ils
 * decrivent le resultat d'une execution de Claude Code, et les rendre
 * selectionnables permettrait d'annoncer un etat que rien n'a produit. Depuis
 * TASK-008 ils ont en revanche une **sortie** manuelle : une execution peut les
 * poser, et c'est bien l'utilisateur qui decide ensuite d'accepter le travail
 * (`REVIEW → COMPLETED`) ou de le remettre en file (`FAILED → READY`).
 *
 * La table est declaree pour **tous** les statuts, sans valeur par defaut : un
 * statut ajoute plus tard ne peut pas passer inapercu, `Record` obligeant a le
 * traiter.
 */
const ALLOWED_TASK_STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  [TASK_STATUS.DRAFT]: [TASK_STATUS.READY, TASK_STATUS.BLOCKED],
  [TASK_STATUS.READY]: [TASK_STATUS.DRAFT, TASK_STATUS.BLOCKED, TASK_STATUS.COMPLETED],
  [TASK_STATUS.BLOCKED]: [TASK_STATUS.DRAFT, TASK_STATUS.READY],
  [TASK_STATUS.COMPLETED]: [TASK_STATUS.READY],
  [TASK_STATUS.REVIEW]: [TASK_STATUS.COMPLETED, TASK_STATUS.READY],
  [TASK_STATUS.FAILED]: [TASK_STATUS.READY, TASK_STATUS.BLOCKED],
  // Une tache en cours d'execution n'a aucune issue manuelle : c'est la fin du
  // processus qui la fait sortir de cet etat, jamais un clic.
  [TASK_STATUS.RUNNING]: [],
};

/**
 * Statuts que l'utilisateur ne peut jamais **choisir** comme cible.
 *
 * Ils sont poses par le cycle de vie d'une execution, et par lui seul.
 */
export const RESERVED_TASK_STATUSES: readonly TaskStatus[] = [
  TASK_STATUS.RUNNING,
  TASK_STATUS.FAILED,
  TASK_STATUS.REVIEW,
];

export function isReservedTaskStatus(status: TaskStatus): boolean {
  return RESERVED_TASK_STATUSES.includes(status);
}

/** Statuts atteignables manuellement depuis `from`, dans l'ordre d'affichage. */
export function allowedTaskStatusTransitions(from: TaskStatus): readonly TaskStatus[] {
  return ALLOWED_TASK_STATUS_TRANSITIONS[from];
}

/**
 * Seule autorite sur les changements de statut.
 *
 * Le formulaire s'en sert pour construire ses choix, la Server Action pour
 * verifier ce qu'elle recoit. Une requete falsifiee repasse donc exactement par
 * la meme fonction que l'affichage : il n'existe aucun chemin qui contourne
 * cette table.
 */
export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TASK_STATUS_TRANSITIONS[from].includes(to);
}

/** Prefixe du code affiche d'une tache. */
export const TASK_CODE_PREFIX = "TASK-";

/**
 * Forme stricte d'un code de tache : `TASK-` suivi d'au moins trois chiffres.
 *
 * Le minimum de trois chiffres n'est pas cosmetique : c'est lui qui permet au
 * runner de deduire un nom de fichier sans jamais accepter une chaine
 * arbitraire, et donc de fixer lui-meme le chemin `tasks/<code>.md`.
 */
const TASK_CODE_PATTERN = /^TASK-\d{3,}$/;

export function isTaskCode(value: unknown): value is string {
  return typeof value === "string" && TASK_CODE_PATTERN.test(value);
}

/**
 * Derive le code affiche d'une tache a partir de son numero.
 *
 * Le code n'est pas stocke : il se recalcule toujours a partir de `sequence`,
 * qui est immuable. Deux representations d'une meme verite finissent toujours
 * par diverger ; une seule ne le peut pas.
 */
export function formatTaskCode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Numero de tache invalide : ${String(sequence)}`);
  }
  return `${TASK_CODE_PREFIX}${String(sequence).padStart(3, "0")}`;
}

/** Chemin relatif, stable, du document d'une tache. */
export function taskDocumentPath(code: string): string {
  return `tasks/${code}.md`;
}

/** Fiche courte d'une tache, suffisante pour le backlog. */
export type DevelopmentTaskSummary = {
  id: string;
  /** Derive de `sequence`, jamais stocke : `TASK-001`. */
  code: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  documentSyncStatus: TaskDocumentSyncStatus;
  /** Date ISO 8601. */
  createdAt: string;
  /** Date ISO 8601. */
  updatedAt: string;
};

/**
 * Specification complete d'une tache.
 *
 * Les trois listes sont ordonnees : leur ordre est celui de la saisie, et c'est
 * lui qui sera lu par l'agent. Elles sont exposees comme de simples tableaux de
 * chaines — la position est portee par l'ordre du tableau, pas par un champ que
 * l'interface devrait retrier.
 */
export type DevelopmentTaskDetail = DevelopmentTaskSummary & {
  projectId: string;
  objective: string;
  context: string | null;
  outOfScope: string | null;
  acceptanceCriteria: readonly string[];
  documentReferences: readonly string[];
  validationCommands: readonly string[];
  /** Chemin relatif du Markdown associe : `tasks/TASK-001.md`. */
  documentPath: string;
  /** Revision du document, connue seulement lorsqu'il est synchronise. */
  documentRevision: ProjectDocumentRevision | null;
  /** Message sur du dernier echec de synchronisation, sans detail systeme. */
  documentSyncError: string | null;
};

/**
 * Donnees necessaires a la generation du Markdown d'une tache.
 *
 * Ni statut, ni priorite, ni date : ces valeurs changent sans que la
 * specification change, et les faire figurer dans le fichier obligerait a le
 * reecrire a chaque clic. Un `DevelopmentTaskDetail` satisfait ce type tel quel.
 */
export type TaskSpecification = {
  code: string;
  title: string;
  objective: string;
  context: string | null;
  outOfScope: string | null;
  documentReferences: readonly string[];
  acceptanceCriteria: readonly string[];
  validationCommands: readonly string[];
};
