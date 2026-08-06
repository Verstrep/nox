import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { computeRevision } from "../documents/revisions.ts";
import { listDocuments } from "../documents/list-documents.ts";
import { readDocument } from "../documents/read-document.ts";
import { createTaskDocument } from "./create-task-document.ts";
import { ensureTasksDirectory } from "./tasks-directory.ts";

let workspace: string;
let repository: string;

const CONTENT = "# TASK-001 — Une tache\n\n## Objectif\n\nFaire quelque chose.\n";

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-task-doc-"));
  repository = path.join(workspace, "depot");
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(async () => {
  // Le repository est reconstruit a chaque test : ces tests creent des dossiers,
  // et aucun ne doit dependre du precedent.
  await rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await mkdir(path.join(repository, "docs"), { recursive: true });
});

function repositoryFile(...segments: string[]): string {
  return path.join(repository, ...segments);
}

describe("createTaskDocument - creations valides", () => {
  it("cree le dossier tasks/ lorsqu'il est absent", async () => {
    assert.equal(await readdir(repository).then((names) => names.includes("tasks")), false);

    const result = await createTaskDocument(repository, "TASK-001", CONTENT);

    assert.equal(result.ok, true);
    assert.equal((await stat(repositoryFile("tasks"))).isDirectory(), true);
    assert.equal(await readFile(repositoryFile("tasks", "TASK-001.md"), "utf8"), CONTENT);
  });

  it("reutilise le dossier tasks/ lorsqu'il existe deja", async () => {
    await mkdir(repositoryFile("tasks"));
    await writeFile(repositoryFile("tasks", "TEMOIN.md"), "# Temoin\n", "utf8");

    const result = await createTaskDocument(repository, "TASK-002", CONTENT);

    assert.equal(result.ok, true);
    // Le contenu preexistant du dossier est intact.
    assert.equal(await readFile(repositoryFile("tasks", "TEMOIN.md"), "utf8"), "# Temoin\n");
  });

  it("ne cree aucun autre dossier que tasks/", async () => {
    const before = (await readdir(repository)).sort();

    await createTaskDocument(repository, "TASK-001", CONTENT);

    const after = (await readdir(repository)).sort();
    assert.deepEqual(after, [...before, "tasks"].sort());
    // Rien non plus a l'interieur de `tasks/`.
    assert.deepEqual(await readdir(repositoryFile("tasks")), ["TASK-001.md"]);
  });

  it("fixe lui-meme le chemin du document", async () => {
    const result = await createTaskDocument(repository, "TASK-123", CONTENT);

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.document.path, "tasks/TASK-123.md");
    assert.equal(result.document.name, "TASK-123.md");
    assert.equal(result.document.category, "TASK");
    assert.equal(result.document.content, CONTENT);
  });

  it("retourne la revision reelle du fichier ecrit", async () => {
    const result = await createTaskDocument(repository, "TASK-001", CONTENT);

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.document.revision, computeRevision(Buffer.from(CONTENT, "utf8")));
  });

  it("rend le document immediatement lisible et inventorie", async () => {
    await createTaskDocument(repository, "TASK-001", CONTENT);

    const read = await readDocument(repository, "tasks/TASK-001.md");
    assert.equal(read.ok, true);
    assert.equal(read.ok ? read.document.content : null, CONTENT);

    const inventory = await listDocuments(repository);
    assert.equal(inventory.ok, true);
    assert.equal(
      inventory.ok
        ? inventory.documents.some((document) => document.path === "tasks/TASK-001.md")
        : false,
      true,
    );
  });

  it("accepte un code a plus de trois chiffres", async () => {
    const result = await createTaskDocument(repository, "TASK-1042", CONTENT);

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.document.path : null, "tasks/TASK-1042.md");
  });

  it("preserve le contenu Unicode octet pour octet", async () => {
    const unicode = "# TASK-001 — Étude 日本語 🎯\n";
    const result = await createTaskDocument(repository, "TASK-001", unicode);

    assert.equal(result.ok, true);
    assert.equal(await readFile(repositoryFile("tasks", "TASK-001.md"), "utf8"), unicode);
  });
});

describe("createTaskDocument - validation du code", () => {
  const INVALID_CODES = [
    "TASK-1",
    "TASK-01",
    "task-001",
    "TASK-001.md",
    "TASK-001/../../secret",
    "../TASK-001",
    "TASK-001 ",
    "TASK-00A",
    "",
    "CON",
  ];

  for (const code of INVALID_CODES) {
    it(`refuse le code « ${code} »`, async () => {
      const result = await createTaskDocument(repository, code, CONTENT);

      assert.equal(result.ok, false);
      assert.equal(result.ok ? null : result.code, "TASK_CODE_INVALID");
      // Un code refuse ne doit meme pas faire apparaitre le dossier.
      assert.equal((await readdir(repository)).includes("tasks"), false);
    });
  }
});

describe("createTaskDocument - refus", () => {
  it("ne remplace jamais un document existant", async () => {
    await mkdir(repositoryFile("tasks"));
    await writeFile(repositoryFile("tasks", "TASK-001.md"), "# Ecrit ailleurs\n", "utf8");

    const result = await createTaskDocument(repository, "TASK-001", CONTENT);

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, "DOCUMENT_ALREADY_EXISTS");
    assert.equal(
      await readFile(repositoryFile("tasks", "TASK-001.md"), "utf8"),
      "# Ecrit ailleurs\n",
    );
  });

  it("n'attribue le fichier qu'a une seule creation concurrente", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () => createTaskDocument(repository, "TASK-001", CONTENT)),
    );

    const succeeded = attempts.filter((attempt) => attempt.ok);
    assert.equal(succeeded.length, 1, "une seule creation doit reussir");

    for (const failed of attempts.filter((attempt) => !attempt.ok)) {
      assert.equal(failed.ok ? null : failed.code, "DOCUMENT_ALREADY_EXISTS");
    }

    assert.equal(await readFile(repositoryFile("tasks", "TASK-001.md"), "utf8"), CONTENT);
  });

  it("refuse lorsque tasks est un fichier", async () => {
    await writeFile(repositoryFile("tasks"), "pas un dossier", "utf8");

    const result = await createTaskDocument(repository, "TASK-001", CONTENT);

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, "TASKS_DIRECTORY_NOT_DIRECTORY");
    // Le fichier occupant la place est intact : NOX ne renomme ni ne supprime.
    assert.equal(await readFile(repositoryFile("tasks"), "utf8"), "pas un dossier");
  });

  it("refuse lorsque tasks est un lien de dossier", async () => {
    const cible = path.join(workspace, "taches-ailleurs");
    await rm(cible, { recursive: true, force: true });
    await mkdir(cible, { recursive: true });

    // Une jonction Windows ne demande aucun privilege, contrairement a un lien
    // symbolique de fichier.
    await symlink(cible, repositoryFile("tasks"), process.platform === "win32" ? "junction" : "dir");

    const result = await createTaskDocument(repository, "TASK-001", CONTENT);

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, "TASKS_DIRECTORY_SYMLINK_NOT_ALLOWED");
    // Rien n'a ete depose de l'autre cote du lien.
    assert.deepEqual(await readdir(cible), []);
  });

  it("refuse un repository inexistant", async () => {
    const result = await createTaskDocument(
      path.join(workspace, "depot-fantome"),
      "TASK-001",
      CONTENT,
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, "REPOSITORY_NOT_FOUND");
  });

  it("refuse un contenu trop volumineux sans creer le dossier", async () => {
    const result = await createTaskDocument(repository, "TASK-001", "a".repeat(64), {
      maxBytes: 10,
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, "DOCUMENT_TOO_LARGE");
    assert.equal((await readdir(repository)).includes("tasks"), false);
  });

  it("refuse un contenu qui n'est pas de l'UTF-8 valide", async () => {
    const result = await createTaskDocument(repository, "TASK-001", `# Titre \uD800 suite`);

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, "DOCUMENT_CONTENT_INVALID");
    assert.equal((await readdir(repository)).includes("tasks"), false);
  });

  it("supprime le fichier cree lorsque l'ecriture echoue", async () => {
    const result = await createTaskDocument(repository, "TASK-001", CONTENT, {
      createHooks: {
        writeContent: () => Promise.reject(new Error("disque plein")),
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, "DOCUMENT_CREATION_FAILED");
    // Le dossier reste — il a bien ete cree —, mais aucun fichier partiel.
    assert.deepEqual(await readdir(repositoryFile("tasks")), []);
  });
});

describe("ensureTasksDirectory", () => {
  it("est idempotent", async () => {
    const first = await ensureTasksDirectory(repository);
    const second = await ensureTasksDirectory(repository);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.ok && second.ok ? first.directory === second.directory : false, true);
  });

  it("survit a des appels concurrents", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => ensureTasksDirectory(repository)),
    );

    for (const result of results) {
      assert.equal(result.ok, true);
    }
    assert.equal((await stat(repositoryFile("tasks"))).isDirectory(), true);
  });
});
