import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { DELIVERY_POLICIES, DELIVERY_POLICY } from "@nox/shared";

import type { ClaudeConfig } from "../config.ts";
import { parsePorcelainPaths, readGitChanges, readGitState } from "../repositories/git-state.ts";
import type { ClaudeVersionResult } from "./executable.ts";
import { runPreflight } from "./preflight.ts";

/**
 * Ces tests utilisent de **vrais** repositories Git temporaires, avec un remote
 * `bare` local en guise d'upstream. Aucun acces reseau n'est necessaire : un
 * remote local se comporte, pour tout ce qui nous interesse, comme un remote
 * distant. Aucun repository utilisateur n'est touche.
 */

let workspace: string;
let remote: string;
let repository: string;

const CLAUDE: ClaudeConfig = {
  executable: "claude-de-test",
  maxTurns: 10,
  timeoutMinutes: 5,
};

/** Version simulee : aucune requete Claude n'est faite par ces tests. */
const availableVersion = (): Promise<ClaudeVersionResult> =>
  Promise.resolve({ available: true, version: "1.2.3", resolvedPath: "/faux/claude" });

const missingVersion = (): Promise<ClaudeVersionResult> =>
  Promise.resolve({ available: false });

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" });
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-preflight-"));
  remote = path.join(workspace, "remote.git");
  repository = path.join(workspace, "depot");
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(async () => {
  await rm(remote, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

  execFileSync("git", ["init", "--bare", "-b", "main", remote], { stdio: "ignore" });
  execFileSync("git", ["clone", remote, repository], { stdio: "ignore" });

  git(repository, "config", "user.email", "test@nox.local");
  git(repository, "config", "user.name", "Test NOX");

  await writeFile(path.join(repository, "README.md"), "# Depot de test\n", "utf8");
  git(repository, "add", "-A");
  git(repository, "commit", "-m", "init");
  git(repository, "push", "-u", "origin", "main");
});

describe("readGitState - repository propre et synchronise", () => {
  it("retourne la branche, l'upstream et HEAD", async () => {
    const state = await readGitState(repository);

    assert.equal(state.ok, true);
    if (!state.ok) return;

    assert.equal(state.state.clean, true);
    assert.equal(state.state.branch, "main");
    assert.equal(state.state.upstream, "origin/main");
    assert.match(state.state.head, /^[0-9a-f]{40}$/);
    assert.equal(state.state.ahead, 0);
    assert.equal(state.state.behind, 0);
  });
});

describe("readGitState - etats sales", () => {
  it("detecte un fichier non suivi", async () => {
    await writeFile(path.join(repository, "brouillon.txt"), "x", "utf8");

    const state = await readGitState(repository);
    assert.equal(state.ok && state.state.clean, false);
  });

  it("detecte une modification suivie", async () => {
    await writeFile(path.join(repository, "README.md"), "# Modifie\n", "utf8");

    const state = await readGitState(repository);
    assert.equal(state.ok && state.state.clean, false);
  });

  it("detecte des modifications indexees", async () => {
    await writeFile(path.join(repository, "nouveau.txt"), "x", "utf8");
    git(repository, "add", "-A");

    const state = await readGitState(repository);
    assert.equal(state.ok && state.state.clean, false);
  });
});

describe("readGitState - refus structurels", () => {
  it("refuse un HEAD detache", async () => {
    const head = git(repository, "rev-parse", "HEAD").trim();
    git(repository, "checkout", "--detach", head);

    const state = await readGitState(repository);
    assert.equal(state.ok, false);
    assert.equal(state.ok ? null : state.code, "GIT_DETACHED_HEAD");
  });

  it("refuse une branche sans upstream", async () => {
    git(repository, "checkout", "-b", "sans-upstream");

    const state = await readGitState(repository);
    assert.equal(state.ok, false);
    assert.equal(state.ok ? null : state.code, "GIT_UPSTREAM_MISSING");
  });
});

describe("readGitState - avance et retard", () => {
  it("compte une branche en avance", async () => {
    await writeFile(path.join(repository, "ajout.txt"), "x", "utf8");
    git(repository, "add", "-A");
    git(repository, "commit", "-m", "avance");

    const state = await readGitState(repository);
    assert.equal(state.ok, true);
    if (!state.ok) return;

    assert.equal(state.state.ahead, 1);
    assert.equal(state.state.behind, 0);
  });

  it("compte une branche en retard", async () => {
    // Un second clone pousse un commit ; le premier ne le connait qu'apres
    // `fetch`, ce qui reproduit exactement le cas reel.
    const second = path.join(workspace, "second");
    await rm(second, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    execFileSync("git", ["clone", remote, second], { stdio: "ignore" });
    git(second, "config", "user.email", "test@nox.local");
    git(second, "config", "user.name", "Test NOX");
    await writeFile(path.join(second, "autre.txt"), "x", "utf8");
    git(second, "add", "-A");
    git(second, "commit", "-m", "ailleurs");
    git(second, "push");

    git(repository, "fetch");

    const state = await readGitState(repository);
    assert.equal(state.ok, true);
    if (!state.ok) return;

    assert.equal(state.state.ahead, 0);
    assert.equal(state.state.behind, 1);
  });

  it("compte une divergence", async () => {
    const second = path.join(workspace, "divergent");
    await rm(second, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    execFileSync("git", ["clone", remote, second], { stdio: "ignore" });
    git(second, "config", "user.email", "test@nox.local");
    git(second, "config", "user.name", "Test NOX");
    await writeFile(path.join(second, "leur.txt"), "x", "utf8");
    git(second, "add", "-A");
    git(second, "commit", "-m", "leur");
    git(second, "push");

    await writeFile(path.join(repository, "notre.txt"), "x", "utf8");
    git(repository, "add", "-A");
    git(repository, "commit", "-m", "notre");
    git(repository, "fetch");

    const state = await readGitState(repository);
    assert.equal(state.ok, true);
    if (!state.ok) return;

    assert.equal(state.state.ahead, 1);
    assert.equal(state.state.behind, 1);
  });

  it("ne fait aucun fetch de lui-meme", async () => {
    const second = path.join(workspace, "silencieux");
    await rm(second, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    execFileSync("git", ["clone", remote, second], { stdio: "ignore" });
    git(second, "config", "user.email", "test@nox.local");
    git(second, "config", "user.name", "Test NOX");
    await writeFile(path.join(second, "invisible.txt"), "x", "utf8");
    git(second, "add", "-A");
    git(second, "commit", "-m", "invisible");
    git(second, "push");

    // Sans `fetch`, la machine ignore ce commit : le preflight doit dire la
    // meme chose que Git, pas aller le chercher.
    const state = await readGitState(repository);
    assert.equal(state.ok, true);
    if (!state.ok) return;

    assert.equal(state.state.behind, 0, "aucun fetch ne doit avoir eu lieu");
  });
});

describe("readGitState - defaillances", () => {
  it("traduit un delai depasse", async () => {
    const state = await readGitState(repository, {
      runGit: () => Promise.resolve({ status: "timeout" }),
    });

    assert.equal(state.ok, false);
    assert.equal(state.ok ? null : state.code, "GIT_TIMEOUT");
  });

  it("traduit une absence de Git", async () => {
    const state = await readGitState(repository, {
      runGit: () => Promise.resolve({ status: "unavailable" }),
    });

    assert.equal(state.ok, false);
    assert.equal(state.ok ? null : state.code, "GIT_NOT_AVAILABLE");
  });
});

describe("runPreflight", () => {
  it("accepte un repository propre avec Claude Code disponible", async () => {
    const result = await runPreflight(repository, CLAUDE, { probeVersion: availableVersion });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.claudeVersion, "1.2.3");
    assert.equal(result.git.branch, "main");
  });

  it("refuse un repository sale", async () => {
    await writeFile(path.join(repository, "brouillon.txt"), "x", "utf8");

    const result = await runPreflight(repository, CLAUDE, { probeVersion: availableVersion });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, "REPOSITORY_DIRTY");
  });

  it("refuse une branche non synchronisee", async () => {
    await writeFile(path.join(repository, "ajout.txt"), "x", "utf8");
    git(repository, "add", "-A");
    git(repository, "commit", "-m", "avance");

    const result = await runPreflight(repository, CLAUDE, { probeVersion: availableVersion });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, "GIT_NOT_SYNCHRONIZED");
  });

  it("refuse une branche en avance sous une politique manuelle", async () => {
    await writeFile(path.join(repository, "ajout.txt"), "x", "utf8");
    git(repository, "add", "-A");
    git(repository, "commit", "-m", "avance");

    const result = await runPreflight(repository, CLAUDE, {
      probeVersion: availableVersion,
      deliveryPolicy: DELIVERY_POLICY.MANUAL,
    });

    assert.equal(result.ok ? null : result.code, "GIT_NOT_SYNCHRONIZED");
  });

  it("accepte une branche en avance sous AUTO_COMMIT", async () => {
    await writeFile(path.join(repository, "ajout.txt"), "x", "utf8");
    git(repository, "add", "-A");
    git(repository, "commit", "-m", "avance");

    const result = await runPreflight(repository, CLAUDE, {
      probeVersion: availableVersion,
      deliveryPolicy: DELIVERY_POLICY.AUTO_COMMIT,
    });

    // C'est l'etat normal de cette politique : NOX a commite le travail valide
    // et ne le poussera pas. Le repository reste parfaitement relisible.
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.git.ahead, 1);
    assert.equal(result.git.behind, 0);
  });

  it("refuse une branche en avance sous AUTO_COMMIT_PUSH", async () => {
    await writeFile(path.join(repository, "ajout.txt"), "x", "utf8");
    git(repository, "add", "-A");
    git(repository, "commit", "-m", "avance");

    const result = await runPreflight(repository, CLAUDE, {
      probeVersion: availableVersion,
      deliveryPolicy: DELIVERY_POLICY.AUTO_COMMIT_PUSH,
    });

    // Cette politique n'est satisfaite qu'une fois le commit pousse : une branche
    // en avance y signifie que le push manque, pas que tout va bien.
    assert.equal(result.ok ? null : result.code, "GIT_NOT_SYNCHRONIZED");
  });

  it("refuse une branche en retard, meme sous AUTO_COMMIT", async () => {
    // Un tiers pousse un commit que ce dossier n'a pas encore integre.
    const autre = path.join(workspace, "autre");
    execFileSync("git", ["clone", remote, autre], { stdio: "ignore" });
    git(autre, "config", "user.email", "test@nox.local");
    git(autre, "config", "user.name", "Test NOX");
    await writeFile(path.join(autre, "tiers.txt"), "x", "utf8");
    git(autre, "add", "-A");
    git(autre, "commit", "-m", "tiers");
    git(autre, "push", "origin", "main");
    git(repository, "fetch", "origin");
    await rm(autre, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

    const result = await runPreflight(repository, CLAUDE, {
      probeVersion: availableVersion,
      deliveryPolicy: DELIVERY_POLICY.AUTO_COMMIT,
    });

    // Aucune politique ne produit cet etat : il vient toujours de l'exterieur, et
    // il rend la relecture d'apres execution ambigue.
    assert.equal(result.ok ? null : result.code, "GIT_NOT_SYNCHRONIZED");
  });

  it("refuse toujours un repository sale, quelle que soit la politique", async () => {
    await writeFile(path.join(repository, "brouillon.txt"), "x", "utf8");

    for (const policy of DELIVERY_POLICIES) {
      const result = await runPreflight(repository, CLAUDE, {
        probeVersion: availableVersion,
        deliveryPolicy: policy,
      });

      assert.equal(result.ok ? null : result.code, "REPOSITORY_DIRTY", policy);
    }
  });

  it("traite une politique absente comme MANUAL", async () => {
    await writeFile(path.join(repository, "ajout.txt"), "x", "utf8");
    git(repository, "add", "-A");
    git(repository, "commit", "-m", "avance");

    // Le defaut sur n'assouplit rien : un appelant qui oublierait la politique
    // n'obtient pas plus de droits, il en obtient moins.
    const result = await runPreflight(repository, CLAUDE, { probeVersion: availableVersion });

    assert.equal(result.ok ? null : result.code, "GIT_NOT_SYNCHRONIZED");
  });

  it("refuse quand Claude Code est introuvable", async () => {
    const result = await runPreflight(repository, CLAUDE, { probeVersion: missingVersion });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, "CLAUDE_NOT_AVAILABLE");
  });

  it("signale d'abord un probleme Git, corrigeable tout de suite", async () => {
    await writeFile(path.join(repository, "brouillon.txt"), "x", "utf8");

    const result = await runPreflight(repository, CLAUDE, { probeVersion: missingVersion });

    // Les deux sont en cause ; c'est le repository qui est signale, parce qu'il
    // se corrige en quelques secondes.
    assert.equal(result.ok ? null : result.code, "REPOSITORY_DIRTY");
  });

  it("refuse un repository inexistant", async () => {
    const result = await runPreflight(path.join(workspace, "fantome"), CLAUDE, {
      probeVersion: availableVersion,
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, "REPOSITORY_NOT_FOUND");
  });

  it("ne modifie jamais le repository", async () => {
    const before = git(repository, "rev-parse", "HEAD").trim();
    const statusBefore = git(repository, "status", "--porcelain=v1");

    await runPreflight(repository, CLAUDE, { probeVersion: availableVersion });

    assert.equal(git(repository, "rev-parse", "HEAD").trim(), before);
    assert.equal(git(repository, "status", "--porcelain=v1"), statusBefore);
  });
});

describe("readGitChanges", () => {
  it("liste les fichiers modifies et le diff stat", async () => {
    await writeFile(path.join(repository, "README.md"), "# Modifie par un agent\n", "utf8");
    await writeFile(path.join(repository, "NOUVEAU.md"), "# Nouveau\n", "utf8");

    const changes = await readGitChanges(repository);

    assert.equal(changes.branch, "main");
    assert.match(changes.head ?? "", /^[0-9a-f]{40}$/);
    assert.deepEqual(changes.changedFiles.sort(), ["NOUVEAU.md", "README.md"]);
    assert.ok((changes.diffStat ?? "").includes("README.md"));
  });

  it("retourne une liste vide sur un repository propre", async () => {
    const changes = await readGitChanges(repository);

    assert.deepEqual(changes.changedFiles, []);
    assert.equal(changes.diffStat, null);
  });
});

describe("parsePorcelainPaths", () => {
  it("lit les chemins d'une sortie porcelain", () => {
    assert.deepEqual(parsePorcelainPaths(" M src/a.ts\n?? src/b.ts\n"), ["src/a.ts", "src/b.ts"]);
  });

  it("retient la destination d'un renommage", () => {
    assert.deepEqual(parsePorcelainPaths("R  ancien.ts -> nouveau.ts\n"), ["nouveau.ts"]);
  });

  it("ignore les lignes vides", () => {
    assert.deepEqual(parsePorcelainPaths("\n\n M a.ts\n\n"), ["a.ts"]);
  });
});
