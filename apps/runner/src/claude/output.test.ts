import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectUsageLimit, extractJsonPayload, parseClaudeOutput } from "./output.ts";

const SUCCESS = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "Travail termine.",
  session_id: "session-abc",
  duration_ms: 4200,
  duration_api_ms: 3100,
  num_turns: 5,
  total_cost_usd: 0.0731,
});

describe("extractJsonPayload", () => {
  it("lit un objet seul sur la sortie", () => {
    assert.deepEqual(extractJsonPayload('{"a":1}'), { a: 1 });
  });

  it("ignore les lignes qui precedent l'objet", () => {
    const stdout = 'Avertissement quelconque\n{"a":1}';
    assert.deepEqual(extractJsonPayload(stdout), { a: 1 });
  });

  it("retient le dernier objet lorsqu'il y en a plusieurs", () => {
    // Le resultat final vient apres le reste.
    const stdout = '{"etape":1}\n{"etape":2}';
    assert.deepEqual(extractJsonPayload(stdout), { etape: 2 });
  });

  it("retourne undefined sur une sortie vide ou non JSON", () => {
    assert.equal(extractJsonPayload(""), undefined);
    assert.equal(extractJsonPayload("   \n  "), undefined);
    assert.equal(extractJsonPayload("pas du json du tout"), undefined);
  });
});

describe("parseClaudeOutput", () => {
  it("lit tous les champs disponibles", () => {
    const parsed = parseClaudeOutput(SUCCESS);

    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.equal(parsed.result.subtype, "success");
    assert.equal(parsed.result.isError, false);
    assert.equal(parsed.result.result, "Travail termine.");
    assert.equal(parsed.result.sessionId, "session-abc");
    assert.equal(parsed.result.durationMs, 4200);
    assert.equal(parsed.result.numTurns, 5);
    assert.equal(parsed.result.totalCostUsd, 0.0731);
  });

  it("n'exige aucun champ : une version qui en fournit moins reste lisible", () => {
    const parsed = parseClaudeOutput(JSON.stringify({ result: "Fait." }));

    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.equal(parsed.result.result, "Fait.");
    // Les champs absents restent absents : rien n'est invente.
    assert.equal(parsed.result.totalCostUsd, null);
    assert.equal(parsed.result.sessionId, null);
    assert.equal(parsed.result.numTurns, null);
  });

  it("ignore un champ du mauvais type plutot que de le convertir", () => {
    const parsed = parseClaudeOutput(JSON.stringify({ num_turns: "beaucoup", total_cost_usd: null }));

    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.equal(parsed.result.numTurns, null);
    assert.equal(parsed.result.totalCostUsd, null);
  });

  it("refuse une sortie qui n'est pas du JSON", () => {
    assert.equal(parseClaudeOutput("Erreur fatale de l'outil").ok, false);
    assert.equal(parseClaudeOutput("").ok, false);
  });

  it("refuse un JSON qui n'est pas un objet", () => {
    assert.equal(parseClaudeOutput("[1,2,3]").ok, false);
    assert.equal(parseClaudeOutput('"texte"').ok, false);
  });
});

describe("detectUsageLimit", () => {
  const parsedOf = (stdout: string) => {
    const parsed = parseClaudeOutput(stdout);
    return parsed.ok ? parsed.result : null;
  };

  it("detecte une limite annoncee par le sous-type", () => {
    const parsed = parsedOf(JSON.stringify({ subtype: "usage_limit", is_error: true }));

    assert.equal(detectUsageLimit({ parsed, stderrTail: "", exitCode: 1 }), true);
  });

  it("detecte une limite decrite dans un resultat en erreur", () => {
    const parsed = parsedOf(
      JSON.stringify({ is_error: true, result: "Claude API usage limit reached." }),
    );

    assert.equal(detectUsageLimit({ parsed, stderrTail: "", exitCode: 1 }), true);
  });

  it("detecte une limite dans la sortie d'erreur", () => {
    assert.equal(
      detectUsageLimit({
        parsed: null,
        stderrTail: "Error 429: rate limit exceeded for your Anthropic plan",
        exitCode: 1,
      }),
      true,
    );
  });

  it("ne conclut pas sur un marqueur isole sans rattachement a Claude", () => {
    // Un compte rendu qui parle du code de l'utilisateur ne doit pas etre lu
    // comme une limite Claude.
    assert.equal(
      detectUsageLimit({
        parsed: null,
        stderrTail: "TypeError: rate limit middleware not configured in src/server.ts",
        exitCode: 1,
      }),
      false,
    );
  });

  it("ignore un resultat reussi qui mentionne une limite", () => {
    const parsed = parsedOf(
      JSON.stringify({
        is_error: false,
        result: "J'ai implemente le rate limit de l'API Claude comme demande.",
      }),
    );

    assert.equal(detectUsageLimit({ parsed, stderrTail: "", exitCode: 0 }), false);
  });

  it("ne conclut rien sur une sortie vide", () => {
    assert.equal(detectUsageLimit({ parsed: null, stderrTail: "", exitCode: 1 }), false);
    assert.equal(detectUsageLimit({ parsed: null, stderrTail: "   ", exitCode: 0 }), false);
  });

  it("reste insensible a la casse", () => {
    assert.equal(
      detectUsageLimit({
        parsed: null,
        stderrTail: "CLAUDE USAGE LIMIT REACHED",
        exitCode: 1,
      }),
      true,
    );
  });
});
