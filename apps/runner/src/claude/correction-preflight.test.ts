/**
 * Tests du preflight de correction.
 *
 * Sur de vrais repositories Git : la question posee — « le dossier de travail
 * est-il encore exactement celui qui a ete relu ? » — n'a de sens que contre un
 * vrai dossier, et une simulation de `git status` ne prouverait rien.
 *
 * La regle centrale est l'inverse de celle du preflight initial : ici, un
 * repository **sale** est normal, et c'est un repository **different** qui est
 * refuse.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { RUNNER_ERROR } from "@nox/shared";

import type { ClaudeConfig } from "../config.ts";
import type { ClaudeVersionProbe } from "./executable.ts";
import {
  computeWorkspaceFingerprint,
  deriveFingerprintKey,
} from "../repositories/workspace-fingerprint.ts";
import { runCorrectionPreflight } from "./correction-preflight.ts";

const KEY = deriveFingerprintKey("jeton-de-test-correction-0123456789");

const CLAUDE: ClaudeConfig = {
  executable: "claude-de-test",
  maxTurns: 20,
  timeoutMinutes: 5,
};

/** Sonde de version toujours disponible : ce n'est pas l'objet de ces tests. */
const availableClaude: ClaudeVersionProbe = () =>
  Promise.resolve({ available: true, version: "2.1.223", resolvedPath: "/faux/claude" });

const workspaces: string[] = [];

async function newRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "nox-cpf-"));
  workspaces.push(root);

  const bare = await mkdtemp(path.join(os.tmpdir(), "nox-cpf-remote-"));
  workspaces.push(bare);
  execFileSync("git", ["init", "--bare", "-b", "main", bare], { stdio: "ignore" });
  execFileSync("git", ["clone", bare, root], { stdio: "ignore" });

  const git = (...args: string[]): void => {
    execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  };
  git("config", "user.email", "test@nox.invalid");
  git("config", "user.name", "NOX Test");
  git("config", "core.autocrlf", "false");

  await writeFile(path.join(root, "README.md"), "# Depot\n\nUne ligne.\n", "utf8");
  git("add", "-A");
  git("commit", "-m", "init");
  git("push", "-u", "origin", "main");

  // L'etat « relu » : le travail d'une execution precedente, non commite.
  await writeFile(path.join(root, "README.md"), "# Depot\n\nTravail de l'agent.\n", "utf8");
  await writeFile(path.join(root, "nouveau.md"), "# Nouveau\n", "utf8");

  return root;
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

/** Etat de reference d'un repository, tel qu'il serait enregistre par la review. */
async function reviewedState(
  root: string,
): Promise<{ expectedGitHead: string; expectedBranch: string; expectedWorkspaceFingerprint: string }> {
  const result = await computeWorkspaceFingerprint(root, KEY);
  assert.ok(result.ok, "l'empreinte de reference doit pouvoir etre calculee");
  return {
    expectedGitHead: result.head,
    expectedBranch: result.branch,
    expectedWorkspaceFingerprint: result.value,
  };
}

after(async () => {
  for (const root of workspaces) {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

describe("runCorrectionPreflight — etat identique", () => {
  it("autorise un repository sale identique a celui qui a ete relu", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    const result = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed },
      CLAUDE,
      { fingerprintKey: KEY, probeVersion: availableClaude },
    );

    // La difference essentielle avec le preflight initial : le repository est
    // sale, et c'est accepte.
    assert.ok(result.ok, `refus inattendu : ${result.ok ? "" : result.code}`);
    assert.equal(result.git.branch, "main");
    assert.equal(result.claudeVersion, "2.1.223");
  });

  it("ne renvoie jamais l'empreinte dans sa reponse", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    const result = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed },
      CLAUDE,
      { fingerprintKey: KEY, probeVersion: availableClaude },
    );

    assert.ok(result.ok);
    assert.equal(
      JSON.stringify(result).includes(reviewed.expectedWorkspaceFingerprint),
      false,
    );
  });
});

describe("runCorrectionPreflight — etat different", () => {
  it("refuse un fichier modifie apres la review", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    await writeFile(path.join(root, "README.md"), "# Depot\n\nEdite a la main.\n", "utf8");

    const result = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed },
      CLAUDE,
      { fingerprintKey: KEY, probeVersion: availableClaude },
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, RUNNER_ERROR.REVIEW_WORKTREE_CHANGED);
  });

  it("refuse un fichier ajoute apres la review", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    await writeFile(path.join(root, "ajoute-a-la-main.md"), "# Ajoute\n", "utf8");

    const result = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed },
      CLAUDE,
      { fingerprintKey: KEY, probeVersion: availableClaude },
    );

    assert.equal(result.ok ? null : result.code, RUNNER_ERROR.REVIEW_WORKTREE_CHANGED);
  });

  it("refuse un fichier supprime apres la review", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    await rm(path.join(root, "nouveau.md"));

    const result = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed },
      CLAUDE,
      { fingerprintKey: KEY, probeVersion: availableClaude },
    );

    assert.equal(result.ok ? null : result.code, RUNNER_ERROR.REVIEW_WORKTREE_CHANGED);
  });

  it("refuse une mise en index faite apres la review", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    // Le contenu ne bouge pas : seul l'index change.
    git(root, "add", "README.md");

    const result = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed },
      CLAUDE,
      { fingerprintKey: KEY, probeVersion: availableClaude },
    );

    assert.equal(result.ok ? null : result.code, RUNNER_ERROR.REVIEW_WORKTREE_CHANGED);
  });

  it("refuse un HEAD different", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    const result = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed, expectedGitHead: "b".repeat(40) },
      CLAUDE,
      { fingerprintKey: KEY, probeVersion: availableClaude },
    );

    // Nomme precisement : « tu as commite » se corrige autrement que « tu as
    // edite un fichier ».
    assert.equal(result.ok ? null : result.code, RUNNER_ERROR.GIT_HEAD_CHANGED);
  });

  it("refuse une branche differente", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    const result = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed, expectedBranch: "autre" },
      CLAUDE,
      { fingerprintKey: KEY, probeVersion: availableClaude },
    );

    assert.equal(result.ok ? null : result.code, RUNNER_ERROR.GIT_BRANCH_CHANGED);
  });

  it("refuse une empreinte calculee avec un autre jeton de runner", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    const result = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed },
      CLAUDE,
      { fingerprintKey: deriveFingerprintKey("un-autre-jeton"), probeVersion: availableClaude },
    );

    // NOX ne peut pas distinguer « le dossier a change » de « le jeton a
    // change » : il refuse dans les deux cas, et le message mentionne les deux.
    assert.equal(result.ok ? null : result.code, RUNNER_ERROR.REVIEW_WORKTREE_CHANGED);
  });
});

describe("runCorrectionPreflight — autres refus", () => {
  it("refuse un repository introuvable", async () => {
    const result = await runCorrectionPreflight(
      {
        repositoryPath: path.join(os.tmpdir(), "nox-inexistant-correction"),
        expectedGitHead: "a".repeat(40),
        expectedBranch: "main",
        expectedWorkspaceFingerprint: "f".repeat(64),
      },
      CLAUDE,
      { fingerprintKey: KEY, probeVersion: availableClaude },
    );

    assert.equal(result.ok, false);
  });

  it("refuse quand Claude Code est introuvable", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    const result = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed },
      CLAUDE,
      {
        fingerprintKey: KEY,
        probeVersion: () => Promise.resolve({ available: false }),
      },
    );

    assert.equal(result.ok ? null : result.code, RUNNER_ERROR.CLAUDE_NOT_AVAILABLE);
  });

  it("verifie l'etat du dossier avant meme d'interroger Claude Code", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);
    await writeFile(path.join(root, "README.md"), "# Autre chose\n", "utf8");

    let probed = false;
    const result = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed },
      CLAUDE,
      {
        fingerprintKey: KEY,
        probeVersion: () => {
          probed = true;
          return Promise.resolve({
            available: true,
            version: "2.1.223",
            resolvedPath: "/faux/claude",
          });
        },
      },
    );

    assert.equal(result.ok ? null : result.code, RUNNER_ERROR.REVIEW_WORKTREE_CHANGED);
    // Inutile de lancer un processus pour apprendre une version quand la
    // reponse est deja connue.
    assert.equal(probed, false);
  });
});
