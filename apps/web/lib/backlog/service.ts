/**
 * Orchestration de la planification du backlog, cote serveur.
 *
 * ## Un clic, un appel
 *
 * ```text
 * Generate V1 backlog        ← une action humaine explicite
 *        ↓
 * preconditions verifiees        ← plan defini, rien en vol, rien en attente
 *        ↓
 * contexte de planification construit   ← aucun appel
 *        ↓
 * generation reservee            ← le verrou : une planification a la fois
 *        ↓
 * appel au fournisseur           ← exactement un, ou zero
 *        ↓
 * validation NOX de la reponse   ← tout ou rien
 *        ↓
 * proposition figee              ← dans la meme transaction que la conclusion
 * ```
 *
 * Chaque refus en amont de la reservation coute **zero appel**. C'est la
 * promesse centrale de TASK-022, et elle se lit dans l'ordre des etapes.
 *
 * ## Aucun appel automatique
 *
 * Rien ici n'est declenche par un rendu de page, un enregistrement de plan, une
 * mise a jour de projet appliquee, une tache terminee, un minuteur ou un echec
 * precedent. `generateProjectBacklog` n'est appelee que depuis une Server
 * Action, elle-meme declenchee par un clic.
 *
 * ## Ce que l'application fait, et ne fait pas
 *
 * `applyProjectBacklog` cree des taches `DRAFT`. Elle ne lance ni Claude Code,
 * ni le runner au-dela de la lecture du repository, ni `git add`, ni commit, ni
 * push, et n'appelle jamais le fournisseur.
 */

import {
  ARCHITECT_BACKLOG_GENERATION_STATUS,
  ARCHITECT_BACKLOG_SCHEMA_NAME,
  ARCHITECT_ERROR,
  buildArchitectBacklogSchema,
  checkValidationCommand,
  formatTaskCode,
  readArchitectBacklogProposal,
  taskDocumentPath,
  type ArchitectBacklogProposal,
  type ArchitectBacklogTaskProposal,
  type ArchitectErrorCode,
  type DevelopmentTaskDetail,
  type DevelopmentTaskSummary,
  type ProjectDocumentSummary,
  type ProjectMemoryEntry,
} from "@nox/shared";
import {
  applyBacklogProposal,
  dismissBacklogProposal,
  finishBacklogGeneration,
  getBacklogProposalForGeneration,
  peekNextTaskSequence,
  startBacklogGeneration,
  type ArchitectBacklogProposalView,
  type BacklogTaskToCreate,
  type DatabaseClient,
  type ProjectStructuredState,
} from "@nox/database";

import { ARCHITECT_REQUEST_TIMEOUT_MS } from "../architect/config.ts";
import { fetchArchitectContext, type ArchitectRepositoryPorts } from "../architect/service.ts";
import type { ArchitectProvider } from "../architect/provider.ts";
import { runnerArchitectPorts } from "../architect/service.ts";
import { readTaskSubmission, type TaskFormValues } from "../task-input.ts";
import { prepareBacklogGeneration, type PreparedBacklogGeneration } from "./prepare.ts";

/** Ce dont une planification a besoin, deja relu en base par l'appelant. */
export type BacklogProjectInput = {
  projectId: string;
  projectName: string;
  repositoryPath: string;
  /** Toutes les taches du projet, dans n'importe quel ordre. */
  tasks: readonly DevelopmentTaskSummary[];
  /** Objectif de chaque tache, indexe par identifiant. */
  objectives: ReadonlyMap<string, string>;
  /** Memoire du projet, relue a chaque planification. */
  memories: readonly ProjectMemoryEntry[];
  /** Etat structure du projet, relu a chaque planification. */
  structuredState: ProjectStructuredState;
  model: string;
  environment: Record<string, string | undefined>;
  ports?: ArchitectRepositoryPorts;
};

export type PrepareBacklogResult =
  | {
      ok: true;
      prepared: PreparedBacklogGeneration;
      inventory: ProjectDocumentSummary[];
    }
  | { ok: false; code: ArchitectErrorCode }
  | { ok: false; message: string };

/**
 * Construit le contexte de planification, sans rien envoyer.
 *
 * Appelee par l'inspection du contexte, par `Generate` **et** par `Apply` : les
 * trois voient donc exactement le meme contexte, calcule par le meme code.
 *
 * C'est ce qui rend l'inspection honnete — elle montre le texte reel — et le
 * controle de peremption fiable : l'empreinte comparee a l'application est
 * produite par la fonction qui a produit celle enregistree.
 */
export async function prepareProjectBacklog(
  input: BacklogProjectInput,
): Promise<PrepareBacklogResult> {
  const fetched = await fetchArchitectContext(
    input.repositoryPath,
    input.ports ?? runnerArchitectPorts,
  );
  if (!fetched.ok) {
    return fetched;
  }

  const prepared = prepareBacklogGeneration({
    projectName: input.projectName,
    repositoryPath: input.repositoryPath,
    documents: fetched.context.documents,
    inventory: fetched.context.inventory,
    tasks: input.tasks,
    objectives: input.objectives,
    memories: input.memories,
    projectBrief: input.structuredState.brief.prompt,
    projectV1Plan: input.structuredState.plan.prompt,
    model: input.model,
    environment: input.environment,
  });

  return { ok: true, prepared, inventory: fetched.context.inventory };
}

// --- Generation --------------------------------------------------------------

export type GenerateBacklogOutcome =
  | { ok: true; proposal: ArchitectBacklogProposalView }
  | { ok: false; code: ArchitectErrorCode }
  | { ok: false; message: string }
  /** Une precondition manque. Aucun appel, aucune generation reservee. */
  | { ok: false; refusal: BacklogGenerationRefusal };

/** Ce qui empeche une planification, avant tout appel. */
export type BacklogGenerationRefusal =
  /** Le projet n'a pas de Living V1 Plan defini : il n'y a pas de cible. */
  | "no_plan"
  /** Une planification est deja en vol. */
  | "active"
  /** Une proposition attend une decision : l'appliquer ou l'ecarter d'abord. */
  | "pending_proposal"
  | "not_found";

export type GenerateBacklogInput = BacklogProjectInput & {
  provider: ArchitectProvider;
};

/**
 * Genere un backlog : reserve, appelle, valide, enregistre.
 *
 * **Le seul endroit d'ou un appel de planification peut partir.**
 *
 * Ne leve jamais : toute panne devient un code, et la generation reservee est
 * conclue en base dans **tous** les cas. Une generation laissee `RUNNING`
 * bloquerait le projet pour toujours, puisque c'est elle qui porte le verrou.
 *
 * ## Le plan de V1 est la seule precondition de fond
 *
 * Un brief absent n'empeche rien : le prompt le dit au modele, qui s'appuiera
 * sur le plan et le signalera dans son message. Un plan absent, lui, laisserait
 * le planificateur sans cible — il inventerait une V1, et personne ne l'aurait
 * validee.
 */
export async function generateProjectBacklog(
  db: DatabaseClient,
  input: GenerateBacklogInput,
): Promise<GenerateBacklogOutcome> {
  // 1. La cible existe-t-elle ? Verifie avant toute lecture du repository : une
  //    precondition manquante ne doit rien couter, pas meme un appel au runner.
  if (!input.structuredState.plan.present) {
    return { ok: false, refusal: "no_plan" };
  }

  // 2. Le contexte courant, cote serveur.
  const prepared = await prepareProjectBacklog(input);
  if (!prepared.ok) {
    return prepared;
  }

  // 3. La reservation. Elle refuse aussi bien un appel deja en vol qu'une
  //    proposition en attente, et dans les deux cas rien n'est envoye.
  const reserved = await startBacklogGeneration(db, {
    projectId: input.projectId,
    model: input.model,
    promptVersion: prepared.prepared.prompt.version,
    inputHash: prepared.prepared.inputHash,
    manifest: prepared.prepared.manifest,
    base: prepared.prepared.base,
  });
  if (!reserved.ok) {
    return { ok: false, refusal: reserved.reason };
  }

  const generationId = reserved.generation.id;

  /** Conclut la planification en echec, sans jamais laisser le verrou pose. */
  const fail = async (code: ArchitectErrorCode): Promise<GenerateBacklogOutcome> => {
    await finishBacklogGeneration(db, {
      generationId,
      status:
        code === ARCHITECT_ERROR.ARCHITECT_REFUSED
          ? ARCHITECT_BACKLOG_GENERATION_STATUS.REFUSED
          : ARCHITECT_BACKLOG_GENERATION_STATUS.FAILED,
      errorCode: code,
    });
    return { ok: false, code };
  };

  let result;
  try {
    result = await input.provider.generateBacklog({
      model: input.model,
      instructions: prepared.prepared.prompt.instructions,
      input: prepared.prepared.prompt.input,
      schemaName: ARCHITECT_BACKLOG_SCHEMA_NAME,
      schema: buildArchitectBacklogSchema(),
      timeoutMs: ARCHITECT_REQUEST_TIMEOUT_MS,
      maxOutputTokens: prepared.prepared.maxOutputTokens,
    });
  } catch (error) {
    // Une exception inattendue du fournisseur ne doit pas remonter telle quelle :
    // elle porterait son URL et ses en-tetes.
    console.error("[nox] Echec inattendu de la planification :", error);
    return fail(ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR);
  }

  if (!result.ok) {
    return fail(result.code);
  }

  const validated = readArchitectBacklogProposal(
    result.value.raw,
    prepared.prepared.availableDocuments,
  );
  if (!validated.ok) {
    // Un seul element invalide condamne toute la proposition. Conserver les
    // autres livrerait un decoupage dont personne ne pourrait dire ce qui
    // manque, et le decoupage ne vaut que pris ensemble.
    console.error(
      "[nox] Backlog refuse :",
      validated.refusal.field,
      validated.refusal.message,
    );
    await finishBacklogGeneration(db, {
      generationId,
      status: ARCHITECT_BACKLOG_GENERATION_STATUS.FAILED,
      providerResponseId: result.value.responseId,
      usage: result.value.usage,
      errorCode: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
    });
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID };
  }

  await finishBacklogGeneration(db, {
    generationId,
    status: ARCHITECT_BACKLOG_GENERATION_STATUS.READY,
    providerResponseId: result.value.responseId,
    usage: result.value.usage,
    proposal: validated.proposal,
  });

  const proposal = await getBacklogProposalForGeneration(db, input.projectId, generationId);
  if (proposal === null) {
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR };
  }

  return { ok: true, proposal };
}

// --- Application -------------------------------------------------------------

/**
 * Un element de backlog tel que le formulaire de revue le rend.
 *
 * Ce sont les memes valeurs qu'un formulaire de creation de tache — c'est le
 * meme type, `TaskFormValues` — parce que c'est la meme chose : une
 * specification saisie par un humain. Une seconde forme presque identique
 * aurait fini par accepter ce que l'autre refuse.
 */
export type BacklogReviewItem = TaskFormValues;

export type ApplyBacklogOutcome =
  | { ok: true; proposal: ArchitectBacklogProposalView; tasks: DevelopmentTaskDetail[] }
  | { ok: false; message: string }
  /** Le projet a change depuis la planification. Aucune tache creee. */
  | { ok: false; stale: true };

export type ApplyBacklogRequest = BacklogProjectInput & {
  proposalId: string;
  /** Backlog tel que l'humain l'a laisse : edite, reordonne, ampute. */
  items: readonly BacklogReviewItem[];
};

const EMPTY_MESSAGE =
  "Ce backlog ne contient plus aucune tache. Ecartez-le plutot que de l'appliquer.";

const UNKNOWN_MESSAGE = "Ce backlog n'existe plus. Rechargez la page et recommencez.";

const NOT_PENDING_MESSAGE =
  "Ce backlog a deja ete traite. Rechargez la page pour voir son etat actuel.";

/**
 * Applique un backlog relu par un humain.
 *
 * ## L'ordre des etapes, et ce que chacune protege
 *
 * ```text
 * 1. validation de chaque element        ← rien n'est ecrit avant
 * 2. preflight du repository             ← runner joignable, destinations libres
 * 3. transaction SQLite                  ← les N taches, ou aucune
 * 4. documents Markdown, un par un       ← reprenable, jamais un ecrasement
 * ```
 *
 * ## Pourquoi le preflight est bloquant
 *
 * Parce qu'il rend le cas de loin le plus frequent — le runner arrete —
 * inoffensif : rien n'est ecrit, rien n'est annonce applique, et l'utilisateur
 * relance quand son runner tourne. Sans lui, ce cas produirait N taches dont
 * aucun document n'existe.
 *
 * ## Ce que NOX ne pretend pas garantir
 *
 * SQLite et le systeme de fichiers ne partagent aucune transaction. Une panne
 * **pendant** l'ecriture des documents — apres le preflight, apres la
 * transaction — laisse donc des taches dont le document reste a produire. Cet
 * etat est modelise depuis TASK-007, visible dans l'interface, et se reprend
 * d'un clic ; il n'est ni silencieux, ni perdu. C'est la limite reelle de
 * l'operation, et elle est ecrite plutot que masquee.
 *
 * ## Les chemins ne viennent jamais du fournisseur
 *
 * Le code d'une tache est attribue par NOX, et son document en est derive. Rien
 * de ce que le modele a rendu n'atteint un chemin de fichier.
 */
export async function applyProjectBacklog(
  db: DatabaseClient,
  input: ApplyBacklogRequest,
): Promise<ApplyBacklogOutcome> {
  if (input.items.length === 0) {
    return { ok: false, message: EMPTY_MESSAGE };
  }

  // 1. Chaque element repasse par la validation d'un formulaire de tache. Ce
  //    qu'un humain a modifie n'a pas plus de credit que ce qu'un modele a
  //    propose : les deux sont revalides de zero.
  const validated: BacklogTaskToCreate[] = [];
  for (const [position, item] of input.items.entries()) {
    const submission = readTaskSubmission(item);
    if (!submission.ok) {
      return { ok: false, message: `Tache ${String(position + 1)} : ${submission.message}` };
    }
    for (const command of submission.input.validationCommands) {
      const problem = checkValidationCommand(command);
      if (problem !== null) {
        return {
          ok: false,
          message: `Tache ${String(position + 1)} : « ${command} » ne peut pas etre autorisee : ${problem}`,
        };
      }
    }
    validated.push(submission.input);
  }

  // 2. Le contexte est reconstruit maintenant — sans aucun appel au fournisseur
  //    — pour deux raisons a la fois : il donne l'empreinte d'aujourd'hui, et
  //    l'inventaire du repository sur lequel repose le preflight.
  const prepared = await prepareProjectBacklog(input);
  if (!prepared.ok) {
    return {
      ok: false,
      message:
        "code" in prepared
          ? "Le repository n'a pas pu etre relu. Verifiez que le runner tourne, puis reessayez."
          : prepared.message,
    };
  }

  for (const reference of validated.flatMap((task) => task.documentReferences)) {
    if (!prepared.prepared.availableDocuments.includes(reference)) {
      return {
        ok: false,
        message: `« ${reference} » ne fait pas partie des documents du repository. Retirez-le avant d'appliquer.`,
      };
    }
  }

  const collision = await checkDocumentDestinations(
    db,
    input.projectId,
    validated.length,
    prepared.inventory,
  );
  if (collision !== null) {
    return { ok: false, message: collision };
  }

  // 3. La transaction : les N taches, ou aucune.
  const applied = await applyBacklogProposal(db, {
    projectId: input.projectId,
    proposalId: input.proposalId,
    tasks: validated,
    currentPlanningFingerprint: prepared.prepared.base.planningFingerprint,
    message: backlogAppliedMessage(input.items.length),
  });

  if (!applied.ok) {
    switch (applied.reason) {
      case "stale":
        return { ok: false, stale: true };
      case "not_pending":
        return { ok: false, message: NOT_PENDING_MESSAGE };
      case "empty":
        return { ok: false, message: EMPTY_MESSAGE };
      case "too_many":
        return {
          ok: false,
          message: `Un backlog ne peut pas depasser ${String(applied.limit)} taches.`,
        };
      default:
        return { ok: false, message: UNKNOWN_MESSAGE };
    }
  }

  return { ok: true, proposal: applied.proposal, tasks: applied.tasks };
}

/** Resume conserve avec le backlog applique. */
function backlogAppliedMessage(count: number): string {
  return count === 1
    ? "1 tache appliquee depuis le backlog de V1."
    : `${String(count)} taches appliquees depuis le backlog de V1.`;
}

/**
 * Verifie que les documents a creer n'ont pas deja un occupant.
 *
 * ## Une precaution, pas une garantie
 *
 * Le compteur de numeros peut avancer entre cette lecture et la transaction :
 * ce controle prevoit des chemins, il ne les reserve pas. Il attrape le cas
 * reel — un `tasks/TASK-012.md` laisse par une branche abandonnee — et donne
 * un refus lisible **avant** que la moindre tache ne soit creee.
 *
 * La garantie, elle, est ailleurs et n'a pas bouge : la creation d'un document
 * passe par une primitive exclusive, et n'ecrase jamais rien. Un fichier
 * apparu entre-temps produit donc un conflit visible, pas une perte.
 */
async function checkDocumentDestinations(
  db: DatabaseClient,
  projectId: string,
  count: number,
  inventory: readonly ProjectDocumentSummary[],
): Promise<string | null> {
  const next = await peekNextTaskSequence(db, projectId);
  if (next === null) {
    return UNKNOWN_MESSAGE;
  }

  const present = new Set(inventory.map((entry) => entry.path.toLowerCase()));
  for (let offset = 0; offset < count; offset += 1) {
    const path = taskDocumentPath(formatTaskCode(next + offset));
    if (present.has(path.toLowerCase())) {
      return `Un document occupe deja ${path}. NOX ne l'ecrase pas : ouvrez-le pour decider quoi en faire, puis reessayez.`;
    }
  }

  return null;
}

// --- Abandon -----------------------------------------------------------------

export type DismissBacklogOutcome =
  | { ok: true; proposal: ArchitectBacklogProposalView }
  | { ok: false; message: string };

/**
 * Ecarte une proposition.
 *
 * Aucun appel, aucune tache creee, aucune ecriture dans le repository. Une
 * proposition perimee reste ecartable : c'est meme sa sortie normale.
 */
export async function dismissProjectBacklog(
  db: DatabaseClient,
  input: { projectId: string; proposalId: string },
): Promise<DismissBacklogOutcome> {
  const dismissed = await dismissBacklogProposal(db, input);
  if (dismissed.ok) {
    return { ok: true, proposal: dismissed.proposal };
  }
  return {
    ok: false,
    message: dismissed.reason === "not_found" ? UNKNOWN_MESSAGE : NOT_PENDING_MESSAGE,
  };
}

// --- Peremption --------------------------------------------------------------

/**
 * La proposition en attente est-elle encore fondee ?
 *
 * Se derive, ne se stocke pas : on reconstruit le contexte de planification
 * d'aujourd'hui — zero appel au fournisseur — et on compare son empreinte a
 * celle enregistree avec la generation.
 *
 * Un `null` signifie « je ne sais pas » : le repository n'a pas pu etre relu.
 * L'interface le dit alors plutot que d'affirmer une fraicheur qu'elle n'a pas
 * verifiee — et l'application, elle, refusera de toute facon, puisqu'elle
 * commence par ce meme controle.
 */
export async function isBacklogProposalStale(
  input: BacklogProjectInput & { baseFingerprint: string },
): Promise<boolean | null> {
  const prepared = await prepareProjectBacklog(input);
  if (!prepared.ok) {
    return null;
  }
  return prepared.prepared.base.planningFingerprint !== input.baseFingerprint;
}

/** Convertit une proposition en valeurs de formulaire, dans son ordre. */
export function backlogProposalToFormValues(
  proposal: ArchitectBacklogProposal,
): BacklogReviewItem[] {
  return proposal.tasks.map(backlogTaskToFormValues);
}

/** Convertit un element de backlog en valeurs de formulaire de tache. */
export function backlogTaskToFormValues(
  task: ArchitectBacklogTaskProposal,
): BacklogReviewItem {
  return {
    title: task.title,
    priority: task.priority,
    objective: task.objective,
    context: task.context ?? "",
    // Le hors perimetre est une liste chez le fournisseur et un texte dans le
    // formulaire de tache. Une ligne par entree conserve l'information sans
    // inventer de separateur que la relecture aurait a deviner.
    outOfScope: task.outOfScope.join("\n"),
    documents: task.documentReferences.join("\n"),
    criteria: task.acceptanceCriteria.join("\n"),
    commands: task.validationCommands.join("\n"),
  };
}
