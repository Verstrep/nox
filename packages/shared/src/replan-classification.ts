/**
 * Ce qu'un replan a le droit de toucher, et ce qu'il ne touchera jamais.
 *
 * ## Une seule autorite : celle de TASK-024
 *
 * Une tache est **modifiable** par un replan exactement quand elle l'est par
 * l'editeur de tache future, plus une condition de nature. Rien de plus
 * permissif, jamais : un replan qui pourrait reecrire ce que l'editeur refuse
 * serait un second chemin d'edition, plus faible, et le jour ou les deux
 * divergeraient, c'est celui qui laisse passer qui gagnerait.
 *
 * Les regles reutilisees sont donc celles-la, et elles sont importees :
 *
 * - `runCount === 0` — le seul critere qui compte pour l'historique. Une tache
 *   passee en `FAILED` puis rouverte a un passe, donc elle est figee, meme si
 *   son statut ressemble a celui d'une tache neuve ;
 * - `DRAFT` ou `READY` — les deux statuts d'avant-execution ;
 * - non inscrite dans la file — une inscription est un ordre deja prepare ;
 * - de nature `NORMAL` — `TASK-000` n'est jamais replanifiee.
 *
 * ## Pourquoi les taches verrouillees restent visibles
 *
 * Parce qu'un plan se concoit contre ce qui existe deja. Un architecte qui ne
 * verrait que les taches modifiables reproposerait du travail termine, ou
 * ferait attendre une tache qui n'existe pas. Il les voit donc — en inventaire
 * compact, jamais en contrat complet — et il ne peut pas les reecrire.
 *
 * Module **pur** : ni base, ni disque, ni reseau.
 */

import { createStatusGuard } from "./statuses.js";
import { TASK_STATUS, type TaskStatus } from "./statuses.js";
import { checkTaskEditable } from "./task-edit.js";
import { TASK_KIND, type TaskKind } from "./tasks.js";

/**
 * Pourquoi une tache est verrouillee.
 *
 * Nommee, jamais deduite a l'affichage. « Cette tache a deja tourne » et « cette
 * tache est inscrite en file » demandent deux gestes differents de la part de
 * l'utilisateur, et un ecran qui dirait seulement « verrouillee » le laisserait
 * chercher.
 */
export const REPLAN_LOCK_REASON = {
  /** Tache d'amorcage : son contrat n'est jamais replanifie. */
  BOOTSTRAP: "BOOTSTRAP",
  /** Elle possede un historique d'execution : le passe est immuable. */
  STARTED: "STARTED",
  /** Son statut n'est pas un statut d'avant-execution. */
  STATUS: "STATUS",
  /** Elle est inscrite dans la file : un ordre est deja prepare. */
  QUEUED: "QUEUED",
} as const;

export type ReplanLockReason = (typeof REPLAN_LOCK_REASON)[keyof typeof REPLAN_LOCK_REASON];

export const REPLAN_LOCK_REASONS: readonly ReplanLockReason[] = Object.values(REPLAN_LOCK_REASON);

export const isReplanLockReason = createStatusGuard(REPLAN_LOCK_REASONS);

/**
 * Les faits, relus en base, qui decident du sort d'une tache.
 *
 * Tous viennent du serveur. Le navigateur n'en fournit aucun : il ne dit jamais
 * « cette tache est modifiable », il transmet un identifiant de projet.
 */
export type ReplanTaskFacts = {
  id: string;
  code: string;
  kind: TaskKind;
  status: TaskStatus;
  /** Nombre d'executions. Jamais recu du navigateur. */
  runCount: number;
  /** Inscription dans la file d'execution du projet. */
  queued: boolean;
};

export type ReplanClassifiedTask = ReplanTaskFacts &
  ({ editable: true; lockReason: null } | { editable: false; lockReason: ReplanLockReason });

/**
 * Classe une tache.
 *
 * L'ordre des refus est celui de la lisibilite, pas celui du hasard : la nature
 * d'abord, parce qu'une tache d'amorcage n'a rien a voir avec le reste ; le
 * passe ensuite, parce que c'est l'invariant central ; la file en dernier,
 * parce que c'est le seul refus que l'utilisateur peut lever d'un clic.
 */
export function classifyReplanTask(facts: ReplanTaskFacts): ReplanClassifiedTask {
  if (facts.kind !== TASK_KIND.NORMAL) {
    return { ...facts, editable: false, lockReason: REPLAN_LOCK_REASON.BOOTSTRAP };
  }

  const gate = checkTaskEditable({ status: facts.status, runCount: facts.runCount });
  if (!gate.ok) {
    return {
      ...facts,
      editable: false,
      lockReason:
        facts.runCount > 0 ? REPLAN_LOCK_REASON.STARTED : REPLAN_LOCK_REASON.STATUS,
    };
  }

  if (facts.queued) {
    return { ...facts, editable: false, lockReason: REPLAN_LOCK_REASON.QUEUED };
  }

  return { ...facts, editable: true, lockReason: null };
}

/** Classe tout un projet, en conservant l'ordre recu. */
export function classifyReplanTasks(
  tasks: readonly ReplanTaskFacts[],
): ReplanClassifiedTask[] {
  return tasks.map(classifyReplanTask);
}

/**
 * Une tache verrouillee est-elle du travail deja produit ?
 *
 * Sert a expliquer, jamais a autoriser : `COMPLETED` et `FAILED` racontent une
 * histoire differente d'une tache simplement mise de cote.
 */
export function lockedTaskIsHistorical(facts: ReplanTaskFacts): boolean {
  return (
    facts.runCount > 0 ||
    facts.status === TASK_STATUS.COMPLETED ||
    facts.status === TASK_STATUS.RUNNING ||
    facts.status === TASK_STATUS.REVIEW
  );
}

/**
 * Pourquoi un projet ne peut pas encore etre replanifie.
 *
 * Une seule raison aujourd'hui, et elle est structurante : la replanification
 * n'est pas un second chemin de planification initiale. Un projet qui n'a jamais
 * eu de backlog applique doit passer par `backlog/2` — sans quoi NOX aurait deux
 * facons de creer son premier plan, et la conversation deviendrait
 * insensiblement le chemin par defaut.
 */
export const REPLAN_UNAVAILABLE = {
  /** Aucun backlog initial n'a jamais ete applique a ce projet. */
  NO_INITIAL_PLAN: "REPLAN_NO_INITIAL_PLAN",
} as const;

export type ReplanUnavailableCode =
  (typeof REPLAN_UNAVAILABLE)[keyof typeof REPLAN_UNAVAILABLE];

export type ReplanAvailability =
  | { available: true }
  | { available: false; code: ReplanUnavailableCode };

/**
 * Le projet peut-il etre replanifie ?
 *
 * Un projet dont toutes les taches sont terminees le peut : le replan y ajoutera
 * simplement de nouvelles taches futures. Ce qui compte n'est pas qu'il reste du
 * travail, c'est qu'un plan ait deja existe.
 */
export function replanAvailability(facts: { appliedBacklogCount: number }): ReplanAvailability {
  if (facts.appliedBacklogCount < 1) {
    return { available: false, code: REPLAN_UNAVAILABLE.NO_INITIAL_PLAN };
  }
  return { available: true };
}
