import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import type { ClaudeConfig } from "../config.ts";
import { buildClaudeArguments, launchClaude } from "./launcher.ts";

/**
 * Ces tests lancent un **faux** Claude Code : un script Node qui imite le
 * contrat de l'outil et enregistre ce qu'il a recu. Aucune requete reelle n'est
 * faite, aucun quota n'est consomme.
 *
 * Le faux executable est enveloppe dans un script `.cmd` sous Windows : c'est
 * exactement la forme du `claude.cmd` genere par npm, donc le chemin Windows
 * est teste pour de vrai, et pas seulement simule.
 */

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "fake-claude.mjs",
);

let workspace: string;
let executable: string;
let reportPath: string;

const isWindows = process.platform === "win32";

function claudeConfig(overrides: Partial<ClaudeConfig> = {}): ClaudeConfig {
  return { executable, maxTurns: 12, timeoutMinutes: 5, ...overrides };
}

async function readReport(): Promise<{
  argv: string[];
  cwd: string;
  prompt: string;
  environmentNames: string[];
}> {
  return JSON.parse(await readFile(reportPath, "utf8")) as {
    argv: string[];
    cwd: string;
    prompt: string;
    environmentNames: string[];
  };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-launcher-"));
  reportPath = path.join(workspace, "report.json");

  if (isWindows) {
    executable = path.join(workspace, "faux-claude.cmd");
    await writeFile(executable, `@echo off\r\nnode "${FIXTURE}" %*\r\n`, "utf8");
  } else {
    executable = path.join(workspace, "faux-claude.sh");
    await writeFile(executable, `#!/bin/sh\nexec node "${FIXTURE}" "$@"\n`, "utf8");
    await chmod(executable, 0o755);
  }

  process.env["FAKE_CLAUDE_REPORT"] = reportPath;
  // Une variable NOX de test : elle ne doit pas atteindre le processus enfant.
  process.env["NOX_RUNNER_TOKEN"] = "jeton-qui-ne-doit-pas-fuir";
});

after(async () => {
  delete process.env["FAKE_CLAUDE_REPORT"];
  delete process.env["NOX_RUNNER_TOKEN"];
  delete process.env["FAKE_CLAUDE_MODE"];
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("buildClaudeArguments", () => {
  it("construit le mode non interactif avec sortie progressive", () => {
    const args = buildClaudeArguments({ allowedTools: [], disallowedTools: [], maxTurns: 80 });

    assert.ok(args.includes("-p"));
    assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
    assert.equal(args[args.indexOf("--max-turns") + 1], "80");
  });

  it("ne demande pas les messages partiels", () => {
    const args = buildClaudeArguments({ allowedTools: [], disallowedTools: [], maxTurns: 10 });

    // Un evenement par fragment de token produirait des milliers d'evenements
    // sans rien apprendre de plus que le message complet qui les suit.
    assert.equal(args.includes("--include-partial-messages"), false);
  });

  it("ajoute --verbose exactement une fois, comme l'exige stream-json", () => {
    const args = buildClaudeArguments({ allowedTools: [], disallowedTools: [], maxTurns: 10 });

    // Precondition du binaire, pas un choix de confort : avec `-p`, Claude Code
    // 2.1.223 refuse `--output-format stream-json` sans `--verbose`
    // (« When using --print, --output-format=stream-json requires --verbose »).
    // Le premier run reel a echoue la-dessus.
    assert.ok(args.includes("-p"));
    assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
    assert.equal(args.filter((argument) => argument === "--verbose").length, 1);
  });

  it("transmet les autorisations et les refus", () => {
    const args = buildClaudeArguments({
      allowedTools: ["Read", "Bash(npm run test)"],
      disallowedTools: ["Bash(git push:*)"],
      maxTurns: 10,
    });

    assert.equal(args[args.indexOf("--allowedTools") + 1], "Read,Bash(npm run test)");
    assert.equal(args[args.indexOf("--disallowedTools") + 1], "Bash(git push:*)");
  });

  it("ne passe jamais --dangerously-skip-permissions", () => {
    const args = buildClaudeArguments({
      allowedTools: ["Read"],
      disallowedTools: ["Bash(rm:*)"],
      maxTurns: 10,
    });

    assert.equal(args.includes("--dangerously-skip-permissions"), false);
    assert.equal(args.join(" ").includes("dangerously"), false);
  });

  it("ne passe aucun drapeau hors perimetre de TASK-008", () => {
    const args = buildClaudeArguments({ allowedTools: [], disallowedTools: [], maxTurns: 10 });
    const joined = args.join(" ");

    for (const flag of ["--continue", "--resume", "--add-dir", "--mcp-config", "--model"]) {
      assert.equal(joined.includes(flag), false, flag);
    }
  });

  it("ne contient jamais de cle d'API", () => {
    const args = buildClaudeArguments({ allowedTools: [], disallowedTools: [], maxTurns: 10 });
    const joined = args.join(" ");

    assert.equal(joined.includes("ANTHROPIC_API_KEY"), false);
    assert.equal(joined.includes("sk-"), false);
    assert.equal(joined.includes("--api-key"), false);
  });

  it("omet les listes vides plutot que de passer un argument vide", () => {
    const args = buildClaudeArguments({ allowedTools: [], disallowedTools: [], maxTurns: 10 });

    assert.equal(args.includes("--allowedTools"), false);
    assert.equal(args.includes("--disallowedTools"), false);
  });
});

describe("launchClaude - lancement reel du faux Claude", () => {
  it("envoie le prompt par l'entree standard, jamais en argument", async () => {
    process.env["FAKE_CLAUDE_MODE"] = "success";
    const prompt = "Prompt multi-ligne\navec des caracteres speciaux : & | ; \" ' $ `\n";

    const handle = launchClaude({
      repositoryRoot: workspace,
      prompt,
      allowedTools: ["Read"],
      disallowedTools: ["Bash(rm:*)"],
      claude: claudeConfig(),
    });

    const outcome = await handle.completed;
    assert.equal(outcome.spawnError, null);
    assert.equal(outcome.exitCode, 0);

    const report = await readReport();
    assert.equal(report.prompt, prompt);
    // Le prompt n'apparait nulle part dans les arguments.
    assert.equal(report.argv.join(" ").includes("Prompt multi-ligne"), false);
  });

  it("passe reellement stream-json et --verbose au processus", async () => {
    process.env["FAKE_CLAUDE_MODE"] = "success";

    const handle = launchClaude({
      repositoryRoot: workspace,
      prompt: "x",
      allowedTools: [],
      disallowedTools: [],
      claude: claudeConfig(),
    });
    await handle.completed;

    // Verifie la chaine complete, pas seulement la fonction pure : c'est ici que
    // le premier run reel a echoue, faute de `--verbose`.
    const { argv } = await readReport();
    assert.ok(argv.includes("-p"));
    assert.equal(argv[argv.indexOf("--output-format") + 1], "stream-json");
    assert.equal(argv.filter((argument) => argument === "--verbose").length, 1);
    assert.equal(argv.includes("--include-partial-messages"), false);
    assert.equal(argv.includes("--dangerously-skip-permissions"), false);
  });

  it("fixe le repertoire de travail a la racine du repository", async () => {
    process.env["FAKE_CLAUDE_MODE"] = "success";

    const handle = launchClaude({
      repositoryRoot: workspace,
      prompt: "x",
      allowedTools: [],
      disallowedTools: [],
      claude: claudeConfig(),
    });
    await handle.completed;

    const report = await readReport();
    // La comparaison passe par `realpath` : les dossiers temporaires de macOS
    // sont des liens vers `/private/var`.
    assert.equal(path.resolve(report.cwd).toLowerCase(), path.resolve(workspace).toLowerCase());
  });

  it("ne transmet aucune variable NOX au processus enfant", async () => {
    process.env["FAKE_CLAUDE_MODE"] = "success";

    const handle = launchClaude({
      repositoryRoot: workspace,
      prompt: "x",
      allowedTools: [],
      disallowedTools: [],
      claude: claudeConfig(),
    });
    await handle.completed;

    const report = await readReport();
    const leaked = report.environmentNames.filter((name) => name.toUpperCase().startsWith("NOX_"));
    assert.deepEqual(leaked, [], `variables NOX transmises : ${leaked.join(", ")}`);
  });

  it("transmet bien les arguments calcules", async () => {
    process.env["FAKE_CLAUDE_MODE"] = "success";

    const handle = launchClaude({
      repositoryRoot: workspace,
      prompt: "x",
      allowedTools: ["Read", "Bash(npm run test)"],
      disallowedTools: ["Bash(git push:*)"],
      claude: claudeConfig({ maxTurns: 33 }),
    });
    await handle.completed;

    const report = await readReport();
    assert.equal(report.argv[report.argv.indexOf("--max-turns") + 1], "33");
    assert.equal(report.argv[report.argv.indexOf("--allowedTools") + 1], "Read,Bash(npm run test)");
    assert.equal(report.argv.includes("--dangerously-skip-permissions"), false);
  });

  it("remonte une sortie JSON valide", async () => {
    process.env["FAKE_CLAUDE_MODE"] = "success";

    const handle = launchClaude({
      repositoryRoot: workspace,
      prompt: "x",
      allowedTools: [],
      disallowedTools: [],
      claude: claudeConfig(),
    });

    const outcome = await handle.completed;
    assert.ok(outcome.stdout.includes("fake-session-0001"));
    assert.equal(outcome.timedOut, false);
  });

  it("remonte un code de sortie non nul et la sortie d'erreur", async () => {
    process.env["FAKE_CLAUDE_MODE"] = "exit-nonzero";

    const handle = launchClaude({
      repositoryRoot: workspace,
      prompt: "x",
      allowedTools: [],
      disallowedTools: [],
      claude: claudeConfig(),
    });

    const outcome = await handle.completed;
    assert.equal(outcome.exitCode, 3);
    assert.ok(outcome.stderrTail.includes("sortie non nulle simulee"));
  });

  it("arrete le processus au depassement du delai", async () => {
    process.env["FAKE_CLAUDE_MODE"] = "slow";
    process.env["FAKE_CLAUDE_SLEEP_MS"] = "60000";

    const handle = launchClaude({
      repositoryRoot: workspace,
      prompt: "x",
      allowedTools: [],
      disallowedTools: [],
      // Un delai volontairement minuscule : le faux Claude dort une minute.
      claude: claudeConfig({ timeoutMinutes: 1 / 120 }),
    });

    const outcome = await handle.completed;
    assert.equal(outcome.timedOut, true);

    delete process.env["FAKE_CLAUDE_SLEEP_MS"];
  });

  it("signale un executable introuvable sans lever", async () => {
    const handle = launchClaude({
      repositoryRoot: workspace,
      prompt: "x",
      allowedTools: [],
      disallowedTools: [],
      claude: claudeConfig({ executable: "claude-qui-n-existe-pas-du-tout" }),
    });

    const outcome = await handle.completed;
    assert.notEqual(outcome.spawnError, null);
    assert.equal(outcome.exitCode, null);
  });
});
