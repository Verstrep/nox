/**
 * Livraison Git : candidat, ecriture, reprise.
 *
 * ## Un seul moteur
 *
 * Ce module est le **seul** chemin vers une ecriture Git depuis NOX. La
 * livraison automatique decidee par la politique du projet et les deux boutons
 * de la surface de livraison l'appellent tous les trois : il n'existe pas de
 * second moteur, et il ne doit pas en exister. Ce qui change entre eux tient en
 * deux valeurs — qui declenche, et faut-il pousser — et rien d'autre. Manuel ne
 * veut jamais dire « les gardes de securite sont desactivees ».
 *
 * ## L'ordre, et pourquoi il est celui-la
 *
 * 1. **Tout est relu** — projet, politique, tache, execution de reference,
 *    decision, livraison. Aucun instantane calcule plus tot ne fait autorite :
 *    entre la validation et ce moment, un editeur a pu enregistrer.
 * 2. **Le repository est inspecte**, en lecture seule.
 * 3. **La reconciliation** : `HEAD` porte-t-il deja le commit de cette
 *    livraison ? Si oui, rien n'est ecrit, et l'etat est simplement rattrape.
 * 4. **La decision**, `checkDeliveryWrite`, sans echappatoire.
 * 5. **La reservation** — le compteur de la livraison est incremente par mise a
 *    jour conditionnelle. C'est le moment ou une seconde tentative simultanee
 *    perd.
 * 6. **Le runner**, qui reverifie tout avant d'appeler Git.
 *
 * ## Ce que ce module ne fait jamais
 *
 * Aucun parametre `force`, `ignoreFingerprint`, `skipValidation`, `commitAnyway`
 * ni `pushForce` n'existe ici, et il ne doit pas en exister : une porte derobee
 * autour de la validation viderait TASK-029 de son contenu. Un repository qui a
 * diverge se resout par un geste humain dans un terminal, pas par un bouton.
 *
 * Aucun appel a OpenAI, aucun Claude Code. Une livraison n'est ni une decision
 * de produit, ni une relecture : c'est l'execution d'une politique deja
 * autorisee.
 */

import {
  claimDelivery,
  findCompletionRun,
  getDeliveryForRun,
  getGitDelivery,
  getProjectById,
  getTaskById,
  readProjectDeliveryPolicy,
  recordDeliveryCommit,
  recordDeliveryFailure,
  recordDeliveryPush,
  reserveGitDelivery,
  type DatabaseClient,
  type GitDeliveryRow,
} from "@nox/database";
import {
  DELIVERY_REFUSAL,
  DELIVERY_STATUS,
  DELIVERY_TRIGGER,
  RUNNER_ERROR,
  TASK_STATUS,
  buildDeliveryCommitMessage,
  candidatePaths,
  checkDeliveryEligibility,
  checkDeliveryPush,
  checkDeliveryWrite,
  deliveryHasCommit,
  deliveryTrailer,
  policyAllowsAutomatic,
  policyRequiresPush,
  reconcilesExistingCommit,
  sensitiveNewPaths,
  type DeliveryInspection,
  type DeliveryRefusalCode,
  type DeliveryTrigger,
} from "@nox/shared";

import { deliveryRefusalMessage } from "./delivery-display.ts";
import { commitDelivery, inspectDelivery, pushDelivery } from "./runner/client.ts";

/** Acces au runner ; remplaces par des doublures dans les tests. */
export type DeliveryPorts = {
  inspect: typeof inspectDelivery;
  commit: typeof commitDelivery;
  push: typeof pushDelivery;
};

const RUNNER_PORTS: DeliveryPorts = {
  inspect: inspectDelivery,
  commit: commitDelivery,
  push: pushDelivery,
};

export type DeliveryOutcome =
  | { ok: true; delivery: GitDeliveryRow }
  | { ok: false; code: DeliveryRefusalCode; message: string; delivery: GitDeliveryRow | null };

function refuse(
  code: DeliveryRefusalCode,
  delivery: GitDeliveryRow | null = null,
): DeliveryOutcome {
  return { ok: false, code, message: deliveryRefusalMessage(code), delivery };
}

// ---------------------------------------------------------------------------
// 1. Le candidat
// ---------------------------------------------------------------------------

/**
 * Reserve le candidat de livraison d'une tache terminee.
 *
 * ## Ce qu'elle n'ecrit pas
 *
 * Rien dans Git. Cette fonction inspecte le repository — trois commandes de
 * lecture — puis ecrit une ligne SQLite. Elle est appelee pour **toutes** les
 * politiques, `MANUAL` comprise : c'est ce qui permet a la surface de livraison
 * d'afficher exactement ce qu'il faudrait livrer, dans le mode ou cette
 * information est la plus utile.
 *
 * ## Ce qui la refuse
 *
 * Une tache non terminee, une tache marquee terminee sans execution ni review —
 * il n'existe alors aucun travail valide a livrer —, un `HEAD` detache, un index
 * deja garni, un dossier de travail propre, un candidat trop large. Chaque refus
 * porte son code, parce que chacun demande un geste different.
 *
 * ## Un dossier de travail propre n'est pas une erreur
 *
 * `NOTHING_TO_COMMIT` veut dire que le travail est deja dans l'historique — le
 * plus souvent parce que l'utilisateur a commite lui-meme. Aucune livraison n'est
 * creee, et le preflight Git existant reste l'autorite qui laisse la file
 * continuer. NOX ne cherche pas a reconnaitre quel commit correspondait au
 * travail : deviner serait pire que ne rien dire.
 */
export async function prepareDelivery(
  db: DatabaseClient,
  input: { projectId: string; taskId: string },
  ports: DeliveryPorts = RUNNER_PORTS,
): Promise<DeliveryOutcome> {
  const project = await getProjectById(db, input.projectId);
  const task = await getTaskById(db, input.taskId);
  if (project === null || task === null || task.projectId !== input.projectId) {
    return refuse(DELIVERY_REFUSAL.NO_COMPLETION_RUN);
  }

  const completion = await findCompletionRun(db, task.id);
  const eligibility = checkDeliveryEligibility({
    taskCompleted: task.status === TASK_STATUS.COMPLETED,
    hasCompletionDecision: completion !== null,
    runCompleted: completion?.status === "COMPLETED",
  });
  if (!eligibility.eligible) {
    return refuse(eligibility.code);
  }
  // `checkDeliveryEligibility` vient de garantir que la decision existe ; le
  // controle qui suit est celui du typage, pas une seconde regle.
  if (completion === null) {
    return refuse(DELIVERY_REFUSAL.NO_COMPLETION_RUN);
  }

  const existing = await getDeliveryForRun(db, task.id, completion.runId);
  if (existing !== null) {
    return { ok: true, delivery: existing };
  }

  const inspected = await ports.inspect({ repositoryPath: project.repositoryPath });
  if (!inspected.ok) {
    return refuse(DELIVERY_REFUSAL.REPOSITORY_UNAVAILABLE);
  }
  const state = inspected.value.inspection;

  if (state.branch === null) {
    return refuse(DELIVERY_REFUSAL.DETACHED_HEAD);
  }
  if (state.fingerprint === null) {
    return refuse(DELIVERY_REFUSAL.REPOSITORY_UNAVAILABLE);
  }
  if (state.indexDirty) {
    return refuse(DELIVERY_REFUSAL.INDEX_NOT_EMPTY);
  }
  if (state.entries.length === 0) {
    return refuse(DELIVERY_REFUSAL.NOTHING_TO_COMMIT);
  }
  if (state.omittedEntries > 0) {
    return refuse(DELIVERY_REFUSAL.TOO_MANY_ENTRIES);
  }

  const policy = await readProjectDeliveryPolicy(db, input.projectId);
  const reserved = await reserveGitDelivery(db, {
    projectId: input.projectId,
    taskId: task.id,
    sourceRunId: completion.runId,
    sourceDecisionId: completion.decisionId,
    policy,
    // Le declencheur enregistre a la reservation dit ce que la politique
    // autorisait alors. Une reprise a la main le reecrira, et c'est voulu.
    trigger: policyAllowsAutomatic(policy)
      ? DELIVERY_TRIGGER.AUTOMATIC
      : DELIVERY_TRIGGER.MANUAL,
    expectedHead: state.head,
    expectedBranch: state.branch,
    candidateFingerprint: state.fingerprint,
    candidate: state.entries,
    upstreamRemote: state.upstreamRemote,
    upstreamRef: state.upstreamRef,
    buildCommitMessage: (deliveryId) =>
      buildDeliveryCommitMessage({
        // Le code affiche de la tache, celui que l'utilisateur lit partout —
        // jamais un identifiant interne, qui n'apprendrait rien dans un
        // `git log --oneline`.
        taskCode: task.code,
        title: task.title,
        deliveryId,
      }),
  });

  return reserved.ok
    ? { ok: true, delivery: reserved.delivery }
    : refuse(DELIVERY_REFUSAL.ALREADY_RESERVED);
}

// ---------------------------------------------------------------------------
// 2. L'ecriture
// ---------------------------------------------------------------------------

/**
 * Execute une livraison : le commit, puis le push s'il est demande.
 *
 * `trigger` dit qui engage l'ecriture, `push` si le commit devra partir. Les
 * deux sont des faits, pas des permissions : ils ne desactivent aucune garde, et
 * la decision reste `checkDeliveryWrite`.
 */
export async function runDelivery(
  db: DatabaseClient,
  input: { deliveryId: string; trigger: DeliveryTrigger; push?: boolean },
  ports: DeliveryPorts = RUNNER_PORTS,
): Promise<DeliveryOutcome> {
  const delivery = await getGitDelivery(db, input.deliveryId);
  if (delivery === null) {
    return refuse(DELIVERY_REFUSAL.NO_COMPLETION_RUN);
  }
  const requiresPush = input.push ?? policyRequiresPush(delivery.policy);

  const committed = deliveryHasCommit(delivery.status)
    ? ({ ok: true, delivery } as const)
    : await commitPhase(db, delivery, input.trigger, requiresPush, ports);
  if (!committed.ok) {
    return committed;
  }
  if (!requiresPush) {
    return committed;
  }
  return pushPhase(db, committed.delivery, input.trigger, ports);
}

/**
 * Reprend le push d'une livraison dont le commit existe deja.
 *
 * Zero `git add`, zero commit — la question est reglee par construction : cette
 * fonction n'appelle jamais la phase de commit. C'est ce qui distingue
 * `Retry push` de `Resume delivery` : reprendre la livraison entiere apres un
 * push refuse creerait un second commit identique.
 */
export async function retryDeliveryPush(
  db: DatabaseClient,
  deliveryId: string,
  ports: DeliveryPorts = RUNNER_PORTS,
): Promise<DeliveryOutcome> {
  const delivery = await getGitDelivery(db, deliveryId);
  if (delivery === null) {
    return refuse(DELIVERY_REFUSAL.NO_COMPLETION_RUN);
  }
  return pushPhase(db, delivery, DELIVERY_TRIGGER.MANUAL, ports);
}

async function commitPhase(
  db: DatabaseClient,
  delivery: GitDeliveryRow,
  trigger: DeliveryTrigger,
  requiresPush: boolean,
  ports: DeliveryPorts,
): Promise<DeliveryOutcome> {
  const project = await getProjectById(db, delivery.projectId);
  if (project === null) {
    return refuse(DELIVERY_REFUSAL.REPOSITORY_UNAVAILABLE, delivery);
  }
  const trailer = deliveryTrailer(delivery.id);

  const inspected = await ports.inspect({
    repositoryPath: project.repositoryPath,
    trailer,
  });
  if (!inspected.ok) {
    return await fail(db, delivery, DELIVERY_STATUS.BLOCKED, DELIVERY_REFUSAL.REPOSITORY_UNAVAILABLE);
  }
  const state = inspected.value.inspection;

  // La reconciliation avant tout le reste. Un commit deja cree lors d'une
  // tentative dont la reponse s'est perdue ne doit pas etre recree : deux
  // commits identiques sont indistinguables, et personne ne saurait lequel
  // garder.
  if (
    reconcilesExistingCommit({
      headTrailerMatches: state.headTrailerMatches,
      headParents: state.headParents,
      expectedHead: delivery.expectedHead,
    })
  ) {
    const rattrapee = await recordDeliveryCommit(db, delivery.id, {
      commitSha: state.head,
      status: DELIVERY_STATUS.COMMITTED,
    });
    return rattrapee === null
      ? refuse(DELIVERY_REFUSAL.REPOSITORY_UNAVAILABLE, delivery)
      : { ok: true, delivery: rattrapee };
  }

  const decision = checkDeliveryWrite({
    policy: delivery.policy,
    trigger,
    status: delivery.status,
    requiresPush,
    detached: state.branch === null,
    branch: state.branch ?? "",
    expectedBranch: delivery.expectedBranch,
    head: state.head,
    expectedHead: delivery.expectedHead,
    fingerprintMatches:
      state.fingerprint !== null && state.fingerprint === delivery.candidateFingerprint,
    indexDirty: state.indexDirty,
    entryCount: delivery.candidate.length,
    sensitiveAdditions: sensitiveNewPaths(delivery.candidate),
    identityComplete: state.identityComplete,
    signingConfigured: state.signingConfigured,
    hooksConfigured: state.hooks.length > 0,
    upstream: upstreamOf(state),
    expectedUpstream:
      delivery.upstreamRemote === null || delivery.upstreamRef === null
        ? null
        : { remote: delivery.upstreamRemote, ref: delivery.upstreamRef },
  });
  if (!decision.ok) {
    return await fail(db, delivery, DELIVERY_STATUS.BLOCKED, decision.code);
  }

  // La reservation, juste avant l'effet externe. Deux reprises simultanees
  // lisent le meme compteur ; une seule reussit a l'incrementer.
  const claimed = await claimDelivery(db, {
    deliveryId: delivery.id,
    expectedAttempt: delivery.attempt,
    from: [DELIVERY_STATUS.PENDING, DELIVERY_STATUS.COMMITTING, DELIVERY_STATUS.FAILED, DELIVERY_STATUS.BLOCKED],
    to: DELIVERY_STATUS.COMMITTING,
    trigger,
  });
  if (!claimed.ok) {
    return refuse(DELIVERY_REFUSAL.ALREADY_RESERVED, delivery);
  }

  const written = await ports.commit({
    repositoryPath: project.repositoryPath,
    expectedBranch: delivery.expectedBranch,
    expectedHead: delivery.expectedHead,
    expectedFingerprint: delivery.candidateFingerprint,
    paths: candidatePaths(delivery.candidate),
    message: delivery.commitMessage,
    trailer,
  });

  if (!written.ok) {
    return await fail(
      db,
      claimed.delivery,
      DELIVERY_STATUS.BLOCKED,
      runnerRefusal(written.failure),
    );
  }
  if (written.value.failureCode !== null || written.value.commitSha === null) {
    // Git a repondu, et sa reponse est un echec : un hook a refuse, une
    // signature n'a pas abouti, un delai a ete depasse. Rien n'est defait —
    // l'index garde ce qui a ete prepare, et NOX le nomme.
    return await fail(
      db,
      claimed.delivery,
      DELIVERY_STATUS.FAILED,
      DELIVERY_REFUSAL.COMMIT_FAILED,
      written.value.failureDetail,
    );
  }

  const recorded = await recordDeliveryCommit(db, delivery.id, {
    commitSha: written.value.commitSha,
    status: DELIVERY_STATUS.COMMITTED,
  });
  if (recorded === null) {
    return refuse(DELIVERY_REFUSAL.REPOSITORY_UNAVAILABLE, claimed.delivery);
  }

  // Un dossier de travail qui n'est pas redevenu propre apres le commit veut
  // dire qu'un hook a modifie autre chose. NOX ne pretend pas avoir livre ce
  // qu'il voulait livrer, et ne defait rien : il le dit.
  if (!written.value.worktreeClean) {
    return await fail(db, recorded, DELIVERY_STATUS.COMMITTED, DELIVERY_REFUSAL.TREE_MISMATCH);
  }

  return { ok: true, delivery: recorded };
}

async function pushPhase(
  db: DatabaseClient,
  delivery: GitDeliveryRow,
  trigger: DeliveryTrigger,
  ports: DeliveryPorts,
): Promise<DeliveryOutcome> {
  if (delivery.status === DELIVERY_STATUS.DELIVERED) {
    return { ok: true, delivery };
  }
  const project = await getProjectById(db, delivery.projectId);
  if (project === null) {
    return refuse(DELIVERY_REFUSAL.REPOSITORY_UNAVAILABLE, delivery);
  }

  const inspected = await ports.inspect({ repositoryPath: project.repositoryPath });
  if (!inspected.ok) {
    return await fail(db, delivery, delivery.status, DELIVERY_REFUSAL.REPOSITORY_UNAVAILABLE);
  }
  const state = inspected.value.inspection;

  const decision = checkDeliveryPush({
    status: delivery.status,
    detached: state.branch === null,
    branch: state.branch ?? "",
    expectedBranch: delivery.expectedBranch,
    head: state.head,
    commitSha: delivery.commitSha,
    upstream: upstreamOf(state),
    expectedUpstream:
      delivery.upstreamRemote === null || delivery.upstreamRef === null
        ? null
        : { remote: delivery.upstreamRemote, ref: delivery.upstreamRef },
  });
  if (!decision.ok) {
    // Le commit local reste : le statut n'est pas ramene en arriere, et
    // `commitSha` n'est jamais efface. « Le commit existe, le push n'a pas pu
    // partir » est un etat exact.
    return await fail(db, delivery, delivery.status, decision.code);
  }

  const claimed = await claimDelivery(db, {
    deliveryId: delivery.id,
    expectedAttempt: delivery.attempt,
    from: [DELIVERY_STATUS.COMMITTED, DELIVERY_STATUS.PUSHING],
    to: DELIVERY_STATUS.PUSHING,
    trigger,
  });
  if (!claimed.ok) {
    return refuse(DELIVERY_REFUSAL.ALREADY_RESERVED, delivery);
  }

  const pushed = await ports.push({
    repositoryPath: project.repositoryPath,
    expectedBranch: delivery.expectedBranch,
    expectedHead: delivery.commitSha ?? "",
  });

  if (!pushed.ok) {
    return await fail(
      db,
      claimed.delivery,
      DELIVERY_STATUS.COMMITTED,
      runnerRefusal(pushed.failure),
    );
  }
  if (!pushed.value.pushed) {
    return await fail(
      db,
      claimed.delivery,
      DELIVERY_STATUS.COMMITTED,
      pushed.value.failureCode === RUNNER_ERROR.DELIVERY_PUSH_REJECTED
        ? DELIVERY_REFUSAL.PUSH_REJECTED
        : DELIVERY_REFUSAL.PUSH_FAILED,
      pushed.value.failureDetail,
    );
  }

  const delivered = await recordDeliveryPush(db, delivery.id, {
    remote: pushed.value.remote,
    remoteRef: pushed.value.remoteRef,
  });
  return delivered === null
    ? refuse(DELIVERY_REFUSAL.REPOSITORY_UNAVAILABLE, claimed.delivery)
    : { ok: true, delivery: delivered };
}

function upstreamOf(state: DeliveryInspection) {
  return state.upstreamRemote === null || state.upstreamRef === null
    ? null
    : { remote: state.upstreamRemote, ref: state.upstreamRef };
}

/**
 * Traduit un echec du runner en refus de livraison.
 *
 * Les codes techniques du runner ne sont jamais reaffiches tels quels : chaque
 * situation recoit le refus de livraison qui lui correspond, avec le geste qui
 * s'y applique.
 */
function runnerRefusal(failure: { kind: string; code?: string }): DeliveryRefusalCode {
  if (failure.kind !== "runner_error") {
    return DELIVERY_REFUSAL.REPOSITORY_UNAVAILABLE;
  }
  switch (failure.code) {
    case RUNNER_ERROR.DELIVERY_REPOSITORY_CHANGED:
    case RUNNER_ERROR.DELIVERY_STAGED_MISMATCH:
    case RUNNER_ERROR.WORKSPACE_FINGERPRINT_UNAVAILABLE:
      return DELIVERY_REFUSAL.REPOSITORY_CHANGED;
    case RUNNER_ERROR.DELIVERY_INDEX_NOT_EMPTY:
      return DELIVERY_REFUSAL.INDEX_NOT_EMPTY;
    case RUNNER_ERROR.DELIVERY_IDENTITY_MISSING:
      return DELIVERY_REFUSAL.GIT_IDENTITY_MISSING;
    case RUNNER_ERROR.GIT_DETACHED_HEAD:
      return DELIVERY_REFUSAL.DETACHED_HEAD;
    case RUNNER_ERROR.GIT_BRANCH_CHANGED:
      return DELIVERY_REFUSAL.BRANCH_CHANGED;
    case RUNNER_ERROR.GIT_HEAD_CHANGED:
      return DELIVERY_REFUSAL.HEAD_CHANGED;
    case RUNNER_ERROR.GIT_UPSTREAM_MISSING:
      return DELIVERY_REFUSAL.UPSTREAM_MISSING;
    case RUNNER_ERROR.DELIVERY_TREE_MISMATCH:
      return DELIVERY_REFUSAL.TREE_MISMATCH;
    case RUNNER_ERROR.DELIVERY_PUSH_REJECTED:
      return DELIVERY_REFUSAL.PUSH_REJECTED;
    case RUNNER_ERROR.DELIVERY_PUSH_FAILED:
      return DELIVERY_REFUSAL.PUSH_FAILED;
    case RUNNER_ERROR.DELIVERY_COMMIT_FAILED:
    case RUNNER_ERROR.DELIVERY_STAGING_FAILED:
      return DELIVERY_REFUSAL.COMMIT_FAILED;
    default:
      return DELIVERY_REFUSAL.REPOSITORY_UNAVAILABLE;
  }
}

/**
 * Enregistre le refus, et le rend.
 *
 * Le statut est passe par l'appelant plutot que deduit : un push refuse laisse
 * la livraison `COMMITTED`, parce que le commit existe bel et bien. La reduire a
 * « echec » ferait proposer une reprise complete — qui creerait un second commit.
 */
async function fail(
  db: DatabaseClient,
  delivery: GitDeliveryRow,
  status: (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS],
  code: DeliveryRefusalCode,
  detail: string | null = null,
): Promise<DeliveryOutcome> {
  const message = deliveryRefusalMessage(code);
  const updated = await recordDeliveryFailure(db, delivery.id, {
    status,
    errorCode: code,
    errorMessage: detail === null ? message : `${message} ${detail}`,
  });
  return { ok: false, code, message, delivery: updated ?? delivery };
}

// ---------------------------------------------------------------------------
// 3. Le declenchement automatique
// ---------------------------------------------------------------------------

/** Ce qu'une tentative de livraison automatique a produit. */
export type MaybeDeliverResult =
  | { attempted: false; code: DeliveryRefusalCode | null }
  | { attempted: true; delivered: boolean; delivery: GitDeliveryRow; code: DeliveryRefusalCode | null };

/**
 * Livre le travail d'une tache qui vient d'etre validee, si la politique
 * l'autorise.
 *
 * ## Le declencheur
 *
 * La **transition** d'une tache vers `COMPLETED`, jamais un rendu de page. Une
 * tache qui devient terminee pendant que l'application tourne est un evenement
 * applicatif legitime ; rouvrir vingt fois une review n'en est pas un. La
 * reservation persistante rend le geste idempotent : dix constatations
 * simultanees obtiennent la meme livraison, et un commit au plus.
 *
 * ## Ce qu'un echec ici ne fait pas
 *
 * Il ne fait jamais tomber la transition. Une livraison qui ne part pas laisse la
 * tache terminee, avec un etat lisible et un geste propose — c'est la meme regle
 * que pour la capture de review, le lot de validations et la correction
 * automatique.
 *
 * ## La pause de la file n'entre pas en jeu
 *
 * Mettre une file en pause veut dire « ne lance pas un prochain Claude
 * automatiquement ». Cela ne veut pas dire « laisse le travail valide non
 * livre » : la politique de livraison est une autorisation distincte, donnee
 * separement, et elle continue de s'appliquer. Une fois la livraison faite, la
 * file en pause ne lance evidemment rien.
 */
export async function maybeDeliver(
  db: DatabaseClient,
  input: { projectId: string; taskId: string },
  ports: DeliveryPorts = RUNNER_PORTS,
): Promise<MaybeDeliverResult> {
  const prepared = await prepareDelivery(db, input, ports);
  if (!prepared.ok) {
    return { attempted: false, code: prepared.code };
  }

  const delivery = prepared.delivery;
  if (!policyAllowsAutomatic(delivery.policy)) {
    // `MANUAL` : le candidat est enregistre et affiche, et rien n'est ecrit.
    return { attempted: false, code: DELIVERY_REFUSAL.POLICY_MANUAL };
  }

  const outcome = await runDelivery(
    db,
    { deliveryId: delivery.id, trigger: DELIVERY_TRIGGER.AUTOMATIC },
    ports,
  );

  return outcome.ok
    ? { attempted: true, delivered: true, delivery: outcome.delivery, code: null }
    : {
        attempted: true,
        delivered: false,
        delivery: outcome.delivery ?? delivery,
        code: outcome.code,
      };
}
