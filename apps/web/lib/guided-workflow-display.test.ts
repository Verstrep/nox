/**
 * Tests de la couche de presentation du workflow guide.
 *
 * Deux choses y sont verifiees : chaque action mene bien a une surface qui
 * existe deja, et la derivation elle-meme ne peut declencher aucune action.
 *
 * Le second test lit le **source** du module partage plutot que son
 * comportement. C'est volontaire : une regression y serait invisible a
 * l'execution — la fonction continuerait de retourner un etat correct tout en
 * ayant lance un appel au passage — et parfaitement lisible dans le texte.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  GUIDED_ACTION,
  GUIDED_ACTION_KINDS,
  GUIDED_PROGRESS_STEP,
  type GuidedAction,
  type GuidedActionKind,
} from "@nox/shared";

import {
  GUIDED_PROGRESS_ORDER,
  TASK_SECTION_ANCHOR,
  guidedActionHref,
  guidedProgressMark,
  taskWorkflowUrl,
} from "./guided-workflow-display.ts";

const PROJECT = "projet-1";
const TASK = "tache-1";
const RUN = "run-1";
const ANALYSIS = "analysis-1";
const FEEDBACK = "feedback-1";

function target(
  kind: GuidedActionKind,
  overrides: Partial<Omit<GuidedAction, "kind">> = {},
): GuidedAction {
  return {
    kind,
    runId: overrides.runId ?? null,
    analysisId: overrides.analysisId ?? null,
    feedbackId: overrides.feedbackId ?? null,
  };
}

function href(kind: GuidedActionKind, overrides: Partial<Omit<GuidedAction, "kind">> = {}) {
  return guidedActionHref(PROJECT, TASK, target(kind, overrides));
}

describe("guidedActionHref", () => {
  const base = `/projects/${PROJECT}/tasks/${TASK}`;

  it("renvoie les decisions de statut vers la section de la page", () => {
    assert.equal(href(GUIDED_ACTION.MARK_READY), `${base}#${TASK_SECTION_ANCHOR.status}`);
    assert.equal(href(GUIDED_ACTION.REOPEN), `${base}#${TASK_SECTION_ANCHOR.status}`);
    assert.equal(href(GUIDED_ACTION.RETRY), `${base}#${TASK_SECTION_ANCHOR.status}`);
    assert.equal(href(GUIDED_ACTION.BACK_TO_DRAFT), `${base}#${TASK_SECTION_ANCHOR.status}`);
  });

  it("renvoie la synchronisation documentaire vers sa section", () => {
    assert.equal(
      href(GUIDED_ACTION.RESOLVE_DOCUMENT_SYNC),
      `${base}#${TASK_SECTION_ANCHOR.document}`,
    );
    assert.equal(href(GUIDED_ACTION.OPEN_DOCUMENT), `${base}#${TASK_SECTION_ANCHOR.document}`);
  });

  it("ouvre la preparation d'une execution", () => {
    assert.equal(href(GUIDED_ACTION.RUN_CLAUDE), `${base}/runs/new`);
  });

  it("ouvre l'execution et sa review", () => {
    assert.equal(href(GUIDED_ACTION.OPEN_RUN, { runId: RUN }), `${base}/runs/${RUN}`);
    assert.equal(href(GUIDED_ACTION.OPEN_REVIEW, { runId: RUN }), `${base}/runs/${RUN}/review`);
  });

  it("mene les trois libelles de review a la meme page", () => {
    const review = `${base}/runs/${RUN}/review`;
    assert.equal(href(GUIDED_ACTION.OPEN_REVIEW, { runId: RUN }), review);
    assert.equal(href(GUIDED_ACTION.REVIEW_MANUALLY, { runId: RUN }), review);
    assert.equal(href(GUIDED_ACTION.REVIEW_AND_APPROVE, { runId: RUN }), review);
    assert.equal(href(GUIDED_ACTION.APPROVE, { runId: RUN }), review);
  });

  it("ouvre la preparation d'une analyse Architecte", () => {
    assert.equal(
      href(GUIDED_ACTION.ANALYZE_WITH_ARCHITECT, { runId: RUN }),
      `${base}/runs/${RUN}/architect-review`,
    );
  });

  it("ouvre une analyse enregistree", () => {
    assert.equal(
      href(GUIDED_ACTION.OPEN_ARCHITECT_ANALYSIS, { runId: RUN, analysisId: ANALYSIS }),
      `${base}/runs/${RUN}/architect-review/${ANALYSIS}`,
    );
  });

  it("preremplit le formulaire de correction avec l'identifiant de l'analyse", () => {
    assert.equal(
      href(GUIDED_ACTION.USE_AS_FEEDBACK, { runId: RUN, analysisId: ANALYSIS }),
      `${base}/runs/${RUN}/request-changes?analysis=${ANALYSIS}`,
    );
  });

  it("mene la preparation et la reprise a la meme page de correction", () => {
    const correction = `${base}/runs/${RUN}/corrections/${FEEDBACK}`;
    assert.equal(
      href(GUIDED_ACTION.PREPARE_CORRECTION, { runId: RUN, feedbackId: FEEDBACK }),
      correction,
    );
    assert.equal(
      href(GUIDED_ACTION.RESUME_CLAUDE, { runId: RUN, feedbackId: FEEDBACK }),
      correction,
    );
  });

  it("ne fabrique jamais une URL a partir d'une cible manquante", () => {
    assert.equal(href(GUIDED_ACTION.OPEN_RUN), null);
    assert.equal(href(GUIDED_ACTION.OPEN_REVIEW), null);
    assert.equal(href(GUIDED_ACTION.OPEN_ARCHITECT_ANALYSIS, { runId: RUN }), null);
    assert.equal(href(GUIDED_ACTION.USE_AS_FEEDBACK, { runId: RUN }), null);
    assert.equal(href(GUIDED_ACTION.RESUME_CLAUDE, { runId: RUN }), null);
  });

  it("couvre toutes les natures d'action", () => {
    // Une nature ajoutee sans destination produirait un bouton muet : la table
    // est donc parcourue en entier.
    for (const kind of GUIDED_ACTION_KINDS) {
      const value = guidedActionHref(
        PROJECT,
        TASK,
        target(kind, { runId: RUN, analysisId: ANALYSIS, feedbackId: FEEDBACK }),
      );
      assert.equal(typeof value, "string", kind);
    }
  });
});

describe("taskWorkflowUrl", () => {
  it("pointe vers la section du guide", () => {
    assert.equal(
      taskWorkflowUrl(PROJECT, TASK),
      `/projects/${PROJECT}/tasks/${TASK}#${TASK_SECTION_ANCHOR.workflow}`,
    );
  });
});

describe("progression", () => {
  it("garde un ordre fige", () => {
    assert.deepEqual(GUIDED_PROGRESS_ORDER, [
      GUIDED_PROGRESS_STEP.SPECIFICATION,
      GUIDED_PROGRESS_STEP.EXECUTION,
      GUIDED_PROGRESS_STEP.REVIEW,
      GUIDED_PROGRESS_STEP.CORRECTION,
      GUIDED_PROGRESS_STEP.DONE,
    ]);
  });

  it("distingue les trois etats par un signe", () => {
    const marks = new Set([
      guidedProgressMark("done"),
      guidedProgressMark("current"),
      guidedProgressMark("pending"),
    ]);
    assert.equal(marks.size, 3);
  });
});

describe("la derivation ne peut declencher aucune action", () => {
  it("le module partage n'appelle ni fournisseur, ni runner, ni base", async () => {
    const source = await readFile(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../packages/shared/src/guided-workflow.ts",
      ),
      "utf8",
    );

    // Aucune de ces chaines n'a de raison d'exister dans une projection. Un
    // ajout futur ferait echouer ce test avant d'atteindre une page.
    for (const forbidden of [
      "await ",
      "async ",
      "fetch(",
      "Promise",
      "provider",
      "openai",
      "getDatabaseClient",
      "updateTaskStatus",
      "createReviewFeedback",
      "startCorrectionFromFeedback",
      "startTaskExecution",
      "claudePreflight",
      "process.env",
      "node:",
    ]) {
      assert.ok(!source.includes(forbidden), forbidden);
    }
  });

  it("le chargeur de faits n'ecrit rien", async () => {
    const source = await readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "guided-workflow.ts"),
      "utf8",
    );

    // Le chargeur lit la base et sonde le runner en lecture seule. Aucune
    // ecriture, aucune transition, aucun appel au fournisseur.
    for (const forbidden of [
      "updateTaskStatus",
      "createReviewFeedback",
      "startCorrectionFromFeedback",
      "startTaskCorrection",
      "startTaskExecution",
      "createRun",
      "analyzeArchitectReview",
      "startArchitectRunReview",
      "saveRunReview",
      "startClaudeRun",
    ]) {
      assert.ok(!source.includes(forbidden), forbidden);
    }
  });
});
