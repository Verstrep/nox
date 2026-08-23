/**
 * Nettoyage des documents de taches d'un projet supprime.
 *
 * ## Ce que ce fichier protege
 *
 * La liste des fichiers touches vient **entierement** des codes recus, et ces
 * codes viennent de la base. Un fichier `tasks/TASK-999.md` qu'aucune tache ne
 * revendique n'est jamais candidat, et aucun chemin ne peut etre injecte : le
 * runner compose `tasks/<code>.md` lui-meme.
 *
 * La difference assumee avec la suppression d'une tache : un document modifie a
 * la main est retire, et son sort est **annonce** comme tel. Ce qui n'a pas
 * change : un lien, un dossier ou un echec systeme sont refuses, et rien
 * d'autre que `unlink` n'est jamais appele.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteProjectTaskDocuments } from "./delete-project-documents.ts";

let workspace: string;
let repository: string;

const TASK_ZERO = "# TASK-000\n\nAmorcage.\n";
const TASK_ONE = "# TASK-001\n\nSpecification d'origine.\n";
const TASK_TWO = "# TASK-002\n\nUne autre tache.\n";
const FOREIGN = "# TASK-999\n\nEcrit par quelqu'un d'autre.\n";

const FOREIGN_REVISION = "0".repeat(64);

/**
 * Un lien symbolique **de fichier** exige le mode developpeur sous Windows,
 * contrairement aux jonctions.
 */
function skipFileSymlinks(): string | false {
  return process.platform === "win32"
    ? "lien symbolique de fichier : privilege requis sous Windows"
    : false;
}

function revisionOf(content: string): string {
  return createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
}

function taskFile(name: string): string {
  return path.join(repository, "tasks", name);
}

async function entries(): Promise<string[]> {
  return (await readdir(path.join(repository, "tasks"))).sort();
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-project-clean-"));
  repository = path.join(workspace, "depot");
  await mkdir(repository, { recursive: true });
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(async () => {
  await rm(path.join(repository, "tasks"), { recursive: true, force: true });
  await mkdir(path.join(repository, "tasks"), { recursive: true });
  await writeFile(taskFile("TASK-000.md"), TASK_ZERO, "utf8");
  await writeFile(taskFile("TASK-001.md"), TASK_ONE, "utf8");
  await writeFile(taskFile("TASK-002.md"), TASK_TWO, "utf8");
  await writeFile(taskFile("TASK-999.md"), FOREIGN, "utf8");
  await writeFile(path.join(repository, "README.md"), "# Depot\n", "utf8");
});

describe("nettoyage des artefacts d'un projet", () => {
  it("retire les documents dont NOX connait la revision", async () => {
    const result = await deleteProjectTaskDocuments(repository, [
      { taskCode: "TASK-000", expectedRevision: revisionOf(TASK_ZERO) },
      { taskCode: "TASK-001", expectedRevision: revisionOf(TASK_ONE) },
    ]);

    assert.ok(result.ok);
    assert.deepEqual(
      result.documents.map((entry) => entry.outcome),
      ["REMOVED", "REMOVED"],
    );
    assert.deepEqual(
      result.documents.map((entry) => entry.path),
      ["tasks/TASK-000.md", "tasks/TASK-001.md"],
    );
    assert.deepEqual(await entries(), ["TASK-002.md", "TASK-999.md"]);
  });

  it("laisse intact un fichier de meme forme qu'aucune tache ne revendique", async () => {
    // Le scenario que le module existe pour rendre impossible : NOX ne balaie
    // pas `tasks/*.md`, il retire une liste. `TASK-999.md` n'y figure pas.
    const result = await deleteProjectTaskDocuments(repository, [
      { taskCode: "TASK-001", expectedRevision: revisionOf(TASK_ONE) },
    ]);

    assert.ok(result.ok);
    assert.equal(await readFile(taskFile("TASK-999.md"), "utf8"), FOREIGN);
  });

  it("ne touche a aucun autre fichier du repository", async () => {
    await deleteProjectTaskDocuments(repository, [
      { taskCode: "TASK-000", expectedRevision: revisionOf(TASK_ZERO) },
      { taskCode: "TASK-001", expectedRevision: revisionOf(TASK_ONE) },
      { taskCode: "TASK-002", expectedRevision: revisionOf(TASK_TWO) },
    ]);

    assert.equal(await readFile(path.join(repository, "README.md"), "utf8"), "# Depot\n");
    // Le dossier survit a son dernier document : il fait partie de la structure
    // du repository, pas des fichiers qu'on y a ecrits.
    assert.deepEqual(await entries(), ["TASK-999.md"]);
  });

  it("retire un document modifie a la main, et le dit", async () => {
    await writeFile(taskFile("TASK-001.md"), "# TASK-001\n\nReecrit a la main.\n", "utf8");

    const result = await deleteProjectTaskDocuments(repository, [
      { taskCode: "TASK-001", expectedRevision: revisionOf(TASK_ONE) },
    ]);

    assert.ok(result.ok);
    // La revision ne decide plus, mais elle parle encore : le sort est distinct
    // d'un retrait ordinaire, et l'interface le repercute.
    assert.equal(result.documents[0]?.outcome, "REMOVED_MODIFIED");
    assert.deepEqual(await entries(), ["TASK-000.md", "TASK-002.md", "TASK-999.md"]);
  });

  it("traite un document deja absent comme une reussite", async () => {
    await rm(taskFile("TASK-002.md"));

    const result = await deleteProjectTaskDocuments(repository, [
      { taskCode: "TASK-002", expectedRevision: revisionOf(TASK_TWO) },
    ]);

    assert.ok(result.ok);
    assert.equal(result.documents[0]?.outcome, "ABSENT");
  });

  it("reussit sans dossier tasks/, et ne le cree pas", async () => {
    await rm(path.join(repository, "tasks"), { recursive: true, force: true });

    const result = await deleteProjectTaskDocuments(repository, [
      { taskCode: "TASK-001", expectedRevision: revisionOf(TASK_ONE) },
    ]);

    assert.ok(result.ok);
    assert.equal(result.documents[0]?.outcome, "ABSENT");
    await assert.rejects(readdir(path.join(repository, "tasks")));
  });

  it("accepte une liste vide sans rien toucher", async () => {
    const result = await deleteProjectTaskDocuments(repository, []);

    assert.ok(result.ok);
    assert.deepEqual(result.documents, []);
    assert.deepEqual(await entries(), [
      "TASK-000.md",
      "TASK-001.md",
      "TASK-002.md",
      "TASK-999.md",
    ]);
  });
});

describe("refus", () => {
  it("refuse un code qui ne designe pas un document de tache", async () => {
    for (const taskCode of ["../secret", "TASK-1", "tasks/TASK-001", "TASK-001.md", ""]) {
      const result = await deleteProjectTaskDocuments(repository, [
        { taskCode, expectedRevision: FOREIGN_REVISION },
      ]);
      assert.equal(result.ok, false, taskCode);
    }
    // Rien n'a bouge : la validation a lieu avant tout acces au disque.
    assert.deepEqual(await entries(), [
      "TASK-000.md",
      "TASK-001.md",
      "TASK-002.md",
      "TASK-999.md",
    ]);
  });

  it("condamne la requete entiere pour un seul code invalide", async () => {
    // Une entree douteuse ne doit pas produire un nettoyage a moitie fait dont
    // personne ne saurait dire ou il s'est arrete.
    const result = await deleteProjectTaskDocuments(repository, [
      { taskCode: "TASK-001", expectedRevision: revisionOf(TASK_ONE) },
      { taskCode: "PAS-UN-CODE", expectedRevision: FOREIGN_REVISION },
    ]);

    assert.equal(result.ok, false);
    assert.equal(await readFile(taskFile("TASK-001.md"), "utf8"), TASK_ONE);
  });

  it("refuse une revision malformee", async () => {
    const result = await deleteProjectTaskDocuments(repository, [
      { taskCode: "TASK-001", expectedRevision: "pas-une-empreinte" },
    ]);

    assert.equal(result.ok, false);
    assert.equal(await readFile(taskFile("TASK-001.md"), "utf8"), TASK_ONE);
  });

  it("refuse un repository inexistant", async () => {
    const result = await deleteProjectTaskDocuments(path.join(workspace, "absent"), [
      { taskCode: "TASK-001", expectedRevision: revisionOf(TASK_ONE) },
    ]);

    assert.equal(result.ok, false);
  });

  it("rapporte un refus quand la suppression echoue", async () => {
    const result = await deleteProjectTaskDocuments(
      repository,
      [{ taskCode: "TASK-001", expectedRevision: revisionOf(TASK_ONE) }],
      {
        deleteHooks: {
          unlink: () => Promise.reject(new Error("EPERM")),
        },
      },
    );

    // La route reussit, mais le document porte `REFUSED` : c'est l'appelant qui
    // en fait un refus global, et le fichier est toujours la.
    assert.ok(result.ok);
    assert.equal(result.documents[0]?.outcome, "REFUSED");
    assert.equal(await readFile(taskFile("TASK-001.md"), "utf8"), TASK_ONE);
  });

  it("rapporte un refus quand unlink ne supprime rien", async () => {
    // Une doublure qui ne fait rien est rattrapee : NOX confirme l'absence du
    // fichier avant d'annoncer un retrait.
    const result = await deleteProjectTaskDocuments(
      repository,
      [{ taskCode: "TASK-001", expectedRevision: revisionOf(TASK_ONE) }],
      { deleteHooks: { unlink: () => Promise.resolve() } },
    );

    assert.ok(result.ok);
    assert.equal(result.documents[0]?.outcome, "REFUSED");
  });

  it("refuse un dossier occupant le chemin d'un document", async () => {
    await rm(taskFile("TASK-001.md"));
    await mkdir(taskFile("TASK-001.md"));

    const result = await deleteProjectTaskDocuments(repository, [
      { taskCode: "TASK-001", expectedRevision: revisionOf(TASK_ONE) },
    ]);

    assert.ok(result.ok);
    assert.equal(result.documents[0]?.outcome, "REFUSED");
  });

  it(
    "refuse un lien symbolique, meme pointant dans le repository",
    { skip: skipFileSymlinks() },
    async () => {
      await rm(taskFile("TASK-001.md"));
      await symlink(taskFile("TASK-002.md"), taskFile("TASK-001.md"));

      const result = await deleteProjectTaskDocuments(repository, [
        { taskCode: "TASK-001", expectedRevision: revisionOf(TASK_TWO) },
      ]);

      assert.ok(result.ok);
      assert.equal(result.documents[0]?.outcome, "REFUSED");
      // Ni le lien, ni sa cible : « supprimer ce document » ne doit pas retirer
      // un fichier que l'utilisateur croyait ailleurs.
      assert.equal(await readFile(taskFile("TASK-002.md"), "utf8"), TASK_TWO);
    },
  );

  it("continue le lot apres un refus", async () => {
    await rm(taskFile("TASK-001.md"));
    await mkdir(taskFile("TASK-001.md"));

    const result = await deleteProjectTaskDocuments(repository, [
      { taskCode: "TASK-001", expectedRevision: revisionOf(TASK_ONE) },
      { taskCode: "TASK-002", expectedRevision: revisionOf(TASK_TWO) },
    ]);

    // Le lot est traite en entier : l'appelant a besoin de la liste complete
    // pour dire ce qui a resiste, et sa decision se prend sur l'ensemble.
    assert.ok(result.ok);
    assert.deepEqual(
      result.documents.map((entry) => entry.outcome),
      ["REFUSED", "REMOVED"],
    );
  });
});
