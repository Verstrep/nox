import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { createNewFile } from "./create-new-file.ts";

let workspace: string;
let directory: string;

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-create-file-"));
  directory = path.join(workspace, "docs");
  await mkdir(directory, { recursive: true });
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(async () => {
  // Chaque test repart d'un dossier vide : la creation ne doit jamais dependre
  // de ce qu'un test precedent a laisse.
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await mkdir(directory, { recursive: true });
});

const target = () => path.join(directory, "NOUVEAU.md");

describe("createNewFile - creation reussie", () => {
  it("cree le fichier avec son contenu", async () => {
    const result = await createNewFile(target(), Buffer.from("# Nouveau\n", "utf8"));

    assert.equal(result.ok, true);
    assert.equal(await readFile(target(), "utf8"), "# Nouveau\n");
  });

  it("cree un fichier vide", async () => {
    const result = await createNewFile(target(), Buffer.alloc(0));

    assert.equal(result.ok, true);
    assert.equal(await readFile(target(), "utf8"), "");
  });

  it("ecrit les octets exacts qu'on lui donne", async () => {
    const bytes = Buffer.from("# Étude — dépôt 🎯\r\nligne\n", "utf8");
    await createNewFile(target(), bytes);

    assert.deepEqual(await readFile(target()), bytes);
  });

  it("ne cree aucun autre fichier", async () => {
    await createNewFile(target(), Buffer.from("# A\n", "utf8"));
    assert.deepEqual(await readdir(directory), ["NOUVEAU.md"]);
  });

  it("cree un fichier non executable", async () => {
    await createNewFile(target(), Buffer.from("# A\n", "utf8"));

    // Sous Windows, `mode` ne reflete que l'attribut « lecture seule ». Le test
    // verifie donc surtout qu'aucun bit d'execution n'est pose la ou ils
    // existent.
    const mode = (await stat(target())).mode;
    assert.equal((mode & 0o111) !== 0, false, mode.toString(8));
  });
});

describe("createNewFile - non-ecrasement", () => {
  it("refuse un fichier deja present et le laisse intact", async () => {
    await writeFile(target(), "# Contenu d'origine\n", "utf8");

    const result = await createNewFile(target(), Buffer.from("# Ecrasement\n", "utf8"));

    assert.equal(result.ok === false && result.code, "DOCUMENT_ALREADY_EXISTS");
    assert.equal(await readFile(target(), "utf8"), "# Contenu d'origine\n");
  });

  it("refuse un fichier vide deja present", async () => {
    await writeFile(target(), "", "utf8");

    const result = await createNewFile(target(), Buffer.from("# Ecrasement\n", "utf8"));
    assert.equal(result.ok === false && result.code, "DOCUMENT_ALREADY_EXISTS");
  });

  it("refuse un dossier portant le nom demande", async () => {
    await mkdir(target(), { recursive: true });

    const result = await createNewFile(target(), Buffer.from("# A\n", "utf8"));
    assert.equal(result.ok, false);
    assert.equal((await stat(target())).isDirectory(), true);
  });

  it("perd la course contre un autre processus sans rien ecraser", async () => {
    // Le scenario que `exists()` puis `writeFile()` ne couvrirait pas : le
    // fichier apparait entre le controle et l'ouverture.
    const externalContent = "# Ecrit par un autre programme\n";

    const result = await createNewFile(target(), Buffer.from("# NOX\n", "utf8"), {
      writeContent: () => Promise.reject(new Error("jamais atteint")),
    });
    assert.equal(result.ok, false);

    await writeFile(target(), externalContent, "utf8");
    const second = await createNewFile(target(), Buffer.from("# NOX\n", "utf8"));

    assert.equal(second.ok === false && second.code, "DOCUMENT_ALREADY_EXISTS");
    assert.equal(await readFile(target(), "utf8"), externalContent);
  });

  it("refuse un dossier parent inexistant sans le creer", async () => {
    const deep = path.join(directory, "absent", "NOTE.md");

    const result = await createNewFile(deep, Buffer.from("# A\n", "utf8"));

    assert.equal(result.ok === false && result.code, "DOCUMENT_CREATION_FAILED");
    assert.deepEqual(await readdir(directory), []);
  });
});

describe("createNewFile - echecs apres ouverture", () => {
  it("supprime le fichier cree si l'ecriture echoue", async () => {
    const result = await createNewFile(target(), Buffer.from("# Perdu\n", "utf8"), {
      writeContent: () => Promise.reject(new Error("disque plein simule")),
    });

    assert.equal(result.ok === false && result.code, "DOCUMENT_CREATION_FAILED");
    assert.deepEqual(await readdir(directory), []);
  });

  it("supprime le fichier cree si la synchronisation echoue", async () => {
    const result = await createNewFile(target(), Buffer.from("# Perdu\n", "utf8"), {
      synchronize: () => Promise.reject(new Error("fsync simule")),
    });

    assert.equal(result.ok === false && result.code, "DOCUMENT_CREATION_FAILED");
    assert.deepEqual(await readdir(directory), []);
  });

  it("ne laisse jamais un nouveau fichier partiellement ecrit", async () => {
    const result = await createNewFile(target(), Buffer.from("# Perdu\n", "utf8"), {
      writeContent: async (handle) => {
        await handle.writeFile("# Contenu incompl");
        throw new Error("coupure simulee");
      },
    });

    assert.equal(result.ok, false);
    assert.deepEqual(await readdir(directory), []);
  });

  it("ne supprime jamais un fichier qu'il n'a pas cree", async () => {
    // Le nettoyage n'est atteint que si l'ouverture exclusive a reussi, ce qui
    // prouve que la cible n'existait pas. Un fichier existant ne peut donc pas
    // etre supprime par un echec d'ecriture.
    const voisin = path.join(directory, "VOISIN.md");
    await writeFile(voisin, "# Voisin\n", "utf8");

    await createNewFile(target(), Buffer.from("# Perdu\n", "utf8"), {
      writeContent: () => Promise.reject(new Error("echec simule")),
    });

    assert.equal(await readFile(voisin, "utf8"), "# Voisin\n");
  });
});
