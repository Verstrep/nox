import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { listDocuments } from "./list-documents.ts";

let workspace: string;

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-doc-list-"));
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Cree un repository jetable dont l'arborescence est decrite par un objet. */
async function createRepository(
  name: string,
  files: Record<string, string> = {},
): Promise<string> {
  const repository = path.join(workspace, name);
  await mkdir(repository, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(repository, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }

  return repository;
}

function paths(result: Awaited<ReturnType<typeof listDocuments>>): string[] {
  assert.equal(result.ok, true);
  return result.ok ? result.documents.map((document) => document.path) : [];
}

describe("listDocuments - repository", () => {
  it("signale un chemin vide", async () => {
    const result = await listDocuments("   ");
    assert.equal(result.ok === false && result.code, "REPOSITORY_PATH_REQUIRED");
  });

  it("signale un chemin relatif", async () => {
    const result = await listDocuments("./depot");
    assert.equal(result.ok === false && result.code, "REPOSITORY_PATH_REQUIRED");
  });

  it("signale un repository disparu", async () => {
    const result = await listDocuments(path.join(workspace, "jamais-cree"));
    assert.equal(result.ok === false && result.code, "REPOSITORY_NOT_FOUND");
  });

  it("signale un fichier a la place d'un dossier", async () => {
    const filePath = path.join(workspace, "un-fichier.txt");
    await writeFile(filePath, "contenu");

    const result = await listDocuments(filePath);
    assert.equal(result.ok === false && result.code, "REPOSITORY_NOT_DIRECTORY");
  });

  it("retourne une liste vide pour un repository sans document", async () => {
    const repository = await createRepository("vide", { "src/index.ts": "export {};" });

    const result = await listDocuments(repository);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.documents, []);
  });
});

describe("listDocuments - decouverte", () => {
  it("trouve les documents racine reconnus", async () => {
    const repository = await createRepository("racine", {
      "README.md": "# Lisez-moi",
      "CLAUDE.md": "# Regles",
      "AGENTS.md": "# Agents",
      "CHANGELOG.md": "# Journal",
      "LICENSE.md": "# Licence",
    });

    // CHANGELOG et LICENSE sont volontairement ignores : hors perimetre.
    assert.deepEqual(paths(await listDocuments(repository)), [
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
    ]);
  });

  it("trouve les documents des dossiers inspectes, y compris imbriques", async () => {
    const repository = await createRepository("dossiers", {
      "docs/PROJECT_BRIEF.md": "# Brief",
      "docs/nested/NOTE.md": "# Note",
      "docs/nested/deep/DEEP.md": "# Profond",
      "decisions/ADR-001.md": "# ADR",
      "plans/CURRENT_PLAN.md": "# Plan",
      "tasks/TASK-001.md": "# Tache",
    });

    // `PROJECT_BRIEF.md` est CORE, les deux notes sont DOCUMENTATION. A
    // l'interieur d'une categorie, le tri est alphabetique et insensible a la
    // casse : `nested/deep` precede `nested/NOTE`.
    assert.deepEqual(paths(await listDocuments(repository)), [
      "docs/PROJECT_BRIEF.md",
      "docs/nested/deep/DEEP.md",
      "docs/nested/NOTE.md",
      "decisions/ADR-001.md",
      "plans/CURRENT_PLAN.md",
      "tasks/TASK-001.md",
    ]);
  });

  it("ignore les fichiers non Markdown", async () => {
    const repository = await createRepository("melange", {
      "docs/NOTE.md": "# Note",
      "docs/image.png": "binaire",
      "docs/data.json": "{}",
      "docs/script.ts": "export {};",
    });

    assert.deepEqual(paths(await listDocuments(repository)), ["docs/NOTE.md"]);
  });

  it("ignore les dossiers interdits", async () => {
    const repository = await createRepository("interdits", {
      "docs/NOTE.md": "# Note",
      "docs/node_modules/paquet/README.md": "# Dependance",
      "docs/dist/GENERE.md": "# Genere",
      "docs/coverage/RAPPORT.md": "# Rapport",
      "docs/.git/INTERNE.md": "# Interne",
      "docs/vendor/TIERS.md": "# Tiers",
    });

    assert.deepEqual(paths(await listDocuments(repository)), ["docs/NOTE.md"]);
  });

  it("ne parcourt pas les dossiers hors perimetre", async () => {
    const repository = await createRepository("hors-perimetre", {
      "docs/NOTE.md": "# Note",
      "src/GUIDE.md": "# Guide",
      "packages/lib/README.md": "# Bibliotheque",
    });

    assert.deepEqual(paths(await listDocuments(repository)), ["docs/NOTE.md"]);
  });

  it("accepte espaces et accents dans les chemins", async () => {
    const repository = await createRepository("accents", {
      "docs/mon dossier/étude détaillée.md": "# Etude",
    });

    assert.deepEqual(paths(await listDocuments(repository)), [
      "docs/mon dossier/étude détaillée.md",
    ]);
  });
});

describe("listDocuments - metadonnees et ordre", () => {
  it("renseigne nom, categorie, taille et date", async () => {
    const content = "# Brief\n\nUn contenu de test.";
    const repository = await createRepository("metadonnees", {
      "docs/PROJECT_BRIEF.md": content,
    });

    const result = await listDocuments(repository);
    assert.equal(result.ok, true);

    const [document] = result.ok ? result.documents : [];
    assert.equal(document?.name, "PROJECT_BRIEF.md");
    assert.equal(document?.category, "CORE");
    assert.equal(document?.size, Buffer.byteLength(content));
    assert.match(document?.updatedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  });

  it("ne retourne que des chemins relatifs", async () => {
    const repository = await createRepository("relatifs", {
      "README.md": "# Lisez-moi",
      "docs/NOTE.md": "# Note",
    });

    const result = await listDocuments(repository);
    assert.equal(result.ok, true);

    for (const document of result.ok ? result.documents : []) {
      assert.equal(path.isAbsolute(document.path), false, document.path);
      assert.equal(document.path.includes("\\"), false, document.path);
      assert.equal(document.path.toLowerCase().includes(workspace.toLowerCase()), false);
    }
  });

  it("ordonne par categorie puis par chemin", async () => {
    const repository = await createRepository("ordre", {
      "tasks/TASK-002.md": "",
      "tasks/TASK-001.md": "",
      "plans/PLAN.md": "",
      "decisions/ADR-002.md": "",
      "decisions/ADR-001.md": "",
      "docs/zeta.md": "",
      "docs/alpha.md": "",
      "docs/ARCHITECTURE.md": "",
      "README.md": "",
    });

    // `README.md` et `docs/ARCHITECTURE.md` sont tous deux CORE ; le tri
    // alphabetique insensible a la casse place `docs/` avant `README`.
    assert.deepEqual(paths(await listDocuments(repository)), [
      "docs/ARCHITECTURE.md",
      "README.md",
      "docs/alpha.md",
      "docs/zeta.md",
      "decisions/ADR-001.md",
      "decisions/ADR-002.md",
      "plans/PLAN.md",
      "tasks/TASK-001.md",
      "tasks/TASK-002.md",
    ]);
  });
});

describe("listDocuments - limites", () => {
  it("respecte la profondeur maximale", async () => {
    const repository = await createRepository("profondeur", {
      "docs/a.md": "",
      "docs/1/b.md": "",
      "docs/1/2/c.md": "",
      "docs/1/2/3/d.md": "",
    });

    // Profondeur 1 = le contenu direct de `docs/`.
    assert.deepEqual(paths(await listDocuments(repository, { maxDepth: 1 })), ["docs/a.md"]);
    assert.deepEqual(paths(await listDocuments(repository, { maxDepth: 2 })), [
      "docs/1/b.md",
      "docs/a.md",
    ]);
    assert.equal(paths(await listDocuments(repository, { maxDepth: 6 })).length, 4);
  });

  it("refuse un inventaire depassant le nombre maximal", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 12; index++) {
      files[`docs/note-${String(index).padStart(2, "0")}.md`] = "";
    }
    const repository = await createRepository("trop-nombreux", files);

    const result = await listDocuments(repository, { maxDocuments: 5 });
    assert.equal(result.ok === false && result.code, "TOO_MANY_DOCUMENTS");
  });

  it("accepte un inventaire exactement a la limite", async () => {
    const repository = await createRepository("limite-exacte", {
      "docs/a.md": "",
      "docs/b.md": "",
      "docs/c.md": "",
    });

    const result = await listDocuments(repository, { maxDocuments: 3 });
    assert.equal(result.ok, true);
  });

  it("ne suit pas les liens vers des dossiers exterieurs", async () => {
    const repository = await createRepository("liens", { "docs/NOTE.md": "# Note" });
    const externe = path.join(workspace, "cible-externe");
    await mkdir(externe, { recursive: true });
    await writeFile(path.join(externe, "SECRET.md"), "# Secret");

    // Jonction sous Windows : aucun privilege requis, le cas est donc
    // reellement exerce et non ignore.
    await symlink(
      externe,
      path.join(repository, "docs", "lien"),
      process.platform === "win32" ? "junction" : "dir",
    );

    assert.deepEqual(paths(await listDocuments(repository)), ["docs/NOTE.md"]);
  });

  it("ne suit pas non plus un lien vers un dossier interne", async () => {
    // Sinon un raccourci interne dupliquerait chaque document dans la liste.
    const repository = await createRepository("liens-internes", {
      "docs/nested/NOTE.md": "# Note",
    });

    await symlink(
      path.join(repository, "docs", "nested"),
      path.join(repository, "docs", "raccourci"),
      process.platform === "win32" ? "junction" : "dir",
    );

    assert.deepEqual(paths(await listDocuments(repository)), ["docs/nested/NOTE.md"]);
  });
});
