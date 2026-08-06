/**
 * Acces aux donnees des taches de developpement.
 *
 * Comme pour les projets, le client Prisma est passe en parametre : les tests
 * visent une base temporaire sans toucher a la base de developpement.
 *
 * Ce module retourne des types **metier** (`@nox/shared`), jamais des lignes
 * Prisma. Les chaines lues en base sont revalidees a chaque relecture : une base
 * modifiee a la main ne doit pas propager un statut inconnu jusqu'a
 * l'interface.
 */

import {
  TASK_DOCUMENT_SYNC_STATUS,
  TASK_STATUS,
  canTransitionTaskStatus,
  formatTaskCode,
  isTaskDocumentSyncStatus,
  isTaskPriority,
  isTaskStatus,
  taskDocumentPath,
  taskPriorityRank,
  type DevelopmentTaskDetail,
  type DevelopmentTaskSummary,
  type TaskDocumentSyncStatus,
  type TaskPriority,
  type TaskStatus,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Donnees necessaires a la creation d'une tache. */
export type CreateTaskInput = {
  projectId: string;
  title: string;
  objective: string;
  context: string | null;
  outOfScope: string | null;
  priority: TaskPriority;
  /** Ordre de saisie, conserve tel quel. */
  acceptanceCriteria: readonly string[];
  documentReferences: readonly string[];
  validationCommands: readonly string[];
};

/**
 * Levee lorsqu'une ligne stockee ne correspond plus au contrat metier.
 * Traduit une base modifiee hors de NOX, pas une erreur utilisateur.
 */
export class InvalidTaskRecordError extends Error {
  constructor(id: string, field: string, value: string) {
    super(`Tache ${id} : ${field} "${value}" inconnu.`);
    this.name = "InvalidTaskRecordError";
  }
}

type SummaryRow = {
  id: string;
  sequence: number;
  title: string;
  status: string;
  priority: string;
  documentSyncStatus: string;
  createdAt: Date;
  updatedAt: Date;
};

type DetailRow = SummaryRow & {
  projectId: string;
  objective: string;
  context: string | null;
  outOfScope: string | null;
  documentPath: string;
  documentRevision: string | null;
  documentSyncError: string | null;
  acceptanceCriteria: { text: string }[];
  documentReferences: { path: string }[];
  validationCommands: { command: string }[];
};

/** Colonnes suffisantes au backlog : ni objectif, ni contexte, ni listes. */
const SUMMARY_SELECT = {
  id: true,
  sequence: true,
  title: true,
  status: true,
  priority: true,
  documentSyncStatus: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Listes enfant toujours lues dans leur ordre de saisie.
 *
 * L'ordre fait partie de la specification : il sera lu par un agent, qui
 * traitera les criteres dans l'ordre ou ils apparaissent. Le laisser au hasard
 * de SQLite reviendrait a changer la tache d'une lecture a l'autre.
 */
const DETAIL_INCLUDE = {
  acceptanceCriteria: { orderBy: { position: "asc" }, select: { text: true } },
  documentReferences: { orderBy: { position: "asc" }, select: { path: true } },
  validationCommands: { orderBy: { position: "asc" }, select: { command: true } },
} as const;

function readStatus(row: { id: string; status: string }): TaskStatus {
  if (!isTaskStatus(row.status)) {
    throw new InvalidTaskRecordError(row.id, "statut", row.status);
  }
  return row.status;
}

function toSummary(row: SummaryRow): DevelopmentTaskSummary {
  if (!isTaskPriority(row.priority)) {
    throw new InvalidTaskRecordError(row.id, "priorite", row.priority);
  }
  if (!isTaskDocumentSyncStatus(row.documentSyncStatus)) {
    throw new InvalidTaskRecordError(row.id, "synchronisation", row.documentSyncStatus);
  }
  if (!Number.isInteger(row.sequence) || row.sequence < 1) {
    throw new InvalidTaskRecordError(row.id, "numero", String(row.sequence));
  }

  return {
    id: row.id,
    code: formatTaskCode(row.sequence),
    title: row.title,
    status: readStatus(row),
    priority: row.priority,
    documentSyncStatus: row.documentSyncStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: DetailRow): DevelopmentTaskDetail {
  return {
    ...toSummary(row),
    projectId: row.projectId,
    objective: row.objective,
    context: row.context,
    outOfScope: row.outOfScope,
    acceptanceCriteria: row.acceptanceCriteria.map((entry) => entry.text),
    documentReferences: row.documentReferences.map((entry) => entry.path),
    validationCommands: row.validationCommands.map((entry) => entry.command),
    documentPath: row.documentPath,
    documentRevision: row.documentRevision,
    documentSyncError: row.documentSyncError,
  };
}

/**
 * Ordre du backlog : d'abord ce qui reste a faire, puis l'urgence, puis
 * l'anciennete.
 *
 * Trier par priorite seule remonterait indefiniment les taches terminees
 * critiques en tete de liste, la ou elles n'apprennent plus rien.
 */
function compareBacklog(a: DevelopmentTaskSummary, b: DevelopmentTaskSummary): number {
  const done = Number(a.status === TASK_STATUS.COMPLETED) - Number(b.status === TASK_STATUS.COMPLETED);
  if (done !== 0) {
    return done;
  }

  const urgency = taskPriorityRank(b.priority) - taskPriorityRank(a.priority);
  if (urgency !== 0) {
    return urgency;
  }

  return a.code.localeCompare(b.code);
}

/** Retourne le backlog d'un projet, deja ordonne pour l'affichage. */
export async function listTasksByProject(
  db: DatabaseClient,
  projectId: string,
): Promise<DevelopmentTaskSummary[]> {
  const rows = await db.task.findMany({
    where: { projectId },
    select: SUMMARY_SELECT,
    orderBy: { sequence: "asc" },
  });

  return rows.map(toSummary).sort(compareBacklog);
}

/** Retourne une tache complete, ou `null` si elle n'existe pas. */
export async function getTaskById(
  db: DatabaseClient,
  taskId: string,
): Promise<DevelopmentTaskDetail | null> {
  const row = await db.task.findUnique({ where: { id: taskId }, include: DETAIL_INCLUDE });
  return row === null ? null : toDetail(row);
}

/**
 * Cree une tache, son numero et ses trois listes en une seule transaction.
 *
 * ## L'allocation du numero
 *
 * Le numero vient de `Project.nextTaskSequence`, incremente par l'ordre SQL
 * `increment` — une operation atomique, dont la valeur retournee est celle
 * d'apres. Le numero reserve est donc `nextTaskSequence - 1`.
 *
 * `count() + 1` serait faux de deux facons : deux creations simultanees
 * liraient le meme total, et un numero deja utilise serait reattribue des qu'une
 * tache disparaitrait. La contrainte d'unicite `projectId + sequence` reste le
 * dernier filet, mais elle n'est pas la garantie : le compteur l'est.
 *
 * Un echec apres reservation laisse un trou dans la numerotation. C'est
 * volontaire : un trou se remarque et ne gene personne, alors qu'un identifiant
 * reutilise designerait deux travaux differents dans Git et dans les logs.
 *
 * Retourne `null` si le projet n'existe pas — cas possible malgre la
 * verification de l'appelant, le projet pouvant disparaitre entre-temps.
 */
export async function createTask(
  db: DatabaseClient,
  input: CreateTaskInput,
): Promise<DevelopmentTaskDetail | null> {
  const row = await db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: input.projectId },
      select: { id: true },
    });
    if (project === null) {
      return null;
    }

    const reserved = await tx.project.update({
      where: { id: input.projectId },
      data: { nextTaskSequence: { increment: 1 } },
      select: { nextTaskSequence: true },
    });
    const sequence = reserved.nextTaskSequence - 1;
    const code = formatTaskCode(sequence);

    return tx.task.create({
      data: {
        projectId: input.projectId,
        sequence,
        title: input.title,
        objective: input.objective,
        context: input.context,
        outOfScope: input.outOfScope,
        status: TASK_STATUS.DRAFT,
        priority: input.priority,
        documentPath: taskDocumentPath(code),
        // Le document n'existe pas encore : la tache est complete en base, son
        // artefact versionne reste a produire.
        documentSyncStatus: TASK_DOCUMENT_SYNC_STATUS.PENDING,
        acceptanceCriteria: {
          create: input.acceptanceCriteria.map((text, position) => ({ position, text })),
        },
        documentReferences: {
          create: input.documentReferences.map((path, position) => ({ position, path })),
        },
        validationCommands: {
          create: input.validationCommands.map((command, position) => ({ position, command })),
        },
      },
      include: DETAIL_INCLUDE,
    });
  });

  return row === null ? null : toDetail(row);
}

export type UpdateTaskStatusResult =
  | { ok: true; task: DevelopmentTaskDetail }
  | { ok: false; reason: "not_found" | "forbidden_transition" };

/**
 * Change le statut d'une tache, si la transition est autorisee.
 *
 * `projectId` fait partie du filtre, et pas seulement d'une verification apres
 * coup : une tache d'un autre projet est introuvable, exactement comme une
 * tache inexistante. Les deux cas partagent la meme reponse pour qu'un
 * identifiant devine ne revele pas son existence.
 *
 * La transition est verifiee **ici**, et pas seulement dans la Server Action :
 * c'est le seul point de passage vers l'ecriture, donc le seul endroit ou la
 * regle ne peut pas etre contournee.
 */
export async function updateTaskStatus(
  db: DatabaseClient,
  taskId: string,
  projectId: string,
  status: TaskStatus,
): Promise<UpdateTaskStatusResult> {
  return db.$transaction(async (tx): Promise<UpdateTaskStatusResult> => {
    const current = await tx.task.findFirst({
      where: { id: taskId, projectId },
      select: { id: true, status: true },
    });

    if (current === null) {
      return { ok: false, reason: "not_found" };
    }

    if (!canTransitionTaskStatus(readStatus(current), status)) {
      return { ok: false, reason: "forbidden_transition" };
    }

    const row = await tx.task.update({
      where: { id: taskId },
      data: { status },
      include: DETAIL_INCLUDE,
    });

    return { ok: true, task: toDetail(row) };
  });
}

/** Applique un nouvel etat de synchronisation, sans toucher a la specification. */
async function setDocumentSync(
  db: DatabaseClient,
  taskId: string,
  documentSyncStatus: TaskDocumentSyncStatus,
  fields: {
    documentPath?: string;
    documentRevision: string | null;
    documentSyncError: string | null;
  },
): Promise<DevelopmentTaskDetail> {
  const row = await db.task.update({
    where: { id: taskId },
    data: { documentSyncStatus, ...fields },
    include: DETAIL_INCLUDE,
  });
  return toDetail(row);
}

/**
 * Le document existe et correspond a la specification enregistree.
 *
 * `documentPath` est reecrit alors qu'il est deja connu : il est derive du code
 * de la tache, et le confirmer a partir de la reponse du runner garantit que la
 * base designe exactement le fichier qui vient d'etre lu.
 */
export function markTaskDocumentSynced(
  db: DatabaseClient,
  taskId: string,
  documentPath: string,
  documentRevision: string,
): Promise<DevelopmentTaskDetail> {
  return setDocumentSync(db, taskId, TASK_DOCUMENT_SYNC_STATUS.SYNCED, {
    documentPath,
    documentRevision,
    // Une reussite efface l'echec precedent : garder l'ancien message ferait
    // croire a un probleme qui n'existe plus.
    documentSyncError: null,
  });
}

/**
 * La creation du document a echoue ; la tache, elle, reste intacte.
 *
 * `message` est un texte deja destine a l'utilisateur : il ne contient ni
 * chemin absolu, ni jeton, ni trace technique. Ce module ne le reformule pas.
 */
export function markTaskDocumentError(
  db: DatabaseClient,
  taskId: string,
  message: string,
): Promise<DevelopmentTaskDetail> {
  return setDocumentSync(db, taskId, TASK_DOCUMENT_SYNC_STATUS.ERROR, {
    // La revision precedente n'a plus de sens : le document attendu n'est pas
    // celui qui se trouve sur le disque.
    documentRevision: null,
    documentSyncError: message,
  });
}

/** Un document different occupe deja le chemin attendu ; NOX n'y touche pas. */
export function markTaskDocumentConflict(
  db: DatabaseClient,
  taskId: string,
  message: string,
): Promise<DevelopmentTaskDetail> {
  return setDocumentSync(db, taskId, TASK_DOCUMENT_SYNC_STATUS.CONFLICT, {
    documentRevision: null,
    documentSyncError: message,
  });
}
