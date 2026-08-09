/**
 * Acces aux donnees de l'Architecte NOX.
 *
 * Deux garanties structurelles vivent ici, et nulle part ailleurs :
 *
 * 1. **Une seule generation active par session.** Le verrou n'est pas une
 *    lecture suivie d'une ecriture — un double clic passerait entre les deux.
 *    C'est une mise a jour conditionnelle, dans la meme transaction que la
 *    creation de la generation.
 * 2. **Une session ne cree qu'une tache.** Meme mecanisme, double par un index
 *    unique sur `appliedTaskId`. La discipline de l'appelant n'y suffirait pas.
 *
 * Une generation terminee est **immuable** : `finishArchitectGeneration` refuse
 * d'ecrire sur une ligne qui n'est plus `RUNNING`. Une generation ratee garde son
 * numero — elle a consomme un appel, et le reattribuer effacerait ce fait.
 */

import {
  ARCHITECT_GENERATION_STATUS,
  ARCHITECT_LIMITS,
  ARCHITECT_SESSION_STATUS,
  isArchitectErrorCode,
  isArchitectGenerationStatus,
  isArchitectSessionStatus,
  type ArchitectContextManifest,
  type ArchitectErrorCode,
  type ArchitectGenerationStatus,
  type ArchitectSessionStatus,
  type ArchitectTaskProposal,
  type ArchitectUsage,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Levee lorsqu'une ligne stockee ne correspond plus au contrat metier. */
export class InvalidArchitectRecordError extends Error {
  constructor(id: string, field: string, value: string) {
    super(`Architecte ${id} : ${field} "${value}" inconnu.`);
    this.name = "InvalidArchitectRecordError";
  }
}

/** Une generation, telle que l'interface la lit. */
export type ArchitectGenerationView = {
  id: string;
  sessionId: string;
  sequence: number;
  model: string;
  promptVersion: string;
  inputHash: string;
  status: ArchitectGenerationStatus;
  /** Manifest deserialise ; `null` si la ligne est illisible. */
  manifest: ArchitectContextManifest | null;
  /** Proposition deserialisee, sans revalidation metier. */
  proposal: ArchitectTaskProposal | null;
  questions: string[];
  providerResponseId: string | null;
  usage: ArchitectUsage;
  errorCode: ArchitectErrorCode | null;
  createdAt: string;
};

/** Une session, avec ses generations de la plus recente a la plus ancienne. */
export type ArchitectSessionView = {
  id: string;
  projectId: string;
  code: string;
  requestText: string;
  clarificationText: string | null;
  status: ArchitectSessionStatus;
  appliedTaskId: string | null;
  /** Nombre de generations deja consommees, echecs compris. */
  generationCount: number;
  /** Generations restantes avant la borne de la session. */
  generationsLeft: number;
  createdAt: string;
  updatedAt: string;
  generations: ArchitectGenerationView[];
};

export type ArchitectSessionSummary = Omit<ArchitectSessionView, "generations">;

/** Code affiche d'une session : `ARCH-001`, derive de son numero. */
export function formatArchitectSessionCode(sequence: number): string {
  return `ARCH-${String(sequence).padStart(3, "0")}`;
}

type GenerationRow = {
  id: string;
  sessionId: string;
  sequence: number;
  model: string;
  promptVersion: string;
  inputHash: string;
  status: string;
  contextManifestJson: string;
  proposalJson: string | null;
  questionsJson: string | null;
  providerResponseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  errorCode: string | null;
  createdAt: Date;
};

type SessionRow = {
  id: string;
  projectId: string;
  sequence: number;
  requestText: string;
  clarificationText: string | null;
  status: string;
  nextGenerationSequence: number;
  appliedTaskId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Deserialise une valeur JSON stockee, sans jamais lever.
 *
 * Une ligne illisible ne doit pas faire tomber une page d'historique : elle
 * devient `null`, et l'interface dira que cette generation n'est plus lisible.
 */
function readJson<T>(raw: string | null): T | null {
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toGeneration(row: GenerationRow): ArchitectGenerationView {
  if (!isArchitectGenerationStatus(row.status)) {
    throw new InvalidArchitectRecordError(row.id, "statut de generation", row.status);
  }
  const errorCode = row.errorCode;
  if (errorCode !== null && !isArchitectErrorCode(errorCode)) {
    throw new InvalidArchitectRecordError(row.id, "code d'erreur", errorCode);
  }

  return {
    id: row.id,
    sessionId: row.sessionId,
    sequence: row.sequence,
    model: row.model,
    promptVersion: row.promptVersion,
    inputHash: row.inputHash,
    status: row.status,
    manifest: readJson<ArchitectContextManifest>(row.contextManifestJson),
    proposal: readJson<ArchitectTaskProposal>(row.proposalJson),
    questions: readJson<string[]>(row.questionsJson) ?? [],
    providerResponseId: row.providerResponseId,
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      cachedInputTokens: row.cachedInputTokens,
    },
    errorCode,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSummary(row: SessionRow): ArchitectSessionSummary {
  if (!isArchitectSessionStatus(row.status)) {
    throw new InvalidArchitectRecordError(row.id, "statut de session", row.status);
  }

  const consumed = row.nextGenerationSequence - 1;
  return {
    id: row.id,
    projectId: row.projectId,
    code: formatArchitectSessionCode(row.sequence),
    requestText: row.requestText,
    clarificationText: row.clarificationText,
    status: row.status,
    appliedTaskId: row.appliedTaskId,
    generationCount: consumed,
    generationsLeft: Math.max(0, ARCHITECT_LIMITS.generations - consumed),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const GENERATION_ORDER = { orderBy: { sequence: "desc" } } as const;

/**
 * Cree une session pour une demande produit.
 *
 * Les sessions ont leur propre suite, independante de celle des taches : une
 * session peut n'en produire aucune, et deux sessions peuvent se suivre sans
 * qu'aucune tache soit creee entre elles.
 *
 * Retourne `null` si le projet n'existe pas : il a pu disparaitre entre la
 * verification de l'appelant et cet appel.
 */
export async function createArchitectSession(
  db: DatabaseClient,
  input: { projectId: string; requestText: string },
): Promise<ArchitectSessionSummary | null> {
  const row = await db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: input.projectId },
      select: { id: true },
    });
    if (project === null) {
      return null;
    }

    // Le numero se derive d'un comptage des sessions existantes : contrairement
    // aux taches et aux executions, il n'apparait ni dans Git, ni dans un nom de
    // fichier, ni dans un log — il ne sert qu'a nommer une ligne d'historique.
    // La contrainte d'unicite reste le filet en cas de creation simultanee.
    const previous = await tx.architectSession.count({ where: { projectId: input.projectId } });

    return tx.architectSession.create({
      data: {
        projectId: input.projectId,
        sequence: previous + 1,
        requestText: input.requestText,
        clarificationText: null,
        status: ARCHITECT_SESSION_STATUS.OPEN,
      },
    });
  });

  return row === null ? null : toSummary(row);
}

/** Retourne une session complete, generations comprises. */
export async function getArchitectSession(
  db: DatabaseClient,
  sessionId: string,
): Promise<ArchitectSessionView | null> {
  const row = await db.architectSession.findUnique({
    where: { id: sessionId },
    include: { generations: GENERATION_ORDER },
  });
  if (row === null) {
    return null;
  }
  return { ...toSummary(row), generations: row.generations.map(toGeneration) };
}

/** Sessions d'un projet, de la plus recente a la plus ancienne. */
export async function listArchitectSessions(
  db: DatabaseClient,
  projectId: string,
): Promise<ArchitectSessionSummary[]> {
  const rows = await db.architectSession.findMany({
    where: { projectId },
    orderBy: { sequence: "desc" },
  });
  return rows.map(toSummary);
}

/**
 * Enregistre les precisions apportees par l'utilisateur.
 *
 * Elles remplacent les precedentes : ce champ decrit l'etat courant de la
 * clarification, pas son historique. L'historique, lui, vit dans les generations
 * — chacune a ete produite avec les precisions du moment.
 */
export async function saveArchitectClarification(
  db: DatabaseClient,
  sessionId: string,
  clarificationText: string,
): Promise<boolean> {
  const updated = await db.architectSession.updateMany({
    // Une session appliquee ne se modifie plus : sa tache existe.
    where: { id: sessionId, status: { not: ARCHITECT_SESSION_STATUS.APPLIED } },
    data: { clarificationText },
  });
  return updated.count === 1;
}

export type StartGenerationInput = {
  sessionId: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  manifest: ArchitectContextManifest;
};

export type StartGenerationResult =
  | { ok: true; generation: ArchitectGenerationView }
  | { ok: false; reason: "not_found" | "already_applied" | "active" | "limit" };

/**
 * Reserve une generation, ou refuse.
 *
 * ## Le verrou
 *
 * `updateMany` avec `status != GENERATING` dans son `where` est la prise du
 * verrou : deux appels concurrents ne peuvent pas tous deux voir un compte de 1.
 * Le second obtient 0 et repart avec `active`. Une verification prealable suivie
 * d'une ecriture laisserait exactement la fenetre qu'un double clic exploite.
 *
 * ## La borne
 *
 * Elle porte sur le compteur, pas sur un comptage de lignes reussies : une
 * generation qui echoue a quand meme joint le fournisseur. Compter les seules
 * reussites permettrait une boucle infinie d'echecs.
 */
export async function startArchitectGeneration(
  db: DatabaseClient,
  input: StartGenerationInput,
): Promise<StartGenerationResult> {
  return db.$transaction(async (tx): Promise<StartGenerationResult> => {
    const session = await tx.architectSession.findUnique({
      where: { id: input.sessionId },
      select: { id: true, status: true, nextGenerationSequence: true },
    });
    if (session === null) {
      return { ok: false, reason: "not_found" };
    }
    if (session.status === ARCHITECT_SESSION_STATUS.APPLIED) {
      return { ok: false, reason: "already_applied" };
    }
    if (session.nextGenerationSequence > ARCHITECT_LIMITS.generations) {
      return { ok: false, reason: "limit" };
    }

    const claimed = await tx.architectSession.updateMany({
      where: { id: input.sessionId, status: { not: ARCHITECT_SESSION_STATUS.GENERATING } },
      data: {
        status: ARCHITECT_SESSION_STATUS.GENERATING,
        nextGenerationSequence: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      return { ok: false, reason: "active" };
    }

    const row = await tx.architectGeneration.create({
      data: {
        sessionId: input.sessionId,
        sequence: session.nextGenerationSequence,
        model: input.model,
        promptVersion: input.promptVersion,
        inputHash: input.inputHash,
        contextManifestJson: JSON.stringify(input.manifest),
        status: ARCHITECT_GENERATION_STATUS.RUNNING,
      },
    });

    return { ok: true, generation: toGeneration(row) };
  });
}

export type FinishGenerationInput = {
  generationId: string;
  status: Exclude<ArchitectGenerationStatus, "RUNNING">;
  proposal?: ArchitectTaskProposal | null;
  questions?: readonly string[];
  providerResponseId?: string | null;
  usage?: ArchitectUsage;
  errorCode?: ArchitectErrorCode | null;
};

/** Statut de session correspondant a l'issue d'une generation. */
const SESSION_STATUS_BY_GENERATION: Record<
  Exclude<ArchitectGenerationStatus, "RUNNING">,
  ArchitectSessionStatus
> = {
  [ARCHITECT_GENERATION_STATUS.PROPOSAL_READY]: ARCHITECT_SESSION_STATUS.PROPOSAL_READY,
  [ARCHITECT_GENERATION_STATUS.NEEDS_INPUT]: ARCHITECT_SESSION_STATUS.NEEDS_INPUT,
  [ARCHITECT_GENERATION_STATUS.REFUSED]: ARCHITECT_SESSION_STATUS.FAILED,
  [ARCHITECT_GENERATION_STATUS.FAILED]: ARCHITECT_SESSION_STATUS.FAILED,
};

/**
 * Conclut une generation, et met la session a jour dans la meme transaction.
 *
 * Refuse si la generation n'est plus `RUNNING` : une generation terminee est un
 * fait, et un second appel — reprise, double reponse — ne doit pas le reecrire.
 * La garantie vit dans le `where`, pas dans la politesse de l'appelant.
 */
export async function finishArchitectGeneration(
  db: DatabaseClient,
  input: FinishGenerationInput,
): Promise<ArchitectGenerationView | null> {
  return db.$transaction(async (tx) => {
    const claimed = await tx.architectGeneration.updateMany({
      where: { id: input.generationId, status: ARCHITECT_GENERATION_STATUS.RUNNING },
      data: {
        status: input.status,
        proposalJson: input.proposal === undefined || input.proposal === null
          ? null
          : JSON.stringify(input.proposal),
        questionsJson:
          input.questions === undefined ? null : JSON.stringify([...input.questions]),
        providerResponseId: input.providerResponseId ?? null,
        inputTokens: input.usage?.inputTokens ?? null,
        outputTokens: input.usage?.outputTokens ?? null,
        totalTokens: input.usage?.totalTokens ?? null,
        cachedInputTokens: input.usage?.cachedInputTokens ?? null,
        errorCode: input.errorCode ?? null,
      },
    });
    if (claimed.count !== 1) {
      return null;
    }

    const row = await tx.architectGeneration.findUnique({ where: { id: input.generationId } });
    if (row === null) {
      return null;
    }

    // La session suit l'issue de sa derniere generation — sauf si elle a ete
    // appliquee entre-temps, ce qui n'arrive pas mais coute une ligne a exclure.
    await tx.architectSession.updateMany({
      where: { id: row.sessionId, status: { not: ARCHITECT_SESSION_STATUS.APPLIED } },
      data: { status: SESSION_STATUS_BY_GENERATION[input.status] },
    });

    return toGeneration(row);
  });
}

export type ClaimArchitectSessionResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_applied" | "not_ready" };

/**
 * Reserve le droit de creer la tache d'une session.
 *
 * ## Pourquoi reserver **avant** de creer la tache
 *
 * Parce que l'inverse serait faux. Creer la tache puis marquer la session
 * laisserait un double clic produire deux taches, dont une seule serait
 * rattachee : la seconde deviendrait un doublon orphelin, avec son propre numero
 * et son propre document Markdown.
 *
 * La reservation est une mise a jour conditionnelle — `PROPOSAL_READY` et pas
 * encore de tache —, donc atomique. Le second appel obtient 0 et repart avec
 * `already_applied`, sans avoir rien cree.
 *
 * `appliedTaskId` reste `null` a ce stade : la tache n'existe pas encore. C'est
 * `attachArchitectTask` qui le renseignera, et `releaseArchitectSession` qui
 * rendra la main si la creation echoue. Le meme decoupage que la reservation
 * d'une correction en TASK-012.
 */
export async function claimArchitectSession(
  db: DatabaseClient,
  sessionId: string,
): Promise<ClaimArchitectSessionResult> {
  return db.$transaction(async (tx): Promise<ClaimArchitectSessionResult> => {
    const session = await tx.architectSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true, appliedTaskId: true },
    });
    if (session === null) {
      return { ok: false, reason: "not_found" };
    }
    if (session.appliedTaskId !== null || session.status === ARCHITECT_SESSION_STATUS.APPLIED) {
      return { ok: false, reason: "already_applied" };
    }
    if (session.status !== ARCHITECT_SESSION_STATUS.PROPOSAL_READY) {
      return { ok: false, reason: "not_ready" };
    }

    const claimed = await tx.architectSession.updateMany({
      where: {
        id: sessionId,
        status: ARCHITECT_SESSION_STATUS.PROPOSAL_READY,
        appliedTaskId: null,
      },
      data: { status: ARCHITECT_SESSION_STATUS.APPLIED },
    });

    return claimed.count === 1 ? { ok: true } : { ok: false, reason: "already_applied" };
  });
}

/**
 * Rattache la tache creee a sa session.
 *
 * Appelee juste apres la creation. Un echec ici laisse une session `APPLIED`
 * sans tache liee : l'utilisateur voit sa tache dans le backlog, et la session
 * dit qu'elle a ete appliquee. C'est le pire cas, et il reste lisible.
 */
export async function attachArchitectTask(
  db: DatabaseClient,
  sessionId: string,
  taskId: string,
): Promise<boolean> {
  const updated = await db.architectSession.updateMany({
    where: { id: sessionId, appliedTaskId: null },
    data: { appliedTaskId: taskId },
  });
  return updated.count === 1;
}

/**
 * Rend la main apres une creation qui n'a pas abouti.
 *
 * Le `where` exige `appliedTaskId: null` : une session dont la tache existe
 * vraiment n'est jamais rouverte, quelle que soit la suite des evenements.
 */
export async function releaseArchitectSession(
  db: DatabaseClient,
  sessionId: string,
): Promise<boolean> {
  const released = await db.architectSession.updateMany({
    where: {
      id: sessionId,
      status: ARCHITECT_SESSION_STATUS.APPLIED,
      appliedTaskId: null,
    },
    data: { status: ARCHITECT_SESSION_STATUS.PROPOSAL_READY },
  });
  return released.count === 1;
}

/**
 * Derniere generation ayant produit une proposition exploitable.
 *
 * Cherchee en base plutot que passee par le navigateur : la proposition affichee
 * dans le formulaire est editable, mais celle qui autorise la creation vient
 * toujours d'ici.
 */
export function latestArchitectProposal(
  session: ArchitectSessionView,
): ArchitectGenerationView | null {
  return (
    session.generations.find(
      (generation) =>
        generation.status === ARCHITECT_GENERATION_STATUS.PROPOSAL_READY &&
        generation.proposal !== null,
    ) ?? null
  );
}

/** Questions de la derniere generation qui en a pose. */
export function latestArchitectQuestions(session: ArchitectSessionView): string[] {
  return (
    session.generations.find(
      (generation) => generation.status === ARCHITECT_GENERATION_STATUS.NEEDS_INPUT,
    )?.questions ?? []
  );
}
