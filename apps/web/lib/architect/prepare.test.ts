/**
 * Tests de la preparation d'une generation.
 *
 * Le prompt affiche a l'utilisateur et le prompt envoye au fournisseur sont
 * **le meme objet**. Cette suite verifie donc surtout ce qui n'y figure pas :
 * aucun chemin absolu, aucune cle, aucun contenu hors de la liste fermee.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ARCHITECT_PROMPT_VERSION } from "@nox/shared";

import { architectInputHash, prepareArchitectGeneration, type PrepareArchitectInput } from "./prepare.ts";

const ROOT = "D:/Projets/Dev/nox";

const ENVIRONMENT: Record<string, string | undefined> = {
  NOX_OPENAI_API_KEY: "cle-architecte-de-test-9876543210",
  NOX_RUNNER_TOKEN: "jeton-runner-de-test-0123456789",
};

const BASE: PrepareArchitectInput = {
  projectName: "NOX",
  repositoryPath: ROOT,
  documents: [
    {
      path: "CLAUDE.md",
      revision: "a".repeat(64),
      content: "# Regles\n\nLe repository vit dans D:/Projets/Dev/nox/apps.",
    },
  ],
  inventory: [
    {
      path: "docs/ARCHITECTURE.md",
      name: "ARCHITECTURE.md",
      category: "DOCUMENTATION",
      size: 10,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  tasks: [],
  memories: [],
  transcript: [],
  newMessage: "Je veux exporter les taches en JSON.",
  model: "modele-de-test",
  environment: ENVIRONMENT,
};

function prepare(overrides: Partial<PrepareArchitectInput> = {}) {
  return prepareArchitectGeneration({ ...BASE, ...overrides });
}

describe("prepareArchitectGeneration", () => {
  it("assemble contexte, prompt et empreinte", () => {
    const prepared = prepare();

    assert.equal(prepared.prompt.version, ARCHITECT_PROMPT_VERSION);
    assert.ok(prepared.prompt.input.includes("Je veux exporter les taches en JSON."));
    assert.deepEqual(prepared.availableDocuments, ["docs/ARCHITECTURE.md"]);
    assert.match(prepared.inputHash, /^[0-9a-f]{64}$/u);
  });

  it("nettoie le contenu des documents", () => {
    const prepared = prepare();

    assert.equal(prepared.prompt.input.includes("D:/Projets/Dev/nox"), false);
    assert.ok(prepared.prompt.input.includes("apps"));
  });

  it("nettoie aussi le message de l'utilisateur", () => {
    const prepared = prepare({
      newMessage: `Corrige D:/Projets/Dev/nox/apps/web et la cle ${ENVIRONMENT["NOX_OPENAI_API_KEY"] ?? ""}`,
    });

    assert.equal(prepared.prompt.input.includes("D:/Projets/Dev/nox"), false);
    assert.equal(prepared.prompt.input.includes("cle-architecte-de-test-9876543210"), false);
  });

  it("nettoie aussi le transcript", () => {
    // Une reponse d'architecte a ete produite a partir d'un contexte, et un
    // modele recopie ce qu'il lit : elle traverse la meme sanitation.
    const prepared = prepare({
      transcript: [
        { role: "USER", content: "Voir C:/Users/theo/secret.txt" },
        { role: "ARCHITECT", content: "Le depot est dans D:/Projets/Dev/nox." },
      ],
    });
    assert.equal(prepared.prompt.input.includes("C:/Users"), false);
    assert.equal(prepared.prompt.input.includes("D:/Projets/Dev/nox"), false);
  });

  it("ne laisse jamais la cle atteindre le prompt", () => {
    const prepared = prepare();
    const serialized = JSON.stringify(prepared);

    assert.equal(serialized.includes("cle-architecte-de-test-9876543210"), false);
    assert.equal(serialized.includes("jeton-runner-de-test-0123456789"), false);
  });

  it("decrit le contexte dans son manifest", () => {
    const prepared = prepare();

    assert.equal(prepared.manifest.sources.length, 1);
    assert.equal(prepared.manifest.sources[0]?.identifier, "CLAUDE.md");
    assert.ok(prepared.manifest.missing.includes("docs/DECISIONS.md"));
  });

  it("ne stocke aucun contenu dans le manifest", () => {
    const prepared = prepare();
    const serialized = JSON.stringify(prepared.manifest);

    assert.equal(serialized.includes("Le repository vit dans"), false);
    assert.equal(serialized.includes("# Regles"), false);
  });
});

describe("architectInputHash", () => {
  const manifest = { schemaVersion: 1 as const, sources: [], totalChars: 0, missing: [] };

  function hash(overrides: Partial<Parameters<typeof architectInputHash>[0]> = {}): string {
    return architectInputHash({
      promptVersion: "architect/1",
      model: "modele",
      instructions: "regles",
      input: "contexte",
      manifest,
      ...overrides,
    });
  }

  it("est deterministe", () => {
    assert.equal(hash(), hash());
  });

  it("change avec le modele", () => {
    assert.notEqual(hash(), hash({ model: "autre-modele" }));
  });

  it("change avec la version du prompt", () => {
    assert.notEqual(hash(), hash({ promptVersion: "architect/2" }));
  });

  it("change avec le contexte", () => {
    assert.notEqual(hash(), hash({ input: "contexte different" }));
  });

  it("change avec le manifest", () => {
    assert.notEqual(
      hash(),
      hash({ manifest: { schemaVersion: 1, sources: [], totalChars: 12, missing: [] } }),
    );
  });

  it("ne confond pas deux decoupages differents", () => {
    // Chaque champ est precede de sa longueur : sans cela, deplacer une
    // frontiere entre deux champs produirait la meme empreinte.
    assert.notEqual(
      hash({ instructions: "ab", input: "c" }),
      hash({ instructions: "a", input: "bc" }),
    );
  });

  it("suit la preparation complete", () => {
    const first = prepare();
    const second = prepare({ newMessage: "Une demande differente." });
    assert.notEqual(first.inputHash, second.inputHash);
  });
});
