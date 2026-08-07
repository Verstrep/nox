/**
 * Tests du decoupage en lignes.
 *
 * Le tampon est le composant le plus bete de la chaine, et celui dont un defaut
 * serait le plus difficile a diagnostiquer : une ligne mal recollee produit un
 * JSON invalide, donc un evenement perdu, sans aucune trace de la cause.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LineBuffer } from "./line-buffer.ts";

describe("LineBuffer", () => {
  it("rend une ligne complete", () => {
    const buffer = new LineBuffer(1_000);
    assert.deepEqual(buffer.push("premiere\n").lines, ["premiere"]);
  });

  it("rend plusieurs lignes d'un seul morceau", () => {
    const buffer = new LineBuffer(1_000);
    assert.deepEqual(buffer.push("a\nb\nc\n").lines, ["a", "b", "c"]);
  });

  it("conserve un reste incomplet jusqu'au morceau suivant", () => {
    const buffer = new LineBuffer(1_000);
    assert.deepEqual(buffer.push('{"type":').lines, []);
    assert.deepEqual(buffer.push('"result"').lines, []);
    assert.deepEqual(buffer.push("}\n").lines, ['{"type":"result"}']);
  });

  it("recolle une ligne coupee en de nombreux morceaux", () => {
    const buffer = new LineBuffer(1_000);
    const line = "x".repeat(300);

    for (const character of line) {
      assert.deepEqual(buffer.push(character).lines, []);
    }

    assert.deepEqual(buffer.push("\n").lines, [line]);
  });

  it("traite CRLF comme LF", () => {
    const buffer = new LineBuffer(1_000);
    assert.deepEqual(buffer.push("a\r\nb\r\n").lines, ["a", "b"]);
  });

  it("melange CRLF et LF dans le meme morceau", () => {
    const buffer = new LineBuffer(1_000);
    assert.deepEqual(buffer.push("a\r\nb\nc\r\n").lines, ["a", "b", "c"]);
  });

  it("rend la derniere ligne sans retour a la ligne, au flush", () => {
    const buffer = new LineBuffer(1_000);
    assert.deepEqual(buffer.push("sans terminateur").lines, []);
    assert.deepEqual(buffer.flush().lines, ["sans terminateur"]);
  });

  it("ne rend rien au flush si tout a deja ete consomme", () => {
    const buffer = new LineBuffer(1_000);
    buffer.push("a\n");
    assert.deepEqual(buffer.flush().lines, []);
  });

  it("ignore les lignes vides", () => {
    const buffer = new LineBuffer(1_000);
    assert.deepEqual(buffer.push("a\n\n\nb\n").lines, ["a", "b"]);
  });

  it("jette une ligne trop longue et le signale", () => {
    const buffer = new LineBuffer(10);
    const result = buffer.push(`${"x".repeat(50)}\n`);

    assert.deepEqual(result.lines, []);
    assert.equal(result.dropped, 1);
    assert.equal(buffer.droppedLines, 1);
  });

  it("reprend normalement apres une ligne jetee", () => {
    const buffer = new LineBuffer(10);
    buffer.push(`${"x".repeat(50)}\n`);

    // La ligne suivante doit repartir proprement, sans etre polluee par les
    // octets abandonnes.
    assert.deepEqual(buffer.push("ok\n").lines, ["ok"]);
  });

  it("cesse de retenir une ligne demesuree avant meme son terminateur", () => {
    const buffer = new LineBuffer(10);

    // Aucun retour a la ligne : sans la borne, la memoire grandirait sans fin.
    assert.equal(buffer.push("y".repeat(5_000)).dropped, 1);
    assert.equal(buffer.push("y".repeat(5_000)).dropped, 0);

    // Puis le flux redevient exploitable.
    assert.deepEqual(buffer.push("\nsuite\n").lines, ["suite"]);
  });

  it("ne rend rien pour un morceau vide", () => {
    const buffer = new LineBuffer(1_000);
    assert.deepEqual(buffer.push("").lines, []);
  });

  it("preserve les caracteres Unicode", () => {
    const buffer = new LineBuffer(1_000);
    assert.deepEqual(buffer.push("Éléphant 🐘 你好\n").lines, ["Éléphant 🐘 你好"]);
  });
});
