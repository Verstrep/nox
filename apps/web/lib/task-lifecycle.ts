/**
 * Transitions de statut, et ce qu'elles declenchent.
 *
 * ## Pourquoi ce module existe
 *
 * Accepter une tache est le seul evenement qui fait avancer la file. Il se
 * produit depuis deux surfaces — la decision de review et le bouton « Mark
 * done » de la page d'une tache — et il en existera d'autres. Mettre
 * `advanceQueue` dans un composant reviendrait a esperer que chaque nouvelle
 * surface y pense ; le mettre ici garantit que non.
 *
 * ## Ce que l'avancement n'est pas
 *
 * Ce n'est pas une boucle. Un appel demarre au plus une execution, et seulement
 * si la file est active, si la barriere courante a disparu, si une entree est
 * eligible et si le repository est pret. Le refus est la reponse normale, pas
 * une exception.
 */

import { getDatabaseClient, updateTaskStatus, type DatabaseClient } from "@nox/database";
import { TASK_STATUS, type TaskStatus } from "@nox/shared";

import { advanceQueue, type AdvanceQueueResult } from "./queue.ts";

export const UNKNOWN_TASK_MESSAGE =
  "Cette tache n'existe pas dans ce projet. Revenez au backlog et rouvrez-la.";

export const FORBIDDEN_TRANSITION_MESSAGE =
  "Ce changement de statut n'est pas autorise depuis l'etat actuel de la tache. " +
  "Rechargez la page pour voir les transitions possibles.";

export type TaskTransitionOutcome =
  | {
      ok: true;
      /** L'inscription de la tache a ete retiree parce qu'elle est acceptee. */
      dequeued: boolean;
      /** Resultat de la tentative d'avancement, `null` si aucune n'a eu lieu. */
      dispatch: AdvanceQueueResult | null;
    }
  | { ok: false; message: string };

/**
 * Applique une transition de statut, puis tente de faire avancer la file.
 *
 * L'avancement n'est tente **que** lorsque la tache vient d'etre acceptee. Une
 * mise en review, un retour en brouillon ou une reouverture ne liberent rien :
 * ils ne changent pas la barriere courante, ou la remettent en place.
 *
 * `updateTaskStatus` reste la seule autorite sur l'ecriture : il verifie la
 * table des transitions, refuse une tache inscrite qu'on voudrait mettre de
 * cote, retire l'inscription d'une tache acceptee et referme l'autorisation
 * quand la file se vide — le tout dans une seule transaction.
 */
export async function applyTaskTransition(
  db: DatabaseClient,
  input: { projectId: string; taskId: string; status: TaskStatus },
): Promise<TaskTransitionOutcome> {
  const result = await updateTaskStatus(db, input.taskId, input.projectId, input.status);

  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return { ok: false, message: UNKNOWN_TASK_MESSAGE };
      case "queued":
        return { ok: false, message: QUEUED_TRANSITION_MESSAGE };
      case "forbidden_transition":
        return { ok: false, message: FORBIDDEN_TRANSITION_MESSAGE };
    }
  }

  // Une tache acceptee libere la file : c'est `COMPLETED`, et rien d'autre, qui
  // la fait avancer. Un run techniquement termine mene a `REVIEW`, ce qui n'est
  // pas une acceptation.
  const dispatch =
    input.status === TASK_STATUS.COMPLETED
      ? await advanceQueue(db, input.projectId)
      : null;

  return { ok: true, dequeued: result.dequeued, dispatch };
}

/** Variante qui prend le client par defaut, pour les Server Actions. */
export function applyTaskTransitionWithDefaultClient(input: {
  projectId: string;
  taskId: string;
  status: TaskStatus;
}): Promise<TaskTransitionOutcome> {
  return applyTaskTransition(getDatabaseClient(), input);
}

const QUEUED_TRANSITION_MESSAGE =
  "Cette tache est inscrite dans la file d'execution : elle ne peut pas etre remise en brouillon " +
  "ni bloquee tant qu'elle y figure. Retirez-la de la file, puis reessayez.";

export { QUEUED_TRANSITION_MESSAGE };
