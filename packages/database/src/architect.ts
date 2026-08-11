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
  ARCHITECT_CONVERSATION_VERSION,
  ARCHITECT_GENERATION_STATUS,
  ARCHITECT_LIMITS,
  ARCHITECT_MESSAGE_ROLE,
  ARCHITECT_SESSION_STATUS,
  isArchitectErrorCode,
  isArchitectGenerationStatus,
  isArchitectMessageRole,
  isArchitectSessionStatus,
  isArchitectTurnState,
  type ArchitectContextManifest,
  type ArchitectErrorCode,
  type ArchitectGenerationStatus,
  type ArchitectMessageRole,
  type ArchitectSessionStatus,
  type ArchitectTaskProposal,
  type ArchitectTurnState,
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

/** Un message de la conversation, tel que l'interface le lit. */
export type ArchitectMessageView = {
  id: string;
  sequence: number;
  role: ArchitectMessageRole;
  content: string;
  /** Generation du tour, lorsqu'elle est connue. */
  generationId: string | null;
  createdAt: string;
};

/** Un tour prepare mais pas encore envoye. */
export type ArchitectPendingTurn = {
  messageText: string;
  contextFingerprint: string;
  manifest: ArchitectContextManifest | null;
  preparedAt: string;
};

/** Une generation, telle que l'interface la lit. */
export type ArchitectGenerationView = {
  id: string;
  sessionId: string;
  sequence: number;
  model: string;
  promptVersion: string;
  inputHash: string;
  status: ArchitectGenerationStatus;
  /** Issue du tour, `null` pour les generations d'avant TASK-014. */
  turnState: ArchitectTurnState | null;
  contextFingerprint: string | null;
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
  /** `1` avant TASK-014 : consultable, jamais poursuivie. */
  conversationVersion: number;
  /** Vrai lorsque la session peut encore recevoir un tour. */
  conversational: boolean;
  appliedTaskId: string | null;
  /** Nombre de generations deja consommees, echecs compris. */
  generationCount: number;
  /** Generations restantes avant la borne de la session. */
  generationsLeft: number;
  /** Tour prepare et pas encore envoye, le cas echeant. */
  pendingTurn: ArchitectPendingTurn | null;
  createdAt: string;
  updatedAt: string;
  generations: ArchitectGenerationView[];
  /** Messages du plus ancien au plus recent : c'est l'ordre de lecture. */
  messages: ArchitectMessageView[];
};

export type ArchitectSessionSummary = Omit<ArchitectSessionView, "generations" | "messages">;

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
  turnState: string | null;
  contextFingerprint: string | null;
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
  conversationVersion: number;
  pendingMessageText: string | null;
  pendingContextFingerprint: string | null;
  pendingContextManifestJson: string | null;
  pendingPreparedAt: Date | null;
  nextGenerationSequence: number;
  appliedTaskId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MessageRow = {
  id: string;
  sequence: number;
  role: string;
  content: string;
  generationId: string | null;
  createdAt: Date;
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
  const turnState = row.turnState;
  if (turnState !== null && !isArchitectTurnState(turnState)) {
    throw new InvalidArchitectRecordError(row.id, "issue de tour", turnState);
  }

  return {
    id: row.id,
    sessionId: row.sessionId,
    sequence: row.sequence,
    model: row.model,
    promptVersion: row.promptVersion,
    inputHash: row.inputHash,
    status: row.status,
    turnState,
    contextFingerprint: row.contextFingerprint,
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

function toMessage(row: MessageRow): ArchitectMessageView {
  if (!isArchitectMessageRole(row.role)) {
    throw new InvalidArchitectRecordError(row.id, "role de message", row.role);
  }
  return {
    id: row.id,
    sequence: row.sequence,
    role: row.role,
    content: row.content,
    generationId: row.generationId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Relit le brouillon prepare.
 *
 * Les quatre champs vont ensemble : un brouillon dont l'empreinte manquerait ne
 * pourrait pas etre compare au contexte actuel, et l'envoyer reviendrait a
 * envoyer un contexte que personne n'a relu. Il est alors traite comme absent.
 */
function toPendingTurn(row: SessionRow): ArchitectPendingTurn | null {
  if (
    row.pendingMessageText === null ||
    row.pendingContextFingerprint === null ||
    row.pendingPreparedAt === null
  ) {
    return null;
  }
  return {
    messageText: row.pendingMessageText,
    contextFingerprint: row.pendingContextFingerprint,
    manifest: readJson<ArchitectContextManifest>(row.pendingContextManifestJson),
    preparedAt: row.pendingPreparedAt.toISOString(),
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
    conversationVersion: row.conversationVersion,
    conversational: row.conversationVersion >= ARCHITECT_CONVERSATION_VERSION.CONVERSATION,
    appliedTaskId: row.appliedTaskId,
    generationCount: consumed,
    generationsLeft: Math.max(0, ARCHITECT_LIMITS.generations - consumed),
    pendingTurn: toPendingTurn(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const GENERATION_ORDER = { orderBy: { sequence: "desc" } } as const;

/** Les messages se lisent toujours dans l'ordre ou ils ont ete ecrits. */
const MESSAGE_ORDER = { orderBy: { sequence: "asc" } } as const;

/** Efface le brouillon prepare, en une seule definition. */
const CLEAR_PENDING_TURN = {
  pendingMessageText: null,
  pendingContextFingerprint: null,
  pendingContextManifestJson: null,
  pendingPreparedAt: null,
} as const;

/**
 * Cree une conversation Architecte.
 *
 * Les sessions ont leur propre suite, independante de celle des taches : une
 * session peut n'en produire aucune, et deux sessions peuvent se suivre sans
 * qu'aucune tache soit creee entre elles.
 *
 * `requestText` porte le **message d'ouverture**, et il n'existe qu'un seul
 * exemplaire de ce texte : aucun message n'est ecrit ici. Il le deviendra au
 * premier tour reussi, comme tous les autres — un message n'entre dans la
 * conversation que lorsqu'il a reellement ete envoye.
 *
 * Ce texte n'est jamais modifiable : c'est ce qui garantit qu'il ne peut pas
 * diverger du premier message du transcript. Pour repartir d'autre chose, on
 * ouvre une nouvelle conversation — cela ne consomme rien.
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
        conversationVersion: ARCHITECT_CONVERSATION_VERSION.CONVERSATION,
        status: ARCHITECT_SESSION_STATUS.OPEN,
      },
    });
  });

  return row === null ? null : toSummary(row);
}

/** Retourne une session complete, generations et messages compris. */
export async function getArchitectSession(
  db: DatabaseClient,
  sessionId: string,
): Promise<ArchitectSessionView | null> {
  const row = await db.architectSession.findUnique({
    where: { id: sessionId },
    include: { generations: GENERATION_ORDER, messages: MESSAGE_ORDER },
  });
  if (row === null) {
    return null;
  }
  return {
    ...toSummary(row),
    generations: row.generations.map(toGeneration),
    messages: row.messages.map(toMessage),
  };
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
 * Session Architecte a l'origine d'une tache, s'il y en a une.
 *
 * `appliedTaskId` porte un index unique : la relation est donc au plus un a un,
 * et le guide peut afficher « Designed with Architect » sans risquer de choisir
 * arbitrairement parmi plusieurs sessions.
 *
 * Retourne `null` pour une tache creee a la main — ce qui reste le cas ordinaire,
 * et n'a rien d'un defaut.
 */
export async function findArchitectSessionForTask(
  db: DatabaseClient,
  taskId: string,
): Promise<{ id: string; code: string } | null> {
  const row = await db.architectSession.findFirst({
    where: { appliedTaskId: taskId },
    select: { id: true, sequence: true },
  });
  return row === null ? null : { id: row.id, code: formatArchitectSessionCode(row.sequence) };
}

export type SaveTurnDraftInput = {
  sessionId: string;
  messageText: string;
  contextFingerprint: string;
  manifest: ArchitectContextManifest;
};

/**
 * Enregistre le tour prepare par `Review context`.
 *
 * Un seul brouillon par session : le nouveau remplace l'ancien. C'est
 * exactement ce qu'on veut — l'utilisateur qui recommence son apercu apres avoir
 * corrige son texte ne doit pas se retrouver avec deux tours en attente.
 *
 * Le brouillon vit en base plutot que dans le navigateur pour que l'apercu et
 * l'envoi parlent du **meme** message : un champ recopie dans un formulaire
 * cache pourrait etre modifie entre les deux.
 */
export async function saveArchitectTurnDraft(
  db: DatabaseClient,
  input: SaveTurnDraftInput,
): Promise<boolean> {
  const updated = await db.architectSession.updateMany({
    // Ni une session appliquee, ni une session en cours de generation : la
    // premiere a fini, la seconde a deja un tour en vol.
    where: {
      id: input.sessionId,
      status: { notIn: [ARCHITECT_SESSION_STATUS.APPLIED, ARCHITECT_SESSION_STATUS.GENERATING] },
      conversationVersion: { gte: ARCHITECT_CONVERSATION_VERSION.CONVERSATION },
    },
    data: {
      pendingMessageText: input.messageText,
      pendingContextFingerprint: input.contextFingerprint,
      pendingContextManifestJson: JSON.stringify(input.manifest),
      pendingPreparedAt: new Date(),
    },
  });
  return updated.count === 1;
}

/**
 * Abandonne le tour prepare.
 *
 * Un brouillon abandonne ne laisse **aucune** trace dans la conversation : il
 * n'a jamais ete envoye, et l'inscrire comme message raconterait un echange qui
 * n'a pas eu lieu.
 */
export async function clearArchitectTurnDraft(
  db: DatabaseClient,
  sessionId: string,
): Promise<boolean> {
  const updated = await db.architectSession.updateMany({
    where: { id: sessionId, status: { not: ARCHITECT_SESSION_STATUS.GENERATING } },
    data: CLEAR_PENDING_TURN,
  });
  return updated.count === 1;
}

export type StartGenerationInput = {
  sessionId: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  contextFingerprint: string;
  manifest: ArchitectContextManifest;
  /**
   * Empreinte que le brouillon doit encore porter.
   *
   * Fournie, elle est verifiee **dans la transaction** : si le contexte a change
   * depuis l'apercu, aucune generation n'est reservee et aucun appel n'est fait.
   */
  expectedFingerprint?: string;
};

export type StartGenerationResult =
  | { ok: true; generation: ArchitectGenerationView; pendingMessage: string }
  | {
      ok: false;
      reason: "not_found" | "already_applied" | "active" | "limit" | "legacy" | "no_draft" | "changed";
    };

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
      select: {
        id: true,
        status: true,
        conversationVersion: true,
        nextGenerationSequence: true,
        pendingMessageText: true,
        pendingContextFingerprint: true,
      },
    });
    if (session === null) {
      return { ok: false, reason: "not_found" };
    }
    if (session.status === ARCHITECT_SESSION_STATUS.APPLIED) {
      return { ok: false, reason: "already_applied" };
    }
    if (session.conversationVersion < ARCHITECT_CONVERSATION_VERSION.CONVERSATION) {
      return { ok: false, reason: "legacy" };
    }
    if (session.pendingMessageText === null || session.pendingContextFingerprint === null) {
      return { ok: false, reason: "no_draft" };
    }
    if (
      input.expectedFingerprint !== undefined &&
      session.pendingContextFingerprint !== input.expectedFingerprint
    ) {
      // Le contexte n'est plus celui de l'apercu. Refuser ici, avant la
      // reservation, garantit qu'aucun appel n'est facture et qu'aucune
      // generation ne consomme le quota de la conversation.
      return { ok: false, reason: "changed" };
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
        contextFingerprint: input.contextFingerprint,
        contextManifestJson: JSON.stringify(input.manifest),
        status: ARCHITECT_GENERATION_STATUS.RUNNING,
      },
    });

    return { ok: true, generation: toGeneration(row), pendingMessage: session.pendingMessageText };
  });
}

export type FinishGenerationInput = {
  generationId: string;
  status: Exclude<ArchitectGenerationStatus, "RUNNING">;
  turnState?: ArchitectTurnState | null;
  proposal?: ArchitectTaskProposal | null;
  questions?: readonly string[];
  providerResponseId?: string | null;
  usage?: ArchitectUsage;
  errorCode?: ArchitectErrorCode | null;
  /**
   * Messages a figer dans la conversation, dans l'ordre.
   *
   * Fournis, ils sont ecrits et le brouillon est efface — dans la **meme**
   * transaction que le changement de statut. Absents, le brouillon survit : le
   * texte de l'utilisateur lui reste acquis, et il peut relancer.
   *
   * C'est ce qui definit le moment ou un message devient historique : un tour
   * qui a reellement abouti, jamais une tentative.
   */
  messages?: readonly { role: ArchitectMessageRole; content: string }[];
};

/** Statut de session correspondant a l'issue d'une generation. */
const SESSION_STATUS_BY_GENERATION: Record<
  Exclude<ArchitectGenerationStatus, "RUNNING">,
  ArchitectSessionStatus
> = {
  [ARCHITECT_GENERATION_STATUS.PROPOSAL_READY]: ARCHITECT_SESSION_STATUS.PROPOSAL_READY,
  [ARCHITECT_GENERATION_STATUS.CONTINUE]: ARCHITECT_SESSION_STATUS.CONTINUE,
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
 *
 * C'est le **seul** ecrivain de messages de conversation en dehors de la
 * creation d'une session. Les figer ici, sous la meme transaction que l'issue
 * du tour, evite l'etat batard ou une reponse existerait sans sa generation.
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
        turnState: input.turnState ?? null,
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

    if (input.messages !== undefined && input.messages.length > 0) {
      const last = await tx.architectMessage.findFirst({
        where: { sessionId: row.sessionId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      let sequence = (last?.sequence ?? 0) + 1;

      for (const message of input.messages) {
        await tx.architectMessage.create({
          data: {
            sessionId: row.sessionId,
            sequence,
            role: message.role,
            content: message.content,
            generationId: row.id,
          },
        });
        sequence += 1;
      }
    }

    // La session suit l'issue de sa derniere generation — sauf si elle a ete
    // appliquee entre-temps, ce qui n'arrive pas mais coute une ligne a exclure.
    await tx.architectSession.updateMany({
      where: { id: row.sessionId, status: { not: ARCHITECT_SESSION_STATUS.APPLIED } },
      data: {
        status: SESSION_STATUS_BY_GENERATION[input.status],
        // Le brouillon n'est efface que si le tour a abouti : sinon l'utilisateur
        // perdrait son texte a cause d'une panne qui ne lui appartient pas.
        ...(input.messages === undefined ? {} : CLEAR_PENDING_TURN),
      },
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
 *
 * Les generations sont triees du plus recent au plus ancien, donc la premiere
 * trouvee est bien la derniere rendue. Les precedentes restent intactes et
 * consultables : une proposition n'en efface jamais une autre.
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

/**
 * Issues de tour qui laissent une trace dans la conversation.
 *
 * Un echec n'en fait pas partie : il n'a fige aucun message, et ne peut donc
 * pas rendre une proposition obsolete.
 */
const TURN_STATUSES: readonly ArchitectGenerationStatus[] = [
  ARCHITECT_GENERATION_STATUS.PROPOSAL_READY,
  ARCHITECT_GENERATION_STATUS.CONTINUE,
  ARCHITECT_GENERATION_STATUS.NEEDS_INPUT,
];

/**
 * La derniere proposition est-elle encore celle dont parle la conversation ?
 *
 * Elle ne l'est plus des qu'un tour lui a succede : l'utilisateur a ecrit
 * quelque chose apres l'avoir lue, et l'architecte lui a repondu. Creer la tache
 * a partir d'une proposition que la discussion a deja depassee produirait
 * exactement ce que l'utilisateur venait de demander de changer.
 */
export function canCreateArchitectTask(session: ArchitectSessionView): boolean {
  if (session.status === ARCHITECT_SESSION_STATUS.APPLIED || session.appliedTaskId !== null) {
    return false;
  }
  const proposal = latestArchitectProposal(session);
  if (proposal === null) {
    return false;
  }
  const lastTurn = session.generations.find((generation) =>
    TURN_STATUSES.includes(generation.status),
  );
  return lastTurn !== undefined && lastTurn.id === proposal.id;
}

/** Questions du dernier tour, lorsqu'il en a pose. */
export function latestArchitectQuestions(session: ArchitectSessionView): string[] {
  return (
    session.generations.find((generation) => TURN_STATUSES.includes(generation.status))
      ?.questions ?? []
  );
}

/**
 * Proposition rendue au tour d'un message donne.
 *
 * Permet d'afficher une proposition **a sa place** dans le fil, et de la
 * transmettre avec le message auquel elle appartient. Sans elle, un « fais-la
 * plus petite » du tour suivant ne designerait rien.
 */
export function architectProposalOfMessage(
  session: ArchitectSessionView,
  message: ArchitectMessageView,
): ArchitectTaskProposal | null {
  if (message.role !== ARCHITECT_MESSAGE_ROLE.ARCHITECT || message.generationId === null) {
    return null;
  }
  return (
    session.generations.find((generation) => generation.id === message.generationId)?.proposal ??
    null
  );
}

/** Taille du transcript, mesuree sur ce qui partirait reellement. */
export function architectTranscriptChars(session: ArchitectSessionView): number {
  return session.messages.reduce((total, message) => total + message.content.length, 0);
}
