/**
 * Tests de la preparation d'une analyse.
 *
 * Un seul pipeline produit l'apercu et l'envoi : ce fichier verifie que ce qui
 * est affiche est bien ce qui partira, et que l'empreinte change exactement
 * quand quelque chose change.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARCHITECT_REVIEW_PROMPT_VERSION,
  type DevelopmentTaskDetail,
  type RunFileChange,
} from "@nox/shared";

import type { ArchitectReviewRun, ArchitectReviewSnapshot } from "./review-bundle.ts";
import { prepareArchitectReview, type PrepareArchitectReviewInput } from "./review-prepare.ts";

const TASK: DevelopmentTaskDetail = {
  id: "task-1",
  projectId: "project-1",
  code: "TASK-003",
  kind: "NORMAL",
  title: "Filtrer les recettes",
  status: "REVIEW",
  priority: "MEDIUM",
  objective: "Retrouver une recette sans defiler.",
  context: null,
  outOfScope: null,
  acceptanceCriteria: ["Un champ filtre la liste."],
  documentReferences: [],
  validationCommands: ["npm run test"],
  documentPath: "tasks/TASK-003.md",
  documentRevision: null,
  documentSyncStatus: "SYNCED",
  documentSyncError: null,
  createdAt: "2026-08-11T08:00:00.000Z",
  updatedAt: "2026-08-11T08:00:00.000Z",
};

const RUN: ArchitectReviewRun = {
  code: "RUN-001",
  kind: "INITIAL",
  parentRunCode: null,
  status: "COMPLETED",
  durationMs: 120_000,
  headBefore: "19ab8c3f2d41aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  headAfter: "19ab8c3f2d41aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  errorCode: null,
};

const FILE: RunFileChange = {
  position: 0,
  path: "front/js/recettes.js",
  previousPath: null,
  changeType: "MODIFIED",
  additions: 12,
  deletions: 3,
  isBinary: false,
  isSensitive: false,
  isTruncated: false,
  patch: "@@ -1,3 +1,12 @@\n-const a = 1;\n+const a = 2;\n",
};

const REVIEW: ArchitectReviewSnapshot = {
  capturedAt: "2026-08-11T09:00:00.000Z",
  errorCode: null,
  omittedFiles: 0,
  files: [FILE],
  validations: [],
};

const BASE: PrepareArchitectReviewInput = {
  runId: "run-1",
  task: TASK,
  run: RUN,
  review: REVIEW,
  repositoryPath: "/home/theo/projets/recettes",
  model: "modele-de-test",
  environment: { NOX_OPENAI_API_KEY: "cle-de-test-9876543210" },
};

describe("prepareArchitectReview", () => {
  it("est deterministe", () => {
    const first = prepareArchitectReview(BASE);
    const second = prepareArchitectReview(BASE);
    assert.equal(first.inputHash, second.inputHash);
    assert.equal(first.prompt.input, second.prompt.input);
  });

  it("porte la version du prompt de review", () => {
    assert.equal(prepareArchitectReview(BASE).prompt.version, ARCHITECT_REVIEW_PROMPT_VERSION);
  });

  it("change d'empreinte quand le modele change", () => {
    const first = prepareArchitectReview(BASE);
    const second = prepareArchitectReview({ ...BASE, model: "autre-modele" });
    assert.notEqual(first.inputHash, second.inputHash);
  });

  it("change d'empreinte quand la specification change", () => {
    const first = prepareArchitectReview(BASE);
    const second = prepareArchitectReview({
      ...BASE,
      task: { ...TASK, acceptanceCriteria: ["Un champ filtre la liste.", "Et ignore la casse."] },
    });
    assert.notEqual(first.inputHash, second.inputHash);
    assert.notEqual(first.manifest.taskRevision, second.manifest.taskRevision);
  });

  it("change d'empreinte quand le diff change", () => {
    const first = prepareArchitectReview(BASE);
    const second = prepareArchitectReview({
      ...BASE,
      review: { ...REVIEW, files: [{ ...FILE, patch: "@@ -1 +1 @@\n+autre chose\n" }] },
    });
    assert.notEqual(first.inputHash, second.inputHash);
  });

  it("n'emet ni cle, ni chemin absolu du repository", () => {
    const prepared = prepareArchitectReview({
      ...BASE,
      review: {
        ...REVIEW,
        files: [
          {
            ...FILE,
            patch:
              "@@ -1 +1 @@\n+// /home/theo/projets/recettes/front/js/recettes.js\n+const k = \"cle-de-test-9876543210\";\n",
          },
        ],
      },
    });

    const whole = `${prepared.prompt.instructions}\n${prepared.prompt.input}`;
    assert.ok(!whole.includes("cle-de-test-9876543210"));
    assert.ok(!whole.includes("/home/theo"));
    // Le chemin du repository devient relatif plutot que masque : le relecteur
    // doit reconnaitre le fichier dont on lui parle.
    assert.match(whole, /front\/js\/recettes\.js/u);
  });

  it("expose le manifest, les faits et les references de validation", () => {
    const prepared = prepareArchitectReview(BASE);
    assert.equal(prepared.manifest.runCode, "RUN-001");
    assert.equal(prepared.facts.runCompleted, true);
    assert.deepEqual(prepared.filePaths, ["front/js/recettes.js"]);
    assert.equal(prepared.criteriaCount, 1);
  });
});
