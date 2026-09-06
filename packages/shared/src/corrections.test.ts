/**
 * Tests du contrat de la correction ciblee.
 *
 * Le feedback est du contenu utilisateur : il doit accepter tout ce qu'un humain
 * ecrit reellement — accents, listes, extraits de code —, et refuser uniquement
 * ce qui n'a pas de substance ou ce qui casserait une ecriture.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RESUME_REFUSAL,
  REVIEW_FEEDBACK_LIMITS,
  RUN_KIND,
  checkResumeCandidate,
  checkReviewFeedback,
  isRunKind,
  isRunWorkspaceFingerprint,
  normalizeReviewFeedback,
  type ResumeCandidate,
} from "../dist/index.js";

describe("RUN_KIND", () => {
  it("reconnait les deux natures d'execution", () => {
    assert.equal(isRunKind(RUN_KIND.INITIAL), true);
    assert.equal(isRunKind(RUN_KIND.CORRECTION), true);
  });

  it("refuse tout le reste", () => {
    assert.equal(isRunKind("RETRY"), false);
    assert.equal(isRunKind(""), false);
    assert.equal(isRunKind(null), false);
    assert.equal(isRunKind(2), false);
  });
});

describe("checkReviewFeedback", () => {
  it("accepte un texte ordinaire", () => {
    assert.equal(checkReviewFeedback("Raccourcis la deuxieme phrase du README."), null);
  });

  it("accepte l'Unicode", () => {
    assert.equal(checkReviewFeedback("Corrige « l'entête » et les accents : é à ü — ok ✓"), null);
  });

  it("accepte plusieurs lignes et une liste", () => {
    assert.equal(checkReviewFeedback("Deux points :\n- le titre ;\n- la conclusion.\n"), null);
  });

  it("accepte un extrait de code avec tabulations", () => {
    assert.equal(checkReviewFeedback("Remplace :\n```ts\n\tconst a = 1;\n```\n"), null);
  });

  it("refuse une chaine vide", () => {
    assert.equal(checkReviewFeedback(""), "empty");
  });

  it("refuse un texte fait d'espaces", () => {
    assert.equal(checkReviewFeedback("   \n\t  "), "blank");
  });

  it("refuse un texte trop long", () => {
    assert.equal(checkReviewFeedback("x".repeat(REVIEW_FEEDBACK_LIMITS.maxLength + 1)), "too_long");
  });

  it("accepte exactement la borne", () => {
    assert.equal(checkReviewFeedback("x".repeat(REVIEW_FEEDBACK_LIMITS.maxLength)), null);
  });

  it("refuse un octet nul", () => {
    assert.equal(checkReviewFeedback("Corrige\u0000le titre"), "control_character");
  });

  it("refuse un caractere de controle", () => {
    assert.equal(checkReviewFeedback("Corrige\u0007le titre"), "control_character");
  });
});

describe("normalizeReviewFeedback", () => {
  it("ramene les fins de ligne a LF", () => {
    assert.equal(normalizeReviewFeedback("un\r\ndeux\rtrois"), "un\ndeux\ntrois");
  });

  it("retire les marges", () => {
    assert.equal(normalizeReviewFeedback("\n\n  Corrige ceci.  \n\n"), "Corrige ceci.");
  });

  it("preserve les lignes vides internes", () => {
    assert.equal(normalizeReviewFeedback("un\n\ndeux"), "un\n\ndeux");
  });
});

describe("isRunWorkspaceFingerprint", () => {
  it("accepte une empreinte calculee", () => {
    assert.equal(
      isRunWorkspaceFingerprint({ value: "a".repeat(64), version: "v1", errorCode: null }),
      true,
    );
  });

  it("accepte une empreinte absente avec son motif", () => {
    assert.equal(
      isRunWorkspaceFingerprint({ value: null, version: "v1", errorCode: "TIMEOUT" }),
      true,
    );
  });

  it("refuse une forme incomplete", () => {
    assert.equal(isRunWorkspaceFingerprint({ value: "a" }), false);
    assert.equal(isRunWorkspaceFingerprint(null), false);
    assert.equal(isRunWorkspaceFingerprint([]), false);
  });
});

describe("checkResumeCandidate", () => {
  function candidate(overrides: Partial<ResumeCandidate> = {}): ResumeCandidate {
    return {
      runStatus: "COMPLETED",
      taskStatus: "REVIEW",
      errorCode: null,
      claudeSessionId: "62b9a0f0-1d01-4a0c-8201-60f9bae0d34e",
      hasReview: true,
      hasFingerprint: true,
      hasActiveRun: false,
      hasCorrection: false,
      ...overrides,
    };
  }

  it("autorise une execution reussie et relue", () => {
    assert.equal(checkResumeCandidate(candidate()), null);
  });

  it("accepte une execution echouee qui a laisse du travail", () => {
    // Le coeur de HOTFIX-006. Avant lui, ce cas etait refuse, et l'utilisateur
    // n'avait que `Retry` — qui exige un repository propre, donc qui commence
    // par demander de jeter le travail que l'echec a laisse.
    assert.equal(
      checkResumeCandidate(
        candidate({
          runStatus: "FAILED",
          taskStatus: "FAILED",
          errorCode: "CLAUDE_PROCESS_FAILED",
          exitCode: 1,
        }),
      ),
      null,
    );
  });

  it("refuse une execution echouee dont la tache n'est plus en echec", () => {
    assert.equal(
      checkResumeCandidate(
        candidate({ runStatus: "FAILED", taskStatus: "DRAFT", exitCode: 1 }),
      ),
      RESUME_REFUSAL.TASK_NOT_IN_REVIEW,
    );
  });

  it("refuse un echec qui n'a rien produit", () => {
    // Un processus qui n'a jamais demarre ne laisse aucun dossier de travail a
    // continuer : proposer une reprise y serait proposer de continuer le vide.
    assert.equal(
      checkResumeCandidate(
        candidate({
          runStatus: "FAILED",
          taskStatus: "FAILED",
          errorCode: "CLAUDE_START_FAILED",
          exitCode: null,
        }),
      ),
      RESUME_REFUSAL.NO_PARTIAL_WORK,
    );
  });

  it("refuse une execution bloquee", () => {
    assert.equal(
      checkResumeCandidate(candidate({ runStatus: "BLOCKED" })),
      RESUME_REFUSAL.RUN_NOT_COMPLETED,
    );
  });

  it("refuse une execution annulee", () => {
    assert.equal(
      checkResumeCandidate(candidate({ runStatus: "CANCELLED" })),
      RESUME_REFUSAL.RUN_NOT_COMPLETED,
    );
  });

  it("refuse une violation Git avant meme de regarder la tache", () => {
    // La violation prime : l'etat de depart est ambigu, et aucune correction
    // n'a de sens dessus.
    assert.equal(
      checkResumeCandidate(
        candidate({ errorCode: "GIT_POLICY_VIOLATION", taskStatus: "COMPLETED" }),
      ),
      RESUME_REFUSAL.GIT_POLICY_VIOLATION,
    );
  });

  it("refuse une tache qui n'est plus en review", () => {
    assert.equal(
      checkResumeCandidate(candidate({ taskStatus: "COMPLETED" })),
      RESUME_REFUSAL.TASK_NOT_IN_REVIEW,
    );
  });

  it("refuse une execution sans session Claude", () => {
    assert.equal(
      checkResumeCandidate(candidate({ claudeSessionId: null })),
      RESUME_REFUSAL.SESSION_MISSING,
    );
    assert.equal(
      checkResumeCandidate(candidate({ claudeSessionId: "  " })),
      RESUME_REFUSAL.SESSION_MISSING,
    );
  });

  it("refuse une execution sans review", () => {
    assert.equal(
      checkResumeCandidate(candidate({ hasReview: false })),
      RESUME_REFUSAL.REVIEW_MISSING,
    );
  });

  it("refuse une execution sans empreinte", () => {
    // Le cas des runs anterieurs a TASK-012 : reconstituer l'empreinte
    // aujourd'hui decrirait le present en pretendant decrire le passe.
    assert.equal(
      checkResumeCandidate(candidate({ hasFingerprint: false })),
      RESUME_REFUSAL.FINGERPRINT_MISSING,
    );
  });

  it("refuse une seconde correction depuis la meme review", () => {
    assert.equal(
      checkResumeCandidate(candidate({ hasCorrection: true })),
      RESUME_REFUSAL.ALREADY_CORRECTED,
    );
  });

  it("refuse tant qu'une execution est active", () => {
    assert.equal(
      checkResumeCandidate(candidate({ hasActiveRun: true })),
      RESUME_REFUSAL.RUN_ACTIVE,
    );
  });
});
