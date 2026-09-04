/**
 * Le cas TripKit : une validation `npm` sur un repository Windows.
 *
 * ## Ce que ce fichier rejoue
 *
 * Le premier pilote reel a enregistre `npm run build` et `npm test`, puis a
 * produit :
 *
 * ```text
 * Infrastructure error
 * VALIDATION_SPAWN_FAILED
 * npm test — aucun code de sortie, duree inconnue
 * ```
 *
 * Alors que les deux commandes fonctionnaient parfaitement depuis un terminal.
 * Trois faits distincts s'additionnaient :
 *
 * 1. `C:\\Program Files\\nodejs\\` contient un fichier `npm` **sans extension** —
 *    le script destine a Unix — a cote de `npm.cmd`. La resolution retenait le
 *    premier parce qu'il existait, et Windows ne sait pas le lancer : `ENOENT`.
 * 2. Retenir `npm.cmd` n'aurait pas suffi : Node **refuse** de lancer un `.cmd`
 *    sans shell depuis CVE-2024-27980, et rend `EINVAL`.
 * 3. L'enveloppe `cmd.exe /d /s /c` existait deja, mais sa ligne etait quottee
 *    par Node argument par argument. Avec `/s`, `cmd.exe` retire la premiere et
 *    la derniere guillemet — et `"C:\\Program Files\\…"` devenait `C:\\Program`.
 *
 * ## Pourquoi la plateforme est simulee
 *
 * Pour que ces assertions vivent partout, pas seulement sur la machine du
 * pilote. Le systeme de fichiers et le lanceur de processus sont injectes ; la
 * branche `win32` est donc exercee a l'identique sous Linux et sous macOS.
 *
 * Le dernier bloc, lui, lance de vrais `npm` — et ne s'execute que sous Windows.
 * Il ne remplace rien : il confirme, la ou c'est possible, ce que la simulation
 * etablit partout.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { after, before, describe, it } from "node:test";

import { buildSpawnPlan, resolveExecutablePath } from "../claude/executable.ts";
import { runRepositoryValidation, type ProcessSpawner } from "./run-validation.ts";

/** Une installation Node reelle sous Windows, telle qu'elle existe sur disque. */
const NODEJS = "C:\\Program Files\\nodejs";
const WINDOWS = {
  PATH: NODEJS,
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
  ComSpec: "C:\\Windows\\System32\\cmd.exe",
};
const INSTALLED = new Set(
  [`${NODEJS}\\npm`, `${NODEJS}\\npm.cmd`, `${NODEJS}\\node.exe`].map((entry) =>
    entry.toLowerCase(),
  ),
);

/** Le systeme de fichiers de Windows est insensible a la casse. */
const fileExists = (candidate: string): boolean => INSTALLED.has(candidate.toLowerCase());

/** Les memes jetons, en minuscules : Windows ignore la casse des chemins. */
function lowered(values: readonly string[]): string[] {
  return values.map((value) => value.toLowerCase());
}

/** Le plan de lancement complet, tel que le runner le construirait. */
function planFor(command: string): { command: string; args: string[] } | null {
  const [program, ...args] = command.split(" ");
  const resolved = resolveExecutablePath(program ?? "", WINDOWS, "win32", { fileExists });
  if (resolved === null) {
    return null;
  }
  return buildSpawnPlan(resolved, args, WINDOWS, "win32");
}

let repository: string;

before(async () => {
  repository = await mkdtemp(path.join(os.tmpdir(), "nox-tripkit-"));
  execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
  execFileSync("git", ["-C", repository, "config", "user.email", "test@nox.invalid"], {
    stdio: "ignore",
  });
  execFileSync("git", ["-C", repository, "config", "user.name", "NOX Test"], { stdio: "ignore" });

  // Un projet npm minuscule : les scripts n'appellent que Node, jamais le
  // reseau, et aucune dependance n'est installee.
  await writeFile(
    path.join(repository, "package.json"),
    `${JSON.stringify(
      {
        name: "tripkit-essai",
        version: "1.0.0",
        private: true,
        scripts: {
          build: 'node -e "console.log(String.fromCharCode(66,85,73,76,68))"',
          test: 'node -e "console.log(String.fromCharCode(84,69,83,84))"',
          ko: 'node -e "process.exit(1)"',
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  execFileSync("git", ["-C", repository, "add", "-A"], { stdio: "ignore" });
  execFileSync("git", ["-C", repository, "commit", "-m", "init"], { stdio: "ignore" });
});

after(async () => {
  await rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("TripKit — la strategie Windows choisie pour npm", () => {
  it("ignore le script sans extension et passe par cmd.exe", () => {
    const plan = planFor("npm test");

    assert.ok(plan !== null);
    assert.equal(plan.command, "C:\\Windows\\System32\\cmd.exe");
    // `PATHEXT` est ecrit en majuscules et le fichier pose par npm en
    // minuscules : le systeme de fichiers de Windows ne fait pas la difference,
    // et cette assertion non plus.
    assert.deepEqual(lowered(plan.args), [
      "/d",
      "/s",
      "/c",
      '""c:\\program files\\nodejs\\npm.cmd" "test""',
    ]);
  });

  it("fait de meme pour npm run build", () => {
    const plan = planFor("npm run build");

    assert.ok(plan !== null);
    assert.deepEqual(lowered(plan.args), [
      "/d",
      "/s",
      "/c",
      '""c:\\program files\\nodejs\\npm.cmd" "run" "build""',
    ]);
  });

  it("ne lance jamais le fichier qui produisait ENOENT", () => {
    const plan = planFor("npm test");

    assert.ok(plan !== null);
    const line = plan.args.join(" ").toLowerCase();
    // Le chemin sans extension ne doit apparaitre nulle part sans son `.cmd`.
    assert.equal(line.includes('"c:\\program files\\nodejs\\npm"'), false);
    assert.ok(line.includes("npm.cmd"));
  });

  it("ne passe jamais un .cmd directement a spawn", () => {
    // C'est ce que Node refuse avec `EINVAL` : le programme lance est toujours
    // `cmd.exe`, jamais le script lui-meme.
    const plan = planFor("npm test");

    assert.ok(plan !== null);
    assert.equal(plan.command.toLowerCase().endsWith(".cmd"), false);
    assert.ok(plan.command.toLowerCase().endsWith("cmd.exe"));
  });

  it("laisse un vrai executable hors de l'enveloppe", () => {
    const plan = planFor("node --version");

    assert.ok(plan !== null);
    assert.equal(plan.command.toLowerCase(), `${NODEJS}\\node.exe`.toLowerCase());
    assert.deepEqual(plan.args, ["--version"]);
  });
});

/** Processus simule : ce que `cmd.exe` rendrait, sans lancer quoi que ce soit. */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly pid = 1234;
  kill(): boolean {
    return true;
  }
}

function spawnerReturning(
  exitCode: number | null,
  stdout: string,
  captured: { plan?: { command: string; args: string[] } },
): ProcessSpawner {
  return (plan) => {
    captured.plan = { command: plan.command, args: [...plan.args] };
    const child = new FakeChild();
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from(stdout, "utf8"));
      child.emit("close", exitCode);
    });
    return child as unknown as ReturnType<ProcessSpawner>;
  };
}

describe("TripKit — ce que NOX conclut de chaque issue", () => {
  it("rend un succes exploitable quand npm test passe", async () => {
    const captured: { plan?: { command: string; args: string[] } } = {};
    const outcome = await runRepositoryValidation(repository, "npm test", {
      environment: WINDOWS,
      platform: "win32",
      spawnProcess: spawnerReturning(0, "61 passed", captured),
    });

    assert.ok(outcome.ok);
    assert.equal(outcome.result.exitCode, 0);
    assert.equal(outcome.result.timedOut, false);
    assert.match(outcome.result.stdout, /61 passed/u);
    // La strategie Windows a bien ete choisie pour de bon, pas seulement en
    // theorie : c'est le plan reellement transmis au systeme.
    assert.ok(captured.plan?.command.toLowerCase().endsWith("cmd.exe"));
    assert.ok(captured.plan?.args.join(" ").toLowerCase().includes("npm.cmd"));
  });

  it("rend un succes exploitable quand npm run build passe", async () => {
    const captured: { plan?: { command: string; args: string[] } } = {};
    const outcome = await runRepositoryValidation(repository, "npm run build", {
      environment: WINDOWS,
      platform: "win32",
      spawnProcess: spawnerReturning(0, "built", captured),
    });

    assert.ok(outcome.ok);
    assert.equal(outcome.result.exitCode, 0);
    assert.ok(captured.plan?.args.join(" ").includes('"run" "build"'));
  });

  it("rend un echec de validation, jamais une panne, sur un code non nul", async () => {
    const outcome = await runRepositoryValidation(repository, "npm test", {
      environment: WINDOWS,
      platform: "win32",
      spawnProcess: spawnerReturning(1, "1 failed", { }),
    });

    // La distinction que ce hotfix existe pour tenir. `VALIDATION_SPAWN_FAILED`
    // reste reserve a l'impossibilite de creer le processus.
    assert.ok(outcome.ok);
    assert.equal(outcome.result.exitCode, 1);
  });

  it("rend VALIDATION_SPAWN_FAILED quand le processus ne peut pas naitre", async () => {
    const outcome = await runRepositoryValidation(repository, "npm test", {
      environment: WINDOWS,
      platform: "win32",
      spawnProcess: () => {
        const error = new Error("spawn C:\\Program Files\\nodejs\\npm.cmd EINVAL");
        Object.assign(error, { code: "EINVAL" });
        throw error;
      },
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.code, "VALIDATION_SPAWN_FAILED");
    const detail = outcome.ok === false ? outcome.detail : "";
    assert.match(detail, /EINVAL/u);
    // « Je n'ai pas pu regarder » ne devient jamais « j'ai regarde et c'est
    // faux » : rien dans le diagnostic ne parle du code du projet.
    assert.equal(detail.toLowerCase().includes("echec"), false);
    assert.equal(detail.includes("Program Files"), false);
  });

  it("refuse un programme absent sans pretendre a autre chose", async () => {
    const outcome = await runRepositoryValidation(repository, "npm test", {
      environment: { PATH: "", PATHEXT: ".CMD", ComSpec: WINDOWS.ComSpec },
      platform: "win32",
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.code, "VALIDATION_SPAWN_FAILED");
    assert.match(outcome.ok === false ? outcome.detail : "", /introuvable/u);
  });
});

/**
 * La meme chose, en vrai, la ou c'est possible.
 *
 * Ce bloc lance de vrais `npm` dans un vrai repository. Il est ignore hors de
 * Windows : les assertions ci-dessus, elles, valent partout.
 */
describe("TripKit — execution reelle sous Windows", { skip: process.platform !== "win32" }, () => {
  it("execute npm test et rend zero", async () => {
    const outcome = await runRepositoryValidation(repository, "npm test", {
      timeoutMs: 120_000,
    });

    assert.ok(outcome.ok, "npm test n'a pas pu etre lance");
    assert.equal(outcome.result.exitCode, 0);
    assert.match(outcome.result.stdout, /TEST/u);
  });

  it("execute npm run build et rend zero", async () => {
    const outcome = await runRepositoryValidation(repository, "npm run build", {
      timeoutMs: 120_000,
    });

    assert.ok(outcome.ok, "npm run build n'a pas pu etre lance");
    assert.equal(outcome.result.exitCode, 0);
    assert.match(outcome.result.stdout, /BUILD/u);
  });

  it("rend un code non nul plutot qu'une panne", async () => {
    const outcome = await runRepositoryValidation(repository, "npm run ko", {
      timeoutMs: 120_000,
    });

    assert.ok(outcome.ok);
    assert.notEqual(outcome.result.exitCode, 0);
  });
});
