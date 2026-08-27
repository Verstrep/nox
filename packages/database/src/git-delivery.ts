/**
 * Reservation et suivi des livraisons Git.
 *
 * ## Le point de serialisation
 *
 * Une tache qui devient terminee peut etre constatee plusieurs fois — deux
 * onglets, une completion automatique et une acceptation humaine, deux reprises
 * simultanees. Chacune de ces constatations voudrait creer un commit. Une seule
 * doit y arriver.
 *
 * Deux verrous, et ils repondent a deux questions differentes :
 *
 * - l'index unique `(taskId, sourceRunId)` garantit qu'un travail valide ne
 *   donne **qu'une** livraison, quel que soit le nombre de constatations ;
 * - le compteur `attempt`, pris par mise a jour conditionnelle, garantit qu'une
 *   livraison n'engage **qu'une** ecriture a la fois, y compris entre deux
 *   processus.
 *
 * Aucun des deux n'est un verrou en memoire : ni l'un ni l'autre ne survivrait a
 * un redemarrage, et le second doit precisement survivre a une panne survenue
 * entre le commit et l'enregistrement de son empreinte.
 *
 * ## Ce module n'ecrit jamais dans Git
 *
 * Ni `add`, ni `commit`, ni `push`, ni quoi que ce soit d'autre. Il enregistre
 * une decision prise ailleurs, et refuse la seconde. Toutes les fonctions de ce
 * fichier sont des ecritures SQLite.
 */

import {
  DELIVERY_STATUS,
  DELIVERY_TRIGGER,
  deliverySatisfied,
  policyAllowsAutomatic,
  readDeliveryPolicy,
  readDeliveryStatus,
  readDeliveryTrigger,
  type DeliveryCandidateEntry,
  type DeliveryPolicy,
  type DeliveryStatus,
  type DeliveryTrigger,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Une livraison, telle qu'elle est relue. */
export type GitDeliveryRow = {
  id: string;
  projectId: string;
  taskId: string;
  sourceRunId: string;
  sourceDecisionId: string | null;
  policy: DeliveryPolicy;
  trigger: DeliveryTrigger;
  status: DeliveryStatus;
  attempt: number;
  expectedHead: string;
  expectedBranch: string;
  /** Empreinte authentifiee. Ne quitte jamais le serveur. */
  candidateFingerprint: string;
  candidate: readonly DeliveryCandidateEntry[];
  upstreamRemote: string | null;
  upstreamRef: string | null;
  commitMessage: string;
  commitSha: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  committedAt: Date | null;
  pushedAt: Date | null;
};

type DeliveryRecord = {
  id: string;
  projectId: string;
  taskId: string;
  sourceRunId: string;
  sourceDecisionId: string | null;
  policy: string;
  trigger: string;
  status: string;
  attempt: number;
  expectedHead: string;
  expectedBranch: string;
  candidateFingerprint: string;
  candidateJson: string;
  upstreamRemote: string | null;
  upstreamRef: string | null;
  commitMessage: string;
  commitSha: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  committedAt: Date | null;
  pushedAt: Date | null;
};

/**
 * Relit les entrees du candidat.
 *
 * Un contenu illisible rend une liste vide, jamais une exception : une livraison
 * dont le candidat ne se relit pas ne peut plus rien livrer — `checkDeliveryWrite`
 * refusera sur `NOTHING_TO_COMMIT` — mais elle reste affichable, et son
 * historique reste lisible.
 */
export function parseCandidate(value: string): DeliveryCandidateEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const entries: DeliveryCandidateEntry[] = [];
  for (const item of parsed) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as { code?: unknown }).code === "string" &&
      typeof (item as { path?: unknown }).path === "string"
    ) {
      entries.push({
        code: (item as { code: string }).code,
        path: (item as { path: string }).path,
      });
    }
  }
  return entries;
}

function toRow(record: DeliveryRecord): GitDeliveryRow {
  return {
    id: record.id,
    projectId: record.projectId,
    taskId: record.taskId,
    sourceRunId: record.sourceRunId,
    sourceDecisionId: record.sourceDecisionId,
    policy: readDeliveryPolicy(record.policy),
    trigger: readDeliveryTrigger(record.trigger),
    status: readDeliveryStatus(record.status),
    attempt: record.attempt,
    expectedHead: record.expectedHead,
    expectedBranch: record.expectedBranch,
    candidateFingerprint: record.candidateFingerprint,
    candidate: parseCandidate(record.candidateJson),
    upstreamRemote: record.upstreamRemote,
    upstreamRef: record.upstreamRef,
    commitMessage: record.commitMessage,
    commitSha: record.commitSha,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    committedAt: record.committedAt,
    pushedAt: record.pushedAt,
  };
}

// ---------------------------------------------------------------------------
// 1. La politique du projet
// ---------------------------------------------------------------------------

/**
 * La politique de livraison d'un projet.
 *
 * `MANUAL` pour un projet inconnu comme pour une valeur illisible : le defaut
 * sur n'accorde rien, et ne peut pas ouvrir un droit d'ecriture par accident.
 */
export async function readProjectDeliveryPolicy(
  db: DatabaseClient,
  projectId: string,
): Promise<DeliveryPolicy> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { deliveryPolicy: true },
  });
  return readDeliveryPolicy(project?.deliveryPolicy);
}

export type SetDeliveryPolicyResult =
  | { ok: true; policy: DeliveryPolicy; changed: boolean }
  | { ok: false; reason: "not_found" };

/**
 * Change la politique de livraison d'un projet.
 *
 * Une ecriture SQLite, et rien d'autre : aucun appel au fournisseur, aucun
 * Claude Code, aucune commande Git. Changer `AUTO_COMMIT_PUSH` pour `MANUAL`
 * n'annule aucun commit deja cree, ne restaure rien et ne supprime aucune
 * livraison passee — la nouvelle politique ne gouverne que ce qui n'a pas encore
 * eu lieu.
 */
export async function setProjectDeliveryPolicy(
  db: DatabaseClient,
  projectId: string,
  policy: DeliveryPolicy,
): Promise<SetDeliveryPolicyResult> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { deliveryPolicy: true },
  });
  if (project === null) {
    return { ok: false, reason: "not_found" };
  }
  const current = readDeliveryPolicy(project.deliveryPolicy);
  if (current === policy) {
    // Une sauvegarde sans changement ne touche ni `updatedAt`, ni rien d'autre :
    // elle ne s'est rien passe, et l'ecran le dira.
    return { ok: true, policy, changed: false };
  }
  await db.project.update({ where: { id: projectId }, data: { deliveryPolicy: policy } });
  return { ok: true, policy, changed: true };
}

// ---------------------------------------------------------------------------
// 2. L'execution qui porte le travail valide
// ---------------------------------------------------------------------------

/** L'execution dont la review a conclu la tache. */
export type CompletionRunFact = {
  runId: string;
  sequence: number;
  status: string;
  decisionId: string;
  decisionSource: string;
};

/**
 * L'execution dont la decision de review a termine cette tache.
 *
 * ## Pourquoi une decision, et pas un statut
 *
 * Parce que `Task.status === COMPLETED` ne dit pas **quel travail** a ete
 * accepte. Une tache marquee terminee a la main n'a ni execution, ni review, ni
 * etat accepte : il n'existe alors aucun candidat sur a livrer, et en fabriquer
 * un reviendrait a commiter ce qui traine dans le dossier de travail.
 *
 * Les trois sources de decision comptent — `AUTOMATED`, `HUMAN`,
 * `HUMAN_OVERRIDE`. Un passage en force reste une decision humaine explicite :
 * quelqu'un a accepte le resultat malgre une preuve en echec, et la politique
 * du projet s'applique alors normalement.
 *
 * La plus recente, parce qu'une tache peut avoir ete rouverte puis reacceptee :
 * c'est le dernier travail accepte qui se livre.
 */
export async function findCompletionRun(
  db: DatabaseClient,
  taskId: string,
): Promise<CompletionRunFact | null> {
  const run = await db.run.findFirst({
    where: { taskId, reviewDecision: { isNot: null } },
    orderBy: { sequence: "desc" },
    select: {
      id: true,
      sequence: true,
      status: true,
      reviewDecision: { select: { id: true, source: true } },
    },
  });
  if (run === null || run.reviewDecision === null) {
    return null;
  }
  return {
    runId: run.id,
    sequence: run.sequence,
    status: run.status,
    decisionId: run.reviewDecision.id,
    decisionSource: run.reviewDecision.source,
  };
}

// ---------------------------------------------------------------------------
// 3. Reservation
// ---------------------------------------------------------------------------

export type ReserveDeliveryResult =
  | { ok: true; delivery: GitDeliveryRow; created: boolean }
  | { ok: false; reason: "conflict" };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Reserve la livraison d'un travail valide.
 *
 * L'ecriture **est** le verrou. La lecture prealable ne sert qu'a rendre la
 * livraison existante plutot qu'un refus : dix constatations simultanees de
 * « tache terminee » obtiennent toutes la meme ligne, et une seule l'a creee.
 *
 * `created` distingue les deux cas, parce que l'appelant en a besoin : c'est
 * lui qui decide s'il y a lieu d'agir, et rejouer une action sur une livraison
 * deja conclue serait exactement ce que la reservation existe pour empecher.
 *
 * Le message de commit est fige ici, et jamais recalcule ensuite.
 */
export async function reserveGitDelivery(
  db: DatabaseClient,
  input: {
    projectId: string;
    taskId: string;
    sourceRunId: string;
    sourceDecisionId: string | null;
    policy: DeliveryPolicy;
    trigger: DeliveryTrigger;
    expectedHead: string;
    expectedBranch: string;
    candidateFingerprint: string;
    candidate: readonly DeliveryCandidateEntry[];
    upstreamRemote: string | null;
    upstreamRef: string | null;
    /** Construit a partir de l'identifiant que cette fonction vient d'attribuer. */
    buildCommitMessage: (deliveryId: string) => string;
  },
): Promise<ReserveDeliveryResult> {
  const existing = await db.gitDelivery.findUnique({
    where: { taskId_sourceRunId: { taskId: input.taskId, sourceRunId: input.sourceRunId } },
  });
  if (existing !== null) {
    return { ok: true, delivery: toRow(existing), created: false };
  }

  // L'identifiant est attribue avant l'ecriture parce que le message de commit
  // le contient : le trailer doit designer cette livraison-la, et il ne peut pas
  // etre ajoute apres coup sans reecrire un message deja fige.
  const id = newDeliveryId();

  try {
    const created = await db.gitDelivery.create({
      data: {
        id,
        projectId: input.projectId,
        taskId: input.taskId,
        sourceRunId: input.sourceRunId,
        sourceDecisionId: input.sourceDecisionId,
        policy: input.policy,
        trigger: input.trigger,
        status: DELIVERY_STATUS.PENDING,
        attempt: 0,
        expectedHead: input.expectedHead,
        expectedBranch: input.expectedBranch,
        candidateFingerprint: input.candidateFingerprint,
        candidateJson: JSON.stringify(input.candidate),
        upstreamRemote: input.upstreamRemote,
        upstreamRef: input.upstreamRef,
        commitMessage: input.buildCommitMessage(id),
      },
    });
    return { ok: true, delivery: toRow(created), created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // Quelqu'un a pris la place entre la lecture et l'ecriture : c'est
    // exactement ce que l'index unique existe pour produire.
    const winner = await db.gitDelivery.findUnique({
      where: { taskId_sourceRunId: { taskId: input.taskId, sourceRunId: input.sourceRunId } },
    });
    return winner === null
      ? { ok: false, reason: "conflict" }
      : { ok: true, delivery: toRow(winner), created: false };
  }
}

/**
 * Un identifiant de livraison, court et sans separateur.
 *
 * Il apparait dans un trailer de commit, donc dans l'historique Git : un
 * identifiant qui contiendrait un espace ou un saut de ligne casserait la
 * reconnaissance du trailer, et un identifiant de cinquante caracteres
 * encombrerait un message que des humains relisent.
 */
function newDeliveryId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  let id = "";
  for (const byte of bytes) {
    id += alphabet[byte % alphabet.length];
  }
  return id;
}

// ---------------------------------------------------------------------------
// 4. Lecture
// ---------------------------------------------------------------------------

/** Une livraison, par identifiant. */
export async function getGitDelivery(
  db: DatabaseClient,
  deliveryId: string,
): Promise<GitDeliveryRow | null> {
  const row = await db.gitDelivery.findUnique({ where: { id: deliveryId } });
  return row === null ? null : toRow(row);
}

/** La livraison d'un travail valide, s'il en existe une. */
export async function getDeliveryForRun(
  db: DatabaseClient,
  taskId: string,
  sourceRunId: string,
): Promise<GitDeliveryRow | null> {
  const row = await db.gitDelivery.findUnique({
    where: { taskId_sourceRunId: { taskId, sourceRunId } },
  });
  return row === null ? null : toRow(row);
}

/** La livraison la plus recente d'une tache, ou `null`. */
export async function getLatestDeliveryForTask(
  db: DatabaseClient,
  taskId: string,
): Promise<GitDeliveryRow | null> {
  const row = await db.gitDelivery.findFirst({
    where: { taskId },
    orderBy: { createdAt: "desc" },
  });
  return row === null ? null : toRow(row);
}

/** Les livraisons d'un projet, de la plus recente a la plus ancienne. */
export async function listProjectDeliveries(
  db: DatabaseClient,
  projectId: string,
  limit = 20,
): Promise<GitDeliveryRow[]> {
  const rows = await db.gitDelivery.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toRow);
}

/**
 * La livraison qui empeche la file d'avancer, s'il y en a une.
 *
 * ## Ce que « bloquante » veut dire ici
 *
 * Une livraison dont la politique **enregistree** n'est pas satisfaite. La
 * politique du projet peut avoir change depuis ; c'est celle qui figurait sur la
 * livraison qui fait foi, parce que c'est elle qui a decide de ce qui devait
 * etre ecrit. Une livraison `MANUAL` n'est jamais bloquante : ce mode confie la
 * question au preflight Git existant, exactement comme avant TASK-029.
 *
 * La question est posee sur la livraison la **plus recente** du projet : une
 * seule tache travaille a la fois dans un repository, donc une seule livraison
 * peut etre en attente d'une ecriture.
 */
export async function getBlockingDelivery(
  db: DatabaseClient,
  projectId: string,
): Promise<GitDeliveryRow | null> {
  const row = await db.gitDelivery.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  if (row === null) {
    return null;
  }
  const delivery = toRow(row);
  // `MANUAL` n'est jamais bloquante — et ce n'est pas une deduction de
  // `deliverySatisfied`, qui rend deliberement `false` dans ce mode : ce
  // `false`-la veut dire « NOX n'a rien ecrit », pas « la file doit attendre ».
  // Les confondre arreterait toutes les files des projets manuels, c'est-a-dire
  // le comportement d'avant TASK-029.
  if (!policyAllowsAutomatic(delivery.policy)) {
    return null;
  }
  return deliverySatisfied(delivery.policy, delivery.status) ? null : delivery;
}

// ---------------------------------------------------------------------------
// 5. Le verrou d'ecriture
// ---------------------------------------------------------------------------

export type ClaimDeliveryResult =
  | { ok: true; delivery: GitDeliveryRow }
  | { ok: false; reason: "not_found" | "busy" };

/**
 * Prend la main sur une livraison, pour engager une ecriture Git.
 *
 * ## Pourquoi une mise a jour conditionnelle, et pas une lecture puis une ecriture
 *
 * Parce que deux `Resume delivery` simultanes liraient tous les deux le meme
 * compteur, et croiraient tous les deux avoir le droit d'ecrire. La condition
 * porte sur la valeur lue : un seul `updateMany` rend `1`, l'autre rend `0` et
 * recoit un refus nomme. C'est la meme discipline que les verrous de generation
 * de l'Architecte, appliquee a un troisieme point de concurrence.
 *
 * ## Pourquoi le compteur ne recule jamais
 *
 * Parce qu'une panne entre la prise de main et l'ecriture ne doit pas rendre le
 * numero. Une reprise prend le suivant, et l'ancienne tentative reste ce qu'elle
 * est : une tentative dont on ne connait pas l'issue, que la reconciliation par
 * trailer saura reconnaitre si elle avait abouti.
 */
export async function claimDelivery(
  db: DatabaseClient,
  input: {
    deliveryId: string;
    expectedAttempt: number;
    /** Statuts depuis lesquels la prise de main est autorisee. */
    from: readonly DeliveryStatus[];
    to: DeliveryStatus;
    /**
     * Qui engage cette ecriture.
     *
     * Reecrit a chaque prise de main : une livraison automatique bloquee puis
     * reprise a la main a bien ete livree par un humain, et l'historique doit le
     * dire — c'est la reponse a « pourquoi ce commit existe-t-il ? ».
     */
    trigger?: DeliveryTrigger;
  },
): Promise<ClaimDeliveryResult> {
  const claimed = await db.gitDelivery.updateMany({
    where: {
      id: input.deliveryId,
      attempt: input.expectedAttempt,
      status: { in: [...input.from] },
    },
    data: {
      attempt: input.expectedAttempt + 1,
      status: input.to,
      ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
      // La prise de main efface le refus precedent : il decrivait la tentative
      // d'avant, et le laisser afficherait une erreur pendant qu'une ecriture
      // est en cours.
      errorCode: null,
      errorMessage: null,
    },
  });
  if (claimed.count !== 1) {
    const existing = await getGitDelivery(db, input.deliveryId);
    return { ok: false, reason: existing === null ? "not_found" : "busy" };
  }
  const delivery = await getGitDelivery(db, input.deliveryId);
  return delivery === null ? { ok: false, reason: "not_found" } : { ok: true, delivery };
}

/**
 * Enregistre le commit cree par une livraison.
 *
 * `committedAt` n'est pose que la premiere fois : une reconciliation apres panne
 * constate un commit deja existant, et lui attribuer l'heure d'aujourd'hui
 * ferait mentir l'historique sur le moment ou le travail a ete livre.
 */
export async function recordDeliveryCommit(
  db: DatabaseClient,
  deliveryId: string,
  input: { commitSha: string; status: DeliveryStatus; committedAt?: Date },
): Promise<GitDeliveryRow | null> {
  const existing = await db.gitDelivery.findUnique({
    where: { id: deliveryId },
    select: { committedAt: true },
  });
  await db.gitDelivery.update({
    where: { id: deliveryId },
    data: {
      commitSha: input.commitSha,
      status: input.status,
      committedAt: existing?.committedAt ?? input.committedAt ?? new Date(),
      errorCode: null,
      errorMessage: null,
    },
  });
  return getGitDelivery(db, deliveryId);
}

/** Enregistre le push d'une livraison. */
export async function recordDeliveryPush(
  db: DatabaseClient,
  deliveryId: string,
  input: { remote: string; remoteRef: string; pushedAt?: Date },
): Promise<GitDeliveryRow | null> {
  const existing = await db.gitDelivery.findUnique({
    where: { id: deliveryId },
    select: { pushedAt: true },
  });
  await db.gitDelivery.update({
    where: { id: deliveryId },
    data: {
      status: DELIVERY_STATUS.DELIVERED,
      upstreamRemote: input.remote,
      upstreamRef: input.remoteRef,
      pushedAt: existing?.pushedAt ?? input.pushedAt ?? new Date(),
      errorCode: null,
      errorMessage: null,
    },
  });
  return getGitDelivery(db, deliveryId);
}

/**
 * Enregistre un refus ou un echec, sans rien defaire.
 *
 * Un push refuse laisse le commit local en place : `commitSha` et `committedAt`
 * ne sont jamais effaces, et le statut reste `COMMITTED`. « Le commit existe, le
 * push a echoue » est un etat exact, et le reduire a « echec » ferait proposer
 * une reprise complete — qui creerait un second commit.
 */
export async function recordDeliveryFailure(
  db: DatabaseClient,
  deliveryId: string,
  input: { status: DeliveryStatus; errorCode: string; errorMessage: string },
): Promise<GitDeliveryRow | null> {
  await db.gitDelivery.update({
    where: { id: deliveryId },
    data: {
      status: input.status,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    },
  });
  return getGitDelivery(db, deliveryId);
}

/**
 * Le declencheur par defaut d'une livraison creee sans clic.
 *
 * Expose pour que l'appelant n'ait pas a reimporter le vocabulaire complet
 * lorsqu'il ne fait que reserver.
 */
export const AUTOMATIC_DELIVERY_TRIGGER = DELIVERY_TRIGGER.AUTOMATIC;
