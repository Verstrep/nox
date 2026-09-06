/**
 * Orchestration de l'amorcage, cote serveur.
 *
 * ```text
 * Preview TASK-000            ← une action humaine, zero appel a un fournisseur
 *        ↓
 * preconditions verifiees     ← brief, plan, backlog applique, repository lisible
 *        ↓
 * contexte construit          ← deterministe, pur, reproductible
 *        ↓
 * apercu affiche + empreinte
 *        ↓
 * Create TASK-000             ← une seconde action humaine
 *        ↓
 * empreinte revalidee         ← un etat qui a change refuse la creation
 *        ↓
 * tache DRAFT creee           ← numero 0, nature BOOTSTRAP
 *        ↓
 * document Markdown           ← pipeline de tache existant, inchange
 * ```
 *
 * ## Aucun appel a un fournisseur, nulle part
 *
 * Ni a l'ouverture de la page, ni a l'apercu, ni a la creation. L'amorcage est
 * une responsabilite que NOX connait : le planificateur de backlog repond a
 * « quel travail reste-t-il ? », question ouverte qui merite un modele ;
 * l'amorcage repond a « quelles fondations faut-il ? », dont NOX a deja la
 * reponse. Payer pour la reformuler serait payer pour de la variabilite.
 *
 * ## Aucune execution automatique
 *
 * Creer `TASK-000` ne lance rien. Elle nait `DRAFT`, comme toute tache, et
 * c'est un humain qui la passe `READY` puis la lance. NOX peut recevoir un
 * repository qui n'a besoin d'aucun amorcage : « disponible » n'a jamais
 * signifie « fait ».
 */

import {
  BOOTSTRAP_TASK_CODE,
  TASK_PRIORITY,
  type ArchitectPromptMemory,
  type DevelopmentTaskDetail,
  type DevelopmentTaskSummary,
  type ProjectMemoryEntry,
  type RepositoryInspection,
} from "@nox/shared";
import {
  countAppliedBacklogProposals,
  createBootstrapTask,
  getBootstrapTask,
  type DatabaseClient,
  type ProjectStructuredState,
} from "@nox/database";

import { projectMemoryRevision } from "../architect/fingerprint.ts";
import { createArchitectSanitizer } from "../architect/sanitize.ts";
import { inspectRepository } from "../runner/client.ts";
import type { RunnerResult } from "../runner/errors.ts";

import { buildBootstrapContext, type BootstrapContext } from "./context.ts";
import type { BootstrapBlocker } from "./display.ts";
import type { BootstrapSourceRefusal } from "@nox/shared";

/** Acces au runner, injecte plutot qu'importe : les tests n'en demarrent aucun. */
export type BootstrapRepositoryPorts = {
  inspect: (repositoryPath: string) => Promise<RunnerResult<RepositoryInspection>>;
};

export const runnerBootstrapPorts: BootstrapRepositoryPorts = {
  inspect: (repositoryPath) => inspectRepository(repositoryPath),
};

/** Ce dont un amorcage a besoin, deja relu en base par l'appelant. */
export type BootstrapProjectInput = {
  projectId: string;
  projectName: string;
  repositoryPath: string;
  tasks: readonly DevelopmentTaskSummary[];
  objectives: ReadonlyMap<string, string>;
  memories: readonly ProjectMemoryEntry[];
  structuredState: ProjectStructuredState;
  /** Nombre de propositions de backlog appliquees. */
  appliedBacklogCount: number;
  /** Tache d'amorcage deja existante, le cas echeant. */
  existingTask: DevelopmentTaskDetail | null;
  environment: Record<string, string | undefined>;
};

export type BootstrapPreview =
  | { ok: true; context: BootstrapContext }
  | {
      ok: false;
      blockers: BootstrapBlocker[];
      /**
       * Le champ canonique qui ne tient pas, lorsque c'est la cause.
       *
       * Distinct du blocage lui-meme : le blocage dit qu'on ne peut pas creer,
       * celui-ci dit ou regarder.
       */
      sourceRefusal?: BootstrapSourceRefusal;
    };

/**
 * Preconditions verifiees **avant** toute lecture du repository.
 *
 * L'ordre compte : un projet sans plan n'a aucune raison de faire travailler le
 * runner. Chaque refus est nomme, et tous sont rendus ensemble plutot qu'un par
 * un — corriger trois causes en trois allers-retours serait inutilement penible.
 */
export function bootstrapBlockers(input: BootstrapProjectInput): BootstrapBlocker[] {
  const blockers: BootstrapBlocker[] = [];
  if (input.structuredState.brief.prompt === null) {
    blockers.push("brief_missing");
  }
  if (input.structuredState.plan.prompt === null) {
    blockers.push("plan_missing");
  }
  if (input.appliedBacklogCount < 1) {
    blockers.push("backlog_missing");
  }
  return blockers;
}

/**
 * Construit l'apercu de `TASK-000`.
 *
 * Zero appel a un fournisseur, et une seule lecture du repository — en lecture
 * seule, et seulement une fois les preconditions locales satisfaites.
 */
export async function prepareBootstrapPreview(
  input: BootstrapProjectInput,
  ports: BootstrapRepositoryPorts = runnerBootstrapPorts,
): Promise<BootstrapPreview> {
  const blockers = bootstrapBlockers(input);
  if (blockers.length > 0) {
    return { ok: false, blockers };
  }

  const inspected = await ports.inspect(input.repositoryPath);
  if (!inspected.ok) {
    return { ok: false, blockers: ["repository_unreachable"] };
  }

  const sanitize = createArchitectSanitizer({
    repositoryRoot: input.repositoryPath,
    environment: input.environment,
  });

  const built = buildBootstrapContext({
    projectName: input.projectName,
    tasks: input.tasks,
    objectives: input.objectives,
    memories: input.memories,
    projectBrief: input.structuredState.brief.prompt,
    projectV1Plan: input.structuredState.plan.prompt,
    inspection: inspected.value,
    sanitize,
    memoryRevision: (memory: ArchitectPromptMemory) => projectMemoryRevision(memory),
  });

  if (!built.ok) {
    // Un etat produit qui ne tient pas dans son propre contrat d'amorcage. NOX
    // ne cree pas la tache : elle aurait l'air complete, et c'est exactement ce
    // qui a coute une review au premier pilote reel.
    return { ok: false, blockers: ["source_oversized"], sourceRefusal: built.refusal };
  }

  return { ok: true, context: built.context };
}

/**
 * Issue d'une creation.
 *
 * Union discriminee par `reason` : chaque refus a un nom, et l'appelant ne peut
 * pas en oublier un sans que le compilateur le dise.
 */
export type CreateBootstrapOutcome =
  | { ok: true; task: DevelopmentTaskDetail }
  /** Le contexte a change depuis l'apercu. */
  | { ok: false; reason: "stale" }
  /** Une precondition manque, et elle est nommee. */
  | {
      ok: false;
      reason: "blocked";
      blockers: BootstrapBlocker[];
      sourceRefusal?: BootstrapSourceRefusal;
    }
  /** Le projet possede deja sa tache d'amorcage. */
  | { ok: false; reason: "already_exists" }
  | { ok: false; reason: "unknown_project" };

/**
 * Cree `TASK-000` a partir de l'etat **courant**, sous controle d'empreinte.
 *
 * ## Pourquoi l'empreinte plutot qu'une simple reconstruction
 *
 * Reconstruire silencieusement depuis l'etat courant creerait une tache que
 * l'utilisateur n'a pas lue. L'apercu perdrait alors son sens : il montrerait
 * un texte, et la creation en produirait un autre.
 *
 * NOX refuse donc, comme partout ailleurs — application d'un backlog, mise a
 * jour de projet, reprise d'une execution. Il n'existe ni fusion automatique,
 * ni « creer quand meme » : recharger la page coute un instant et rend la
 * decision honnete.
 */
export async function createProjectBootstrapTask(
  db: DatabaseClient,
  input: BootstrapProjectInput,
  expectedFingerprint: string,
  ports: BootstrapRepositoryPorts = runnerBootstrapPorts,
): Promise<CreateBootstrapOutcome> {
  if (input.existingTask !== null) {
    return { ok: false, reason: "already_exists" };
  }

  const preview = await prepareBootstrapPreview(input, ports);
  if (!preview.ok) {
    return {
      ok: false,
      reason: "blocked",
      blockers: preview.blockers,
      sourceRefusal: preview.sourceRefusal,
    };
  }

  if (preview.context.fingerprint !== expectedFingerprint) {
    return { ok: false, reason: "stale" };
  }

  const { spec } = preview.context;

  const created = await createBootstrapTask(db, {
    projectId: input.projectId,
    title: spec.title,
    objective: spec.objective,
    context: spec.context,
    outOfScope: spec.outOfScope,
    priority: spec.priority ?? TASK_PRIORITY.HIGH,
    acceptanceCriteria: spec.acceptanceCriteria,
    documentReferences: spec.documentReferences,
    validationCommands: spec.validationCommands,
  });

  if (!created.ok) {
    // La contrainte d'unicite est le dernier mot : elle attrape la course que le
    // controle applicatif ci-dessus ne peut pas voir.
    return { ok: false, reason: created.reason };
  }

  return { ok: true, task: created.task };
}

/** Relit la tache d'amorcage d'un projet. Aucune sortie hors de SQLite. */
export async function loadBootstrapTask(
  db: DatabaseClient,
  projectId: string,
): Promise<DevelopmentTaskDetail | null> {
  return getBootstrapTask(db, projectId);
}

/** Compte les backlogs appliques d'un projet. Aucune sortie hors de SQLite. */
export async function loadAppliedBacklogCount(
  db: DatabaseClient,
  projectId: string,
): Promise<number> {
  return countAppliedBacklogProposals(db, projectId);
}

/** Le code de la tache d'amorcage, reexporte pour l'affichage. */
export { BOOTSTRAP_TASK_CODE };
