/**
 * Orchestration d'un tour de conversation Architecte, cote serveur.
 *
 * ## Deux clics, et pourquoi
 *
 * ```text
 * Review context           ← aucun appel au fournisseur
 *        ↓
 * contexte lu, empreinte calculee, brouillon enregistre
 *        ↓
 * Send to Architect        ← un clic, un appel
 *        ↓
 * contexte relu et recompare   ← la page ne suffit pas
 *        ↓
 * generation reservee          ← le verrou : un tour a la fois
 *        ↓
 * appel au fournisseur
 *        ↓
 * validation NOX de la reponse
 *        ↓
 * messages figes, brouillon efface   ← dans la meme transaction
 * ```
 *
 * Le second controle du contexte n'est pas une redondance. Entre l'affichage de
 * la preview et le clic, un fichier a pu etre enregistre — c'est meme le cas
 * courant quand on travaille en parallele sur le projet. Sans cette relecture,
 * l'utilisateur aurait valide un contexte et envoye un autre.
 *
 * ## Aucun appel automatique
 *
 * Rien ici n'est declenche par un rendu de page, un changement de champ, un
 * minuteur ou un echec precedent. `sendArchitectTurn` n'est appelee que depuis
 * une Server Action, elle-meme declenchee par un clic.
 */

import {
  ARCHITECT_ERROR,
  ARCHITECT_GENERATION_STATUS,
  ARCHITECT_MESSAGE_ROLE,
  ARCHITECT_SCHEMA_NAME,
  ARCHITECT_TURN_STATE,
  buildArchitectTurnSchema,
  readArchitectTurn,
  type ArchitectContextManifest,
  type ArchitectErrorCode,
  type ArchitectTurn,
  type DevelopmentTaskDetail,
  type ProjectDocumentSummary,
  type ProjectMemoryEntry,
} from "@nox/shared";
import {
  finishArchitectGeneration,
  saveArchitectTurnDraft,
  startArchitectGeneration,
  type ArchitectGenerationView,
  type ArchitectSessionView,
  type DatabaseClient,
} from "@nox/database";

import { listProjectDocuments, readProjectDocument } from "../runner/client.ts";
import { describeRunnerFailure, type RunnerFailure } from "../runner/errors.ts";
import { ARCHITECT_DOCUMENT_ALLOWLIST, type FetchedArchitectDocument } from "./context.ts";
import { diffArchitectManifests, type ArchitectContextChange } from "./context-diff.ts";
import { ARCHITECT_REQUEST_TIMEOUT_MS } from "./config.ts";
import { prepareArchitectGeneration, type PreparedArchitectGeneration } from "./prepare.ts";
import type { ArchitectProvider } from "./provider.ts";
import { architectTranscript } from "./transcript.ts";

/**
 * Acces au repository, injectes plutot qu'importes.
 *
 * Les tests rejouent ainsi chaque scenario — runner arrete, document absent,
 * document modifie entre deux tours — sans demarrer ni runner, ni repository.
 */
export type ArchitectRepositoryPorts = {
  listDocuments: (
    repositoryPath: string,
  ) => Promise<{ ok: true; value: ProjectDocumentSummary[] } | { ok: false; failure: RunnerFailure }>;
  readDocument: (
    repositoryPath: string,
    documentPath: string,
  ) => Promise<
    { ok: true; value: { path: string; content: string; revision: string } } | { ok: false; failure: RunnerFailure }
  >;
};

/** Ports de production : le client runner, sans intermediaire. */
export const runnerArchitectPorts: ArchitectRepositoryPorts = {
  listDocuments: (repositoryPath) => listProjectDocuments(repositoryPath),
  readDocument: (repositoryPath, documentPath) => readProjectDocument(repositoryPath, documentPath),
};

export type FetchedRepositoryContext = {
  documents: FetchedArchitectDocument[];
  inventory: ProjectDocumentSummary[];
};

export type FetchContextResult =
  | { ok: true; context: FetchedRepositoryContext }
  | { ok: false; message: string };

/**
 * Lit l'inventaire du repository, puis les documents de la liste fermee.
 *
 * L'inventaire d'abord : il dit quels documents existent, ce qui evite autant
 * d'appels voues a echouer que de fichiers absents. Un document present dans
 * l'inventaire mais illisible est traite comme absent — c'est moins de contexte,
 * jamais une erreur bloquante.
 *
 * Seul l'inventaire lui-meme est bloquant : sans lui, NOX ne sait pas ce qu'il
 * enverrait, et preparer un contexte a l'aveugle serait pire que de refuser.
 */
export async function fetchArchitectContext(
  repositoryPath: string,
  ports: ArchitectRepositoryPorts,
): Promise<FetchContextResult> {
  const inventory = await ports.listDocuments(repositoryPath);
  if (!inventory.ok) {
    return { ok: false, message: describeRunnerFailure(inventory.failure) };
  }

  const present = new Set(inventory.value.map((entry) => entry.path));
  const documents: FetchedArchitectDocument[] = [];

  for (const path of ARCHITECT_DOCUMENT_ALLOWLIST) {
    if (!present.has(path)) {
      continue;
    }
    const document = await ports.readDocument(repositoryPath, path);
    if (document.ok) {
      documents.push({
        path,
        revision: document.value.revision,
        content: document.value.content,
      });
    }
  }

  return { ok: true, context: { documents, inventory: inventory.value } };
}

export type TurnInput = {
  session: ArchitectSessionView;
  projectName: string;
  repositoryPath: string;
  /** Message que l'utilisateur vient d'ecrire. */
  message: string;
  tasks: readonly DevelopmentTaskDetail[];
  /**
   * Memoire active du projet, relue en base a chaque tour.
   *
   * Relue, et non figee a l'ouverture de la conversation : une entree archivee
   * entre deux tours doit disparaitre du contexte, et une entree ajoutee doit y
   * entrer. C'est exactement le traitement reserve aux documents.
   */
  memories: readonly ProjectMemoryEntry[];
  model: string;
  environment: Record<string, string | undefined>;
  ports?: ArchitectRepositoryPorts;
};

export type PreparedTurn = {
  prepared: PreparedArchitectGeneration;
  /** Manifest du dernier tour, ou `null` si c'est le premier. */
  previousManifest: ArchitectContextManifest | null;
  /** Faits surs depuis le dernier tour. Vide quand rien n'a bouge. */
  changes: ArchitectContextChange[];
  /** Faux au premier tour : il n'y a rien a comparer. */
  comparable: boolean;
};

export type PrepareTurnResult =
  | { ok: true; turn: PreparedTurn }
  | { ok: false; code: ArchitectErrorCode }
  | { ok: false; message: string };

/**
 * Dernier tour ayant reellement produit un contexte comparable.
 *
 * Les generations en echec sont ecartees : leur manifest decrit un contexte qui
 * n'a jamais donne de reponse, et le comparer ferait annoncer un changement la
 * ou l'utilisateur n'a rien vu.
 */
function lastComparableGeneration(session: ArchitectSessionView): ArchitectGenerationView | null {
  return (
    session.generations.find(
      (generation) =>
        generation.manifest !== null &&
        (generation.status === ARCHITECT_GENERATION_STATUS.PROPOSAL_READY ||
          generation.status === ARCHITECT_GENERATION_STATUS.CONTINUE ||
          generation.status === ARCHITECT_GENERATION_STATUS.NEEDS_INPUT),
    ) ?? null
  );
}

/**
 * Construit le contexte d'un tour, sans rien envoyer.
 *
 * Appelee par `Review context` **et** par `Send to Architect` : les deux voient
 * donc exactement le meme contexte, calcule par le meme code. Afficher une
 * preview construite autrement reviendrait a mentir a l'utilisateur sur ce qui
 * part.
 */
export async function prepareArchitectTurn(input: TurnInput): Promise<PrepareTurnResult> {
  const fetched = await fetchArchitectContext(
    input.repositoryPath,
    input.ports ?? runnerArchitectPorts,
  );
  if (!fetched.ok) {
    return fetched;
  }

  const prepared = prepareArchitectGeneration({
    projectName: input.projectName,
    repositoryPath: input.repositoryPath,
    documents: fetched.context.documents,
    inventory: fetched.context.inventory,
    tasks: input.tasks,
    memories: input.memories,
    transcript: architectTranscript(input.session),
    newMessage: input.message,
    model: input.model,
    environment: input.environment,
  });

  if (prepared.transcriptTooLarge) {
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_CONVERSATION_TOO_LARGE };
  }

  const previous = lastComparableGeneration(input.session);
  const previousManifest = previous?.manifest ?? null;

  return {
    ok: true,
    turn: {
      prepared,
      previousManifest,
      changes:
        previousManifest === null
          ? []
          : diffArchitectManifests(previousManifest, prepared.manifest),
      comparable: previousManifest !== null,
    },
  };
}

/**
 * Prepare un tour et enregistre son brouillon.
 *
 * Le brouillon est ecrit en base pour que l'apercu et l'envoi parlent du **meme**
 * message : recopie dans un champ cache du formulaire, il pourrait etre modifie
 * entre les deux, et la preview aurait decrit autre chose que ce qui part.
 */
export async function reviewArchitectTurn(
  db: DatabaseClient,
  input: TurnInput,
): Promise<PrepareTurnResult> {
  const prepared = await prepareArchitectTurn(input);
  if (!prepared.ok) {
    return prepared;
  }

  const saved = await saveArchitectTurnDraft(db, {
    sessionId: input.session.id,
    messageText: input.message,
    contextFingerprint: prepared.turn.prepared.contextFingerprint,
    manifest: prepared.turn.prepared.manifest,
  });
  if (!saved) {
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_GENERATION_ACTIVE };
  }

  return prepared;
}

export type SendTurnOutcome =
  | { ok: true; generation: ArchitectGenerationView; turn: ArchitectTurn }
  | { ok: false; code: ArchitectErrorCode }
  | { ok: false; message: string };

/** Traduit un refus de reservation en code stable. */
function reservationCode(
  reason: "not_found" | "already_applied" | "active" | "limit" | "legacy" | "no_draft" | "changed",
): ArchitectErrorCode {
  switch (reason) {
    case "already_applied":
      return ARCHITECT_ERROR.ARCHITECT_ALREADY_APPLIED;
    case "active":
      return ARCHITECT_ERROR.ARCHITECT_GENERATION_ACTIVE;
    case "limit":
      return ARCHITECT_ERROR.ARCHITECT_GENERATION_LIMIT;
    case "legacy":
      return ARCHITECT_ERROR.ARCHITECT_SESSION_LEGACY;
    case "no_draft":
      return ARCHITECT_ERROR.ARCHITECT_NO_PENDING_TURN;
    case "changed":
      return ARCHITECT_ERROR.ARCHITECT_CONTEXT_CHANGED;
    default:
      return ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR;
  }
}

export type SendTurnInput = Omit<TurnInput, "message"> & {
  provider: ArchitectProvider;
};

/**
 * Envoie le tour prepare.
 *
 * Ne leve jamais : toute panne devient un code, et la generation reservee est
 * conclue en base dans **tous** les cas. Une generation laissee `RUNNING`
 * bloquerait la conversation pour toujours, puisque c'est elle qui porte le
 * verrou.
 *
 * Le message de l'utilisateur vient du brouillon relu en base, jamais du
 * formulaire : c'est ce qui garantit qu'on envoie le texte qui a ete
 * prévisualisé, et qu'un rafraichissement apres reponse ne reemet rien.
 */
export async function sendArchitectTurn(
  db: DatabaseClient,
  input: SendTurnInput,
): Promise<SendTurnOutcome> {
  const pending = input.session.pendingTurn;
  if (pending === null) {
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_NO_PENDING_TURN };
  }

  // Le contexte est reconstruit maintenant, et non repris de la preview : entre
  // l'affichage et le clic, un fichier a pu etre enregistre.
  const prepared = await prepareArchitectTurn({ ...input, message: pending.messageText });
  if (!prepared.ok) {
    return prepared;
  }

  if (prepared.turn.prepared.contextFingerprint !== pending.contextFingerprint) {
    // Aucun appel, aucune generation reservee, aucun quota consomme. Le
    // brouillon reste : l'utilisateur relit le contexte mis a jour et renvoie.
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_CONTEXT_CHANGED };
  }

  const reserved = await startArchitectGeneration(db, {
    sessionId: input.session.id,
    model: input.model,
    promptVersion: prepared.turn.prepared.prompt.version,
    inputHash: prepared.turn.prepared.inputHash,
    contextFingerprint: prepared.turn.prepared.contextFingerprint,
    manifest: prepared.turn.prepared.manifest,
    // Second controle, dans la transaction : deux clics simultanes ne peuvent
    // pas tous deux trouver le brouillon intact.
    expectedFingerprint: pending.contextFingerprint,
  });
  if (!reserved.ok) {
    return { ok: false, code: reservationCode(reserved.reason) };
  }

  const generationId = reserved.generation.id;

  /** Conclut le tour en echec, sans jamais laisser le verrou pose. */
  const fail = async (code: ArchitectErrorCode): Promise<SendTurnOutcome> => {
    await finishArchitectGeneration(db, {
      generationId,
      status:
        code === ARCHITECT_ERROR.ARCHITECT_REFUSED
          ? ARCHITECT_GENERATION_STATUS.REFUSED
          : ARCHITECT_GENERATION_STATUS.FAILED,
      errorCode: code,
      // Aucun message : le tour n'a pas eu lieu. Le brouillon survit, et la
      // conversation ne montre ni question restee sans reponse, ni fausse
      // reponse d'architecte.
    });
    return { ok: false, code };
  };

  let result;
  try {
    result = await input.provider.generateTaskTurn({
      model: input.model,
      instructions: prepared.turn.prepared.prompt.instructions,
      input: prepared.turn.prepared.prompt.input,
      schemaName: ARCHITECT_SCHEMA_NAME,
      schema: buildArchitectTurnSchema(),
      timeoutMs: ARCHITECT_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    // Une exception inattendue du fournisseur ne doit pas remonter telle quelle :
    // elle porterait son URL et ses en-tetes.
    console.error("[nox] Echec inattendu du fournisseur Architecte :", error);
    return fail(ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR);
  }

  if (!result.ok) {
    return fail(result.code);
  }

  const validated = readArchitectTurn(result.value.raw, prepared.turn.prepared.availableDocuments);
  if (!validated.ok) {
    // La reponse respectait le schema strict et reste inacceptable : c'est
    // exactement le cas que la validation metier existe pour attraper.
    console.error(
      "[nox] Tour Architecte refuse :",
      validated.refusal.field,
      validated.refusal.message,
    );
    await finishArchitectGeneration(db, {
      generationId,
      status: ARCHITECT_GENERATION_STATUS.FAILED,
      providerResponseId: result.value.responseId,
      usage: result.value.usage,
      errorCode: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
    });
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID };
  }

  const turn = validated.turn;
  const ready = turn.state === ARCHITECT_TURN_STATE.PROPOSAL_READY;

  const generation = await finishArchitectGeneration(db, {
    generationId,
    status: ready
      ? ARCHITECT_GENERATION_STATUS.PROPOSAL_READY
      : ARCHITECT_GENERATION_STATUS.CONTINUE,
    turnState: turn.state,
    proposal: turn.proposal,
    questions: turn.questions,
    providerResponseId: result.value.responseId,
    usage: result.value.usage,
    // Le tour a abouti : les deux messages deviennent historiques, et le
    // brouillon disparait dans la meme transaction.
    messages: [
      { role: ARCHITECT_MESSAGE_ROLE.USER, content: pending.messageText },
      { role: ARCHITECT_MESSAGE_ROLE.ARCHITECT, content: turn.message },
    ],
  });

  if (generation === null) {
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR };
  }

  return { ok: true, generation, turn };
}
