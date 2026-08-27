/**
 * Affichage de la file d'execution.
 *
 * Ce module ne decide de rien : il traduit des etats deja derives en URL, en
 * libelles et en phrases. Les preconditions, les verrous et la selection
 * appartiennent au serveur ; les redire ici les ferait diverger le jour ou l'une
 * des deux changerait.
 *
 * Pur et sans dependance : ni base, ni React, ni reseau.
 */

import {
  CORRECTION_STAGE,
  EXECUTION_QUEUE_ERROR,
  MAX_AUTOMATED_CORRECTION_ATTEMPTS,
  QUEUE_DISPATCH,
  QUEUE_STATE,
  REVIEW_WAIT,
  type CorrectionCycleState,
  type ExecutionQueueErrorCode,
  type QueueDispatchOutcome,
  type QueueState,
  type ReviewWait,
} from "@nox/shared";

import { correctionStageDetail, correctionStageLabel } from "./correction-display.ts";

/** Page de la file d'execution d'un projet. */
export function queueUrl(projectId: string): string {
  return `/projects/${projectId}/queue`;
}

/**
 * Libelle de l'etat de la file.
 *
 * En anglais, comme les autres pastilles techniques de NOX : ce sont des
 * etiquettes, pas des phrases.
 */
const QUEUE_STATE_LABELS: Record<QueueState, string> = {
  [QUEUE_STATE.PAUSED]: "Paused",
  [QUEUE_STATE.EMPTY]: "Queue empty",
  [QUEUE_STATE.READY_TO_START]: "Ready to start",
  [QUEUE_STATE.RUNNING]: "Running",
  [QUEUE_STATE.WAITING_REVIEW]: "Waiting for review",
  [QUEUE_STATE.WAITING_DEPENDENCIES]: "Waiting for dependencies",
  [QUEUE_STATE.WAITING_REPOSITORY]: "Waiting for repository readiness",
  [QUEUE_STATE.FAILED_CURRENT]: "Queue paused — current task failed",
  [QUEUE_STATE.WAITING_CURRENT_TASK]: "Waiting for the current task",
};

export function queueStateLabel(state: QueueState): string {
  return QUEUE_STATE_LABELS[state];
}

/**
 * Ce que l'etat veut dire, et ce qu'il reste a faire.
 *
 * Chaque phrase dit un fait **et** l'issue. Un blocage qu'on ne sait pas lever
 * se lit comme une panne ; un blocage qui semble tout arreter alors qu'il suffit
 * d'un clic se lit comme un bug.
 */
const QUEUE_STATE_EXPLANATIONS: Record<QueueState, string> = {
  [QUEUE_STATE.PAUSED]:
    "Des tâches attendent, mais NOX n'a pas l'autorisation d'en lancer. Démarrez la file quand vous voulez qu'elle avance.",
  [QUEUE_STATE.EMPTY]:
    "Aucune tâche n'est inscrite. Ajoutez-en depuis la page d'une tâche prête : l'inscription ne lance rien.",
  [QUEUE_STATE.READY_TO_START]:
    "Une tâche pourrait partir dès que vous démarrez la file.",
  [QUEUE_STATE.RUNNING]:
    "Claude Code travaille sur la tâche courante. La file attendra qu'elle soit acceptée avant de passer à la suivante.",
  [QUEUE_STATE.WAITING_REVIEW]:
    "La tâche courante attend votre relecture. Une exécution terminée n'est pas un travail accepté : la file ne repart qu'après un Approve.",
  [QUEUE_STATE.WAITING_DEPENDENCIES]:
    "Aucune tâche inscrite n'est lançable : toutes attendent une dépendance non terminée. Leur tour viendra sans que vous ayez à les réordonner.",
  [QUEUE_STATE.WAITING_REPOSITORY]:
    "Une tâche est prête, mais le repository ne satisfait pas les préconditions de lancement — le plus souvent des modifications non commitées. Commitez, puis relancez la file avec Try next.",
  [QUEUE_STATE.FAILED_CURRENT]:
    "La tâche courante s'est mal terminée, et la file a été mise en pause. NOX ne passe jamais à la suivante après un échec : reprenez cette tâche, ou retirez-la de la file.",
  [QUEUE_STATE.WAITING_CURRENT_TASK]:
    "La tâche courante a été rouverte : son travail a commencé, et n'a pas été accepté. Elle reste " +
    "en tête de file — reprenez-la depuis sa page, ou retirez-la de la file. Ni la file, ni Try " +
    "next ne la relanceront à votre place.",
};

export function queueStateExplanation(state: QueueState): string {
  return QUEUE_STATE_EXPLANATIONS[state];
}

/**
 * Ce que la tache courante attend, dit precisement.
 *
 * « Waiting for review » couvrait quatre situations qui n'appellent pas le meme
 * geste : attendre un resultat, corriger un echec, relancer une panne, ou
 * cocher deux cases. Les confondre laisse l'utilisateur devant une file qui ne
 * bouge pas sans lui dire pourquoi.
 *
 * Le decompte des criteres humains est affiche : « il vous reste deux choses a
 * regarder » est actionnable la ou « relisez » ne l'est pas.
 */
export function queueReviewLabel(wait: ReviewWait, correction: CorrectionCycleState | null = null): string {
  // Le cycle de correction prime sur l'attente de review : « la file ne repart
  // pas parce que NOX corrige » et « la file ne repart pas parce qu'elle attend
  // votre relecture » appellent deux gestes differents — dont l'un est « ne
  // rien faire ».
  if (correction !== null) {
    switch (correction.stage) {
      case CORRECTION_STAGE.RUNNING:
      case CORRECTION_STAGE.RESERVED:
        return correctionStageLabel(correction);
      case CORRECTION_STAGE.LIMIT_REACHED:
        return "Automatic correction limit reached — human action required";
      default:
        break;
    }
  }

  switch (wait.kind) {
    case REVIEW_WAIT.VALIDATION_RUNNING:
      return "Automated validation running";
    case REVIEW_WAIT.VALIDATION_FAILED:
      return correction !== null && correction.automatedAttempts < correction.maxAutomatedAttempts
        ? `Automated validation failed — automatic correction ${String(correction.automatedAttempts + 1)} of ${String(correction.maxAutomatedAttempts)}`
        : "Automated validation failed";
    case REVIEW_WAIT.VALIDATION_ERROR:
      return "Automated validation could not run";
    case REVIEW_WAIT.HUMAN_CHECKS:
      return wait.humanCheckCount === 1
        ? "Waiting for human validation · 1 check"
        : `Waiting for human validation · ${String(wait.humanCheckCount)} checks`;
    default:
      return QUEUE_STATE_LABELS[QUEUE_STATE.WAITING_REVIEW];
  }
}

/** Ce que ce meme etat veut dire, et ce qu'il reste a faire. */
export function queueReviewExplanation(
  wait: ReviewWait,
  correction: CorrectionCycleState | null = null,
): string {
  if (correction !== null) {
    const detail = correctionStageDetail(correction);
    if (
      detail !== null &&
      (correction.stage === CORRECTION_STAGE.LIMIT_REACHED ||
        correction.stage === CORRECTION_STAGE.RESERVED)
    ) {
      return detail;
    }
    if (correction.stage === CORRECTION_STAGE.RUNNING) {
      return "NOX a relancé Claude Code sur cette tâche à partir d'un échec qu'il a constaté lui-même. La file attend la fin de cette correction, puis une nouvelle validation complète.";
    }
  }

  switch (wait.kind) {
    case REVIEW_WAIT.VALIDATION_RUNNING:
      return "NOX exécute lui-même les validations enregistrées sur cette tâche. Aucune décision n'est possible avant leur résultat — accepter maintenant reviendrait à conclure sans la preuve qu'on est en train d'obtenir.";
    case REVIEW_WAIT.VALIDATION_FAILED:
      return "Une validation exécutée par NOX a échoué. La file ne repartira pas : demandez une correction, ou acceptez explicitement malgré ce résultat depuis la review.";
    case REVIEW_WAIT.VALIDATION_ERROR:
      return "NOX n'a pas pu obtenir de preuve — le plus souvent parce que le runner ne répondait pas. Relancez la validation depuis la review : « je n'ai pas pu regarder » n'est pas « j'ai regardé et c'est faux ».";
    case REVIEW_WAIT.HUMAN_CHECKS:
      return "Cette tâche porte des critères que seul un humain peut vérifier. Confirmez-les un par un depuis la review : NOX ne peut pas le faire à votre place, et la file attend cette confirmation.";
    default:
      return QUEUE_STATE_EXPLANATIONS[QUEUE_STATE.WAITING_REVIEW];
  }
}

/**
 * Texte de l'autorisation permanente, affiche avant de demarrer la file.
 *
 * Il dit exactement ce que le clic engage : NOX pourra lancer des taches sans
 * redemander, **et** reprendre un travail dont une validation autonome a
 * echoue, dans une limite ecrite. Rien de cache, et une seule fois — pas une
 * fenetre par tache, pas une fenetre par correction.
 *
 * Le perimetre est annonce avant le clic, jamais decouvert apres : une
 * autorisation qui s'elargit en silence n'est plus une autorisation.
 */
export const QUEUE_STANDING_AUTHORIZATION =
  "Une fois la file active, NOX peut lancer automatiquement les tâches inscrites dès qu'elles " +
  "deviennent éligibles, et effectuer au plus " +
  `${String(MAX_AUTOMATED_CORRECTION_ATTEMPTS)} corrections par tâche lorsque les validations ` +
  "qu'il exécute lui-même échouent. Les reviews, les échecs d'exécution et les préconditions du " +
  "repository interrompent cette progression. Aucune tâche n'est jamais lancée sans être déjà " +
  "inscrite, et aucune correction n'est lancée sans un échec que NOX a constaté lui-même.";

/** Rappel de la règle d'ordre, affiché sur la page de la file. */
export const QUEUE_ORDER_NOTICE =
  "NOX lance la première tâche inscrite qui est éligible ; celles qui attendent une dépendance " +
  "sont sautées jusqu'à ce que leurs prérequis soient terminés, et gardent leur place.";

/** L'inscription ne lance rien : dit sur le bouton, pas seulement en note. */
export const QUEUE_ENQUEUE_NOTICE =
  "Inscrire une tâche ne lance rien. Elle partira quand vous démarrerez la file et que ses " +
  "conditions seront réunies.";

export const QUEUE_ENQUEUE_ACTIVE_NOTICE =
  "La file est active : cette tâche peut démarrer immédiatement si elle est éligible.";

/** Refus des operations de file, traduits pour l'utilisateur. */
const QUEUE_ERROR_MESSAGES: Record<ExecutionQueueErrorCode, string> = {
  [EXECUTION_QUEUE_ERROR.TASK_NOT_FOUND]:
    "Cette tâche n'existe pas dans ce projet. Revenez au backlog et rouvrez-la.",
  [EXECUTION_QUEUE_ERROR.TASK_NOT_READY]:
    "Seule une tâche « Ready » peut entrer dans la file. Passez-la en Ready, puis réessayez.",
  [EXECUTION_QUEUE_ERROR.TASK_ALREADY_QUEUED]: "Cette tâche est déjà inscrite dans la file.",
  [EXECUTION_QUEUE_ERROR.BOOTSTRAP_NOT_QUEUEABLE]:
    "L'amorçage ne passe pas par la file. TASK-000 prépare la fondation du repository avec des " +
    "permissions élargies : elle se lance depuis sa propre page, explicitement.",
  [EXECUTION_QUEUE_ERROR.TASK_HAS_ACTIVE_RUN]:
    "Une exécution travaille sur cette tâche. Attendez sa fin avant de modifier la file.",
  [EXECUTION_QUEUE_ERROR.ENTRY_NOT_FOUND]: "Cette tâche n'est pas inscrite dans la file.",
  [EXECUTION_QUEUE_ERROR.QUEUE_EMPTY]:
    "La file est vide : il n'y a rien à démarrer. Inscrivez au moins une tâche prête.",
};

export function queueErrorMessage(code: ExecutionQueueErrorCode): string {
  return QUEUE_ERROR_MESSAGES[code];
}

/** Refus d'un lancement manuel initial pendant qu'une file attend. */
export const QUEUE_PENDING_MESSAGE =
  "Ce projet possède une file d'exécution. Démarrez-la, ou retirez cette tâche de la file avant " +
  "de la lancer directement — pour que l'ordre que vous avez préparé ne soit pas contourné par " +
  "accident.";

/** Refus des gestes qui contrediraient une inscription. */
export const TASK_QUEUED_MESSAGE =
  "Cette tâche est inscrite dans la file d'exécution. Retirez-la de la file avant de la " +
  "modifier, de changer son statut ou de la supprimer : une inscription autorise l'exécution de " +
  "son contrat actuel.";

/**
 * Ce qu'une tentative d'avancement a produit.
 *
 * `STARTED` est le seul resultat qui a lance quelque chose. Tous les autres
 * disent pourquoi rien n'est parti — et aucun n'est une erreur : une file qui
 * attend une review fonctionne exactement comme prevu.
 */
const DISPATCH_MESSAGES: Record<QueueDispatchOutcome, string> = {
  [QUEUE_DISPATCH.STARTED]: "Une exécution vient de démarrer.",
  [QUEUE_DISPATCH.PAUSED]: "La file est en pause : rien n'a été lancé.",
  [QUEUE_DISPATCH.EMPTY]: "La file est vide : rien n'a été lancé.",
  [QUEUE_DISPATCH.WAITING_REVIEW]:
    "La tâche courante attend une décision de review : la file ne passe pas à la suivante.",
  [QUEUE_DISPATCH.WAITING_DEPENDENCIES]:
    "Aucune tâche inscrite n'est éligible : toutes attendent une dépendance non terminée.",
  [QUEUE_DISPATCH.WAITING_DELIVERY]:
    "Le travail validé n'a pas encore été livré : la politique Git de ce projet n'est pas " +
    "satisfaite. Ouvrez la livraison pour voir ce qui la bloque.",
  [QUEUE_DISPATCH.WAITING_REPOSITORY]:
    "Le repository ne satisfait pas les préconditions de lancement. Commitez vos changements, puis relancez avec Try next.",
  [QUEUE_DISPATCH.ACTIVE_RUN]:
    "Une exécution est déjà en cours. NOX n'en lance qu'une à la fois, tous projets confondus.",
  [QUEUE_DISPATCH.FAILED_CURRENT]:
    "La tâche courante s'est mal terminée. Reprenez-la ou retirez-la de la file avant de continuer.",
  [QUEUE_DISPATCH.WAITING_CURRENT_TASK]:
    "La tâche courante a été rouverte et attend sa reprise. Relancez-la depuis sa page, ou retirez-la " +
    "de la file : NOX ne relance pas de lui-même un travail qui vient d'être refusé.",
  [QUEUE_DISPATCH.REFUSED]: "Le lancement a été refusé.",
};

export function dispatchMessage(outcome: QueueDispatchOutcome): string {
  return DISPATCH_MESSAGES[outcome];
}

/** Une tentative d'avancement a-t-elle lance quelque chose ? */
export function dispatchStarted(outcome: QueueDispatchOutcome): boolean {
  return outcome === QUEUE_DISPATCH.STARTED;
}

/** « 3 queued », « 1 queued », ou `null` quand la file est vide. */
export function queuedCountLabel(count: number): string | null {
  return count === 0 ? null : `${String(count)} queued`;
}
