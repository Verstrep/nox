/**
 * Contrat HTTP des routes Claude Code du runner.
 *
 * Trois routes, trois responsabilites :
 *
 * - `POST /claude/preflight`      — verifier, en lecture seule, qu'un lancement
 *                                   est possible ;
 * - `POST /claude/runs/start`     — lancer, et repondre sans attendre la fin ;
 * - `POST /claude/runs/status`    — consulter l'etat d'une execution.
 *
 * Regle structurante, comme partout ailleurs : **aucun chemin absolu ne remonte
 * au navigateur**. Le preflight renvoie une branche, un upstream et un `HEAD`,
 * jamais le chemin du repository — que l'appelant connait deja, puisque c'est
 * lui qui l'a envoye.
 */

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
