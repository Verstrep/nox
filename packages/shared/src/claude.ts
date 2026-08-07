/**
 * Contrat HTTP des routes Claude Code du runner.
 *
 * Cinq routes, cinq responsabilites :
 *
 * - `POST /claude/preflight`      — verifier, en lecture seule, qu'un lancement
 *                                   est possible ;
 * - `POST /claude/runs/start`     — lancer, et repondre sans attendre la fin ;
 * - `POST /claude/runs/status`    — consulter l'etat d'une execution ;
 * - `POST /claude/runs/events`    — lire les evenements publics apres un curseur ;
 * - `POST /claude/runs/cancel`    — demander l'arret d'une execution active.
 *
 * Regle structurante, comme partout ailleurs : **aucun chemin absolu ne remonte
 * au navigateur**. Le preflight renvoie une branche, un upstream et un `HEAD`,
 * jamais le chemin du repository — que l'appelant connait deja, puisque c'est
 * lui qui l'a envoye.
 */

import {
  RUN_EVENT_LIMITS,
  isClaudeRunEvent,
  type ClaudeRunEvent,
} from "./claude-events.js";
import { isRunnerRunId } from "./runs.js";
import { RUN_STATUS, type RunStatus } from "./statuses.js";

/** Corps de `POST /claude/preflight`. */
export type ClaudePreflightRequest = {
  repositoryPath: string;
};

/**
 * Etat Git constate par le preflight.
 *
 * `ahead` et `behind` sont calcules contre la **reference upstream locale**,
 * telle que Git la connait sans acces reseau. Le preflight ne fait volontairement
 * aucun `fetch` : il ne peut donc pas affirmer que la branche est a jour vis-a-vis
 * du serveur distant, seulement qu'elle l'est vis-a-vis de ce que la machine sait.
 */
export type ClaudePreflightGit = {
  clean: boolean;
  branch: string;
  upstream: string;
  head: string;
  ahead: number;
  behind: number;
};

export type ClaudePreflightSuccess = {
  ok: true;
  claude: {
    available: true;
    version: string;
  };
  git: ClaudePreflightGit;
};

/**
 * Corps de `POST /claude/runs/start`.
 *
 * `expectedGitHead` vient du preflight. Le runner refuse de lancer si `HEAD` a
 * change entre-temps : sans cette verification, un `git pull` fait pendant que
 * l'utilisateur lisait le prompt produirait une execution partant d'un etat que
 * personne n'a valide.
 *
 * `validationCommands` sont relues en base par le web, jamais saisies dans un
 * formulaire. Le runner les revalide malgre tout avant d'en faire des regles
 * d'autorisation.
 */
export type StartClaudeRunRequest = {
  runId: string;
  repositoryPath: string;
  prompt: string;
  expectedGitHead: string;
  validationCommands: string[];
};

/** Reponse `202` de `POST /claude/runs/start`. */
export type StartClaudeRunSuccess = {
  ok: true;
  run: {
    runId: string;
    status: typeof RUN_STATUS.RUNNING;
    startedAt: string;
  };
};

/** Corps de `POST /claude/runs/status`. */
export type ClaudeRunStatusRequest = {
  runId: string;
};

/**
 * Etat d'une execution, tel que le runner le connait.
 *
 * Tout est facultatif tant que le processus n'a pas fini : le web affiche ce
 * qu'il a, et complete au fil des interrogations.
 */
export type ClaudeRunSnapshot = {
  runId: string;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  /** Date ISO de la demande d'annulation, si un humain en a formule une. */
  cancellationRequestedAt: string | null;
  /** Dernier numero d'evenement attribue ; `0` tant qu'il n'y en a aucun. */
  lastEventSequence: number;
  /** Vrai des qu'une troncature d'evenements a eu lieu. */
  eventsTruncated: boolean;
  exitCode: number | null;
  /** Code d'erreur stable du contrat, lorsqu'il y en a un. */
  errorCode: string | null;
  /** Queue de la sortie d'erreur, bornee et deja nettoyee. */
  stderrTail: string | null;
  /** Compte rendu final de Claude Code. */
  resultText: string | null;
  claudeSessionId: string | null;
  durationMs: number | null;
  durationApiMs: number | null;
  numTurns: number | null;
  /** Cout rapporte par Claude Code ; jamais estime par NOX. */
  reportedCostUsd: number | null;
  git: {
    branch: string | null;
    upstream: string | null;
    headBefore: string | null;
    headAfter: string | null;
    diffStat: string | null;
    changedFiles: string[];
  };
};

export type ClaudeRunStatusSuccess = {
  ok: true;
  run: ClaudeRunSnapshot;
};

/**
 * Corps de `POST /claude/runs/events`.
 *
 * `afterSequence` est un curseur, pas une pagination : le web demande « ce que
 * je n'ai pas encore vu ». Zero signifie « depuis le debut ». C'est ce qui
 * permet a un onglet rouvert de reprendre exactement la ou il s'etait arrete,
 * sans doublon et sans trou.
 */
export type ClaudeRunEventsRequest = {
  runId: string;
  afterSequence: number;
  limit: number;
};

/**
 * Reponse de `POST /claude/runs/events`.
 *
 * `nextSequence` est le curseur a renvoyer au prochain appel. Il est calcule par
 * le runner plutot que deduit du dernier evenement recu : un lot vide doit
 * pouvoir laisser le curseur inchange sans que l'appelant ait a le deviner.
 */
export type ClaudeRunEventsSuccess = {
  ok: true;
  events: ClaudeRunEvent[];
  nextSequence: number;
  status: RunStatus;
  isFinal: boolean;
  /** Vrai des qu'une troncature a eu lieu sur cette execution. */
  truncated: boolean;
};

/** Corps de `POST /claude/runs/cancel`. */
export type ClaudeRunCancelRequest = {
  runId: string;
};

/**
 * Reponse `202` de `POST /claude/runs/cancel`.
 *
 * `202` et non `200` : la demande est **acceptee**, l'arret est engage, mais
 * rien n'est termine. Repondre `200` laisserait croire que le processus est
 * mort, alors qu'il dispose encore de son delai de grace.
 */
export type ClaudeRunCancelSuccess = {
  ok: true;
  run: {
    runId: string;
    status: typeof RUN_STATUS.CANCELLING;
    cancellationRequestedAt: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Valide le corps recu par `POST /claude/preflight`. */
export function parseClaudePreflightRequest(value: unknown): ClaudePreflightRequest | null {
  if (!isRecord(value) || typeof value["repositoryPath"] !== "string") {
    return null;
  }
  return { repositoryPath: value["repositoryPath"] };
}

/**
 * Valide le corps recu par `POST /claude/runs/start`.
 *
 * La **forme** est verifiee ici ; le contenu — validite du prompt, des commandes,
 * de `HEAD` — releve du runner, qui dispose de codes d'erreur dedies pour
 * distinguer chaque refus.
 */
export function parseStartClaudeRunRequest(value: unknown): StartClaudeRunRequest | null {
  if (
    !isRecord(value) ||
    typeof value["runId"] !== "string" ||
    typeof value["repositoryPath"] !== "string" ||
    typeof value["prompt"] !== "string" ||
    typeof value["expectedGitHead"] !== "string" ||
    !Array.isArray(value["validationCommands"]) ||
    !value["validationCommands"].every((entry) => typeof entry === "string")
  ) {
    return null;
  }

  return {
    runId: value["runId"],
    repositoryPath: value["repositoryPath"],
    prompt: value["prompt"],
    expectedGitHead: value["expectedGitHead"],
    validationCommands: value["validationCommands"] as string[],
  };
}

/** Valide le corps recu par `POST /claude/runs/status`. */
export function parseClaudeRunStatusRequest(value: unknown): ClaudeRunStatusRequest | null {
  if (!isRecord(value) || typeof value["runId"] !== "string") {
    return null;
  }
  return { runId: value["runId"] };
}

/**
 * Valide le corps recu par `POST /claude/runs/events`.
 *
 * Le curseur et la limite sont **bornes ici**, pas plus loin : une limite
 * negative, fractionnaire ou absurde est ramenee dans le domaine autorise avant
 * d'atteindre le registre. Refuser la requete serait plus severe que necessaire —
 * ces deux valeurs sont des indications de lecture, pas des droits d'acces.
 */
export function parseClaudeRunEventsRequest(value: unknown): ClaudeRunEventsRequest | null {
  if (!isRecord(value) || typeof value["runId"] !== "string") {
    return null;
  }

  const rawCursor: unknown = value["afterSequence"];
  const cursor =
    rawCursor === undefined
      ? 0
      : typeof rawCursor === "number" && Number.isInteger(rawCursor) && rawCursor >= 0
        ? rawCursor
        : null;
  if (cursor === null) {
    return null;
  }

  const rawLimit: unknown = value["limit"];
  const limit =
    rawLimit === undefined
      ? RUN_EVENT_LIMITS.maxBatch
      : typeof rawLimit === "number" && Number.isInteger(rawLimit) && rawLimit >= 1
        ? Math.min(rawLimit, RUN_EVENT_LIMITS.maxBatch)
        : null;
  if (limit === null) {
    return null;
  }

  return { runId: value["runId"], afterSequence: cursor, limit };
}

/** Valide le corps recu par `POST /claude/runs/cancel`. */
export function parseClaudeRunCancelRequest(value: unknown): ClaudeRunCancelRequest | null {
  if (!isRecord(value) || typeof value["runId"] !== "string") {
    return null;
  }
  return { runId: value["runId"] };
}

/** Verifie qu'une reponse JSON est un preflight reussi. */
export function isClaudePreflightSuccess(value: unknown): value is ClaudePreflightSuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }

  const claude: unknown = value["claude"];
  if (!isRecord(claude) || claude["available"] !== true || typeof claude["version"] !== "string") {
    return false;
  }

  const git: unknown = value["git"];
  return (
    isRecord(git) &&
    typeof git["clean"] === "boolean" &&
    typeof git["branch"] === "string" &&
    typeof git["upstream"] === "string" &&
    typeof git["head"] === "string" &&
    typeof git["ahead"] === "number" &&
    typeof git["behind"] === "number"
  );
}

/** Verifie qu'une reponse JSON est un lancement accepte. */
export function isStartClaudeRunSuccess(value: unknown): value is StartClaudeRunSuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }
  const run: unknown = value["run"];
  return (
    isRecord(run) &&
    isRunnerRunId(run["runId"]) &&
    run["status"] === RUN_STATUS.RUNNING &&
    typeof run["startedAt"] === "string"
  );
}

/**
 * Verifie qu'une reponse JSON est un lot d'evenements valide.
 *
 * Chaque evenement est valide **individuellement** : une reponse dont un seul
 * element serait hors contrat est rejetee entiere. C'est volontairement severe —
 * cette fonction est la derniere barriere avant que des donnees venues d'un
 * processus exterieur n'atteignent le navigateur.
 */
export function isClaudeRunEventsSuccess(value: unknown): value is ClaudeRunEventsSuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }

  const events: unknown = value["events"];
  if (!Array.isArray(events) || !events.every(isClaudeRunEvent)) {
    return false;
  }

  const status: unknown = value["status"];
  return (
    typeof value["nextSequence"] === "number" &&
    Number.isInteger(value["nextSequence"]) &&
    typeof status === "string" &&
    (Object.values(RUN_STATUS) as string[]).includes(status) &&
    typeof value["isFinal"] === "boolean" &&
    typeof value["truncated"] === "boolean"
  );
}

/** Verifie qu'une reponse JSON est une demande d'annulation acceptee. */
export function isClaudeRunCancelSuccess(value: unknown): value is ClaudeRunCancelSuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }
  const run: unknown = value["run"];
  return (
    isRecord(run) &&
    isRunnerRunId(run["runId"]) &&
    run["status"] === RUN_STATUS.CANCELLING &&
    typeof run["cancellationRequestedAt"] === "string"
  );
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): boolean {
  return value === null || typeof value === "number";
}

/** Verifie qu'une reponse JSON est un etat d'execution valide. */
export function isClaudeRunStatusSuccess(value: unknown): value is ClaudeRunStatusSuccess {
  if (!isRecord(value) || value["ok"] !== true) {
    return false;
  }

  const run: unknown = value["run"];
  if (!isRecord(run) || !isRunnerRunId(run["runId"])) {
    return false;
  }

  const status: unknown = run["status"];
  if (typeof status !== "string" || !(Object.values(RUN_STATUS) as string[]).includes(status)) {
    return false;
  }

  const git: unknown = run["git"];
  if (
    !isRecord(git) ||
    !isNullableString(git["branch"]) ||
    !isNullableString(git["upstream"]) ||
    !isNullableString(git["headBefore"]) ||
    !isNullableString(git["headAfter"]) ||
    !isNullableString(git["diffStat"]) ||
    !Array.isArray(git["changedFiles"]) ||
    !git["changedFiles"].every((entry) => typeof entry === "string")
  ) {
    return false;
  }

  return (
    isNullableString(run["startedAt"]) &&
    isNullableString(run["finishedAt"]) &&
    isNullableString(run["cancellationRequestedAt"]) &&
    typeof run["lastEventSequence"] === "number" &&
    typeof run["eventsTruncated"] === "boolean" &&
    isNullableNumber(run["exitCode"]) &&
    isNullableString(run["errorCode"]) &&
    isNullableString(run["stderrTail"]) &&
    isNullableString(run["resultText"]) &&
    isNullableString(run["claudeSessionId"]) &&
    isNullableNumber(run["durationMs"]) &&
    isNullableNumber(run["durationApiMs"]) &&
    isNullableNumber(run["numTurns"]) &&
    isNullableNumber(run["reportedCostUsd"])
  );
}
