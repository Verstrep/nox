import { renderTaskMarkdown, type ProjectDocumentContent } from "@nox/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RunnerResult } from "./runner/errors.ts";
import { synchronizeTaskDocument, type SynchronizableTask, type TaskSyncPorts } from "./task-sync.ts";

const REPOSITORY = "D:\\Projets\\depot";
const REVISION = "a".repeat(64);
const OTHER_REVISION = "b".repeat(64);

const TASK: SynchronizableTask = {
  code: "TASK-001",
  title: "Ajouter la gestion des projets",
  objective: "Permettre d'enregistrer un repository local.",
  context: null,
  outOfScope: null,
  documentReferences: ["CLAUDE.md"],
  acceptanceCriteria: ["Un projet peut etre cree."],
  validationCommands: ["npm run test"],
  documentPath: "tasks/TASK-001.md",
};

const EXPECTED_MARKDOWN = renderTaskMarkdown(TASK);

function document(content: string, revision = REVISION): ProjectDocumentContent {
  return {
    path: "tasks/TASK-001.md",
    name: "TASK-001.md",
    category: "TASK",
    size: Buffer.byteLength(content),
    updatedAt: "2026-08-06T10:00:00.000Z",
    content,
    revision,
  };
}

function ok<T>(value: T): RunnerResult<T> {
  return { ok: true, value };
}

/** Doublure : rien de ce test ne touche au disque ni au reseau. */
function ports(overrides: Partial<TaskSyncPorts> = {}): TaskSyncPorts {
  return {
    createDocument: () => Promise.resolve(ok(document(EXPECTED_MARKDOWN))),
    readDocument: () => Promise.resolve(ok(document(EXPECTED_MARKDOWN))),
    ...overrides,
  };
}

describe("synchronizeTaskDocument - creation reussie", () => {
  it("retourne le chemin et la revision du document cree", async () => {
    const outcome = await synchronizeTaskDocument(REPOSITORY, TASK, ports());

    assert.deepEqual(outcome, {
      kind: "synced",
      path: "tasks/TASK-001.md",
      revision: REVISION,
    });
  });

  it("transmet le code de la tache et le Markdown attendu", async () => {
    const calls: { repositoryPath: string; taskCode: string; content: string }[] = [];

    await synchronizeTaskDocument(
      REPOSITORY,
      TASK,
      ports({
        createDocument: (repositoryPath, taskCode, content) => {
          calls.push({ repositoryPath, taskCode, content });
          return Promise.resolve(ok(document(content)));
        },
      }),
    );

    assert.deepEqual(calls, [
      { repositoryPath: REPOSITORY, taskCode: "TASK-001", content: EXPECTED_MARKDOWN },
    ]);
  });

  it("ne lit rien lorsque la creation reussit", async () => {
    let reads = 0;

    await synchronizeTaskDocument(
      REPOSITORY,
      TASK,
      ports({
        readDocument: () => {
          reads += 1;
          return Promise.resolve(ok(document(EXPECTED_MARKDOWN)));
        },
      }),
    );

    assert.equal(reads, 0);
  });
});

describe("synchronizeTaskDocument - runner indisponible", () => {
  it("signale une erreur lorsque le runner ne repond pas", async () => {
    const outcome = await synchronizeTaskDocument(
      REPOSITORY,
      TASK,
      ports({
        createDocument: () => Promise.resolve({ ok: false, failure: { kind: "unreachable" } }),
      }),
    );

    assert.equal(outcome.kind, "error");
    assert.match(outcome.kind === "error" ? outcome.message : "", /runner/i);
  });

  it("ne tente aucune lecture apres une panne", async () => {
    let reads = 0;

    await synchronizeTaskDocument(
      REPOSITORY,
      TASK,
      ports({
        createDocument: () => Promise.resolve({ ok: false, failure: { kind: "timeout" } }),
        readDocument: () => {
          reads += 1;
          return Promise.resolve(ok(document(EXPECTED_MARKDOWN)));
        },
      }),
    );

    assert.equal(reads, 0);
  });

  it("signale une erreur pour un refus qui n'est pas un emplacement occupe", async () => {
    for (const code of [
      "TASKS_DIRECTORY_NOT_DIRECTORY",
      "TASKS_DIRECTORY_SYMLINK_NOT_ALLOWED",
      "REPOSITORY_NOT_FOUND",
      "DOCUMENT_CREATION_FAILED",
    ] as const) {
      const outcome = await synchronizeTaskDocument(
        REPOSITORY,
        TASK,
        ports({
          createDocument: () =>
            Promise.resolve({ ok: false, failure: { kind: "runner_error", code } }),
        }),
      );

      assert.equal(outcome.kind, "error", `${code} devrait produire une erreur`);
    }
  });

  it("ne divulgue ni jeton ni chemin absolu dans son message", async () => {
    const outcome = await synchronizeTaskDocument(
      REPOSITORY,
      TASK,
      ports({
        createDocument: () => Promise.resolve({ ok: false, failure: { kind: "unreachable" } }),
      }),
    );

    const message = outcome.kind === "error" ? outcome.message : "";
    assert.equal(/[A-Za-z]:\\/.test(message), false);
    assert.equal(message.includes(REPOSITORY), false);
  });
});

describe("synchronizeTaskDocument - reprise idempotente", () => {
  /** Emplacement deja occupe : la creation exclusive a refuse. */
  const occupied: Partial<TaskSyncPorts> = {
    createDocument: () =>
      Promise.resolve({
        ok: false,
        failure: { kind: "runner_error", code: "DOCUMENT_ALREADY_EXISTS" },
      }),
  };

  it("adopte un fichier existant dont le contenu est identique", async () => {
    const outcome = await synchronizeTaskDocument(
      REPOSITORY,
      TASK,
      ports({
        ...occupied,
        readDocument: () => Promise.resolve(ok(document(EXPECTED_MARKDOWN, OTHER_REVISION))),
      }),
    );

    assert.deepEqual(outcome, {
      kind: "synced",
      path: "tasks/TASK-001.md",
      revision: OTHER_REVISION,
    });
  });

  it("produit un conflit lorsque le contenu differe", async () => {
    const outcome = await synchronizeTaskDocument(
      REPOSITORY,
      TASK,
      ports({
        ...occupied,
        readDocument: () => Promise.resolve(ok(document("# Ecrit par un autre programme\n"))),
      }),
    );

    assert.equal(outcome.kind, "conflict");
    assert.match(outcome.kind === "conflict" ? outcome.message : "", /ecrase pas/i);
  });

  it("produit un conflit pour un ecart aussi minime qu'un saut de ligne", async () => {
    const outcome = await synchronizeTaskDocument(
      REPOSITORY,
      TASK,
      ports({
        ...occupied,
        readDocument: () => Promise.resolve(ok(document(`${EXPECTED_MARKDOWN}\n`))),
      }),
    );

    assert.equal(outcome.kind, "conflict");
  });

  it("n'ecrit jamais lorsqu'un fichier different occupe la place", async () => {
    let creations = 0;

    await synchronizeTaskDocument(
      REPOSITORY,
      TASK,
      ports({
        createDocument: () => {
          creations += 1;
          return Promise.resolve({
            ok: false,
            failure: { kind: "runner_error", code: "DOCUMENT_ALREADY_EXISTS" },
          });
        },
        readDocument: () => Promise.resolve(ok(document("# Autre chose\n"))),
      }),
    );

    // Une seule tentative, et aucune ecriture apres la lecture : NOX ne propose
    // aucun forcage.
    assert.equal(creations, 1);
  });

  it("signale une erreur si le fichier existant est illisible", async () => {
    const outcome = await synchronizeTaskDocument(
      REPOSITORY,
      TASK,
      ports({
        ...occupied,
        readDocument: () =>
          Promise.resolve({
            ok: false,
            failure: { kind: "runner_error", code: "DOCUMENT_NOT_UTF8" },
          }),
      }),
    );

    assert.equal(outcome.kind, "error");
    assert.match(outcome.kind === "error" ? outcome.message : "", /occupe/i);
  });

  it("produit le meme resultat a chaque nouvelle tentative", async () => {
    const stable = ports({
      ...occupied,
      readDocument: () => Promise.resolve(ok(document(EXPECTED_MARKDOWN))),
    });

    const first = await synchronizeTaskDocument(REPOSITORY, TASK, stable);
    const second = await synchronizeTaskDocument(REPOSITORY, TASK, stable);
    const third = await synchronizeTaskDocument(REPOSITORY, TASK, stable);

    assert.deepEqual(first, second);
    assert.deepEqual(second, third);
  });

  it("reussit apres une premiere tentative en panne", async () => {
    let attempt = 0;
    const flaky = ports({
      createDocument: () => {
        attempt += 1;
        return attempt === 1
          ? Promise.resolve({ ok: false, failure: { kind: "unreachable" } })
          : Promise.resolve(ok(document(EXPECTED_MARKDOWN)));
      },
    });

    assert.equal((await synchronizeTaskDocument(REPOSITORY, TASK, flaky)).kind, "error");
    assert.equal((await synchronizeTaskDocument(REPOSITORY, TASK, flaky)).kind, "synced");
  });
});
