import type { ClaudeRunSnapshot } from "@nox/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toRunnerReport } from "./run-report.ts";

/**
 * Seule la traduction du rapport du runner est testee ici : elle est pure.
 * `reconcileRun`, qui ecrit en base et appelle le runner, est couverte par le
 * test fonctionnel, ou les deux existent reellement.
 */

function snapshot(overrides: Partial<ClaudeRunSnapshot> = {}): ClaudeRunSnapshot {
  return {
    runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    status: "COMPLETED",
    startedAt: "2026-08-06T10:00:00.000Z",
    finishedAt: "2026-08-06T10:05:00.000Z",
    cancellationRequestedAt: null,
    lastEventSequence: 0,
    eventsTruncated: false,
    exitCode: 0,
    errorCode: null,
    stderrTail: null,
    resultText: "Compte rendu.",
    claudeSessionId: "session-abc",
    durationMs: 300_000,
    durationApiMs: 250_000,
    numTurns: 6,
    reportedCostUsd: 0.12,
    git: {
      branch: "main",
      upstream: "origin/main",
      headBefore: "a".repeat(40),
      headAfter: "a".repeat(40),
      diffStat: " 1 file changed",
      changedFiles: ["src/a.ts"],
    },
    ...overrides,
  };
}

describe("toRunnerReport", () => {
  it("traduit un rapport complet", () => {
    const report = toRunnerReport(snapshot());

    assert.equal(report.status, "COMPLETED");
    assert.equal(report.resultText, "Compte rendu.");
    assert.equal(report.claudeSessionId, "session-abc");
    assert.equal(report.numTurns, 6);
    assert.equal(report.reportedCostUsd, 0.12);
    assert.equal(report.startedAt?.toISOString(), "2026-08-06T10:00:00.000Z");
    assert.deepEqual([...(report.git?.changedFiles ?? [])], ["src/a.ts"]);
  });

  it("traduit un code d'erreur connu en message utilisateur", () => {
    const report = toRunnerReport(snapshot({ status: "BLOCKED", errorCode: "CLAUDE_LIMIT_REACHED" }));

    assert.equal(report.errorCode, "CLAUDE_LIMIT_REACHED");
    assert.match(report.errorMessage ?? "", /limite/i);
  });

  it("ignore un code d'erreur inconnu plutot que de lever", () => {
    // Une version du runner plus recente pourrait envoyer un code que ce web ne
    // connait pas : la page doit rester affichable.
    const report = toRunnerReport(snapshot({ errorCode: "CODE_QUI_N_EXISTE_PAS" }));

    assert.equal(report.errorCode, null);
    assert.equal(report.errorMessage, null);
  });

  it("n'invente aucun message quand il n'y a pas d'erreur", () => {
    const report = toRunnerReport(snapshot({ errorCode: null }));

    assert.equal(report.errorMessage, null);
  });

  it("tolere des dates absentes", () => {
    const report = toRunnerReport(snapshot({ startedAt: null, finishedAt: null }));

    assert.equal(report.startedAt, null);
    assert.equal(report.finishedAt, null);
  });

  it("tolere une date illisible", () => {
    const report = toRunnerReport(snapshot({ startedAt: "pas une date" }));

    assert.equal(report.startedAt, null);
  });

  it("conserve les valeurs absentes plutot que de les remplacer", () => {
    const report = toRunnerReport(
      snapshot({ reportedCostUsd: null, claudeSessionId: null, numTurns: null }),
    );

    assert.equal(report.reportedCostUsd, null);
    assert.equal(report.claudeSessionId, null);
    assert.equal(report.numTurns, null);
  });

  it("ne divulgue aucun chemin absolu dans le message d'erreur", () => {
    const report = toRunnerReport(snapshot({ errorCode: "GIT_POLICY_VIOLATION" }));

    assert.equal(/[A-Za-z]:\\/.test(report.errorMessage ?? ""), false);
  });
});
