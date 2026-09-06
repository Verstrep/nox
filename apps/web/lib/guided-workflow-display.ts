/**
 * Presentation du workflow guide, sans React.
 *
 * La derivation vit dans `@nox/shared` et ne connait ni URL, ni libelle : elle
 * rend des `kind` et des identifiants. Ce module les traduit en destinations.
 *
 * ## Pourquoi les URL se construisent ici, et pas dans la derivation
 *
 * Une URL est une decision d'interface : elle depend du decoupage des routes,
 * qui bougera. La derivation, elle, decrit une situation metier, qui ne bougera
 * pas parce qu'une page a change de chemin. Les melanger obligerait a rejouer la
 * table de tests du workflow a chaque renommage de dossier.
 *
 * ## Les ancres
 *
 * Certaines actions — `Mark ready`, `Approve`, `Reopen`, `Delete task` — se
 * decident sur la page de la tache elle-meme, dans des sections qui existent
 * deja. Le guide y renvoie par une ancre plutot que de recopier leur formulaire :
 * un second bouton appelant la meme Server Action serait une seconde
 * implementation de la meme decision, et c'est exactement ce que TASK-016
 * refuse.
 */

import {
  GUIDED_ACTION,
  GUIDED_PROGRESS_STEP,
  type GuidedAction,
  type GuidedProgressStep,
} from "@nox/shared";

import { architectAnalysisUrl, architectReviewUrl } from "./architect/review-display.ts";
import {
  correctionFailureUrl,
  correctionUrl,
  requestChangesUrl,
} from "./correction-display.ts";
import { reviewUrl } from "./review-display.ts";
import { newRunUrl, runUrl } from "./run-display.ts";
import { queueUrl } from "./queue-display.ts";
import { taskUrl } from "./task-display.ts";

/** Identifiants des sections ancrables de la page d'une tache. */
export const TASK_SECTION_ANCHOR = {
  workflow: "workflow",
  document: "task-document",
  runs: "task-runs",
  status: "task-status",
  danger: "task-danger",
} as const;

/**
 * Destination d'une action guidee.
 *
 * Retourne `null` lorsque l'action designe une cible qui manque — une analyse
 * sans identifiant, par exemple. L'interface n'affiche alors pas le lien plutot
 * que de fabriquer une URL approximative.
 */
export function guidedActionHref(
  projectId: string,
  taskId: string,
  action: GuidedAction,
): string | null {
  const task = taskUrl(projectId, taskId);
  const anchor = (section: string) => `${task}#${section}`;
  const withRun = (build: (runId: string) => string): string | null =>
    action.runId === null ? null : build(action.runId);

  switch (action.kind) {
    case GUIDED_ACTION.OPEN_DOCUMENT:
    case GUIDED_ACTION.RESOLVE_DOCUMENT_SYNC:
      return anchor(TASK_SECTION_ANCHOR.document);

    case GUIDED_ACTION.MARK_READY:
    case GUIDED_ACTION.BACK_TO_DRAFT:
    case GUIDED_ACTION.RETRY:
    case GUIDED_ACTION.REOPEN:
      return anchor(TASK_SECTION_ANCHOR.status);

    case GUIDED_ACTION.DELETE_TASK:
      return anchor(TASK_SECTION_ANCHOR.danger);

    case GUIDED_ACTION.OPEN_RUN_HISTORY:
      return anchor(TASK_SECTION_ANCHOR.runs);

    case GUIDED_ACTION.RUN_CLAUDE:
      return newRunUrl(projectId, taskId);

    case GUIDED_ACTION.OPEN_QUEUE:
      return queueUrl(projectId);

    case GUIDED_ACTION.OPEN_RUN:
      return withRun((runId) => runUrl(projectId, taskId, runId));

    case GUIDED_ACTION.CORRECT_FAILED_RUN:
      return withRun((runId) => correctionFailureUrl(projectId, taskId, runId));

    case GUIDED_ACTION.OPEN_REVIEW:
    case GUIDED_ACTION.REVIEW_MANUALLY:
    case GUIDED_ACTION.REVIEW_AND_APPROVE:
    case GUIDED_ACTION.APPROVE:
      return withRun((runId) => reviewUrl(projectId, taskId, runId));

    case GUIDED_ACTION.ANALYZE_WITH_ARCHITECT:
      return withRun((runId) => architectReviewUrl(projectId, taskId, runId));

    case GUIDED_ACTION.OPEN_ARCHITECT_ANALYSIS:
      return action.runId === null || action.analysisId === null
        ? null
        : architectAnalysisUrl(projectId, taskId, action.runId, action.analysisId);

    case GUIDED_ACTION.USE_AS_FEEDBACK:
      return action.runId === null || action.analysisId === null
        ? null
        : `${requestChangesUrl(projectId, taskId, action.runId)}?analysis=${encodeURIComponent(action.analysisId)}`;

    case GUIDED_ACTION.REQUEST_CHANGES:
      return withRun((runId) => requestChangesUrl(projectId, taskId, runId));

    case GUIDED_ACTION.PREPARE_CORRECTION:
    case GUIDED_ACTION.RESUME_CLAUDE:
      return action.runId === null || action.feedbackId === null
        ? null
        : correctionUrl(projectId, taskId, action.runId, action.feedbackId);
  }
}

/** Retour au guide, depuis une surface d'execution ou de review. */
export function taskWorkflowUrl(projectId: string, taskId: string): string {
  return `${taskUrl(projectId, taskId)}#${TASK_SECTION_ANCHOR.workflow}`;
}

/**
 * Ordre d'affichage des etapes de progression.
 *
 * Fige ici plutot que deduit de l'ordre d'un `Object.values` : une bande de
 * progression qui changerait d'ordre au gre d'un refactoring serait illisible.
 */
export const GUIDED_PROGRESS_ORDER: readonly GuidedProgressStep[] = [
  GUIDED_PROGRESS_STEP.SPECIFICATION,
  GUIDED_PROGRESS_STEP.EXECUTION,
  GUIDED_PROGRESS_STEP.REVIEW,
  GUIDED_PROGRESS_STEP.CORRECTION,
  GUIDED_PROGRESS_STEP.DONE,
];

/**
 * Marque textuelle d'une etape.
 *
 * Le mot double toujours le symbole : une information portee par la seule
 * couleur — ou par le seul caractere — n'existe pas pour tout le monde.
 */
export function guidedProgressMark(state: "done" | "current" | "pending"): string {
  switch (state) {
    case "done":
      return "✓";
    case "current":
      return "▸";
    case "pending":
      return "—";
  }
}
