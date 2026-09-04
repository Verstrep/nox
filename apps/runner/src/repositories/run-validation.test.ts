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
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { AUTONOMOUS_VALIDATION_OUTPUT_LIMIT } from "@nox/shared";

import type { SpawnPlan } from "../claude/executable.ts";
import {
  readTrackedState,
  runRepositoryValidation,
  type ProcessSpawner,
} from "./run-validation.ts";

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
/**
 * Faux dossier d'outils, pour les scenarios a plateforme simulee.
 *
 * Simuler `linux` depuis Windows change la resolution : un fichier nu y est
 * executable. Sans un `PATH` qui en contienne un, la resolution echouerait pour
 * une raison sans rapport avec ce que le test cherche a prouver.
 */
let toolsDir: string;

before(async () => {
  toolsDir = await mkdtemp(path.join(os.tmpdir(), "nox-outils-"));
  await writeFile(path.join(toolsDir, "node"), "#!/bin/sh\nexit 0\n", "utf8");

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
  await rm(toolsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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


/**
 * Un faux processus, pour exercer ce qu'un vrai rendrait instable.
 *
 * Panne de creation, depassement de delai et annulation ne se provoquent pas de
 * facon reproductible avec un vrai programme : ils dependraient de la
 * plateforme, de la charge et du hasard. Ici, ils se declenchent a la demande.
 */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly pid = 4242;
  killed = false;
  readonly signals: (string | undefined)[] = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.signals.push(signal);
    return true;
  }

  /** Ce qu'un processus fait de plus utile : ecrire, puis se terminer. */
  finish(options: { stdout?: string; stderr?: string; code: number | null }): void {
    if (options.stdout !== undefined) {
      this.stdout.emit("data", Buffer.from(options.stdout, "utf8"));
    }
    if (options.stderr !== undefined) {
      this.stderr.emit("data", Buffer.from(options.stderr, "utf8"));
    }
    this.emit("close", options.code);
  }
}

type Launch = { plan: SpawnPlan; cwd: string; env: NodeJS.ProcessEnv };

/** Lanceur simule : enregistre ce qu'il recoit et rend le processus programme. */
function spawner(
  launches: Launch[],
  act: (child: FakeChild) => void,
): ProcessSpawner {
  return (plan, cwd, env) => {
    launches.push({ plan, cwd, env });
    const child = new FakeChild();
    setImmediate(() => {
      act(child);
    });
    return child as unknown as ReturnType<ProcessSpawner>;
  };
}

describe("panne d'infrastructure, et rien d'autre", () => {
  it("distingue un programme introuvable", async () => {
    const outcome = await runRepositoryValidation(repository, "node ok.mjs", {
      // Un `PATH` vide : aucun programme n'est trouvable.
      environment: { PATH: "" },
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.code, "VALIDATION_SPAWN_FAILED");
    assert.match(outcome.ok === false ? outcome.detail : "", /introuvable/u);
  });

  it("nomme le code systeme quand la creation du processus echoue", async () => {
    const outcome = await runRepositoryValidation(repository, "node ok.mjs", {
      spawnProcess: () => {
        const error = new Error("spawn C:\\Program Files\\nodejs\\npm ENOENT");
        Object.assign(error, { code: "ENOENT" });
        throw error;
      },
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.code, "VALIDATION_SPAWN_FAILED");

    const detail = outcome.ok === false ? outcome.detail : "";
    assert.match(detail, /ENOENT/u);
    // Le message d'origine porte le chemin absolu de l'executable : il ne sort
    // jamais du runner.
    assert.equal(detail.includes("Program Files"), false);
    assert.equal(detail.includes("nodejs"), false);
    assert.equal(detail.includes("spawn "), false);
  });

  it("nomme aussi le code systeme d'un evenement d'erreur tardif", async () => {
    const outcome = await runRepositoryValidation(repository, "node ok.mjs", {
      spawnProcess: spawner([], (child) => {
        const error = new Error("spawn D:\\secret\\outil EACCES");
        Object.assign(error, { code: "EACCES" });
        child.emit("error", error);
      }),
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.code, "VALIDATION_SPAWN_FAILED");
    const detail = outcome.ok === false ? outcome.detail : "";
    assert.match(detail, /EACCES/u);
    assert.equal(detail.includes("secret"), false);
  });

  it("ne fait jamais passer un echec de commande pour une panne", async () => {
    // La distinction que ce hotfix existe pour tenir : un code de sortie non nul
    // **est** une reponse. `VALIDATION_SPAWN_FAILED` reste reserve a
    // l'impossibilite de creer le processus.
    const outcome = await runRepositoryValidation(repository, "node ko.mjs");

    assert.ok(outcome.ok);
    assert.equal(outcome.result.exitCode, 7);
  });

  it("ne laisse fuir ni environnement ni secret dans un diagnostic", async () => {
    const outcome = await runRepositoryValidation(repository, "node ok.mjs", {
      environment: { PATH: "", NOX_RUNNER_TOKEN: "jeton-tres-secret" },
    });

    const detail = outcome.ok === false ? outcome.detail : "";
    assert.equal(detail.includes("jeton-tres-secret"), false);
    assert.equal(detail.includes("NOX_"), false);
  });
});

describe("plan de lancement transmis au systeme", () => {
  it("lance dans la racine canonique du repository", async () => {
    const launches: Launch[] = [];
    const outcome = await runRepositoryValidation(repository, "node ok.mjs", {
      spawnProcess: spawner(launches, (child) => {
        child.finish({ code: 0 });
      }),
    });

    assert.ok(outcome.ok);
    assert.equal(launches.length, 1);
    // La racine **resolue**, jamais la chaine recue.
    assert.equal(launches[0]?.cwd, await realpath(repository));
  });

  it("ne transmet aucune variable NOX au processus", async () => {
    const launches: Launch[] = [];
    await runRepositoryValidation(repository, "node ok.mjs", {
      environment: { ...process.env, NOX_RUNNER_TOKEN: "secret", NOX_AUTRE: "x" },
      spawnProcess: spawner(launches, (child) => {
        child.finish({ code: 0 });
      }),
    });

    const env = launches[0]?.env ?? {};
    assert.equal(Object.keys(env).some((name) => name.toUpperCase().startsWith("NOX_")), false);
  });

  it("capture stdout et stderr separement", async () => {
    const outcome = await runRepositoryValidation(repository, "node ok.mjs", {
      spawnProcess: spawner([], (child) => {
        child.finish({ stdout: "sortie standard", stderr: "sortie d'erreur", code: 0 });
      }),
    });

    assert.ok(outcome.ok);
    assert.equal(outcome.result.stdout, "sortie standard");
    assert.equal(outcome.result.stderr, "sortie d'erreur");
    assert.equal(outcome.result.exitCode, 0);
  });

  it("rend une duree, meme pour une commande instantanee", async () => {
    const outcome = await runRepositoryValidation(repository, "node ok.mjs", {
      spawnProcess: spawner([], (child) => {
        child.finish({ code: 0 });
      }),
    });

    assert.ok(outcome.ok);
    assert.ok(outcome.result.durationMs >= 0);
  });

  it("arrete l'arbre du processus au depassement de delai, et n'invente aucun code", async () => {
    const child = new FakeChild();
    const outcome = await runRepositoryValidation(repository, "node lent.mjs", {
      timeoutMs: 20,
      platform: "linux",
      environment: { PATH: toolsDir },
      spawnProcess: () => {
        // Ne se termine que lorsqu'on le tue : exactement le cas du delai.
        child.on("__stopped", () => {
          child.emit("close", null);
        });
        const originalKill = child.kill.bind(child);
        child.kill = (signal?: NodeJS.Signals) => {
          const result = originalKill(signal);
          child.emit("__stopped");
          return result;
        };
        return child as unknown as ReturnType<ProcessSpawner>;
      },
    });

    assert.ok(outcome.ok);
    assert.equal(outcome.result.timedOut, true);
    // Un processus tue n'a pas de code de sortie qui veuille dire quelque chose.
    assert.equal(outcome.result.exitCode, null);
    assert.ok(child.killed);
  });

  it("arrete le processus sur annulation, sans le transformer en echec de code", async () => {
    const controller = new AbortController();
    const child = new FakeChild();

    const running = runRepositoryValidation(repository, "node lent.mjs", {
      platform: "linux",
      environment: { PATH: toolsDir },
      signal: controller.signal,
      spawnProcess: () => {
        const originalKill = child.kill.bind(child);
        child.kill = (signal?: NodeJS.Signals) => {
          const result = originalKill(signal);
          setImmediate(() => {
            child.emit("close", null);
          });
          return result;
        };
        // L'abandon est demande une fois le processus lance : c'est l'ordre
        // reel, et il rend le test deterministe.
        setImmediate(() => {
          controller.abort();
        });
        return child as unknown as ReturnType<ProcessSpawner>;
      },
    });

    const outcome = await running;

    assert.ok(outcome.ok);
    assert.ok(child.killed);
    // Une annulation n'est pas un depassement de delai.
    assert.equal(outcome.result.timedOut, false);
    assert.equal(outcome.result.exitCode, null);
  });
});

describe("aucun outil n'est nomme en particulier", () => {
  it("ne connait ni npm, ni TripKit, ni aucun ecosysteme", async () => {
    const source = code(await readFile(path.join(HERE, "run-validation.ts"), "utf8"));

    for (const forbidden of ["npm", "npx", "yarn", "pnpm", "gradlew", "TripKit", "package.json"]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });
});


describe("annulation deja demandee", () => {
  it("arrete le processus meme si le signal a precede son lancement", async () => {
    // Entre la resolution du repository et l'attente du signal, il s'ecoule un
    // appel a Git. Un abandon survenu pendant ce temps ne doit pas etre perdu :
    // le processus tournerait sinon jusqu'au delai maximal.
    const controller = new AbortController();
    controller.abort();

    const child = new FakeChild();
    const outcome = await runRepositoryValidation(repository, "node lent.mjs", {
      platform: "linux",
      environment: { PATH: toolsDir },
      signal: controller.signal,
      spawnProcess: () => {
        const originalKill = child.kill.bind(child);
        child.kill = (signal?: NodeJS.Signals) => {
          const result = originalKill(signal);
          setImmediate(() => {
            child.emit("close", null);
          });
          return result;
        };
        return child as unknown as ReturnType<ProcessSpawner>;
      },
    });

    assert.ok(outcome.ok);
    assert.ok(child.killed);
  });
});
