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
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { RUNNER_ERROR, serializeWorkspaceEntries } from "@nox/shared";

import type { ClaudeConfig } from "../config.ts";
import type { ClaudeVersionProbe } from "./executable.ts";
import {
  computeWorkspaceFingerprint,
  deriveFingerprintKey,
} from "../repositories/workspace-fingerprint.ts";
import { runCorrectionPreflight } from "./correction-preflight.ts";
import { runPreflight } from "./preflight.ts";

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
async function reviewedState(root: string): Promise<{
  expectedGitHead: string;
  expectedBranch: string;
  expectedWorkspaceFingerprint: string;
  expectedWorkspaceEntries: string | null;
}> {
  const result = await computeWorkspaceFingerprint(root, KEY);
  assert.ok(result.ok, "l'empreinte de reference doit pouvoir etre calculee");
  return {
    expectedGitHead: result.head,
    expectedBranch: result.branch,
    expectedWorkspaceFingerprint: result.value,
    expectedWorkspaceEntries: serializeWorkspaceEntries(result.entries),
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


describe("runCorrectionPreflight — un refus qui nomme ce qui a diverge", () => {
  it("nomme le fichier que l'utilisateur a edite apres l'echec", async () => {
    // Le cas E du pilote reel. Avant HOTFIX-006, le refus disait « le dossier de
    // travail a change » et rien d'autre : l'utilisateur devait deviner lequel
    // des vingt-quatre fichiers, ou renoncer et tout jeter.
    const root = await newRepository();
    const reviewed = await reviewedState(root);
    assert.ok(reviewed.expectedWorkspaceEntries !== null);

    await writeFile(path.join(root, "README.md"), "# Depot\n\nEdite a la main.\n", "utf8");

    const result = await runCorrectionPreflight({ repositoryPath: root, ...reviewed }, CLAUDE, {
      fingerprintKey: KEY,
      probeVersion: availableClaude,
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, RUNNER_ERROR.REVIEW_WORKTREE_CHANGED);
    const detail = result.ok ? "" : (result.detail ?? "");
    assert.match(detail, /README\.md/u);
    assert.match(detail, /modifies/u);
  });

  it("nomme un fichier apparu apres l'echec", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    await writeFile(path.join(root, "note-perso.md"), "# Note\n", "utf8");

    const result = await runCorrectionPreflight({ repositoryPath: root, ...reviewed }, CLAUDE, {
      fingerprintKey: KEY,
      probeVersion: availableClaude,
    });

    const detail = result.ok ? "" : (result.detail ?? "");
    assert.match(detail, /apparus/u);
    assert.match(detail, /note-perso\.md/u);
  });

  it("nomme un fichier disparu apres l'echec", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    await rm(path.join(root, "nouveau.md"));

    const result = await runCorrectionPreflight({ repositoryPath: root, ...reviewed }, CLAUDE, {
      fingerprintKey: KEY,
      probeVersion: availableClaude,
    });

    const detail = result.ok ? "" : (result.detail ?? "");
    assert.match(detail, /disparus/u);
    assert.match(detail, /nouveau\.md/u);
  });

  it("distingue une reindexation d'une modification de contenu", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    git(root, "add", "README.md");

    const result = await runCorrectionPreflight({ repositoryPath: root, ...reviewed }, CLAUDE, {
      fingerprintKey: KEY,
      probeVersion: availableClaude,
    });

    const detail = result.ok ? "" : (result.detail ?? "");
    assert.match(detail, /reindexes/u);
    assert.equal(detail.includes("modifies"), false);
  });

  it("refuse quand meme sans entrees attendues, et le dit", async () => {
    // Une execution anterieure a HOTFIX-006 n'en porte aucune. La garantie ne
    // faiblit pas d'un pouce : c'est l'empreinte qui refuse, et le message
    // reconnait simplement qu'il ne peut pas nommer de chemin.
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    await writeFile(path.join(root, "README.md"), "# Depot\n\nAutre chose.\n", "utf8");

    const result = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed, expectedWorkspaceEntries: null },
      CLAUDE,
      { fingerprintKey: KEY, probeVersion: availableClaude },
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, RUNNER_ERROR.REVIEW_WORKTREE_CHANGED);
    const detail = result.ok ? "" : (result.detail ?? "");
    assert.match(detail, /ne peut pas nommer/u);
    assert.match(detail, /jeton de runner/u);
  });

  it("n'appelle pas la comparaison quand l'empreinte correspond", async () => {
    // Le cas D : le dossier de travail est sale et **inchange**. La correction
    // est autorisee, et aucun detail de divergence n'est produit — il n'y a rien
    // a expliquer.
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    const result = await runCorrectionPreflight({ repositoryPath: root, ...reviewed }, CLAUDE, {
      fingerprintKey: KEY,
      probeVersion: availableClaude,
    });

    assert.ok(result.ok);
    assert.equal(JSON.stringify(result).includes("diverge"), false);
  });

  it("ne fait jamais passer une empreinte differente pour une liste identique", async () => {
    // La regle qui empeche ces entrees de devenir un second controle : si les
    // deux se contredisaient, c'est l'empreinte qui gagne. On le prouve en
    // fournissant les bonnes entrees avec une mauvaise empreinte.
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    const result = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed, expectedWorkspaceFingerprint: "f".repeat(64) },
      CLAUDE,
      { fingerprintKey: KEY, probeVersion: availableClaude },
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, RUNNER_ERROR.REVIEW_WORKTREE_CHANGED);
    const detail = result.ok ? "" : (result.detail ?? "");
    assert.match(detail, /c'est l'empreinte qui fait foi/u);
  });

  it("ne fait jamais entrer le contenu d'un fichier dans le refus", async () => {
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    await writeFile(path.join(root, "secret.md"), "MOT_DE_PASSE_ULTRA_SECRET\n", "utf8");

    const result = await runCorrectionPreflight({ repositoryPath: root, ...reviewed }, CLAUDE, {
      fingerprintKey: KEY,
      probeVersion: availableClaude,
    });

    const detail = result.ok ? "" : (result.detail ?? "");
    assert.match(detail, /secret\.md/u, "le chemin, oui");
    assert.equal(detail.includes("MOT_DE_PASSE_ULTRA_SECRET"), false, "le contenu, jamais");
  });

  it("refuse un HEAD different avant meme de comparer les entrees", async () => {
    // Le cas F. `HEAD` se controle avant l'empreinte, et son refus porte son
    // propre code : « tu as commite » se corrige autrement que « un fichier a
    // change ».
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    const result = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed, expectedGitHead: "c".repeat(40) },
      CLAUDE,
      { fingerprintKey: KEY, probeVersion: availableClaude },
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, RUNNER_ERROR.GIT_HEAD_CHANGED);
    assert.equal(result.ok ? null : (result.detail ?? null), null);
  });
});


describe("Retry et Correction ne demandent pas la meme chose", () => {
  it("le meme repository sale refuse un lancement initial et accepte une reprise", async () => {
    // Le cas H, et la raison d'etre de HOTFIX-006 en une assertion.
    //
    // Un lancement initial exige un dossier de travail **propre** : sans etat de
    // depart connu, on ne saurait pas dire ce que l'agent a change. Une reprise
    // exige l'inverse — le travail relu est encore la, et l'exiger propre
    // reviendrait a demander de le jeter avant de le continuer.
    //
    // Le pilote reel n'avait que le premier chemin.
    const root = await newRepository();
    const reviewed = await reviewedState(root);

    const initial = await runPreflight(root, CLAUDE, { probeVersion: availableClaude });
    assert.equal(initial.ok, false);
    assert.equal(initial.ok ? null : initial.code, RUNNER_ERROR.REPOSITORY_DIRTY);

    const correction = await runCorrectionPreflight(
      { repositoryPath: root, ...reviewed },
      CLAUDE,
      { fingerprintKey: KEY, probeVersion: availableClaude },
    );
    assert.ok(correction.ok, "la reprise accepte ce que le lancement initial refuse");
  });

  it("le preflight de correction ne connait aucune option de forcage", async () => {
    // Il n'existe pas de « continuer quand meme », et il ne doit pas en exister :
    // c'est cette garantie qui rend la review suivante interpretable.
    const text = await readFile(
      new URL("./correction-preflight.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of ["force", "ignoreFingerprint", "skipValidation", "overwrite"]) {
      assert.equal(text.includes(`${forbidden}?:`), false, forbidden);
    }
  });
});
