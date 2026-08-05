import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { computeRevision, isValidRevisionFormat, revisionsMatch } from "./revisions.ts";

describe("computeRevision", () => {
  it("produit la meme empreinte pour un contenu identique", () => {
    const first = computeRevision(Buffer.from("# Brief\n"));
    const second = computeRevision(Buffer.from("# Brief\n"));

    assert.equal(first, second);
  });

  it("produit une empreinte differente pour un contenu different", () => {
    const before = computeRevision(Buffer.from("# Brief\n"));
    const after = computeRevision(Buffer.from("# Brief modifie\n"));

    assert.notEqual(before, after);
  });

  it("distingue deux contenus de meme taille", () => {
    // Le cas que `size` ne verrait pas : une modification a taille constante.
    const before = computeRevision(Buffer.from("chat"));
    const after = computeRevision(Buffer.from("chab"));

    assert.notEqual(before, after);
  });

  it("est une empreinte SHA-256 hexadecimale minuscule", () => {
    const revision = computeRevision(Buffer.from("# Brief\n"));

    assert.match(revision, /^[0-9a-f]{64}$/);
    assert.equal(revision, createHash("sha256").update("# Brief\n").digest("hex"));
  });

  it("porte sur les octets, pas sur la chaine decodee", () => {
    // Meme texte, deux encodages d'octets : les revisions doivent differer.
    const withoutBom = computeRevision(Buffer.from("# Brief"));
    const withBom = computeRevision(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# Brief")]));

    assert.notEqual(withoutBom, withBom);
  });

  it("distingue LF et CRLF", () => {
    assert.notEqual(computeRevision(Buffer.from("a\nb")), computeRevision(Buffer.from("a\r\nb")));
  });

  it("accepte un document vide", () => {
    const revision = computeRevision(Buffer.alloc(0));

    assert.match(revision, /^[0-9a-f]{64}$/);
    assert.equal(revision, createHash("sha256").update("").digest("hex"));
  });

  it("preserve les caracteres Unicode", () => {
    const accented = computeRevision(Buffer.from("étude dépôt — naïve", "utf8"));
    const plain = computeRevision(Buffer.from("etude depot — naive", "utf8"));

    assert.match(accented, /^[0-9a-f]{64}$/);
    assert.notEqual(accented, plain);
  });

  it("distingue deux emoji distincts", () => {
    assert.notEqual(
      computeRevision(Buffer.from("🎯", "utf8")),
      computeRevision(Buffer.from("🎨", "utf8")),
    );
  });
});

describe("isValidRevisionFormat", () => {
  it("accepte une empreinte SHA-256 hexadecimale", () => {
    assert.equal(isValidRevisionFormat(computeRevision(Buffer.from("x"))), true);
  });

  it("refuse une chaine vide, trop courte, trop longue ou majuscule", () => {
    for (const value of ["", "abc", "a".repeat(63), "a".repeat(65), "A".repeat(64)]) {
      assert.equal(isValidRevisionFormat(value), false, JSON.stringify(value));
    }
  });

  it("refuse un caractere hors de l'alphabet hexadecimal", () => {
    assert.equal(isValidRevisionFormat(`${"a".repeat(63)}z`), false);
  });
});

describe("revisionsMatch", () => {
  it("reconnait deux revisions identiques", () => {
    const revision = computeRevision(Buffer.from("# Brief\n"));
    assert.equal(revisionsMatch(revision, revision), true);
  });

  it("distingue deux revisions differentes", () => {
    assert.equal(
      revisionsMatch(computeRevision(Buffer.from("a")), computeRevision(Buffer.from("b"))),
      false,
    );
  });
});
