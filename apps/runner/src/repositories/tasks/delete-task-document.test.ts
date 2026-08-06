import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteTaskDocument } from "./delete-task-document.ts";

let workspace: string;
let repository: string;
let outside: string;

const TASK_ONE = "# TASK-001\n\nSpecification d'origine.\n";
const TASK_TWO = "# TASK-002\n\nUne autre tache.\n";

const FOREIGN_REVISION = "0".repeat(64);

/**
 * Un lien symbolique **de fichier** exige le mode developpeur sous Windows,
 * contrairement aux jonctions. Seul le cas du document-lien y est ignore ; le
 * cas du dossier `tasks/` detourne reste couvert par une jonction.
 */
function skipFileSymlinks(): string | false {
  return process.platform === "win32"
    ? "lien symbolique de fichier : privilege requis sous Windows"
    : false;
}

/** Jonction sous Windows, lien de dossier ailleurs : meme effet, sans privilege. */
const DIRECTORY_LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

function revisionOf(content: string): string {
  return createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-task-delete-"));
  repository = path.join(workspace, "depot");
  outside = path.join(workspace, "hors-depot");

  await mkdir(repository, { recursive: true });
  await mkdir(outside, { recursive: true });
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(async () => {
  await rm(path.join(repository, "tasks"), { recursive: true, force: true });
  await mkdir(path.join(repository, "tasks"), { recursive: true });

  await writeFile(path.join(repository, "tasks", "TASK-001.md"), TASK_ONE, "utf8");
  await writeFile(path.join(repository, "tasks", "TASK-002.md"), TASK_TWO, "utf8");
  await writeFile(path.join(repository, "tasks", "NOTES.md"), "# Notes libres\n", "utf8");
  await writeFile(path.join(outside, "SECRET.md"), "# Secret\n", "utf8");
});

function taskFile(name: string): string {
  return path.join(repository, "tasks", name);
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

describe("deleteTaskDocument - suppression valide", () => {
  it("supprime le document quand la revision correspond", async () => {
    const result = await deleteTaskDocument(repository, "TASK-001", revisionOf(TASK_ONE));

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.deleted, true);
    assert.equal(result.alreadyAbsent, false);
    assert.equal(result.path, "tasks/TASK-001.md");
    assert.equal(await exists(taskFile("TASK-001.md")), false);
  });

  it("ne renvoie aucun chemin absolu", async () => {
    const result = await deleteTaskDocument(repository, "TASK-001", revisionOf(TASK_ONE));

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(repository), false);
    assert.equal(serialized.includes(os.tmpdir()), false);
    assert.equal(path.isAbsolute(result.path), false);
  });

  it("ne touche a aucune autre tache", async () => {
    await deleteTaskDocument(repository, "TASK-001", revisionOf(TASK_ONE));

    assert.equal(await readFile(taskFile("TASK-002.md"), "utf8"), TASK_TWO);
    assert.equal(await readFile(taskFile("NOTES.md"), "utf8"), "# Notes libres\n");
  });

  it("ne supprime jamais le dossier tasks/, meme devenu vide", async () => {
    await rm(taskFile("TASK-002.md"));
    await rm(taskFile("NOTES.md"));
    await deleteTaskDocument(repository, "TASK-001", revisionOf(TASK_ONE));

    const stats = await stat(path.join(repository, "tasks"));
    assert.equal(stats.isDirectory(), true);
    assert.deepEqual(await readdir(path.join(repository, "tasks")), []);
  });
});

describe("deleteTaskDocument - absence idempotente", () => {
  it("traite un document absent comme une reussite", async () => {
    // Une tache dont la synchronisation a echoue n'a jamais eu de fichier :
    // exiger sa presence la rendrait indestructible.
    const result = await deleteTaskDocument(repository, "TASK-404", null);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.deleted, false);
    assert.equal(result.alreadyAbsent, true);
    assert.equal(result.path, "tasks/TASK-404.md");
  });

  it("reste idempotent apres une premiere suppression", async () => {
    const first = await deleteTaskDocument(repository, "TASK-001", revisionOf(TASK_ONE));
    assert.equal(first.ok, true);

    // La reprise apres un echec en base doit pouvoir rejouer cette etape.
    const second = await deleteTaskDocument(repository, "TASK-001", revisionOf(TASK_ONE));
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.deleted, false);
    assert.equal(second.alreadyAbsent, true);
  });

  it("traite un dossier tasks/ absent comme une reussite", async () => {
    await rm(path.join(repository, "tasks"), { recursive: true, force: true });

    const result = await deleteTaskDocument(repository, "TASK-001", null);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.alreadyAbsent, true);
    // Le dossier n'est surtout pas cree pour constater qu'il est vide.
    assert.equal(await exists(path.join(repository, "tasks")), false);
  });
});

describe("deleteTaskDocument - refus", () => {
  it("refuse une revision qui ne correspond pas", async () => {
    const result = await deleteTaskDocument(repository, "TASK-001", FOREIGN_REVISION);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_DELETE_CONFLICT");
    assert.equal(await readFile(taskFile("TASK-001.md"), "utf8"), TASK_ONE);
  });

  it("refuse un document present sans revision connue", async () => {
    // La tache n'a jamais ete synchronisee, mais un fichier occupe son chemin :
    // NOX ne peut pas prouver qu'il lui appartient.
    const result = await deleteTaskDocument(repository, "TASK-001", null);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "TASK_DOCUMENT_REVISION_UNKNOWN");
    assert.equal(await readFile(taskFile("TASK-001.md"), "utf8"), TASK_ONE);
  });

  it("refuse une revision mal formee", async () => {
    const result = await deleteTaskDocument(repository, "TASK-001", "pas-une-empreinte");

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_REVISION_INVALID");
    assert.equal(await exists(taskFile("TASK-001.md")), true);
  });

  it("refuse un code de tache invalide", async () => {
    for (const code of [
      "TASK-1",
      "task-001",
      "TASK-001.md",
      "../TASK-001",
      "TASK-001/../../secret",
      "",
    ]) {
      const result = await deleteTaskDocument(repository, code, FOREIGN_REVISION);
      assert.equal(result.ok, false, code);
      if (result.ok) return;
      assert.equal(result.code, "TASK_CODE_INVALID", code);
    }

    assert.equal(await exists(taskFile("TASK-001.md")), true);
  });

  it("refuse un repository inexistant", async () => {
    const result = await deleteTaskDocument(
      path.join(workspace, "depot-absent"),
      "TASK-001",
      FOREIGN_REVISION,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "REPOSITORY_NOT_FOUND");
  });

  it("refuse quand tasks est un fichier", async () => {
    await rm(path.join(repository, "tasks"), { recursive: true, force: true });
    await writeFile(path.join(repository, "tasks"), "pas un dossier", "utf8");

    const result = await deleteTaskDocument(repository, "TASK-001", FOREIGN_REVISION);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "TASKS_DIRECTORY_NOT_DIRECTORY");
    // NOX ne remplace ni ne supprime ce fichier : c'est a l'utilisateur de
    // trancher.
    assert.equal(await readFile(path.join(repository, "tasks"), "utf8"), "pas un dossier");

    await rm(path.join(repository, "tasks"), { force: true });
  });

  it("refuse quand tasks est un lien", async () => {
    await rm(path.join(repository, "tasks"), { recursive: true, force: true });
    await symlink(outside, path.join(repository, "tasks"), DIRECTORY_LINK_TYPE);

    const result = await deleteTaskDocument(repository, "TASK-001", FOREIGN_REVISION);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "TASKS_DIRECTORY_SYMLINK_NOT_ALLOWED");
    assert.equal(await readFile(path.join(outside, "SECRET.md"), "utf8"), "# Secret\n");

    await rm(path.join(repository, "tasks"), { recursive: true, force: true });
  });

  it("refuse un document de tache qui est un lien", { skip: skipFileSymlinks() }, async () => {
    await rm(taskFile("TASK-001.md"));
    await symlink(path.join(outside, "SECRET.md"), taskFile("TASK-001.md"), "file");

    const result = await deleteTaskDocument(repository, "TASK-001", FOREIGN_REVISION);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_SYMLINK_NOT_WRITABLE");
    assert.equal(await readFile(path.join(outside, "SECRET.md"), "utf8"), "# Secret\n");
  });

  it("refuse un dossier a la place du document", async () => {
    await rm(taskFile("TASK-001.md"));
    await mkdir(taskFile("TASK-001.md"), { recursive: true });

    const result = await deleteTaskDocument(repository, "TASK-001", FOREIGN_REVISION);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_NOT_FILE");
    assert.equal((await stat(taskFile("TASK-001.md"))).isDirectory(), true);
  });
});

describe("deleteTaskDocument - erreurs systeme", () => {
  it("rapporte un echec sans pretendre avoir supprime", async () => {
    const result = await deleteTaskDocument(repository, "TASK-001", revisionOf(TASK_ONE), {
      deleteHooks: { unlink: () => Promise.reject(new Error("EBUSY")) },
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_DELETE_FAILED");
    assert.equal(await readFile(taskFile("TASK-001.md"), "utf8"), TASK_ONE);
  });

  it("refuse d'annoncer une reussite si le fichier est toujours la", async () => {
    const result = await deleteTaskDocument(repository, "TASK-001", revisionOf(TASK_ONE), {
      deleteHooks: { unlink: () => Promise.resolve() },
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_DELETE_FAILED");
    assert.equal(await exists(taskFile("TASK-001.md")), true);
  });
});
