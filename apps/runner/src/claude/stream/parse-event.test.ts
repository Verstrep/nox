/**
 * Tests de la lecture d'une ligne NDJSON.
 *
 * L'essentiel tient en une phrase : seul un **objet** JSON est accepte, et un
 * refus dit toujours pourquoi — sans jamais renvoyer la ligne elle-meme, qui
 * peut contenir un fichier entier ou un secret.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isFinalResultMessage, parseStreamLine } from "./parse-event.ts";

describe("parseStreamLine", () => {
  it("accepte un objet JSON", () => {
    const parsed = parseStreamLine('{"type":"assistant","n":1}');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.message["type"], "assistant");
  });

  it("refuse un JSON invalide", () => {
    const parsed = parseStreamLine("{ pas du json");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.reason, "invalid_json");
  });

  it("refuse un tableau", () => {
    const parsed = parseStreamLine("[1,2,3]");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.reason, "array");
  });

  it("refuse une primitive numerique", () => {
    const parsed = parseStreamLine("42");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.reason, "primitive");
  });

  it("refuse une primitive textuelle", () => {
    const parsed = parseStreamLine('"bonjour"');
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.reason, "primitive");
  });

  it("refuse null", () => {
    const parsed = parseStreamLine("null");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.reason, "primitive");
  });

  it("rapporte la taille de la ligne, jamais son contenu", () => {
    const secret = '{"contenu":"MOT_DE_PASSE_TRES_SECRET"';
    const parsed = parseStreamLine(secret);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.length, secret.length);
    // Le refus est un objet ferme : il n'a aucun champ ou la ligne pourrait
    // se glisser.
    assert.deepEqual(
      Object.keys(parsed).sort(),
      ["length", "ok", "reason"],
    );
  });

  it("reconnait le message de resultat final", () => {
    const parsed = parseStreamLine('{"type":"result","subtype":"success"}');
    assert.equal(parsed.ok && isFinalResultMessage(parsed.message), true);
  });

  it("ne confond pas un autre message avec le resultat final", () => {
    const parsed = parseStreamLine('{"type":"assistant"}');
    assert.equal(parsed.ok && isFinalResultMessage(parsed.message), false);
  });
});
