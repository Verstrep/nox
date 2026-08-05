import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeUpdateFailure,
  documentUrl,
  normalizeSubmittedContent,
  readDocumentEditSubmission,
} from "./document-edit.ts";

const REVISION = "a".repeat(64);

function fields(overrides: Partial<Parameters<typeof readDocumentEditSubmission>[0]> = {}) {
  return {
    documentPath: "docs/PROJECT_BRIEF.md",
    content: "# Brief\n",
    expectedRevision: REVISION,
    ...overrides,
  };
}

describe("normalizeSubmittedContent", () => {
  it("ramene le CRLF impose par le navigateur a LF", () => {
    assert.equal(normalizeSubmittedContent("a\r\nb\r\n"), "a\nb\n");
  });

  it("ramene un CR isole a LF", () => {
    assert.equal(normalizeSubmittedContent("a\rb"), "a\nb");
  });

  it("laisse un contenu deja en LF intact", () => {
    assert.equal(normalizeSubmittedContent("a\nb\n"), "a\nb\n");
  });

  it("laisse un contenu vide vide", () => {
    assert.equal(normalizeSubmittedContent(""), "");
  });

  it("ne touche pas au reste du texte", () => {
    const content = "# Étude — dépôt 🎯";
    assert.equal(normalizeSubmittedContent(content), content);
  });
});

describe("readDocumentEditSubmission", () => {
  it("accepte une soumission complete", () => {
    const submission = readDocumentEditSubmission(fields());

    assert.equal(submission.ok, true);
    assert.equal(submission.ok && submission.fields.documentPath, "docs/PROJECT_BRIEF.md");
    assert.equal(submission.ok && submission.fields.expectedRevision, REVISION);
  });

  it("accepte un contenu vide : vider un document est une modification", () => {
    const submission = readDocumentEditSubmission(fields({ content: "" }));

    assert.equal(submission.ok, true);
    assert.equal(submission.ok && submission.fields.content, "");
  });

  it("normalise les fins de ligne du contenu accepte", () => {
    const submission = readDocumentEditSubmission(fields({ content: "a\r\nb\r\n" }));
    assert.equal(submission.ok && submission.fields.content, "a\nb\n");
  });

  it("refuse un chemin de document absent", () => {
    for (const documentPath of ["", "   "]) {
      const submission = readDocumentEditSubmission(fields({ documentPath }));
      assert.equal(submission.ok, false);
      assert.match(submission.ok ? "" : submission.message, /Rouvrez le document/);
    }
  });

  it("refuse une revision absente", () => {
    const submission = readDocumentEditSubmission(fields({ expectedRevision: "" }));

    assert.equal(submission.ok, false);
    assert.match(submission.ok ? "" : submission.message, /Rechargez le document/);
  });

  it("laisse le runner juger du format de la revision", () => {
    // Le web ne redeclare pas la regle : il verifie seulement qu'un champ est
    // renseigne. Le format est verifie la ou il est compare.
    const submission = readDocumentEditSubmission(fields({ expectedRevision: "pas-une-empreinte" }));
    assert.equal(submission.ok, true);
  });
});

describe("describeUpdateFailure", () => {
  it("distingue le conflit des autres echecs", () => {
    const conflict = describeUpdateFailure({ kind: "runner_error", code: "DOCUMENT_CONFLICT" });

    assert.equal(conflict.conflict, true);
    assert.match(conflict.message, /modifie depuis son ouverture/);
    assert.match(conflict.message, /conserve/);
  });

  it("ne signale pas un conflit sur un autre code", () => {
    for (const failure of [
      { kind: "runner_error", code: "DOCUMENT_NOT_FOUND" },
      { kind: "runner_error", code: "DOCUMENT_TOO_LARGE" },
      { kind: "unreachable" },
      { kind: "unauthorized" },
    ] as const) {
      assert.equal(describeUpdateFailure(failure).conflict, false, JSON.stringify(failure));
    }
  });

  it("produit un message exploitable pour chaque echec d'ecriture", () => {
    for (const code of [
      "DOCUMENT_CONFLICT",
      "DOCUMENT_SYMLINK_NOT_WRITABLE",
      "DOCUMENT_CONTENT_INVALID",
      "DOCUMENT_WRITE_FAILED",
      "DOCUMENT_TEMPORARY_FILE_FAILED",
      "DOCUMENT_REVISION_REQUIRED",
      "DOCUMENT_REVISION_INVALID",
      "DOCUMENT_TOO_LARGE",
    ] as const) {
      const { message } = describeUpdateFailure({ kind: "runner_error", code });
      assert.ok(message.length > 20, code);
    }
  });

  it("n'expose ni chemin absolu, ni jeton, ni detail technique", () => {
    for (const code of [
      "DOCUMENT_CONFLICT",
      "DOCUMENT_SYMLINK_NOT_WRITABLE",
      "DOCUMENT_WRITE_FAILED",
      "DOCUMENT_TEMPORARY_FILE_FAILED",
    ] as const) {
      const { message } = describeUpdateFailure({ kind: "runner_error", code });

      assert.equal(/[A-Za-z]:\\/.test(message), false, code);
      assert.equal(message.includes("/tmp"), false, code);
      assert.equal(/ECONNREFUSED|ENOENT|EPERM|Bearer/.test(message), false, code);
    }
  });
});

describe("documentUrl", () => {
  it("construit l'URL de lecture", () => {
    assert.equal(documentUrl("p1", "docs/PROJECT_BRIEF.md"), "/projects/p1/documents?path=docs%2FPROJECT_BRIEF.md");
  });

  it("construit l'URL d'edition", () => {
    assert.equal(
      documentUrl("p1", "docs/a.md", { edit: true }),
      "/projects/p1/documents?path=docs%2Fa.md&edit=1",
    );
  });

  it("construit l'URL de retour apres enregistrement", () => {
    assert.equal(
      documentUrl("p1", "docs/a.md", { saved: true }),
      "/projects/p1/documents?path=docs%2Fa.md&saved=1",
    );
  });

  it("encode les caracteres speciaux du chemin", () => {
    const url = documentUrl("p1", "docs/un dossier/étude.md");

    assert.equal(url.includes(" "), false);
    assert.equal(url.includes("étude"), false);
  });
});
