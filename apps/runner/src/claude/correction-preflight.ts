/**
 * Preflight d'une correction ciblee.
 *
 * ## Ce qu'il verifie, et pourquoi il differe du preflight initial
 *
 * Le preflight initial exige un repository **propre** : sans etat de depart
 * connu, on ne saurait pas dire ce que l'agent a change.
 *
 * Une correction ne peut pas exiger cela. Elle part precisement du travail que
 * l'utilisateur vient de relire, et ce travail n'a ete ni commite, ni restaure —
 * c'est meme le principe. Le dossier de travail est donc sale, volontairement.
 *
 * Mais il ne peut pas etre **n'importe quel** dossier sale. Si l'utilisateur a
 * modifie trois fichiers a la main entre la review et le clic, la correction
 * produira un etat dont plus personne ne saura demeler ce qui vient de l'agent.
 * D'ou la regle qui remplace « propre » :
 *
 * ```text
 * repository propre        →  exactement l'etat qui a ete relu
 * ```
 *
 * ## L'ordre des controles
 *
 * Branche, puis `HEAD`, puis empreinte. Les deux premiers produisent un
 * diagnostic que l'utilisateur comprend immediatement — « tu as change de
 * branche », « tu as commite » —, alors que l'empreinte ne peut dire que
 * « quelque chose a change ». Autant nommer d'abord ce qui est nommable.
 *
 * ## Un refus qui se diagnostique
 *
 * Depuis HOTFIX-006, un refus d'empreinte nomme les chemins qui ont diverge —
 * apparus, disparus, modifies, reindexes. La comparaison a lieu **apres** le
 * refus et ne peut donc pas l'influencer : l'empreinte reste seule autorite, et
 * une liste identique assortie d'une empreinte differente refuse quand meme.
 *
 * ## Aucun forcage
 *
 * Il n'existe pas d'option pour passer outre, et il ne doit pas en exister. Un
 * bouton « continuer quand meme » transformerait une garantie en suggestion,
 * et c'est exactement la garantie qui rend la review suivante interpretable.
 */

import {
  RUNNER_ERROR,
  diffWorkspaceEntries,
  parseWorkspaceEntries,
  workspaceDivergenceMessage,
  type RunnerErrorCode,
} from "@nox/shared";

import type { ClaudeConfig } from "../config.ts";
import { resolveRepositoryRoot } from "../repositories/documents/repository-root.ts";
import { readGitState, type GitStateOptions } from "../repositories/git-state.ts";
import {
  computeWorkspaceFingerprint,
  fingerprintsMatch,
  type FingerprintOptions,
} from "../repositories/workspace-fingerprint.ts";
import {
  CLAUDE_VERSION_TIMEOUT_MS,
  probeClaudeVersion,
  type ClaudeVersionProbe,
} from "./executable.ts";

export type CorrectionPreflightRequest = {
  repositoryPath: string;
  expectedGitHead: string;
  expectedBranch: string;
  expectedWorkspaceFingerprint: string;
  /** Entrees de l'etat relu, serialisees ; sert uniquement au diagnostic. */
  expectedWorkspaceEntries?: string | null;
};

export type CorrectionPreflightResult =
  | {
      ok: true;
      claudeVersion: string;
      git: { branch: string; head: string; upstream: string };
    }
  | {
      ok: false;
      code: RunnerErrorCode;
      /**
       * Phrase qui nomme les chemins ayant diverge, quand NOX peut les nommer.
       *
       * Elle n'entre dans aucune decision : le refus est deja pris quand elle
       * est calculee. Elle existe parce qu'un refus indiagnostiquable finit par
       * etre contourne, et que le contournement detruit le travail que le refus
       * protegeait.
       */
      detail?: string;
    };

export type CorrectionPreflightOptions = GitStateOptions &
  FingerprintOptions & {
    probeVersion?: ClaudeVersionProbe;
    versionTimeoutMs?: number;
    /** Cle derivee du jeton du runner ; ne quitte jamais le processus. */
    fingerprintKey: Buffer;
  };

/**
 * Verifie qu'une correction peut reprendre la session d'une execution relue.
 *
 * Ne lance aucun processus et n'ecrit rien : c'est un constat, exactement comme
 * le preflight initial.
 */
export async function runCorrectionPreflight(
  request: CorrectionPreflightRequest,
  claude: ClaudeConfig,
  options: CorrectionPreflightOptions,
): Promise<CorrectionPreflightResult> {
  const repository = resolveRepositoryRoot(request.repositoryPath);
  if (!repository.ok) {
    return repository;
  }

  const state = await readGitState(repository.root, options);
  if (!state.ok) {
    return state;
  }

  // Volontairement **pas** de controle de proprete : le dossier de travail porte
  // le travail relu, et l'exiger propre rendrait toute correction impossible.

  if (state.state.branch !== request.expectedBranch) {
    return { ok: false, code: RUNNER_ERROR.GIT_BRANCH_CHANGED };
  }

  if (state.state.head !== request.expectedGitHead) {
    return { ok: false, code: RUNNER_ERROR.GIT_HEAD_CHANGED };
  }

  const fingerprint = await computeWorkspaceFingerprint(
    repository.root,
    options.fingerprintKey,
    options,
  );
  if (!fingerprint.ok) {
    return fingerprint;
  }

  if (!fingerprintsMatch(fingerprint.value, request.expectedWorkspaceFingerprint)) {
    // Une seule cause possible cote NOX — le dossier a change — mais deux
    // origines : une modification reelle, ou un jeton de runner different depuis
    // la capture. Le message affiche mentionne les deux, parce que NOX ne peut
    // pas les distinguer et ne doit pas faire semblant.
    //
    // Le refus est **deja pris** a ce point. Ce qui suit ne fait que le
    // formuler : comparer les entrees ne peut ni le lever, ni l'attenuer, et
    // c'est pour cela que la comparaison arrive apres et non avant.
    const expected = parseWorkspaceEntries(request.expectedWorkspaceEntries ?? null);
    const divergence =
      expected === null ? null : diffWorkspaceEntries(expected, fingerprint.entries);
    return {
      ok: false,
      code: RUNNER_ERROR.REVIEW_WORKTREE_CHANGED,
      detail: workspaceDivergenceMessage(divergence),
    };
  }

  const probe = options.probeVersion ?? probeClaudeVersion;
  const version = await probe(
    claude.executable,
    options.versionTimeoutMs ?? CLAUDE_VERSION_TIMEOUT_MS,
  );
  if (!version.available) {
    return { ok: false, code: RUNNER_ERROR.CLAUDE_NOT_AVAILABLE };
  }

  return {
    ok: true,
    claudeVersion: version.version,
    git: { branch: state.state.branch, head: state.state.head, upstream: state.state.upstream },
  };
}
