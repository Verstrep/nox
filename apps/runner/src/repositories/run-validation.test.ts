/**
 * Execution d'une commande de validation par le runner.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'**aucun interprete de commandes** n'est jamais implique : ni `shell: true`,
 * ni `cmd /c`, ni `bash -c`. Une commande validee est une suite de jetons, et
 * c'est ce decoupage-la qui part au systeme. C'est la garantie qui empeche
 * qu'une chaine acceptee se transforme en autre chose au dernier moment, et
 * elle se verifie sur la **source** — pas sur un comportement observe une fois.
 *
 * Que la politique est rejouee **ici**, et pas seulement dans le web : le runner
 * ne fait confiance a personne.
 *
 * Que le repository est resolu et canonicalise avant tout lancement, et que le
 * `cwd` ne vient jamais d'un corps de requete.
 *
 * Les executions reelles sont volontairement minuscules — `node --version` — :
 * ce fichier verifie le mecanisme, pas un ecosysteme.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { AUTONOMOUS_VALIDATION_OUTPUT_LIMIT } from "@nox/shared";

import { readTrackedState, runRepositoryValidation } from "./run-validation.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Le code seul, commentaires retires.
 *
 * L'entete de ce module **nomme** ce qu'il refuse — « pas de `shell: true` »,
 * « pas de `cmd /c` » — et c'est une bonne chose : la garantie est ecrite la ou
 * on la cherche. Le controle porte donc sur ce qui s'execute, pas sur ce qui se
 * lit.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/.*$/gmu, " ");
}

let repository: string;

before(async () => {
  repository = await mkdtemp(path.join(os.tmpdir(), "nox-run-validation-"));
  execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
  execFileSync("git", ["-C", repository, "config", "user.email", "test@nox.invalid"], {
    stdio: "ignore",
  });
  execFileSync("git", ["-C", repository, "config", "user.name", "NOX Test"], { stdio: "ignore" });

  await writeFile(path.join(repository, "ok.mjs"), "process.exit(0);\n", "utf8");
  await writeFile(path.join(repository, "ko.mjs"), "process.exit(7);\n", "utf8");
  await writeFile(
    path.join(repository, "bavard.mjs"),
    `process.stdout.write("y".repeat(${String(AUTONOMOUS_VALIDATION_OUTPUT_LIMIT * 3)}));\n`,
    "utf8",
  );
  await writeFile(path.join(repository, "lent.mjs"), "setTimeout(() => {}, 60000);\n", "utf8");
  execFileSync("git", ["-C", repository, "add", "-A"], { stdio: "ignore" });
  execFileSync("git", ["-C", repository, "commit", "-m", "init"], { stdio: "ignore" });
});

after(async () => {
  await rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("politique rejouee par le runner", () => {
  it("refuse une commande que NOX n'a pas le droit de lancer", async () => {
    for (const command of ["npm install", "git push", "npm run dev", "sudo make"]) {
      const outcome = await runRepositoryValidation(repository, command);
      assert.equal(outcome.ok, false, command);
      assert.equal(
        outcome.ok === false && outcome.code,
        "VALIDATION_COMMAND_REFUSED",
        command,
      );
    }
  });

  it("refuse une commande chainee, avant meme de resoudre le repository", async () => {
    const outcome = await runRepositoryValidation("chemin-inexistant", "node ok.mjs && rm -rf .");
    assert.equal(outcome.ok, false);
    // La politique d'abord : le refus ne depend pas d'un repository valide.
    assert.equal(outcome.ok === false && outcome.code, "VALIDATION_COMMAND_REFUSED");
  });

  it("refuse un repository introuvable", async () => {
    const outcome = await runRepositoryValidation(
      path.join(os.tmpdir(), "nox-inexistant-validation"),
      "node ok.mjs",
    );
    assert.equal(outcome.ok, false);
    assert.notEqual(outcome.ok === false && outcome.code, "VALIDATION_COMMAND_REFUSED");
  });
});

describe("execution", () => {
  it("rend le code de sortie reel, zero compris", async () => {
    const outcome = await runRepositoryValidation(repository, "node ok.mjs");
    assert.ok(outcome.ok);
    assert.equal(outcome.result.exitCode, 0);
    assert.equal(outcome.result.timedOut, false);
  });

  it("rend un code non nul plutot qu'une erreur", async () => {
    // Un code de sortie non nul **est** une reponse, et c'est precisement celle
    // qu'une validation cherche a obtenir.
    const outcome = await runRepositoryValidation(repository, "node ko.mjs");
    assert.ok(outcome.ok);
    assert.equal(outcome.result.exitCode, 7);
  });

  it("borne chaque flux et annonce la troncature", async () => {
    const outcome = await runRepositoryValidation(repository, "node bavard.mjs");
    assert.ok(outcome.ok);
    assert.equal(outcome.result.stdoutTruncated, true);
    assert.ok(outcome.result.stdout.length <= AUTONOMOUS_VALIDATION_OUTPUT_LIMIT);
    // La commande a bien fini : borner la trace n'arrete pas le processus.
    assert.equal(outcome.result.exitCode, 0);
    assert.equal(outcome.result.timedOut, false);
  });

  it("arrete un processus qui ne se termine pas", async () => {
    const started = Date.now();
    const outcome = await runRepositoryValidation(repository, "node lent.mjs", {
      timeoutMs: 1_500,
    });
    assert.ok(outcome.ok);
    assert.equal(outcome.result.timedOut, true);
    assert.ok(Date.now() - started < 20_000);
  });

  it("ne laisse passer aucune variable NOX_*", async () => {
    await writeFile(
      path.join(repository, "env.mjs"),
      [
        'const noms = Object.keys(process.env).filter((name) => name.startsWith("NOX_"));',
        "process.stdout.write(noms.join(String.fromCharCode(44)));",
        "process.exit(0);",
        "",
      ].join("\n"),
      "utf8",
    );

    const outcome = await runRepositoryValidation(repository, "node env.mjs", {
      environment: {
        PATH: process.env["PATH"],
        NOX_RUNNER_TOKEN: "jeton-secret",
        NOX_OPENAI_API_KEY: "cle-secrete",
        SystemRoot: process.env["SystemRoot"],
        ComSpec: process.env["ComSpec"],
      },
    });

    assert.ok(outcome.ok);
    assert.equal(outcome.result.stdout.trim(), "");
    assert.ok(!outcome.result.stdout.includes("jeton-secret"));
    assert.ok(!outcome.result.stdout.includes("cle-secrete"));
  });
});

describe("etat suivi du repository", () => {
  it("rend une empreinte stable pour un repository inchange", async () => {
    const first = await readTrackedState(repository);
    const second = await readTrackedState(repository);
    assert.ok(first.ok);
    assert.ok(second.ok);
    assert.equal(first.digest, second.digest);
  });

  it("change quand un fichier suivi est modifie", async () => {
    const before = await readTrackedState(repository);
    await writeFile(path.join(repository, "ok.mjs"), "process.exit(0);\n// ajout\n", "utf8");
    const after = await readTrackedState(repository);

    assert.ok(before.ok);
    assert.ok(after.ok);
    assert.notEqual(before.digest, after.digest);

    execFileSync("git", ["-C", repository, "checkout", "--", "ok.mjs"], { stdio: "ignore" });
  });

  it("ignore un artefact non suivi", async () => {
    // `dist/` et `coverage/` apparaissent legitimement pendant une validation :
    // les compter ferait refuser toutes les completions automatiques.
    const before = await readTrackedState(repository);
    await writeFile(path.join(repository, "artefact.log"), "sortie de build\n", "utf8");
    const after = await readTrackedState(repository);

    assert.ok(before.ok);
    assert.ok(after.ok);
    assert.equal(before.digest, after.digest);

    await rm(path.join(repository, "artefact.log"), { force: true });
  });
});

describe("aucun interprete de commandes", () => {
  it("ne demande jamais de shell, sous aucune forme", async () => {
    const source = code(await readFile(path.join(HERE, "run-validation.ts"), "utf8"));

    // Le refus tient a la **source** : une chaine acceptee ne doit jamais
    // pouvoir se transformer en autre chose au dernier moment.
    for (const forbidden of [
      "shell: true",
      "cmd /c",
      "cmd.exe",
      "powershell",
      "bash -c",
      "sh -c",
      "execSync",
      "exec(",
    ]) {
      assert.ok(!source.includes(forbidden), forbidden);
    }

    assert.ok(source.includes("shell: false"), "le shell est explicitement refuse");
    assert.ok(source.includes("windowsHide: true"), "aucune fenetre n'est ouverte");
  });

  it("n'accepte aucun repertoire de travail venu d'ailleurs", async () => {
    const source = code(await readFile(path.join(HERE, "run-validation.ts"), "utf8"));
    // Le repertoire de travail est la racine **canonique resolue**, jamais une
    // valeur recue dans un corps de requete.
    assert.ok(source.includes("resolved.canonicalPath"));
    assert.ok(!source.includes("cwd: repositoryPath"));
    assert.ok(!source.includes("cwd: request"));
  });
});
