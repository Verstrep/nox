/**
 * Tests du contrat de review.
 *
 * Le package compile est importe volontairement, comme pour les evenements :
 * c'est l'artefact que le runner, la base et le web consomment reellement.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REVIEW_LIMITS,
  RUN_CHANGE_TYPE,
  RUN_VALIDATION_STATUS,
  RUN_VALIDATION_SUMMARY,
  isAbsoluteLikePath,
  isRunFileChange,
  isRunReviewSnapshot,
  isRunValidationResultView,
  isSensitiveRepositoryPath,
  summarizeRunValidations,
  totalRunReview,
  type RunFileChange,
  type RunValidationStatus,
} from "../dist/index.js";

function fileChange(overrides: Partial<RunFileChange> = {}): RunFileChange {
  return {
    position: 0,
    path: "apps/web/lib/runs.ts",
    previousPath: null,
    changeType: RUN_CHANGE_TYPE.MODIFIED,
    additions: 4,
    deletions: 1,
    isBinary: false,
    isSensitive: false,
    isTruncated: false,
    patch: "@@ -1 +1 @@\n-a\n+b\n",
    ...overrides,
  };
}

function statuses(...values: RunValidationStatus[]): { status: RunValidationStatus }[] {
  return values.map((status) => ({ status }));
}

describe("isSensitiveRepositoryPath", () => {
  it("masque les fichiers d'environnement", () => {
    assert.equal(isSensitiveRepositoryPath(".env"), true);
    assert.equal(isSensitiveRepositoryPath(".env.local"), true);
    assert.equal(isSensitiveRepositoryPath(".env.production"), true);
    assert.equal(isSensitiveRepositoryPath("apps/web/.env"), true);
  });

  it("laisse passer les exemples, qui existent pour etre lus", () => {
    assert.equal(isSensitiveRepositoryPath(".env.example"), false);
    assert.equal(isSensitiveRepositoryPath(".env.sample"), false);
    assert.equal(isSensitiveRepositoryPath("packages/api/.env.example"), false);
  });

  it("masque les cles privees", () => {
    assert.equal(isSensitiveRepositoryPath("certs/server.pem"), true);
    assert.equal(isSensitiveRepositoryPath("certs/server.key"), true);
    assert.equal(isSensitiveRepositoryPath(".ssh/id_rsa"), true);
    assert.equal(isSensitiveRepositoryPath(".ssh/id_ed25519"), true);
  });

  it("masque les fichiers de secrets nommes", () => {
    assert.equal(isSensitiveRepositoryPath("credentials.json"), true);
    assert.equal(isSensitiveRepositoryPath("config/secrets.json"), true);
  });

  it("ne se laisse pas contourner par la casse ni par les separateurs Windows", () => {
    assert.equal(isSensitiveRepositoryPath(".ENV"), true);
    assert.equal(isSensitiveRepositoryPath("Certs\\Server.PEM"), true);
    assert.equal(isSensitiveRepositoryPath("apps\\web\\.env.local"), true);
  });

  it("laisse les fichiers ordinaires visibles", () => {
    assert.equal(isSensitiveRepositoryPath("README.md"), false);
    assert.equal(isSensitiveRepositoryPath("apps/web/lib/runs.ts"), false);
    // Le mot « key » dans un nom ne suffit pas : seule l'extension compte.
    assert.equal(isSensitiveRepositoryPath("src/keyboard.ts"), false);
    assert.equal(isSensitiveRepositoryPath("docs/environment.md"), false);
  });

  it("traite une chaine vide comme non sensible", () => {
    assert.equal(isSensitiveRepositoryPath(""), false);
    assert.equal(isSensitiveRepositoryPath("   "), false);
  });
});

describe("summarizeRunValidations", () => {
  it("rend NONE quand aucune commande n'etait attendue", () => {
    assert.equal(summarizeRunValidations([]), RUN_VALIDATION_SUMMARY.NONE);
  });

  it("rend PASSED quand toutes ont reussi", () => {
    assert.equal(
      summarizeRunValidations(statuses(RUN_VALIDATION_STATUS.PASSED, RUN_VALIDATION_STATUS.PASSED)),
      RUN_VALIDATION_SUMMARY.PASSED,
    );
  });

  it("rend FAILED des qu'une seule echoue", () => {
    assert.equal(
      summarizeRunValidations(statuses(RUN_VALIDATION_STATUS.PASSED, RUN_VALIDATION_STATUS.FAILED)),
      RUN_VALIDATION_SUMMARY.FAILED,
    );
  });

  it("fait primer l'echec sur l'incertitude et sur l'inachevement", () => {
    assert.equal(
      summarizeRunValidations(
        statuses(
          RUN_VALIDATION_STATUS.NOT_RUN,
          RUN_VALIDATION_STATUS.UNKNOWN,
          RUN_VALIDATION_STATUS.FAILED,
        ),
      ),
      RUN_VALIDATION_SUMMARY.FAILED,
    );
  });

  it("rend INCOMPLETE quand une commande n'a pas ete lancee", () => {
    assert.equal(
      summarizeRunValidations(statuses(RUN_VALIDATION_STATUS.PASSED, RUN_VALIDATION_STATUS.NOT_RUN)),
      RUN_VALIDATION_SUMMARY.INCOMPLETE,
    );
  });

  it("rend INCOMPLETE quand une commande tourne encore", () => {
    assert.equal(
      summarizeRunValidations(statuses(RUN_VALIDATION_STATUS.RUNNING)),
      RUN_VALIDATION_SUMMARY.INCOMPLETE,
    );
  });

  it("fait primer l'inachevement sur l'incertitude", () => {
    assert.equal(
      summarizeRunValidations(statuses(RUN_VALIDATION_STATUS.UNKNOWN, RUN_VALIDATION_STATUS.NOT_RUN)),
      RUN_VALIDATION_SUMMARY.INCOMPLETE,
    );
  });

  it("rend UNKNOWN quand rien n'echoue mais qu'un resultat est illisible", () => {
    assert.equal(
      summarizeRunValidations(statuses(RUN_VALIDATION_STATUS.PASSED, RUN_VALIDATION_STATUS.UNKNOWN)),
      RUN_VALIDATION_SUMMARY.UNKNOWN,
    );
  });
});

describe("totalRunReview", () => {
  it("additionne ce qui est comptable et compte ce qui ne l'est pas", () => {
    const totals = totalRunReview([
      fileChange({ additions: 10, deletions: 2 }),
      fileChange({ path: ".env", additions: 1, deletions: 1, isSensitive: true, patch: null }),
      fileChange({ path: "logo.png", additions: null, deletions: null, isBinary: true, patch: null }),
      fileChange({ path: "huge.txt", additions: 9_000, deletions: 0, isTruncated: true }),
    ]);

    assert.deepEqual(totals, {
      files: 4,
      additions: 9_011,
      deletions: 3,
      sensitive: 1,
      binary: 1,
      truncated: 1,
    });
  });

  it("rend des totaux nuls pour une review vide", () => {
    assert.deepEqual(totalRunReview([]), {
      files: 0,
      additions: 0,
      deletions: 0,
      sensitive: 0,
      binary: 0,
      truncated: 0,
    });
  });
});

describe("isAbsoluteLikePath", () => {
  it("refuse tout ce qu'un chemin relatif de repository ne peut pas etre", () => {
    assert.equal(isAbsoluteLikePath("/etc/passwd"), true);
    assert.equal(isAbsoluteLikePath("C:/Windows/System32"), true);
    assert.equal(isAbsoluteLikePath("D:\\Projets\\nox\\README.md"), true);
    assert.equal(isAbsoluteLikePath("\\\\serveur\\partage"), true);
    assert.equal(isAbsoluteLikePath("../secrets.json"), true);
    assert.equal(isAbsoluteLikePath("apps/../../etc/passwd"), true);
  });

  it("accepte un chemin relatif ordinaire", () => {
    assert.equal(isAbsoluteLikePath("README.md"), false);
    assert.equal(isAbsoluteLikePath("apps/web/lib/runs.ts"), false);
    // Un `..` a l'interieur d'un nom n'est pas une remontee.
    assert.equal(isAbsoluteLikePath("docs/notes..md"), false);
  });
});

describe("isRunFileChange", () => {
  it("accepte un changement conforme", () => {
    assert.equal(isRunFileChange(fileChange()), true);
  });

  it("refuse un chemin absolu, plutot que de le corriger", () => {
    assert.equal(isRunFileChange(fileChange({ path: "D:\\Projets\\nox\\README.md" })), false);
    assert.equal(isRunFileChange(fileChange({ previousPath: "/etc/passwd" })), false);
  });

  it("refuse un chemin demesure", () => {
    assert.equal(isRunFileChange(fileChange({ path: "a".repeat(REVIEW_LIMITS.path + 1) })), false);
  });

  it("refuse un type de changement inconnu", () => {
    assert.equal(isRunFileChange({ ...fileChange(), changeType: "REWRITTEN" }), false);
  });

  it("refuse un champ de mauvais type", () => {
    assert.equal(isRunFileChange({ ...fileChange(), isBinary: "oui" }), false);
    assert.equal(isRunFileChange({ ...fileChange(), additions: 1.5 }), false);
    assert.equal(isRunFileChange({ ...fileChange(), patch: 42 }), false);
  });

  it("accepte un patch absent et des compteurs absents", () => {
    assert.equal(
      isRunFileChange(fileChange({ patch: null, additions: null, deletions: null })),
      true,
    );
  });

  it("refuse ce qui n'est pas un objet", () => {
    assert.equal(isRunFileChange(null), false);
    assert.equal(isRunFileChange([fileChange()]), false);
    assert.equal(isRunFileChange("apps/web/lib/runs.ts"), false);
  });
});

describe("isRunValidationResultView", () => {
  const result = {
    position: 0,
    command: "npm run test",
    status: RUN_VALIDATION_STATUS.PASSED,
    exitCode: 0,
    summary: null,
    startedAt: null,
    finishedAt: null,
  };

  it("accepte un resultat conforme", () => {
    assert.equal(isRunValidationResultView(result), true);
  });

  it("refuse un statut inconnu", () => {
    assert.equal(isRunValidationResultView({ ...result, status: "SKIPPED" }), false);
  });

  it("refuse un code de sortie fractionnaire", () => {
    assert.equal(isRunValidationResultView({ ...result, exitCode: 0.5 }), false);
  });
});

describe("isRunReviewSnapshot", () => {
  const snapshot = {
    capturedAt: "2026-08-07T10:00:00.000Z",
    headBefore: "a".repeat(40),
    unreliable: false,
    files: [fileChange()],
    omittedFiles: 0,
    validations: [],
  };

  it("accepte un instantane conforme", () => {
    assert.equal(isRunReviewSnapshot(snapshot), true);
  });

  it("accepte un instantane sans aucun changement", () => {
    assert.equal(isRunReviewSnapshot({ ...snapshot, files: [] }), true);
  });

  it("rejette l'instantane entier des qu'un seul fichier est hors contrat", () => {
    assert.equal(
      isRunReviewSnapshot({
        ...snapshot,
        files: [fileChange(), fileChange({ path: "C:/Windows/win.ini" })],
      }),
      false,
    );
  });

  it("refuse un nombre de fichiers omis absent ou fractionnaire", () => {
    assert.equal(isRunReviewSnapshot({ ...snapshot, omittedFiles: undefined }), false);
    assert.equal(isRunReviewSnapshot({ ...snapshot, omittedFiles: 1.5 }), false);
  });
});
