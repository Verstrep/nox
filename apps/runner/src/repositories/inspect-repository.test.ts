/**
 * Inspection d'un repository, cote runner.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'elle constate sans conclure : elle rend des chemins relatifs et des
 * compteurs, jamais un verdict. Et qu'elle ne lit **aucun contenu** — un `.env`
 * present ne fuit pas, parce qu'il n'appartient a aucune liste reconnue et que
 * personne ne l'ouvre.
 *
 * Qu'elle ne suit aucun lien symbolique : un lien nomme `src` ne fait pas
 * croire a du code local.
 *
 * Et qu'un repository sans commit — le cas normal d'un projet neuf — est un
 * etat qu'elle sait decrire, pas une erreur.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { RUNNER_ERROR, classifyRepository, REPOSITORY_SHAPE } from "@nox/shared";

import { inspectRepository } from "./inspect-repository.ts";

let workspace: string;
let counter = 0;

async function newRepository(): Promise<string> {
  counter += 1;
  const root = path.join(workspace, `depot-${String(counter)}`);
  // Un `.git` suffit a en faire un repository aux yeux du resolveur : ce test
  // n'a pas besoin d'un vrai depot pour verifier l'inventaire.
  await mkdir(path.join(root, ".git"), { recursive: true });
  return root;
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-inspect-"));
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("refus", () => {
  it("refuse un chemin relatif", async () => {
    const result = await inspectRepository("depot");
    assert.ok(!result.ok);
    assert.equal(result.code, RUNNER_ERROR.REPOSITORY_PATH_REQUIRED);
  });

  it("refuse un chemin vide", async () => {
    const result = await inspectRepository("   ");
    assert.ok(!result.ok);
    assert.equal(result.code, RUNNER_ERROR.REPOSITORY_PATH_REQUIRED);
  });

  it("refuse un repository inexistant", async () => {
    const result = await inspectRepository(path.join(workspace, "absent"));
    assert.ok(!result.ok);
    assert.equal(result.code, RUNNER_ERROR.REPOSITORY_NOT_FOUND);
  });
});

describe("repository vide", () => {
  it("ne trouve rien, et le dit", async () => {
    const root = await newRepository();
    const result = await inspectRepository(root);

    assert.ok(result.ok);
    assert.deepEqual(result.inspection.manifests, []);
    assert.deepEqual(result.inspection.sourceDirectories, []);
    assert.deepEqual(result.inspection.foundationalDocuments, []);
    assert.equal(result.inspection.rootEntryCount, 0);
    assert.equal(result.inspection.rootEntryCountTruncated, false);
  });

  it("ne compte pas le dossier .git comme une entree", async () => {
    const root = await newRepository();
    const result = await inspectRepository(root);
    assert.ok(result.ok);
    assert.equal(result.inspection.rootEntryCount, 0, "seul .git est present");
  });

  it("se classe comme vide", async () => {
    const root = await newRepository();
    const result = await inspectRepository(root);
    assert.ok(result.ok);
    assert.equal(classifyRepository(result.inspection), REPOSITORY_SHAPE.EMPTY);
  });

  it("n'a aucun commit, et ce n'est pas une erreur", async () => {
    const root = await newRepository();
    const result = await inspectRepository(root);
    assert.ok(result.ok, "un projet neuf s'inspecte quand meme");
    assert.equal(result.inspection.hasCommits, false);
  });
});

describe("repository applicatif", () => {
  it("reconnait un manifeste et un dossier de code", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await mkdir(path.join(root, "src"), { recursive: true });

    const result = await inspectRepository(root);
    assert.ok(result.ok);
    assert.deepEqual(result.inspection.manifests, ["package.json"]);
    assert.deepEqual(result.inspection.sourceDirectories, ["src"]);
    assert.equal(classifyRepository(result.inspection), REPOSITORY_SHAPE.APPLICATION);
  });

  it("reconnait plusieurs manifestes, dans l'ordre de la liste", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "go.mod"), "module test", "utf8");
    await writeFile(path.join(root, "package.json"), "{}", "utf8");

    const result = await inspectRepository(root);
    assert.ok(result.ok);
    assert.deepEqual(result.inspection.manifests, ["package.json", "go.mod"]);
  });

  it("reconnait les documents fondamentaux presents", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "README.md"), "# Titre", "utf8");
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "docs", "ARCHITECTURE.md"), "# Archi", "utf8");

    const result = await inspectRepository(root);
    assert.ok(result.ok);
    assert.deepEqual(result.inspection.foundationalDocuments, [
      "README.md",
      "docs/ARCHITECTURE.md",
    ]);
  });

  it("compte les entrees de la racine", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "a.txt"), "a", "utf8");
    await writeFile(path.join(root, "b.txt"), "b", "utf8");
    await mkdir(path.join(root, "c"), { recursive: true });

    const result = await inspectRepository(root);
    assert.ok(result.ok);
    assert.equal(result.inspection.rootEntryCount, 3);
  });
});

describe("ce qu'elle ne fait pas", () => {
  it("ne lit aucun contenu, et ne signale aucun fichier hors liste", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, ".env"), "SECRET=valeur-tres-secrete", "utf8");
    await writeFile(path.join(root, "credentials.json"), '{"token":"abc"}', "utf8");

    const result = await inspectRepository(root);
    assert.ok(result.ok);

    const rendered = JSON.stringify(result.inspection);
    assert.equal(rendered.includes("valeur-tres-secrete"), false);
    assert.equal(rendered.includes(".env"), false);
    assert.equal(rendered.includes("credentials"), false);

    // Elles comptent comme entrees, sans etre nommees.
    assert.equal(result.inspection.rootEntryCount, 2);
  });

  it("ne rend aucun chemin absolu", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "README.md"), "# Titre", "utf8");

    const result = await inspectRepository(root);
    assert.ok(result.ok);
    assert.equal(JSON.stringify(result.inspection).includes(workspace.replaceAll("\\", "\\\\")), false);
    assert.equal(JSON.stringify(result.inspection).includes(root.replaceAll("\\", "\\\\")), false);
  });

  it("ne suit pas un lien symbolique presente comme un dossier de code", async () => {
    const root = await newRepository();
    const outside = path.join(workspace, `cible-${String(counter)}`);
    await mkdir(outside, { recursive: true });

    try {
      await symlink(outside, path.join(root, "src"), "junction");
    } catch {
      // Certains environnements Windows refusent la creation de liens sans
      // privileges : le test n'a alors rien a prouver ici.
      return;
    }

    const result = await inspectRepository(root);
    assert.ok(result.ok);
    assert.deepEqual(result.inspection.sourceDirectories, [], "un lien n'est pas du code local");
    assert.equal(result.inspection.rootEntryCount, 1, "il compte quand meme comme entree");
  });

  it("n'ecrit rien dans le repository", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "seul.txt"), "a", "utf8");

    await inspectRepository(root);
    await inspectRepository(root);

    const result = await inspectRepository(root);
    assert.ok(result.ok);
    assert.equal(result.inspection.rootEntryCount, 1, "aucune entree n'est apparue");
  });
});

describe("determinisme", () => {
  it("rend deux fois la meme inspection", async () => {
    const root = await newRepository();
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await mkdir(path.join(root, "src"), { recursive: true });

    const first = await inspectRepository(root);
    const second = await inspectRepository(root);
    assert.ok(first.ok && second.ok);
    assert.deepEqual(first.inspection, second.inspection);
  });
});
