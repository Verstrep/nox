import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";

import { resolveRepository, runGitToplevel, type GitOutcome, type GitRunner } from "./resolve-repository.ts";

const execFileAsync = promisify(execFile);

/**
 * Tous les dossiers de travail sont crees sous le dossier temporaire du systeme
 * et supprimes en fin de suite. Aucun repository reel n'est touche et aucun
 * chemin propre a une machine n'est code en dur.
 */
let workspace: string;

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
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-runner-repo-"));
});

after(async () => {
  // `maxRetries` : sous Windows, les fichiers de `.git` restent parfois
  // verrouilles un court instant apres la fin du processus git.
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("resolveRepository - controles prealables", () => {
  it("refuse une chaine vide", async () => {
    const result = await resolveRepository("   ");
    assert.equal(result.ok === false && result.code, "PATH_REQUIRED");
  });

  it("refuse un chemin relatif", async () => {
    const result = await resolveRepository("./mon-projet");
    assert.equal(result.ok === false && result.code, "PATH_NOT_ABSOLUTE");
  });

  it("refuse un dossier inexistant", async () => {
    const result = await resolveRepository(path.join(workspace, "dossier-absent"));
    assert.equal(result.ok === false && result.code, "PATH_NOT_FOUND");
  });

  it("refuse un chemin pointant vers un fichier", async () => {
    const filePath = path.join(workspace, "fichier.txt");
    await writeFile(filePath, "contenu");

    const result = await resolveRepository(filePath);
    assert.equal(result.ok === false && result.code, "PATH_NOT_DIRECTORY");
  });

  it("n'appelle pas Git tant qu'un controle prealable echoue", async () => {
    let called = false;
    const runGit: GitRunner = () => {
      called = true;
      return Promise.resolve<GitOutcome>({ status: "ok", stdout: workspace });
    };

    await resolveRepository("chemin/relatif", { runGit });
    assert.equal(called, false);
  });
});

describe("resolveRepository - resolution Git reelle", () => {
  it("accepte un repository Git et retourne sa racine", async () => {
    const repositoryPath = await createGitRepository("depot-simple");
    const result = await resolveRepository(repositoryPath);

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.canonicalPath.toLowerCase(), repositoryPath.toLowerCase());
  });

  it("ramene un sous-dossier a la racine du repository", async () => {
    const repositoryPath = await createGitRepository("depot-avec-sous-dossier");
    const subDirectory = path.join(repositoryPath, "src", "modules");
    await mkdir(subDirectory, { recursive: true });

    const result = await resolveRepository(subDirectory);

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.canonicalPath.toLowerCase(), repositoryPath.toLowerCase());
  });

  it("accepte un chemin contenant un espace", async () => {
    const repositoryPath = await createGitRepository("mon depot local");
    const result = await resolveRepository(repositoryPath);

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.canonicalPath.toLowerCase(), repositoryPath.toLowerCase());
  });

  it("accepte un chemin contenant des accents", async () => {
    const repositoryPath = await createGitRepository("dépôt-accentué");
    const result = await resolveRepository(repositoryPath);

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.canonicalPath.toLowerCase(), repositoryPath.toLowerCase());
  });

  it("refuse un dossier hors de tout repository Git", async () => {
    const plainDirectory = path.join(workspace, "sans-git");
    await mkdir(plainDirectory, { recursive: true });

    const result = await resolveRepository(plainDirectory);
    assert.equal(result.ok === false && result.code, "NOT_A_GIT_REPOSITORY");
  });
});

describe("resolveRepository - defaillances de Git", () => {
  it("transforme un depassement de delai en code controle", async () => {
    const result = await resolveRepository(workspace, { runGit: stubGit({ status: "timeout" }) });
    assert.equal(result.ok === false && result.code, "GIT_TIMEOUT");
  });

  it("signale Git introuvable", async () => {
    const result = await resolveRepository(workspace, { runGit: stubGit({ status: "unavailable" }) });
    assert.equal(result.ok === false && result.code, "GIT_NOT_AVAILABLE");
  });

  it("traite une sortie Git vide comme un echec", async () => {
    const result = await resolveRepository(workspace, {
      runGit: stubGit({ status: "ok", stdout: "  \n" }),
    });
    assert.equal(result.ok === false && result.code, "NOT_A_GIT_REPOSITORY");
  });

  it("normalise la sortie Git en chemin absolu du systeme", async () => {
    const repositoryPath = await createGitRepository("depot-normalisation");
    // Git renvoie toujours des separateurs `/`, meme sous Windows.
    const gitStyle = repositoryPath.replaceAll("\\", "/");

    const result = await resolveRepository(repositoryPath, {
      runGit: stubGit({ status: "ok", stdout: `${gitStyle}\n` }),
    });

    assert.equal(result.ok && result.canonicalPath, path.resolve(repositoryPath));
  });

  it("respecte le delai passe au lanceur Git", async () => {
    let receivedTimeout = 0;
    const runGit: GitRunner = (_directory, timeoutMs) => {
      receivedTimeout = timeoutMs;
      return Promise.resolve<GitOutcome>({ status: "timeout" });
    };

    await resolveRepository(workspace, { runGit, timeoutMs: 42 });
    assert.equal(receivedTimeout, 42);
  });
});

describe("runGitToplevel", () => {
  it("rapporte `failed` hors d'un repository, sans lever d'exception", async () => {
    const plainDirectory = path.join(workspace, "sans-git-direct");
    await mkdir(plainDirectory, { recursive: true });

    const outcome = await runGitToplevel(plainDirectory, 5_000);
    assert.equal(outcome.status, "failed");
  });
});
