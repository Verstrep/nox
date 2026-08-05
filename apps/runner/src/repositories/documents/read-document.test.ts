import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { readDocument } from "./read-document.ts";

let workspace: string;
let repository: string;
let outside: string;

const BRIEF_CONTENT = "# Brief\n\nUn contenu **Markdown** avec des accents : étude, dépôt.\n";

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-doc-read-"));
  repository = path.join(workspace, "depot");
  outside = path.join(workspace, "hors-depot");

  await mkdir(path.join(repository, "docs", "nested"), { recursive: true });
  await mkdir(path.join(repository, "docs", "un dossier"), { recursive: true });
  await mkdir(outside, { recursive: true });

  await writeFile(path.join(repository, "README.md"), "# Lisez-moi");
  await writeFile(path.join(repository, "docs", "PROJECT_BRIEF.md"), BRIEF_CONTENT);
  await writeFile(path.join(repository, "docs", "VIDE.md"), "");
  await writeFile(path.join(repository, "docs", "nested", "NOTE.md"), "# Note");
  await writeFile(path.join(repository, "docs", "un dossier", "étude détaillée.md"), "# Etude");
  await writeFile(path.join(repository, "docs", "notes.txt"), "pas du markdown");
  await writeFile(path.join(outside, "SECRET.md"), "# Secret");

  // Fichier binaire renomme en `.md` : doit etre rejete, pas affiche corrompu.
  await writeFile(path.join(repository, "docs", "BINAIRE.md"), Buffer.from([0xff, 0xfe, 0x00, 0x80]));
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("readDocument - lecture valide", () => {
  it("lit un document et renseigne sa fiche", async () => {
    const result = await readDocument(repository, "docs/PROJECT_BRIEF.md");

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.document.path, "docs/PROJECT_BRIEF.md");
    assert.equal(result.document.name, "PROJECT_BRIEF.md");
    assert.equal(result.document.category, "CORE");
    assert.equal(result.document.content, BRIEF_CONTENT);
    assert.equal(result.document.size, Buffer.byteLength(BRIEF_CONTENT));
    assert.match(result.document.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("preserve les accents en UTF-8", async () => {
    const result = await readDocument(repository, "docs/PROJECT_BRIEF.md");
    assert.equal(result.ok && result.document.content.includes("étude, dépôt"), true);
  });

  it("lit un document vide", async () => {
    const result = await readDocument(repository, "docs/VIDE.md");

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.document.content, "");
    assert.equal(result.ok && result.document.size, 0);
  });

  it("lit un chemin contenant espaces et accents", async () => {
    const result = await readDocument(repository, "docs/un dossier/étude détaillée.md");
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.document.name, "étude détaillée.md");
  });

  it("accepte des separateurs Windows en entree et retourne un chemin relatif", async () => {
    const result = await readDocument(repository, "docs\\nested\\NOTE.md");

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.document.path, "docs/nested/NOTE.md");
  });

  it("ne retourne jamais de chemin absolu", async () => {
    const result = await readDocument(repository, "README.md");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.document);
    assert.equal(serialized.toLowerCase().includes(workspace.toLowerCase()), false);
    assert.equal(path.isAbsolute(result.document.path), false);
  });
});

describe("readDocument - refus", () => {
  it("refuse un chemin vide", async () => {
    const result = await readDocument(repository, "  ");
    assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_REQUIRED");
  });

  it("refuse un chemin absolu", async () => {
    const result = await readDocument(repository, path.join(outside, "SECRET.md"));
    assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_INVALID");
  });

  it("refuse une traversee `..`", async () => {
    for (const documentPath of [
      "../hors-depot/SECRET.md",
      "docs/../../hors-depot/SECRET.md",
      "docs\\..\\..\\hors-depot\\SECRET.md",
    ]) {
      const result = await readDocument(repository, documentPath);
      assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_INVALID", documentPath);
    }
  });

  it("refuse un fichier absent", async () => {
    const result = await readDocument(repository, "docs/ABSENT.md");
    assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_FOUND");
  });

  it("refuse un dossier a la place d'un fichier", async () => {
    const result = await readDocument(repository, "docs/nested.md");
    // `docs/nested` existe mais sans extension `.md` : le chemin demande n'existe pas.
    assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_FOUND");
  });

  it("refuse une extension non Markdown", async () => {
    const result = await readDocument(repository, "docs/notes.txt");
    assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_MARKDOWN");
  });

  it("refuse un Markdown hors des emplacements inspectes", async () => {
    const result = await readDocument(repository, "src/GUIDE.md");
    assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_ALLOWED");
  });

  it("refuse un contenu qui n'est pas de l'UTF-8 valide", async () => {
    const result = await readDocument(repository, "docs/BINAIRE.md");
    assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_UTF8");
  });

  it("refuse un fichier trop volumineux sans le lire", async () => {
    const result = await readDocument(repository, "docs/PROJECT_BRIEF.md", { maxBytes: 4 });
    assert.equal(result.ok === false && result.code, "DOCUMENT_TOO_LARGE");
  });

  it("refuse un repository absent", async () => {
    const result = await readDocument(path.join(workspace, "jamais-cree"), "README.md");
    assert.equal(result.ok === false && result.code, "REPOSITORY_NOT_FOUND");
  });

  it("refuse un document atteint par un lien menant hors du repository", async () => {
    // Jonction Windows : le cas de securite est reellement exerce, sans
    // privilege particulier.
    await symlink(
      outside,
      path.join(repository, "docs", "evasion"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = await readDocument(repository, "docs/evasion/SECRET.md");
    assert.equal(result.ok === false && result.code, "DOCUMENT_OUTSIDE_REPOSITORY");
  });
});

describe("readDocument - lecture seule", () => {
  it("ne cree ni ne modifie aucun fichier", async () => {
    const before = (await readdir(path.join(repository, "docs"))).sort();

    await readDocument(repository, "docs/PROJECT_BRIEF.md");
    await readDocument(repository, "docs/ABSENT.md");
    await readDocument(repository, "../hors-depot/SECRET.md");

    const after = (await readdir(path.join(repository, "docs"))).sort();
    assert.deepEqual(after, before);
  });
});
