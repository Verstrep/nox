/**
 * Ce que NOX a observe de la terminaison d'un processus Claude Code.
 *
 * ## Le probleme que ce module resout
 *
 * Le second pilote reel a produit une execution qui affichait, en tout et pour
 * tout, `CLAUDE_PROCESS_FAILED` et `exitCode = 1`. Onze minutes de travail,
 * quatre mille lignes ecrites, et un ecran qui ne disait ni ce que l'agent
 * tentait, ni ce que NOX avait vu ceder.
 *
 * Or NOX **savait** davantage. Il savait que le processus avait bien demarre,
 * qu'il avait rendu un flux lisible, qu'il avait rapporte lui-meme une erreur,
 * et quelle etait sa derniere action reconnue. Rien de tout cela n'etait
 * conserve : le diagnostic s'arretait au code, et le code melangeait des causes
 * qui n'appellent pas les memes gestes.
 *
 * ## Categorie et code sont deux choses
 *
 * `errorCode` reste ce qu'il a toujours ete : le code du contrat runner, stable,
 * enregistre tel quel, jamais reecrit. Une execution de 2025 le porte encore, et
 * les pages qui le traduisent continuent de fonctionner.
 *
 * La **categorie** repond a une autre question : « qu'est-ce qui a cede ? ». Un
 * processus qui n'a jamais demarre, un processus tue par un delai, et un
 * processus qui a travaille puis rendu un code non nul sont trois incidents
 * differents, et le seul qui puisse se reprendre est le troisieme.
 *
 * ## Rien n'est invente
 *
 * Une categorie ne se devine pas a partir d'un message : elle se derive de faits
 * que NOX a lui-meme enregistres — un code de contrat, un code de sortie, un
 * drapeau d'annulation. Quand aucun fait ne tranche, la categorie est `UNKNOWN`,
 * et c'est une reponse honnete plutot qu'une hypothese habillee.
 */

import { createStatusGuard } from "./statuses.js";

/**
 * Ce qui a cede, dans une execution qui ne s'est pas terminee normalement.
 *
 * Liste **fermee**. Chaque valeur correspond a un fait que NOX observe
 * lui-meme ; aucune ne repose sur l'interpretation d'un texte.
 */
export const RUN_FAILURE_CATEGORY = {
  /**
   * Le processus n'a jamais demarre.
   *
   * Binaire introuvable, refus du systeme, chemin invalide. Rien n'a tourne,
   * donc rien n'a ete produit : ce n'est pas un travail rate, c'est une
   * installation a reparer.
   */
  SPAWN_FAILED: "SPAWN_FAILED",
  /**
   * Le processus a travaille puis rendu un code de sortie non nul.
   *
   * C'est le cas du pilote reel, et le seul qui laisse derriere lui un dossier
   * de travail exploitable.
   */
  PROCESS_EXIT_NONZERO: "PROCESS_EXIT_NONZERO",
  /**
   * Le processus a rendu un code nul, et s'est declare en erreur.
   *
   * Distinct du precedent : ici c'est l'agent qui dit avoir echoue, pas le
   * systeme. Les confondre ferait chercher une panne la ou il y a un abandon
   * raisonne — ou l'inverse.
   */
  AGENT_REPORTED_ERROR: "AGENT_REPORTED_ERROR",
  /** NOX a atteint son plafond et a arrete le processus. */
  TIMEOUT: "TIMEOUT",
  /** Un humain a demande l'arret, et il a eu lieu. */
  CANCELLED: "CANCELLED",
  /**
   * Le flux n'etait pas lisible.
   *
   * Le processus a parle, mais NOX n'a pas retrouve la ligne de resultat
   * attendue. Ni une panne de lancement, ni un echec de travail.
   */
  STREAM_UNREADABLE: "STREAM_UNREADABLE",
  /** Une limite d'utilisation Claude a ete reconnue. Le geste est d'attendre. */
  USAGE_LIMIT: "USAGE_LIMIT",
  /** L'execution a commite, change de branche, ou sorti du perimetre. */
  GIT_POLICY_VIOLATION: "GIT_POLICY_VIOLATION",
  /**
   * NOX a perdu le contact avec le runner.
   *
   * Le processus a pu continuer, reussir, ou mourir : NOX ne le sait pas, et
   * cette categorie dit exactement cela.
   */
  TRANSPORT_FAILED: "TRANSPORT_FAILED",
  /** Aucun fait enregistre ne tranche. */
  UNKNOWN: "UNKNOWN",
} as const;

export type RunFailureCategory =
  (typeof RUN_FAILURE_CATEGORY)[keyof typeof RUN_FAILURE_CATEGORY];

export const RUN_FAILURE_CATEGORIES: readonly RunFailureCategory[] =
  Object.values(RUN_FAILURE_CATEGORY);

export const isRunFailureCategory = createStatusGuard(RUN_FAILURE_CATEGORIES);

/**
 * Bornes du diagnostic conserve.
 *
 * Des constantes, comme toutes les bornes de securite de NOX. Un diagnostic est
 * une aide a la lecture : le laisser grossir sans limite ferait entrer dans la
 * base des sorties de processus entieres, c'est-a-dire exactement ce que
 * TASK-010 a passe son temps a en sortir.
 */
export const RUN_FAILURE_LIMITS = {
  /** Phrase ecrite par NOX pour nommer la cause. */
  detail: 500,
} as const;

/**
 * Codes de contrat qui designent une cause a eux seuls.
 *
 * La table est explicite plutot que calculee : elle se relit, et un code ajoute
 * plus tard au contrat runner n'y entre pas tout seul — il tombera dans
 * `UNKNOWN`, ce qui est le bon defaut.
 */
const CATEGORY_BY_ERROR_CODE: Readonly<Record<string, RunFailureCategory>> = {
  CLAUDE_START_FAILED: RUN_FAILURE_CATEGORY.SPAWN_FAILED,
  CLAUDE_TIMEOUT: RUN_FAILURE_CATEGORY.TIMEOUT,
  CLAUDE_OUTPUT_INVALID: RUN_FAILURE_CATEGORY.STREAM_UNREADABLE,
  CLAUDE_LIMIT_REACHED: RUN_FAILURE_CATEGORY.USAGE_LIMIT,
  GIT_POLICY_VIOLATION: RUN_FAILURE_CATEGORY.GIT_POLICY_VIOLATION,
  CLAUDE_RUN_NOT_FOUND: RUN_FAILURE_CATEGORY.TRANSPORT_FAILED,
  CLAUDE_CANCEL_FAILED: RUN_FAILURE_CATEGORY.TRANSPORT_FAILED,
};

/** Ce qu'il faut savoir d'une execution pour nommer ce qui a cede. */
export type RunFailureFacts = {
  /** Statut final de l'execution. */
  status: string;
  /** Code du contrat runner enregistre, ou `null`. */
  errorCode: string | null;
  /** Code de sortie du processus, ou `null` s'il a ete tue par un signal. */
  exitCode: number | null;
};

/**
 * Derive la categorie a partir des faits deja enregistres.
 *
 * Sert deux fois, et c'est voulu : le runner l'appelle a la conclusion pour
 * enregistrer la valeur, et le web l'appelle a la lecture pour les executions
 * anterieures a HOTFIX-006, dont la colonne est vide. Une seule implementation,
 * donc une execution ancienne et une execution nouvelle se lisent pareil.
 *
 * Ce n'est pas une reconstruction : la fonction ne regarde que des faits que NOX
 * avait deja persistes. Elle ne rend jamais plus precis que ce qu'ils disent.
 */
export function deriveRunFailureCategory(facts: RunFailureFacts): RunFailureCategory {
  if (facts.status === "CANCELLED") {
    return RUN_FAILURE_CATEGORY.CANCELLED;
  }

  if (facts.errorCode !== null) {
    const known = CATEGORY_BY_ERROR_CODE[facts.errorCode];
    if (known !== undefined) {
      return known;
    }
  }

  // `CLAUDE_PROCESS_FAILED` est precisement le code qui melangeait plusieurs
  // causes. Le code de sortie les separe : non nul, c'est le systeme ; nul,
  // c'est l'agent qui s'est declare en erreur ; absent, le processus a ete tue
  // par un signal et personne n'a tranche. Cette table est **exactement** celle
  // que le runner applique a la conclusion, et c'est ce qui fait qu'une
  // execution ancienne et une execution nouvelle se lisent pareil.
  if (facts.errorCode === "CLAUDE_PROCESS_FAILED") {
    if (facts.exitCode === null) {
      return RUN_FAILURE_CATEGORY.UNKNOWN;
    }
    return facts.exitCode === 0
      ? RUN_FAILURE_CATEGORY.AGENT_REPORTED_ERROR
      : RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO;
  }

  return RUN_FAILURE_CATEGORY.UNKNOWN;
}

/**
 * Categorie enregistree, ou derivee a defaut.
 *
 * L'ordre compte : la valeur ecrite par le runner fait autorite, et la
 * derivation ne sert qu'aux executions qui n'en portent aucune. L'inverse
 * reecrirait l'histoire a chaque lecture.
 */
export function readRunFailureCategory(
  persisted: string | null,
  facts: RunFailureFacts,
): RunFailureCategory {
  if (persisted !== null && isRunFailureCategory(persisted)) {
    return persisted;
  }
  return deriveRunFailureCategory(facts);
}

/**
 * Une execution de cette categorie peut-elle laisser un travail exploitable ?
 *
 * Repond a une question precise : « proposer une correction ici a-t-il un
 * sens ? ». Un processus qui n'a jamais demarre n'a rien produit ; un depassement
 * de plafond, une sortie non nulle ou une annulation, si.
 *
 * Elle n'**autorise** rien : l'autorisation vient de l'empreinte du dossier de
 * travail, verifiee par le runner. Elle evite seulement de proposer un geste
 * dont on sait d'avance qu'il ne trouverait rien a reprendre.
 */
export function categoryMayLeavePartialWork(category: RunFailureCategory): boolean {
  switch (category) {
    case RUN_FAILURE_CATEGORY.SPAWN_FAILED:
    case RUN_FAILURE_CATEGORY.USAGE_LIMIT:
      return false;
    case RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO:
    case RUN_FAILURE_CATEGORY.AGENT_REPORTED_ERROR:
    case RUN_FAILURE_CATEGORY.TIMEOUT:
    case RUN_FAILURE_CATEGORY.CANCELLED:
    case RUN_FAILURE_CATEGORY.STREAM_UNREADABLE:
    case RUN_FAILURE_CATEGORY.GIT_POLICY_VIOLATION:
    case RUN_FAILURE_CATEGORY.TRANSPORT_FAILED:
    case RUN_FAILURE_CATEGORY.UNKNOWN:
      return true;
  }
}

/**
 * Nettoie et borne une phrase de diagnostic ecrite par NOX.
 *
 * Les caracteres de controle sont retires, les espaces reduits, la longueur
 * bornee avec une marque explicite. Cette fonction ne rend **jamais** un texte
 * plus sur qu'il ne l'etait : elle borne. Ce qui garantit qu'aucun secret n'y
 * entre, c'est que l'appelant ne lui donne que des valeurs que NOX a ecrites.
 */
export function boundFailureDetail(detail: string): string | null {
  const cleaned = detail
    // eslint-disable-next-line no-control-regex -- c'est precisement ce qu'on retire.
    .replace(/[\u0000-\u001F\u007F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned === "") {
    return null;
  }
  return cleaned.length <= RUN_FAILURE_LIMITS.detail
    ? cleaned
    : `${cleaned.slice(0, RUN_FAILURE_LIMITS.detail - 2).trim()} …`;
}
