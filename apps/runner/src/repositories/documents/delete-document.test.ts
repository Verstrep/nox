import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteDocument } from "./delete-document.ts";
import { readDocument } from "./read-document.ts";

let workspace: string;
let repository: string;
let outside: string;

const NOTE = "# Note\n\nUn document ordinaire, avec accents : étude.\n";
const OTHER = "# Autre document\n";

/** Revision syntaxiquement valide mais qui ne correspond a aucun fichier. */
const FOREIGN_REVISION = "0".repeat(64);

/**
 * Un lien symbolique **de fichier** exige le mode developpeur sous Windows,
 * contrairement aux jonctions. Le refus de supprimer un lien y est donc ignore
 * plutot que declare reussi ; le cas d'evasion, lui, reste couvert par une
 * jonction, qui ne demande aucun privilege.
 */
function skipFileSymlinks(): string | false {
  return process.platform === "win32"
    ? "lien symbolique de fichier : privilege requis sous Windows"
    : false;
}

/** Jonction sous Windows, lien de dossier ailleurs : meme effet, sans privilege. */
const DIRECTORY_LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-doc-delete-"));
  repository = path.join(workspace, "depot");
  outside = path.join(workspace, "hors-depot");

  await mkdir(path.join(repository, "docs"), { recursive: true });
  await mkdir(path.join(repository, "tasks"), { recursive: true });
  await mkdir(path.join(repository, "src"), { recursive: true });
  await mkdir(outside, { recursive: true });
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(async () => {
  await rm(path.join(repository, "docs"), { recursive: true, force: true });
  await rm(path.join(repository, "tasks"), { recursive: true, force: true });
  await mkdir(path.join(repository, "docs"), { recursive: true });
  await mkdir(path.join(repository, "tasks"), { recursive: true });

  await writeFile(path.join(repository, "README.md"), "# Lisez-moi\n", "utf8");
  await writeFile(path.join(repository, "docs", "NOTE.md"), NOTE, "utf8");
  await writeFile(path.join(repository, "docs", "OTHER.md"), OTHER, "utf8");
  await writeFile(path.join(repository, "docs", "notes.txt"), "pas du markdown", "utf8");
  await writeFile(path.join(repository, "tasks", "TASK-001.md"), "# TASK-001\n", "utf8");
  await writeFile(path.join(repository, "tasks", "NOTES.md"), "# Notes libres\n", "utf8");
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

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

describe("deleteDocument - suppression valide", () => {
  it("supprime le document du disque", async () => {
    const revision = await currentRevision("docs/NOTE.md");
    const result = await deleteDocument(repository, "docs/NOTE.md", revision);

    assert.equal(result.ok, true);
    assert.equal(await exists(repositoryFile("docs", "NOTE.md")), false);
  });

  it("retourne le chemin relatif et la revision supprimee", async () => {
    const revision = await currentRevision("docs/NOTE.md");
    const result = await deleteDocument(repository, "docs/NOTE.md", revision);

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.path, "docs/NOTE.md");
    assert.equal(result.revision, revision);
  });

  it("ne laisse aucun chemin absolu dans la reponse", async () => {
    const revision = await currentRevision("docs/NOTE.md");
    const result = await deleteDocument(repository, "docs/NOTE.md", revision);

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(repository), false);
    assert.equal(serialized.includes(os.tmpdir()), false);
    assert.equal(path.isAbsolute(result.path), false);
  });

  it("normalise un chemin ecrit avec des separateurs Windows", async () => {
    const revision = await currentRevision("docs/NOTE.md");
    const result = await deleteDocument(repository, "docs\\NOTE.md", revision);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.path, "docs/NOTE.md");
  });

  it("supprime un document a la racine du repository", async () => {
    const revision = await currentRevision("README.md");
    const result = await deleteDocument(repository, "README.md", revision);

    assert.equal(result.ok, true);
    assert.equal(await exists(repositoryFile("README.md")), false);
  });

  it("le document disparait de la lecture ensuite", async () => {
    const revision = await currentRevision("docs/NOTE.md");
    await deleteDocument(repository, "docs/NOTE.md", revision);

    const reread = await readDocument(repository, "docs/NOTE.md");
    assert.equal(reread.ok, false);
    if (reread.ok) return;
    assert.equal(reread.code, "DOCUMENT_NOT_FOUND");
  });
});

describe("deleteDocument - rien d'autre n'est touche", () => {
  it("ne supprime aucun dossier parent, meme devenu vide", async () => {
    const revision = await currentRevision("docs/NOTE.md");
    await deleteDocument(repository, "docs/NOTE.md", revision);
    await rm(repositoryFile("docs", "OTHER.md"));
    await rm(repositoryFile("docs", "notes.txt"));

    const otherRevision = await currentRevision("README.md");
    await deleteDocument(repository, "README.md", otherRevision);

    // `docs/` est vide, et reste la : il fait partie de la structure du
    // repository, pas du document qui s'y trouvait.
    const stats = await stat(repositoryFile("docs"));
    assert.equal(stats.isDirectory(), true);
    assert.deepEqual(await readdir(repositoryFile("docs")), []);
  });

  it("ne modifie aucun autre fichier", async () => {
    const revision = await currentRevision("docs/NOTE.md");
    await deleteDocument(repository, "docs/NOTE.md", revision);

    assert.equal(await readFile(repositoryFile("docs", "OTHER.md"), "utf8"), OTHER);
    assert.equal(await readFile(repositoryFile("docs", "notes.txt"), "utf8"), "pas du markdown");
    assert.equal(await readFile(repositoryFile("README.md"), "utf8"), "# Lisez-moi\n");
    assert.equal(await exists(repositoryFile("tasks", "TASK-001.md")), true);
  });

  it("ne touche a rien hors du repository", async () => {
    await deleteDocument(repository, "docs/NOTE.md", await currentRevision("docs/NOTE.md"));
    assert.equal(await readFile(path.join(outside, "SECRET.md"), "utf8"), "# Secret\n");
  });
});

describe("deleteDocument - documents de tache proteges", () => {
  it("refuse tasks/TASK-001.md", async () => {
    const revision = await currentRevision("tasks/TASK-001.md");
    const result = await deleteDocument(repository, "tasks/TASK-001.md", revision);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_PROTECTED");
    assert.equal(await exists(repositoryFile("tasks", "TASK-001.md")), true);
  });

  it("refuse meme avec une revision correcte", async () => {
    // La protection ne depend pas de la revision : elle porte sur l'identite du
    // fichier, pas sur son etat.
    const revision = await currentRevision("tasks/TASK-001.md");
    const result = await deleteDocument(repository, "tasks/TASK-001.md", revision);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_PROTECTED");
  });

  it("refuse un chemin ecrit autrement mais equivalent", async () => {
    const revision = await currentRevision("tasks/TASK-001.md");

    for (const variant of ["tasks\\TASK-001.md", "./tasks/TASK-001.md", "tasks//TASK-001.md"]) {
      const result = await deleteDocument(repository, variant, revision);
      assert.equal(result.ok, false, variant);
      if (result.ok) return;
      assert.equal(result.code, "DOCUMENT_PROTECTED", variant);
    }

    assert.equal(await exists(repositoryFile("tasks", "TASK-001.md")), true);
  });

  it("autorise un autre document du dossier tasks/", async () => {
    // `tasks/NOTES.md` n'appartient a aucune tache : personne ne le gere a la
    // place de l'utilisateur, il se supprime donc comme n'importe quel document.
    const revision = await currentRevision("tasks/NOTES.md");
    const result = await deleteDocument(repository, "tasks/NOTES.md", revision);

    assert.equal(result.ok, true);
    assert.equal(await exists(repositoryFile("tasks", "NOTES.md")), false);
    assert.equal(await exists(repositoryFile("tasks", "TASK-001.md")), true);
  });
});

describe("deleteDocument - controle de revision", () => {
  it("refuse une revision qui ne correspond plus", async () => {
    const result = await deleteDocument(repository, "docs/NOTE.md", FOREIGN_REVISION);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_DELETE_CONFLICT");
  });

  it("laisse le fichier intact apres un conflit", async () => {
    const revision = await currentRevision("docs/NOTE.md");
    await writeFile(repositoryFile("docs", "NOTE.md"), "# Modifie ailleurs\n", "utf8");

    const result = await deleteDocument(repository, "docs/NOTE.md", revision);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_DELETE_CONFLICT");
    // Le scenario complet de TASK-009 : la version B survit au clic sur Delete
    // parti d'une page affichant la version A.
    assert.equal(
      await readFile(repositoryFile("docs", "NOTE.md"), "utf8"),
      "# Modifie ailleurs\n",
    );
  });

  it("refuse une revision absente", async () => {
    const result = await deleteDocument(repository, "docs/NOTE.md", "");

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_REVISION_REQUIRED");
    assert.equal(await exists(repositoryFile("docs", "NOTE.md")), true);
  });

  it("refuse une revision mal formee", async () => {
    for (const invalid of ["pas-une-empreinte", "abc", "A".repeat(64), "0".repeat(63)]) {
      const result = await deleteDocument(repository, "docs/NOTE.md", invalid);
      assert.equal(result.ok, false, invalid);
      if (result.ok) return;
      assert.equal(result.code, "DOCUMENT_REVISION_INVALID", invalid);
    }

    assert.equal(await exists(repositoryFile("docs", "NOTE.md")), true);
  });
});

describe("deleteDocument - chemins refuses", () => {
  it("refuse un chemin absolu", async () => {
    const revision = await currentRevision("docs/NOTE.md");

    for (const absolute of [
      path.join(outside, "SECRET.md"),
      "/etc/passwd",
      "C:\\Windows\\note.md",
      "file:///etc/passwd",
    ]) {
      const result = await deleteDocument(repository, absolute, revision);
      assert.equal(result.ok, false, absolute);
      if (result.ok) return;
      assert.equal(result.code, "DOCUMENT_PATH_INVALID", absolute);
    }

    assert.equal(await readFile(path.join(outside, "SECRET.md"), "utf8"), "# Secret\n");
  });

  it("refuse une traversee", async () => {
    const revision = await currentRevision("docs/NOTE.md");

    for (const traversal of [
      "../hors-depot/SECRET.md",
      "docs/../../hors-depot/SECRET.md",
      "..\\hors-depot\\SECRET.md",
    ]) {
      const result = await deleteDocument(repository, traversal, revision);
      assert.equal(result.ok, false, traversal);
      if (result.ok) return;
      assert.equal(result.code, "DOCUMENT_PATH_INVALID", traversal);
    }

    assert.equal(await readFile(path.join(outside, "SECRET.md"), "utf8"), "# Secret\n");
  });

  it("refuse un emplacement hors du perimetre inspecte", async () => {
    const revision = await currentRevision("docs/NOTE.md");
    const result = await deleteDocument(repository, "src/GUIDE.md", revision);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_NOT_ALLOWED");
    assert.equal(await exists(repositoryFile("src", "GUIDE.md")), true);
  });

  it("refuse un fichier qui n'est pas du Markdown", async () => {
    const revision = await currentRevision("docs/NOTE.md");
    const result = await deleteDocument(repository, "docs/notes.txt", revision);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_NOT_MARKDOWN");
    assert.equal(await exists(repositoryFile("docs", "notes.txt")), true);
  });

  it("refuse un document absent", async () => {
    const result = await deleteDocument(repository, "docs/ABSENT.md", FOREIGN_REVISION);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_NOT_FOUND");
  });

  it("refuse un dossier", async () => {
    await mkdir(repositoryFile("docs", "DOSSIER.md"), { recursive: true });
    const result = await deleteDocument(repository, "docs/DOSSIER.md", FOREIGN_REVISION);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_NOT_FILE");
    // Le dossier est toujours la : `unlink` n'a meme pas ete tente.
    assert.equal((await stat(repositoryFile("docs", "DOSSIER.md"))).isDirectory(), true);
  });

  it("refuse un repository inexistant", async () => {
    const result = await deleteDocument(
      path.join(workspace, "depot-absent"),
      "docs/NOTE.md",
      FOREIGN_REVISION,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "REPOSITORY_NOT_FOUND");
  });
});

describe("deleteDocument - liens symboliques", () => {
  it("refuse un document qui est un lien, meme confine", { skip: skipFileSymlinks() }, async () => {
    const target = repositoryFile("docs", "OTHER.md");
    const link = repositoryFile("docs", "LIEN.md");
    await symlink(target, link, "file");

    const revision = await currentRevision("docs/LIEN.md");
    const result = await deleteDocument(repository, "docs/LIEN.md", revision);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_SYMLINK_NOT_WRITABLE");
    // Ni le lien ni sa cible n'ont disparu : l'utilisateur doit savoir quel
    // fichier physique il supprime.
    assert.equal(await exists(link), true);
    assert.equal(await readFile(target, "utf8"), OTHER);
  });

  it("refuse un lien sortant du repository", async () => {
    // Jonction plutot que lien de fichier : elle ne demande aucun privilege
    // sous Windows, et l'evasion qu'elle produit est exactement la meme.
    const link = repositoryFile("docs", "SORTANT.md");
    await symlink(outside, link, DIRECTORY_LINK_TYPE);

    const result = await deleteDocument(repository, "docs/SORTANT.md", FOREIGN_REVISION);

    assert.equal(result.ok, false);
    if (result.ok) return;
    // Le confinement apres resolution reelle attrape le lien avant meme le
    // controle de nature : c'est lui qui fait autorite, jamais le nom du chemin.
    assert.equal(result.code, "DOCUMENT_OUTSIDE_REPOSITORY");
    assert.equal(await readFile(path.join(outside, "SECRET.md"), "utf8"), "# Secret\n");

    await rm(link, { recursive: true, force: true });
  });
});

describe("deleteDocument - erreurs systeme", () => {
  it("rapporte un echec de suppression sans pretendre avoir supprime", async () => {
    const revision = await currentRevision("docs/NOTE.md");
    const result = await deleteDocument(repository, "docs/NOTE.md", revision, {
      deleteHooks: {
        unlink: () => Promise.reject(new Error("EBUSY: fichier verrouille")),
      },
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_DELETE_FAILED");
    assert.equal(await exists(repositoryFile("docs", "NOTE.md")), true);
  });

  it("refuse d'annoncer une reussite si le fichier est toujours la", async () => {
    // Une suppression qui n'echoue pas mais ne supprime rien est le pire cas :
    // NOX confirmerait a l'utilisateur un resultat qui n'existe pas.
    const revision = await currentRevision("docs/NOTE.md");
    const result = await deleteDocument(repository, "docs/NOTE.md", revision, {
      deleteHooks: { unlink: () => Promise.resolve() },
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DOCUMENT_DELETE_FAILED");
    assert.equal(await exists(repositoryFile("docs", "NOTE.md")), true);
  });
});
