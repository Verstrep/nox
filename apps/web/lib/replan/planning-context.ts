/**
 * Ce que le fournisseur voit du plan de travail, et ce qu'il ne verra jamais.
 *
 * ## Deux traitements, parce que deux roles
 *
 * Les taches **verrouillees** partent en inventaire compact : code, titre,
 * statut, raison du verrouillage, objectif resume, dependances. Elles servent a
 * comprendre ce qui existe deja et a pouvoir s'y rattacher. Recopier quarante
 * contrats historiques consommerait le budget de celles qui comptent.
 *
 * Les taches **modifiables** partent en entier — objectif, contexte, hors
 * perimetre, documents, criteres avec leur mode de verification, commandes avec
 * leur mode d'execution, dependances. Sans cela, le fournisseur ne pourrait pas
 * produire un etat cible complet : il produirait une approximation, et chaque
 * tache conservee reviendrait paraphrasee.
 *
 * ## Aucune troncature silencieuse
 *
 * C'est la regle centrale de ce module, et elle vaut d'etre dite deux fois :
 * **aucune tache modifiable n'est jamais retiree du contexte pour tenir dans le
 * budget.** Un plan cible concu sur une liste amputee supprimerait les taches
 * absentes en pretendant les avoir examinees.
 *
 * Si les contrats modifiables ne tiennent pas, le contexte est **refuse**. Ce
 * qui peut ceder, en revanche, est la queue de l'inventaire verrouille : les
 * taches historiques les plus anciennes, dont l'absence est annoncee au
 * fournisseur et n'autorise aucune suppression.
 *
 * ## Ce module ne lit rien
 *
 * Il recoit un etat de planification deja relu en base et decide de ce qui entre.
 * Pur et deterministe : les memes entrees produisent le meme bundle, ce qui rend
 * l'empreinte comparable et les tests possibles sans base ni runner.
 */

import type { ReplanStateTask } from "@nox/database";
import {
  replanAvailability,
  type ArchitectPromptEditableTask,
  type ArchitectPromptLockedTask,
  type ArchitectPromptPlanningState,
  type ReplanSourceState,
  type ReplanSourceTask,
  type ReplanUnavailableCode,
} from "@nox/shared";

import { replanPlanningFingerprint } from "./fingerprint.ts";

/**
 * Bornes du contexte de replanification.
 *
 * Un budget **dedie**, distinct de celui de la conversation et de celui du
 * backlog : ce qui est transmis ici n'est ni un transcript, ni un inventaire de
 * titres, mais des contrats complets. Des constantes, jamais des variables
 * d'environnement : elles decident de ce qui quitte la machine et de ce qui sera
 * facture.
 *
 * ## L'arithmetique
 *
 * ```text
 *   60 contrats modifiables x ~2 Kio  = 120 Kio   (jamais tronques)
 * + 60 lignes d'inventaire x 400      =  24 Kio   (queue tronquable)
 * = 144 Kio
 * ```
 *
 * Le budget vaut 160 Kio. Au-dela, NOX refuse : `REPLAN_CONTEXT_TOO_LARGE`.
 */
export const REPLAN_CONTEXT_LIMITS = {
  totalChars: 160 * 1024,
  /** Taches verrouillees decrites dans l'inventaire. */
  lockedTasks: 60,
  /** Longueur retenue de l'objectif resume d'une tache verrouillee. */
  lockedObjectiveChars: 300,
} as const;

/** Refus possibles de la construction du contexte. */
export const REPLAN_CONTEXT_ERROR = {
  /**
   * Le plan de travail ne tient pas dans le budget.
   *
   * Un refus, jamais une coupe. « Je n'ai pas pu tout montrer » et « voici tout »
   * ne sont pas la meme phrase, et une replanification concue sur la seconde
   * alors que la premiere etait vraie supprimerait du travail sans le savoir.
   */
  CONTEXT_TOO_LARGE: "REPLAN_CONTEXT_TOO_LARGE",
} as const;

export type ReplanContextErrorCode =
  (typeof REPLAN_CONTEXT_ERROR)[keyof typeof REPLAN_CONTEXT_ERROR];

export type ReplanPlanningBundle = {
  /** Ce qui part au fournisseur, deja mis en forme pour le prompt. */
  promptState: ArchitectPromptPlanningState;
  /** Ce contre quoi la reponse sera validee. */
  source: ReplanSourceState;
  /** Empreinte de l'etat de planification vu par le fournisseur. */
  planningFingerprint: string;
  /** Taille du contexte de planification transmis. */
  totalChars: number;
};

export type ReplanPlanningResult =
  | { ok: true; bundle: ReplanPlanningBundle }
  | { ok: false; code: ReplanContextErrorCode | ReplanUnavailableCode };

export type ReplanPlanningInput = {
  tasks: readonly ReplanStateTask[];
  appliedBacklogCount: number;
  briefRevision: string | null;
  planRevision: string | null;
  /** Nettoyeur applique a **toute** chaine transmise. */
  sanitize: (value: string) => string;
};

/** Coupe un texte en annoncant la coupe, plutot qu'en la taisant. */
function summarize(value: string, max: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function lockedChars(task: ArchitectPromptLockedTask): number {
  return (
    task.code.length +
    task.title.length +
    task.status.length +
    task.lockReason.length +
    (task.objective?.length ?? 0) +
    task.dependsOn.reduce((total, entry) => total + entry.length, 0)
  );
}

function editableChars(task: ArchitectPromptEditableTask): number {
  return (
    task.code.length +
    task.title.length +
    task.objective.length +
    (task.context?.length ?? 0) +
    (task.outOfScope?.length ?? 0) +
    task.documentReferences.reduce((total, entry) => total + entry.length, 0) +
    task.dependsOn.reduce((total, entry) => total + entry.length, 0) +
    task.criteria.reduce(
      (total, criterion) =>
        total + criterion.text.length + (criterion.humanInstructions?.length ?? 0),
      0,
    ) +
    task.commands.reduce((total, command) => total + command.command.length, 0)
  );
}

/**
 * Construit le contexte de planification, ou refuse.
 *
 * L'ordre des refus va du moins couteux au plus couteux : la disponibilite
 * d'abord — un projet sans backlog initial n'a rien a replanifier —, le budget
 * ensuite.
 */
export function buildReplanPlanningContext(input: ReplanPlanningInput): ReplanPlanningResult {
  const availability = replanAvailability({ appliedBacklogCount: input.appliedBacklogCount });
  if (!availability.available) {
    return { ok: false, code: availability.code };
  }

  const { sanitize } = input;
  const editable: ArchitectPromptEditableTask[] = [];
  const locked: ArchitectPromptLockedTask[] = [];
  const sourceEditable: ReplanSourceTask[] = [];
  const sourceLocked: ReplanSourceTask[] = [];

  for (const task of input.tasks) {
    const { classified } = task;
    const sourceTask: ReplanSourceTask = {
      id: classified.id,
      code: classified.code,
      dependsOnTaskIds: task.dependsOnTaskIds,
    };

    if (classified.editable && task.contract !== null) {
      sourceEditable.push(sourceTask);
      const contract = task.contract;
      editable.push({
        id: classified.id,
        code: classified.code,
        title: sanitize(contract.title),
        status: classified.status,
        priority: contract.priority,
        objective: sanitize(contract.objective),
        context: contract.context === null ? null : sanitize(contract.context),
        outOfScope: contract.outOfScope === null ? null : sanitize(contract.outOfScope),
        documentReferences: contract.documentReferences.map(sanitize),
        criteria: contract.acceptanceCriteria.map((criterion) => ({
          text: sanitize(criterion.text),
          verificationMode: criterion.verificationMode,
          humanInstructions:
            criterion.humanInstructions === null ? null : sanitize(criterion.humanInstructions),
          validationCommandIndexes: [...criterion.commandPositions],
        })),
        commands: contract.validationCommands.map((command) => ({
          command: sanitize(command.command),
          executionMode: command.executionMode,
        })),
        dependsOn: task.dependsOnCodes,
      });
      continue;
    }

    // Une tache classee modifiable dont le contrat n'a pas pu etre relu est
    // traitee comme verrouillee. Le defaut sur : mieux vaut ne pas pouvoir la
    // replanifier que la replanifier sur un contrat qu'on n'a pas vu.
    sourceLocked.push(sourceTask);
    locked.push({
      id: classified.id,
      code: classified.code,
      title: sanitize(task.title),
      status: classified.status,
      lockReason: classified.lockReason ?? "STATUS",
      objective: sanitize(summarize(task.objective, REPLAN_CONTEXT_LIMITS.lockedObjectiveChars)),
      dependsOn: task.dependsOnCodes,
    });
  }

  // La queue de l'inventaire verrouille est la seule chose qui puisse ceder, et
  // elle cede par la fin : les taches les plus anciennes du plan. Leur absence
  // est annoncee au fournisseur.
  const omittedLocked = Math.max(0, locked.length - REPLAN_CONTEXT_LIMITS.lockedTasks);
  const shownLocked = omittedLocked === 0 ? locked : locked.slice(0, REPLAN_CONTEXT_LIMITS.lockedTasks);

  const totalChars =
    editable.reduce((total, task) => total + editableChars(task), 0) +
    shownLocked.reduce((total, task) => total + lockedChars(task), 0);

  if (totalChars > REPLAN_CONTEXT_LIMITS.totalChars) {
    return { ok: false, code: REPLAN_CONTEXT_ERROR.CONTEXT_TOO_LARGE };
  }

  return {
    ok: true,
    bundle: {
      promptState: { locked: shownLocked, editable, omittedLocked },
      // La source de validation contient **toutes** les taches, y compris celles
      // que l'inventaire n'a pas montrees : elles restent verrouillees, et une
      // reference vers l'une d'elles doit se resoudre plutot que d'echouer.
      source: { editable: sourceEditable, locked: sourceLocked },
      planningFingerprint: replanPlanningFingerprint({
        briefRevision: input.briefRevision,
        planRevision: input.planRevision,
        tasks: input.tasks,
      }),
      totalChars,
    },
  };
}
