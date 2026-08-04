import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";

import {
  validateRepositoryPath,
  type GitOutcome,
  type GitRunner,
} from "./repository-path.ts";

const execFileAsync = promisify(execFile);

/**
 * Tous les dossiers de travail sont crees sous le dossier temporaire du systeme
 * et supprimes en fin de suite. Aucun repository existant n'est touche, et aucun
 * chemin propre a une machine n'est code en dur.
 */
let workspace: string;

/** Lanceur Git simule, pour les cas qu'on ne peut pas provoquer de facon fiable. */
function stubGit(outcome: GitOutcome): GitRunner {
  return () => Promise.resolve(outcome);
}

async function createGitRepository(directoryName: string): Promise<string> {
  const repositoryPath = path.join(workspace, directoryName);
  await mkdir(repositoryPath, { recursive: true });
  await execFileAsync("git", ["-C", repositoryPath, "init", "--quiet"]);
  return repositoryPath;
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-repo-path-"));
});

after(async () => {
  // `maxRetries` : sous Windows, les fichiers de `.git` restent parfois verrouilles
  // un court instant apres la fin du processus git.
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("validateRepositoryPath - controles prealables", () => {
  it("refuse une chaine vide", async () => {
    const result = await validateRepositoryPath("   ");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "EMPTY");
  });

  it("refuse un chemin relatif", async () => {
    const result = await validateRepositoryPath("./mon-projet");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "NOT_ABSOLUTE");
  });

  it("refuse un dossier inexistant", async () => {
    const missing = path.join(workspace, "dossier-absent");
    const result = await validateRepositoryPath(missing);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "NOT_FOUND");
  });

  it("refuse un chemin pointant vers un fichier", async () => {
    const filePath = path.join(workspace, "fichier.txt");
    await writeFile(filePath, "contenu");
    const result = await validateRepositoryPath(filePath);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "NOT_A_DIRECTORY");
  });

  it("n'appelle pas Git tant qu'un controle prealable echoue", async () => {
    let called = false;
    const runGit: GitRunner = () => {
      called = true;
      return Promise.resolve<GitOutcome>({ status: "ok", stdout: workspace });
    };

    await validateRepositoryPath("chemin/relatif", { runGit });
    assert.equal(called, false);
  });
});

describe("validateRepositoryPath - resolution Git reelle", () => {
  it("accepte un repository Git et retourne sa racine", async () => {
    const repositoryPath = await createGitRepository("depot-simple");
    const result = await validateRepositoryPath(repositoryPath);

    assert.equal(result.ok, true);
    assert.equal(
      result.ok && result.canonicalPath.toLowerCase(),
      repositoryPath.toLowerCase(),
    );
  });

  it("ramene un sous-dossier a la racine du repository", async () => {
    const repositoryPath = await createGitRepository("depot-avec-sous-dossier");
    const subDirectory = path.join(repositoryPath, "src", "modules");
    await mkdir(subDirectory, { recursive: true });

    const result = await validateRepositoryPath(subDirectory);

    assert.equal(result.ok, true);
    assert.equal(
      result.ok && result.canonicalPath.toLowerCase(),
      repositoryPath.toLowerCase(),
    );
  });

  it("accepte un chemin contenant un espace", async () => {
    const repositoryPath = await createGitRepository("mon depot local");
    const result = await validateRepositoryPath(repositoryPath);

    assert.equal(result.ok, true);
    assert.equal(
      result.ok && result.canonicalPath.toLowerCase(),
      repositoryPath.toLowerCase(),
    );
  });

  it("accepte un chemin contenant des accents", async () => {
    const repositoryPath = await createGitRepository("dépôt-accentué");
    const result = await validateRepositoryPath(repositoryPath);

    assert.equal(result.ok, true);
    assert.equal(
      result.ok && result.canonicalPath.toLowerCase(),
      repositoryPath.toLowerCase(),
    );
  });

  it("refuse un dossier hors de tout repository Git", async () => {
    const plainDirectory = path.join(workspace, "sans-git");
    await mkdir(plainDirectory, { recursive: true });

    const result = await validateRepositoryPath(plainDirectory);

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "NOT_A_GIT_REPOSITORY");
  });
});

describe("validateRepositoryPath - defaillances de Git", () => {
  it("transforme un depassement de delai en resultat controle", async () => {
    const result = await validateRepositoryPath(workspace, {
      runGit: stubGit({ status: "timeout" }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "GIT_TIMEOUT");
    assert.match(result.ok === false ? result.message : "", /delai/i);
  });

  it("signale Git introuvable sans exposer de detail systeme", async () => {
    const result = await validateRepositoryPath(workspace, {
      runGit: stubGit({ status: "unavailable" }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "GIT_UNAVAILABLE");
  });

  it("traite une sortie Git vide comme un echec, pas comme un succes", async () => {
    const result = await validateRepositoryPath(workspace, {
      runGit: stubGit({ status: "ok", stdout: "  \n" }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "GIT_FAILED");
  });

  it("normalise la sortie Git en chemin absolu du systeme", async () => {
    const repositoryPath = await createGitRepository("depot-normalisation");
    // Git renvoie toujours des separateurs `/`, meme sous Windows.
    const gitStyle = repositoryPath.replaceAll("\\", "/");

    const result = await validateRepositoryPath(repositoryPath, {
      runGit: stubGit({ status: "ok", stdout: `${gitStyle}\n` }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.canonicalPath, path.resolve(repositoryPath));
  });
});
