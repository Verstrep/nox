/**
 * Orchestration d'une generation Architecte, cote serveur.
 *
 * ## L'ordre des operations, et pourquoi
 *
 * ```text
 * documents lus par le runner
 *        ↓
 * contexte assemble et nettoye
 *        ↓
 * generation reservee en base   ← le verrou : une seule a la fois
 *        ↓
 * appel au fournisseur
 *        ↓
 * validation NOX de la reponse
 *        ↓
 * generation conclue en base
 * ```
 *
 * La reservation precede l'appel : sans elle, deux clics simultanes
 * consommeraient deux generations et deux facturations. Elle le precede de peu —
 * la lecture des documents, qui peut echouer, a lieu avant, pour qu'un runner
 * arrete ne consomme jamais une generation.
 *
 * ## Aucun appel automatique
 *
 * Rien ici n'est declenche par un rendu de page, un changement de champ, un
 * minuteur ou un echec precedent. `runArchitectGeneration` n'est appelee que
 * depuis une Server Action, elle-meme declenchee par un clic.
 */

import {
  ARCHITECT_ERROR,
  ARCHITECT_GENERATION_STATUS,
  ARCHITECT_PROPOSAL_STATUS,
  ARCHITECT_SCHEMA_NAME,
  buildArchitectProposalSchema,
  readArchitectProposal,
  type ArchitectErrorCode,
  type ArchitectTaskProposal,
  type DevelopmentTaskDetail,
  type ProjectDocumentSummary,
} from "@nox/shared";
import {
  finishArchitectGeneration,
  startArchitectGeneration,
  type ArchitectGenerationView,
  type DatabaseClient,
} from "@nox/database";

import { listProjectDocuments, readProjectDocument } from "../runner/client.ts";
import { describeRunnerFailure, type RunnerFailure } from "../runner/errors.ts";
import { ARCHITECT_DOCUMENT_ALLOWLIST, type FetchedArchitectDocument } from "./context.ts";
import { ARCHITECT_REQUEST_TIMEOUT_MS } from "./config.ts";
import { prepareArchitectGeneration, type PreparedArchitectGeneration } from "./prepare.ts";
import type { ArchitectProvider } from "./provider.ts";

/**
 * Acces au repository, injectes plutot qu'importes.
 *
 * Les tests rejouent ainsi chaque scenario — runner arrete, document absent,
 * document enorme — sans demarrer ni runner, ni repository.
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

export type GenerationInput = {
  sessionId: string;
  projectName: string;
  repositoryPath: string;
  request: string;
  clarification: string | null;
  previousQuestions: readonly string[];
  tasks: readonly DevelopmentTaskDetail[];
  model: string;
  provider: ArchitectProvider;
  environment: Record<string, string | undefined>;
  ports?: ArchitectRepositoryPorts;
};

export type GenerationOutcome =
  | { ok: true; generation: ArchitectGenerationView; proposal: ArchitectTaskProposal }
  | { ok: false; code: ArchitectErrorCode }
  | { ok: false; message: string };

/** Traduit un refus de reservation en code stable. */
function reservationCode(reason: "not_found" | "already_applied" | "active" | "limit"): ArchitectErrorCode {
  switch (reason) {
    case "already_applied":
      return ARCHITECT_ERROR.ARCHITECT_ALREADY_APPLIED;
    case "active":
      return ARCHITECT_ERROR.ARCHITECT_GENERATION_ACTIVE;
    case "limit":
      return ARCHITECT_ERROR.ARCHITECT_GENERATION_LIMIT;
    default:
      return ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR;
  }
}

/**
 * Prepare le contexte d'une session sans rien envoyer.
 *
 * Appelee par la page de preparation **et** par la generation : les deux voient
 * donc exactement le meme contexte, calcule par le meme code. Afficher une
 * preview construite autrement mentirait a l'utilisateur sur ce qui part.
 */
export async function prepareArchitectContext(
  input: Omit<GenerationInput, "provider" | "sessionId">,
): Promise<{ ok: true; prepared: PreparedArchitectGeneration } | { ok: false; message: string }> {
  const fetched = await fetchArchitectContext(
    input.repositoryPath,
    input.ports ?? runnerArchitectPorts,
  );
  if (!fetched.ok) {
    return fetched;
  }

  return {
    ok: true,
    prepared: prepareArchitectGeneration({
      projectName: input.projectName,
      repositoryPath: input.repositoryPath,
      documents: fetched.context.documents,
      inventory: fetched.context.inventory,
      tasks: input.tasks,
      request: input.request,
      previousQuestions: input.previousQuestions,
      clarification: input.clarification,
      model: input.model,
      environment: input.environment,
    }),
  };
}

/**
 * Execute une generation complete.
 *
 * Ne leve jamais : toute panne devient un code, et la generation reservee est
 * conclue en base dans **tous** les cas. Une generation laissee `RUNNING`
 * bloquerait la session pour toujours, puisque c'est elle qui porte le verrou.
 */
export async function runArchitectGeneration(
  db: DatabaseClient,
  input: GenerationInput,
): Promise<GenerationOutcome> {
  const prepared = await prepareArchitectContext(input);
  if (!prepared.ok) {
    // Le contexte n'a pas pu etre lu : aucune generation n'est reservee, aucun
    // appel n'est fait, et la session reste exactement dans l'etat ou elle etait.
    return { ok: false, message: prepared.message };
  }

  const reserved = await startArchitectGeneration(db, {
    sessionId: input.sessionId,
    model: input.model,
    promptVersion: prepared.prepared.prompt.version,
    inputHash: prepared.prepared.inputHash,
    manifest: prepared.prepared.manifest,
  });
  if (!reserved.ok) {
    return { ok: false, code: reservationCode(reserved.reason) };
  }

  const generationId = reserved.generation.id;

  /** Conclut la generation en echec, sans jamais laisser le verrou pose. */
  const fail = async (code: ArchitectErrorCode): Promise<GenerationOutcome> => {
    await finishArchitectGeneration(db, {
      generationId,
      status:
        code === ARCHITECT_ERROR.ARCHITECT_REFUSED
          ? ARCHITECT_GENERATION_STATUS.REFUSED
          : ARCHITECT_GENERATION_STATUS.FAILED,
      errorCode: code,
    });
    return { ok: false, code };
  };

  let result;
  try {
    result = await input.provider.generateTaskProposal({
      model: input.model,
      instructions: prepared.prepared.prompt.instructions,
      input: prepared.prepared.prompt.input,
      schemaName: ARCHITECT_SCHEMA_NAME,
      schema: buildArchitectProposalSchema(),
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

  const validated = readArchitectProposal(result.value.raw, prepared.prepared.availableDocuments);
  if (!validated.ok) {
    // La reponse respectait le schema strict et reste inacceptable : c'est
    // exactement le cas que la validation metier existe pour attraper.
    console.error(
      "[nox] Proposition Architecte refusee :",
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

  const proposal = validated.proposal;
  const ready = proposal.status === ARCHITECT_PROPOSAL_STATUS.PROPOSAL_READY;

  const generation = await finishArchitectGeneration(db, {
    generationId,
    status: ready
      ? ARCHITECT_GENERATION_STATUS.PROPOSAL_READY
      : ARCHITECT_GENERATION_STATUS.NEEDS_INPUT,
    proposal,
    questions: proposal.questions,
    providerResponseId: result.value.responseId,
    usage: result.value.usage,
  });

  if (generation === null) {
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR };
  }

  return { ok: true, generation, proposal };
}
