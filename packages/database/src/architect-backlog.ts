/**
 * Planification du backlog de V1 : generations, propositions, application.
 *
 * ## Deux verrous, deux questions
 *
 * - `Project.activeBacklogGenerationId` repond a « un appel est-il en vol ? ».
 *   Il est pris avant l'appel et rendu des qu'il se conclut, reussite comme
 *   echec. C'est lui qui fait qu'un double clic ne produit jamais deux appels.
 * - `Project.pendingBacklogProposalId` repond a « un backlog attend-il une
 *   decision ? ». Il est pose a l'ecriture d'une proposition et retire par
 *   `Apply` comme par `Dismiss`.
 *
 * Les deux sont pris par des **mises a jour conditionnelles**, jamais par une
 * lecture suivie d'une ecriture : c'est la seule forme qui resiste a deux
 * requetes simultanees.
 *
 * ## Le payload du fournisseur est immuable
 *
 * `providerJson` conserve la reponse telle qu'elle a ete rendue. Aucune
 * fonction de ce module ne le reecrit. Le backlog reellement retenu par
 * l'humain — edite, reordonne, ampute — est une donnee differente, ecrite dans
 * `appliedJson` au moment de l'application.
 *
 * ## La peremption n'est pas un statut
 *
 * Elle se derive : l'empreinte de planification enregistree est comparee a celle
 * d'aujourd'hui. La persister obligerait a la recalculer a chaque changement du
 * projet, et laisserait des propositions marquees perimees alors que l'etat est
 * revenu a ce qu'il etait.
 *
 * ## Ce module n'appelle personne
 *
 * Ni OpenAI, ni Claude Code, ni le runner. Appliquer ou ecarter un backlog sont
 * des ecritures SQLite. La creation des documents Markdown appartient a
 * l'appelant, et se produit **apres** cette transaction : voir l'entete de
 * `applyBacklogProposal`.
 */

import {
  ARCHITECT_BACKLOG_GENERATION_STATUS,
  ARCHITECT_BACKLOG_LIMITS,
  ARCHITECT_BACKLOG_PROPOSAL_STATUS,
  ARCHITECT_BACKLOG_SCHEMA_VERSION,
  EMPTY_ARCHITECT_USAGE,
  formatBacklogCode,
  formatTaskCode,
  isArchitectBacklogGenerationStatus,
  isArchitectBacklogProposalStatus,
  isBacklogContextManifest,
  isTaskPriority,
  isTaskStatus,
  TASK_PRIORITY,
  type ArchitectBacklogGenerationStatus,
  type ArchitectBacklogProposal,
  type ArchitectBacklogProposalStatus,
  type ArchitectBacklogTaskProposal,
  type ArchitectUsage,
  type BacklogContextManifest,
  type DevelopmentTaskDetail,
  type TaskStatus,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";
import { reserveTaskSequences, writeTaskRow, type CreateTaskInput } from "./tasks.js";

/**
 * Etat de planification **vu par le fournisseur** au moment de l'appel.
 *
 * Capture avant l'appel, jamais relu apres. C'est la meme correction qu'en
 * TASK-021, et elle est contre-intuitive pour la meme raison : « tout relire
 * cote serveur » est habituellement plus sur, mais pas ici. Entre le depart de
 * la requete et l'arrivee de la reponse, l'utilisateur peut avoir modifie son
 * plan ou cree une tache ; relire au moment d'enregistrer etiquetterait le
 * backlog comme bati sur un etat que le modele n'a jamais vu, et le controle de
 * peremption ne detecterait plus rien.
 */
export type BacklogPlanningBase = {
  /** Empreinte couvrant brief, plan, memoire, inventaire et documents inclus. */
  planningFingerprint: string;
  /** `null` signifie « pas encore defini a ce moment-la ». */
  briefRevision: string | null;
  planRevision: string | null;
  taskInventoryRevision: string;
  memoryRevision: string;
};

/** Une planification, telle que l'interface la lit. */
export type ArchitectBacklogGenerationView = {
  id: string;
  projectId: string;
  sequence: number;
  /** Derive de `sequence`, jamais stocke : `BACKLOG-001`. */
  code: string;
  status: ArchitectBacklogGenerationStatus;
  model: string;
  promptVersion: string;
  inputHash: string;
  manifest: BacklogContextManifest | null;
  base: BacklogPlanningBase;
  providerResponseId: string | null;
  usage: ArchitectUsage;
  errorCode: string | null;
  /** Date ISO 8601. */
  createdAt: string;
  finishedAt: string | null;
};

/** Un backlog propose, tel que l'interface le lit. */
export type ArchitectBacklogProposalView = {
  id: string;
  generationId: string;
  projectId: string;
  status: ArchitectBacklogProposalStatus;
  message: string;
  taskCount: number;
  /** Ce que le fournisseur a propose, tel quel. Jamais reecrit. */
  provided: ArchitectBacklogProposal;
  /** Ce que l'humain a reellement applique. `null` tant que ce n'est pas fait. */
  applied: ArchitectBacklogProposal | null;
  appliedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
};

type GenerationRow = {
  id: string;
  projectId: string;
  sequence: number;
  status: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  contextManifestJson: string;
  planningFingerprint: string;
  baseBriefRevision: string | null;
  basePlanRevision: string | null;
  baseTaskInventoryRevision: string;
  baseMemoryRevision: string;
  providerResponseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  errorCode: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

type ProposalRow = {
  id: string;
  generationId: string;
  projectId: string;
  status: string;
  message: string;
  taskCount: number;
  providerJson: string;
  appliedJson: string | null;
  appliedAt: Date | null;
  dismissedAt: Date | null;
  createdAt: Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readManifest(value: string): BacklogContextManifest | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isBacklogContextManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Relit un backlog enregistre, sans revalider la liste fermee des documents.
 *
 * ## Pourquoi une relecture indulgente
 *
 * Parce qu'un payload est un **fait historique**. Le repartir dans
 * `readArchitectBacklogProposal` reviendrait a le confronter a l'inventaire
 * d'aujourd'hui : un document renomme depuis rendrait illisible une proposition
 * parfaitement valide le jour ou elle a ete produite, et NOX conserve
 * precisement ces payloads pour pouvoir les relire.
 *
 * Cela n'ouvre aucune porte : rien de ce qui est relu ici n'est ecrit tel quel.
 * A l'application, chaque tache repasse par la validation complete — bornes,
 * commandes, chemins — contre l'etat courant du projet.
 */
function readBacklogPayload(value: string, fallbackMessage: string): ArchitectBacklogProposal {
  const empty: ArchitectBacklogProposal = {
    schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION,
    message: fallbackMessage,
    tasks: [],
  };

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) {
      return empty;
    }

    const rawTasks: unknown = parsed["tasks"];
    const tasks: ArchitectBacklogTaskProposal[] = Array.isArray(rawTasks)
      ? rawTasks.filter(isRecord).map((task) => ({
          title: typeof task["title"] === "string" ? task["title"] : "",
          priority: isTaskPriority(task["priority"]) ? task["priority"] : TASK_PRIORITY.MEDIUM,
          objective: typeof task["objective"] === "string" ? task["objective"] : "",
          context: typeof task["context"] === "string" ? task["context"] : null,
          acceptanceCriteria: readStrings(task["acceptanceCriteria"]),
          outOfScope: readStrings(task["outOfScope"]),
          documentReferences: readStrings(task["documentReferences"]),
          validationCommands: readStrings(task["validationCommands"]),
        }))
      : [];

    return {
      schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION,
      message: typeof parsed["message"] === "string" ? parsed["message"] : fallbackMessage,
      tasks,
    };
  } catch {
    return empty;
  }
}

function toGeneration(row: GenerationRow): ArchitectBacklogGenerationView {
  return {
    id: row.id,
    projectId: row.projectId,
    sequence: row.sequence,
    code: formatBacklogCode(row.sequence),
    status: isArchitectBacklogGenerationStatus(row.status)
      ? row.status
      : ARCHITECT_BACKLOG_GENERATION_STATUS.FAILED,
    model: row.model,
    promptVersion: row.promptVersion,
    inputHash: row.inputHash,
    manifest: readManifest(row.contextManifestJson),
    base: {
      planningFingerprint: row.planningFingerprint,
      briefRevision: row.baseBriefRevision,
      planRevision: row.basePlanRevision,
      taskInventoryRevision: row.baseTaskInventoryRevision,
      memoryRevision: row.baseMemoryRevision,
    },
    providerResponseId: row.providerResponseId,
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      cachedInputTokens: row.cachedInputTokens,
    },
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function toProposal(row: ProposalRow): ArchitectBacklogProposalView {
  return {
    id: row.id,
    generationId: row.generationId,
    projectId: row.projectId,
    status: isArchitectBacklogProposalStatus(row.status)
      ? row.status
      : ARCHITECT_BACKLOG_PROPOSAL_STATUS.PENDING,
    message: row.message,
    taskCount: row.taskCount,
    provided: readBacklogPayload(row.providerJson, row.message),
    applied: row.appliedJson === null ? null : readBacklogPayload(row.appliedJson, row.message),
    appliedAt: row.appliedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// --- Reservation d'un appel --------------------------------------------------

export type StartBacklogGenerationInput = {
  projectId: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  manifest: BacklogContextManifest;
  base: BacklogPlanningBase;
};

export type StartBacklogGenerationResult =
  | { ok: true; generation: ArchitectBacklogGenerationView }
  | { ok: false; reason: "not_found" | "active" | "pending_proposal" };

/**
 * Reserve le droit d'appeler le fournisseur, et enregistre l'appel a venir.
 *
 * ## Reserver avant d'appeler, jamais l'inverse
 *
 * Les deux refus possibles — un appel deja en vol, une proposition deja en
 * attente — sont constates **avant** que la moindre requete ne parte. Un clic
 * refuse coute donc zero appel et zero jeton, ce qui est exactement ce que
 * promet « un Generate = au plus un appel ».
 *
 * ## Pourquoi une proposition en attente bloque
 *
 * Deux backlogs applicables en meme temps decriraient deux plans concurrents,
 * dont l'un rendrait l'autre perime des qu'on l'appliquerait. L'utilisateur
 * n'aurait aucun moyen de savoir lequel choisir, et NOX aucun moyen de le lui
 * dire. Ecarter la proposition en attente est un geste explicite, gratuit, et
 * qui laisse une trace.
 */
export async function startBacklogGeneration(
  db: DatabaseClient,
  input: StartBacklogGenerationInput,
): Promise<StartBacklogGenerationResult> {
  return db.$transaction(async (tx): Promise<StartBacklogGenerationResult> => {
    const project = await tx.project.findUnique({
      where: { id: input.projectId },
      select: {
        id: true,
        activeBacklogGenerationId: true,
        pendingBacklogProposalId: true,
      },
    });
    if (project === null) {
      return { ok: false, reason: "not_found" };
    }
    if (project.pendingBacklogProposalId !== null) {
      return { ok: false, reason: "pending_proposal" };
    }
    if (project.activeBacklogGenerationId !== null) {
      return { ok: false, reason: "active" };
    }

    const reserved = await tx.project.update({
      where: { id: input.projectId },
      data: { nextBacklogSequence: { increment: 1 } },
      select: { nextBacklogSequence: true },
    });

    const row = await tx.architectBacklogGeneration.create({
      data: {
        projectId: input.projectId,
        sequence: reserved.nextBacklogSequence - 1,
        status: ARCHITECT_BACKLOG_GENERATION_STATUS.RUNNING,
        model: input.model,
        promptVersion: input.promptVersion,
        inputHash: input.inputHash,
        contextManifestJson: JSON.stringify(input.manifest),
        planningFingerprint: input.base.planningFingerprint,
        baseBriefRevision: input.base.briefRevision,
        basePlanRevision: input.base.planRevision,
        baseTaskInventoryRevision: input.base.taskInventoryRevision,
        baseMemoryRevision: input.base.memoryRevision,
      },
    });

    // Mise a jour conditionnelle, jamais une lecture suivie d'une ecriture :
    // c'est elle qui tranche entre deux clics simultanes, et non la lecture
    // faite plus haut, qui n'est qu'une reponse rapide au cas courant.
    const claimed = await tx.project.updateMany({
      where: { id: input.projectId, activeBacklogGenerationId: null },
      data: { activeBacklogGenerationId: row.id },
    });
    if (claimed.count !== 1) {
      // La transaction est annulee : ni generation, ni numero consomme.
      throw new BacklogGenerationRaceError(input.projectId);
    }

    return { ok: true, generation: toGeneration(row) };
  }).catch((error: unknown) => {
    if (error instanceof BacklogGenerationRaceError) {
      return { ok: false, reason: "active" } as const;
    }
    throw error;
  });
}

/**
 * Levee lorsqu'une seconde reservation a gagne la course.
 *
 * Une exception plutot qu'un retour, parce qu'elle doit **annuler la
 * transaction** : sans cela, la generation deja creee resterait en base sans
 * verrou, et le numero serait consomme pour un appel qui n'aura jamais lieu.
 */
class BacklogGenerationRaceError extends Error {
  constructor(projectId: string) {
    super(`Une planification est deja en cours pour le projet ${projectId}.`);
    this.name = "BacklogGenerationRaceError";
  }
}

// --- Conclusion d'un appel ---------------------------------------------------

export type FinishBacklogGenerationInput = {
  generationId: string;
  status: ArchitectBacklogGenerationStatus;
  providerResponseId?: string | null;
  usage?: ArchitectUsage;
  errorCode?: string | null;
  /** Backlog valide, lorsque l'appel a abouti. */
  proposal?: ArchitectBacklogProposal | null;
};

/**
 * Conclut une planification, et rend le verrou.
 *
 * ## Le verrou est rendu dans tous les cas
 *
 * Reussite, refus, panne du fournisseur, sortie invalide : la generation cesse
 * d'etre active. Une planification laissee `RUNNING` bloquerait le projet pour
 * toujours, puisque c'est elle qui porte le verrou d'appel.
 *
 * ## La proposition est ecrite dans la meme transaction
 *
 * C'est ce qui interdit l'etat batard : une planification annoncee reussie sans
 * backlog a relire, ou un backlog en attente sans planification qui le porte.
 * Le pointeur de proposition en attente est pose ici aussi, au meme instant.
 *
 * Une generation deja conclue n'est jamais modifiee : `updateMany` filtre sur
 * `RUNNING`, et un second appel ne fait rien.
 */
export async function finishBacklogGeneration(
  db: DatabaseClient,
  input: FinishBacklogGenerationInput,
): Promise<ArchitectBacklogGenerationView | null> {
  return db.$transaction(async (tx) => {
    const existing = await tx.architectBacklogGeneration.findUnique({
      where: { id: input.generationId },
    });
    if (existing === null) {
      return null;
    }

    const usage = input.usage ?? EMPTY_ARCHITECT_USAGE;
    const concluded = await tx.architectBacklogGeneration.updateMany({
      where: {
        id: input.generationId,
        status: ARCHITECT_BACKLOG_GENERATION_STATUS.RUNNING,
      },
      data: {
        status: input.status,
        providerResponseId: input.providerResponseId ?? null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cachedInputTokens: usage.cachedInputTokens,
        errorCode: input.errorCode ?? null,
        finishedAt: new Date(),
      },
    });

    if (concluded.count !== 1) {
      // Deja conclue : rien n'est reecrit, et le verrou a deja ete rendu.
      return toGeneration(existing);
    }

    const proposal = input.proposal ?? null;
    if (proposal !== null) {
      const written = await tx.architectBacklogProposal.create({
        data: {
          generationId: input.generationId,
          projectId: existing.projectId,
          status: ARCHITECT_BACKLOG_PROPOSAL_STATUS.PENDING,
          message: proposal.message,
          taskCount: proposal.tasks.length,
          providerJson: JSON.stringify(proposal),
        },
      });

      const marked = await tx.project.updateMany({
        where: { id: existing.projectId, pendingBacklogProposalId: null },
        data: { pendingBacklogProposalId: written.id },
      });
      if (marked.count !== 1) {
        // Impossible en pratique — le verrou d'appel l'exclut — mais si cela
        // arrivait, mieux vaut annuler tout le tour que laisser deux backlogs
        // applicables sans que rien ne dise lequel compte.
        throw new BacklogGenerationRaceError(existing.projectId);
      }
    }

    // Le verrou d'appel est rendu en dernier : tant qu'il tient, rien d'autre ne
    // peut partir, et l'ecriture de la proposition reste protegee.
    await tx.project.updateMany({
      where: { id: existing.projectId, activeBacklogGenerationId: input.generationId },
      data: { activeBacklogGenerationId: null },
    });

    const refreshed = await tx.architectBacklogGeneration.findUnique({
      where: { id: input.generationId },
    });
    return refreshed === null ? null : toGeneration(refreshed);
  });
}

// --- Lecture -----------------------------------------------------------------

/** Une tache creee par un backlog, telle que la page la relie. */
export type BacklogCreatedTask = {
  id: string;
  code: string;
  title: string;
  status: TaskStatus;
  /** Position dans l'ordre valide par l'humain, a partir de 0. */
  position: number;
};

/** Tout ce que la page Backlog affiche, en une lecture. */
export type ProjectBacklogView = {
  /** Planification en vol, lorsqu'il y en a une. */
  running: ArchitectBacklogGenerationView | null;
  /** Proposition en attente de decision. */
  pending: ArchitectBacklogProposalView | null;
  /** Generation de la proposition en attente, pour son code et son manifest. */
  pendingGeneration: ArchitectBacklogGenerationView | null;
  /** Derniere proposition appliquee, quelle que soit son anciennete. */
  lastApplied: ArchitectBacklogProposalView | null;
  /** Taches creees par `lastApplied`, dans l'ordre valide par l'humain. */
  lastAppliedTasks: BacklogCreatedTask[];
  /** Historique des planifications, de la plus recente a la plus ancienne. */
  history: ArchitectBacklogGenerationView[];
};

/** Nombre de planifications conservees dans l'historique affiche. */
const HISTORY_LIMIT = 10;

/** Lit une proposition par son identifiant, bornee au projet. */
export async function getBacklogProposal(
  db: DatabaseClient,
  projectId: string,
  proposalId: string,
): Promise<ArchitectBacklogProposalView | null> {
  const row = await db.architectBacklogProposal.findUnique({ where: { id: proposalId } });
  // Un identifiant croise entre deux projets est un « introuvable », jamais un
  // refus qui confirmerait l'existence de la ligne.
  return row === null || row.projectId !== projectId ? null : toProposal(row);
}

/** Lit la proposition d'une planification, s'il en existe une. */
export async function getBacklogProposalForGeneration(
  db: DatabaseClient,
  projectId: string,
  generationId: string,
): Promise<ArchitectBacklogProposalView | null> {
  const row = await db.architectBacklogProposal.findUnique({ where: { generationId } });
  return row === null || row.projectId !== projectId ? null : toProposal(row);
}

/** Lit la planification qui porte une proposition. */
export async function getBacklogGeneration(
  db: DatabaseClient,
  generationId: string,
): Promise<ArchitectBacklogGenerationView | null> {
  const row = await db.architectBacklogGeneration.findUnique({ where: { id: generationId } });
  return row === null ? null : toGeneration(row);
}

/** Taches creees par une proposition, dans l'ordre valide par l'humain. */
export async function listBacklogTasks(
  db: DatabaseClient,
  proposalId: string,
): Promise<BacklogCreatedTask[]> {
  const rows = await db.task.findMany({
    where: { backlogProposalId: proposalId },
    orderBy: { backlogItemPosition: "asc" },
    select: { id: true, sequence: true, title: true, status: true, backlogItemPosition: true },
  });

  return rows.map((row, index) => ({
    id: row.id,
    code: formatTaskCode(row.sequence),
    title: row.title,
    status: isTaskStatus(row.status) ? row.status : "DRAFT",
    position: row.backlogItemPosition ?? index,
  }));
}

/**
 * Lit tout ce dont la page Backlog a besoin.
 *
 * Une seule fonction, parce qu'une page qui lirait son etat en trois endroits
 * finirait par en afficher trois versions differentes.
 */
export async function loadProjectBacklog(
  db: DatabaseClient,
  projectId: string,
): Promise<ProjectBacklogView> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { activeBacklogGenerationId: true, pendingBacklogProposalId: true },
  });

  const [runningRow, pendingRow, appliedRow, historyRows] = await Promise.all([
    project?.activeBacklogGenerationId == null
      ? Promise.resolve(null)
      : db.architectBacklogGeneration.findUnique({
          where: { id: project.activeBacklogGenerationId },
        }),
    project?.pendingBacklogProposalId == null
      ? Promise.resolve(null)
      : db.architectBacklogProposal.findUnique({ where: { id: project.pendingBacklogProposalId } }),
    db.architectBacklogProposal.findFirst({
      where: { projectId, status: ARCHITECT_BACKLOG_PROPOSAL_STATUS.APPLIED },
      orderBy: { appliedAt: "desc" },
    }),
    db.architectBacklogGeneration.findMany({
      where: { projectId },
      orderBy: { sequence: "desc" },
      take: HISTORY_LIMIT,
    }),
  ]);

  const pending = pendingRow === null ? null : toProposal(pendingRow);
  const lastApplied = appliedRow === null ? null : toProposal(appliedRow);

  const [pendingGenerationRow, lastAppliedTasks] = await Promise.all([
    pending === null
      ? Promise.resolve(null)
      : db.architectBacklogGeneration.findUnique({ where: { id: pending.generationId } }),
    lastApplied === null ? Promise.resolve([]) : listBacklogTasks(db, lastApplied.id),
  ]);

  return {
    running: runningRow === null ? null : toGeneration(runningRow),
    pending,
    pendingGeneration: pendingGenerationRow === null ? null : toGeneration(pendingGenerationRow),
    lastApplied,
    lastAppliedTasks,
    history: historyRows.map(toGeneration),
  };
}

// --- Application et abandon --------------------------------------------------

/** Une tache du backlog, telle que l'humain l'a validee. */
export type BacklogTaskToCreate = Omit<CreateTaskInput, "projectId">;

export type ApplyBacklogResult =
  | {
      ok: true;
      proposal: ArchitectBacklogProposalView;
      tasks: DevelopmentTaskDetail[];
    }
  | { ok: false; reason: "not_found" }
  /** Deja appliquee ou deja ecartee : un second passage ne refait rien. */
  | { ok: false; reason: "not_pending"; status: ArchitectBacklogProposalStatus }
  /** Le contexte de planification n'est plus celui que le fournisseur avait vu. */
  | { ok: false; reason: "stale" }
  /** L'humain a tout retire : il reste a ecarter, pas a appliquer. */
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "too_many"; limit: number };

export type ApplyBacklogInput = {
  projectId: string;
  proposalId: string;
  /** Backlog valide par l'humain, deja verifie, dans son ordre definitif. */
  tasks: readonly BacklogTaskToCreate[];
  /**
   * Empreinte du contexte de planification **d'aujourd'hui**.
   *
   * Elle est reconstruite par l'appelant, sans aucun appel au fournisseur, et
   * comparee ici a celle qui a ete enregistree avec la generation.
   *
   * Pourquoi l'appelant : elle couvre les documents du repository, que seule la
   * frontiere runner sait lire. `packages/database` n'a pas acces au disque, et
   * ne doit pas en avoir.
   *
   * Cela ne laisse aucune fenetre exploitable : la proposition est prise par une
   * mise a jour conditionnelle sur `PENDING` dans cette meme transaction, donc
   * une seconde application ne peut pas s'y glisser.
   */
  currentPlanningFingerprint: string;
  /** Message du backlog retenu, pour l'artefact `appliedJson`. */
  message: string;
};

/**
 * Applique un backlog : cree toutes ses taches, ou aucune.
 *
 * ## Ce que cette transaction garantit
 *
 * Une seule transaction porte tout : controle du statut, controle de
 * peremption, prise de la proposition, reservation des numeros, ecriture des N
 * taches, retrait du pointeur d'attente. L'etat « trois taches creees, la
 * quatrieme en erreur, proposition marquee appliquee » n'existe pas.
 *
 * ## Ce qu'elle ne garantit pas, et pourquoi le dire
 *
 * Les documents `tasks/TASK-0NN.md` ne sont **pas** ecrits ici. SQLite et le
 * systeme de fichiers ne partagent aucune transaction, et pretendre le
 * contraire serait faux. Leur creation appartient a l'appelant, qui la fait
 * apres, tache par tache, avec exactement la primitive de TASK-007 : creation
 * exclusive, adoption d'un fichier identique, conflit sinon — jamais un
 * ecrasement.
 *
 * Un echec a cette etape laisse des taches dont le document reste a produire,
 * etat que NOX modelise depuis TASK-007 et qui se reprend d'un clic. C'est une
 * limite reelle, et elle est assumee plutot que masquee : la parade est en
 * amont, dans le preflight qui refuse d'appliquer si le repository ne repond
 * pas.
 *
 * ## Aucune tache existante n'est touchee
 *
 * Ni modifiee, ni supprimee, ni renumerotee. Les numeros attribues viennent de
 * `Project.nextTaskSequence`, qui ne recule jamais : un backlog applique
 * s'ajoute a la suite, il ne se fait pas de place.
 */
export async function applyBacklogProposal(
  db: DatabaseClient,
  input: ApplyBacklogInput,
): Promise<ApplyBacklogResult> {
  if (input.tasks.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (input.tasks.length > ARCHITECT_BACKLOG_LIMITS.tasks.max) {
    return { ok: false, reason: "too_many", limit: ARCHITECT_BACKLOG_LIMITS.tasks.max };
  }

  return db.$transaction(async (tx): Promise<ApplyBacklogResult> => {
    const row = await tx.architectBacklogProposal.findUnique({ where: { id: input.proposalId } });
    if (row === null || row.projectId !== input.projectId) {
      return { ok: false, reason: "not_found" };
    }

    const status = isArchitectBacklogProposalStatus(row.status)
      ? row.status
      : ARCHITECT_BACKLOG_PROPOSAL_STATUS.PENDING;
    if (status !== ARCHITECT_BACKLOG_PROPOSAL_STATUS.PENDING) {
      return { ok: false, reason: "not_pending", status };
    }

    const generation = await tx.architectBacklogGeneration.findUnique({
      where: { id: row.generationId },
      select: { planningFingerprint: true },
    });
    if (generation === null) {
      return { ok: false, reason: "not_found" };
    }
    if (generation.planningFingerprint !== input.currentPlanningFingerprint) {
      // Refuse localement. NOX ne fusionne pas deux etats, et il n'existe aucun
      // chemin de code allant d'un conflit vers un nouvel appel au fournisseur.
      return { ok: false, reason: "stale" };
    }

    const applied: ArchitectBacklogProposal = {
      schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION,
      message: input.message,
      tasks: input.tasks.map((task) => ({
        title: task.title,
        priority: task.priority,
        objective: task.objective,
        context: task.context,
        acceptanceCriteria: [...task.acceptanceCriteria],
        outOfScope: task.outOfScope === null ? [] : [task.outOfScope],
        documentReferences: [...task.documentReferences],
        validationCommands: [...task.validationCommands],
      })),
    };

    // La proposition est prise avant toute creation. Une mise a jour
    // conditionnelle, jamais une lecture suivie d'une ecriture : c'est elle qui
    // rend un Apply et un Dismiss concurrents mutuellement exclusifs.
    const claimed = await tx.architectBacklogProposal.updateMany({
      where: { id: input.proposalId, status: ARCHITECT_BACKLOG_PROPOSAL_STATUS.PENDING },
      data: {
        status: ARCHITECT_BACKLOG_PROPOSAL_STATUS.APPLIED,
        appliedAt: new Date(),
        appliedJson: JSON.stringify(applied),
      },
    });
    if (claimed.count !== 1) {
      return { ok: false, reason: "not_pending", status };
    }

    // Une seule incrementation pour toute la plage : deux applications
    // simultanees obtiennent deux plages disjointes, sans verrou explicite.
    const sequences = await reserveTaskSequences(tx, input.projectId, input.tasks.length);

    const created: DevelopmentTaskDetail[] = [];
    for (const [position, task] of input.tasks.entries()) {
      const sequence = sequences[position];
      if (sequence === undefined) {
        throw new Error("Numero de tache manquant lors de l'application d'un backlog.");
      }
      created.push(
        await writeTaskRow(tx, {
          projectId: input.projectId,
          ...task,
          sequence,
          backlogProposalId: input.proposalId,
          backlogItemPosition: position,
        }),
      );
    }

    // Le pointeur d'attente est retire : une nouvelle planification redevient
    // possible, et la page cesse d'annoncer un backlog a relire.
    await tx.project.updateMany({
      where: { id: input.projectId, pendingBacklogProposalId: input.proposalId },
      data: { pendingBacklogProposalId: null },
    });

    const refreshed = await tx.architectBacklogProposal.findUnique({
      where: { id: input.proposalId },
    });
    if (refreshed === null) {
      return { ok: false, reason: "not_found" };
    }

    return { ok: true, proposal: toProposal(refreshed), tasks: created };
  });
}

export type DismissBacklogResult =
  | { ok: true; proposal: ArchitectBacklogProposalView }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_pending"; status: ArchitectBacklogProposalStatus };

/**
 * Ecarte une proposition.
 *
 * Aucune tache creee, aucun appel, aucune ecriture dans le repository. La
 * proposition reste lisible : elle raconte ce que le modele avait propose, et
 * le fait qu'on ne l'ait pas retenu est lui aussi une information.
 *
 * Une proposition perimee reste ecartable — c'est meme la sortie normale d'un
 * backlog devenu caduc.
 */
export async function dismissBacklogProposal(
  db: DatabaseClient,
  input: { projectId: string; proposalId: string },
): Promise<DismissBacklogResult> {
  return db.$transaction(async (tx): Promise<DismissBacklogResult> => {
    const row = await tx.architectBacklogProposal.findUnique({ where: { id: input.proposalId } });
    if (row === null || row.projectId !== input.projectId) {
      return { ok: false, reason: "not_found" };
    }

    const status = isArchitectBacklogProposalStatus(row.status)
      ? row.status
      : ARCHITECT_BACKLOG_PROPOSAL_STATUS.PENDING;
    if (status !== ARCHITECT_BACKLOG_PROPOSAL_STATUS.PENDING) {
      return { ok: false, reason: "not_pending", status };
    }

    const claimed = await tx.architectBacklogProposal.updateMany({
      where: { id: input.proposalId, status: ARCHITECT_BACKLOG_PROPOSAL_STATUS.PENDING },
      data: {
        status: ARCHITECT_BACKLOG_PROPOSAL_STATUS.DISMISSED,
        dismissedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      return { ok: false, reason: "not_pending", status };
    }

    await tx.project.updateMany({
      where: { id: input.projectId, pendingBacklogProposalId: input.proposalId },
      data: { pendingBacklogProposalId: null },
    });

    const refreshed = await tx.architectBacklogProposal.findUnique({
      where: { id: input.proposalId },
    });
    return refreshed === null
      ? { ok: false, reason: "not_found" }
      : { ok: true, proposal: toProposal(refreshed) };
  });
}
