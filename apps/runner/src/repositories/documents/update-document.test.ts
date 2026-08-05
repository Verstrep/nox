import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { listDocuments } from "./list-documents.ts";
import { readDocument } from "./read-document.ts";
import { computeRevision } from "./revisions.ts";
import { updateDocument } from "./update-document.ts";

let workspace: string;
let repository: string;
let outside: string;

const BRIEF = "# Brief\n\nContenu d'origine avec accents : étude, dépôt.\n";
const OTHER = "# Autre document\n";

/** Revision syntaxiquement valide mais qui ne correspond a aucun fichier. */
const FOREIGN_REVISION = "0".repeat(64);

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-doc-update-"));
  repository = path.join(workspace, "depot");
  outside = path.join(workspace, "hors-depot");

  await mkdir(path.join(repository, "docs"), { recursive: true });
  await mkdir(path.join(repository, "src"), { recursive: true });
  await mkdir(outside, { recursive: true });
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(async () => {
  await writeFile(path.join(repository, "README.md"), "# Lisez-moi\n", "utf8");
  await writeFile(path.join(repository, "docs", "PROJECT_BRIEF.md"), BRIEF, "utf8");
  await writeFile(path.join(repository, "docs", "OTHER.md"), OTHER, "utf8");
  await writeFile(path.join(repository, "docs", "notes.txt"), "pas du markdown", "utf8");
  await writeFile(path.join(repository, "src", "GUIDE.md"), "# Hors perimetre\n", "utf8");
  await writeFile(path.join(outside, "SECRET.md"), "# Secret\n", "utf8");
});

/** Revision actuelle d'un document, telle que la lecture la renvoie. */
async function currentRevision(documentPath: string): Promise<string> {
  const result = await readDocument(repository, documentPath);
  assert.equal(result.ok, true);
  return result.ok ? result.document.revision : "";
}

function repositoryFile(...segments: string[]): string {
  return path.join(repository, ...segments);
}

describe("updateDocument - mise a jour valide", () => {
  it("remplace le contenu du document", async () => {
    const revision = await currentRevision("docs/PROJECT_BRIEF.md");
    const result = await updateDocument(
      repository,
      "docs/PROJECT_BRIEF.md",
      "# Brief revu\n",
      revision,
    );

    assert.equal(result.ok, true);
    assert.equal(await readFile(repositoryFile("docs", "PROJECT_BRIEF.md"), "utf8"), "# Brief revu\n");
  });

  it("retourne une fiche complete et a jour", async () => {
    const revision = await currentRevision("docs/PROJECT_BRIEF.md");
    const result = await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# Court\n", revision);

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.document.path, "docs/PROJECT_BRIEF.md");
    assert.equal(result.document.name, "PROJECT_BRIEF.md");
    assert.equal(result.document.category, "CORE");
    assert.equal(result.document.content, "# Court\n");
    assert.equal(result.document.size, Buffer.byteLength("# Court\n"));
  });

  it("retourne une nouvelle revision, differente de l'ancienne", async () => {
    const revision = await currentRevision("docs/PROJECT_BRIEF.md");
    const result = await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# Autre\n", revision);

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.notEqual(result.document.revision, revision);
    assert.equal(result.document.revision, computeRevision(Buffer.from("# Autre\n", "utf8")));
  });

  it("rend la nouvelle revision immediatement utilisable", async () => {
    const first = await currentRevision("docs/PROJECT_BRIEF.md");
    const saved = await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# Un\n", first);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    // Deux enregistrements successifs sans relire la page : la revision
    // retournee doit suffire au suivant.
    const again = await updateDocument(
      repository,
      "docs/PROJECT_BRIEF.md",
      "# Deux\n",
      saved.document.revision,
    );

    assert.equal(again.ok, true);
    assert.equal(await readFile(repositoryFile("docs", "PROJECT_BRIEF.md"), "utf8"), "# Deux\n");
  });

  it("autorise un document vide", async () => {
    const revision = await currentRevision("docs/PROJECT_BRIEF.md");
    const result = await updateDocument(repository, "docs/PROJECT_BRIEF.md", "", revision);

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.document.content, "");
    assert.equal(result.ok && result.document.size, 0);
    assert.equal(await readFile(repositoryFile("docs", "PROJECT_BRIEF.md"), "utf8"), "");
  });

  it("preserve les accents et les caracteres Unicode", async () => {
    const revision = await currentRevision("docs/PROJECT_BRIEF.md");
    const content = "# Étude\n\nDépôt, naïve, cœur — 🎯\n";
    await updateDocument(repository, "docs/PROJECT_BRIEF.md", content, revision);

    assert.equal(await readFile(repositoryFile("docs", "PROJECT_BRIEF.md"), "utf8"), content);
  });

  it("accepte des separateurs Windows dans le chemin", async () => {
    const revision = await currentRevision("docs/PROJECT_BRIEF.md");
    const result = await updateDocument(repository, "docs\\PROJECT_BRIEF.md", "# Windows\n", revision);

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.document.path, "docs/PROJECT_BRIEF.md");
  });

  it("ne renvoie jamais de chemin absolu", async () => {
    const revision = await currentRevision("README.md");
    const result = await updateDocument(repository, "README.md", "# Titre\n", revision);

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.document);
    assert.equal(serialized.toLowerCase().includes(workspace.toLowerCase()), false);
  });
});

describe("updateDocument - fins de ligne", () => {
  it("conserve les fins de ligne LF du document existant", async () => {
    const revision = await currentRevision("docs/PROJECT_BRIEF.md");
    // Le navigateur soumet toujours du CRLF : sans alignement, tout le fichier
    // changerait de convention.
    await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# Un\r\n# Deux\r\n", revision);

    const written = await readFile(repositoryFile("docs", "PROJECT_BRIEF.md"), "utf8");
    assert.equal(written, "# Un\n# Deux\n");
  });

  it("conserve les fins de ligne CRLF du document existant", async () => {
    const crlf = "# Un\r\n# Deux\r\n";
    await writeFile(repositoryFile("docs", "OTHER.md"), crlf, "utf8");

    const revision = await currentRevision("docs/OTHER.md");
    await updateDocument(repository, "docs/OTHER.md", "# Un\n# Trois\n", revision);

    assert.equal(await readFile(repositoryFile("docs", "OTHER.md"), "utf8"), "# Un\r\n# Trois\r\n");
  });

  it("preserve un BOM existant", async () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# Avec BOM\n", "utf8")]);
    await writeFile(repositoryFile("docs", "OTHER.md"), bom);

    const read = await readDocument(repository, "docs/OTHER.md");
    assert.equal(read.ok, true);
    if (!read.ok) return;

    // Le contenu relu est reenregistre tel quel : le BOM doit survivre.
    const result = await updateDocument(
      repository,
      "docs/OTHER.md",
      read.document.content,
      read.document.revision,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(await readFile(repositoryFile("docs", "OTHER.md")), bom);
  });

  it("n'ajoute aucune fin de ligne finale", async () => {
    const revision = await currentRevision("docs/OTHER.md");
    await updateDocument(repository, "docs/OTHER.md", "# Sans retour final", revision);

    assert.equal(await readFile(repositoryFile("docs", "OTHER.md"), "utf8"), "# Sans retour final");
  });
});

describe("updateDocument - conflit de revision", () => {
  it("refuse une revision qui ne correspond plus au fichier", async () => {
    const revision = await currentRevision("docs/PROJECT_BRIEF.md");

    // Modification exterieure, comme depuis un editeur.
    await writeFile(repositoryFile("docs", "PROJECT_BRIEF.md"), "# Modifie ailleurs\n", "utf8");

    const result = await updateDocument(
      repository,
      "docs/PROJECT_BRIEF.md",
      "# Version de NOX\n",
      revision,
    );

    assert.equal(result.ok === false && result.code, "DOCUMENT_CONFLICT");
  });

  it("laisse le fichier intact apres un conflit", async () => {
    const revision = await currentRevision("docs/PROJECT_BRIEF.md");
    await writeFile(repositoryFile("docs", "PROJECT_BRIEF.md"), "# Modifie ailleurs\n", "utf8");

    await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# Version de NOX\n", revision);

    assert.equal(
      await readFile(repositoryFile("docs", "PROJECT_BRIEF.md"), "utf8"),
      "# Modifie ailleurs\n",
    );
  });

  it("detecte une modification exterieure de meme taille", async () => {
    const revision = await currentRevision("docs/OTHER.md");
    const sameLength = OTHER.replace("Autre", "Autr3");
    assert.equal(sameLength.length, OTHER.length);
    await writeFile(repositoryFile("docs", "OTHER.md"), sameLength, "utf8");

    const result = await updateDocument(repository, "docs/OTHER.md", "# Ecrase\n", revision);
    assert.equal(result.ok === false && result.code, "DOCUMENT_CONFLICT");
  });

  it("refuse une revision absente", async () => {
    const result = await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# X\n", "  ");
    assert.equal(result.ok === false && result.code, "DOCUMENT_REVISION_REQUIRED");
  });

  it("refuse une revision mal formee", async () => {
    for (const revision of ["pas-une-empreinte", "abc", "A".repeat(64), `${"a".repeat(63)}z`]) {
      const result = await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# X\n", revision);
      assert.equal(result.ok === false && result.code, "DOCUMENT_REVISION_INVALID", revision);
    }
  });

  it("ne modifie rien lorsque la revision est refusee", async () => {
    await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# X\n", "");
    await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# X\n", "invalide");
    await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# X\n", FOREIGN_REVISION);

    assert.equal(await readFile(repositoryFile("docs", "PROJECT_BRIEF.md"), "utf8"), BRIEF);
  });
});

describe("updateDocument - chemins refuses", () => {
  it("refuse un chemin vide", async () => {
    const result = await updateDocument(repository, "  ", "# X\n", FOREIGN_REVISION);
    assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_REQUIRED");
  });

  it("refuse un chemin absolu", async () => {
    const result = await updateDocument(
      repository,
      path.join(outside, "SECRET.md"),
      "# Ecrase\n",
      FOREIGN_REVISION,
    );

    assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_INVALID");
    assert.equal(await readFile(path.join(outside, "SECRET.md"), "utf8"), "# Secret\n");
  });

  it("refuse une traversee `..`", async () => {
    for (const documentPath of [
      "../hors-depot/SECRET.md",
      "docs/../../hors-depot/SECRET.md",
      "docs\\..\\..\\hors-depot\\SECRET.md",
    ]) {
      const result = await updateDocument(repository, documentPath, "# Ecrase\n", FOREIGN_REVISION);
      assert.equal(result.ok === false && result.code, "DOCUMENT_PATH_INVALID", documentPath);
    }

    assert.equal(await readFile(path.join(outside, "SECRET.md"), "utf8"), "# Secret\n");
  });

  it("refuse une extension non Markdown", async () => {
    const result = await updateDocument(repository, "docs/notes.txt", "# X\n", FOREIGN_REVISION);

    assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_MARKDOWN");
    assert.equal(await readFile(repositoryFile("docs", "notes.txt"), "utf8"), "pas du markdown");
  });

  it("refuse un emplacement hors du perimetre inspecte", async () => {
    const result = await updateDocument(repository, "src/GUIDE.md", "# X\n", FOREIGN_REVISION);

    assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_ALLOWED");
    assert.equal(await readFile(repositoryFile("src", "GUIDE.md"), "utf8"), "# Hors perimetre\n");
  });

  it("refuse un document inexistant, sans le creer", async () => {
    const result = await updateDocument(repository, "docs/NOUVEAU.md", "# X\n", FOREIGN_REVISION);

    assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_FOUND");
    assert.equal((await readdir(repositoryFile("docs"))).includes("NOUVEAU.md"), false);
  });

  it("refuse un repository absent", async () => {
    const result = await updateDocument(
      path.join(workspace, "jamais-cree"),
      "README.md",
      "# X\n",
      FOREIGN_REVISION,
    );

    assert.equal(result.ok === false && result.code, "REPOSITORY_NOT_FOUND");
  });

  it("refuse un dossier a la place d'un fichier", async () => {
    await mkdir(repositoryFile("docs", "DOSSIER.md"), { recursive: true });

    const result = await updateDocument(repository, "docs/DOSSIER.md", "# X\n", FOREIGN_REVISION);
    assert.equal(result.ok === false && result.code, "DOCUMENT_NOT_FILE");

    await rm(repositoryFile("docs", "DOSSIER.md"), { recursive: true, force: true });
  });
});

describe("updateDocument - liens symboliques", () => {
  it("refuse d'ecrire dans un lien menant hors du repository", async () => {
    // Jonction Windows : aucun privilege requis, le cas est reellement exerce.
    const escape = repositoryFile("docs", "evasion");
    await symlink(outside, escape, process.platform === "win32" ? "junction" : "dir");

    const result = await updateDocument(
      repository,
      "docs/evasion/SECRET.md",
      "# Ecrase\n",
      FOREIGN_REVISION,
    );

    assert.equal(result.ok === false && result.code, "DOCUMENT_OUTSIDE_REPOSITORY");
    assert.equal(await readFile(path.join(outside, "SECRET.md"), "utf8"), "# Secret\n");

    await rm(escape, { recursive: true, force: true });
  });

  it("refuse d'ecrire dans un lien, meme entierement confine", async () => {
    // Une jonction portant un nom en `.md` : le confinement est respecte — la
    // cible est dans le repository — et pourtant l'ecriture est refusee. C'est
    // exactement la garantie ajoutee par TASK-005 : NOX modifie le fichier
    // designe, jamais celui qu'un lien designe a sa place.
    await mkdir(repositoryFile("docs", "cible"), { recursive: true });
    const link = repositoryFile("docs", "LIEN.md");
    await symlink(
      repositoryFile("docs", "cible"),
      link,
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = await updateDocument(repository, "docs/LIEN.md", "# Ecrase\n", FOREIGN_REVISION);
    assert.equal(result.ok === false && result.code, "DOCUMENT_SYMLINK_NOT_WRITABLE");

    await rm(link, { recursive: true, force: true });
    await rm(repositoryFile("docs", "cible"), { recursive: true, force: true });
  });

  it("refuse un document remplace par un lien apres sa lecture", async () => {
    const revision = await currentRevision("docs/OTHER.md");

    // Substitution entre la lecture et l'ecriture : le controle doit encore
    // l'attraper, et le contenu vise rester intact.
    await mkdir(repositoryFile("docs", "cible"), { recursive: true });
    await rm(repositoryFile("docs", "OTHER.md"));
    await symlink(
      repositoryFile("docs", "cible"),
      repositoryFile("docs", "OTHER.md"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = await updateDocument(repository, "docs/OTHER.md", "# Ecrase\n", revision);
    assert.equal(result.ok === false && result.code, "DOCUMENT_SYMLINK_NOT_WRITABLE");
    assert.deepEqual(await readdir(repositoryFile("docs", "cible")), []);

    await rm(repositoryFile("docs", "OTHER.md"), { recursive: true, force: true });
    await rm(repositoryFile("docs", "cible"), { recursive: true, force: true });
  });

  it(
    "refuse d'ecrire dans un lien de fichier",
    { skip: skipFileSymlinks() },
    async () => {
      const link = repositoryFile("docs", "LIEN.md");
      await symlink(repositoryFile("docs", "OTHER.md"), link, "file");

      const result = await updateDocument(repository, "docs/LIEN.md", "# Ecrase\n", FOREIGN_REVISION);

      assert.equal(result.ok === false && result.code, "DOCUMENT_SYMLINK_NOT_WRITABLE");
      // La cible du lien est intacte : NOX n'a pas suivi le lien pour ecrire.
      assert.equal(await readFile(repositoryFile("docs", "OTHER.md"), "utf8"), OTHER);

      await rm(link, { force: true });
    },
  );
});

describe("updateDocument - taille", () => {
  /** Reduit le document a un contenu minuscule et retourne sa revision. */
  async function shrinkOther(): Promise<string> {
    await writeFile(repositoryFile("docs", "OTHER.md"), "ab\n", "utf8");
    return currentRevision("docs/OTHER.md");
  }

  it("refuse un contenu depassant la limite, en octets UTF-8", async () => {
    const revision = await shrinkOther();
    // Six caracteres seulement, mais douze octets : la limite porte bien sur les
    // octets ecrits, pas sur le nombre de caracteres.
    const result = await updateDocument(repository, "docs/OTHER.md", "é".repeat(6), revision, {
      maxBytes: 10,
    });

    assert.equal(result.ok === false && result.code, "DOCUMENT_TOO_LARGE");
    assert.equal(await readFile(repositoryFile("docs", "OTHER.md"), "utf8"), "ab\n");
  });

  it("accepte un contenu qui tient exactement dans la limite", async () => {
    const revision = await shrinkOther();
    const result = await updateDocument(repository, "docs/OTHER.md", "é".repeat(5), revision, {
      maxBytes: 10,
    });

    assert.equal(result.ok, true);
    assert.equal(await readFile(repositoryFile("docs", "OTHER.md"), "utf8"), "é".repeat(5));
  });

  it("refuse un document existant devenu trop volumineux", async () => {
    const revision = await currentRevision("docs/OTHER.md");
    const result = await updateDocument(repository, "docs/OTHER.md", "# X\n", revision, {
      maxBytes: 4,
    });

    assert.equal(result.ok === false && result.code, "DOCUMENT_TOO_LARGE");
  });

  it("refuse un contenu contenant un demi-caractere Unicode isole", async () => {
    const revision = await currentRevision("docs/OTHER.md");
    const result = await updateDocument(repository, "docs/OTHER.md", "avant \uD800 apres", revision);

    assert.equal(result.ok === false && result.code, "DOCUMENT_CONTENT_INVALID");
    assert.equal(await readFile(repositoryFile("docs", "OTHER.md"), "utf8"), OTHER);
  });
});

describe("updateDocument - echecs d'ecriture", () => {
  it("conserve le document si le temporaire echoue", async () => {
    const revision = await currentRevision("docs/PROJECT_BRIEF.md");
    const result = await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# Perdu\n", revision, {
      writeHooks: { writeTemporary: () => Promise.reject(new Error("disque plein simule")) },
    });

    assert.equal(result.ok === false && result.code, "DOCUMENT_TEMPORARY_FILE_FAILED");
    assert.equal(await readFile(repositoryFile("docs", "PROJECT_BRIEF.md"), "utf8"), BRIEF);
  });

  it("conserve le document si le remplacement echoue", async () => {
    const revision = await currentRevision("docs/PROJECT_BRIEF.md");
    const result = await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# Perdu\n", revision, {
      writeHooks: { replace: () => Promise.reject(new Error("verrou simule")) },
    });

    assert.equal(result.ok === false && result.code, "DOCUMENT_WRITE_FAILED");
    assert.equal(await readFile(repositoryFile("docs", "PROJECT_BRIEF.md"), "utf8"), BRIEF);
  });
});

describe("updateDocument - portee des ecritures", () => {
  it("ne modifie qu'un seul document", async () => {
    const revision = await currentRevision("docs/PROJECT_BRIEF.md");
    await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# Seul modifie\n", revision);

    assert.equal(await readFile(repositoryFile("docs", "OTHER.md"), "utf8"), OTHER);
    assert.equal(await readFile(repositoryFile("README.md"), "utf8"), "# Lisez-moi\n");
    assert.equal(await readFile(repositoryFile("src", "GUIDE.md"), "utf8"), "# Hors perimetre\n");
  });

  it("ne cree ni ne supprime aucun fichier", async () => {
    const before = (await readdir(repositoryFile("docs"))).sort();

    const revision = await currentRevision("docs/PROJECT_BRIEF.md");
    await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# Modifie\n", revision);
    await updateDocument(repository, "docs/ABSENT.md", "# X\n", FOREIGN_REVISION);
    await updateDocument(repository, "../hors-depot/SECRET.md", "# X\n", FOREIGN_REVISION);

    assert.deepEqual((await readdir(repositoryFile("docs"))).sort(), before);
  });

  it("ne laisse aucun fichier temporaire dans l'inventaire", async () => {
    const revision = await currentRevision("docs/PROJECT_BRIEF.md");
    await updateDocument(repository, "docs/PROJECT_BRIEF.md", "# Modifie\n", revision);

    const inventory = await listDocuments(repository);
    assert.equal(inventory.ok, true);
    if (!inventory.ok) return;

    assert.equal(
      inventory.documents.some((document) => document.name.startsWith(".nox-")),
      false,
    );
  });
});

/**
 * Un lien symbolique **de fichier** exige le mode developpeur sous Windows,
 * contrairement aux jonctions. Le refus d'ecriture dans un lien y est donc
 * ignore ; le cas d'evasion, lui, reste couvert par une jonction.
 */
function skipFileSymlinks(): string | false {
  return process.platform === "win32"
    ? "lien symbolique de fichier : privilege requis sous Windows"
    : false;
}
