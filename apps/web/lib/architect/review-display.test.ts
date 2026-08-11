/**
 * Tests de la presentation d'une review Architecte.
 *
 * Fonctions pures : ce sont elles qui decident de l'apparition d'un bouton et du
 * message qui le remplace. Les tester ici evite qu'une page et un refus disent
 * deux choses differentes du meme run.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { REVIEW_PATCH_STATE, type ArchitectReviewBundle } from "@nox/shared";

import {
  ARCHITECT_REVIEW_PRIVACY_NOTICE,
  architectAnalysisUrl,
  architectReviewEligibility,
  architectReviewIneligibleMessage,
  architectReviewUrl,
  bundleFileRows,
  bundleLimits,
  isPatchWithheld,
} from "./review-display.ts";

const BUNDLE: ArchitectReviewBundle = {
  task: {
    code: "TASK-003",
    title: "Filtrer",
    priority: "MEDIUM",
    objective: "Objectif.",
    context: null,
    outOfScope: null,
    acceptanceCriteria: ["Un critere."],
    documentReferences: [],
    validationCommands: [],
  },
  run: {
    code: "RUN-001",
    kind: "INITIAL",
    parentRunCode: null,
    status: "COMPLETED",
    durationMs: null,
    headBefore: null,
    headAfter: null,
    unreliable: false,
    partial: false,
    reviewFailed: false,
  },
  validations: [],
  validationSummary: "NONE",
  files: [
    {
      path: "src/a.ts",
      previousPath: null,
      changeType: "MODIFIED",
      additions: 1,
      deletions: 0,
      patchState: REVIEW_PATCH_STATE.INCLUDED,
      patch: "@@ -1 +1 @@\n",
    },
    {
      path: ".env",
      previousPath: null,
      changeType: "MODIFIED",
      additions: 1,
      deletions: 0,
      patchState: REVIEW_PATCH_STATE.SENSITIVE_HIDDEN,
      patch: null,
    },
  ],
  fileCountAvailable: 2,
  omittedFiles: 0,
  truncated: false,
};

describe("architectReviewUrl", () => {
  it("compose les deux URL de la review Architecte", () => {
    assert.equal(
      architectReviewUrl("p", "t", "r"),
      "/projects/p/tasks/t/runs/r/architect-review",
    );
    assert.equal(
      architectAnalysisUrl("p", "t", "r", "a"),
      "/projects/p/tasks/t/runs/r/architect-review/a",
    );
  });
});

describe("architectReviewEligibility", () => {
  it("accepte une execution finale dont la review a ete capturee", () => {
    for (const status of ["COMPLETED", "FAILED", "BLOCKED", "CANCELLED"] as const) {
      assert.equal(architectReviewEligibility(status, "2026-08-11T09:00:00.000Z"), "eligible");
    }
  });

  it("refuse une execution encore active", () => {
    for (const status of ["QUEUED", "RUNNING", "CANCELLING"] as const) {
      assert.equal(architectReviewEligibility(status, null), "active");
    }
  });

  it("refuse une execution sans instantane", () => {
    assert.equal(architectReviewEligibility("COMPLETED", null), "legacy");
  });

  it("distingue les deux refus par leur message", () => {
    assert.match(architectReviewIneligibleMessage("active"), /n'est pas terminee/u);
    assert.match(
      architectReviewIneligibleMessage("legacy"),
      /ne possede pas de snapshot de review/u,
    );
  });
});

describe("bundleFileRows", () => {
  it("reprend exactement les etats du bundle", () => {
    const rows = bundleFileRows(BUNDLE);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.patchState, REVIEW_PATCH_STATE.INCLUDED);
    assert.equal(rows[1]?.patchState, REVIEW_PATCH_STATE.SENSITIVE_HIDDEN);
    assert.equal(rows[1]?.chars, 0);
  });
});

describe("isPatchWithheld", () => {
  it("dit qu'un contenu masque, binaire ou non transmis n'a pas quitte la machine", () => {
    assert.equal(isPatchWithheld(REVIEW_PATCH_STATE.SENSITIVE_HIDDEN), true);
    assert.equal(isPatchWithheld(REVIEW_PATCH_STATE.BINARY_UNAVAILABLE), true);
    assert.equal(isPatchWithheld(REVIEW_PATCH_STATE.UNAVAILABLE), true);
    assert.equal(isPatchWithheld(REVIEW_PATCH_STATE.OMITTED_BY_LIMIT), true);
  });

  it("dit qu'un patch inclus ou tronque est parti, au moins en partie", () => {
    assert.equal(isPatchWithheld(REVIEW_PATCH_STATE.INCLUDED), false);
    assert.equal(isPatchWithheld(REVIEW_PATCH_STATE.TRUNCATED), false);
  });
});

describe("bundleLimits", () => {
  it("rend les compteurs affiches dans la section Limits", () => {
    const limits = bundleLimits(BUNDLE, 2_048);
    assert.equal(limits.filesAvailable, 2);
    assert.equal(limits.filesIncluded, 2);
    assert.equal(limits.patchChars, 2_048);
    assert.equal(limits.truncated, false);
  });
});

describe("ARCHITECT_REVIEW_PRIVACY_NOTICE", () => {
  it("decrit exactement ce qui part, et ce qui ne part pas", () => {
    assert.match(ARCHITECT_REVIEW_PRIVACY_NOTICE, /specification de la tache/u);
    assert.match(ARCHITECT_REVIEW_PRIVACY_NOTICE, /patches non sensibles/u);
    assert.match(ARCHITECT_REVIEW_PRIVACY_NOTICE, /resultats de validation/u);
    assert.match(ARCHITECT_REVIEW_PRIVACY_NOTICE, /ne sont pas envoyes/u);
  });
});
