import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  validateProjectDescription,
  validateProjectName,
} from "./project-input.ts";

describe("validateProjectName", () => {
  it("accepte un nom valide et le normalise", () => {
    const result = validateProjectName("  NOX  ");
    assert.deepEqual(result, { ok: true, name: "NOX" });
  });

  it("accepte les accents et la ponctuation", () => {
    const result = validateProjectName("Générateur de données");
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.name, "Générateur de données");
  });

  it("refuse un nom vide", () => {
    const result = validateProjectName("");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "EMPTY");
  });

  it("refuse un nom compose uniquement d'espaces", () => {
    const result = validateProjectName("   \t  ");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "EMPTY");
  });

  it("refuse un nom trop long", () => {
    const result = validateProjectName("x".repeat(PROJECT_NAME_MAX_LENGTH + 1));
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "TOO_LONG");
  });

  it("accepte un nom a la longueur maximale", () => {
    const result = validateProjectName("x".repeat(PROJECT_NAME_MAX_LENGTH));
    assert.equal(result.ok, true);
  });
});

describe("validateProjectDescription", () => {
  it("transforme une description vide en null", () => {
    assert.deepEqual(validateProjectDescription("   "), { ok: true, description: null });
  });

  it("normalise une description renseignee", () => {
    assert.deepEqual(validateProjectDescription("  Un outil  "), {
      ok: true,
      description: "Un outil",
    });
  });

  it("refuse une description trop longue", () => {
    const result = validateProjectDescription("x".repeat(PROJECT_DESCRIPTION_MAX_LENGTH + 1));
    assert.equal(result.ok, false);
  });
});
