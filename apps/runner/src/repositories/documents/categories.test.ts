import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { categorizeDocument, compareDocuments } from "./categories.ts";

describe("categorizeDocument", () => {
  it("reconnait les documents principaux de la racine", () => {
    assert.equal(categorizeDocument("CLAUDE.md"), "CORE");
    assert.equal(categorizeDocument("AGENTS.md"), "CORE");
    assert.equal(categorizeDocument("README.md"), "CORE");
  });

  it("reconnait les documents principaux de docs/", () => {
    for (const documentPath of [
      "docs/PROJECT_BRIEF.md",
      "docs/V1_SCOPE.md",
      "docs/ARCHITECTURE.md",
      "docs/DECISIONS.md",
      "docs/ROADMAP.md",
      "docs/PROJECT_STATE.md",
      "docs/BACKLOG.md",
      "docs/SECURITY.md",
    ]) {
      assert.equal(categorizeDocument(documentPath), "CORE", documentPath);
    }
  });

  it("ignore la casse pour les documents principaux", () => {
    assert.equal(categorizeDocument("docs/project_brief.md"), "CORE");
    assert.equal(categorizeDocument("readme.md"), "CORE");
  });

  it("classe le reste de docs/ en documentation", () => {
    assert.equal(categorizeDocument("docs/notes.md"), "DOCUMENTATION");
    assert.equal(categorizeDocument("docs/nested/NOTE.md"), "DOCUMENTATION");
  });

  it("classe par dossier de premier niveau", () => {
    assert.equal(categorizeDocument("decisions/ADR-001.md"), "DECISION");
    assert.equal(categorizeDocument("plans/CURRENT_PLAN.md"), "PLAN");
    assert.equal(categorizeDocument("tasks/TASK-001.md"), "TASK");
  });

  it("classe en documentation par defaut", () => {
    assert.equal(categorizeDocument("ailleurs/note.md"), "DOCUMENTATION");
  });

  it("ne deduit rien du contenu : seul le chemin compte", () => {
    // Un fichier nomme comme un ADR mais range dans docs/ reste documentation.
    assert.equal(categorizeDocument("docs/ADR-001.md"), "DOCUMENTATION");
  });
});

describe("compareDocuments", () => {
  const sort = (paths: string[]) =>
    paths
      .map((documentPath) => ({ path: documentPath, category: categorizeDocument(documentPath) }))
      .sort(compareDocuments)
      .map((document) => document.path);

  it("ordonne les categories avant les chemins", () => {
    assert.deepEqual(
      sort([
        "tasks/TASK-001.md",
        "docs/notes.md",
        "README.md",
        "plans/CURRENT_PLAN.md",
        "decisions/ADR-001.md",
      ]),
      [
        "README.md",
        "docs/notes.md",
        "decisions/ADR-001.md",
        "plans/CURRENT_PLAN.md",
        "tasks/TASK-001.md",
      ],
    );
  });

  it("trie alphabetiquement a l'interieur d'une categorie", () => {
    assert.deepEqual(sort(["docs/zeta.md", "docs/alpha.md", "docs/nested/beta.md"]), [
      "docs/alpha.md",
      "docs/nested/beta.md",
      "docs/zeta.md",
    ]);
  });

  it("produit un ordre stable quel que soit l'ordre d'entree", () => {
    const paths = ["tasks/b.md", "docs/a.md", "CLAUDE.md", "decisions/c.md"];
    assert.deepEqual(sort(paths), sort([...paths].reverse()));
  });

  it("place les accents la ou un lecteur francophone les attend", () => {
    assert.deepEqual(sort(["docs/zebre.md", "docs/étude.md", "docs/analyse.md"]), [
      "docs/analyse.md",
      "docs/étude.md",
      "docs/zebre.md",
    ]);
  });
});
