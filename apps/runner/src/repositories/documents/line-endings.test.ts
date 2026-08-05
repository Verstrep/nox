import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { alignLineEndings, detectLineEnding, toLineFeed } from "./line-endings.ts";

describe("toLineFeed", () => {
  it("ramene CRLF, CR isole et LF a LF", () => {
    assert.equal(toLineFeed("a\r\nb\rc\nd"), "a\nb\nc\nd");
  });

  it("laisse un contenu sans fin de ligne intact", () => {
    assert.equal(toLineFeed("une seule ligne"), "une seule ligne");
  });

  it("laisse un contenu vide intact", () => {
    assert.equal(toLineFeed(""), "");
  });
});

describe("detectLineEnding", () => {
  it("reconnait un document en LF", () => {
    assert.equal(detectLineEnding("a\nb\nc\n"), "\n");
  });

  it("reconnait un document en CRLF", () => {
    assert.equal(detectLineEnding("a\r\nb\r\nc\r\n"), "\r\n");
  });

  it("ne deduit rien d'un document sans fin de ligne", () => {
    assert.equal(detectLineEnding("une seule ligne"), null);
    assert.equal(detectLineEnding(""), null);
  });

  it("tranche par la convention majoritaire d'un document mixte", () => {
    assert.equal(detectLineEnding("a\r\nb\r\nc\n"), "\r\n");
    assert.equal(detectLineEnding("a\r\nb\nc\n"), "\n");
  });

  it("preferе LF a egalite", () => {
    assert.equal(detectLineEnding("a\r\nb\n"), "\n");
  });
});

describe("alignLineEndings", () => {
  it("convertit le contenu soumis vers LF quand le document est en LF", () => {
    // Cas reel : le navigateur soumet toujours du CRLF.
    assert.equal(alignLineEndings("a\r\nb\r\n", "x\ny\n"), "a\nb\n");
  });

  it("convertit le contenu soumis vers CRLF quand le document est en CRLF", () => {
    assert.equal(alignLineEndings("a\nb\n", "x\r\ny\r\n"), "a\r\nb\r\n");
  });

  it("n'introduit pas de CRLF dans un document sans fin de ligne", () => {
    assert.equal(alignLineEndings("a\r\nb", "une seule ligne"), "a\nb");
  });

  it("ne double jamais les retours chariot", () => {
    assert.equal(alignLineEndings("a\r\nb\r\n", "x\r\n"), "a\r\nb\r\n");
  });

  it("laisse un contenu vide vide", () => {
    assert.equal(alignLineEndings("", "x\r\n"), "");
  });

  it("ne touche a rien d'autre que les fins de ligne", () => {
    const content = "# Étude\n\nTexte — avec tirets, accents et 🎯.";
    assert.equal(alignLineEndings(content, "x\ny\n"), content);
  });
});
