/**
 * Tests de la presentation Architecte.
 *
 * Le point le plus important : `OMITTED` et `TRUNCATED` ne se confondent pas.
 * Dire « tronque » d'un document dont rien n'est parti laisserait croire a un
 * envoi qui n'a pas eu lieu.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ArchitectContextManifest, ArchitectTaskProposal } from "@nox/shared";

import {
  architectExcerpt,
  architectSessionUrl,
  architectUrl,
  formatChars,
  manifestRows,
  manifestTaskCount,
  proposalToFormValues,
  sourceStatus,
} from "./display.ts";

const MANIFEST: ArchitectContextManifest = {
  schemaVersion: 1,
  sources: [
    {
      kind: "INSTRUCTIONS",
      identifier: "CLAUDE.md",
      revision: "a".repeat(64),
      includedChars: 2_048,
      truncated: false,
    },
    {
      kind: "DOCUMENT",
      identifier: "docs/DECISIONS.md",
      revision: "b".repeat(64),
      includedChars: 32_768,
      truncated: true,
    },
    {
      kind: "DOCUMENT",
      identifier: "docs/ROADMAP.md",
      revision: "c".repeat(64),
      includedChars: 0,
      truncated: true,
    },
    { kind: "TASK", identifier: "TASK-012", revision: null, includedChars: 400, truncated: false },
  ],
  totalChars: 35_216,
  missing: ["AGENTS.md"],
};

describe("architectUrl", () => {
  it("mene aux demandes d'un projet", () => {
    assert.equal(architectUrl("p1"), "/projects/p1/architect");
  });

  it("mene a une session", () => {
    assert.equal(architectSessionUrl("p1", "s1"), "/projects/p1/architect/s1");
  });
});

describe("sourceStatus", () => {
  it("reconnait un document inclus", () => {
    assert.equal(sourceStatus(MANIFEST.sources[0]!), "INCLUDED");
  });

  it("reconnait un document tronque", () => {
    assert.equal(sourceStatus(MANIFEST.sources[1]!), "TRUNCATED");
  });

  it("reconnait un document omis", () => {
    assert.equal(sourceStatus(MANIFEST.sources[2]!), "OMITTED");
  });
});

describe("manifestRows", () => {
  it("decrit chaque source", () => {
    const rows = manifestRows(MANIFEST);
    assert.equal(rows.length, 5);
    assert.equal(rows[0]?.identifier, "CLAUDE.md");
    assert.equal(rows[0]?.status, "INCLUDED");
  });

  it("raccourcit les revisions", () => {
    assert.equal(manifestRows(MANIFEST)[0]?.revision, "aaaaaaaaaaaa");
  });

  it("ajoute les documents absents", () => {
    const missing = manifestRows(MANIFEST).find((row) => row.identifier === "AGENTS.md");
    assert.equal(missing?.status, "MISSING");
    assert.equal(missing?.chars, 0);
  });

  it("compte les taches", () => {
    assert.equal(manifestTaskCount(MANIFEST), 1);
  });
});

describe("formatChars", () => {
  it("compte en caracteres sous le kibioctet", () => {
    assert.equal(formatChars(512), "512 car.");
  });

  it("passe au kibioctet au-dela", () => {
    assert.equal(formatChars(2_048), "2.0 Kio");
  });
});

describe("proposalToFormValues", () => {
  const proposal: ArchitectTaskProposal = {
    schemaVersion: 1,
    status: "PROPOSAL_READY",
    title: "Exporter les taches",
    priority: "HIGH",
    objective: "Un objectif.",
    context: null,
    acceptanceCriteria: ["Un", "Deux"],
    outOfScope: ["Import"],
    documentReferences: ["docs/ARCHITECTURE.md"],
    validationCommands: ["npm run test"],
    assumptions: ["Une hypothese"],
    questions: [],
  };

  it("transforme les listes en lignes", () => {
    const values = proposalToFormValues(proposal);
    assert.equal(values.criteria, "Un\nDeux");
    assert.equal(values.commands, "npm run test");
    assert.equal(values.documents, "docs/ARCHITECTURE.md");
  });

  it("remplace les champs absents par du vide", () => {
    const values = proposalToFormValues({ ...proposal, context: null, title: null });
    assert.equal(values.context, "");
    assert.equal(values.title, "");
  });

  it("retombe sur une priorite moyenne quand elle manque", () => {
    assert.equal(proposalToFormValues({ ...proposal, priority: null }).priority, "MEDIUM");
  });

  it("n'emporte pas les hypotheses dans la tache", () => {
    // Elles servent a relire la proposition, pas a specifier la tache.
    const serialized = JSON.stringify(proposalToFormValues(proposal));
    assert.equal(serialized.includes("Une hypothese"), false);
  });
});

describe("architectExcerpt", () => {
  it("laisse un texte court intact", () => {
    assert.equal(architectExcerpt("Une demande courte."), "Une demande courte.");
  });

  it("reduit les espaces", () => {
    assert.equal(architectExcerpt("Une\n\ndemande"), "Une demande");
  });

  it("coupe un texte long", () => {
    const excerpt = architectExcerpt("m".repeat(300));
    assert.equal(excerpt.length, 140);
    assert.ok(excerpt.endsWith("…"));
  });
});
