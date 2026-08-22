import { renderTaskMarkdown, type ProjectDocumentContent } from "@nox/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RunnerResult } from "./runner/errors.ts";
import {
  resynchronizeTaskDocument,
  synchronizeTaskDocument,
  type SynchronizableTask,
  type TaskSyncPorts,
} from "./task-sync.ts";

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


/**
 * Reecriture apres edition.
 *
 * ## Ce que ces tests protegent
 *
 * Deux promesses inverses, et elles tiennent ensemble. NOX reecrit le document
 * quand la specification change ; et NOX n'ecrase **pas** un fichier modifie a
 * la main. La revision attendue est ce qui distingue les deux cas.
 */
describe("resynchronizeTaskDocument", () => {
  const WITH_DEPENDENCIES: SynchronizableTask = {
    ...TASK,
    dependencies: [{ code: "TASK-000", title: "Bootstrap project repository" }],
  };

  it("reecrit le document sous controle de revision", async () => {
    const seen: { revision?: string; content?: string } = {};
    const outcome = await resynchronizeTaskDocument(REPOSITORY, TASK, REVISION, {
      ...ports(),
      updateDocument: (_repository, _path, content, expectedRevision) => {
        seen.content = content;
        seen.revision = expectedRevision;
        return Promise.resolve(ok(document(content, OTHER_REVISION)));
      },
    });

    assert.equal(outcome.kind, "synced");
    assert.equal(outcome.kind === "synced" && outcome.revision, OTHER_REVISION);
    // La revision vient de la base, jamais du formulaire : c'est elle qui prouve
    // que le fichier vise est bien celui que NOX a ecrit.
    assert.equal(seen.revision, REVISION);
    assert.equal(seen.content, EXPECTED_MARKDOWN);
  });

  it("ecrit les dependances dans le document", async () => {
    let written = "";
    await resynchronizeTaskDocument(REPOSITORY, WITH_DEPENDENCIES, REVISION, {
      ...ports(),
      updateDocument: (_repository, _path, content) => {
        written = content;
        return Promise.resolve(ok(document(content, OTHER_REVISION)));
      },
    });

    assert.ok(written.includes("## Dépendances"));
    assert.ok(written.includes("- TASK-000 — Bootstrap project repository"));
  });

  it("n'ecrase pas un document modifie a la main", async () => {
    const outcome = await resynchronizeTaskDocument(REPOSITORY, TASK, REVISION, {
      ...ports(),
      updateDocument: () =>
        Promise.resolve({
          ok: false,
          failure: { kind: "runner_error", code: "DOCUMENT_CONFLICT" },
        }),
    });

    // Un conflit, jamais un forcage : personne ne peut ecraser un fichier sans
    // l'avoir vu. C'est aussi ce qui rend vraie la promesse inverse — editer le
    // Markdown a la main ne modifie pas la tache, et NOX ne detruit pas cette
    // edition en silence.
    assert.equal(outcome.kind, "conflict");
    assert.ok(outcome.kind === "conflict" && outcome.message.includes("en dehors de NOX"));
  });

  it("recree un document disparu", async () => {
    let created = false;
    const outcome = await resynchronizeTaskDocument(REPOSITORY, TASK, REVISION, {
      createDocument: () => {
        created = true;
        return Promise.resolve(ok(document(EXPECTED_MARKDOWN)));
      },
      readDocument: () => Promise.resolve(ok(document(EXPECTED_MARKDOWN))),
      updateDocument: () =>
        Promise.resolve({
          ok: false,
          failure: { kind: "runner_error", code: "DOCUMENT_NOT_FOUND" },
        }),
    });

    // Un document absent n'est pas une panne : c'est quelque chose a creer.
    assert.equal(outcome.kind, "synced");
    assert.equal(created, true);
  });

  it("cree le document quand aucune revision n'est connue", async () => {
    let created = false;
    const outcome = await resynchronizeTaskDocument(REPOSITORY, TASK, null, {
      ...ports(),
      createDocument: () => {
        created = true;
        return Promise.resolve(ok(document(EXPECTED_MARKDOWN)));
      },
      updateDocument: () => {
        throw new Error("ne doit pas etre appele");
      },
    });

    assert.equal(outcome.kind, "synced");
    assert.equal(created, true);
  });

  it("cree le document quand le port de reecriture manque", async () => {
    // Son absence est dite plutot que contournee : la creation reprend son
    // cours, et rien ne pretend avoir reecrit.
    const outcome = await resynchronizeTaskDocument(REPOSITORY, TASK, REVISION, ports());
    assert.equal(outcome.kind, "synced");
  });

  it("signale une panne du runner sans toucher a la base", async () => {
    const outcome = await resynchronizeTaskDocument(REPOSITORY, TASK, REVISION, {
      ...ports(),
      updateDocument: () =>
        Promise.resolve({ ok: false, failure: { kind: "unreachable", detail: "ECONNREFUSED" } }),
    });

    assert.equal(outcome.kind, "error");
  });
});
