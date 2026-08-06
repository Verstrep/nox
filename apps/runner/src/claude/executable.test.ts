import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  buildSpawnPlan,
  resolveExecutablePath,
  sanitizeEnvironment,
} from "./executable.ts";

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

    assert.equal(plan.command, "/usr/local/bin/claude");
    assert.deepEqual(plan.args, ["-p"]);
  });

  it("enveloppe un .cmd Windows dans cmd.exe, avec une liste fixe", () => {
    const plan = buildSpawnPlan(
      "C:\\npm\\claude.cmd",
      ["-p", "--allowedTools", "Read,Bash(npm run test)"],
      { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      "win32",
    );

    assert.equal(plan.command, "C:\\Windows\\System32\\cmd.exe");
    // Chaque argument reste un element distinct : rien n'est concatene, donc
    // rien n'est interprete.
    assert.deepEqual(plan.args, [
      "/d",
      "/s",
      "/c",
      "C:\\npm\\claude.cmd",
      "-p",
      "--allowedTools",
      "Read,Bash(npm run test)",
    ]);
  });

  it("enveloppe aussi un .bat", () => {
    const plan = buildSpawnPlan("C:\\bin\\claude.bat", [], { ComSpec: "cmd.exe" }, "win32");
    assert.equal(plan.command, "cmd.exe");
    assert.ok(plan.args.includes("C:\\bin\\claude.bat"));
  });

  it("n'enveloppe pas un .exe Windows", () => {
    const plan = buildSpawnPlan("C:\\bin\\claude.exe", ["-p"], { ComSpec: "cmd.exe" }, "win32");

    assert.equal(plan.command, "C:\\bin\\claude.exe");
    assert.deepEqual(plan.args, ["-p"]);
  });

  it("supporte les espaces et caracteres speciaux dans le chemin", () => {
    const plan = buildSpawnPlan(
      "C:\\Program Files\\Claude & Co\\claude.cmd",
      ["--allowedTools", "Bash(npm run test)"],
      { ComSpec: "cmd.exe" },
      "win32",
    );

    // Le chemin reste un argument unique : Node se charge de l'echappement.
    assert.equal(plan.args[3], "C:\\Program Files\\Claude & Co\\claude.cmd");
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

    // Sous Windows la resolution ajoute une extension : on vise donc le chemin
    // direct, qui est le meme code de recherche.
    const resolved = resolveExecutablePath(file, {}, process.platform);
    assert.equal(resolved, path.resolve(file));
  });

  it("accepte un chemin absolu existant", async () => {
    const file = path.join(workspace, "outil-absolu");
    await writeFile(file, "x", "utf8");

    assert.equal(resolveExecutablePath(file, {}, process.platform), path.resolve(file));
  });

  it("refuse un chemin absolu inexistant", () => {
    assert.equal(
      resolveExecutablePath(path.join(workspace, "jamais-vu"), {}, process.platform),
      null,
    );
  });

  it("essaie les extensions de PATHEXT sous Windows", async () => {
    const base = path.join(workspace, "outil-windows");
    await writeFile(`${base}.CMD`, "@echo off\n", "utf8");

    const resolved = resolveExecutablePath("outil-windows", { PATH: workspace, PATHEXT: ".CMD" }, "win32");
    assert.equal(resolved, `${path.resolve(base)}.CMD`);
  });
});
