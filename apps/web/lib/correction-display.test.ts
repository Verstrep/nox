/**
 * Tests de l'affichage de la correction ciblee.
 *
 * Fonctions pures : c'est ici que se verifie qu'un refus est **explique** plutot
 * que masque, et qu'une precondition non tenue ne se distingue pas seulement par
 * une couleur.
 */

import { RESUME_REFUSAL, RUN_KIND } from "@nox/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allPreconditionsMet,
  buildPreconditions,
  correctionUrl,
  feedbackExcerpt,
  requestChangesUrl,
  resumeRefusalMessage,
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
