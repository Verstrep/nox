import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { createDocument } from "./create-document.ts";
import { listDocuments } from "./list-documents.ts";
import { readDocument } from "./read-document.ts";
import { computeRevision } from "./revisions.ts";
import { updateDocument } from "./update-document.ts";

let workspace: string;
let repository: string;
let outside: string;

const README = "# Lisez-moi\n";

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-doc-create-"));
  repository = path.join(workspace, "depot");
  outside = path.join(workspace, "hors-depot");
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, "SECRET.md"), "# Secret\n", "utf8");
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(async () => {
  // Le repository est reconstruit a chaque test : la creation modifie
  // l'arborescence, et un test ne doit jamais dependre du precedent.
  await rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await mkdir(path.join(repository, "docs", "existing"), { recursive: true });
  await mkdir(path.join(repository, "decisions"), { recursive: true });
  await mkdir(path.join(repository, "plans"), { recursive: true });
  await mkdir(path.join(repository, "tasks"), { recursive: true });
  await mkdir(path.join(repository, "src"), { recursive: true });

  await writeFile(path.join(repository, "README.md"), README, "utf8");
  await writeFile(path.join(repository, "docs", "OCCUPE.md"), "# Deja la\n", "utf8");
  await writeFile(path.join(repository, "docs", "fichier-parent"), "pas un dossier", "utf8");
});

function repositoryFile(...segments: string[]): string {
  return path.join(repository, ...segments);
}

describe("createDocument - creations valides", () => {
  it("cree un document dans docs/", async () => {
    const result = await createDocument(repository, "docs/PRODUCT_VISION.md", "# Vision\n");

    assert.equal(result.ok, true);
    assert.equal(await readFile(repositoryFile("docs", "PRODUCT_VISION.md"), "utf8"), "# Vision\n");
  });

  it("renseigne la fiche complete du document cree", async () => {
    const result = await createDocument(repository, "docs/PRODUCT_VISION.md", "# Vision\n");

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.document.path, "docs/PRODUCT_VISION.md");
    assert.equal(result.document.name, "PRODUCT_VISION.md");
    assert.equal(result.document.category, "CORE");
    assert.equal(result.document.content, "# Vision\n");
    assert.equal(result.document.size, Buffer.byteLength("# Vision\n"));
    assert.match(result.document.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("retourne une revision utilisable immediatement", async () => {
    const created = await createDocument(repository, "docs/NOTE.md", "# Note\n");
    assert.equal(created.ok, true);
    if (!created.ok) return;

    assert.equal(created.document.revision, computeRevision(Buffer.from("# Note\n", "utf8")));

    // La revision retournee suffit a enchainer une modification, sans relire.
    const updated = await updateDocument(
      repository,
      "docs/NOTE.md",
      "# Note revue\n",
      created.document.revision,
    );
    assert.equal(updated.ok, true);
    assert.equal(await readFile(repositoryFile("docs", "NOTE.md"), "utf8"), "# Note revue\n");
  });

  it("rend le document immediatement lisible", async () => {
    await createDocument(repository, "docs/NOTE.md", "# Note\n");

    const read = await readDocument(repository, "docs/NOTE.md");
    assert.equal(read.ok && read.document.content, "# Note\n");
  });

  it("rend le document immediatement inventorie", async () => {
    await createDocument(repository, "decisions/ADR-003-runner.md", "# ADR 003\n");

    const inventory = await listDocuments(repository);
    assert.equal(inventory.ok, true);
    if (!inventory.ok) return;

    const entry = inventory.documents.find((doc) => doc.path === "decisions/ADR-003-runner.md");
    assert.equal(entry?.category, "DECISION");
  });

  it("accepte un contenu vide", async () => {
    const result = await createDocument(repository, "docs/VIDE.md", "");

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.document.size, 0);
    assert.equal(await readFile(repositoryFile("docs", "VIDE.md"), "utf8"), "");
  });

  it("accepte les accents, emoji et espaces dans le nom comme dans le contenu", async () => {
    const content = "# Étude détaillée\n\nDépôt, naïve, cœur — 🎯\n";
    const result = await createDocument(repository, "docs/étude détaillée.md", content);

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.document.name, "étude détaillée.md");
    assert.equal(await readFile(repositoryFile("docs", "étude détaillée.md"), "utf8"), content);
  });

  it("cree dans un sous-dossier existant", async () => {
    const result = await createDocument(repository, "docs/existing/INSTALLATION.md", "# Install\n");

    assert.equal(result.ok, true);
    assert.equal(
      await readFile(repositoryFile("docs", "existing", "INSTALLATION.md"), "utf8"),
      "# Install\n",
    );
  });

  it("cree un document racine autorise et absent", async () => {
    const result = await createDocument(repository, "CLAUDE.md", "# Regles\n");

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.document.category, "CORE");
    assert.equal(await readFile(repositoryFile("CLAUDE.md"), "utf8"), "# Regles\n");
  });

  it("cree dans decisions/, plans/ et tasks/", async () => {
    for (const [documentPath, category] of [
      ["decisions/ADR-004.md", "DECISION"],
      ["plans/CURRENT_PLAN.md", "PLAN"],
      ["tasks/TASK-007.md", "TASK"],
    ] as const) {
      const result = await createDocument(repository, documentPath, "# X\n");
      assert.equal(result.ok, true, documentPath);
      assert.equal(result.ok && result.document.category, category, documentPath);
    }
  });

  it("accepte des separateurs Windows en entree", async () => {
    const result = await createDocument(repository, "docs\\existing\\NOTE.md", "# Note\n");

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.document.path, "docs/existing/NOTE.md");
  });

  it("ne renvoie jamais de chemin absolu", async () => {
    const result = await createDocument(repository, "docs/NOTE.md", "# Note\n");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.document);
    assert.equal(serialized.toLowerCase().includes(workspace.toLowerCase()), false);
  });
});

describe("createDocument - non-ecrasement", () => {
  it("refuse un document deja present et le laisse intact", async () => {
    const result = await createDocument(repository, "docs/OCCUPE.md", "# Ecrasement\n");

    assert.equal(result.ok === false && result.code, "DOCUMENT_ALREADY_EXISTS");
    assert.equal(await readFile(repositoryFile("docs", "OCCUPE.md"), "utf8"), "# Deja la\n");
  });

  it("refuse un document racine deja present", async () => {
    const result = await createDocument(repository, "README.md", "# Ecrasement\n");

    assert.equal(result.ok === false && result.code, "DOCUMENT_ALREADY_EXISTS");
    assert.equal(await readFile(repositoryFile("README.md"), "utf8"), README);
  });

  it("refuse un fichier apparu apres le controle d'existence", async () => {
    // Le scenario de concurrence : la cible est absente au controle, presente a
    // l'ouverture. Seule l'ouverture exclusive protege ici.
    const externalContent = "# Ecrit par un autre programme\n";
    let created = false;

    const result = await createDocument(repository, "docs/COURSE.md", "# NOX\n", {
      createHooks: {
        writeContent: async (handle, data) => {
          await handle.writeFile(data);
        },
      },
    });
    assert.equal(result.ok, true);

    // Deuxieme tentative sur la meme cible, desormais occupee par un contenu
    // exterieur : c'est exactement l'etat qu'une course produit.
    await writeFile(repositoryFile("docs", "COURSE.md"), externalContent, "utf8");
    created = true;

    const second = await createDocument(repository, "docs/COURSE.md", "# NOX\n");
    assert.equal(created, true);
    assert.equal(second.ok === false && second.code, "DOCUMENT_ALREADY_EXISTS");
    assert.equal(await readFile(repositoryFile("docs", "COURSE.md"), "utf8"), externalContent);
  });

  it("refuse un dossier portant le nom demande", async () => {
    await mkdir(repositoryFile("docs", "DOSSIER.md"), { recursive: true });

    const result = await createDocument(repository, "docs/DOSSIER.md", "# X\n");
    assert.equal(result.ok === false && result.code, "DOCUMENT_ALREADY_EXISTS");
  });
});

describe("createDocument - emplacements refuses", () => {
  it("refuse un document racine non reconnu", async () => {
    const result = await createDocument(repository, "CHANGELOG.md", "# Journal\n");

    assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_ALLOWED");
    assert.equal((await readdir(repository)).includes("CHANGELOG.md"), false);
  });

  it("refuse un dossier hors perimetre", async () => {
    const result = await createDocument(repository, "src/NOTES.md", "# Notes\n");

    assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_ALLOWED");
    assert.deepEqual(await readdir(repositoryFile("src")), []);
  });

  it("refuse une extension non Markdown", async () => {
    const result = await createDocument(repository, "docs/note.txt", "texte\n");
    assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_MARKDOWN");
  });

  it("refuse un chemin absolu", async () => {
    const result = await createDocument(
      repository,
      path.join(outside, "INJECTE.md"),
      "# Injecte\n",
    );

    assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_INVALID");
    assert.deepEqual((await readdir(outside)).sort(), ["SECRET.md"]);
  });

  it("refuse une traversee `..`", async () => {
    for (const documentPath of [
      "../hors-depot/INJECTE.md",
      "docs/../../hors-depot/INJECTE.md",
      "docs\\..\\..\\hors-depot\\INJECTE.md",
    ]) {
      const result = await createDocument(repository, documentPath, "# Injecte\n");
      assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_INVALID", documentPath);
    }

    assert.deepEqual((await readdir(outside)).sort(), ["SECRET.md"]);
  });

  it("refuse un chemin vide", async () => {
    const result = await createDocument(repository, "   ", "# X\n");
    assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_REQUIRED");
  });

  it("refuse un repository absent", async () => {
    const result = await createDocument(
      path.join(workspace, "jamais-cree"),
      "docs/NOTE.md",
      "# X\n",
    );

    assert.equal(result.ok === false && result.code, "REPOSITORY_NOT_FOUND");
  });
});

describe("createDocument - dossiers parents", () => {
  it("refuse un dossier parent absent, sans le creer", async () => {
    const result = await createDocument(repository, "docs/missing/NOTE.md", "# Note\n");

    assert.equal(result.ok === false && result.code, "DOCUMENT_PARENT_NOT_FOUND");
    assert.equal((await readdir(repositoryFile("docs"))).includes("missing"), false);
  });

  it("refuse un parent profond absent", async () => {
    const result = await createDocument(repository, "docs/a/b/c/NOTE.md", "# Note\n");

    assert.equal(result.ok === false && result.code, "DOCUMENT_PARENT_NOT_FOUND");
    assert.equal((await readdir(repositoryFile("docs"))).includes("a"), false);
  });

  it("refuse un parent qui est un fichier", async () => {
    const result = await createDocument(repository, "docs/fichier-parent/NOTE.md", "# Note\n");

    assert.equal(result.ok === false && result.code, "DOCUMENT_PARENT_NOT_DIRECTORY");
    assert.equal(await readFile(repositoryFile("docs", "fichier-parent"), "utf8"), "pas un dossier");
  });

  it("refuse un parent qui est un lien, meme confine", async () => {
    // Jonction Windows : aucun privilege requis, le cas est reellement exerce.
    // La cible reste dans le repository, et le refus s'applique quand meme :
    // l'utilisateur doit savoir dans quel dossier physique le fichier atterrit.
    await symlink(
      repositoryFile("docs", "existing"),
      repositoryFile("docs", "lien"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = await createDocument(repository, "docs/lien/NOTE.md", "# Note\n");

    assert.equal(result.ok === false && result.code, "DOCUMENT_PARENT_SYMLINK_NOT_ALLOWED");
    assert.deepEqual(await readdir(repositoryFile("docs", "existing")), []);
  });

  it("refuse un lien de dossier menant hors du repository", async () => {
    await symlink(
      outside,
      repositoryFile("docs", "evasion"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = await createDocument(repository, "docs/evasion/INJECTE.md", "# Injecte\n");

    assert.equal(result.ok === false && result.code, "DOCUMENT_PARENT_SYMLINK_NOT_ALLOWED");
    assert.deepEqual((await readdir(outside)).sort(), ["SECRET.md"]);
  });
});

describe("createDocument - noms non portables", () => {
  it("refuse un nom de peripherique Windows", async () => {
    for (const documentPath of ["docs/CON.md", "docs/lpt1.md", "docs/NUL.md"]) {
      const result = await createDocument(repository, documentPath, "# X\n");
      assert.equal(result.ok === false && result.code, "DOCUMENT_NAME_NOT_PORTABLE", documentPath);
    }
  });

  it("refuse les caracteres interdits sous Windows", async () => {
    for (const documentPath of ["docs/note?.md", "docs/note*.md", 'docs/note".md', "docs/a|b.md"]) {
      const result = await createDocument(repository, documentPath, "# X\n");
      assert.equal(result.ok === false && result.code, "DOCUMENT_NAME_NOT_PORTABLE", documentPath);
    }
  });

  it("refuse un espace ou un point final de segment", async () => {
    for (const documentPath of ["docs/existing /NOTE.md", "docs/note.md."]) {
      const result = await createDocument(repository, documentPath, "# X\n");
      assert.equal(result.ok, false, documentPath);
    }
  });

  it("tolere les espaces autour du chemin saisi", async () => {
    // Les espaces qui entourent la saisie sont retires — c'est le comportement
    // attendu d'un champ de formulaire. Ceux qui terminent un segment, eux,
    // restent refuses : ils seraient tronques par Windows.
    const result = await createDocument(repository, "  docs/PROPRE.md  ", "# X\n");

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.document.path, "docs/PROPRE.md");
  });

  it("ne cree rien lorsqu'un nom est refuse", async () => {
    const before = (await readdir(repositoryFile("docs"))).sort();

    await createDocument(repository, "docs/CON.md", "# X\n");
    await createDocument(repository, "docs/note?.md", "# X\n");

    assert.deepEqual((await readdir(repositoryFile("docs"))).sort(), before);
  });
});

describe("createDocument - contenu", () => {
  it("refuse un contenu depassant la limite, en octets UTF-8", async () => {
    const result = await createDocument(repository, "docs/GROS.md", "é".repeat(6), {
      maxBytes: 10,
    });

    assert.equal(result.ok === false && result.code, "DOCUMENT_TOO_LARGE");
    assert.equal((await readdir(repositoryFile("docs"))).includes("GROS.md"), false);
  });

  it("accepte un contenu qui tient exactement dans la limite", async () => {
    const result = await createDocument(repository, "docs/JUSTE.md", "é".repeat(5), {
      maxBytes: 10,
    });

    assert.equal(result.ok, true);
  });

  it("refuse un demi-caractere Unicode isole", async () => {
    const result = await createDocument(repository, "docs/CASSE.md", "avant \uD800 apres");

    assert.equal(result.ok === false && result.code, "DOCUMENT_CONTENT_INVALID");
    assert.equal((await readdir(repositoryFile("docs"))).includes("CASSE.md"), false);
  });
});

describe("createDocument - portee des ecritures", () => {
  it("ne modifie aucun autre fichier", async () => {
    await createDocument(repository, "docs/NOUVEAU.md", "# Nouveau\n");

    assert.equal(await readFile(repositoryFile("README.md"), "utf8"), README);
    assert.equal(await readFile(repositoryFile("docs", "OCCUPE.md"), "utf8"), "# Deja la\n");
  });

  it("ne cree aucun dossier", async () => {
    const before = (await readdir(repository)).sort();

    await createDocument(repository, "docs/NOUVEAU.md", "# A\n");
    await createDocument(repository, "docs/missing/NOTE.md", "# A\n");
    await createDocument(repository, "nouveaudossier/NOTE.md", "# A\n");

    assert.deepEqual((await readdir(repository)).sort(), before);
  });

  it("ne laisse aucun fichier apres un echec d'ecriture", async () => {
    const result = await createDocument(repository, "docs/PERDU.md", "# Perdu\n", {
      createHooks: { writeContent: () => Promise.reject(new Error("disque plein simule")) },
    });

    assert.equal(result.ok === false && result.code, "DOCUMENT_CREATION_FAILED");
    assert.equal((await readdir(repositoryFile("docs"))).includes("PERDU.md"), false);
  });

  it("ne laisse aucun fichier apres un echec de synchronisation", async () => {
    const result = await createDocument(repository, "docs/PERDU.md", "# Perdu\n", {
      createHooks: { synchronize: () => Promise.reject(new Error("fsync simule")) },
    });

    assert.equal(result.ok === false && result.code, "DOCUMENT_CREATION_FAILED");
    assert.equal((await readdir(repositoryFile("docs"))).includes("PERDU.md"), false);
  });

  it("ne laisse aucun fichier temporaire dans l'inventaire", async () => {
    await createDocument(repository, "docs/NOUVEAU.md", "# Nouveau\n");

    const inventory = await listDocuments(repository);
    assert.equal(inventory.ok, true);
    if (!inventory.ok) return;

    assert.equal(
      inventory.documents.some((document) => document.name.startsWith(".nox-")),
      false,
    );
  });
});
