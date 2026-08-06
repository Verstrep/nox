/**
 * Traduction d'un etat rapporte par le runner en rapport enregistrable.
 *
 * Fonction pure, isolee de `lib/runs.ts` : celle-ci importe `next/server` et
 * Prisma, ce qui la rend inexecutable hors de l'application. Cette traduction,
 * elle, est directement testable — et c'est la qu'un code d'erreur inconnu ou
 * une date illisible doivent etre absorbes sans faire tomber une page.
 */

import { isRunnerErrorCode, type ClaudeRunSnapshot } from "@nox/shared";
import type { RunnerRunReport } from "@nox/database";

import { describeRunnerFailure } from "./runner/errors.ts";

/** Convertit une date ISO du runner, en tolerant une valeur illisible. */
function toDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Traduit l'etat rapporte par le runner.
 *
 * Le code d'erreur est valide contre le contrat partage avant d'etre traduit :
 * une version du runner plus recente pourrait en envoyer un que ce web ne
 * connait pas, et la page doit rester affichable.
 */
export function toRunnerReport(snapshot: ClaudeRunSnapshot): RunnerRunReport {
  const errorCode = isRunnerErrorCode(snapshot.errorCode) ? snapshot.errorCode : null;

  return {
    status: snapshot.status,
    startedAt: toDate(snapshot.startedAt),
    finishedAt: toDate(snapshot.finishedAt),
    exitCode: snapshot.exitCode,
    errorCode,
    errorMessage:
      errorCode === null
        ? null
        : describeRunnerFailure({ kind: "runner_error", code: errorCode }),
    stderrTail: snapshot.stderrTail,
    resultText: snapshot.resultText,
    claudeSessionId: snapshot.claudeSessionId,
    durationMs: snapshot.durationMs,
    durationApiMs: snapshot.durationApiMs,
    numTurns: snapshot.numTurns,
    reportedCostUsd: snapshot.reportedCostUsd,
    git: {
      branch: snapshot.git.branch,
      upstream: snapshot.git.upstream,
      headBefore: snapshot.git.headBefore,
      headAfter: snapshot.git.headAfter,
      diffStat: snapshot.git.diffStat,
      changedFiles: snapshot.git.changedFiles,
    },
  };
}
