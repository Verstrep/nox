import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findUnportableSegment, isPortableSegment } from "./document-names.ts";

describe("isPortableSegment - noms acceptes", () => {
  it("accepte un nom simple", () => {
    assert.equal(isPortableSegment("PRODUCT_VISION.md"), true);
  });

  it("accepte tirets, underscores et chiffres", () => {
    assert.equal(isPortableSegment("ADR-003_runner-2.md"), true);
  });

  it("accepte les espaces internes", () => {
    assert.equal(isPortableSegment("note de cadrage.md"), true);
  });

  it("accepte les accents et la cedille", () => {
    assert.equal(isPortableSegment("étude détaillée.md"), true);
    assert.equal(isPortableSegment("décisions françaises.md"), true);
  });

  it("accepte les parentheses", () => {
    assert.equal(isPortableSegment("plan (v2).md"), true);
  });

  it("accepte un nom de dossier sans extension", () => {
    assert.equal(isPortableSegment("guides"), true);
  });

  it("accepte un nom commencant par un point", () => {
    // Un fichier masque reste un nom valide ; l'emplacement autorise est une
    // autre question, tranchee ailleurs.
    assert.equal(isPortableSegment(".NOTES.md"), true);
  });
});

describe("isPortableSegment - noms refuses", () => {
  it("refuse un segment vide", () => {
    assert.equal(isPortableSegment(""), false);
  });

  it("refuse les segments relatifs", () => {
    assert.equal(isPortableSegment("."), false);
    assert.equal(isPortableSegment(".."), false);
  });

  it("refuse les caracteres interdits sous Windows", () => {
    for (const segment of [
      "note<.md",
      "note>.md",
      "note:.md",
      'note".md',
      "note|.md",
      "note?.md",
      "note*.md",
    ]) {
      assert.equal(isPortableSegment(segment), false, segment);
    }
  });

  it("refuse un separateur a l'interieur d'un segment", () => {
    assert.equal(isPortableSegment("dossier/fichier.md"), false);
    assert.equal(isPortableSegment("dossier\\fichier.md"), false);
  });

  it("refuse l'octet nul et les caracteres de controle", () => {
    assert.equal(isPortableSegment("note\u0000.md"), false);
    assert.equal(isPortableSegment("note\u0001.md"), false);
    assert.equal(isPortableSegment("note\u007f.md"), false);
  });

  it("refuse un espace ou un point final", () => {
    // Windows les tronque en silence : le fichier cree ne porterait pas le nom
    // demande.
    assert.equal(isPortableSegment("note.md "), false);
    assert.equal(isPortableSegment("note.md."), false);
    assert.equal(isPortableSegment("dossier."), false);
  });

  it("refuse un espace initial", () => {
    assert.equal(isPortableSegment(" note.md"), false);
  });

  it("refuse les noms de peripheriques Windows, avec ou sans extension", () => {
    for (const segment of ["CON", "con.md", "PRN.md", "aux.md", "NUL.md", "COM1.md", "lpt9.md"]) {
      assert.equal(isPortableSegment(segment), false, segment);
    }
  });

  it("accepte un nom qui contient seulement un nom reserve", () => {
    // `CONTEXTE` n'est pas `CON` : la comparaison porte sur la base entiere.
    assert.equal(isPortableSegment("CONTEXTE.md"), true);
    assert.equal(isPortableSegment("COM10.md"), true);
  });
});

describe("findUnportableSegment", () => {
  it("ne signale rien sur un chemin valide", () => {
    assert.equal(findUnportableSegment("docs/guides/INSTALLATION.md"), null);
  });

  it("signale le premier segment fautif", () => {
    assert.equal(findUnportableSegment("docs/CON/NOTE.md"), "CON");
  });

  it("inspecte aussi le nom du fichier", () => {
    assert.equal(findUnportableSegment("docs/guides/note?.md"), "note?.md");
  });

  it("accepte un chemin racine", () => {
    assert.equal(findUnportableSegment("README.md"), null);
  });
});
