import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { isContainedIn, normalizeDocumentPath, resolveDocumentPath } from "./paths.ts";

/**
 * Cree un lien vers un dossier.
 *
 * Sous Windows, une jonction remplit le meme role qu'un lien symbolique de
 * dossier sans exiger de privileges : `lstat` la signale comme un lien et
 * `realpath` la traverse. Les tests de securite s'executent donc reellement,
 * au lieu d'etre systematiquement ignores.
 */
async function createDirectoryLink(target: string, linkPath: string): Promise<void> {
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

let workspace: string;
let repository: string;
let outside: string;

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-doc-paths-"));
  repository = path.join(workspace, "depot");
  outside = path.join(workspace, "hors-depot");

  await mkdir(path.join(repository, "docs", "nested"), { recursive: true });
  await mkdir(outside, { recursive: true });

  await writeFile(path.join(repository, "README.md"), "# Lisez-moi");
  await writeFile(path.join(repository, "docs", "PROJECT_BRIEF.md"), "# Brief");
  await writeFile(path.join(repository, "docs", "nested", "NOTE.md"), "# Note");
  await writeFile(path.join(outside, "SECRET.md"), "# Secret");
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("normalizeDocumentPath - refus", () => {
  it("refuse un chemin vide", () => {
    for (const value of ["", "   "]) {
      const result = normalizeDocumentPath(value);
      assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_REQUIRED", value);
    }
  });

  it("refuse un chemin absolu POSIX", () => {
    const result = normalizeDocumentPath("/etc/passwd.md");
    assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_INVALID");
  });

  it("refuse un chemin absolu Windows", () => {
    for (const value of ["C:\\Windows\\note.md", "C:/Windows/note.md", "\\\\serveur\\part\\a.md"]) {
      const result = normalizeDocumentPath(value);
      assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_INVALID", value);
    }
  });

  it("refuse une URL", () => {
    for (const value of ["file:///etc/passwd.md", "http://exemple.test/a.md"]) {
      const result = normalizeDocumentPath(value);
      assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_INVALID", value);
    }
  });

  it("refuse toute remontee `..`", () => {
    for (const value of [
      "../secret.md",
      "docs/../../secret.md",
      "docs/../docs/NOTE.md",
      "..\\secret.md",
      "docs\\..\\..\\secret.md",
    ]) {
      const result = normalizeDocumentPath(value);
      assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_INVALID", value);
    }
  });

  it("refuse un octet nul", () => {
    const result = normalizeDocumentPath("docs/NOTE.md\0.txt");
    assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_INVALID");
  });

  it("refuse une extension non Markdown", () => {
    for (const value of ["docs/notes.txt", "docs/script.js", "README"]) {
      const result = normalizeDocumentPath(value);
      assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_MARKDOWN", value);
    }
  });

  it("refuse un Markdown hors des emplacements inspectes", () => {
    for (const value of ["src/notes.md", "CHANGELOG.md", "autre/dossier/a.md"]) {
      const result = normalizeDocumentPath(value);
      assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_ALLOWED", value);
    }
  });
});

describe("normalizeDocumentPath - acceptation", () => {
  it("accepte les documents racine reconnus", () => {
    for (const value of ["README.md", "CLAUDE.md", "AGENTS.md"]) {
      assert.equal(normalizeDocumentPath(value).ok, true, value);
    }
  });

  it("accepte les dossiers inspectes", () => {
    for (const value of [
      "docs/PROJECT_BRIEF.md",
      "docs/nested/NOTE.md",
      "decisions/ADR-001.md",
      "plans/CURRENT_PLAN.md",
      "tasks/TASK-001.md",
    ]) {
      assert.equal(normalizeDocumentPath(value).ok, true, value);
    }
  });

  it("normalise les separateurs Windows", () => {
    const result = normalizeDocumentPath("docs\\nested\\NOTE.md");
    assert.equal(result.ok && result.relativePath, "docs/nested/NOTE.md");
  });

  it("retire un prefixe `./` et les segments redondants", () => {
    const result = normalizeDocumentPath("./docs//nested/./NOTE.md");
    assert.equal(result.ok && result.relativePath, "docs/nested/NOTE.md");
  });

  it("accepte espaces et accents", () => {
    const result = normalizeDocumentPath("docs/mon dossier/étude détaillée.md");
    assert.equal(result.ok && result.relativePath, "docs/mon dossier/étude détaillée.md");
  });

  it("accepte une extension en majuscules", () => {
    assert.equal(normalizeDocumentPath("docs/NOTE.MD").ok, true);
  });
});

describe("isContainedIn", () => {
  it("accepte un fichier sous la racine", () => {
    assert.equal(isContainedIn(repository, path.join(repository, "docs", "a.md")), true);
  });

  it("accepte la racine elle-meme", () => {
    assert.equal(isContainedIn(repository, repository), true);
  });

  it("refuse un dossier voisin au nom prefixe", () => {
    // Le piege classique d'une comparaison `startsWith` : `depot-public`
    // commence par `depot` sans etre dedans.
    assert.equal(isContainedIn(repository, `${repository}-public`), false);
  });

  it("refuse un chemin exterieur", () => {
    assert.equal(isContainedIn(repository, path.join(outside, "SECRET.md")), false);
  });
});

describe("resolveDocumentPath", () => {
  it("resout un document existant", () => {
    const result = resolveDocumentPath(repository, "docs/PROJECT_BRIEF.md");

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.relativePath, "docs/PROJECT_BRIEF.md");
    assert.equal(
      result.ok && result.absolutePath.toLowerCase(),
      path.join(repository, "docs", "PROJECT_BRIEF.md").toLowerCase(),
    );
  });

  it("signale un document absent", () => {
    const result = resolveDocumentPath(repository, "docs/ABSENT.md");
    assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_FOUND");
  });

  it("signale un repository absent", () => {
    const result = resolveDocumentPath(path.join(workspace, "nulle-part"), "README.md");
    assert.equal(result.ok === false && result.code, "REPOSITORY_NOT_FOUND");
  });

  it("refuse une traversee avant de toucher au disque", () => {
    const result = resolveDocumentPath(repository, "../hors-depot/SECRET.md");
    assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_INVALID");
  });

  it("refuse un document atteint par un lien menant hors du repository", async () => {
    // Une jonction Windows ne demande aucun privilege, contrairement a un lien
    // symbolique : le cas de securite est donc reellement exerce ici.
    await createDirectoryLink(outside, path.join(repository, "docs", "evasion"));

    const result = resolveDocumentPath(repository, "docs/evasion/SECRET.md");
    assert.equal(result.ok === false && result.code, "DOCUMENT_OUTSIDE_REPOSITORY");
  });

  it("accepte un document atteint par un lien restant dans le repository", async () => {
    await createDirectoryLink(
      path.join(repository, "docs", "nested"),
      path.join(repository, "docs", "raccourci"),
    );

    const result = resolveDocumentPath(repository, "docs/raccourci/NOTE.md");
    assert.equal(result.ok, true);
  });

  it("refuse un lien symbolique de fichier menant hors du repository", async (t) => {
    const linkPath = path.join(repository, "docs", "LIEN_EXTERNE.md");
    try {
      await symlink(path.join(outside, "SECRET.md"), linkPath, "file");
    } catch {
      // Un lien symbolique de fichier exige des droits particuliers sous Windows.
      // Le cas equivalent par jonction est couvert juste au-dessus.
      t.skip("creation de lien symbolique de fichier non autorisee sur cette machine");
      return;
    }

    const result = resolveDocumentPath(repository, "docs/LIEN_EXTERNE.md");
    assert.equal(result.ok === false && result.code, "DOCUMENT_OUTSIDE_REPOSITORY");
  });
});
