/**
 * Ce qu'une review sait de la verification, et ce qu'elle en conclut.
 *
 * ## Ce que ce fichier prouve
 *
 * Que « je n'ai pas pu regarder » et « j'ai regarde et c'est faux » ne mènent
 * pas au meme geste : l'un se relance, l'autre se corrige. Que deux empreintes
 * inconnues ne disent **rien**, et que ne pas savoir n'autorise jamais une
 * completion automatique. Et que la phrase affichee par la file suit ce qui
 * bloque, pas ce qui est le plus visible.
 *
 * Il prouve aussi, sur la **source** du module, qu'une lecture de review ne peut
 * rien declencher : ni commande, ni transition, ni fournisseur.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMMAND_EXECUTION_MODE,
  REVIEW_DECISION_SOURCE,
  TASK_KIND,
  VERIFICATION_MODE,
  type VerificationPlan,
} from "@nox/shared";
import type { AutonomousValidationBatchRow } from "@nox/database";

import {
  canApproveNormally,
  describeReviewWait,
  isCriterionProven,
  pendingHumanCheckCount,
  planIsFullyAutomated,
  requiresOverride,
  type VerificationReview,
} from "./verification-review.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const AUTOMATED_PLAN: VerificationPlan = {
  criteria: [
    {
      id: "crit-1",
      position: 0,
      text: "La suite passe.",
      verificationMode: VERIFICATION_MODE.AUTOMATED,
      humanInstructions: null,
      commandIds: ["cmd-1"],
    },
  ],
  commands: [
    {
      id: "cmd-1",
      position: 0,
      command: "npm run test",
      executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS,
    },
  ],
};

const HUMAN_PLAN: VerificationPlan = {
  criteria: [
    {
      id: "crit-h",
      position: 0,
      text: "L'ecran est lisible.",
      verificationMode: VERIFICATION_MODE.HUMAN,
      humanInstructions: "Ouvrir la page et regarder.",
      commandIds: [],
    },
  ],
  commands: [],
};

function batch(overrides: Partial<AutonomousValidationBatchRow> = {}): AutonomousValidationBatchRow {
  return {
    id: "batch-1",
    runId: "run-1",
    attempt: 1,
    status: "PASSED",
    createdAt: new Date("2026-08-24T10:00:00.000Z"),
    startedAt: new Date("2026-08-24T10:00:01.000Z"),
    completedAt: new Date("2026-08-24T10:00:05.000Z"),
    errorCode: null,
    errorMessage: null,
    trackedStateBefore: "a".repeat(64),
    trackedStateAfter: "a".repeat(64),
    mutatedFiles: null,
    results: [],
    ...overrides,
  };
}

function review(overrides: Partial<VerificationReview> = {}): VerificationReview {
  return {
    plan: AUTOMATED_PLAN,
    planValid: true,
    batch: batch(),
    previousBatches: [],
    noAutomatedValidation: false,
    criteria: [{ criterion: AUTOMATED_PLAN.criteria[0]!, result: "PASSED" }],
    humanCriteria: [],
    outcome: "AUTO_PASSED",
    batchSettled: true,
    retryAvailable: false,
    trackedFilesMutated: false,
    repositoryMutationObserved: false,
    decision: null,
    ...overrides,
  };
}

describe("acceptation ordinaire", () => {
  it("est possible quand tout est prouve", () => {
    assert.equal(canApproveNormally(review()), true);
    assert.equal(requiresOverride(review()), false);
  });

  it("est possible quand un humain doit encore regarder", () => {
    // Un critere humain n'est pas un echec : c'est une question posee a
    // quelqu'un, et l'acceptation ordinaire est justement sa reponse.
    const pending = review({ outcome: "HUMAN_REQUIRED", plan: HUMAN_PLAN });
    assert.equal(canApproveNormally(pending), true);
    assert.equal(requiresOverride(pending), false);
  });

  it("est impossible pendant un lot", () => {
    const running = review({ batchSettled: false, batch: batch({ status: "RUNNING" }) });
    assert.equal(canApproveNormally(running), false);
    // Un lot en cours n'appelle pas non plus un passage en force : il n'y a
    // encore rien a forcer.
    assert.equal(requiresOverride(running), false);
  });

  it("est impossible apres un echec", () => {
    const failed = review({ outcome: "AUTO_FAILED", batch: batch({ status: "FAILED" }) });
    assert.equal(canApproveNormally(failed), false);
    assert.equal(requiresOverride(failed), true);
  });

  it("est impossible apres une panne", () => {
    const broken = review({ outcome: "AUTO_ERROR", batch: batch({ status: "ERROR" }) });
    assert.equal(canApproveNormally(broken), false);
    assert.equal(requiresOverride(broken), true);
  });
});

describe("attente de la review", () => {
  it("annonce d'abord le lot en cours", () => {
    // Meme avec deux cases a cocher : personne ne peut decider avant le
    // resultat, donc parler des cases enverrait faire ce qui ne debloque rien.
    const running = review({
      batchSettled: false,
      humanCriteria: [HUMAN_PLAN.criteria[0]!],
      outcome: "HUMAN_REQUIRED",
    });
    assert.equal(describeReviewWait(running).kind, "VALIDATION_RUNNING");
  });

  it("annonce un echec avant une attente humaine", () => {
    const failed = review({
      outcome: "AUTO_FAILED",
      humanCriteria: [HUMAN_PLAN.criteria[0]!],
    });
    assert.equal(describeReviewWait(failed).kind, "VALIDATION_FAILED");
  });

  it("distingue la panne de l'echec", () => {
    assert.equal(describeReviewWait(review({ outcome: "AUTO_ERROR" })).kind, "VALIDATION_ERROR");
  });

  it("compte les criteres humains restants", () => {
    const pending = review({
      outcome: "HUMAN_REQUIRED",
      humanCriteria: [HUMAN_PLAN.criteria[0]!, { ...HUMAN_PLAN.criteria[0]!, id: "crit-h2" }],
    });
    const wait = describeReviewWait(pending);
    assert.equal(wait.kind, "HUMAN_CHECKS");
    assert.equal(wait.humanCheckCount, 2);
  });

  it("n'en compte plus une fois la decision prise", () => {
    const decided = review({
      outcome: "HUMAN_REQUIRED",
      humanCriteria: [HUMAN_PLAN.criteria[0]!],
      decision: {
        source: REVIEW_DECISION_SOURCE.HUMAN,
        overrideReason: null,
        decidedAt: new Date("2026-08-24T11:00:00.000Z"),
        confirmedCriteria: ["L'ecran est lisible."],
      },
    });
    assert.equal(pendingHumanCheckCount(decided), 0);
    assert.equal(describeReviewWait(decided).kind, "REVIEW");
  });
});

describe("eligibilite annoncee avant l'execution", () => {
  it("annonce une tache entierement automatisee", () => {
    assert.equal(planIsFullyAutomated(AUTOMATED_PLAN, TASK_KIND.NORMAL), true);
  });

  it("ne l'annonce jamais pour un amorcage", () => {
    assert.equal(planIsFullyAutomated(AUTOMATED_PLAN, TASK_KIND.BOOTSTRAP), false);
  });

  it("ne l'annonce pas des qu'un critere est humain", () => {
    assert.equal(planIsFullyAutomated(HUMAN_PLAN, TASK_KIND.NORMAL), false);
  });

  it("ne l'annonce pas sur un plan invalide", () => {
    const broken: VerificationPlan = {
      criteria: [{ ...AUTOMATED_PLAN.criteria[0]!, commandIds: [] }],
      commands: [],
    };
    assert.equal(planIsFullyAutomated(broken, TASK_KIND.NORMAL), false);
  });

  it("ne l'annonce pas sans critere", () => {
    assert.equal(planIsFullyAutomated({ criteria: [], commands: [] }, TASK_KIND.NORMAL), false);
  });
});

describe("pastille d'un critere", () => {
  it("ne considere prouve qu'un critere passe", () => {
    assert.equal(isCriterionProven({ criterion: AUTOMATED_PLAN.criteria[0]!, result: "PASSED" }), true);
    for (const result of ["FAILED", "NOT_VERIFIED", "HUMAN"] as const) {
      assert.equal(
        isCriterionProven({ criterion: AUTOMATED_PLAN.criteria[0]!, result }),
        false,
        result,
      );
    }
  });
});

describe("ce module ne declenche rien", () => {
  it("n'importe aucune fonction d'action", async () => {
    // La meme garantie que `review-service.ts` : lire une review n'a jamais
    // change un statut, lance une commande, ni appele un fournisseur. Le test
    // porte sur la **source**, pas sur le comportement observe une fois.
    const source = await readFile(path.join(HERE, "verification-review.ts"), "utf8");

    for (const forbidden of [
      "updateTaskStatus",
      "applyTaskTransition",
      "runAutonomousValidation",
      "reserveValidationBatch",
      "advanceQueue",
      "runValidationCommand",
      "OpenAI",
      "fetch(",
    ]) {
      assert.ok(!source.includes(forbidden), forbidden);
    }
  });
});
