/**
 * Tests de la comparaison de deux manifests.
 *
 * Ce module ne dit que des faits surs. Les tests verifient donc autant ce qu'il
 * rapporte que ce qu'il **ne pretend pas** savoir : il n'existe aucun cas ou une
 * difference de contenu apparaisse, parce que NOX ne conserve pas ce contenu.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ArchitectContextManifest, ArchitectContextSource } from "@nox/shared";

import { diffArchitectManifests } from "./context-diff.ts";

function source(overrides: Partial<ArchitectContextSource> = {}): ArchitectContextSource {
  return {
    kind: "DOCUMENT",
    identifier: "docs/ARCHITECTURE.md",
    revision: "a".repeat(64),
    includedChars: 1_000,
    truncated: false,
    ...overrides,
  };
}

function manifest(sources: ArchitectContextSource[], missing: string[] = []): ArchitectContextManifest {
  return { schemaVersion: 1, sources, totalChars: 1_000, missing };
}

/** Raccourci de lecture : `[identifiant, nature]`. */
function pairs(previous: ArchitectContextManifest, current: ArchitectContextManifest) {
  return diffArchitectManifests(previous, current).map((change) => [
    change.identifier,
    change.kind,
  ]);
}

describe("diffArchitectManifests — documents", () => {
  it("ne rapporte rien quand rien n'a bouge", () => {
    const same = manifest([source()]);
    assert.deepEqual(diffArchitectManifests(same, same), []);
  });

  it("rapporte un document ajoute", () => {
    assert.deepEqual(pairs(manifest([]), manifest([source()])), [
      ["docs/ARCHITECTURE.md", "ADDED"],
    ]);
  });

  it("rapporte un document disparu", () => {
    assert.deepEqual(pairs(manifest([source()]), manifest([])), [
      ["docs/ARCHITECTURE.md", "REMOVED"],
    ]);
  });

  it("rapporte un document modifie, avec ses deux revisions", () => {
    const changes = diffArchitectManifests(
      manifest([source()]),
      manifest([source({ revision: "b".repeat(64) })]),
    );

    assert.equal(changes.length, 1);
    assert.equal(changes[0]?.kind, "MODIFIED");
    assert.equal(changes[0]?.previousRevision, "aaaaaaaaaaaa");
    assert.equal(changes[0]?.currentRevision, "bbbbbbbbbbbb");
  });

  it("raccourcit les revisions a douze caracteres", () => {
    const changes = diffArchitectManifests(manifest([]), manifest([source()]));
    assert.equal(changes[0]?.currentRevision?.length, 12);
  });

  it("rapporte un changement de troncature a revision egale", () => {
    // Le document n'a pas change, ce qui en part si. Dire « modifie » serait
    // faux ; le taire serait pire.
    assert.deepEqual(
      pairs(manifest([source()]), manifest([source({ truncated: true })])),
      [["docs/ARCHITECTURE.md", "TRUNCATION_CHANGED"]],
    );
  });

  it("ne rapporte pas deux fois un document a la fois modifie et retronque", () => {
    // La modification englobe le reste : deux lignes pour un seul fait
    // laisseraient croire a deux changements.
    assert.deepEqual(
      pairs(
        manifest([source()]),
        manifest([source({ revision: "b".repeat(64), truncated: true })]),
      ),
      [["docs/ARCHITECTURE.md", "MODIFIED"]],
    );
  });

  it("distingue les conventions de la documentation sans les confondre", () => {
    const changes = pairs(
      manifest([source({ kind: "INSTRUCTIONS", identifier: "CLAUDE.md" })]),
      manifest([
        source({ kind: "INSTRUCTIONS", identifier: "CLAUDE.md", revision: "b".repeat(64) }),
      ]),
    );
    assert.deepEqual(changes, [["CLAUDE.md", "MODIFIED"]]);
  });

  it("ignore une revision inconnue des deux cotes", () => {
    const unknown = source({ revision: null });
    assert.deepEqual(diffArchitectManifests(manifest([unknown]), manifest([unknown])), []);
  });
});

describe("diffArchitectManifests — taches recentes", () => {
  const taskSource = (code: string, revision = "a".repeat(64)) =>
    source({ kind: "TASK", identifier: code, revision });

  it("rapporte une tache entree dans la fenetre", () => {
    assert.deepEqual(pairs(manifest([]), manifest([taskSource("TASK-014")])), [
      ["TASK-014", "TASK_ADDED"],
    ]);
  });

  it("rapporte une tache sortie de la fenetre", () => {
    // Personne n'y a touche : c'est la fenetre des dix plus recentes qui a
    // glisse. Le fait reste vrai, et l'utilisateur doit pouvoir le lire.
    assert.deepEqual(pairs(manifest([taskSource("TASK-004")]), manifest([])), [
      ["TASK-004", "TASK_REMOVED"],
    ]);
  });

  it("rapporte une specification de tache modifiee", () => {
    assert.deepEqual(
      pairs(
        manifest([taskSource("TASK-014")]),
        manifest([taskSource("TASK-014", "b".repeat(64))]),
      ),
      [["TASK-014", "TASK_MODIFIED"]],
    );
  });

  it("ne confond pas une tache et un document de meme rang", () => {
    assert.deepEqual(
      pairs(
        manifest([source(), taskSource("TASK-014")]),
        manifest([
          source({ revision: "b".repeat(64) }),
          taskSource("TASK-014", "b".repeat(64)),
        ]),
      ),
      [
        ["docs/ARCHITECTURE.md", "MODIFIED"],
        ["TASK-014", "TASK_MODIFIED"],
      ],
    );
  });
});

describe("diffArchitectManifests — ordre et exhaustivite", () => {
  it("suit l'ordre du manifest actuel, puis les disparitions", () => {
    const previous = manifest([
      source({ identifier: "docs/A.md" }),
      source({ identifier: "docs/DISPARU.md" }),
    ]);
    const current = manifest([
      source({ identifier: "docs/A.md", revision: "b".repeat(64) }),
      source({ identifier: "docs/NOUVEAU.md" }),
    ]);

    assert.deepEqual(pairs(previous, current), [
      ["docs/A.md", "MODIFIED"],
      ["docs/NOUVEAU.md", "ADDED"],
      ["docs/DISPARU.md", "REMOVED"],
    ]);
  });

  it("ne rapporte jamais de difference de contenu", () => {
    // NOX ne conserve pas le texte des documents envoyes : il ne peut pas dire
    // ce qui a change dedans, et ne le pretend pas.
    const changes = diffArchitectManifests(
      manifest([source()]),
      manifest([source({ revision: "b".repeat(64) })]),
    );
    const serialized = JSON.stringify(changes);
    assert.equal(serialized.includes("+"), false);
    assert.equal(serialized.includes("@@"), false);
    assert.deepEqual(Object.keys(changes[0] ?? {}).sort(), [
      "currentRevision",
      "identifier",
      "kind",
      "previousRevision",
    ]);
  });
});
