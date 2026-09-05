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
  ARCHITECT_DIAGNOSTIC_FIELD,
  ARCHITECT_ERROR,
  ARCHITECT_GENERATION_STATUS,
  ARCHITECT_LIMITS,
  ARCHITECT_MESSAGE_ROLE,
  ARCHITECT_SCHEMA_NAME,
  ARCHITECT_TURN_STATE,
  REPLAN_MODE,
  buildArchitectTurnSchema,
  checkArchitectText,
  readArchitectTurn,
  type ArchitectContextManifest,
  type ArchitectErrorCode,
  type ArchitectProjectUpdateProposal,
  type ArchitectTextRefusal,
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
  type ProjectPlanTools,
  type ProjectStructuredState,
  type ProjectUpdateBase,
  type ReplanPlanningState,
} from "@nox/database";

import { listProjectDocuments, readProjectDocument } from "../runner/client.ts";
import { describeRunnerFailure, type RunnerFailure } from "../runner/errors.ts";
import { ARCHITECT_DOCUMENT_ALLOWLIST, type FetchedArchitectDocument } from "./context.ts";
import { diffArchitectManifests, type ArchitectContextChange } from "./context-diff.ts";
import { ARCHITECT_REQUEST_TIMEOUT_MS } from "./config.ts";
import {
  REPLAN_CONTEXT_ERROR,
  buildReplanPlanningContext,
  type ReplanPlanningBundle,
} from "../replan/planning-context.ts";
import { prepareArchitectGeneration, type PreparedArchitectGeneration } from "./prepare.ts";
import { checkProviderProjectUpdate } from "./project-update.ts";
import type { ArchitectProvider, ArchitectProviderDiagnostic } from "./provider.ts";
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
  /**
   * Etat structure du projet, relu en base a chaque tour.
   *
   * Relu, jamais fige : c'est ce qui garantit qu'un brief modifie a la main
   * entre deux messages part avec le message suivant. Il n'entre pas dans la
   * fenetre de transcript — un tour de conversation vieillit, l'intention
   * produit courante non.
   */
  structuredState: ProjectStructuredState;
  /** Projet auquel rattacher une eventuelle proposition de mise a jour. */
  projectId: string;
  /**
   * Nettoyeur et revisions de l'etat structure.
   *
   * Les memes que ceux qui ont produit `structuredState` : le budget d'une
   * proposition se mesure sur le texte qui partirait reellement, et deux
   * assemblages differents finiraient par accepter ce que l'autre refuse.
   */
  planTools: ProjectPlanTools;
  /**
   * Etat de planification du projet, relu en base a chaque tour.
   *
   * Relu, jamais fige : une tache inscrite en file entre deux messages doit
   * apparaitre verrouillee au tour suivant, et une tache terminee doit quitter
   * la liste des modifiables. C'est le meme traitement que la memoire et l'etat
   * structure.
   *
   * `null` pour une session de conception de tache : elle ne replanifie rien.
   */
  planningState: ReplanPlanningState | null;
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

  // Le plan de travail est construit **avant** la preparation, parce qu'il peut
  // refuser : un projet sans backlog initial n'est pas replanifiable, et un plan
  // qui ne tient pas dans son budget arrete le tour plutot que d'etre coupe.
  //
  // Un refus de disponibilite n'est pas une erreur : la conversation continue
  // sans section de plan, exactement comme avant TASK-032. Seul un depassement
  // de budget arrete le tour.
  let replan: ReplanPlanningBundle | null = null;
  if (input.planningState !== null) {
    const context = buildReplanPlanningContext({
      tasks: input.planningState.tasks,
      appliedBacklogCount: input.planningState.appliedBacklogCount,
      briefRevision: input.structuredState.brief.prompt?.revision ?? null,
      planRevision: input.structuredState.plan.prompt?.revision ?? null,
      sanitize: input.planTools.sanitize,
    });
    if (context.ok) {
      replan = context.bundle;
    } else if (context.code === REPLAN_CONTEXT_ERROR.CONTEXT_TOO_LARGE) {
      return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_CONTEXT_TOO_LARGE };
    }
  }

  const prepared = prepareArchitectGeneration({
    sessionKind: input.session.kind,
    replan,
    projectName: input.projectName,
    repositoryPath: input.repositoryPath,
    documents: fetched.context.documents,
    inventory: fetched.context.inventory,
    tasks: input.tasks,
    memories: input.memories,
    projectBrief: input.structuredState.brief.prompt,
    projectV1Plan: input.structuredState.plan.prompt,
    transcript: architectTranscript(input.session),
    newMessage: input.message,
    model: input.model,
    environment: input.environment,
  });

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
    // C'est l'empreinte de **tour** qui est enregistree, et non celle du seul
    // contexte projet : un message envoye depuis un second onglet doit rendre
    // cet apercu perime, alors qu'il ne change aucun document.
    contextFingerprint: prepared.turn.prepared.turnFingerprint,
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
  | { ok: false; message: string }
  /** Le texte saisi a ete refuse. Aucun appel, aucune generation reservee. */
  | { ok: false; refusal: ArchitectTextRefusal };

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
 * Envoie le tour prepare — parcours de conception de tache.
 *
 * Le message vient du brouillon relu en base, jamais du formulaire, et
 * l'empreinte enregistree a l'apercu doit encore correspondre. C'est le
 * parcours en deux clics de TASK-014, inchange.
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

  if (prepared.turn.prepared.turnFingerprint !== pending.contextFingerprint) {
    // Aucun appel, aucune generation reservee, aucun quota consomme. Le
    // brouillon reste : l'utilisateur relit le contexte mis a jour et renvoie.
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_CONTEXT_CHANGED };
  }

  return dispatchArchitectTurn(db, {
    session: input.session,
    prepared: prepared.turn.prepared,
    message: pending.messageText,
    model: input.model,
    provider: input.provider,
    expectedFingerprint: pending.contextFingerprint,
    projectId: input.projectId,
    structuredState: input.structuredState,
    planTools: input.planTools,
  });
}

export type SendMessageInput = TurnInput & {
  provider: ArchitectProvider;
  /**
   * Nombre de messages que le navigateur croyait deja echanges.
   *
   * **Indice, jamais autorite.** Il ne decrit pas le contexte et n'en porte
   * aucun fragment : il sert uniquement a detecter qu'un onglet reste ouvert sur
   * un etat depasse. Le serveur compare a ce qu'il lit en base, et refuse sans
   * appeler personne — repondre a une conversation qui a change entre-temps
   * produirait une branche silencieuse dont l'utilisateur ne verrait rien.
   */
  expectedMessageCount: number;
};

/**
 * Envoie un message directement — parcours de conversation projet.
 *
 * Un clic, un appel. Le contexte, le transcript, la memoire et les taches
 * recentes sont reconstruits **ici**, au moment de l'envoi : le navigateur
 * n'apporte que le texte du message et un compteur qui ne decide de rien.
 *
 * Aucune etape n'est contournee. La validation du texte, la fenetre de
 * transcript, les bornes, l'empreinte de tour, la reservation et l'appel sont
 * exactement ceux du parcours en deux clics — c'est la meme fonction qui les
 * execute. Ce qui disparait est l'obligation de **regarder** l'apercu, pas
 * l'apercu lui-meme.
 */
export async function sendArchitectMessage(
  db: DatabaseClient,
  input: SendMessageInput,
): Promise<SendTurnOutcome> {
  // 1. Le texte, avant tout le reste : un message vide ne doit rien couter, pas
  //    meme une lecture du repository.
  const refusal = checkArchitectText(input.message, ARCHITECT_LIMITS.request);
  if (refusal !== null) {
    return { ok: false, refusal };
  }

  // 2. L'onglet parle-t-il encore de la conversation courante ?
  if (input.expectedMessageCount !== input.session.messages.length) {
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_CONTEXT_CHANGED };
  }

  // 3. Le contexte courant, cote serveur.
  const prepared = await prepareArchitectTurn(input);
  if (!prepared.ok) {
    return prepared;
  }

  // 4. Le brouillon est le verrou : `saveArchitectTurnDraft` refuse pendant
  //    qu'une generation est en vol. C'est ce qui rend un double clic inoffensif
  //    sans qu'aucun second mecanisme soit invente.
  const saved = await saveArchitectTurnDraft(db, {
    sessionId: input.session.id,
    messageText: input.message,
    contextFingerprint: prepared.turn.prepared.turnFingerprint,
    manifest: prepared.turn.prepared.manifest,
  });
  if (!saved) {
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_GENERATION_ACTIVE };
  }

  return dispatchArchitectTurn(db, {
    session: input.session,
    prepared: prepared.turn.prepared,
    message: input.message,
    model: input.model,
    provider: input.provider,
    expectedFingerprint: prepared.turn.prepared.turnFingerprint,
    projectId: input.projectId,
    structuredState: input.structuredState,
    planTools: input.planTools,
  });
}

type DispatchInput = {
  session: ArchitectSessionView;
  prepared: PreparedArchitectGeneration;
  message: string;
  model: string;
  provider: ArchitectProvider;
  expectedFingerprint: string;
  projectId: string;
  /** Etat structure courant, pour revalider une proposition avant de l'ecrire. */
  structuredState: ProjectStructuredState;
  planTools: ProjectPlanTools;
};

/**
 * Reserve, appelle, enregistre.
 *
 * **Le seul endroit d'ou un appel au fournisseur peut partir.** Les deux
 * parcours — apercu puis envoi, ou envoi direct — s'y rejoignent : il n'existe
 * donc qu'une implementation de la reservation, de la conclusion et de
 * l'ecriture des messages, et aucune ne peut deriver de l'autre.
 *
 * Ne leve jamais : toute panne devient un code, et la generation reservee est
 * conclue en base dans **tous** les cas. Une generation laissee `RUNNING`
 * bloquerait la conversation pour toujours, puisque c'est elle qui porte le
 * verrou.
 */
async function dispatchArchitectTurn(
  db: DatabaseClient,
  input: DispatchInput,
): Promise<SendTurnOutcome> {
  const reserved = await startArchitectGeneration(db, {
    sessionId: input.session.id,
    model: input.model,
    promptVersion: input.prepared.prompt.version,
    inputHash: input.prepared.inputHash,
    contextFingerprint: input.prepared.contextFingerprint,
    manifest: input.prepared.manifest,
    // Second controle, dans la transaction : deux clics simultanes ne peuvent
    // pas tous deux trouver le brouillon intact.
    expectedFingerprint: input.expectedFingerprint,
  });
  if (!reserved.ok) {
    return { ok: false, code: reservationCode(reserved.reason) };
  }

  const generationId = reserved.generation.id;

  /** Conclut le tour en echec, sans jamais laisser le verrou pose. */
  const fail = async (
    code: ArchitectErrorCode,
    diagnostic?: ArchitectProviderDiagnostic,
  ): Promise<SendTurnOutcome> => {
    await finishArchitectGeneration(db, {
      generationId,
      status:
        code === ARCHITECT_ERROR.ARCHITECT_REFUSED
          ? ARCHITECT_GENERATION_STATUS.REFUSED
          : ARCHITECT_GENERATION_STATUS.FAILED,
      errorCode: code,
      // Present uniquement quand une reponse a ete recue et refusee : une panne
      // de transport n'a aucun champ fautif, et en inventer un ferait chercher
      // une erreur de contrat la ou le reseau a laché.
      errorField: diagnostic?.field ?? null,
      errorDetail: diagnostic?.message ?? null,
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
      instructions: input.prepared.prompt.instructions,
      input: input.prepared.prompt.input,
      schemaName: ARCHITECT_SCHEMA_NAME,
      schema: buildArchitectTurnSchema(input.prepared.turnSchemaVersion),
      timeoutMs: ARCHITECT_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    // Une exception inattendue du fournisseur ne doit pas remonter telle quelle :
    // elle porterait son URL et ses en-tetes.
    console.error("[nox] Echec inattendu du fournisseur Architecte :", error);
    return fail(ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR);
  }

  if (!result.ok) {
    return fail(result.code, result.diagnostic);
  }

  const validated = readArchitectTurn(
    result.value.raw,
    input.prepared.availableDocuments,
    input.prepared.turnSchemaVersion,
    // L'etat source du replan vient de la **preparation** du tour, jamais d'une
    // relecture faite ici : l'utilisateur peut avoir inscrit une tache en file
    // pendant que l'appel etait en vol, et la proposition serait alors validee
    // contre un etat que le fournisseur n'a jamais vu.
    input.prepared.replan?.source ?? null,
  );
  if (!validated.ok) {
    // La reponse respectait le schema strict et reste inacceptable : c'est
    // exactement le cas que la validation metier existe pour attraper.
    //
    // Ce que le validateur sait est desormais **enregistre**, comme pour la
    // planification depuis HOTFIX-001. Sans cela, relancer un tour etait le
    // seul moyen d'apprendre ce que NOX savait deja — c'est-a-dire de payer un
    // second appel pour lire un diagnostic qui existait avant le premier.
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
      errorField: validated.refusal.field,
      errorDetail: validated.refusal.message,
    });
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID };
  }

  const turn = validated.turn;
  const ready = turn.state === ARCHITECT_TURN_STATE.PROPOSAL_READY;

  // La mise a jour du projet est revalidee contre l'etat **courant** avant
  // d'etre ecrite. Une proposition hors bornes n'est pas persistee : elle
  // offrirait un bouton condamne a echouer. Le tour entier devient alors une
  // sortie invalide, comme n'importe quelle reponse inexploitable.
  let projectUpdate: {
    projectId: string;
    proposed: ArchitectProjectUpdateProposal;
    baseState: ProjectUpdateBase;
  } | null = null;

  if (turn.projectUpdate !== null) {
    const check = checkProviderProjectUpdate(
      input.structuredState,
      turn.projectUpdate,
      input.planTools,
    );
    if (!check.ok) {
      console.error("[nox] Mise a jour de projet refusee :", check.reason);

      // Un depassement de budget n'est **pas** une violation de contrat. La
      // reponse etait bien formee ; elle demandait a ecrire plus que ce que NOX
      // accepte de stocker. Le presenter comme une erreur de format envoyait
      // chercher au mauvais endroit, et relancer n'y changeait rien : le refus
      // est deterministe, et c'est la demande qu'il faut raccourcir.
      //
      // C'est le cas que le second pilote reel a rencontre deux fois de suite.
      const budget = check.reason === "budget";
      const code = budget
        ? ARCHITECT_ERROR.ARCHITECT_UPDATE_TOO_LARGE
        : ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID;
      // Les deux nombres sont calcules par NOX, jamais recopies de la reponse.
      const detail = budget
        ? `Le brief et le plan proposes occuperaient ${String(check.used)} caracteres, ` +
          `pour un budget commun de ${String(check.limit)}. Raccourcissez le plan, ou ` +
          "demandez a l'architecte une mise a jour plus courte."
        : "La mise a jour de projet proposee ne respecte pas le contrat de NOX.";

      await finishArchitectGeneration(db, {
        generationId,
        status: ARCHITECT_GENERATION_STATUS.FAILED,
        providerResponseId: result.value.responseId,
        usage: result.value.usage,
        errorCode: code,
        errorField: budget ? ARCHITECT_DIAGNOSTIC_FIELD.BUDGET : `projectUpdate.${check.field}`,
        errorDetail: detail,
      });
      return { ok: false, code };
    }

    projectUpdate = {
      projectId: input.projectId,
      proposed: turn.projectUpdate,
      // Les revisions **vues par le fournisseur**, capturees a la preparation du
      // tour. Pas celles d'aujourd'hui : l'utilisateur a pu enregistrer un plan
      // pendant que l'appel etait en vol.
      baseState: input.prepared.baseStructuredState,
    };
  }

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
      { role: ARCHITECT_MESSAGE_ROLE.USER, content: input.message },
      { role: ARCHITECT_MESSAGE_ROLE.ARCHITECT, content: turn.message },
    ],
    // Ecrite dans la meme transaction que la conclusion du tour et ses messages.
    projectUpdate,
    // La replanification aussi, et pour la meme raison. Son empreinte de
    // planification est celle vue par le fournisseur, capturee a la preparation.
    replan:
      turn.replan.mode === REPLAN_MODE.PROPOSED && input.prepared.replan !== null
        ? {
            projectId: input.projectId,
            proposal: turn.replan,
            baseState: input.prepared.baseStructuredState,
            planningFingerprint: input.prepared.replan.planningFingerprint,
          }
        : null,
  });

  if (generation === null) {
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR };
  }

  return { ok: true, generation, turn };
}
