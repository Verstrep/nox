import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildSpawnPlan,
  resolveExecutablePath,
  sanitizeEnvironment,
} from "./executable.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let workspace: string;

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-exec-"));
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("sanitizeEnvironment", () => {
  it("retire toutes les variables NOX", () => {
    const sanitized = sanitizeEnvironment({
      PATH: "/usr/bin",
      NOX_RUNNER_TOKEN: "secret",
      NOX_DATABASE_URL: "file:./x.db",
      NOX_CLAUDE_EXECUTABLE: "claude",
      HOME: "/home/theo",
    });

    assert.equal(sanitized["NOX_RUNNER_TOKEN"], undefined);
    assert.equal(sanitized["NOX_DATABASE_URL"], undefined);
    assert.equal(sanitized["NOX_CLAUDE_EXECUTABLE"], undefined);
    assert.equal(sanitized["PATH"], "/usr/bin");
    assert.equal(sanitized["HOME"], "/home/theo");
  });

  it("retire les variables NOX quelle que soit leur casse", () => {
    const sanitized = sanitizeEnvironment({ nox_runner_token: "secret", Nox_Autre: "x" });

    assert.equal(Object.keys(sanitized).length, 0);
  });

  it("laisse intactes les variables Claude de l'utilisateur", () => {
    // NOX n'ajoute aucune cle d'API, mais s'il en existe une elle appartient a
    // la configuration Claude Code de l'utilisateur : la retirer casserait une
    // authentification qui fonctionnait.
    const sanitized = sanitizeEnvironment({ ANTHROPIC_API_KEY: "sk-existant" });

    assert.equal(sanitized["ANTHROPIC_API_KEY"], "sk-existant");
  });

  it("ignore les variables sans valeur", () => {
    const sanitized = sanitizeEnvironment({ VIDE: undefined, PLEIN: "oui" });

    assert.equal("VIDE" in sanitized, false);
    assert.equal(sanitized["PLEIN"], "oui");
  });
});

describe("buildSpawnPlan", () => {
  it("lance directement un executable ordinaire", () => {
    const plan = buildSpawnPlan("/usr/local/bin/claude", ["-p"], {}, "linux");

    assert.ok(plan !== null);
    assert.equal(plan.command, "/usr/local/bin/claude");
    assert.deepEqual(plan.args, ["-p"]);
    // Hors enveloppe Windows, c'est Node qui echappe chaque argument.
    assert.equal(plan.windowsVerbatimArguments, false);
  });

  it("enveloppe un .cmd Windows dans une ligne ecrite par NOX", () => {
    const plan = buildSpawnPlan(
      "C:\\npm\\claude.cmd",
      ["-p", "--allowedTools", "Read,Bash(npm run test)"],
      { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      "win32",
    );

    assert.ok(plan !== null);
    assert.equal(plan.command, "C:\\Windows\\System32\\cmd.exe");
    // La ligne part telle quelle : c'est NOX qui l'a citee, pas Node. Laisser
    // Node echapper argument par argument produirait une ligne que `/s` relit
    // differemment — la panne du premier pilote reel.
    assert.equal(plan.windowsVerbatimArguments, true);
    assert.deepEqual(plan.args, [
      "/d",
      "/s",
      "/c",
      '""C:\\npm\\claude.cmd" "-p" "--allowedTools" "Read,Bash(npm run test)""',
    ]);
  });

  it("enveloppe aussi un .bat", () => {
    const plan = buildSpawnPlan("C:\\bin\\claude.bat", [], { ComSpec: "cmd.exe" }, "win32");

    assert.ok(plan !== null);
    assert.equal(plan.command, "cmd.exe");
    assert.deepEqual(plan.args, ["/d", "/s", "/c", '""C:\\bin\\claude.bat""']);
  });

  it("n'enveloppe pas un .exe Windows", () => {
    const plan = buildSpawnPlan("C:\\bin\\claude.exe", ["-p"], { ComSpec: "cmd.exe" }, "win32");

    assert.ok(plan !== null);
    assert.equal(plan.command, "C:\\bin\\claude.exe");
    assert.deepEqual(plan.args, ["-p"]);
    assert.equal(plan.windowsVerbatimArguments, false);
  });

  it("protege un chemin qui porte une espace et une esperluette", () => {
    const plan = buildSpawnPlan(
      "C:\\Program Files\\Claude & Co\\claude.cmd",
      ["--allowedTools", "Bash(npm run test)"],
      { ComSpec: "cmd.exe" },
      "win32",
    );

    assert.ok(plan !== null);
    // La paire exterieure est celle que `/s` consomme ; les paires interieures
    // rendent l'espace et l'esperluette litterales pour `cmd.exe`.
    assert.equal(
      plan.args[3],
      '""C:\\Program Files\\Claude & Co\\claude.cmd" "--allowedTools" "Bash(npm run test)""',
    );
  });

  it("refuse de construire une ligne qu'il ne saurait pas rendre inerte", () => {
    // `%` est developpe par `cmd.exe` **malgre** les guillemets : c'est le seul
    // caractere qu'une citation ne neutralise pas.
    assert.equal(
      buildSpawnPlan("C:\\bin\\outil.cmd", ["%PATH%"], { ComSpec: "cmd.exe" }, "win32"),
      null,
    );
    // Un guillemet romprait la citation.
    assert.equal(
      buildSpawnPlan('C:\\bin\\ou"til.cmd', [], { ComSpec: "cmd.exe" }, "win32"),
      null,
    );
    // Un antislash final serait lu comme un echappement du guillemet fermant.
    assert.equal(
      buildSpawnPlan("C:\\bin\\outil.cmd", ["dossier\\"], { ComSpec: "cmd.exe" }, "win32"),
      null,
    );
  });

  it("ne refuse rien hors de l'enveloppe Windows", () => {
    // Les memes jetons partent sans encombre la ou aucune ligne n'est ecrite :
    // le refus protege `cmd.exe`, il ne restreint pas les autres plateformes.
    const plan = buildSpawnPlan("/usr/bin/outil", ["%PATH%"], {}, "linux");

    assert.ok(plan !== null);
    assert.deepEqual(plan.args, ["%PATH%"]);
  });
});

describe("resolveExecutablePath", () => {
  it("retourne null pour un nom introuvable", () => {
    assert.equal(
      resolveExecutablePath("claude-qui-n-existe-pas", { PATH: workspace }, "linux"),
      null,
    );
  });

  it("retourne null pour un nom vide", () => {
    assert.equal(resolveExecutablePath("   ", {}, "linux"), null);
  });

  it("trouve un fichier present dans le PATH", async () => {
    const name = "faux-outil";
    const file = path.join(workspace, name);
    await writeFile(file, "#!/bin/sh\nexit 0\n", "utf8");
    if (process.platform !== "win32") {
      await chmod(file, 0o755);
    }

    // Sous Unix, un fichier sans extension est un executable parfaitement
    // ordinaire. La branche Windows est exercee separement, avec une sonde.
    assert.equal(resolveExecutablePath(file, {}, "linux"), path.resolve(file));
  });

  it("accepte un chemin absolu existant", async () => {
    const file = path.join(workspace, "outil-absolu");
    await writeFile(file, "x", "utf8");

    assert.equal(resolveExecutablePath(file, {}, "linux"), path.resolve(file));
  });

  it("refuse un chemin absolu inexistant", () => {
    assert.equal(resolveExecutablePath(path.join(workspace, "jamais-vu"), {}, "linux"), null);
  });

  it("essaie les extensions de PATHEXT sous Windows", async () => {
    const base = path.join(workspace, "outil-windows");
    await writeFile(`${base}.CMD`, "@echo off\n", "utf8");

    const resolved = resolveExecutablePath(
      "outil-windows",
      { PATH: workspace, PATHEXT: ".CMD" },
      "win32",
    );
    assert.equal(resolved, `${path.resolve(base)}.CMD`);
  });
});

/**
 * La branche Windows, exercee depuis n'importe quelle plateforme.
 *
 * Le systeme de fichiers est remplace par une sonde : simuler `win32` sans
 * pouvoir simuler l'arborescence ne prouverait rien, et faire dependre ces
 * assertions de la machine qui execute les tests les rendrait invisibles
 * partout ailleurs.
 */
describe("resolveExecutablePath — Windows simule", () => {
  const NODEJS = "C:\\Program Files\\nodejs";
  const WINDOWS_ENVIRONMENT = {
    PATH: NODEJS,
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
  };

  /** Une installation npm reelle : le script Unix **et** le wrapper Windows. */
  const NPM_INSTALL = new Set([
    `${NODEJS}\\npm`,
    `${NODEJS}\\npm.cmd`,
    `${NODEJS}\\npx`,
    `${NODEJS}\\npx.cmd`,
    `${NODEJS}\\node.exe`,
  ]);

  /**
   * Sonde de presence, insensible a la casse.
   *
   * C'est le comportement du systeme de fichiers de Windows, et le simuler
   * compte : `PATHEXT` y est ecrit en majuscules alors que les fichiers poses
   * par npm sont en minuscules. Une sonde sensible a la casse ferait echouer
   * des resolutions qui reussissent en vrai — elle prouverait le contraire de
   * ce qu'on cherche a etablir.
   */
  const probe = (files: ReadonlySet<string>) => {
    const lowered = new Set([...files].map((entry) => entry.toLowerCase()));
    return (candidate: string) => lowered.has(candidate.toLowerCase());
  };

  /** Comparaison insensible a la casse, comme le systeme lui-meme. */
  function assertSamePath(actual: string | null, expected: string): void {
    assert.equal(actual?.toLowerCase() ?? null, expected.toLowerCase());
  }

  it("ignore le script sans extension et retient le wrapper .cmd", () => {
    // La panne du premier pilote reel, en une assertion. `C:\Program
    // Files\nodejs\npm` existe — c'est le script destine a Unix — et Windows
    // ne sait pas le lancer : `spawn` rendait `ENOENT`.
    const resolved = resolveExecutablePath("npm", WINDOWS_ENVIRONMENT, "win32", {
      fileExists: probe(NPM_INSTALL),
    });

    assertSamePath(resolved, `${NODEJS}\\npm.cmd`);
  });

  it("retient de meme npx.cmd", () => {
    const resolved = resolveExecutablePath("npx", WINDOWS_ENVIRONMENT, "win32", {
      fileExists: probe(NPM_INSTALL),
    });

    assertSamePath(resolved, `${NODEJS}\\npx.cmd`);
  });

  it("retient un vrai executable tel quel", () => {
    const resolved = resolveExecutablePath("node", WINDOWS_ENVIRONMENT, "win32", {
      fileExists: probe(NPM_INSTALL),
    });

    assertSamePath(resolved, `${NODEJS}\\node.exe`);
  });

  it("suit l'ordre de PATHEXT", () => {
    const files = new Set([`${NODEJS}\\outil.cmd`, `${NODEJS}\\outil.exe`]);
    const resolved = resolveExecutablePath("outil", WINDOWS_ENVIRONMENT, "win32", {
      fileExists: probe(files),
    });

    // `.EXE` precede `.CMD` dans `PATHEXT` : c'est lui qui gagne.
    assertSamePath(resolved, `${NODEJS}\\outil.exe`);
  });

  it("ne retient jamais un fichier sans extension executable", () => {
    const files = new Set([`${NODEJS}\\outil`, `${NODEJS}\\autre.txt`]);

    assert.equal(
      resolveExecutablePath("outil", WINDOWS_ENVIRONMENT, "win32", { fileExists: probe(files) }),
      null,
    );
    assert.equal(
      resolveExecutablePath("autre", WINDOWS_ENVIRONMENT, "win32", { fileExists: probe(files) }),
      null,
    );
  });

  it("accepte un chemin deja pourvu d'une extension de PATHEXT", () => {
    const files = new Set([`${NODEJS}\\outil.cmd`]);

    assert.equal(
      resolveExecutablePath("outil.cmd", WINDOWS_ENVIRONMENT, "win32", {
        fileExists: probe(files),
      }),
      `${NODEJS}\\outil.cmd`,
    );
  });

  it("resout un chemin relatif depuis le repository, jamais depuis le runner", () => {
    // `./gradlew` designe le programme du repository. Le resoudre depuis le
    // dossier ou le runner a ete lance viserait un fichier qui n'a rien a voir.
    const repository = "D:\\depots\\projet";
    const files = new Set([`${repository}\\gradlew.bat`]);

    const resolved = resolveExecutablePath("./gradlew", WINDOWS_ENVIRONMENT, "win32", {
      cwd: repository,
      fileExists: probe(files),
    });

    assertSamePath(resolved, `${repository}\\gradlew.bat`);
  });

  it("rend le plan de lancement complet pour npm test", () => {
    const resolved = resolveExecutablePath("npm", WINDOWS_ENVIRONMENT, "win32", {
      fileExists: probe(NPM_INSTALL),
    });
    assert.ok(resolved !== null);

    const plan = buildSpawnPlan(resolved, ["test"], WINDOWS_ENVIRONMENT, "win32");

    assert.ok(plan !== null);
    assert.equal(plan.command, "C:\\Windows\\System32\\cmd.exe");
    assert.deepEqual(plan.args, [
      "/d",
      "/s",
      "/c",
      '""C:\\Program Files\\nodejs\\npm.CMD" "test""',
    ]);
    assert.equal(plan.windowsVerbatimArguments, true);
  });

  it("rend le plan de lancement complet pour npm run build", () => {
    const resolved = resolveExecutablePath("npm", WINDOWS_ENVIRONMENT, "win32", {
      fileExists: probe(NPM_INSTALL),
    });
    assert.ok(resolved !== null);

    const plan = buildSpawnPlan(resolved, ["run", "build"], WINDOWS_ENVIRONMENT, "win32");

    assert.ok(plan !== null);
    assert.deepEqual(plan.args, [
      "/d",
      "/s",
      "/c",
      '""C:\\Program Files\\nodejs\\npm.CMD" "run" "build""',
    ]);
  });

  it("lance un vrai executable sans enveloppe", () => {
    const resolved = resolveExecutablePath("node", WINDOWS_ENVIRONMENT, "win32", {
      fileExists: probe(NPM_INSTALL),
    });
    assert.ok(resolved !== null);

    const plan = buildSpawnPlan(resolved, ["script.js"], WINDOWS_ENVIRONMENT, "win32");

    assert.ok(plan !== null);
    assertSamePath(plan.command, `${NODEJS}\\node.exe`);
    assert.deepEqual(plan.args, ["script.js"]);
    assert.equal(plan.windowsVerbatimArguments, false);
  });

  it("ne nomme aucun outil en particulier", async () => {
    // La correction est generale : rien dans le module ne connait npm, npx,
    // TripKit ni aucun ecosysteme.
    const source = await readFile(path.join(HERE, "executable.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/.*$/gmu, " ");

    for (const forbidden of ["npm", "npx", "yarn", "pnpm", "gradlew", "TripKit"]) {
      assert.equal(code.includes(forbidden), false, forbidden);
    }
  });
});
