/**
 * Ce qu'une surface sait de la livraison Git d'une tache.
 *
 * ## Ce module ne decide de rien, et n'ecrit rien
 *
 * Il lit la base, et interroge le runner **en lecture seule** pour savoir ou en
 * est le repository aujourd'hui. Aucune fonction d'ici ne cree de livraison, ne
 * prepare de chemin, ne cree de commit et ne pousse : les seules ecritures Git
 * de NOX vivent dans `git-delivery.ts`, et elles ne partent que d'une Server
 * Action ou de la transition d'une tache vers `COMPLETED`.
 *
 * Rafraichir cette page vingt fois produit vingt inspections Git et zero
 * ecriture.
 *
 * ## Pourquoi l'etat courant est relu ici
 *
 * Parce que la question que l'utilisateur se pose devant cet ecran est « que
 * va-t-il se passer si je clique ? », et que la reponse depend de l'etat du
 * repository maintenant — pas de celui qu'il avait a la validation. Un
 * repository qui a diverge doit se lire avant le clic, pas apres le refus.
 *
 * C'est la meme sonde en lecture seule que le preflight de la page de la file,
 * et elle obeit a la meme regle : elle n'autorise rien. Les Server Actions
 * restent les seules autorites, et elles reverifient tout.
 */

import {
  getDeliveryForRun,
  getLatestDeliveryForTask,
  getProjectById,
  getTaskById,
  findCompletionRun,
  readProjectDeliveryPolicy,
  type DatabaseClient,
  type GitDeliveryRow,
} from "@nox/database";
import {
  DELIVERY_REFUSAL,
  DELIVERY_STATUS,
  TASK_STATUS,
  checkDeliveryEligibility,
  deliveryHasCommit,
  deliverySatisfied,
  deliveryTrailer,
  policyRequiresPush,
  sensitiveNewPaths,
  type DeliveryInspection,
  type DeliveryPolicy,
  type DeliveryRefusalCode,
} from "@nox/shared";

import { inspectDelivery } from "./runner/client.ts";

/** Acces au runner, en lecture seule ; remplace par une doublure dans les tests. */
export type DeliveryViewPorts = { inspect: typeof inspectDelivery };

const RUNNER_PORTS: DeliveryViewPorts = { inspect: inspectDelivery };

/** Ce que la surface de livraison affiche. */
export type DeliveryView = {
  policy: DeliveryPolicy;
  /** La livraison enregistree, ou `null` s'il n'en existe aucune. */
  delivery: GitDeliveryRow | null;
  /** Pourquoi aucun candidat n'a pu etre defini, le cas echeant. */
  unavailable: DeliveryRefusalCode | null;
  /** Etat courant du repository, ou `null` quand le runner n'a pas repondu. */
  repository: DeliveryInspection | null;
  /**
   * Le repository correspond-il encore au candidat ?
   *
   * `null` veut dire « NOX ne sait pas » — runner arrete, empreinte
   * incalculable. Ne pas savoir n'autorise jamais une ecriture, et n'affirme
   * jamais une divergence.
   */
  matchesCandidate: boolean | null;
  /**
   * Le travail semble avoir ete livre en dehors de NOX.
   *
   * Une reconnaissance volontairement etroite : le dossier de travail est propre
   * et `HEAD` a avance depuis l'etat valide. NOX n'en deduit pas quel commit
   * correspondait au travail — deviner serait pire que ne rien dire — et ne
   * modifie aucun statut sur cette base. C'est le preflight Git existant qui
   * reste l'autorite laissant la file continuer.
   */
  deliveredExternally: boolean;
  /** Fichiers sensibles qui apparaitraient pour la premiere fois. */
  sensitivePaths: readonly string[];
  /** La politique enregistree est satisfaite : la file peut continuer. */
  satisfied: boolean;
  actions: DeliveryActions;
};

/** Ce que la surface propose, et ce qu'elle n'a pas a proposer. */
export type DeliveryActions = {
  /** Creer le commit sans le pousser. */
  commit: boolean;
  /** Creer le commit puis le pousser. */
  commitAndPush: boolean;
  /** Rejouer le seul push, sur un commit deja cree. */
  retryPush: boolean;
  /** Reinspecter le repository pour definir un candidat. */
  refresh: boolean;
};

/**
 * Assemble la vue de livraison d'une tache.
 *
 * `sourceRunId` est facultatif : la surface d'une tache affiche la livraison de
 * son travail valide courant, et l'historique reste accessible par la livraison
 * la plus recente lorsque la tache a ete rouverte puis reacceptee.
 */
export async function loadDeliveryView(
  db: DatabaseClient,
  input: { projectId: string; taskId: string },
  ports: DeliveryViewPorts = RUNNER_PORTS,
): Promise<DeliveryView | null> {
  const project = await getProjectById(db, input.projectId);
  const task = await getTaskById(db, input.taskId);
  if (project === null || task === null || task.projectId !== input.projectId) {
    return null;
  }

  const policy = await readProjectDeliveryPolicy(db, input.projectId);
  const completion = await findCompletionRun(db, task.id);

  const delivery =
    completion === null
      ? await getLatestDeliveryForTask(db, task.id)
      : ((await getDeliveryForRun(db, task.id, completion.runId)) ??
        (await getLatestDeliveryForTask(db, task.id)));

  const eligibility = checkDeliveryEligibility({
    taskCompleted: task.status === TASK_STATUS.COMPLETED,
    hasCompletionDecision: completion !== null,
    runCompleted: completion?.status === "COMPLETED",
  });

  // L'inspection est demandee avec le trailer de la livraison quand il en existe
  // une : c'est ce qui permet d'annoncer « ce commit est deja le notre » sans
  // rien ecrire.
  const inspected = await ports.inspect({
    repositoryPath: project.repositoryPath,
    ...(delivery === null ? {} : { trailer: deliveryTrailer(delivery.id) }),
  });
  const repository = inspected.ok ? inspected.value.inspection : null;

  const matchesCandidate =
    delivery === null || repository === null || repository.fingerprint === null
      ? null
      : repository.fingerprint === delivery.candidateFingerprint &&
        repository.branch === delivery.expectedBranch &&
        repository.head === delivery.expectedHead;

  const deliveredExternally =
    delivery !== null &&
    !deliveryHasCommit(delivery.status) &&
    repository !== null &&
    repository.entries.length === 0 &&
    repository.head !== delivery.expectedHead;

  const satisfied = delivery !== null && deliverySatisfied(delivery.policy, delivery.status);

  return {
    policy,
    delivery,
    unavailable: eligibility.eligible ? null : eligibility.code,
    repository,
    matchesCandidate,
    deliveredExternally,
    sensitivePaths: delivery === null ? [] : sensitiveNewPaths(delivery.candidate),
    satisfied,
    actions: deriveDeliveryActions({
      delivery,
      eligible: eligibility.eligible,
      deliveredExternally,
      hasUpstream: repository !== null && repository.upstreamRemote !== null,
    }),
  };
}

/**
 * Ce que la surface propose, derive et jamais persiste.
 *
 * ## Une action proposee n'autorise rien
 *
 * Ce calcul sert a ne pas afficher un bouton qui ne pourrait rien faire. Il ne
 * remplace aucune verification : la Server Action relit tout, et le runner
 * reverifie encore. Un bouton absent est une commodite ; un bouton present n'est
 * pas une permission.
 */
export function deriveDeliveryActions(facts: {
  delivery: GitDeliveryRow | null;
  eligible: boolean;
  deliveredExternally: boolean;
  hasUpstream: boolean;
}): DeliveryActions {
  const { delivery } = facts;

  if (delivery === null) {
    // Aucun candidat : seule la reinspection a du sens, et uniquement si la
    // tache a bien un travail valide a livrer.
    return { commit: false, commitAndPush: false, retryPush: false, refresh: facts.eligible };
  }

  if (delivery.status === DELIVERY_STATUS.DELIVERED) {
    return { commit: false, commitAndPush: false, retryPush: false, refresh: false };
  }

  if (deliveryHasCommit(delivery.status)) {
    // Le commit existe. Reprendre la livraison entiere en creerait un second :
    // seul le push se rejoue.
    return {
      commit: false,
      commitAndPush: false,
      retryPush: facts.hasUpstream || policyRequiresPush(delivery.policy),
      refresh: false,
    };
  }

  // Le travail a ete livre ailleurs : proposer un commit ne creerait rien de bon,
  // et le candidat ne correspond plus a ce que Git contient.
  if (facts.deliveredExternally) {
    return { commit: false, commitAndPush: false, retryPush: false, refresh: false };
  }

  return {
    commit: true,
    commitAndPush: facts.hasUpstream,
    retryPush: false,
    refresh: false,
  };
}

/** Le refus qui explique pourquoi `Commit & push` n'est pas proposable. */
export function pushUnavailableReason(view: DeliveryView): DeliveryRefusalCode | null {
  if (view.delivery === null || view.actions.commitAndPush || view.actions.retryPush) {
    return null;
  }
  return view.repository !== null && view.repository.upstreamRemote === null
    ? DELIVERY_REFUSAL.UPSTREAM_MISSING
    : null;
}
