import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { isTemporaryFileName, writeFileSafely } from "./safe-write.ts";

let workspace: string;
let directory: string;
let target: string;

const ORIGINAL = "# Version d'origine\n";

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-safe-write-"));
  directory = path.join(workspace, "docs");
  target = path.join(directory, "PROJECT_BRIEF.md");
  await mkdir(directory, { recursive: true });
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(async () => {
  await writeFile(target, ORIGINAL, "utf8");
});

/** Fichiers du dossier, hors document cible : sert a traquer les temporaires. */
async function leftovers(): Promise<string[]> {
  const entries = await readdir(directory);
  return entries.filter((name) => name !== path.basename(target)).sort();
}

describe("writeFileSafely - ecriture reussie", () => {
  it("remplace integralement le contenu", async () => {
    const result = await writeFileSafely(target, Buffer.from("# Nouvelle version\n", "utf8"));

    assert.equal(result.ok, true);
    assert.equal(await readFile(target, "utf8"), "# Nouvelle version\n");
  });

  it("ne laisse aucun fichier temporaire", async () => {
    await writeFileSafely(target, Buffer.from("# A\n", "utf8"));
    assert.deepEqual(await leftovers(), []);
  });

  it("ecrit un contenu vide", async () => {
    const result = await writeFileSafely(target, Buffer.alloc(0));

    assert.equal(result.ok, true);
    assert.equal(await readFile(target, "utf8"), "");
  });

  it("ecrit les octets exacts qu'on lui donne", async () => {
    const bytes = Buffer.from("étude — dépôt\r\nligne\n", "utf8");
    await writeFileSafely(target, bytes);

    assert.deepEqual(await readFile(target), bytes);
  });

  it("ne touche a aucun autre fichier du dossier", async () => {
    const neighbour = path.join(directory, "OTHER.md");
    await writeFile(neighbour, "# Voisin\n", "utf8");

    await writeFileSafely(target, Buffer.from("# Modifie\n", "utf8"));

    assert.equal(await readFile(neighbour, "utf8"), "# Voisin\n");
    await rm(neighbour);
  });

  it("conserve les permissions du fichier remplace", async () => {
    const before = (await stat(target)).mode;
    await writeFileSafely(target, Buffer.from("# Modifie\n", "utf8"));

    // Sous Windows, `mode` ne reflete que l'attribut « lecture seule » : le test
    // verifie donc surtout qu'aucun droit n'est ajoute.
    assert.equal((await stat(target)).mode, before);
  });
});

describe("writeFileSafely - fichier temporaire", () => {
  it("place le temporaire dans le meme dossier que la cible", async () => {
    let seen: string | null = null;

    await writeFileSafely(target, Buffer.from("# A\n", "utf8"), {
      writeTemporary: (temporaryPath) => {
        seen = temporaryPath;
        return writeFile(temporaryPath, "# A\n", "utf8");
      },
    });

    assert.equal(path.dirname(seen ?? ""), directory);
  });

  it("nomme le temporaire de facon reconnaissable et imprevisible", async () => {
    const names: string[] = [];

    for (let index = 0; index < 3; index += 1) {
      await writeFileSafely(target, Buffer.from("# A\n", "utf8"), {
        writeTemporary: (temporaryPath) => {
          names.push(path.basename(temporaryPath));
          return writeFile(temporaryPath, "# A\n", "utf8");
        },
      });
    }

    for (const name of names) {
      assert.equal(isTemporaryFileName(name), true, name);
    }
    assert.equal(new Set(names).size, names.length);
  });

  it("ne donne jamais au temporaire l'extension d'un document", async () => {
    // Consequence directe : l'inventaire, qui ne retient que les `.md`, ne peut
    // pas afficher un temporaire, meme s'il survit a un arret brutal.
    let name = "";

    await writeFileSafely(target, Buffer.from("# A\n", "utf8"), {
      writeTemporary: (temporaryPath) => {
        name = path.basename(temporaryPath);
        return writeFile(temporaryPath, "# A\n", "utf8");
      },
    });

    assert.equal(name.toLowerCase().endsWith(".md"), false);
  });
});

describe("writeFileSafely - echecs", () => {
  it("conserve l'ancien contenu si l'ecriture du temporaire echoue", async () => {
    const result = await writeFileSafely(target, Buffer.from("# Perdu\n", "utf8"), {
      writeTemporary: () => Promise.reject(new Error("disque plein simule")),
    });

    assert.equal(result.ok === false && result.code, "DOCUMENT_TEMPORARY_FILE_FAILED");
    assert.equal(await readFile(target, "utf8"), ORIGINAL);
  });

  it("nettoie le temporaire partiellement ecrit apres un echec", async () => {
    const result = await writeFileSafely(target, Buffer.from("# Perdu\n", "utf8"), {
      writeTemporary: async (temporaryPath) => {
        await writeFile(temporaryPath, "# Contenu incompl", "utf8");
        throw new Error("coupure simulee");
      },
    });

    assert.equal(result.ok, false);
    assert.deepEqual(await leftovers(), []);
  });

  it("conserve l'ancien contenu si le remplacement echoue", async () => {
    const result = await writeFileSafely(target, Buffer.from("# Perdu\n", "utf8"), {
      replace: () => Promise.reject(new Error("fichier verrouille simule")),
    });

    assert.equal(result.ok === false && result.code, "DOCUMENT_WRITE_FAILED");
    assert.equal(await readFile(target, "utf8"), ORIGINAL);
  });

  it("nettoie le temporaire apres un echec de remplacement", async () => {
    await writeFileSafely(target, Buffer.from("# Perdu\n", "utf8"), {
      replace: () => Promise.reject(new Error("fichier verrouille simule")),
    });

    assert.deepEqual(await leftovers(), []);
  });

  it("refuse un nom temporaire deja pris, sans detruire le fichier existant", async () => {
    const collision = path.join(directory, ".nox-collision.tmp");
    await writeFile(collision, "occupe", "utf8");

    const result = await writeFileSafely(target, Buffer.from("# A\n", "utf8"), {
      randomSuffix: () => "collision",
    });

    assert.equal(result.ok === false && result.code, "DOCUMENT_TEMPORARY_FILE_FAILED");
    assert.equal(await readFile(target, "utf8"), ORIGINAL);
    // Le fichier occupant le nom n'appartient pas a cette ecriture : il survit.
    assert.equal(await readFile(collision, "utf8"), "occupe");
    await rm(collision, { force: true });
  });
});
