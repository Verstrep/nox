/**
 * Ce que l'ecran dit de la verification.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'un echec ne se lit jamais comme une panne, et qu'une panne ne se lit jamais
 * comme un echec : c'est la distinction que TASK-027 existe pour tenir, et elle
 * se perd d'abord dans les libelles.
 *
 * Que le sort d'une sortie absente est **toujours dit** — jamais un vide muet
 * qui laisserait croire qu'il n'y avait rien a montrer.
 *
 * Et qu'aucun libelle ne laisse fuir un code technique jusqu'a l'utilisateur.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTONOMOUS_VALIDATION_OUTPUT_LIMIT,
  AUTONOMOUS_VALIDATION_STATUSES,
  REVIEW_DECISION_SOURCES,
  TASK_VERIFICATION_OUTCOMES,
  VALIDATION_BATCH_STATUSES,
  VERIFICATION_MODES,
} from "@nox/shared";

import {
  autonomousStatusLabel,
  autonomousStatusTone,
  batchStatusLabel,
  batchStatusTone,
  criterionMark,
  criterionResultLabel,
  criterionResultTone,
  decisionSourceLabel,
  formatDuration,
  formatExitCode,
  outputPlaceholder,
  truncationNotice,
  verificationModeLabel,
  verificationOutcomeMessage,
} from "./verification-display.ts";

describe("libelles d'une commande executee", () => {
  it("couvre chaque statut, sans code technique", () => {
    for (const status of AUTONOMOUS_VALIDATION_STATUSES) {
      const label = autonomousStatusLabel(status);
      assert.ok(label.length > 0, status);
      assert.ok(!label.includes("_"), status);
    }
  });

  it("distingue un echec d'une panne", () => {
    assert.notEqual(autonomousStatusLabel("FAILED"), autonomousStatusLabel("ERROR"));
    assert.notEqual(autonomousStatusTone("FAILED"), autonomousStatusTone("ERROR"));
  });

  it("traite un depassement comme un echec, jamais comme une panne", () => {
    assert.equal(autonomousStatusTone("TIMED_OUT"), autonomousStatusTone("FAILED"));
    assert.notEqual(autonomousStatusTone("TIMED_OUT"), autonomousStatusTone("ERROR"));
  });

  it("ne rend une reussite qu'en accent", () => {
    assert.equal(autonomousStatusTone("PASSED"), "accent");
  });
});

describe("libelles d'un lot", () => {
  it("couvre chaque statut", () => {
    for (const status of VALIDATION_BATCH_STATUSES) {
      assert.ok(batchStatusLabel(status).length > 0, status);
    }
  });

  it("nomme une panne d'infrastructure pour ce qu'elle est", () => {
    assert.ok(batchStatusLabel("ERROR").toLowerCase().includes("infrastructure"));
    assert.equal(batchStatusTone("ERROR"), "warn");
    assert.equal(batchStatusTone("FAILED"), "danger");
  });

  it("laisse un lot en cours en ton neutre", () => {
    assert.equal(batchStatusTone("PENDING"), "muted");
    assert.equal(batchStatusTone("RUNNING"), "muted");
  });
});

describe("libelles d'un critere", () => {
  it("distingue les quatre resultats", () => {
    const labels = new Set(
      (["PASSED", "FAILED", "NOT_VERIFIED", "HUMAN"] as const).map(criterionResultLabel),
    );
    assert.equal(labels.size, 4);
  });

  it("ne confond pas « pas verifie » et « faux »", () => {
    assert.notEqual(criterionResultLabel("NOT_VERIFIED"), criterionResultLabel("FAILED"));
    assert.notEqual(criterionResultTone("NOT_VERIFIED"), criterionResultTone("FAILED"));
  });

  it("donne trois pastilles distinctes", () => {
    assert.equal(criterionMark("PASSED"), "✓");
    assert.equal(criterionMark("FAILED"), "✕");
    assert.equal(criterionMark("HUMAN"), "○");
    assert.equal(criterionMark("NOT_VERIFIED"), "○");
  });

  it("nomme les deux modes", () => {
    for (const mode of VERIFICATION_MODES) {
      assert.ok(verificationModeLabel(mode).length > 0, mode);
    }
    assert.notEqual(verificationModeLabel("AUTOMATED"), verificationModeLabel("HUMAN"));
  });
});

describe("issue d'une tache", () => {
  it("explique chaque issue en une phrase", () => {
    for (const outcome of TASK_VERIFICATION_OUTCOMES) {
      const message = verificationOutcomeMessage(outcome);
      assert.ok(message.length > 30, outcome);
      assert.ok(!message.includes("AUTO_"), outcome);
    }
  });
});

describe("source d'une decision", () => {
  it("dit toujours qui a conclu", () => {
    for (const source of REVIEW_DECISION_SOURCES) {
      const label = decisionSourceLabel(source);
      assert.ok(label.length > 0, source);
      assert.ok(!label.includes("_"), source);
    }
    // « Approuve par l'utilisateur » quand personne n'a clique serait un
    // mensonge dans l'historique : les trois sources restent distinctes.
    assert.equal(
      new Set(REVIEW_DECISION_SOURCES.map(decisionSourceLabel)).size,
      REVIEW_DECISION_SOURCES.length,
    );
  });
});

describe("durees et codes de sortie", () => {
  it("dit une absence de duree plutot que zero", () => {
    assert.ok(formatDuration(null).includes("inconnue"));
  });

  it("rend les millisecondes puis les secondes", () => {
    assert.equal(formatDuration(120), "120 ms");
    assert.equal(formatDuration(2_500), "2.5 s");
  });

  it("dit une absence de code de sortie", () => {
    assert.ok(formatExitCode(null).includes("aucun"));
    assert.equal(formatExitCode(0), "exit 0");
    assert.equal(formatExitCode(3), "exit 3");
  });
});

describe("sorties absentes ou tronquees", () => {
  it("distingue « rien capture » de « rien ecrit »", () => {
    const missing = outputPlaceholder(null);
    const empty = outputPlaceholder("");
    assert.ok(missing !== null);
    assert.ok(empty !== null);
    assert.notEqual(missing, empty);
  });

  it("n'affiche aucun message quand il y a une sortie", () => {
    assert.equal(outputPlaceholder("ok"), null);
  });

  it("annonce une troncature, et dit que la commande a continue", () => {
    const notice = truncationNotice(true, AUTONOMOUS_VALIDATION_OUTPUT_LIMIT);
    assert.ok(notice !== null);
    assert.ok(notice.includes(String(AUTONOMOUS_VALIDATION_OUTPUT_LIMIT)));
    assert.ok(notice.includes("continue"));
    assert.equal(truncationNotice(false, AUTONOMOUS_VALIDATION_OUTPUT_LIMIT), null);
  });
});
