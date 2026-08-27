/**
 * Contrat web <-> runner pour la livraison Git.
 *
 * ## Trois routes, et pas une de plus
 *
 * `inspect` lit, `commit` ecrit un commit, `push` envoie. Il n'existe aucune
 * route de nettoyage, de restauration, de changement de branche ni de
 * configuration : ce que le contrat ne decrit pas ne peut pas etre demande.
 *
 * ## Ce que le corps ne transporte jamais
 *
 * Aucun argument Git. Le corps porte des **faits attendus** — une branche, un
 * `HEAD`, une empreinte, une liste de chemins relatifs, un message deja
 * construit — et le runner en deduit lui-meme les commandes. Un appelant ne peut
 * donc pas glisser `--force`, `--no-verify` ou un `reset` : il n'y a aucun champ
 * ou les mettre.
 *
 * Le navigateur, lui, n'atteint jamais ces routes. Il envoie un identifiant de
 * projet et un identifiant de livraison ; tout le reste est relu cote serveur.
 *
 * ## La double validation est voulue
 *
 * Le serveur web verifie l'etat du repository avant d'appeler ; le runner le
 * reverifie avant d'ecrire. Ce n'est pas de la redondance : c'est ici que Git
 * est reellement invoque, et cette frontiere ne fait confiance a personne — pas
 * meme au serveur web de NOX.
 */

import { DELIVERY_LIMITS, type DeliveryCandidateEntry } from "./git-delivery.js";
import type { RunnerErrorCode } from "./runner.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRelativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    value.length <= 1_024 &&
    !value.includes("\0") &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !/^[A-Za-z]:/u.test(value) &&
    !value.split("/").includes("..")
  );
}

// ---------------------------------------------------------------------------
// 1. Inspection
// ---------------------------------------------------------------------------

/**
 * Corps de `POST /repositories/delivery/inspect`.
 *
 * `trailer` est facultatif : quand il est present, le runner dit si le message
 * de `HEAD` le porte. C'est ce qui permet a une reprise apres panne de
 * reconnaitre un commit deja cree au lieu d'en produire un second.
 */
export type DeliveryInspectRequest = {
  repositoryPath: string;
  trailer?: string;
};

/** Ce que le runner sait dire d'un repository, sans rien y ecrire. */
export type DeliveryInspection = {
  /** `null` lorsque `HEAD` est detache. */
  branch: string | null;
  head: string;
  /** Parents de `HEAD`, pour reconnaitre un commit deja cree. */
  headParents: readonly string[];
  /** Le message de `HEAD` porte le trailer demande. */
  headTrailerMatches: boolean;
  /** Nom du remote de suivi, ou `null` si la branche n'a pas d'upstream. */
  upstreamRemote: string | null;
  /** Reference distante complete, par exemple `refs/heads/main`. */
  upstreamRef: string | null;
  /**
   * Commit designe par la reference de suivi locale, ou `null`.
   *
   * C'est ce que **cette machine** a reussi a envoyer, pas l'etat du serveur
   * distant : aucun `fetch` n'est fait pour lever le doute.
   */
  upstreamCommit: string | null;
  /** L'index porte des changements prepares. */
  indexDirty: boolean;
  /** Entrees changees, fichiers ignores exclus. */
  entries: readonly DeliveryCandidateEntry[];
  /** Entrees ecartees faute de place. */
  omittedEntries: number;
  /** Empreinte authentifiee du dossier de travail, ou `null` si indisponible. */
  fingerprint: string | null;
  /** `user.name` et `user.email` sont tous les deux configures. */
  identityComplete: boolean;
  /** `commit.gpgsign` est actif. */
  signingConfigured: boolean;
  /** Hooks de commit installes, par nom. */
  hooks: readonly string[];
};

export type DeliveryInspectSuccess = {
  ok: true;
  inspection: DeliveryInspection;
};

/** Valide le corps recu par `POST /repositories/delivery/inspect`. */
export function parseDeliveryInspectRequest(value: unknown): DeliveryInspectRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const repositoryPath: unknown = value["repositoryPath"];
  if (typeof repositoryPath !== "string" || repositoryPath.trim() === "") {
    return null;
  }
  const trailer: unknown = value["trailer"];
  if (trailer === undefined) {
    return { repositoryPath };
  }
  if (typeof trailer !== "string" || trailer === "" || trailer.length > 256) {
    return null;
  }
  return { repositoryPath, trailer };
}

function isCandidateEntry(value: unknown): value is DeliveryCandidateEntry {
  return (
    isRecord(value) &&
    typeof value["code"] === "string" &&
    value["code"].length <= 2 &&
    isRelativePath(value["path"])
  );
}

/** Verifie qu'une reponse JSON est une inspection de livraison. */
export function isDeliveryInspectSuccess(value: unknown): value is DeliveryInspectSuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }
  const inspection: unknown = value["inspection"];
  if (!isRecord(inspection)) {
    return false;
  }
  const branch: unknown = inspection["branch"];
  const entries: unknown = inspection["entries"];
  const parents: unknown = inspection["headParents"];
  const hooks: unknown = inspection["hooks"];
  return (
    (branch === null || typeof branch === "string") &&
    typeof inspection["head"] === "string" &&
    Array.isArray(parents) &&
    parents.every((entry) => typeof entry === "string") &&
    typeof inspection["headTrailerMatches"] === "boolean" &&
    (inspection["upstreamRemote"] === null || typeof inspection["upstreamRemote"] === "string") &&
    (inspection["upstreamRef"] === null || typeof inspection["upstreamRef"] === "string") &&
    (inspection["upstreamCommit"] === null || typeof inspection["upstreamCommit"] === "string") &&
    typeof inspection["indexDirty"] === "boolean" &&
    Array.isArray(entries) &&
    entries.every(isCandidateEntry) &&
    typeof inspection["omittedEntries"] === "number" &&
    (inspection["fingerprint"] === null || typeof inspection["fingerprint"] === "string") &&
    typeof inspection["identityComplete"] === "boolean" &&
    typeof inspection["signingConfigured"] === "boolean" &&
    Array.isArray(hooks) &&
    hooks.every((entry) => typeof entry === "string")
  );
}

// ---------------------------------------------------------------------------
// 2. Commit
// ---------------------------------------------------------------------------

/**
 * Corps de `POST /repositories/delivery/commit`.
 *
 * Tout est **attendu**, rien n'est impose : le runner verifie chaque valeur
 * contre ce qu'il lit lui-meme, et refuse des la premiere divergence. Les
 * chemins sont relatifs, bornes, et deviennent des pathspecs litteraux — jamais
 * une ligne de commande.
 */
export type DeliveryCommitRequest = {
  repositoryPath: string;
  expectedBranch: string;
  expectedHead: string;
  expectedFingerprint: string;
  /** Chemins exacts du candidat valide. Aucun autre ne sera prepare. */
  paths: readonly string[];
  message: string;
  /** Trailer attendu dans `HEAD`, pour reconnaitre un commit deja cree. */
  trailer: string;
};

/**
 * Ce que la tentative de commit a produit.
 *
 * ## Pourquoi un echec de Git rend `200`
 *
 * Parce qu'un hook qui refuse **est une reponse**, exactement comme le code de
 * sortie non nul d'une validation autonome. Ce n'est pas une panne du runner :
 * la commande a demarre, Git a repondu, et sa reponse est ce que l'utilisateur
 * doit lire. Les vrais refus — branche differente, empreinte divergente, index
 * garni — restent des erreurs HTTP, avec leur code du contrat.
 *
 * `failureDetail` est passe par la **sanitation centralisee** : chemins du
 * repository rendus relatifs, chemins exterieurs masques, variables `NOX_*`
 * retirees, identifiants d'URL supprimes, taille bornee.
 */
export type DeliveryCommitSuccess = {
  ok: true;
  /** `null` lorsque le commit n'a pas pu etre cree. */
  commitSha: string | null;
  /** Le commit existait deja : une reponse avait ete perdue, pas un commit. */
  alreadyCommitted: boolean;
  /** Le dossier de travail est propre, fichiers ignores exclus. */
  worktreeClean: boolean;
  failureCode: RunnerErrorCode | null;
  failureDetail: string | null;
};

/** Valide le corps recu par `POST /repositories/delivery/commit`. */
export function parseDeliveryCommitRequest(value: unknown): DeliveryCommitRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const repositoryPath: unknown = value["repositoryPath"];
  const expectedBranch: unknown = value["expectedBranch"];
  const expectedHead: unknown = value["expectedHead"];
  const expectedFingerprint: unknown = value["expectedFingerprint"];
  const paths: unknown = value["paths"];
  const message: unknown = value["message"];
  const trailer: unknown = value["trailer"];

  if (
    typeof repositoryPath !== "string" ||
    repositoryPath.trim() === "" ||
    typeof expectedBranch !== "string" ||
    expectedBranch.trim() === "" ||
    typeof expectedHead !== "string" ||
    !/^[0-9a-f]{40}$/u.test(expectedHead) ||
    typeof expectedFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(expectedFingerprint) ||
    typeof message !== "string" ||
    message.trim() === "" ||
    message.length > 8_000 ||
    typeof trailer !== "string" ||
    trailer === "" ||
    trailer.length > 256 ||
    !message.includes(trailer)
  ) {
    return null;
  }

  if (!Array.isArray(paths) || paths.length === 0 || paths.length > DELIVERY_LIMITS.maxEntries) {
    return null;
  }
  if (!paths.every(isRelativePath)) {
    return null;
  }

  return {
    repositoryPath,
    expectedBranch,
    expectedHead,
    expectedFingerprint,
    paths: paths as string[],
    message,
    trailer,
  };
}

/** Verifie qu'une reponse JSON est un commit de livraison. */
export function isDeliveryCommitSuccess(value: unknown): value is DeliveryCommitSuccess {
  return (
    isRecord(value) &&
    value["ok"] === true &&
    (value["commitSha"] === null || typeof value["commitSha"] === "string") &&
    typeof value["alreadyCommitted"] === "boolean" &&
    typeof value["worktreeClean"] === "boolean" &&
    (value["failureCode"] === null || typeof value["failureCode"] === "string") &&
    (value["failureDetail"] === null || typeof value["failureDetail"] === "string")
  );
}

// ---------------------------------------------------------------------------
// 3. Push
// ---------------------------------------------------------------------------

/**
 * Corps de `POST /repositories/delivery/push`.
 *
 * Ni remote, ni URL, ni refspec : le runner lit l'upstream de la branche
 * courante dans la configuration Git du repository, et pousse la ou elle
 * l'indique. Aucun appelant ne peut donc designer une destination.
 */
export type DeliveryPushRequest = {
  repositoryPath: string;
  expectedBranch: string;
  /** Commit local que la livraison a cree, et le seul qu'elle accepte de pousser. */
  expectedHead: string;
};

/**
 * Ce que la tentative de push a produit.
 *
 * Meme regle que pour le commit : un refus du serveur distant est une reponse,
 * pas une panne. `DELIVERY_PUSH_REJECTED` et `DELIVERY_PUSH_FAILED` restent
 * distincts — l'un demande de reconcilier un historique, l'autre de reessayer.
 */
export type DeliveryPushSuccess = {
  ok: true;
  pushed: boolean;
  /** L'upstream contenait deja ce commit : rien n'a ete envoye. */
  alreadyPushed: boolean;
  remote: string;
  remoteRef: string;
  failureCode: RunnerErrorCode | null;
  failureDetail: string | null;
};

/** Valide le corps recu par `POST /repositories/delivery/push`. */
export function parseDeliveryPushRequest(value: unknown): DeliveryPushRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const repositoryPath: unknown = value["repositoryPath"];
  const expectedBranch: unknown = value["expectedBranch"];
  const expectedHead: unknown = value["expectedHead"];

  if (
    typeof repositoryPath !== "string" ||
    repositoryPath.trim() === "" ||
    typeof expectedBranch !== "string" ||
    expectedBranch.trim() === "" ||
    typeof expectedHead !== "string" ||
    !/^[0-9a-f]{40}$/u.test(expectedHead)
  ) {
    return null;
  }

  return { repositoryPath, expectedBranch, expectedHead };
}

/** Verifie qu'une reponse JSON est un push de livraison. */
export function isDeliveryPushSuccess(value: unknown): value is DeliveryPushSuccess {
  return (
    isRecord(value) &&
    value["ok"] === true &&
    typeof value["pushed"] === "boolean" &&
    typeof value["alreadyPushed"] === "boolean" &&
    typeof value["remote"] === "string" &&
    typeof value["remoteRef"] === "string" &&
    (value["failureCode"] === null || typeof value["failureCode"] === "string") &&
    (value["failureDetail"] === null || typeof value["failureDetail"] === "string")
  );
}
