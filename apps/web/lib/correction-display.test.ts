/**
 * Tests de l'affichage de la correction ciblee.
 *
 * Fonctions pures : c'est ici que se verifie qu'un refus est **explique** plutot
 * que masque, et qu'une precondition non tenue ne se distingue pas seulement par
 * une couleur.
 */

import {
  CORRECTION_REFUSAL,
  CORRECTION_REFUSAL_CODES,
  CORRECTION_SOURCE,
  CORRECTION_STAGE,
  MAX_AUTOMATED_CORRECTION_ATTEMPTS,
  RESUME_REFUSAL,
  RUN_KIND,
  RUN_PROVENANCE,
  type CorrectionCycleState,
} from "@nox/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allPreconditionsMet,
  automatedAttemptLabel,
  buildPreconditions,
  correctionEvidenceUrl,
  correctionRefusalMessage,
  correctionSourceLabel,
  correctionStageDetail,
  correctionStageLabel,
  correctionUrl,
  feedbackExcerpt,
  requestChangesUrl,
  resumeRefusalMessage,
  runProvenanceLabel,
} from "./correction-display.ts";

describe("URL", () => {
  it("construit l'URL de la demande de corrections", () => {
    assert.equal(
      requestChangesUrl("p1", "t1", "r1"),
      "/projects/p1/tasks/t1/runs/r1/request-changes",
    );
  });

  it("construit l'URL de preparation d'une correction", () => {
    assert.equal(
      correctionUrl("p1", "t1", "r1", "f1"),
      "/projects/p1/tasks/t1/runs/r1/corrections/f1",
    );
  });
});

describe("resumeRefusalMessage", () => {
  it("explique chaque refus", () => {
    for (const refusal of Object.values(RESUME_REFUSAL)) {
      const message = resumeRefusalMessage(refusal);
      assert.ok(message.length > 40, `message trop court pour ${refusal}`);
      // Aucun code technique ne doit atteindre l'utilisateur.
      assert.equal(message.includes("_"), false, `code brut dans le message de ${refusal}`);
    }
  });

  it("dit pourquoi un ancien run n'est pas reprenable", () => {
    const message = resumeRefusalMessage(RESUME_REFUSAL.FINGERPRINT_MISSING);
    assert.ok(message.includes("anterieure"));
    // La raison de fond : NOX ne reconstruit pas une empreinte apres coup.
    assert.ok(message.includes("aujourd'hui"));
  });

  it("distingue une violation Git d'un simple echec", () => {
    assert.notEqual(
      resumeRefusalMessage(RESUME_REFUSAL.GIT_POLICY_VIOLATION),
      resumeRefusalMessage(RESUME_REFUSAL.RUN_NOT_COMPLETED),
    );
  });
});

describe("buildPreconditions", () => {
  function all(overrides: Record<string, boolean> = {}) {
    return buildPreconditions({
      taskInReview: true,
      runCompleted: true,
      sessionAvailable: true,
      reviewAvailable: true,
      workspaceMatches: true,
      gitUnchanged: true,
      claudeAvailable: true,
      workspaceDetail: null,
      ...overrides,
    });
  }

  it("liste sept preconditions", () => {
    assert.equal(all().length, 7);
  });

  it("les marque toutes tenues quand tout va bien", () => {
    assert.equal(allPreconditionsMet(all()), true);
    assert.ok(all().every((entry) => entry.state === "met"));
  });

  it("bloque des qu'une seule manque", () => {
    assert.equal(allPreconditionsMet(all({ sessionAvailable: false })), false);
  });

  it("nomme l'etat du dossier de travail", () => {
    const preconditions = buildPreconditions({
      taskInReview: true,
      runCompleted: true,
      sessionAvailable: true,
      reviewAvailable: true,
      workspaceMatches: false,
      gitUnchanged: true,
      claudeAvailable: true,
      workspaceDetail: "Le repository a change depuis cette review.",
    });

    const entry = preconditions.find((item) => item.label.includes("Repository matches"));
    assert.equal(entry?.state, "unmet");
    assert.equal(entry?.detail, "Le repository a change depuis cette review.");
  });

  it("n'attache aucun detail a une precondition tenue", () => {
    const preconditions = all({ workspaceMatches: true });
    assert.ok(preconditions.every((entry) => entry.state !== "met" || entry.detail === null));
  });

  it("porte des libelles techniques en anglais", () => {
    // Meme regle que les statuts depuis TASK-009 : le vocabulaire technique
    // reste en anglais, les explications sont en francais.
    assert.ok(all().some((entry) => entry.label === "Task is in Review"));
    assert.ok(all().some((entry) => entry.label === "Claude Code available"));
  });
});

describe("feedbackExcerpt", () => {
  it("laisse un texte court intact", () => {
    assert.equal(feedbackExcerpt("Corrige le titre."), "Corrige le titre.");
  });

  it("ramene un texte multiligne sur une ligne", () => {
    assert.equal(feedbackExcerpt("un\n\ndeux\ttrois"), "un deux trois");
  });

  it("coupe un texte trop long", () => {
    const excerpt = feedbackExcerpt("x".repeat(500), 40);
    assert.equal(excerpt.length, 40);
    assert.ok(excerpt.endsWith("…"));
  });
});

describe("RUN_KIND dans l'interface", () => {
  it("distingue une correction d'une execution initiale", () => {
    // Le contrat est ferme : l'interface n'a que deux cas a traiter.
    assert.deepEqual(Object.values(RUN_KIND).sort(), ["CORRECTION", "INITIAL"]);
  });
});

describe("URL d'une correction", () => {
  it("porte les criteres humains signales, et rien d'autre", () => {
    assert.equal(
      correctionUrl("p1", "t1", "r1", "f1"),
      "/projects/p1/tasks/t1/runs/r1/corrections/f1",
    );
    assert.equal(
      correctionUrl("p1", "t1", "r1", "f1", ["c1", "c2"]),
      "/projects/p1/tasks/t1/runs/r1/corrections/f1?criterion=c1&criterion=c2",
    );
  });

  it("echappe un identifiant hostile plutot que de le recopier", () => {
    const url = correctionUrl("p1", "t1", "r1", "f1", ["a&b=c"]);
    assert.equal(url.includes("a&b=c"), false);
    assert.ok(url.includes("a%26b%3Dc"));
  });

  it("ouvre une page distincte quand il n'y a aucun feedback", () => {
    // Une correction humaine peut n'avoir aucun texte : les preuves de NOX
    // disent deja tout, et un `ReviewFeedback` vide n'existe pas dans NOX.
    assert.equal(
      correctionEvidenceUrl("p1", "t1", "r1"),
      "/projects/p1/tasks/t1/runs/r1/corrections/evidence",
    );
  });
});

describe("refus d'une correction", () => {
  it("explique chaque cause, sans trou", () => {
    for (const code of CORRECTION_REFUSAL_CODES) {
      const message = correctionRefusalMessage(code);
      assert.equal(typeof message, "string");
      assert.ok(message.length > 20, code);
    }
  });

  it("distingue une file en pause d'une borne atteinte", () => {
    // Deux gestes humains differents : redemarrer la file, ou relire le travail.
    const paused = correctionRefusalMessage(CORRECTION_REFUSAL.QUEUE_PAUSED);
    const limit = correctionRefusalMessage(CORRECTION_REFUSAL.LIMIT_REACHED);
    assert.notEqual(paused, limit);
    assert.match(paused, /pause/u);
    assert.match(limit, /corrections automatiques/u);
  });

  it("renvoie vers la reprise du lot pour une panne d'infrastructure", () => {
    const message = correctionRefusalMessage(CORRECTION_REFUSAL.VALIDATION_ERROR);
    assert.match(message, /relancez la validation/iu);
  });

  it("dit qu'une tache lancee a la main attend un clic", () => {
    const message = correctionRefusalMessage(CORRECTION_REFUSAL.NOT_QUEUED);
    assert.match(message, /attend votre clic/u);
  });
});

describe("libelles du cycle", () => {
  function state(overrides: Partial<CorrectionCycleState> = {}): CorrectionCycleState {
    return {
      stage: CORRECTION_STAGE.NONE,
      automatedAttempts: 0,
      maxAutomatedAttempts: MAX_AUTOMATED_CORRECTION_ATTEMPTS,
      lastSource: null,
      refusal: null,
      ...overrides,
    };
  }

  it("annonce le rang d'une correction automatique en cours", () => {
    assert.equal(
      correctionStageLabel(
        state({
          stage: CORRECTION_STAGE.RUNNING,
          automatedAttempts: 1,
          lastSource: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
        }),
      ),
      "Automatic correction 1 of 2 running",
    );
  });

  it("ne colle aucun rang a une correction humaine", () => {
    assert.equal(
      correctionStageLabel(
        state({ stage: CORRECTION_STAGE.RUNNING, lastSource: CORRECTION_SOURCE.HUMAN_FEEDBACK }),
      ),
      "Correction running",
    );
    assert.equal(automatedAttemptLabel(CORRECTION_SOURCE.HUMAN_FEEDBACK, 1), null);
    assert.equal(automatedAttemptLabel(CORRECTION_SOURCE.AUTOMATED_VALIDATION, null), null);
    assert.equal(
      automatedAttemptLabel(CORRECTION_SOURCE.AUTOMATED_VALIDATION, 2),
      "Attempt 2 of 2",
    );
  });

  it("dit la borne atteinte, et que l'humain reprend la main", () => {
    const reached = state({ stage: CORRECTION_STAGE.LIMIT_REACHED, automatedAttempts: 2 });
    assert.equal(correctionStageLabel(reached), "Automatic correction limit reached");
    assert.match(correctionStageDetail(reached) ?? "", /Human review required/u);
  });

  it("dit qu'il n'y a rien a recopier quand une correction est prete", () => {
    const ready = state({ stage: CORRECTION_STAGE.READY });
    assert.equal(correctionStageLabel(ready), "Correction ready");
    assert.match(correctionStageDetail(ready) ?? "", /rien a recopier/u);
  });

  it("ne dit rien de plus quand rien n'est en jeu", () => {
    assert.equal(correctionStageDetail(state()), null);
  });
});

describe("source et provenance", () => {
  it("nomme les deux sources en toutes lettres", () => {
    assert.equal(
      correctionSourceLabel(CORRECTION_SOURCE.AUTOMATED_VALIDATION),
      "Automatic validation",
    );
    assert.equal(correctionSourceLabel(CORRECTION_SOURCE.HUMAN_FEEDBACK), "Human feedback");
  });

  it("nomme les quatre provenances, dont l'historique", () => {
    assert.equal(runProvenanceLabel(RUN_PROVENANCE.INITIAL), "Initial execution");
    assert.equal(
      runProvenanceLabel(RUN_PROVENANCE.HUMAN_CORRECTION),
      "Human-requested correction",
    );
    assert.equal(
      runProvenanceLabel(RUN_PROVENANCE.AUTOMATIC_CORRECTION),
      "Automatic validation correction",
    );
    // Une correction d'avant TASK-028 n'est pas une erreur : elle est historique.
    assert.equal(runProvenanceLabel(RUN_PROVENANCE.LEGACY_CORRECTION), "Legacy correction");
  });
});
