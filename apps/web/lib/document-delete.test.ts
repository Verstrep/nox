import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeDeleteFailure,
  readDocumentDeleteSubmission,
  type DocumentDeleteFields,
} from "./document-delete.ts";

const REVISION = "a".repeat(64);

function fields(overrides: Partial<DocumentDeleteFields> = {}): DocumentDeleteFields {
  return { documentPath: "docs/NOTE.md", expectedRevision: REVISION, ...overrides };
}

describe("readDocumentDeleteSubmission", () => {
  it("accepte un document ordinaire avec sa revision", () => {
    assert.deepEqual(readDocumentDeleteSubmission(fields()), {
      ok: true,
      fields: { documentPath: "docs/NOTE.md", expectedRevision: REVISION },
    });
  });

  it("refuse un chemin vide", () => {
    const result = readDocumentDeleteSubmission(fields({ documentPath: "   " }));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.message.includes("Rouvrez"));
  });

  it("refuse une revision absente", () => {
    // Sans revision, le runner ne pourrait pas verifier que le fichier supprime
    // est bien celui que l'utilisateur a vu.
    const result = readDocumentDeleteSubmission(fields({ expectedRevision: "" }));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.message.includes("Rechargez"));
  });

  it("refuse un document de tache", () => {
    const result = readDocumentDeleteSubmission(fields({ documentPath: "tasks/TASK-001.md" }));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.message.includes("Delete task"));
  });

  it("refuse un document de tache ecrit autrement", () => {
    for (const variant of ["tasks/task-001.md", "Tasks/TASK-001.MD"]) {
      assert.equal(readDocumentDeleteSubmission(fields({ documentPath: variant })).ok, false, variant);
    }
  });

  it("laisse passer les autres documents de tasks/", () => {
    // Le runner reste seul juge : ce controle-ci evite un aller-retour certain,
    // il ne remplace pas la decision.
    assert.equal(readDocumentDeleteSubmission(fields({ documentPath: "tasks/NOTES.md" })).ok, true);
  });
});

describe("describeDeleteFailure", () => {
  it("signale un conflit de revision", () => {
    const result = describeDeleteFailure({
      kind: "runner_error",
      code: "DOCUMENT_DELETE_CONFLICT",
    });

    assert.equal(result.conflict, true);
    assert.ok(result.message.includes("Rechargez"));
    // Le message parle de supprimer, pas d'enregistrer : apres un refus de
    // suppression, il n'y a aucun texte a reporter.
    assert.ok(result.message.includes("supprimer"));
  });

  it("ne confond pas le conflit d'ecriture avec celui de suppression", () => {
    assert.equal(
      describeDeleteFailure({ kind: "runner_error", code: "DOCUMENT_CONFLICT" }).conflict,
      false,
    );
  });

  it("traduit un refus de protection", () => {
    const result = describeDeleteFailure({ kind: "runner_error", code: "DOCUMENT_PROTECTED" });

    assert.equal(result.conflict, false);
    assert.ok(result.message.includes("Delete task"));
  });

  it("traduit un runner injoignable sans rien conclure", () => {
    const result = describeDeleteFailure({ kind: "unreachable" });

    assert.equal(result.conflict, false);
    assert.ok(result.message.length > 0);
  });

  it("ne divulgue ni jeton ni chemin absolu", () => {
    for (const failure of [
      { kind: "runner_error", code: "DOCUMENT_DELETE_CONFLICT" },
      { kind: "runner_error", code: "DOCUMENT_PROTECTED" },
      { kind: "runner_error", code: "DOCUMENT_DELETE_FAILED" },
      { kind: "unauthorized" },
    ] as const) {
      const { message } = describeDeleteFailure(failure);
      assert.equal(/[A-Za-z]:\\/.test(message), false, JSON.stringify(failure));
      assert.equal(message.includes("Bearer"), false, JSON.stringify(failure));
    }
  });
});
