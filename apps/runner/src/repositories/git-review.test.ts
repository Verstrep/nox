/**
 * Tests de la capture Git detaillee.
 *
 * Ils utilisent de **vrais** repositories Git temporaires : un faux lanceur Git
 * validerait le parseur mais pas ce qui compte, c'est-a-dire l'accord entre les
 * options passees a `git` et ce que `git` en fait reellement. Les formats `-z`,
 * la detection de renommage et le comptage `--numstat` sont exactement le genre
 * de chose qu'on croit connaitre jusqu'a la premiere execution.
 *
 * Aucune commande d'ecriture Git n'est lancee par le module teste ; les
 * commandes d'ecriture presentes ici appartiennent a la **preparation** des
 * fixtures. Aucun acces reseau.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";

import { REVIEW_LIMITS, RUN_CHANGE_TYPE, RUNNER_ERROR, type RunFileChange } from "@nox/shared";

import {
  boundPatch,
  buildUntrackedPatch,
  captureRepositoryChanges,
  parseNameStatus,
  parseNumstat,
} from "./git-review.ts";
import type { GitCommandOutcome } from "./git-state.ts";

const run = promisify(execFile);

let workspace: string;

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-review-"));
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

let counter = 0;

/** Cree un repository temporaire avec un commit initial, et rend sa racine. */
async function makeRepository(
  files: Record<string, string> = { "README.md": "# Titre\n" },
): Promise<{ root: string; head: string }> {
  counter += 1;
  const root = path.join(workspace, `repo-${String(counter)}`);
  await mkdir(root, { recursive: true });

  await run("git", ["init", "--initial-branch=main"], { cwd: root });
  await run("git", ["config", "user.email", "test@nox.invalid"], { cwd: root });
  await run("git", ["config", "user.name", "NOX Test"], { cwd: root });
  // Le contenu doit traverser Git a l'identique : sans cela, une fin de ligne
  // reecrite ferait apparaitre des changements que personne n'a faits.
  await run("git", ["config", "core.autocrlf", "false"], { cwd: root });

  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(root, name), content, "utf8");
  }

  await run("git", ["add", "-A"], { cwd: root });
  await run("git", ["commit", "-m", "initial"], { cwd: root });

  const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: root });
  return { root, head: stdout.trim() };
}

/** Raccourci : capture et exige la reussite. */
async function capture(root: string, head: string): Promise<RunFileChange[]> {
  const result = await captureRepositoryChanges(root, head, { environment: {} });
  assert.equal(result.ok, true);
  return result.ok ? result.changes.files : [];
}

function byPath(files: readonly RunFileChange[], target: string): RunFileChange {
  const found = files.find((file) => file.path === target);
  assert.ok(found !== undefined, `fichier absent de la capture : ${target}`);
  return found;
}

describe("parseNameStatus", () => {
  it("lit un statut simple", () => {
    const entries = parseNameStatus("M\0apps/web/lib/runs.ts\0");

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.path, "apps/web/lib/runs.ts");
    assert.equal(entries[0]?.changeType, RUN_CHANGE_TYPE.MODIFIED);
    assert.equal(entries[0]?.previousPath, null);
  });

  it("lit un renommage et conserve les deux chemins", () => {
    const entries = parseNameStatus("R100\0ancien.md\0nouveau.md\0");

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.path, "nouveau.md");
    assert.equal(entries[0]?.previousPath, "ancien.md");
    assert.equal(entries[0]?.changeType, RUN_CHANGE_TYPE.RENAMED);
  });

  it("ne se laisse pas tromper par un nom contenant des espaces", () => {
    const entries = parseNameStatus("A\0notes de version.md\0");

    assert.equal(entries[0]?.path, "notes de version.md");
  });

  it("traduit chaque lettre de statut", () => {
    const entries = parseNameStatus("A\0a\0D\0b\0T\0c\0C75\0d\0e\0");

    assert.deepEqual(
      entries.map((entry) => entry.changeType),
      [
        RUN_CHANGE_TYPE.ADDED,
        RUN_CHANGE_TYPE.DELETED,
        RUN_CHANGE_TYPE.TYPE_CHANGED,
        RUN_CHANGE_TYPE.COPIED,
      ],
    );
  });

  it("rend une liste vide sur une sortie vide", () => {
    assert.deepEqual(parseNameStatus(""), []);
    assert.deepEqual(parseNameStatus("\0"), []);
  });
});

describe("parseNumstat", () => {
  it("lit les compteurs d'un fichier texte", () => {
    const counts = parseNumstat("4\t2\tapps/web/lib/runs.ts\0");

    assert.deepEqual(counts.get("apps/web/lib/runs.ts"), { additions: 4, deletions: 2 });
  });

  it("rend null pour un binaire, plutot que zero", () => {
    const counts = parseNumstat("-\t-\tpublic/logo.png\0");

    assert.deepEqual(counts.get("public/logo.png"), { additions: null, deletions: null });
  });

  it("lit un renommage, dont les chemins occupent leurs propres jetons", () => {
    const counts = parseNumstat("3\t1\t\0ancien.md\0nouveau.md\0");

    assert.deepEqual(counts.get("nouveau.md"), { additions: 3, deletions: 1 });
    assert.equal(counts.has("ancien.md"), false);
  });

  it("recolle un nom de fichier contenant une tabulation", () => {
    const counts = parseNumstat("1\t0\tstrange\tname.md\0");

    assert.deepEqual(counts.get("strange\tname.md"), { additions: 1, deletions: 0 });
  });
});

describe("buildUntrackedPatch", () => {
  it("produit un diff unifie de creation", () => {
    const patch = buildUntrackedPatch("nouveau.md", "une\ndeux\n");

    assert.equal(patch, "--- /dev/null\n+++ b/nouveau.md\n@@ -0,0 +1,2 @@\n+une\n+deux\n");
  });

  it("signale une derniere ligne sans saut de ligne", () => {
    const patch = buildUntrackedPatch("a.txt", "seule");

    assert.ok(patch.includes("+seule"));
    assert.ok(patch.includes("\\ No newline at end of file"));
  });

  it("gere un fichier vide sans inventer de ligne", () => {
    const patch = buildUntrackedPatch("vide.txt", "");

    assert.equal(patch, "--- /dev/null\n+++ b/vide.txt\n@@ -0,0 +1,0 @@\n");
  });
});

describe("boundPatch", () => {
  it("laisse un patch court intact", () => {
    assert.deepEqual(boundPatch("court", 100), { patch: "court", truncated: false });
  });

  it("coupe et le dit", () => {
    const result = boundPatch("x".repeat(500), 100);

    assert.equal(result.truncated, true);
    assert.ok(result.patch.length <= 100);
    assert.ok(result.patch.includes("Diff tronque par NOX"));
  });
});

describe("captureRepositoryChanges - repository reel", () => {
  it("rend une review vide quand rien n'a change", async () => {
    const { root, head } = await makeRepository();

    const result = await captureRepositoryChanges(root, head, { environment: {} });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.changes.files, []);
      assert.equal(result.changes.omittedFiles, 0);
    }
  });

  it("capture un fichier modifie, avec son patch et ses compteurs", async () => {
    const { root, head } = await makeRepository();
    await writeFile(path.join(root, "README.md"), "# Titre\n\nUne ligne de plus.\n", "utf8");

    const files = await capture(root, head);
    const file = byPath(files, "README.md");

    assert.equal(file.changeType, RUN_CHANGE_TYPE.MODIFIED);
    assert.equal(file.additions, 2);
    assert.equal(file.deletions, 0);
    assert.equal(file.isBinary, false);
    assert.equal(file.isSensitive, false);
    assert.equal(file.isTruncated, false);
    assert.ok(file.patch?.includes("+Une ligne de plus."));
  });

  it("capture un fichier ajoute a l'index", async () => {
    const { root, head } = await makeRepository();
    await writeFile(path.join(root, "ajoute.md"), "# Ajoute\n", "utf8");
    await run("git", ["add", "ajoute.md"], { cwd: root });

    const file = byPath(await capture(root, head), "ajoute.md");

    assert.equal(file.changeType, RUN_CHANGE_TYPE.ADDED);
    assert.ok(file.patch?.includes("+# Ajoute"));
  });

  it("capture un fichier supprime", async () => {
    const { root, head } = await makeRepository();
    await rm(path.join(root, "README.md"));

    const file = byPath(await capture(root, head), "README.md");

    assert.equal(file.changeType, RUN_CHANGE_TYPE.DELETED);
    assert.equal(file.deletions, 1);
    assert.ok(file.patch?.includes("-# Titre"));
  });

  it("capture un renommage et conserve le chemin d'origine", async () => {
    const { root, head } = await makeRepository({
      "ancien.md": "# Un contenu suffisamment long pour etre reconnu\nligne deux\nligne trois\n",
    });
    await run("git", ["mv", "ancien.md", "nouveau.md"], { cwd: root });

    const file = byPath(await capture(root, head), "nouveau.md");

    assert.equal(file.changeType, RUN_CHANGE_TYPE.RENAMED);
    assert.equal(file.previousPath, "ancien.md");
  });

  it("capture un renommage dont les deux noms contiennent des espaces", async () => {
    const { root, head } = await makeRepository({
      "notes de version.md": "# Notes\nligne deux\nligne trois\nligne quatre\n",
    });
    await run("git", ["mv", "notes de version.md", "notes de release.md"], { cwd: root });

    const file = byPath(await capture(root, head), "notes de release.md");

    assert.equal(file.changeType, RUN_CHANGE_TYPE.RENAMED);
    assert.equal(file.previousPath, "notes de version.md");
  });

  it("capture un fichier non suivi, que git diff ignore", async () => {
    const { root, head } = await makeRepository();
    await writeFile(path.join(root, "brouillon.md"), "premiere\nseconde\n", "utf8");

    const file = byPath(await capture(root, head), "brouillon.md");

    assert.equal(file.changeType, RUN_CHANGE_TYPE.UNTRACKED);
    assert.equal(file.additions, 2);
    assert.equal(file.deletions, 0);
    assert.ok(file.patch?.startsWith("--- /dev/null"));
    assert.ok(file.patch?.includes("+premiere"));
  });

  it("ne lance jamais git add : le fichier reste non suivi apres la capture", async () => {
    const { root, head } = await makeRepository();
    await writeFile(path.join(root, "brouillon.md"), "contenu\n", "utf8");

    await capture(root, head);

    const { stdout } = await run("git", ["status", "--porcelain=v1"], { cwd: root });
    assert.ok(stdout.includes("?? brouillon.md"), stdout);
  });

  it("capture plusieurs fichiers, dans un ordre stable", async () => {
    const { root, head } = await makeRepository({ "a.md": "a\n", "b.md": "b\n", "c.md": "c\n" });
    await writeFile(path.join(root, "a.md"), "a modifie\n", "utf8");
    await writeFile(path.join(root, "c.md"), "c modifie\n", "utf8");
    await writeFile(path.join(root, "d.md"), "d nouveau\n", "utf8");

    const first = await capture(root, head);
    const second = await capture(root, head);

    assert.deepEqual(
      first.map((file) => file.path),
      ["a.md", "c.md", "d.md"],
    );
    assert.deepEqual(
      first.map((file) => file.position),
      [0, 1, 2],
    );
    assert.deepEqual(first, second);
  });

  it("conserve les accents et l'Unicode d'un nom de fichier", async () => {
    const { root, head } = await makeRepository();
    await writeFile(path.join(root, "résumé-日本語.md"), "contenu\n", "utf8");

    const files = await capture(root, head);

    assert.ok(
      files.some((file) => file.path.includes("sum") && file.path.includes("日本語")),
      files.map((file) => file.path).join(", "),
    );
  });

  it("reconnait un fichier binaire sans en stocker le contenu", async () => {
    const { root, head } = await makeRepository();
    // Un PNG minimal : la signature suffit a ce que Git le classe binaire.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]);
    await writeFile(path.join(root, "logo.png"), png);
    await run("git", ["add", "logo.png"], { cwd: root });

    const file = byPath(await capture(root, head), "logo.png");

    assert.equal(file.isBinary, true);
    assert.equal(file.patch, null);
  });

  it("reconnait un binaire non suivi sans en stocker le contenu", async () => {
    const { root, head } = await makeRepository();
    await writeFile(path.join(root, "donnees.bin"), Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]));

    const file = byPath(await capture(root, head), "donnees.bin");

    assert.equal(file.isBinary, true);
    assert.equal(file.patch, null);
  });

  it("masque le contenu d'un fichier sensible, sans masquer son existence", async () => {
    const { root, head } = await makeRepository({ ".env": "SECRET=avant\n" });
    await writeFile(path.join(root, ".env"), "SECRET=apres-tres-confidentiel\n", "utf8");

    const file = byPath(await capture(root, head), ".env");

    assert.equal(file.isSensitive, true);
    assert.equal(file.patch, null);
    // Le chemin, le type et les statistiques restent visibles : savoir que
    // `.env` a bouge est precisement ce qu'il faut apprendre.
    assert.equal(file.changeType, RUN_CHANGE_TYPE.MODIFIED);
    assert.equal(file.additions, 1);
    assert.equal(file.deletions, 1);
  });

  it("masque aussi un fichier sensible cree pendant l'execution", async () => {
    const { root, head } = await makeRepository();
    await writeFile(path.join(root, "id_rsa"), "-----BEGIN PRIVATE KEY-----\n", "utf8");

    const file = byPath(await capture(root, head), "id_rsa");

    assert.equal(file.isSensitive, true);
    assert.equal(file.patch, null);
  });

  it("affiche .env.example, qui existe pour etre lu", async () => {
    const { root, head } = await makeRepository({ ".env.example": "SECRET=\n" });
    await writeFile(path.join(root, ".env.example"), "SECRET=\nAUTRE=\n", "utf8");

    const file = byPath(await capture(root, head), ".env.example");

    assert.equal(file.isSensitive, false);
    assert.ok(file.patch?.includes("+AUTRE="));
  });

  it("retire les valeurs des variables NOX du patch", async () => {
    const { root, head } = await makeRepository();
    const token = "jeton-de-runner-tres-secret";
    await writeFile(path.join(root, "config.md"), `token: ${token}\n`, "utf8");

    const result = await captureRepositoryChanges(root, head, {
      environment: { NOX_RUNNER_TOKEN: token },
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      const file = byPath(result.changes.files, "config.md");
      assert.equal(file.patch?.includes(token), false);
      assert.ok(file.patch?.includes("<masque>"));
    }
  });

  it("preserve l'indentation d'un patch, contrairement au nettoyeur d'evenements", async () => {
    const { root, head } = await makeRepository();
    await writeFile(path.join(root, "code.ts"), "function a() {\n    return 1;\n}\n", "utf8");

    const file = byPath(await capture(root, head), "code.ts");

    // Un diff dont on aurait ecrase les espaces ne decrirait plus le fichier.
    assert.ok(file.patch?.includes("+    return 1;"), file.patch ?? "");
  });

  it("coupe un patch volumineux et le signale", async () => {
    const { root, head } = await makeRepository();
    const enormous = `${"une ligne de contenu repetee".repeat(20)}\n`.repeat(2_000);
    await writeFile(path.join(root, "gros.txt"), enormous, "utf8");

    const file = byPath(await capture(root, head), "gros.txt");

    assert.equal(file.isTruncated, true);
    assert.ok((file.patch?.length ?? 0) <= REVIEW_LIMITS.patchPerFile);
    assert.ok(file.patch?.includes("Diff tronque par NOX"));
  });

  it("garde la liste complete des fichiers quand il y en a trop", async () => {
    const { root, head } = await makeRepository();
    const total = REVIEW_LIMITS.maxFiles + 12;
    for (let index = 0; index < total; index += 1) {
      const name = `f${String(index).padStart(4, "0")}.txt`;
      await writeFile(path.join(root, name), "contenu\n", "utf8");
    }

    const result = await captureRepositoryChanges(root, head, { environment: {} });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.changes.files.length, REVIEW_LIMITS.maxFiles);
      assert.equal(result.changes.omittedFiles, 12);
    }
  });

  it("echoue proprement lorsque le commit attendu n'existe pas", async () => {
    const { root } = await makeRepository();

    const result = await captureRepositoryChanges(root, "0".repeat(40), { environment: {} });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, RUNNER_ERROR.CLAUDE_REVIEW_FAILED);
    }
  });

  it("echoue proprement lorsque le repository n'existe plus", async () => {
    const result = await captureRepositoryChanges(
      path.join(workspace, "repository-absent"),
      "0".repeat(40),
      { environment: {} },
    );

    assert.equal(result.ok, false);
  });

  it("traduit un binaire Git absent en code dedie", async () => {
    const absent = (): Promise<GitCommandOutcome> =>
      Promise.resolve({ status: "unavailable" as const });

    const result = await captureRepositoryChanges("/quelque/part", "abc", { runGit: absent });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, RUNNER_ERROR.GIT_NOT_AVAILABLE);
    }
  });

  it("traduit un delai depasse en code dedie", async () => {
    const slow = (): Promise<GitCommandOutcome> => Promise.resolve({ status: "timeout" as const });

    const result = await captureRepositoryChanges("/quelque/part", "abc", { runGit: slow });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, RUNNER_ERROR.GIT_TIMEOUT);
    }
  });

  it("ne lance aucune commande Git d'ecriture", async () => {
    const seen: string[][] = [];
    const spy = (
      _directory: string,
      args: readonly string[],
    ): Promise<GitCommandOutcome> => {
      seen.push([...args]);
      return Promise.resolve({ status: "ok" as const, stdout: "" });
    };

    await captureRepositoryChanges("/quelque/part", "abc", { runGit: spy, environment: {} });

    const forbidden = [
      "add",
      "commit",
      "push",
      "reset",
      "restore",
      "checkout",
      "clean",
      "stash",
      "fetch",
      "pull",
      "merge",
      "rebase",
    ];
    for (const args of seen) {
      const verb = args[0] ?? "";
      assert.equal(forbidden.includes(verb), false, `commande interdite : ${args.join(" ")}`);
    }
    assert.ok(seen.length > 0);
  });
});
