/**
 * Contrat de suppression d'un document.
 *
 * Ne teste que ce que TASK-009 ajoute : les autres formes de `documents.ts`
 * sont couvertes par les tests des routes qui les consomment.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isDeleteProjectDocumentSuccess,
  parseDeleteProjectDocumentRequest,
} from "../dist/index.js";

const REVISION = "a".repeat(64);

describe("parseDeleteProjectDocumentRequest", () => {
  it("accepte les trois chaines attendues", () => {
    assert.deepEqual(
      parseDeleteProjectDocumentRequest({
        repositoryPath: "D:\\depot",
        documentPath: "docs/NOTE.md",
        expectedRevision: REVISION,
      }),
      {
        repositoryPath: "D:\\depot",
        documentPath: "docs/NOTE.md",
        expectedRevision: REVISION,
      },
    );
  });

  it("ne retient aucun champ supplementaire", () => {
    const parsed = parseDeleteProjectDocumentRequest({
      repositoryPath: "D:\\depot",
      documentPath: "docs/NOTE.md",
      expectedRevision: REVISION,
      // Un drapeau de forcage n'existe pas dans le contrat : s'il etait recopie
      // par le parseur, il pourrait un jour etre lu par erreur.
      force: true,
    });

    assert.notEqual(parsed, null);
    assert.deepEqual(Object.keys(parsed ?? {}).sort(), [
      "documentPath",
      "expectedRevision",
      "repositoryPath",
    ]);
  });

  it("refuse une revision absente", () => {
    assert.equal(
      parseDeleteProjectDocumentRequest({
        repositoryPath: "D:\\depot",
        documentPath: "docs/NOTE.md",
      }),
      null,
    );
  });

  it("refuse une revision nulle", () => {
    // Une suppression sans revision serait une suppression a l'aveugle : le
    // contrat ne l'accepte meme pas syntaxiquement.
    assert.equal(
      parseDeleteProjectDocumentRequest({
        repositoryPath: "D:\\depot",
        documentPath: "docs/NOTE.md",
        expectedRevision: null,
      }),
      null,
    );
  });

  it("refuse une forme non conforme", () => {
    assert.equal(parseDeleteProjectDocumentRequest(null), null);
    assert.equal(parseDeleteProjectDocumentRequest("docs/NOTE.md"), null);
    assert.equal(parseDeleteProjectDocumentRequest([1, 2, 3]), null);
    assert.equal(
      parseDeleteProjectDocumentRequest({
        repositoryPath: 42,
        documentPath: "docs/NOTE.md",
        expectedRevision: REVISION,
      }),
      null,
    );
  });
});

describe("isDeleteProjectDocumentSuccess", () => {
  it("accepte une reponse complete", () => {
    assert.equal(
      isDeleteProjectDocumentSuccess({
        ok: true,
        deleted: { path: "docs/NOTE.md", revision: REVISION },
      }),
      true,
    );
  });

  it("refuse une revision qui n'a pas la forme d'une empreinte", () => {
    assert.equal(
      isDeleteProjectDocumentSuccess({
        ok: true,
        deleted: { path: "docs/NOTE.md", revision: "pas-une-empreinte" },
      }),
      false,
    );
  });

  it("refuse une reponse d'echec ou incomplete", () => {
    assert.equal(isDeleteProjectDocumentSuccess({ ok: false }), false);
    assert.equal(isDeleteProjectDocumentSuccess({ ok: true }), false);
    assert.equal(isDeleteProjectDocumentSuccess({ ok: true, deleted: {} }), false);
    assert.equal(isDeleteProjectDocumentSuccess(null), false);
  });
});
