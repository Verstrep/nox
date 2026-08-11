/**
 * Tests du contrat de review Architecte.
 *
 * Deux questions y sont posees, et elles sont distinctes :
 *
 * 1. **La reponse du modele est-elle acceptable ?** — `readArchitectReviewOutput`.
 *    Un schema strict garantit une forme, jamais un invariant NOX.
 * 2. **NOX retient-il le verdict propose ?** — `guardArchitectReviewVerdict`.
 *    C'est la question la plus importante du fichier : une approbation fondee
 *    sur ce que personne n'a lu serait le seul resultat vraiment dangereux.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARCHITECT_REVIEW_BLOCKER,
  ARCHITECT_REVIEW_LIMITS,
  ARCHITECT_REVIEW_SCHEMA_VERSION,
  ARCHITECT_REVIEW_SEVERITY,
  ARCHITECT_REVIEW_VERDICT,
  architectCriterionLabel,
  architectReviewBlockers,
  buildArchitectReviewSchema,
  guardArchitectReviewVerdict,
  isArchitectReviewManifest,
  readArchitectReviewOutput,
  type ArchitectReviewBlocker,
  type ArchitectReviewFacts,
} from "../dist/index.js";

const REFERENCES = {
  filePaths: ["src/a.ts", "docs/ARCHITECTURE.md", ".env"],
  criteriaCount: 4,
};

function output(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: ARCHITECT_REVIEW_SCHEMA_VERSION,
    verdict: ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED,
    summary: "Le filtre est en place et les tests passent.",
    findings: [],
    feedback: null,
    ...overrides,
  };
}

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    severity: ARCHITECT_REVIEW_SEVERITY.MINOR,
    title: "Le message d'erreur n'est pas traduit",
    detail: "La chaine reste en anglais dans src/a.ts.",
    filePath: "src/a.ts",
    acceptanceCriterionIndex: 2,
    ...overrides,
  };
}

/** Aucune raison de refuser une approbation : le cas de reference. */
function cleanFacts(overrides: Partial<ArchitectReviewFacts> = {}): ArchitectReviewFacts {
  return {
    runCompleted: true,
    unreliable: false,
    reviewFailed: false,
    sensitiveFiles: 0,
    binaryFiles: 0,
    truncatedPatches: 0,
    omittedFiles: 0,
    architectTruncated: false,
    validationFailed: false,
    validationUnknown: false,
    validationNotRun: false,
    ...overrides,
  };
}

describe("readArchitectReviewOutput", () => {
  it("accepte les trois verdicts", () => {
    for (const verdict of [
      ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED,
      ARCHITECT_REVIEW_VERDICT.HUMAN_REVIEW_REQUIRED,
    ]) {
      const result = readArchitectReviewOutput(output({ verdict }), REFERENCES);
      assert.ok(result.ok);
      assert.equal(result.output.verdict, verdict);
    }

    const changes = readArchitectReviewOutput(
      output({
        verdict: ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED,
        feedback: "Corrige la comparaison de casse.",
      }),
      REFERENCES,
    );
    assert.ok(changes.ok);
    assert.equal(changes.output.verdict, ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED);
  });

  it("refuse un verdict inconnu", () => {
    const result = readArchitectReviewOutput(output({ verdict: "LOOKS_FINE" }), REFERENCES);
    assert.ok(!result.ok);
    assert.equal(result.refusal.field, "verdict");
  });

  it("refuse une version de contrat inattendue", () => {
    const result = readArchitectReviewOutput(output({ schemaVersion: 2 }), REFERENCES);
    assert.ok(!result.ok);
    assert.equal(result.refusal.field, "schemaVersion");
  });

  it("refuse une reponse qui n'est pas une structure", () => {
    for (const value of ["texte", 42, null, [], undefined]) {
      const result = readArchitectReviewOutput(value, REFERENCES);
      assert.ok(!result.ok);
    }
  });

  it("refuse un resume vide ou trop long", () => {
    assert.ok(!readArchitectReviewOutput(output({ summary: "   " }), REFERENCES).ok);
    assert.ok(
      !readArchitectReviewOutput(
        output({ summary: "x".repeat(ARCHITECT_REVIEW_LIMITS.summary + 1) }),
        REFERENCES,
      ).ok,
    );
  });

  it("accepte les quatre gravites", () => {
    for (const severity of Object.values(ARCHITECT_REVIEW_SEVERITY)) {
      const verdict =
        severity === ARCHITECT_REVIEW_SEVERITY.BLOCKER
          ? {
              verdict: ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED,
              feedback: "Corrige le critere 2.",
            }
          : {};
      const result = readArchitectReviewOutput(
        output({ findings: [finding({ severity })], ...verdict }),
        REFERENCES,
      );
      assert.ok(result.ok, severity);
      assert.equal(result.output.findings[0]?.severity, severity);
    }
  });

  it("refuse une gravite inconnue", () => {
    const result = readArchitectReviewOutput(
      output({ findings: [finding({ severity: "CRITICAL" })] }),
      REFERENCES,
    );
    assert.ok(!result.ok);
    assert.equal(result.refusal.field, "findings");
  });

  it("refuse plus de vingt observations", () => {
    const findings = Array.from({ length: ARCHITECT_REVIEW_LIMITS.findings + 1 }, (_, index) =>
      finding({ title: `Observation ${String(index)}` }),
    );
    const result = readArchitectReviewOutput(output({ findings }), REFERENCES);
    assert.ok(!result.ok);
    assert.equal(result.refusal.field, "findings");
  });

  it("accepte exactement vingt observations", () => {
    const findings = Array.from({ length: ARCHITECT_REVIEW_LIMITS.findings }, (_, index) =>
      finding({ title: `Observation ${String(index)}` }),
    );
    const result = readArchitectReviewOutput(output({ findings }), REFERENCES);
    assert.ok(result.ok);
    assert.equal(result.output.findings.length, ARCHITECT_REVIEW_LIMITS.findings);
  });

  it("refuse un chemin qui n'appartient pas a la review", () => {
    const result = readArchitectReviewOutput(
      output({ findings: [finding({ filePath: "src/invente.ts" })] }),
      REFERENCES,
    );
    assert.ok(!result.ok);
    assert.match(result.refusal.message, /src\/invente\.ts/u);
  });

  it("accepte un chemin absent : une observation peut ne viser aucun fichier", () => {
    const result = readArchitectReviewOutput(
      output({ findings: [finding({ filePath: null })] }),
      REFERENCES,
    );
    assert.ok(result.ok);
    assert.equal(result.output.findings[0]?.filePath, null);
  });

  it("refuse un critere hors plage", () => {
    for (const index of [0, -1, 5, 99]) {
      const result = readArchitectReviewOutput(
        output({ findings: [finding({ acceptanceCriterionIndex: index })] }),
        REFERENCES,
      );
      assert.ok(!result.ok, String(index));
    }
  });

  it("accepte les criteres de 1 a N : le contrat est 1-based", () => {
    for (const index of [1, 2, 3, 4]) {
      const result = readArchitectReviewOutput(
        output({ findings: [finding({ acceptanceCriterionIndex: index })] }),
        REFERENCES,
      );
      assert.ok(result.ok, String(index));
      assert.equal(result.output.findings[0]?.acceptanceCriterionIndex, index);
    }
  });

  it("refuse un critere qui n'est pas un entier", () => {
    const result = readArchitectReviewOutput(
      output({ findings: [finding({ acceptanceCriterionIndex: 1.5 })] }),
      REFERENCES,
    );
    assert.ok(!result.ok);
  });

  it("refuse des corrections recommandees sans feedback", () => {
    const result = readArchitectReviewOutput(
      output({ verdict: ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED, feedback: null }),
      REFERENCES,
    );
    assert.ok(!result.ok);
    assert.equal(result.refusal.field, "feedback");
  });

  it("refuse une approbation accompagnee d'une observation bloquante", () => {
    const result = readArchitectReviewOutput(
      output({
        verdict: ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED,
        findings: [finding({ severity: ARCHITECT_REVIEW_SEVERITY.BLOCKER })],
      }),
      REFERENCES,
    );
    assert.ok(!result.ok);
    assert.equal(result.refusal.field, "verdict");
  });

  it("ecarte un feedback accompagnant une approbation", () => {
    const result = readArchitectReviewOutput(
      output({
        verdict: ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED,
        feedback: "Rien a corriger, mais voici quand meme du texte.",
      }),
      REFERENCES,
    );
    assert.ok(result.ok);
    assert.equal(result.output.feedback, null);
  });

  it("accepte un feedback avec une review humaine requise", () => {
    const result = readArchitectReviewOutput(
      output({
        verdict: ARCHITECT_REVIEW_VERDICT.HUMAN_REVIEW_REQUIRED,
        feedback: "Verifiez vous-meme le fichier binaire.",
      }),
      REFERENCES,
    );
    assert.ok(result.ok);
    assert.equal(result.output.feedback, "Verifiez vous-meme le fichier binaire.");
  });

  it("refuse un feedback trop long", () => {
    const result = readArchitectReviewOutput(
      output({
        verdict: ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED,
        feedback: "x".repeat(ARCHITECT_REVIEW_LIMITS.feedback + 1),
      }),
      REFERENCES,
    );
    assert.ok(!result.ok);
    assert.equal(result.refusal.field, "feedback");
  });

  it("laisse passer le HTML et l'Unicode sans les interpreter", () => {
    const hostile = "<script>alert(1)</script> — é 漢字 🙂";
    const result = readArchitectReviewOutput(
      output({ summary: hostile, findings: [finding({ detail: hostile })] }),
      REFERENCES,
    );
    assert.ok(result.ok);
    assert.equal(result.output.summary, hostile);
    assert.equal(result.output.findings[0]?.detail, hostile);
  });

  it("normalise les fins de ligne et les marges", () => {
    const result = readArchitectReviewOutput(
      output({ summary: "  Une ligne\r\nUne autre  " }),
      REFERENCES,
    );
    assert.ok(result.ok);
    assert.equal(result.output.summary, "Une ligne\nUne autre");
  });

  it("accepte une review dont aucun fichier n'est reference", () => {
    const result = readArchitectReviewOutput(output(), {
      filePaths: [],
      criteriaCount: 0,
    });
    assert.ok(result.ok);
  });
});

describe("guardArchitectReviewVerdict", () => {
  it("conserve une approbation quand rien ne la contredit", () => {
    const guard = guardArchitectReviewVerdict(
      ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED,
      cleanFacts(),
    );
    assert.equal(guard.finalVerdict, ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED);
    assert.deepEqual(guard.blockers, []);
  });

  it("degrade une approbation des qu'un fait la rend indefendable", () => {
    const cases: [Partial<ArchitectReviewFacts>, ArchitectReviewBlocker][] = [
      [{ runCompleted: false }, ARCHITECT_REVIEW_BLOCKER.RUN_NOT_COMPLETED],
      [{ unreliable: true }, ARCHITECT_REVIEW_BLOCKER.REVIEW_UNRELIABLE],
      [{ reviewFailed: true }, ARCHITECT_REVIEW_BLOCKER.REVIEW_ERROR],
      [{ sensitiveFiles: 1 }, ARCHITECT_REVIEW_BLOCKER.SENSITIVE_FILE],
      [{ binaryFiles: 1 }, ARCHITECT_REVIEW_BLOCKER.BINARY_FILE],
      [{ truncatedPatches: 1 }, ARCHITECT_REVIEW_BLOCKER.TRUNCATED_PATCH],
      [{ omittedFiles: 3 }, ARCHITECT_REVIEW_BLOCKER.OMITTED_FILES],
      [{ architectTruncated: true }, ARCHITECT_REVIEW_BLOCKER.ARCHITECT_TRUNCATED],
      [{ validationFailed: true }, ARCHITECT_REVIEW_BLOCKER.VALIDATION_FAILED],
      [{ validationUnknown: true }, ARCHITECT_REVIEW_BLOCKER.VALIDATION_UNKNOWN],
      [{ validationNotRun: true }, ARCHITECT_REVIEW_BLOCKER.VALIDATION_NOT_RUN],
    ];

    for (const [overrides, blocker] of cases) {
      const guard = guardArchitectReviewVerdict(
        ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED,
        cleanFacts(overrides),
      );
      assert.equal(guard.finalVerdict, ARCHITECT_REVIEW_VERDICT.HUMAN_REVIEW_REQUIRED, blocker);
      assert.ok(guard.blockers.includes(blocker), blocker);
      // Le verdict du modele n'est jamais reecrit : l'histoire reste lisible.
      assert.equal(guard.providerVerdict, ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED);
    }
  });

  it("conserve des corrections recommandees malgre un fait bloquant", () => {
    const guard = guardArchitectReviewVerdict(
      ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED,
      cleanFacts({ binaryFiles: 1, sensitiveFiles: 1 }),
    );
    assert.equal(guard.finalVerdict, ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED);
    assert.equal(guard.blockers.length, 2);
  });

  it("conserve une review humaine requise", () => {
    const guard = guardArchitectReviewVerdict(
      ARCHITECT_REVIEW_VERDICT.HUMAN_REVIEW_REQUIRED,
      cleanFacts(),
    );
    assert.equal(guard.finalVerdict, ARCHITECT_REVIEW_VERDICT.HUMAN_REVIEW_REQUIRED);
  });

  it("ne bloque pas une tache sans aucune commande de validation", () => {
    // « Aucune validation configuree » n'est pas un fait bloquant : c'est un
    // choix legitime, et le transformer en echec fictif apprendrait a ignorer
    // le verdict.
    const guard = guardArchitectReviewVerdict(
      ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED,
      cleanFacts(),
    );
    assert.equal(guard.finalVerdict, ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED);
  });

  it("recense tous les faits bloquants, pas seulement le premier", () => {
    const blockers = architectReviewBlockers(
      cleanFacts({ runCompleted: false, binaryFiles: 2, validationFailed: true }),
    );
    assert.equal(blockers.length, 3);
  });
});

describe("buildArchitectReviewSchema", () => {
  const schema = buildArchitectReviewSchema();

  it("declare tous les champs comme requis, et interdit les proprietes libres", () => {
    assert.equal(schema["additionalProperties"], false);
    assert.deepEqual(schema["required"], [
      "schemaVersion",
      "verdict",
      "summary",
      "findings",
      "feedback",
    ]);
  });

  it("ne declare aucune borne de taille : le mode strict les refuse", () => {
    const serialized = JSON.stringify(schema);
    for (const keyword of ["maxItems", "minItems", "maxLength", "minLength", "pattern"]) {
      assert.ok(!serialized.includes(keyword), keyword);
    }
  });

  it("enumere exactement les trois verdicts et les quatre gravites", () => {
    const properties = schema["properties"] as Record<string, Record<string, unknown>>;
    const verdict = properties["verdict"] as { enum: string[] };
    assert.equal(verdict.enum.length, 3);

    const findings = properties["findings"] as { items: Record<string, unknown> };
    const items = findings.items["properties"] as Record<string, { enum?: string[] }>;
    assert.equal(items["severity"]?.enum?.length, 4);
  });
});

describe("architectCriterionLabel", () => {
  it("numerote a partir de 1", () => {
    assert.equal(architectCriterionLabel(1), "AC1");
    assert.equal(architectCriterionLabel(12), "AC12");
  });
});

describe("isArchitectReviewManifest", () => {
  const manifest = {
    schemaVersion: ARCHITECT_REVIEW_SCHEMA_VERSION,
    runId: "run-1",
    runCode: "RUN-001",
    taskRevision: "a".repeat(64),
    reviewCapturedAt: "2026-08-11T09:00:00.000Z",
    fileCountAvailable: 12,
    fileCountIncluded: 12,
    patchCharsIncluded: 4_096,
    truncated: false,
    validationCount: 2,
  };

  it("accepte un manifest complet", () => {
    assert.ok(isArchitectReviewManifest(manifest));
  });

  it("refuse un manifest incomplet ou d'une autre version", () => {
    assert.ok(!isArchitectReviewManifest({ ...manifest, schemaVersion: 2 }));
    assert.ok(!isArchitectReviewManifest({ ...manifest, fileCountIncluded: -1 }));
    assert.ok(!isArchitectReviewManifest({ ...manifest, truncated: "non" }));
    assert.ok(!isArchitectReviewManifest(null));
  });
});
