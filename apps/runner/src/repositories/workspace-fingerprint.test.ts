/**
 * Tests de l'empreinte du dossier de travail.
 *
 * Sur de **vrais** repositories Git temporaires : l'empreinte doit refleter ce
 * que Git rapporte reellement, et un test qui simulerait `git status` ne
 * prouverait rien de la seule chose qui compte — qu'un fichier modifie a la main
 * apres une review soit detecte.
 *
 * La question posee a chaque test est toujours la meme : « ce changement-la
 * doit-il empecher une reprise ? ». Quand la reponse est oui, l'empreinte doit
 * changer.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { after, describe, it } from "node:test";

import {
  computeWorkspaceFingerprint,
  deriveFingerprintKey,
  fingerprintsMatch,
  parseStatusEntries,
  FINGERPRINT_LIMITS,
} from "./workspace-fingerprint.ts";

const KEY = deriveFingerprintKey("jeton-de-test-0123456789abcdef");
const OTHER_KEY = deriveFingerprintKey("un-autre-jeton-de-runner-fedcba");

const workspaces: string[] = [];

/** Cree un repository Git jetable avec un commit initial. */
async function newRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "nox-fp-"));
  workspaces.push(root);

  const git = (...args: string[]): void => {
    execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  };

  execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" });
  git("config", "user.email", "test@nox.invalid");
  git("config", "user.name", "NOX Test");
  git("config", "core.autocrlf", "false");

  await writeFile(path.join(root, "README.md"), "# Depot\n\nUne ligne.\n", "utf8");
  await writeFile(path.join(root, "garde.md"), "# Garde\n", "utf8");
  git("add", "-A");
  git("commit", "-m", "init");

  return root;
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
}

/** Empreinte d'un repository, ou l'echec du calcul. */
async function fingerprint(root: string, key: Buffer = KEY): Promise<string | null> {
  const result = await computeWorkspaceFingerprint(root, key);
  return result.ok ? result.value : null;
}

after(async () => {
  for (const root of workspaces) {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

describe("parseStatusEntries", () => {
  it("lit les enregistrements separes par NUL", () => {
    const entries = parseStatusEntries(" M README.md\0?? nouveau.md\0");
    assert.deepEqual(entries, [
      { code: " M", path: "README.md" },
      { code: "??", path: "nouveau.md" },
    ]);
  });

  it("conserve un chemin contenant des espaces", () => {
    const entries = parseStatusEntries(" M notes de version.md\0");
    assert.equal(entries[0]?.path, "notes de version.md");
  });

  it("trie les entrees pour ne dependre d'aucun ordre de Git", () => {
    const entries = parseStatusEntries("?? z.md\0 M a.md\0");
    assert.deepEqual(
      entries.map((entry) => entry.path),
      ["a.md", "z.md"],
    );
  });

  it("ignore un enregistrement tronque", () => {
    assert.deepEqual(parseStatusEntries(" M\0"), []);
  });
});

describe("computeWorkspaceFingerprint — stabilite", () => {
  it("produit la meme empreinte pour un etat inchange", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "README.md"), "# Depot\n\nModifie.\n", "utf8");

    const first = await fingerprint(root);
    const second = await fingerprint(root);

    assert.notEqual(first, null);
    assert.equal(first, second);
  });

  it("produit une empreinte pour un repository propre", async () => {
    const root = await newRepository();
    const value = await fingerprint(root);
    assert.equal(typeof value, "string");
    assert.equal(value?.length, 64);
  });

  it("rapporte la branche et le HEAD", async () => {
    const root = await newRepository();
    const result = await computeWorkspaceFingerprint(root, KEY);
    assert.ok(result.ok);
    assert.equal(result.branch, "main");
    assert.equal(result.head.length, 40);
  });
});

describe("computeWorkspaceFingerprint — ce qui doit la faire changer", () => {
  it("detecte un contenu modifie", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "README.md"), "# Depot\n\nA.\n", "utf8");
    const before = await fingerprint(root);

    await writeFile(path.join(root, "README.md"), "# Depot\n\nB.\n", "utf8");
    const after = await fingerprint(root);

    assert.notEqual(before, after);
  });

  it("detecte une modification de meme longueur", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "README.md"), "AAAA\n", "utf8");
    const before = await fingerprint(root);

    // Meme taille, meme nombre de lignes : ni `git status`, ni `--stat` ne
    // verraient la difference dans leurs compteurs.
    await writeFile(path.join(root, "README.md"), "BBBB\n", "utf8");
    const after = await fingerprint(root);

    assert.notEqual(before, after);
  });

  it("detecte un fichier ajoute a la main", async () => {
    const root = await newRepository();
    const before = await fingerprint(root);

    await writeFile(path.join(root, "ajoute.md"), "# Ajoute\n", "utf8");
    const after = await fingerprint(root);

    assert.notEqual(before, after);
  });

  it("detecte un fichier supprime", async () => {
    const root = await newRepository();
    const before = await fingerprint(root);

    await rm(path.join(root, "garde.md"));
    const after = await fingerprint(root);

    assert.notEqual(before, after);
  });

  it("detecte un renommage", async () => {
    const root = await newRepository();
    const before = await fingerprint(root);

    git(root, "mv", "garde.md", "renomme.md");
    const after = await fingerprint(root);

    assert.notEqual(before, after);
  });

  it("detecte une mise en index", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "README.md"), "# Depot\n\nModifie.\n", "utf8");
    const before = await fingerprint(root);

    // Le contenu est identique : seule la colonne d'index change.
    git(root, "add", "README.md");
    const after = await fingerprint(root);

    assert.notEqual(before, after);
  });

  it("detecte un retrait de l'index", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "README.md"), "# Depot\n\nModifie.\n", "utf8");
    git(root, "add", "README.md");
    const before = await fingerprint(root);

    git(root, "reset", "README.md");
    const after = await fingerprint(root);

    assert.notEqual(before, after);
  });

  it("detecte un fichier sensible modifie", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, ".env"), "SECRET=un\n", "utf8");
    const before = await fingerprint(root);

    await writeFile(path.join(root, ".env"), "SECRET=deux\n", "utf8");
    const after = await fingerprint(root);

    assert.notEqual(before, after);
  });

  it("detecte un binaire modifie", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "donnees.bin"), Buffer.from([0, 1, 2, 0, 255]));
    const before = await fingerprint(root);

    await writeFile(path.join(root, "donnees.bin"), Buffer.from([0, 1, 2, 0, 254]));
    const after = await fingerprint(root);

    assert.notEqual(before, after);
  });

  it("detecte un fichier Unicode modifie", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "été.md"), "# Été\n", "utf8");
    const before = await fingerprint(root);

    await writeFile(path.join(root, "été.md"), "# Été chaud\n", "utf8");
    const after = await fingerprint(root);

    assert.notEqual(before, after);
  });

  it("detecte un chemin avec des espaces", async () => {
    const root = await newRepository();
    await mkdir(path.join(root, "mon dossier"), { recursive: true });
    await writeFile(path.join(root, "mon dossier", "notes de version.md"), "# A\n", "utf8");
    const before = await fingerprint(root);

    await writeFile(path.join(root, "mon dossier", "notes de version.md"), "# B\n", "utf8");
    const after = await fingerprint(root);

    assert.notEqual(before, after);
  });

  it("detecte un HEAD different", async () => {
    const root = await newRepository();
    const before = await fingerprint(root);

    await writeFile(path.join(root, "commit.md"), "# Commit\n", "utf8");
    git(root, "add", "-A");
    git(root, "commit", "-m", "second");
    const after = await fingerprint(root);

    assert.notEqual(before, after);
  });

  it("detecte un changement de branche", async () => {
    const root = await newRepository();
    const before = await fingerprint(root);

    // Meme `HEAD`, meme contenu : seule la branche change.
    git(root, "checkout", "-b", "autre");
    const after = await fingerprint(root);

    assert.notEqual(before, after);
  });

  it("depasse la limite d'affichage de la review sans etre aveugle", async () => {
    const root = await newRepository();
    // 250 fichiers : bien au-dela des 200 que la review sait montrer.
    for (let index = 0; index < 250; index += 1) {
      await writeFile(path.join(root, `f${String(index)}.txt`), `contenu ${String(index)}\n`, "utf8");
    }
    const before = await fingerprint(root);

    // Le 249e fichier n'apparaitrait dans aucune liste affichee.
    await writeFile(path.join(root, "f249.txt"), "modifie apres la review\n", "utf8");
    const after = await fingerprint(root);

    assert.notEqual(before, after);
  });
});

describe("computeWorkspaceFingerprint — la cle", () => {
  it("produit une empreinte differente avec un autre jeton de runner", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "README.md"), "# Depot\n\nModifie.\n", "utf8");

    const withKey = await fingerprint(root, KEY);
    const withOther = await fingerprint(root, OTHER_KEY);

    // C'est la consequence assumee : changer `NOX_RUNNER_TOKEN` rend les
    // anciennes empreintes invérifiables, donc bloque la reprise.
    assert.notEqual(withKey, withOther);
  });

  it("derive une cle stable pour un meme jeton", () => {
    assert.deepEqual(deriveFingerprintKey("meme-jeton"), deriveFingerprintKey("meme-jeton"));
  });

  it("ne contient aucun contenu de fichier", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, ".env"), "SECRET=valeur-tres-reconnaissable\n", "utf8");

    const value = await fingerprint(root);

    assert.equal(value?.includes("valeur"), false);
    // Une empreinte est 64 caracteres hexadecimaux, et rien d'autre.
    assert.ok(/^[0-9a-f]{64}$/u.test(value ?? ""));
  });
});

describe("fingerprintsMatch", () => {
  it("reconnait deux empreintes identiques", () => {
    assert.equal(fingerprintsMatch("a".repeat(64), "a".repeat(64)), true);
  });

  it("refuse deux empreintes differentes", () => {
    assert.equal(fingerprintsMatch("a".repeat(64), "b".repeat(64)), false);
  });

  it("refuse des longueurs differentes sans lever", () => {
    assert.equal(fingerprintsMatch("a".repeat(64), "a".repeat(32)), false);
  });

  it("refuse une empreinte vide", () => {
    assert.equal(fingerprintsMatch("", ""), false);
  });
});

describe("computeWorkspaceFingerprint — refus", () => {
  it("refuse au-dela du nombre d'entrees", async () => {
    const root = await newRepository();
    for (let index = 0; index <= FINGERPRINT_LIMITS.maxEntries; index += 1) {
      await writeFile(path.join(root, `n${String(index)}.txt`), "x", "utf8");
    }

    const result = await computeWorkspaceFingerprint(root, KEY);
    // « Je ne sais pas » plutot qu'une empreinte partielle.
    assert.equal(result.ok, false);
  });

  it("refuse un dossier qui n'est pas un repository", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nox-fp-nogit-"));
    workspaces.push(root);

    const result = await computeWorkspaceFingerprint(root, KEY);
    assert.equal(result.ok, false);
  });

  it(
    "ne suit jamais la cible d'un lien symbolique",
    { skip: process.platform === "win32" ? "privilege requis sous Windows" : false },
    async () => {
      const root = await newRepository();
      const outside = await mkdtemp(path.join(os.tmpdir(), "nox-fp-out-"));
      workspaces.push(outside);
      await writeFile(path.join(outside, "secret.txt"), "CONTENU_EXTERIEUR\n", "utf8");

      await symlink(path.join(outside, "secret.txt"), path.join(root, "lien.txt"));
      const before = await fingerprint(root);
      assert.notEqual(before, null);

      // Le contenu de la cible change : l'empreinte ne doit pas bouger, puisque
      // c'est le lien — et non ce qu'il designe — qui appartient au repository.
      await writeFile(path.join(outside, "secret.txt"), "AUTRE_CONTENU_EXTERIEUR\n", "utf8");
      const after = await fingerprint(root);

      assert.equal(before, after);
    },
  );
});
