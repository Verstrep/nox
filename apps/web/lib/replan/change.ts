/**
 * Un changement de projet, tel que l'utilisateur le relit.
 *
 * ## Une seule intention, une seule revue
 *
 * Quand un tour propose a la fois une mise a jour du projet et une
 * replanification, les deux forment **un** changement. Ils se relisent sur une
 * page, s'appliquent d'un geste et s'ecartent d'un geste. Deux revues et deux
 * boutons auraient laisse exister l'etat « le plan dit une chose, le backlog en
 * construit une autre » — celui qui n'est rattrapable par personne.
 *
 * ## Une mise a jour seule reste ce qu'elle etait
 *
 * TASK-021 n'est pas remplacee. Une proposition de projet sans replanification
 * liee garde sa page, son formulaire et ses boutons. Forcer toutes les
 * propositions historiques dans la revue combinee aurait reecrit leur histoire
 * pour un confort d'implementation.
 *
 * ## Ce module ne modifie rien
 *
 * Il lit SQLite, et derive. Ouvrir une revue n'appelle ni OpenAI, ni Claude
 * Code, ni le runner, n'ecrit dans aucun repository, et ne fait avancer aucune
 * file.
 */

import {
  ARCHITECT_PROJECT_UPDATE_STATUS,
  PROJECT_UPDATE_ACTION,
  REPLAN_PROPOSAL_STATUS,
  isReplanProposal,
  type ArchitectProjectUpdateProposal,
  type ProjectUpdateReview,
  type ReplanProposal,
  type ReplanProposalStatus,
} from "@nox/shared";
import {
  getArchitectProjectUpdate,
  loadReplanPlanningState,
  type ArchitectProjectUpdateView,
  type DatabaseClient,
  type ProjectStructuredState,
  type ReplanApplyItem,
  type ReplanPlanningState,
  type ReplanProposalRecord,
  type ReplanStateTask,
} from "@nox/database";

import { projectUpdateReview } from "../architect/project-update.ts";
import { buildReplanDiff, type ReplanDiff } from "./diff.ts";
import { replanPlanningFingerprint } from "./fingerprint.ts";
import { proposalToReviewItems, type ReplanReviewItem } from "./target.ts";

export type ReplanChangeView = {
  proposal: ReplanProposalRecord;
  status: ReplanProposalStatus;
  /** La cible telle que le fournisseur l'a rendue. `null` si son payload est illisible. */
  provided: ReplanProposal | null;
  /** Mise a jour du projet liee, quand le tour en portait une. */
  update: ArchitectProjectUpdateView | null;
  /** Comparaison du brief et du plan, contre l'etat courant. */
  updateReview: ProjectUpdateReview | null;
  changesBrief: boolean;
  changesPlan: boolean;
  /** Etat de planification courant, deja trie. */
  planning: ReplanPlanningState;
  /** Taches futures modifiables, dans l'ordre du plan. */
  editable: ReplanStateTask[];
  /** Taches verrouillees, pour expliquer ce qui n'est pas replanifiable. */
  locked: ReplanStateTask[];
  codeByTaskId: Map<string, string>;
  /** Les elements de revue, prets a etre edites. */
  items: ReplanReviewItem[];
  /** La comparaison entre le plan courant et la cible proposee. */
  diff: ReplanDiff;
  stale: {
    brief: boolean;
    plan: boolean;
    planning: boolean;
    any: boolean;
  };
};

/** Les identifiants de toutes les taches du projet, pour resoudre une reference. */
export function knownTaskIds(planning: ReplanPlanningState): Set<string> {
  return new Set(planning.tasks.map((task) => task.classified.id));
}

/** Les codes de toutes les taches du projet, y compris verrouillees. */
export function taskCodes(planning: ReplanPlanningState): Map<string, string> {
  return new Map(planning.tasks.map((task) => [task.classified.id, task.classified.code]));
}

/**
 * Charge un changement de projet complet.
 *
 * L'etat courant est relu **maintenant**, jamais fige a la proposition : ce que
 * l'utilisateur compare doit etre le projet tel qu'il est. Que cet etat ait
 * change depuis est une autre question — celle de la peremption, tranchee a
 * l'application, dans la transaction qui ecrit.
 */
export async function loadReplanChange(
  db: DatabaseClient,
  project: { id: string; repositoryPath: string },
  proposal: ReplanProposalRecord,
  current: ProjectStructuredState,
): Promise<ReplanChangeView> {
  const planning = await loadReplanPlanningState(db, project.id);
  const codeByTaskId = taskCodes(planning);
  const editable = planning.tasks.filter((task) => task.classified.editable);
  const locked = planning.tasks.filter((task) => !task.classified.editable);

  const provided = readProvidedProposal(proposal.providerJson);
  const items = provided === null ? [] : proposalToReviewItems(provided, codeByTaskId);

  const update =
    proposal.projectUpdateId === null
      ? null
      : await getArchitectProjectUpdate(db, proposal.projectUpdateId);

  const proposed: ArchitectProjectUpdateProposal | null = update?.proposed ?? null;

  return {
    proposal,
    status: proposal.status,
    provided,
    update,
    updateReview: proposed === null ? null : projectUpdateReview(current, proposed),
    changesBrief: proposed?.brief.action === PROJECT_UPDATE_ACTION.SET,
    changesPlan: proposed?.plan.action === PROJECT_UPDATE_ACTION.SET,
    planning,
    editable,
    locked,
    codeByTaskId,
    items,
    diff: buildReplanDiff({
      current: editable,
      target: providedApplyItems(provided),
      codeByTaskId,
    }),
    stale: replanStaleness(proposal, planning, current),
  };
}

/**
 * La cible du fournisseur, sous la forme comparable.
 *
 * Les contrats y sont complets : c'est ce qui permet de dire qu'un element est
 * `KEEP` plutot qu'`UPDATE` sans rien recalculer ailleurs.
 */
export function providedApplyItems(provided: ReplanProposal | null): ReplanApplyItem[] {
  if (provided === null) {
    return [];
  }
  return provided.futureTasks.map((task) => ({
    existingTaskId: task.existingTaskId,
    tempId: task.tempId,
    values: {
      title: task.title,
      objective: task.objective,
      context: task.context,
      outOfScope: task.outOfScope.length === 0 ? null : task.outOfScope.join("\n"),
      priority: task.priority,
      acceptanceCriteria: task.acceptanceCriteria.map((criterion) => ({
        text: criterion.text,
        verificationMode: criterion.verificationMode,
        humanInstructions: criterion.humanInstructions,
        commandPositions: [...criterion.validationCommandIndexes],
      })),
      documentReferences: [...task.documentReferences],
      validationCommands: task.validationCommands.map((command) => ({
        command: command.command,
        executionMode: command.executionMode,
      })),
      dependsOnTaskIds: [],
    },
    dependsOnTaskIds: [...task.dependsOnTaskIds],
    dependsOnTempIds: [...task.dependsOnTempIds],
  }));
}

/**
 * La proposition est-elle encore fondee sur l'etat qu'elle a vu ?
 *
 * Derivee, jamais stockee : il n'existe aucun statut `STALE`. La persister
 * obligerait a la recalculer a chaque changement du projet, et laisserait des
 * propositions marquees perimees alors que l'etat est revenu a ce qu'il etait.
 */
export function replanStaleness(
  proposal: ReplanProposalRecord,
  planning: ReplanPlanningState,
  current: ProjectStructuredState,
): { brief: boolean; plan: boolean; planning: boolean; any: boolean } {
  const brief = proposal.baseBriefRevision !== current.brief.revision;
  const plan = proposal.basePlanRevision !== current.plan.revision;
  const planningChanged =
    replanPlanningFingerprint({
      briefRevision: current.brief.revision,
      planRevision: current.plan.revision,
      tasks: planning.tasks,
    }) !== proposal.planningFingerprint;

  return { brief, plan, planning: planningChanged, any: brief || plan || planningChanged };
}

/**
 * Relit la cible enregistree.
 *
 * Un payload illisible ne fait pas tomber la page : la proposition se lit alors
 * comme ne portant aucune cible, et le refus d'appliquer viendra de la
 * validation, pas d'une exception au rendu. Une proposition ancienne reste
 * consultable meme si le contrat evolue — c'est precisement pour cela que NOX la
 * conserve.
 */
export function readProvidedProposal(providerJson: string): ReplanProposal | null {
  try {
    const parsed: unknown = JSON.parse(providerJson);
    return isReplanProposal(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Une carte de changement, telle que le fil de conversation l'affiche. */
export type TimelineProjectChange = {
  generationId: string;
  proposalId: string;
  /** Mise a jour du projet appliquee dans le meme geste, le cas echeant. */
  updateId: string | null;
  status: ReplanProposalStatus;
  /** Champs du brief et du plan que le changement modifierait. */
  briefChanges: number;
  planChanges: number;
  added: number;
  updated: number;
  removed: number;
  orderChanged: boolean;
  /** La proposition n'est plus fondee sur l'etat courant. */
  stale: boolean;
};

/**
 * Les changements de projet d'une conversation, prets pour le fil.
 *
 * Les compteurs viennent du meme modele de comparaison que la page de revue :
 * la carte et la page ne peuvent donc pas annoncer deux nombres differents.
 *
 * Une proposition finalisee n'est pas recomparee a l'etat courant : elle a ete
 * appliquee ou ecartee, et « ce qu'elle changerait aujourd'hui » n'a plus de
 * sens. Elle affiche son issue, et rien d'autre.
 */
export async function loadTimelineProjectChanges(
  db: DatabaseClient,
  project: { id: string },
  proposals: readonly ReplanProposalRecord[],
  planning: ReplanPlanningState,
  current: ProjectStructuredState,
): Promise<TimelineProjectChange[]> {
  const codeByTaskId = taskCodes(planning);
  const editable = planning.tasks.filter((task) => task.classified.editable);
  const changes: TimelineProjectChange[] = [];

  for (const proposal of proposals) {
    if (proposal.projectId !== project.id) {
      continue;
    }

    const pending = proposal.status === REPLAN_PROPOSAL_STATUS.PENDING;
    const provided = pending ? readProvidedProposal(proposal.providerJson) : null;
    const diff = pending
      ? buildReplanDiff({
          current: editable,
          target: providedApplyItems(provided),
          codeByTaskId,
        })
      : null;

    let briefChanges = 0;
    let planChanges = 0;
    if (pending && proposal.projectUpdateId !== null) {
      const update = await getArchitectProjectUpdate(db, proposal.projectUpdateId);
      if (update !== null && update.status === ARCHITECT_PROJECT_UPDATE_STATUS.PENDING) {
        const review = projectUpdateReview(current, update.proposed);
        briefChanges = review.brief.fields.filter((field) => field.changed).length;
        planChanges = review.plan.fields.filter((field) => field.changed).length;
      }
    }

    changes.push({
      generationId: proposal.generationId,
      proposalId: proposal.id,
      updateId: proposal.projectUpdateId,
      status: proposal.status,
      briefChanges,
      planChanges,
      added: diff?.summary.added ?? 0,
      updated: diff?.summary.updated ?? 0,
      removed: diff?.summary.removed ?? 0,
      orderChanged: diff?.orderChanged ?? false,
      stale: pending && replanStaleness(proposal, planning, current).any,
    });
  }

  return changes;
}
