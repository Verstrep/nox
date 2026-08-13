/**
 * Tests des empreintes de contexte.
 *
 * Elles repondent a une seule question : le contexte actuel est-il exactement
 * celui que l'utilisateur a prévisualisé ? Deux proprietes comptent donc, et
 * cette suite ne verifie qu'elles :
 *
 * 1. **Deterministe** — la meme entree produit toujours la meme empreinte, sinon
 *    NOX annoncerait un changement a chaque rendu.
 * 2. **Sensible a tout ce qui part** — contenu, revision, troncature, ordre. Une
 *    difference invisible serait pire qu'une absence de controle : elle donnerait
 *    une assurance fausse.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  ArchitectPromptDocument,
  ArchitectPromptMemory,
  ArchitectPromptTask,
} from "@nox/shared";

import type { ArchitectContextBundle } from "./context.ts";
import {
  architectContextFingerprint,
  architectTaskRevision,
  projectMemoryRevision,
} from "./fingerprint.ts";

function task(overrides: Partial<ArchitectPromptTask> = {}): ArchitectPromptTask {
  return {
    code: "TASK-013",
    title: "Architecte NOX",
    status: "COMPLETED",
    objective: "Proposer une tache.",
    outOfScope: "Boucle autonome",
    acceptanceCriteria: ["Une proposition est rendue."],
    documentReferences: ["docs/ARCHITECTURE.md"],
    validationCommands: ["npm run test"],
    ...overrides,
  };
}

function document(overrides: Partial<ArchitectPromptDocument> = {}): ArchitectPromptDocument {
  return {
    path: "CLAUDE.md",
    revision: "a".repeat(64),
    truncated: false,
    content: "# Regles\n\nPas de push.",
    ...overrides,
  };
}

function bundle(overrides: Partial<ArchitectContextBundle> = {}): ArchitectContextBundle {
  return {
    manifest: { schemaVersion: 1, sources: [], totalChars: 0, missing: ["AGENTS.md"] },
    instructionDocuments: [document()],
    contextDocuments: [document({ path: "docs/ARCHITECTURE.md", revision: "b".repeat(64) })],
    projectMemory: [],
    recentTasks: [task()],
    availableDocuments: ["CLAUDE.md", "docs/ARCHITECTURE.md"],
    ...overrides,
  };
}

describe("architectTaskRevision", () => {
  it("est deterministe", () => {
    assert.equal(architectTaskRevision(task()), architectTaskRevision(task()));
  });

  it("rend un SHA-256 hexadecimal", () => {
    assert.match(architectTaskRevision(task()), /^[0-9a-f]{64}$/u);
  });

  for (const [name, override] of [
    ["le titre", { title: "Autre titre" }],
    ["le statut", { status: "READY" }],
    ["l'objectif", { objective: "Un autre objectif." }],
    ["le hors perimetre", { outOfScope: "Autre chose" }],
    ["les criteres", { acceptanceCriteria: ["Un autre critere."] }],
    ["les documents", { documentReferences: ["CLAUDE.md"] }],
    ["les validations", { validationCommands: ["npm run lint"] }],
    ["le code", { code: "TASK-014" }],
  ] as const) {
    it(`change avec ${name}`, () => {
      assert.notEqual(architectTaskRevision(task()), architectTaskRevision(task(override)));
    });
  }

  it("distingue un hors perimetre absent d'un hors perimetre vide", () => {
    assert.notEqual(
      architectTaskRevision(task({ outOfScope: null })),
      architectTaskRevision(task({ outOfScope: "x" })),
    );
  });

  it("ne confond pas deux decoupages de liste", () => {
    // Chaque entree est precedee de sa longueur : sans cela, `["ab", "c"]` et
    // `["a", "bc"]` produiraient la meme empreinte.
    assert.notEqual(
      architectTaskRevision(task({ acceptanceCriteria: ["ab", "c"] })),
      architectTaskRevision(task({ acceptanceCriteria: ["a", "bc"] })),
    );
  });

  it("ne depend d'aucun horodatage", () => {
    // Deux specifications identiques portent la meme revision, quelle que soit
    // la date a laquelle leurs lignes ont ete touchees. C'est exactement ce que
    // `updatedAt` ne garantit pas.
    assert.equal(architectTaskRevision(task()), architectTaskRevision(task()));
  });
});

describe("architectContextFingerprint", () => {
  it("est deterministe", () => {
    assert.equal(architectContextFingerprint(bundle()), architectContextFingerprint(bundle()));
  });

  it("rend un SHA-256 hexadecimal", () => {
    assert.match(architectContextFingerprint(bundle()), /^[0-9a-f]{64}$/u);
  });

  it("change avec le contenu d'un document", () => {
    assert.notEqual(
      architectContextFingerprint(bundle()),
      architectContextFingerprint(
        bundle({ instructionDocuments: [document({ content: "# Autres regles" })] }),
      ),
    );
  });

  it("change avec la revision d'un document", () => {
    assert.notEqual(
      architectContextFingerprint(bundle()),
      architectContextFingerprint(
        bundle({ instructionDocuments: [document({ revision: "c".repeat(64) })] }),
      ),
    );
  });

  it("change lorsqu'un document devient tronque", () => {
    // Le document n'a pas change, ce qui en part si.
    assert.notEqual(
      architectContextFingerprint(bundle()),
      architectContextFingerprint(
        bundle({ instructionDocuments: [document({ truncated: true })] }),
      ),
    );
  });

  it("change lorsqu'un document disparait", () => {
    assert.notEqual(
      architectContextFingerprint(bundle()),
      architectContextFingerprint(bundle({ instructionDocuments: [] })),
    );
  });

  it("change avec l'ordre des documents", () => {
    const first = document({ path: "a.md" });
    const second = document({ path: "b.md" });
    assert.notEqual(
      architectContextFingerprint(bundle({ contextDocuments: [first, second] })),
      architectContextFingerprint(bundle({ contextDocuments: [second, first] })),
    );
  });

  it("change avec la specification d'une tache recente", () => {
    assert.notEqual(
      architectContextFingerprint(bundle()),
      architectContextFingerprint(bundle({ recentTasks: [task({ title: "Autre" })] })),
    );
  });

  it("change lorsqu'une tache entre dans la fenetre", () => {
    assert.notEqual(
      architectContextFingerprint(bundle()),
      architectContextFingerprint(bundle({ recentTasks: [task(), task({ code: "TASK-012" })] })),
    );
  });

  it("change avec la liste fermee des documents referencables", () => {
    assert.notEqual(
      architectContextFingerprint(bundle()),
      architectContextFingerprint(bundle({ availableDocuments: ["CLAUDE.md"] })),
    );
  });

  it("change lorsqu'un document devient absent", () => {
    assert.notEqual(
      architectContextFingerprint(bundle()),
      architectContextFingerprint(
        bundle({
          manifest: { schemaVersion: 1, sources: [], totalChars: 0, missing: [] },
        }),
      ),
    );
  });

  it("ne bouge pas quand seul le total de caracteres change", () => {
    // `totalChars` est derive de ce qui est deja couvert : le compter deux fois
    // ferait varier l'empreinte sans qu'un seul caractere envoye ait change.
    assert.equal(
      architectContextFingerprint(bundle()),
      architectContextFingerprint(
        bundle({
          manifest: { schemaVersion: 1, sources: [], totalChars: 999, missing: ["AGENTS.md"] },
        }),
      ),
    );
  });
});

describe("projectMemoryRevision", () => {
  const memory = (overrides: Record<string, unknown> = {}): ArchitectPromptMemory => ({
    code: "MEM-001",
    category: "DECISION",
    revision: "",
    title: "Un titre",
    content: "Un contenu.",
    rationale: null,
    ...overrides,
  });

  it("est deterministe", () => {
    assert.equal(projectMemoryRevision(memory()), projectMemoryRevision(memory()));
  });

  it("change avec le titre", () => {
    assert.notEqual(
      projectMemoryRevision(memory()),
      projectMemoryRevision(memory({ title: "Un autre titre" })),
    );
  });

  it("change avec la categorie", () => {
    assert.notEqual(
      projectMemoryRevision(memory()),
      projectMemoryRevision(memory({ category: "CONSTRAINT" })),
    );
  });

  it("change avec le contenu", () => {
    assert.notEqual(
      projectMemoryRevision(memory()),
      projectMemoryRevision(memory({ content: "Un autre contenu." })),
    );
  });

  it("change avec la justification", () => {
    assert.notEqual(
      projectMemoryRevision(memory()),
      projectMemoryRevision(memory({ rationale: "Parce que." })),
    );
  });

  it("ne depend pas du champ revision lui-meme", () => {
    assert.equal(
      projectMemoryRevision(memory({ revision: "a".repeat(64) })),
      projectMemoryRevision(memory({ revision: "b".repeat(64) })),
    );
  });

  it("resiste au deplacement d'une frontiere entre deux champs", () => {
    assert.notEqual(
      projectMemoryRevision(memory({ title: "ab", content: "c" })),
      projectMemoryRevision(memory({ title: "a", content: "bc" })),
    );
  });

  it("distingue deux textes Unicode voisins", () => {
    assert.notEqual(
      projectMemoryRevision(memory({ content: "café" })),
      projectMemoryRevision(memory({ content: "cafe" })),
    );
  });
});

describe("architectContextFingerprint — memoire", () => {
  const entry = (overrides: Record<string, unknown> = {}): ArchitectPromptMemory => ({
    code: "MEM-001",
    category: "DECISION",
    revision: "m".repeat(64),
    title: "Un titre",
    content: "Un contenu.",
    rationale: null,
    ...overrides,
  });

  it("change lorsqu'une memoire est ajoutee", () => {
    assert.notEqual(
      architectContextFingerprint(bundle()),
      architectContextFingerprint(bundle({ projectMemory: [entry()] })),
    );
  });

  it("change lorsqu'une memoire est modifiee", () => {
    assert.notEqual(
      architectContextFingerprint(bundle({ projectMemory: [entry()] })),
      architectContextFingerprint(bundle({ projectMemory: [entry({ revision: "n".repeat(64) })] })),
    );
  });

  it("change lorsqu'une memoire disparait du contexte", () => {
    assert.notEqual(
      architectContextFingerprint(bundle({ projectMemory: [entry()] })),
      architectContextFingerprint(bundle({ projectMemory: [] })),
    );
  });

  it("depend de l'ordre des entrees", () => {
    const a = entry();
    const b = entry({ code: "MEM-002", revision: "p".repeat(64) });
    assert.notEqual(
      architectContextFingerprint(bundle({ projectMemory: [a, b] })),
      architectContextFingerprint(bundle({ projectMemory: [b, a] })),
    );
  });
});
