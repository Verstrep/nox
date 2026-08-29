/**
 * Lecture et avancement de la file d'execution.
 *
 * ## Le dispatcher choisit, le pipeline execute
 *
 * `advanceQueue` decide **quelle** tache part, et rien de plus. Ce qui suit —
 * preconditions, permissions, prompt, run, streaming, annulation, review — passe
 * par `launchTaskRun`, exactement comme un lancement manuel. Il n'existe pas de
 * second moteur Claude pour la file.
 *
 * ## Au plus une execution par appel
 *
 * `advanceQueue` ne boucle jamais. Un appel demarre au maximum une execution ;
 * l'avancement suivant viendra d'un evenement futur — une tache acceptee, une
 * inscription, un « Try next ». Une boucle qui viderait la file d'un coup
 * rendrait ingerables la concurrence, la review, Git, les erreurs et les limites
 * de Claude.
 *
 * ## Aucun demarrage au boot
 *
 * Rien ici n'est appele au rendu d'une page ni au demarrage du serveur.
 * `advanceQueue` ne s'execute que depuis une Server Action, c'est-a-dire apres
 * un geste humain ou un evenement applicatif. Une file laissee `ACTIVE` avant un
 * redemarrage ne produit donc aucune execution surprise : l'autorisation
 * survit, le declenchement non.
 */

import {
  getBlockingDelivery,
  getProjectById,
  isQueueActive,
  listQueueEntries,
  readProjectDeliveryPolicy,
  setQueueActive,
  type DatabaseClient,
} from "@nox/database";
import {
  LAUNCH_REFUSAL,
  QUEUE_DISPATCH,
  TASK_STATUS,
  deriveQueueState,
  summarizeTaskDependencies,
  type LaunchOutcome,
  type QueueDispatchOutcome,
  type QueueEntryFacts,
  type QueueReadModel,
  type QueueRepositoryReadiness,
} from "@nox/shared";
import type { launchTaskRun } from "./run-launch.ts";
import { claudePreflight } from "./runner/client.ts";

/** Traduit les lignes de la base en faits derives, dependances comprises. */
export function toQueueEntryFacts(
  rows: readonly {
    taskId: string;
    code: string;
    title: string;
    sequence: number;
    status: QueueEntryFacts["status"];
    dependsOn: Parameters<typeof summarizeTaskDependencies>[0]["dependsOn"];
    started: boolean;
  }[],
): QueueEntryFacts[] {
  return rows.map((row) => ({
    taskId: row.taskId,
    code: row.code,
    title: row.title,
    sequence: row.sequence,
    status: row.status,
    // La satisfaction se derive du statut courant des taches attendues, jamais
    // d'une colonne : rouvrir une tache terminee fait reapparaitre l'attente au
    // rendu suivant, sans qu'aucune ligne ne soit reecrite.
    waiting: summarizeTaskDependencies({ dependsOn: row.dependsOn, dependents: [] }).waiting,
    // Persiste, lui : c'est la seule chose qu'aucun statut ne dit. Une tache
    // rouverte est `READY` comme une tache jamais lancee.
    started: row.started,
  }));
}

/**
 * Lecture de la file, telle que les pages l'affichent.
 *
 * `repository` dit ce que l'appelant a **constate**, pas ce qu'il suppose :
 * `unknown` quand il n'a pas sonde, ce qui est le cas partout sauf sur la page
 * de la file. Ouvrir la page d'un projet ne doit interroger ni le runner, ni
 * Git.
 */
export async function readQueue(
  db: DatabaseClient,
  projectId: string,
  repository: QueueRepositoryReadiness,
): Promise<QueueReadModel> {
  const [active, rows] = await Promise.all([
    isQueueActive(db, projectId),
    listQueueEntries(db, projectId),
  ]);
  return deriveQueueState({ active, entries: toQueueEntryFacts(rows), repository });
}

export type AdvanceQueueResult = {
  outcome: QueueDispatchOutcome;
  /** Tache lancee, uniquement lorsque `outcome` vaut `STARTED`. */
  taskId: string | null;
  /** Execution creee, uniquement lorsque `outcome` vaut `STARTED`. */
  runId: string | null;
  /** Message du refus, lorsque le pipeline en a produit un. */
  message: string | null;
};

/** Acces au runner ; remplaces par des doublures dans les tests. */
export type QueueDispatchPorts = {
  preflight: typeof claudePreflight;
  launch: typeof launchTaskRun;
};

/**
 * Le moteur de lancement est charge **a la demande**.
 *
 * Le dispatcher n'a besoin de lui qu'au moment ou il lance ; l'importer
 * statiquement tirerait avec lui tout ce que ce moteur importe, dont des
 * modules Next.js — et rendrait le dispatcher intestable hors de
 * l'application. Le vocabulaire des refus, lui, vit dans `@nox/shared` :
 * lire un code d'erreur ne doit rien couter.
 */
const DISPATCH_PORTS: QueueDispatchPorts = {
  preflight: claudePreflight,
  launch: async (db, input) => {
    const { launchTaskRun: launch } = await import("./run-launch.ts");
    return launch(db, input);
  },
};

function result(
  outcome: QueueDispatchOutcome,
  extra: Partial<Omit<AdvanceQueueResult, "outcome">> = {},
): AdvanceQueueResult {
  return {
    outcome,
    taskId: extra.taskId ?? null,
    runId: extra.runId ?? null,
    message: extra.message ?? null,
  };
}

/**
 * Tente de faire avancer la file d'un projet.
 *
 * L'ordre des refus va du moins couteux au plus couteux : l'autorisation, puis
 * la file, puis la barriere courante, puis les dependances, puis le repository.
 * Une file en pause ne doit rien couter du tout — ni requete au runner, ni
 * inspection Git.
 */
export async function advanceQueue(
  db: DatabaseClient,
  projectId: string,
  ports: QueueDispatchPorts = DISPATCH_PORTS,
): Promise<AdvanceQueueResult> {
  const model = await readQueue(db, projectId, "unknown");

  if (model.queuedCount === 0) {
    // Une file vide ne conserve aucune autorisation dormante.
    if (model.active) {
      await setQueueActive(db, projectId, false);
    }
    return result(QUEUE_DISPATCH.EMPTY);
  }

  if (!model.active) {
    return result(QUEUE_DISPATCH.PAUSED);
  }

  // La barriere courante : une tache commencee depuis cette file et pas encore
  // acceptee. Tant qu'elle est la, la suivante ne part pas — un travail commence
  // n'est pas un travail termine.
  if (model.current !== null) {
    switch (model.current.status) {
      case TASK_STATUS.RUNNING:
        return result(QUEUE_DISPATCH.ACTIVE_RUN, { taskId: model.current.taskId });
      case TASK_STATUS.REVIEW:
        return result(QUEUE_DISPATCH.WAITING_REVIEW, { taskId: model.current.taskId });
      // Rouverte. Elle est `READY`, et la file ne la relance pas : reprendre un
      // travail refuse est une decision, et elle se prend sur la page de la
      // tache. « Try next » n'est pas un bouton de reprise.
      case TASK_STATUS.READY:
        return result(QUEUE_DISPATCH.WAITING_CURRENT_TASK, { taskId: model.current.taskId });
      default:
        return result(QUEUE_DISPATCH.FAILED_CURRENT, { taskId: model.current.taskId });
    }
  }

  if (model.nextEligible === null) {
    return result(QUEUE_DISPATCH.WAITING_DEPENDENCIES);
  }

  const project = await getProjectById(db, projectId);
  if (project === null) {
    return result(QUEUE_DISPATCH.EMPTY);
  }

  // La politique Git du projet, avant le preflight. Une livraison dont la
  // politique enregistree n'est pas satisfaite arrete la progression : lancer
  // la tache suivante par-dessus un travail non livre melangerait deux taches
  // dans un meme commit, ou laisserait le premier travail indefiniment en
  // attente. Une livraison `MANUAL` n'est jamais bloquante — ce mode confie la
  // question au preflight existant, exactement comme avant TASK-029.
  //
  // Aucune ecriture Git n'a lieu ici : c'est une lecture SQLite. La livraison
  // est declenchee par la **transition** d'une tache vers `COMPLETED`, jamais
  // par un avancement de file.
  const blocking = await getBlockingDelivery(db, projectId);
  if (blocking !== null) {
    return result(QUEUE_DISPATCH.WAITING_DELIVERY, { taskId: blocking.taskId });
  }

  // Le preflight existant, tel quel — a une nuance pres, et une seule : il sait
  // desormais ce que le projet autorise NOX a ecrire. Un repository qui porte
  // des modifications non commitees arrete toujours la progression ; une branche
  // en avance parce que NOX vient de commiter sous `AUTO_COMMIT` ne l'arrete
  // plus, parce que c'est exactement l'etat que cette politique produit.
  //
  // La politique est relue en base ici, jamais recue : c'est un droit d'ecriture
  // dans Git, il ne peut pas venir d'ailleurs.
  const policy = await readProjectDeliveryPolicy(db, projectId);
  const preflight = await ports.preflight(project.repositoryPath, policy);
  if (!preflight.ok) {
    return result(QUEUE_DISPATCH.WAITING_REPOSITORY);
  }

  const launched: LaunchOutcome = await ports.launch(db, {
    projectId,
    taskId: model.nextEligible.taskId,
    expectedGitHead: preflight.value.git.head,
  });

  if (!launched.ok) {
    // Le pipeline a refuse au dernier moment : c'est lui qui fait autorite, et
    // son refus est rapporte tel quel plutot que reinterprete.
    return result(
      launched.code === LAUNCH_REFUSAL.ACTIVE_RUN
        ? QUEUE_DISPATCH.ACTIVE_RUN
        : QUEUE_DISPATCH.REFUSED,
      { taskId: model.nextEligible.taskId, message: launched.message },
    );
  }

  return result(QUEUE_DISPATCH.STARTED, {
    taskId: model.nextEligible.taskId,
    runId: launched.runId,
  });
}
