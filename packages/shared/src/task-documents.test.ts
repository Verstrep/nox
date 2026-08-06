/**
 * Contrat de suppression du document d'une tache.
 *
 * Le point sensible est `expectedRevision` : `null` y est une **information**,
 * pas une absence. Les tests ci-dessous verrouillent cette distinction.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isDeleteTaskDocumentSuccess,
  parseDeleteTaskDocumentRequest,
} from "../dist/index.js";

const REVISION = "b".repeat(64);

describe("parseDeleteTaskDocumentRequest", () => {
  it("accepte une revision connue", () => {
    assert.deepEqual(
      parseDeleteTaskDocumentRequest({
        repositoryPath: "D:\\depot",
        taskCode: "TASK-001",
        expectedRevision: REVISION,
      }),
      { repositoryPath: "D:\\depot", taskCode: "TASK-001", expectedRevision: REVISION },
    );
  });

  it("accepte une revision explicitement nulle", () => {
    // Une tache jamais synchronisee n'a pas de revision : c'est un cas normal,
    // et le contrat doit le transporter plutot que de le rejeter.
    assert.deepEqual(
      parseDeleteTaskDocumentRequest({
        repositoryPath: "D:\\depot",
        taskCode: "TASK-042",
        expectedRevision: null,
      }),
      { repositoryPath: "D:\\depot", taskCode: "TASK-042", expectedRevision: null },
    );
  });

  it("refuse un champ `expectedRevision` absent", () => {
    // Distinct du `null` ci-dessus : l'omission signale un appelant qui ignore
    // le contrat, pas un appelant qui sait que la tache n'a pas de document.
    assert.equal(
      parseDeleteTaskDocumentRequest({
        repositoryPath: "D:\\depot",
        taskCode: "TASK-001",
      }),
      null,
    );
  });

  it("n'accepte aucun chemin", () => {
    const parsed = parseDeleteTaskDocumentRequest({
      repositoryPath: "D:\\depot",
      taskCode: "TASK-001",
      expectedRevision: REVISION,
      documentPath: "../../etc/passwd",
    });

    assert.notEqual(parsed, null);
    assert.deepEqual(Object.keys(parsed ?? {}).sort(), [
      "expectedRevision",
      "repositoryPath",
      "taskCode",
    ]);
  });

  it("refuse une forme non conforme", () => {
    assert.equal(parseDeleteTaskDocumentRequest(null), null);
    assert.equal(parseDeleteTaskDocumentRequest([1, 2, 3]), null);
    assert.equal(
      parseDeleteTaskDocumentRequest({
        repositoryPath: "D:\\depot",
        taskCode: 1,
        expectedRevision: null,
      }),
      null,
    );
    assert.equal(
      parseDeleteTaskDocumentRequest({
        repositoryPath: "D:\\depot",
        taskCode: "TASK-001",
        expectedRevision: 7,
      }),
      null,
    );
  });
});

describe("isDeleteTaskDocumentSuccess", () => {
  it("accepte une suppression effective", () => {
    assert.equal(
      isDeleteTaskDocumentSuccess({
        ok: true,
        deleted: true,
        alreadyAbsent: false,
        path: "tasks/TASK-001.md",
      }),
      true,
    );
  });

  it("accepte une absence, qui est une reussite", () => {
    assert.equal(
      isDeleteTaskDocumentSuccess({
        ok: true,
        deleted: false,
        alreadyAbsent: true,
        path: "tasks/TASK-001.md",
      }),
      true,
    );
  });

  it("refuse une reponse incomplete", () => {
    assert.equal(isDeleteTaskDocumentSuccess({ ok: true, deleted: true }), false);
    assert.equal(isDeleteTaskDocumentSuccess({ ok: false }), false);
    assert.equal(isDeleteTaskDocumentSuccess(null), false);
  });
});
