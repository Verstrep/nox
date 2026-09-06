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

import {
  countActiveRepositoryRuns,
  getDatabaseClient,
  getProjectById,
  getTaskById,
  readProjectDeliveryPolicy,
  updateTaskStatus,
  type DatabaseClient,
  type ReviewDecisionInput,
} from "@nox/database";
import type { VerificationPlanIssue } from "@nox/shared";
import { TASK_STATUS, type TaskStatus } from "@nox/shared";

import { advanceQueue, type AdvanceQueueResult } from "./queue.ts";
import { maybeDeliver, type MaybeDeliverResult } from "./git-delivery.ts";
import { claudePreflight } from "./runner/client.ts";
import { describeRunnerFailure } from "./runner/errors.ts";
import type { MaybeRefreshResult } from "./verification-refresh/service.ts";

export const UNKNOWN_TASK_MESSAGE =
  "Cette tache n'existe pas dans ce projet. Revenez au backlog et rouvrez-la.";

export const FORBIDDEN_TRANSITION_MESSAGE =
  "Ce changement de statut n'est pas autorise depuis l'etat actuel de la tache. " +
  "Rechargez la page pour voir les transitions possibles.";

/**
 * Ce qu'un `Retry` refuse dit, et ce qu'il promet.
 *
 * Les deux moities comptent autant l'une que l'autre. La premiere nomme
 * l'obstacle ; la seconde repond a la question que l'utilisateur se pose
 * vraiment devant un refus — « qu'est-ce que je viens de casser ? ». La reponse
 * est « rien », et il faut l'ecrire : le second pilote reel a vu son `Retry`
 * echouer et sa tache changer de statut quand meme.
 */
export const RETRY_BLOCKED_PREFIX =
  "Cette tache ne peut pas repartir d'une execution neuve pour le moment.";

export const RETRY_PRESERVED_SUFFIX =
  "Aucune execution n'a demarre, et la tache reste en echec — son travail partiel " +
  "et sa reprise ciblee sont intacts.";

export const RETRY_REPOSITORY_BUSY_MESSAGE =
  "Une execution Claude Code travaille deja sur ce repository. " + RETRY_PRESERVED_SUFFIX;

/** Assemble le refus d'un `Retry` : l'obstacle, puis ce qui n'a pas bouge. */
export function retryBlockedMessage(reason: string): string {
  return `${RETRY_BLOCKED_PREFIX} ${reason} ${RETRY_PRESERVED_SUFFIX}`;
}

/**
 * Acces au runner ; remplace par une doublure dans les tests.
 *
 * Une seule entree, et c'est voulu : ce service ne parle au runner que pour la
 * sonde de `Retry`. Toutes les autres transitions restent des ecritures SQLite,
 * et doivent continuer de fonctionner runner arrete.
 */
export type TaskTransitionPorts = {
  preflight: typeof claudePreflight;
};

const RUNNER_PORTS: TaskTransitionPorts = { preflight: claudePreflight };

export type TaskTransitionOutcome =
  | {
      ok: true;
      /** L'inscription de la tache a ete retiree parce qu'elle est acceptee. */
      dequeued: boolean;
      /** Resultat de la tentative d'avancement, `null` si aucune n'a eu lieu. */
      dispatch: AdvanceQueueResult | null;
      /** Livraison Git tentee apres l'acceptation, `null` si aucune n'a eu lieu. */
      delivery: MaybeDeliverResult | null;
      /**
       * Rafraichissement des plans de verification, apres un amorcage accepte.
       *
       * `null` quand la question ne s'est pas posee ; un refus nomme quand elle
       * s'est posee et que la reponse etait non. Les deux sont des informations
       * distinctes, et les confondre ferait croire qu'une amorce normale a
       * declenche un appel.
       */
      refresh: MaybeRefreshResult | null;
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
  input: {
    projectId: string;
    taskId: string;
    status: TaskStatus;
    /**
     * Comment l'acceptation a ete decidee.
     *
     * Transmise a `updateTaskStatus`, qui l'ecrit **dans** la transition. C'est
     * ce qui rend impossible qu'une acceptation humaine et une completion
     * automatique aboutissent toutes les deux : elles visent la meme ligne
     * unique par execution.
     */
    decision?: ReviewDecisionInput;
  },
  ports: TaskTransitionPorts = RUNNER_PORTS,
): Promise<TaskTransitionOutcome> {
  // ## Le seul controle prealable de ce service, et pourquoi il est ici
  //
  // `FAILED → READY` est le geste `Retry`, et il ne lance rien : le lancement
  // est une seconde action, sur une autre page. Rien ne verifiait donc qu'un
  // lancement etait seulement possible, et le second pilote reel a paye
  // exactement cela — le clic a fait passer la tache en `READY`, le lancement a
  // ensuite ete refuse parce que le repository portait le travail de l'echec, et
  // la tache est restee prete pour une execution qui ne partira jamais.
  //
  // Le controle est **strictement** limite a cette transition. Les autres
  // continuent de fonctionner runner arrete : mettre un brouillon en attente ou
  // accepter un travail n'a aucune raison de dependre d'une machine.
  const blocked = await retryBlockedReason(db, input, ports);
  if (blocked !== null) {
    return { ok: false, message: blocked };
  }

  const result = await updateTaskStatus(db, input.taskId, input.projectId, input.status, {
    decision: input.decision,
  });

  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return { ok: false, message: UNKNOWN_TASK_MESSAGE };
      case "queued":
        return { ok: false, message: QUEUED_TRANSITION_MESSAGE };
      case "already_decided":
        return { ok: false, message: ALREADY_DECIDED_MESSAGE };
      case "plan_invalid":
        return { ok: false, message: planIssuesMessage(result.issues ?? []) };
      case "forbidden_transition":
        return { ok: false, message: FORBIDDEN_TRANSITION_MESSAGE };
    }
  }

  // Une tache acceptee libere la file : c'est `COMPLETED`, et rien d'autre, qui
  // la fait avancer. Un run techniquement termine mene a `REVIEW`, ce qui n'est
  // pas une acceptation.
  if (input.status !== TASK_STATUS.COMPLETED) {
    return { ok: true, dequeued: result.dequeued, dispatch: null, delivery: null, refresh: null };
  }

  // La livraison **avant** l'avancement, et c'est tout l'ordre de TASK-029 : la
  // file ne doit pas lancer la tache suivante tant que la politique Git
  // applicable n'est pas satisfaite. C'est cette transition-la qui livre, jamais
  // un rendu de page ; la reservation persistante rend le geste idempotent.
  //
  // Un echec de livraison ne fait jamais tomber la transition : la tache reste
  // terminee, avec un etat lisible et un geste propose. C'est la meme regle que
  // pour la capture de review et pour le lot de validations.
  const delivery = await deliverQuietly(db, input.projectId, input.taskId);

  // Un amorcage accepte est le seul moment ou les plans de verification des
  // taches futures peuvent devenir faux d'un coup : la pile qu'elles supposaient
  // absente vient d'exister. Le rafraichissement se declenche donc **ici**,
  // jamais au rendu d'une page, et il est idempotent par empreinte.
  const refresh = await refreshQuietly(db, input.projectId, input.taskId);

  const dispatch = await advanceQueue(db, input.projectId);

  return { ok: true, dequeued: result.dequeued, dispatch, delivery, refresh };
}

/**
 * Ce qui empeche un `Retry` de partir, ou `null` quand rien ne l'empeche.
 *
 * ## Ce qu'elle ne fait pas
 *
 * Elle n'ecrit rien, et c'est le point : elle est appelee **avant** la
 * transition, pour que le refus laisse la tache exactement ou elle etait. Le
 * pilote reel a decouvert l'ordre inverse.
 *
 * ## Ce qu'elle ne verifie pas non plus
 *
 * Les dependances non satisfaites. Une tache prete qui attend une autre tache
 * **reste prete** — c'est un invariant de TASK-025 : la dependance refuse un
 * lancement, elle ne bloque pas un statut. La refuser ici transformerait un
 * refus de lancement en refus de statut, ce qui n'est pas la meme chose.
 *
 * ## Ce qu'un refus signifie
 *
 * Que NOX ne peut pas prouver, maintenant, qu'une execution neuve pourrait
 * demarrer. C'est une raison suffisante pour ne pas quitter `FAILED` : tant que
 * la tache y reste, sa reprise ciblee — celle qui repart du travail partiel —
 * reste offerte. Sortir de `FAILED` sans pouvoir lancer perd les deux gestes a
 * la fois.
 */
async function retryBlockedReason(
  db: DatabaseClient,
  input: { projectId: string; taskId: string; status: TaskStatus },
  ports: TaskTransitionPorts,
): Promise<string | null> {
  if (input.status !== TASK_STATUS.READY) {
    return null;
  }

  const task = await getTaskById(db, input.taskId);
  // Une tache introuvable, ou qui n'est pas en echec, n'est pas un `Retry` :
  // `updateTaskStatus` reste seul juge de sa transition.
  if (task === null || task.projectId !== input.projectId || task.status !== TASK_STATUS.FAILED) {
    return null;
  }

  const project = await getProjectById(db, input.projectId);
  if (project === null) {
    return null;
  }

  // Le repository, pas la tache : deux projets peuvent travailler en meme temps,
  // un meme repository jamais. `countActiveRepositoryRuns` remonte aux projets
  // qui partagent le dossier, exactement comme le verrou du lancement.
  if ((await countActiveRepositoryRuns(db, input.projectId)) > 0) {
    return RETRY_REPOSITORY_BUSY_MESSAGE;
  }

  // La politique de livraison est relue en base : la sonde doit constater
  // exactement ce que le lancement constatera, sinon elle refuserait un `Retry`
  // que le lancement aurait accepte.
  const policy = await readProjectDeliveryPolicy(db, input.projectId);
  const preflight = await ports.preflight(project.repositoryPath, policy);
  if (preflight.ok) {
    return null;
  }

  // Dossier de travail sale, branche inattendue, `HEAD` decale, runner arrete,
  // Claude Code absent : tous passent par le meme message du runner, deja
  // formule et sans chemin absolu.
  return retryBlockedMessage(describeRunnerFailure(preflight.failure));
}

/**
 * Rafraichit les plans de verification, et ne laisse jamais un incident faire
 * tomber la transition.
 *
 * Meme regle que la livraison : la tache **est** terminee, et la decision est
 * deja ecrite. Un fournisseur injoignable, une configuration absente ou une
 * reponse refusee laissent les plans tels qu'ils sont — un etat parfaitement
 * valable, celui d'avant TASK-033.
 *
 * L'import est dynamique pour la meme raison que celui des transitions ailleurs
 * dans NOX : il entraine le client OpenAI, qui n'a rien a faire dans le graphe
 * de modules d'une transition de statut ordinaire.
 */
async function refreshQuietly(
  db: DatabaseClient,
  projectId: string,
  taskId: string,
): Promise<MaybeRefreshResult | null> {
  try {
    const { getProjectById } = await import("@nox/database");
    const project = await getProjectById(db, projectId);
    if (project === null) {
      return null;
    }
    const { refreshVerificationPlansForProject } = await import("./verification-refresh.ts");
    return await refreshVerificationPlansForProject(
      db,
      { id: project.id, name: project.name, repositoryPath: project.repositoryPath },
      taskId,
    );
  } catch (error) {
    console.error("[nox] Echec du rafraichissement des plans de verification :", error);
    return null;
  }
}

/**
 * Livre, et ne laisse jamais un incident faire tomber la transition.
 *
 * Une exception ici — runner injoignable, base verrouillee — ne doit pas
 * transformer une acceptation reussie en echec : la tache **est** terminee, et
 * la decision est deja ecrite. La livraison se reprend depuis sa propre surface.
 */
async function deliverQuietly(
  db: DatabaseClient,
  projectId: string,
  taskId: string,
): Promise<MaybeDeliverResult | null> {
  try {
    return await maybeDeliver(db, { projectId, taskId });
  } catch (error) {
    console.error("[nox] Echec de la livraison Git apres acceptation :", error);
    return null;
  }
}

/** Variante qui prend le client par defaut, pour les Server Actions. */
export function applyTaskTransitionWithDefaultClient(input: {
  projectId: string;
  taskId: string;
  status: TaskStatus;
  decision?: ReviewDecisionInput;
}): Promise<TaskTransitionOutcome> {
  return applyTaskTransition(getDatabaseClient(), input);
}

const QUEUED_TRANSITION_MESSAGE =
  "Cette tache est inscrite dans la file d'execution : elle ne peut pas etre remise en brouillon " +
  "ni bloquee tant qu'elle y figure. Retirez-la de la file, puis reessayez.";

/**
 * Traduit les defauts d'un plan de verification.
 *
 * Tous, pas seulement le premier : corriger un critere pour en decouvrir un
 * autre au clic suivant serait une facon lente de dire la meme chose.
 */
function planIssuesMessage(issues: readonly VerificationPlanIssue[]): string {
  if (issues.length === 0) {
    return PLAN_INVALID_MESSAGE;
  }
  return `${PLAN_INVALID_MESSAGE} ${issues.map((issue) => issue.detail).join(" ")}`;
}

const PLAN_INVALID_MESSAGE =
  "Le plan de verification de cette tache n'est pas complet : chaque critere doit etre soit " +
  "automatise et prouve par une commande autonome, soit humain et accompagne d'une instruction.";

const ALREADY_DECIDED_MESSAGE =
  "Cette execution a deja ete conclue — par vous dans un autre onglet, ou par la validation " +
  "automatique de NOX. Rechargez la page pour voir la decision qui a ete enregistree.";

export { ALREADY_DECIDED_MESSAGE, PLAN_INVALID_MESSAGE, QUEUED_TRANSITION_MESSAGE };
