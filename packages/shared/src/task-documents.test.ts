/**
 * Contrat de suppression du document d'une tache.
 *
 * Le point sensible est `expectedRevision` : `null` y est une **information**,
 * pas une absence. Les tests ci-dessous verrouillent cette distinction.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isDeleteProjectDocumentsSuccess,
  isDeleteTaskDocumentSuccess,
  parseDeleteProjectDocumentsRequest,
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

/**
 * Contrat du nettoyage des artefacts d'un projet supprime.
 *
 * Ce que ces tests protegent : le corps ne porte **aucun chemin**, et une
 * revision absente n'est pas acceptee. La revision est ce qui prouve
 * l'appartenance du fichier a NOX ; une requete qui l'omettrait demanderait au
 * runner de supprimer un fichier sur la seule foi d'un nom.
 */
describe("parseDeleteProjectDocumentsRequest", () => {
  it("accepte une liste d'artefacts complets", () => {
    const parsed = parseDeleteProjectDocumentsRequest({
      repositoryPath: "D:/depot",
      artifacts: [
        { taskCode: "TASK-000", expectedRevision: "a".repeat(64) },
        { taskCode: "TASK-001", expectedRevision: "b".repeat(64) },
      ],
    });

    assert.ok(parsed !== null);
    assert.equal(parsed.artifacts.length, 2);
    assert.equal(parsed.artifacts[0]?.taskCode, "TASK-000");
  });

  it("accepte une liste vide", () => {
    // Un projet sans artefact reste un projet supprimable.
    const parsed = parseDeleteProjectDocumentsRequest({ repositoryPath: "D:/depot", artifacts: [] });
    assert.deepEqual(parsed, { repositoryPath: "D:/depot", artifacts: [] });
  });

  it("refuse une revision absente ou nulle", () => {
    assert.equal(
      parseDeleteProjectDocumentsRequest({
        repositoryPath: "D:/depot",
        artifacts: [{ taskCode: "TASK-001" }],
      }),
      null,
    );
    assert.equal(
      parseDeleteProjectDocumentsRequest({
        repositoryPath: "D:/depot",
        artifacts: [{ taskCode: "TASK-001", expectedRevision: null }],
      }),
      null,
    );
  });

  it("n'accepte aucun chemin, meme glisse dans une entree", () => {
    // Le champ n'existe pas dans le contrat : il est simplement ignore, et le
    // runner compose `tasks/<code>.md` a partir du seul code.
    const parsed = parseDeleteProjectDocumentsRequest({
      repositoryPath: "D:/depot",
      artifacts: [
        { taskCode: "TASK-001", expectedRevision: "c".repeat(64), path: "../../src/App.tsx" },
      ],
    });

    assert.ok(parsed !== null);
    assert.deepEqual(parsed.artifacts, [
      { taskCode: "TASK-001", expectedRevision: "c".repeat(64) },
    ]);
  });

  it("refuse un corps sans liste", () => {
    assert.equal(parseDeleteProjectDocumentsRequest({ repositoryPath: "D:/depot" }), null);
    assert.equal(parseDeleteProjectDocumentsRequest(null), null);
  });
});

describe("isDeleteProjectDocumentsSuccess", () => {
  it("accepte une reponse dont chaque sort est reconnu", () => {
    assert.equal(
      isDeleteProjectDocumentsSuccess({
        ok: true,
        documents: [
          { taskCode: "TASK-000", path: "tasks/TASK-000.md", outcome: "REMOVED" },
          { taskCode: "TASK-001", path: "tasks/TASK-001.md", outcome: "REMOVED_MODIFIED" },
          { taskCode: "TASK-002", path: "tasks/TASK-002.md", outcome: "ABSENT" },
          { taskCode: "TASK-003", path: "tasks/TASK-003.md", outcome: "REFUSED" },
        ],
      }),
      true,
    );
  });

  it("accepte une reponse vide", () => {
    assert.equal(isDeleteProjectDocumentsSuccess({ ok: true, documents: [] }), true);
  });

  it("refuse un sort inconnu", () => {
    // La liste est fermee : une valeur inventee cote runner ne doit pas etre
    // interpretee comme une reussite par le web.
    assert.equal(
      isDeleteProjectDocumentsSuccess({
        ok: true,
        documents: [{ taskCode: "TASK-001", path: "tasks/TASK-001.md", outcome: "MAYBE" }],
      }),
      false,
    );
  });

  it("refuse une reponse malformee", () => {
    assert.equal(isDeleteProjectDocumentsSuccess({ ok: true }), false);
    assert.equal(isDeleteProjectDocumentsSuccess({ ok: false, documents: [] }), false);
    assert.equal(isDeleteProjectDocumentsSuccess(null), false);
  });
});
