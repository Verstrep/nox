/**
 * Affichage de la correction ciblee.
 *
 * Fonctions pures : URL, libelles, messages de refus. Aucune ne lit la base ni le
 * disque, ce qui les rend directement testables — et surtout, ce sont les memes
 * qui decident de l'affichage d'un bouton et du message d'un refus. Deux
 * implementations divergeraient, et c'est l'interface qui aurait raison a tort.
 */

import { RESUME_REFUSAL, type ResumeRefusal } from "@nox/shared";

/** Page du formulaire de feedback d'une execution relue. */
export function requestChangesUrl(projectId: string, taskId: string, runId: string): string {
  return `/projects/${projectId}/tasks/${taskId}/runs/${runId}/request-changes`;
}

/** Page de preparation d'une correction, a partir d'un feedback enregistre. */
export function correctionUrl(
  projectId: string,
  taskId: string,
  runId: string,
  feedbackId: string,
): string {
  return `/projects/${projectId}/tasks/${taskId}/runs/${runId}/corrections/${feedbackId}`;
}

/**
 * Pourquoi cette execution ne peut pas etre reprise.
 *
 * Chaque message dit ce qui bloque **et** ce que l'utilisateur peut faire. Un
 * refus qu'on ne sait pas lever est un refus qui donne l'impression d'un bug.
 */
const REFUSAL_MESSAGES: Record<ResumeRefusal, string> = {
  [RESUME_REFUSAL.RUN_NOT_COMPLETED]:
    "Seule une execution terminee avec succes peut etre reprise. Une execution echouee, bloquee ou annulee a laisse un etat que NOX ne sait pas rattacher a une session : relancez une nouvelle execution depuis un repository propre.",
  [RESUME_REFUSAL.TASK_NOT_IN_REVIEW]:
    "Cette tache n'est plus en review. Seule une tache en attente de decision peut recevoir une demande de correction.",
  [RESUME_REFUSAL.GIT_POLICY_VIOLATION]:
    "Cette execution a modifie l'etat Git alors que c'etait interdit. Son point de depart n'est plus identifiable, et une correction produirait un resultat ininterpretable. Verifiez le repository avant toute suite.",
  [RESUME_REFUSAL.SESSION_MISSING]:
    "Claude Code n'a rapporte aucun identifiant de session pour cette execution. Il n'y a donc aucune conversation a reprendre.",
  [RESUME_REFUSAL.REVIEW_MISSING]:
    "Cette execution n'a pas de review detaillee : elle est anterieure a la review integree. Sans instantane, NOX ne peut pas verifier que le dossier de travail est encore celui qui a ete relu.",
  [RESUME_REFUSAL.FINGERPRINT_MISSING]:
    "Cette execution est anterieure a la reprise ciblee : NOX n'a pas enregistre l'empreinte de son dossier de travail. Reconstituer cette empreinte aujourd'hui decrirait l'etat actuel en pretendant decrire celui de l'execution, ce que NOX ne fait pas.",
  [RESUME_REFUSAL.RUN_ACTIVE]:
    "Une execution est deja en cours. NOX n'en lance qu'une a la fois : attendez sa fin avant de demander une correction.",
  [RESUME_REFUSAL.ALREADY_CORRECTED]:
    "Une correction a deja ete lancee depuis cette review. Relisez la review de la correction, et repartez de la si besoin.",
};

export function resumeRefusalMessage(refusal: ResumeRefusal): string {
  return REFUSAL_MESSAGES[refusal];
}

/** Etat d'une precondition affichee sur la page de preparation. */
export type PreconditionState = "met" | "unmet";

export type Precondition = {
  label: string;
  state: PreconditionState;
  /** Precise ce qui manque, uniquement lorsque la precondition n'est pas tenue. */
  detail: string | null;
};

/**
 * Construit la liste des preconditions affichees avant un lancement.
 *
 * Les libelles restent en anglais, comme les statuts techniques de TASK-009 ;
 * les explications, elles, sont en francais. La coche n'est jamais seule : chaque
 * ligne porte un mot — `OK` ou `Blocked` — parce qu'une information qui n'existe
 * que par la couleur n'existe pas pour tout le monde.
 */
export function buildPreconditions(input: {
  taskInReview: boolean;
  runCompleted: boolean;
  sessionAvailable: boolean;
  reviewAvailable: boolean;
  workspaceMatches: boolean;
  gitUnchanged: boolean;
  claudeAvailable: boolean;
  workspaceDetail: string | null;
}): Precondition[] {
  return [
    { label: "Task is in Review", state: input.taskInReview ? "met" : "unmet", detail: null },
    { label: "Source run completed", state: input.runCompleted ? "met" : "unmet", detail: null },
    {
      label: "Claude session available",
      state: input.sessionAvailable ? "met" : "unmet",
      detail: null,
    },
    {
      label: "Review snapshot available",
      state: input.reviewAvailable ? "met" : "unmet",
      detail: null,
    },
    {
      label: "Git branch and HEAD unchanged",
      state: input.gitUnchanged ? "met" : "unmet",
      detail: null,
    },
    {
      label: "Repository matches reviewed state",
      state: input.workspaceMatches ? "met" : "unmet",
      detail: input.workspaceMatches ? null : input.workspaceDetail,
    },
    { label: "Claude Code available", state: input.claudeAvailable ? "met" : "unmet", detail: null },
  ];
}

/** Toutes les preconditions sont-elles tenues ? */
export function allPreconditionsMet(preconditions: readonly Precondition[]): boolean {
  return preconditions.every((entry) => entry.state === "met");
}

/**
 * Extrait de feedback pour un affichage compact.
 *
 * Coupe sur la longueur, jamais sur le sens : le texte complet reste affiche
 * ailleurs sur la page. Les fins de ligne deviennent des espaces pour tenir sur
 * une ligne.
 */
export function feedbackExcerpt(text: string, maxLength = 140): string {
  const single = text.replace(/\s+/gu, " ").trim();
  return single.length <= maxLength ? single : `${single.slice(0, maxLength - 1)}…`;
}
