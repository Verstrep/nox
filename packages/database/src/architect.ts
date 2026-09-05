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
  ARCHITECT_DIAGNOSTIC_LIMITS,
  ARCHITECT_ERROR,
  ARCHITECT_GENERATION_STATUS,
  ARCHITECT_MESSAGE_ROLE,
  ARCHITECT_SESSION_KIND,
  ARCHITECT_SESSION_STATUS,
  architectSessionGenerationLimit,
  architectTurnFailureCategory,
  formatTaskCode,
  isArchitectErrorCode,
  isArchitectGenerationStatus,
  isArchitectMessageRole,
  isArchitectSessionKind,
  isArchitectSessionStatus,
  isArchitectTurnState,
  sanitizeArchitectDiagnosticText,
  type ArchitectContextManifest,
  type ArchitectErrorCode,
  REPLAN_PROPOSAL_STATUS,
  type ArchitectProjectUpdateProposal,
  type ReplanProposal,
  type ArchitectGenerationStatus,
  type ArchitectMessageRole,
  type ArchitectSessionKind,
  type ArchitectSessionStatus,
  type ArchitectTaskProposal,
  type ArchitectTurnDiagnostic,
  type ArchitectTurnState,
  type ArchitectUsage,
} from "@nox/shared";

import {
  writeArchitectProjectUpdate,
  type ProjectUpdateBase,
} from "./architect-project-update.js";
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
  /**
   * Ce que NOX a refuse, et pourquoi.
   *
   * `null` sur les deux champs pour une panne du fournisseur — il n'y a alors
   * aucun champ fautif — et pour toute generation anterieure a HOTFIX-003.
   * « Cause non enregistree » est un etat, pas une occasion d'en inventer une.
   */
  diagnostic: ArchitectTurnDiagnostic | null;
  /** Tache creee depuis la proposition de ce tour, une fois seulement. */
  appliedTaskId: string | null;
  createdAt: string;
  /** Instant de conclusion, `null` tant que le tour est en vol ou avant HOTFIX-004. */
  finishedAt: string | null;
  /**
   * Duree reelle du tour, en millisecondes.
   *
   * **Derivee, jamais stockee** : deux colonnes et un ecart calcule finiraient
   * par se contredire. `null` quand l'un des deux instants manque — une
   * generation encore en vol, ou anterieure a HOTFIX-004. « Duree inconnue » est
   * un etat, et le distinguer de « zero » est tout l'interet.
   */
  durationMs: number | null;
};

/** Une session, avec ses generations de la plus recente a la plus ancienne. */
export type ArchitectSessionView = {
  id: string;
  projectId: string;
  code: string;
  requestText: string;
  clarificationText: string | null;
  status: ArchitectSessionStatus;
  /** Role de la session : conversation principale, ou conception historique. */
  kind: ArchitectSessionKind;
  /** `1` avant TASK-014 : consultable, jamais poursuivie. */
  conversationVersion: number;
  /** Vrai lorsque la session peut encore recevoir un tour. */
  conversational: boolean;
  appliedTaskId: string | null;
  /** Nombre de generations deja consommees, echecs compris. */
  generationCount: number;
  /**
   * Generations restantes, ou `null` lorsque la session n'a pas de borne.
   *
   * Une conversation projet n'en a pas : elle accompagne le projet pendant des
   * mois, et un plafond atteint la rendrait definitivement muette.
   */
  generationsLeft: number | null;
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
  errorField: string | null;
  errorDetail: string | null;
  appliedTaskId: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

type SessionRow = {
  id: string;
  projectId: string;
  sequence: number;
  requestText: string;
  clarificationText: string | null;
  status: string;
  kind: string;
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
    // Le diagnostic n'existe que pour un echec : le composer pour une
    // generation reussie inventerait une categorie de panne sur un tour qui a
    // abouti.
    diagnostic:
      row.status === ARCHITECT_GENERATION_STATUS.FAILED
        ? {
            category: architectTurnFailureCategory(errorCode, row.errorField),
            field: row.errorField,
            message: row.errorDetail,
          }
        : null,
    appliedTaskId: row.appliedTaskId,
    finishedAt: row.finishedAt === null ? null : row.finishedAt.toISOString(),
    durationMs:
      row.finishedAt === null ? null : row.finishedAt.getTime() - row.createdAt.getTime(),
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

  if (!isArchitectSessionKind(row.kind)) {
    throw new InvalidArchitectRecordError(row.id, "role de session", row.kind);
  }

  const consumed = row.nextGenerationSequence - 1;
  const limit = architectSessionGenerationLimit(row.kind);
  return {
    id: row.id,
    projectId: row.projectId,
    code: formatArchitectSessionCode(row.sequence),
    requestText: row.requestText,
    clarificationText: row.clarificationText,
    status: row.status,
    kind: row.kind,
    conversationVersion: row.conversationVersion,
    conversational: row.conversationVersion >= ARCHITECT_CONVERSATION_VERSION.CONVERSATION,
    appliedTaskId: row.appliedTaskId,
    generationCount: consumed,
    generationsLeft: limit === null ? null : Math.max(0, limit - consumed),
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
  input: { projectId: string; requestText: string; kind?: ArchitectSessionKind },
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
        kind: input.kind ?? ARCHITECT_SESSION_KIND.TASK_DESIGN_LEGACY,
        status: ARCHITECT_SESSION_STATUS.OPEN,
      },
    });
  });

  return row === null ? null : toSummary(row);
}

/**
 * Conversation principale d'un projet, creee si elle n'existe pas encore.
 *
 * ## Pourquoi la creation est locale, et pourquoi elle est ici
 *
 * Ouvrir la page suffit a creer la conversation, et cela ne coute rien : une
 * ligne SQLite, aucun appel au fournisseur, aucun message. La creer au premier
 * message aurait laisse la page dans un etat batard — un fil qui existe a
 * l'ecran mais pas en base — et complique chaque lecture ulterieure.
 *
 * ## Deux ouvertures simultanees
 *
 * La reservation porte sur `Project.mainArchitectSessionId`, par une mise a jour
 * **conditionnelle** : `null` attendu, valeur posee. Une ligne de projet ne
 * portant qu'une valeur, le second appel obtient 0 et repart lire celle du
 * premier. La session qu'il venait de creer disparait avec la transaction : rien
 * n'est laisse derriere.
 */
export async function ensureProjectArchitectSession(
  db: DatabaseClient,
  projectId: string,
): Promise<ArchitectSessionSummary | null> {
  const existing = await findProjectArchitectSession(db, projectId);
  if (existing !== null) {
    return existing;
  }

  try {
    const row = await db.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { id: true, mainArchitectSessionId: true },
      });
      if (project === null) {
        return null;
      }
      if (project.mainArchitectSessionId !== null) {
        return tx.architectSession.findUnique({ where: { id: project.mainArchitectSessionId } });
      }

      const previous = await tx.architectSession.count({ where: { projectId } });
      const created = await tx.architectSession.create({
        data: {
          projectId,
          sequence: previous + 1,
          // Une conversation projet n'a pas de « demande » d'ouverture : elle
          // commence par un message comme les suivants. Le champ de TASK-013
          // reste vide plutot que de recevoir un texte invente.
          requestText: "",
          clarificationText: null,
          conversationVersion: ARCHITECT_CONVERSATION_VERSION.CONVERSATION,
          kind: ARCHITECT_SESSION_KIND.PROJECT,
          status: ARCHITECT_SESSION_STATUS.OPEN,
        },
      });

      const claimed = await tx.project.updateMany({
        where: { id: projectId, mainArchitectSessionId: null },
        data: { mainArchitectSessionId: created.id },
      });
      if (claimed.count !== 1) {
        // Un autre appel a gagne. Annuler la transaction efface la session que
        // l'on vient de creer, et l'appelant relira celle du gagnant.
        throw new ConcurrentProjectArchitectError();
      }

      return created;
    });

    return row === null ? null : toSummary(row);
  } catch (error) {
    if (error instanceof ConcurrentProjectArchitectError) {
      return findProjectArchitectSession(db, projectId);
    }
    throw error;
  }
}

/** Signale une ouverture concurrente, et n'existe que pour annuler sa transaction. */
class ConcurrentProjectArchitectError extends Error {}

/** Conversation principale d'un projet, sans la creer. */
export async function findProjectArchitectSession(
  db: DatabaseClient,
  projectId: string,
): Promise<ArchitectSessionSummary | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { mainArchitectSessionId: true },
  });
  if (project === null || project.mainArchitectSessionId === null) {
    return null;
  }
  const row = await db.architectSession.findUnique({
    where: { id: project.mainArchitectSessionId },
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

/** D'ou vient une tache, lorsqu'un architecte l'a proposee. */
export type ArchitectTaskOrigin = {
  sessionId: string;
  code: string;
  kind: ArchitectSessionKind;
  /** Numero du tour, lorsque la tache vient d'une conversation projet. */
  generationSequence: number | null;
};

/**
 * Session Architecte a l'origine d'une tache, s'il y en a une.
 *
 * Deux chemins, parce qu'il y a deux modeles. Une session historique porte
 * elle-meme sa tache ; une conversation projet la porte sur la **generation**
 * qui l'a proposee — c'est ce deplacement qui lui permet d'en creer plusieurs.
 *
 * Les deux liens portent un index unique : la relation reste au plus un a un
 * dans les deux cas, et le guide n'a jamais a choisir arbitrairement.
 *
 * Retourne `null` pour une tache ecrite a la main, ce qui reste le cas ordinaire.
 */
export async function findArchitectSessionForTask(
  db: DatabaseClient,
  taskId: string,
): Promise<ArchitectTaskOrigin | null> {
  const generation = await db.architectGeneration.findFirst({
    where: { appliedTaskId: taskId },
    select: { sequence: true, session: { select: { id: true, sequence: true, kind: true } } },
  });
  if (generation !== null && isArchitectSessionKind(generation.session.kind)) {
    return {
      sessionId: generation.session.id,
      code: formatArchitectSessionCode(generation.session.sequence),
      kind: generation.session.kind,
      generationSequence: generation.sequence,
    };
  }

  const session = await db.architectSession.findFirst({
    where: { appliedTaskId: taskId },
    select: { id: true, sequence: true, kind: true },
  });
  if (session === null || !isArchitectSessionKind(session.kind)) {
    return null;
  }
  return {
    sessionId: session.id,
    code: formatArchitectSessionCode(session.sequence),
    kind: session.kind,
    generationSequence: null,
  };
}

/** Tache creee depuis une conversation, rattachee au tour qui l'a proposee. */
export type ArchitectSessionTask = {
  /** Generation dont la proposition a produit cette tache. */
  generationId: string;
  taskId: string;
  code: string;
  title: string;
  createdAt: string;
};

/**
 * Taches creees depuis une conversation, dans l'ordre des tours.
 *
 * Ces lignes n'ont **rien** a voir avec le transcript : elles sont derivees de
 * `ArchitectGeneration.appliedTaskId`, la relation qui existait deja, et servent
 * uniquement a l'affichage. Aucune n'entre dans le contexte transmis au
 * fournisseur — une tache creee se signale d'elle-meme au tour suivant, par la
 * liste des taches recentes.
 *
 * Une session de conception de tache n'en produit aucune : son verrou porte sur
 * la session, pas sur la generation. C'est voulu, et cela laisse son affichage
 * exactement tel qu'il etait.
 */
export async function listArchitectSessionTasks(
  db: DatabaseClient,
  sessionId: string,
): Promise<ArchitectSessionTask[]> {
  const rows = await db.architectGeneration.findMany({
    where: { sessionId, appliedTaskId: { not: null } },
    select: {
      id: true,
      appliedTask: { select: { id: true, sequence: true, title: true, createdAt: true } },
    },
    orderBy: { sequence: "asc" },
  });

  const tasks: ArchitectSessionTask[] = [];
  for (const row of rows) {
    // `appliedTaskId` non nul et `appliedTask` nul ne peut pas arriver — la cle
    // etrangere l'interdit —, mais le type le permet et une tache absente ne
    // justifie pas de faire echouer la page.
    if (row.appliedTask === null) {
      continue;
    }
    tasks.push({
      generationId: row.id,
      taskId: row.appliedTask.id,
      code: formatTaskCode(row.appliedTask.sequence),
      title: row.appliedTask.title,
      createdAt: row.appliedTask.createdAt.toISOString(),
    });
  }
  return tasks;
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
        kind: true,
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
    if (!isArchitectSessionKind(session.kind)) {
      return { ok: false, reason: "not_found" };
    }
    const limit = architectSessionGenerationLimit(session.kind);
    if (limit !== null && session.nextGenerationSequence > limit) {
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
   * Champ refuse et phrase de refus, tels que le validateur de NOX les nomme.
   *
   * Nettoyes et bornes a l'ecriture, jamais a la lecture : ce qui est en base
   * est deja ce qui s'affiche, et une seconde normalisation a l'affichage
   * finirait par diverger de celle-ci.
   */
  errorField?: string | null;
  errorDetail?: string | null;
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
  /**
   * Mise a jour du projet proposee par ce tour, a enregistrer avec lui.
   *
   * Ecrite dans la **meme** transaction que la conclusion de la generation et
   * que les messages. C'est la seule facon d'eviter l'etat impossible ou une
   * reponse annonce une proposition qui n'existe nulle part.
   *
   * `baseState` decrit l'etat structure que le fournisseur avait sous les yeux.
   * Il vient de la preparation du tour, jamais d'une relecture faite ici : voir
   * `architect-project-update.ts`.
   */
  projectUpdate?: {
    projectId: string;
    proposed: ArchitectProjectUpdateProposal;
    baseState: ProjectUpdateBase;
  } | null;
  /**
   * Replanification proposee par ce tour, a enregistrer avec lui.
   *
   * Meme transaction que la conclusion, les messages et la mise a jour du
   * projet. Quand les deux propositions viennent du meme tour, la
   * replanification recoit l'identifiant de la mise a jour : elles deviennent un
   * seul changement, applique ou ecarte d'un geste.
   *
   * Un projet qui porte deja une proposition en attente en refuse une seconde.
   * Le tour aboutit malgre tout — la conversation continue, la reponse est
   * enregistree —, et `replanRefused` le dit a l'appelant.
   */
  replan?: {
    projectId: string;
    proposal: ReplanProposal;
    baseState: ProjectUpdateBase;
    planningFingerprint: string;
  } | null;
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
  // Un arret ne casse pas la conversation : elle reprend exactement la ou elle
  // etait, avec le brouillon intact. `FAILED` ferait chercher une panne que
  // personne n'a subie.
  [ARCHITECT_GENERATION_STATUS.CANCELLED]: ARCHITECT_SESSION_STATUS.CONTINUE,
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
        errorField:
          input.errorField == null
            ? null
            : sanitizeArchitectDiagnosticText(input.errorField, ARCHITECT_DIAGNOSTIC_LIMITS.field),
        errorDetail:
          input.errorDetail == null
            ? null
            : sanitizeArchitectDiagnosticText(
                input.errorDetail,
                ARCHITECT_DIAGNOSTIC_LIMITS.message,
              ),
        // Pose ici, dans la transaction qui conclut : la duree mesuree est celle
        // de l'appel, pas celle d'un rendu ulterieur.
        finishedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      // Deja conclue. Depuis HOTFIX-004, ce n'est plus seulement un double appel
      // improbable : c'est le chemin normal d'un resultat qui arrive apres un
      // arret. Le `where` sur `RUNNING` est ce qui empeche une reponse tardive
      // de ressusciter un tour que l'utilisateur a stoppe — et il le fait sans
      // qu'aucun appelant ait a y penser.
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

    let projectUpdateId: string | null = null;
    if (input.projectUpdate !== undefined && input.projectUpdate !== null) {
      projectUpdateId = await writeArchitectProjectUpdate(tx, {
        generationId: row.id,
        projectId: input.projectUpdate.projectId,
        proposed: input.projectUpdate.proposed,
        baseState: input.projectUpdate.baseState,
      });
    }

    if (input.replan !== undefined && input.replan !== null) {
      // Un projet ne porte qu'une proposition en attente. Le controle vit dans
      // cette transaction : deux tours conclus au meme instant ne peuvent pas en
      // produire deux, et la seconde est refusee plutot que d'ecraser la
      // premiere en silence.
      const pending = await tx.architectReplanProposal.count({
        where: {
          projectId: input.replan.projectId,
          status: REPLAN_PROPOSAL_STATUS.PENDING,
        },
      });
      if (pending === 0) {
        await tx.architectReplanProposal.create({
          data: {
            generationId: row.id,
            projectId: input.replan.projectId,
            projectUpdateId,
            status: REPLAN_PROPOSAL_STATUS.PENDING,
            rationale: input.replan.proposal.rationale,
            targetCount: input.replan.proposal.futureTasks.length,
            newCount: input.replan.proposal.futureTasks.filter(
              (task) => task.tempId !== null,
            ).length,
            providerJson: JSON.stringify(input.replan.proposal),
            baseBriefRevision: input.replan.baseState.briefRevision,
            basePlanRevision: input.replan.baseState.planRevision,
            planningFingerprint: input.replan.planningFingerprint,
          },
        });
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
 * Proposition a partir de laquelle une tache peut encore etre creee.
 *
 * ## Ce qui n'a pas change
 *
 * La derniere proposition doit encore etre celle dont parle la conversation.
 * Elle ne l'est plus des qu'un tour lui a succede : l'utilisateur a ecrit
 * quelque chose apres l'avoir lue, et l'architecte lui a repondu. Creer la tache
 * a partir d'une proposition que la discussion a deja depassee produirait
 * exactement ce que l'utilisateur venait de demander de changer.
 *
 * ## Ce qui change en TASK-020
 *
 * Ou se lit « deja utilisee ». Une session historique valait une tache : sa
 * propre \`appliedTaskId\` suffisait. Une conversation projet en cree plusieurs au
 * fil du temps, et c'est la **generation** qui ne doit pas en creer deux.
 *
 * L'invariant tient en deux lignes :
 *
 * - une conversation projet → plusieurs taches, au fil du temps ;
 * - une proposition → une tache, jamais deux.
 */
export function creatableArchitectProposal(
  session: ArchitectSessionView,
): ArchitectGenerationView | null {
  const proposal = latestArchitectProposal(session);
  if (proposal === null) {
    return null;
  }

  if (session.kind === ARCHITECT_SESSION_KIND.PROJECT) {
    if (proposal.appliedTaskId !== null) {
      return null;
    }
  } else if (
    session.status === ARCHITECT_SESSION_STATUS.APPLIED ||
    session.appliedTaskId !== null
  ) {
    return null;
  }

  const lastTurn = session.generations.find((generation) =>
    TURN_STATUSES.includes(generation.status),
  );
  return lastTurn !== undefined && lastTurn.id === proposal.id ? proposal : null;
}

/** Une tache peut-elle encore etre creee depuis cette conversation ? */
export function canCreateArchitectTask(session: ArchitectSessionView): boolean {
  return creatableArchitectProposal(session) !== null;
}

export type ClaimArchitectGenerationResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_applied" | "not_ready" };

/**
 * Reserve le droit de creer la tache d'une **proposition**.
 *
 * Le pendant de \`claimArchitectSession\` pour une conversation projet, et pour
 * la meme raison : reserver avant de creer, jamais l'inverse. Un double clic
 * produirait sinon deux taches, dont une seule serait rattachee.
 *
 * La reservation est une mise a jour conditionnelle — proposition rendue, pas
 * encore de tache —, donc atomique. Le second appel obtient 0 et repart avec
 * \`already_applied\`, sans avoir rien cree.
 *
 * \`appliedTaskId\` reste \`null\` a ce stade : la tache n'existe pas encore. Une
 * colonne dediee marque la reservation, pour la meme raison que le statut
 * \`APPLIED\` d'une session historique — il faut pouvoir distinguer « reservee »
 * de « creee », et rendre la main si la creation echoue.
 */
export async function claimArchitectGeneration(
  db: DatabaseClient,
  generationId: string,
): Promise<ClaimArchitectGenerationResult> {
  return db.$transaction(async (tx): Promise<ClaimArchitectGenerationResult> => {
    const generation = await tx.architectGeneration.findUnique({
      where: { id: generationId },
      select: { id: true, status: true, appliedTaskId: true, taskClaimedAt: true },
    });
    if (generation === null) {
      return { ok: false, reason: "not_found" };
    }
    if (generation.appliedTaskId !== null || generation.taskClaimedAt !== null) {
      return { ok: false, reason: "already_applied" };
    }
    if (generation.status !== ARCHITECT_GENERATION_STATUS.PROPOSAL_READY) {
      return { ok: false, reason: "not_ready" };
    }

    const claimed = await tx.architectGeneration.updateMany({
      where: {
        id: generationId,
        status: ARCHITECT_GENERATION_STATUS.PROPOSAL_READY,
        appliedTaskId: null,
        taskClaimedAt: null,
      },
      data: { taskClaimedAt: new Date() },
    });

    return claimed.count === 1 ? { ok: true } : { ok: false, reason: "already_applied" };
  });
}

/** Rattache la tache creee a la proposition qui l'a produite. */
export async function attachArchitectGenerationTask(
  db: DatabaseClient,
  generationId: string,
  taskId: string,
): Promise<boolean> {
  const updated = await db.architectGeneration.updateMany({
    where: { id: generationId, appliedTaskId: null },
    data: { appliedTaskId: taskId },
  });
  return updated.count === 1;
}

/**
 * Rend la main apres une creation qui n'a pas abouti.
 *
 * Le \`where\` exige \`appliedTaskId: null\` : une proposition dont la tache existe
 * vraiment n'est jamais rouverte, quelle que soit la suite des evenements.
 */
export async function releaseArchitectGeneration(
  db: DatabaseClient,
  generationId: string,
): Promise<boolean> {
  const released = await db.architectGeneration.updateMany({
    where: { id: generationId, appliedTaskId: null },
    data: { taskClaimedAt: null },
  });
  return released.count === 1;
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

// --- Arret d'un tour en vol ------------------------------------------------

/** Ce qu'un arret a effectivement trouve. */
export type CancelArchitectGenerationResult =
  | { ok: true; generation: ArchitectGenerationView }
  /** Aucune generation `RUNNING` : jamais commencee, ou deja conclue. */
  | { ok: false; reason: "not_running" }
  | { ok: false; reason: "not_found" };

/**
 * Conclut le tour en vol d'une session comme `CANCELLED`.
 *
 * ## Pourquoi la base est servie avant le reseau
 *
 * L'ordre est : conclure la ligne, **puis** abandonner la requete. L'inverse
 * laisserait une fenetre ou la reponse du fournisseur arriverait entre
 * l'abandon et l'ecriture, et serait acceptee — c'est-a-dire exactement la
 * course que l'arret existe pour fermer.
 *
 * Ici, la mise a jour conditionnelle sur `RUNNING` tranche seule : soit l'arret
 * l'obtient et le tour est arrete, soit la conclusion normale l'a devance et le
 * tour a abouti. Il n'existe pas de troisieme issue, et aucun des deux chemins
 * n'a besoin de connaitre l'autre.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il n'ecrit aucun message. Un tour arrete n'a pas eu lieu : inscrire une
 * fausse reponse d'architecte raconterait un echange qui n'existe pas. Et le
 * brouillon est **conserve** — `CLEAR_PENDING_TURN` n'est pas applique — pour
 * la meme raison qu'apres un echec : l'utilisateur ne doit pas perdre son texte
 * parce qu'il a repris la main.
 *
 * Idempotent : un second arret rend `not_running` et n'ecrit rien.
 */
export async function cancelArchitectGeneration(
  db: DatabaseClient,
  input: { sessionId: string },
): Promise<CancelArchitectGenerationResult> {
  return db.$transaction(async (tx): Promise<CancelArchitectGenerationResult> => {
    const session = await tx.architectSession.findUnique({
      where: { id: input.sessionId },
      select: { id: true },
    });
    if (session === null) {
      return { ok: false, reason: "not_found" };
    }

    const running = await tx.architectGeneration.findFirst({
      where: { sessionId: input.sessionId, status: ARCHITECT_GENERATION_STATUS.RUNNING },
      orderBy: { sequence: "desc" },
    });
    if (running === null) {
      return { ok: false, reason: "not_running" };
    }

    const claimed = await tx.architectGeneration.updateMany({
      where: { id: running.id, status: ARCHITECT_GENERATION_STATUS.RUNNING },
      data: {
        status: ARCHITECT_GENERATION_STATUS.CANCELLED,
        errorCode: ARCHITECT_ERROR.ARCHITECT_CANCELLED,
        finishedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      // La conclusion normale a gagne la course, au millieme pres. Le tour a
      // donc abouti, et l'arret n'a rien a defaire.
      return { ok: false, reason: "not_running" };
    }

    // Le verrou de session est rendu, sans quoi la conversation resterait
    // `GENERATING` pour toujours : c'est elle qui le porte.
    await tx.architectSession.updateMany({
      where: { id: input.sessionId, status: { not: ARCHITECT_SESSION_STATUS.APPLIED } },
      data: { status: ARCHITECT_SESSION_STATUS.CONTINUE },
    });

    const row = await tx.architectGeneration.findUnique({ where: { id: running.id } });
    return row === null
      ? { ok: false, reason: "not_found" }
      : { ok: true, generation: toGeneration(row) };
  });
}

/** Le tour en vol d'une session, pour l'affichage du temps ecoule. */
export type ActiveArchitectGeneration = {
  id: string;
  sequence: number;
  /** Instant de reservation, autorite du chronometre affiche. */
  startedAt: string;
};

/**
 * La generation `RUNNING` d'une session, s'il y en a une.
 *
 * Volontairement pauvre : un identifiant, un numero, un instant. Ni modele, ni
 * empreinte, ni manifest, ni contenu — cette lecture alimente un compteur de
 * secondes, et rien de plus n'a a traverser jusqu'au navigateur.
 */
export async function getActiveArchitectGeneration(
  db: DatabaseClient,
  sessionId: string,
): Promise<ActiveArchitectGeneration | null> {
  const row = await db.architectGeneration.findFirst({
    where: { sessionId, status: ARCHITECT_GENERATION_STATUS.RUNNING },
    orderBy: { sequence: "desc" },
    select: { id: true, sequence: true, createdAt: true },
  });
  return row === null
    ? null
    : { id: row.id, sequence: row.sequence, startedAt: row.createdAt.toISOString() };
}
