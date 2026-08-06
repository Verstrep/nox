/**
 * Lecture de l'etat Git d'un repository.
 *
 * Toutes les commandes de ce module sont **strictement en lecture**. Aucune ne
 * cree, ne modifie, ne deplace ni ne supprime quoi que ce soit, et aucune ne
 * touche au reseau : il n'y a pas de `fetch`, pas de `pull`, pas de `push`.
 *
 * ## L'upstream compare est la reference locale
 *
 * `git rev-list --left-right --count HEAD...@{upstream}` compare la branche
 * courante a ce que **cette machine** sait de l'upstream, c'est-a-dire au
 * dernier `fetch` ou `pull` effectue par l'utilisateur. NOX ne peut donc pas
 * affirmer que la branche est a jour vis-a-vis du serveur distant, seulement
 * qu'elle l'est vis-a-vis de la reference locale. Faire un `fetch` pour lever
 * le doute reviendrait a toucher au reseau et a modifier le repository sans que
 * personne ne l'ait demande — l'interface dit donc la verite plutot que de la
 * fabriquer.
 *
 * ## Securite
 *
 * `execFile` sans shell : le chemin du repository est un argument, jamais un
 * fragment de commande. Chaque appel est borne par un delai maximal.
 */

import { execFile } from "node:child_process";

import { RUNNER_ERROR, type RunnerErrorCode } from "@nox/shared";

/** Delai maximal accorde a une commande Git de lecture. */
export const GIT_STATE_TIMEOUT_MS = 10_000;

export type GitCommandOutcome =
  | { status: "ok"; stdout: string }
  | { status: "unavailable" }
  | { status: "timeout" }
  | { status: "failed"; stderr: string };

/** Signature d'un lanceur Git, injectable pour les tests. */
export type GitCommandRunner = (
  directory: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<GitCommandOutcome>;

/** Execute `git -C <directory> <args...>` sans shell. */
export const runGitCommand: GitCommandRunner = (directory, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["-C", directory, ...args],
      { timeout: timeoutMs, windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ status: "ok", stdout });
          return;
        }

        const { code, killed } = error as NodeJS.ErrnoException & { killed?: boolean };
        if (code === "ENOENT") {
          resolve({ status: "unavailable" });
        } else if (killed === true || code === "ETIMEDOUT") {
          resolve({ status: "timeout" });
        } else {
          resolve({ status: "failed", stderr });
        }
      },
    );
  });

export type GitStateOptions = {
  runGit?: GitCommandRunner;
  timeoutMs?: number;
};

/** Etat Git constate avant un lancement. */
export type GitState = {
  clean: boolean;
  branch: string;
  upstream: string;
  head: string;
  ahead: number;
  behind: number;
};

export type GitStateResult = { ok: true; state: GitState } | { ok: false; code: RunnerErrorCode };

/** Traduit un echec de commande Git en code du contrat. */
function toFailureCode(outcome: GitCommandOutcome): RunnerErrorCode {
  switch (outcome.status) {
    case "unavailable":
      return RUNNER_ERROR.GIT_NOT_AVAILABLE;
    case "timeout":
      return RUNNER_ERROR.GIT_TIMEOUT;
    default:
      return RUNNER_ERROR.GIT_PREFLIGHT_FAILED;
  }
}

/**
 * Extrait les chemins d'une sortie `git status --porcelain=v1`.
 *
 * Le format est `XY <chemin>`, avec ` -> ` pour un renommage. Les chemins
 * contenant des caracteres speciaux sont entoures de guillemets par Git ; ils
 * sont laisses tels quels — cette liste est destinee a l'affichage, jamais a
 * une ouverture de fichier.
 */
export function parsePorcelainPaths(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 3)
    .map((line) => {
      const entry = line.slice(3);
      const renamed = entry.split(" -> ");
      return renamed.length > 1 ? (renamed.at(-1) ?? entry) : entry;
    })
    .filter((entry) => entry !== "");
}

/**
 * Lit l'etat Git complet d'un repository.
 *
 * L'ordre des controles suit celui des refus les plus explicites : une branche
 * detachee et un upstream absent meritent chacun leur message, et les diagnostiquer
 * apres coup a partir d'une erreur generique serait moins fiable.
 */
export async function readGitState(
  root: string,
  options: GitStateOptions = {},
): Promise<GitStateResult> {
  const runGit = options.runGit ?? runGitCommand;
  const timeoutMs = options.timeoutMs ?? GIT_STATE_TIMEOUT_MS;

  const statusOutcome = await runGit(root, ["status", "--porcelain=v1"], timeoutMs);
  if (statusOutcome.status !== "ok") {
    return { ok: false, code: toFailureCode(statusOutcome) };
  }
  const clean = statusOutcome.stdout.trim() === "";

  const branchOutcome = await runGit(root, ["branch", "--show-current"], timeoutMs);
  if (branchOutcome.status !== "ok") {
    return { ok: false, code: toFailureCode(branchOutcome) };
  }
  const branch = branchOutcome.stdout.trim();
  if (branch === "") {
    // `--show-current` ne renvoie rien quand HEAD est detache.
    return { ok: false, code: RUNNER_ERROR.GIT_DETACHED_HEAD };
  }

  const headOutcome = await runGit(root, ["rev-parse", "HEAD"], timeoutMs);
  if (headOutcome.status !== "ok") {
    return { ok: false, code: toFailureCode(headOutcome) };
  }
  const head = headOutcome.stdout.trim();
  if (head === "") {
    return { ok: false, code: RUNNER_ERROR.GIT_PREFLIGHT_FAILED };
  }

  const upstreamOutcome = await runGit(
    root,
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    timeoutMs,
  );
  if (upstreamOutcome.status === "failed") {
    // Git echoue precisement lorsqu'aucun upstream n'est configure.
    return { ok: false, code: RUNNER_ERROR.GIT_UPSTREAM_MISSING };
  }
  if (upstreamOutcome.status !== "ok") {
    return { ok: false, code: toFailureCode(upstreamOutcome) };
  }
  const upstream = upstreamOutcome.stdout.trim();
  if (upstream === "") {
    return { ok: false, code: RUNNER_ERROR.GIT_UPSTREAM_MISSING };
  }

  const countOutcome = await runGit(
    root,
    ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    timeoutMs,
  );
  if (countOutcome.status !== "ok") {
    return { ok: false, code: toFailureCode(countOutcome) };
  }

  const counts = countOutcome.stdout.trim().split(/\s+/);
  const ahead = Number(counts[0]);
  const behind = Number(counts[1]);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
    return { ok: false, code: RUNNER_ERROR.GIT_PREFLIGHT_FAILED };
  }

  return { ok: true, state: { clean, branch, upstream, head, ahead, behind } };
}

/** Instantane pris apres une execution, pour rendre le resultat relisible. */
export type GitChanges = {
  head: string | null;
  branch: string | null;
  diffStat: string | null;
  changedFiles: string[];
};

/**
 * Lit ce que l'execution a laisse sur le disque.
 *
 * Aucune de ces commandes ne repare quoi que ce soit : NOX constate, il ne
 * restaure pas. Un `reset` ou un `restore` automatique detruirait justement ce
 * que l'utilisateur doit relire.
 */
export async function readGitChanges(
  root: string,
  options: GitStateOptions = {},
): Promise<GitChanges> {
  const runGit = options.runGit ?? runGitCommand;
  const timeoutMs = options.timeoutMs ?? GIT_STATE_TIMEOUT_MS;

  const read = async (args: readonly string[]): Promise<string | null> => {
    const outcome = await runGit(root, args, timeoutMs);
    return outcome.status === "ok" ? outcome.stdout : null;
  };

  const head = (await read(["rev-parse", "HEAD"]))?.trim() ?? null;
  const branch = (await read(["branch", "--show-current"]))?.trim() ?? null;
  const diffStat = (await read(["diff", "--stat"]))?.trimEnd() ?? null;
  const status = await read(["status", "--porcelain=v1"]);

  return {
    head: head === "" ? null : head,
    branch: branch === "" ? null : branch,
    diffStat: diffStat === "" ? null : diffStat,
    changedFiles: status === null ? [] : parsePorcelainPaths(status),
  };
}
