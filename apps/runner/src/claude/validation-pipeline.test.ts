/**
 * Equivalence du suivi des validations entre un run initial et une correction.
 *
 * ## Pourquoi cette suite existe
 *
 * Le premier run reel de TASK-012 a montre une validation reellement executee
 * affichee « Not run ». Le soupcon portait sur le chemin `CORRECTION` : les
 * commandes de la tache auraient ete recopiees en base sans etre transmises au
 * runner, laissant le tracker sans rien a reconnaitre.
 *
 * La base de developpement a dit autre chose — le run **initial** du meme jour
 * portait le meme defaut. La cause etait la forme de la ligne Bash, pas la
 * nature du run. Cette suite fige les deux conclusions a la fois :
 *
 * 1. **Les deux chemins produisent exactement le meme resultat.** Meme
 *    commande, meme flux, meme verdict, meme timeline. Un futur refactor qui
 *    oublierait de transmettre les commandes d'une correction ferait echouer la
 *    moitie `CORRECTION` sans toucher a la moitie `INITIAL`.
 * 2. **Le pipeline est traverse en entier.** Commandes demandees → politique
 *    d'outils → registre → tracker → instantane : la meme commande, exactement
 *    une fois, a chaque etape.
 *
 * Aucun processus n'est lance : le lanceur est injecte et rend le flux
 * lui-meme. Le repository, lui, est reel — le preflight de correction compare
 * une empreinte, et une empreinte simulee ne prouverait rien.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { RUN_VALIDATION_STATUS, TASK_KIND, type RunValidationResultView } from "@nox/shared";

import type { ClaudeConfig } from "../config.ts";
import {
  computeWorkspaceFingerprint,
  deriveFingerprintKey,
} from "../repositories/workspace-fingerprint.ts";
import type { ClaudeVersionResult } from "./executable.ts";
import type { ClaudeLauncher, LaunchRequest } from "./launcher.ts";
import { ClaudeRunRegistry } from "./registry.ts";
import { startClaudeRun } from "./runs.ts";

const RUN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3311";
const SESSION = "62b9a0f0-1d01-4a0c-8201-60f9bae0d34e";
const VALIDATION = "git diff --check";
const KEY = deriveFingerprintKey("jeton-de-test-pipeline-validations");

const CLAUDE: ClaudeConfig = { executable: "claude-de-test", maxTurns: 10, timeoutMinutes: 5 };

const version = (): Promise<ClaudeVersionResult> =>
  Promise.resolve({ available: true, version: "2.1.223", resolvedPath: "/faux/claude" });

const RESULT_LINE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "Travail simule.",
  session_id: SESSION,
  duration_ms: 1200,
  duration_api_ms: 800,
  num_turns: 3,
  total_cost_usd: 0.01,
});

let workspace: string;
let remote: string;
let repository: string;

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" });
}

function toolUse(id: string, command: string): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
    },
  });
}

function toolResult(id: string, isError: boolean): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: id, content: "Sortie simulee.", is_error: isError },
      ],
    },
  });
}

/**
 * Lanceur simule qui **emet reellement le flux**.
 *
 * C'est la difference avec le lanceur de `runs.test.ts` : ici, le collecteur
 * doit lire, normaliser et correler, sinon la suite ne testerait rien.
 */
function streamingLauncher(
  lines: readonly string[],
  onLaunch?: (request: LaunchRequest) => void,
): ClaudeLauncher {
  return (request) => {
    onLaunch?.(request);
    for (const line of lines) {
      request.onChunk?.(`${line}\n`);
    }
    request.onChunk?.(RESULT_LINE);
    return {
      completed: Promise.resolve({
        exitCode: 0,
        stdout: RESULT_LINE,
        stderrTail: "",
        timedOut: false,
        spawnError: null,
      }),
      kill: () => undefined,
    };
  };
}

async function waitForFinal(registry: ClaudeRunRegistry): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const snapshot = registry.snapshot(RUN_ID);
    if (snapshot !== null && !["QUEUED", "RUNNING", "CANCELLING"].includes(snapshot.status)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("l'execution n'a pas atteint d'etat final");
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-pipeline-"));
  remote = path.join(workspace, "remote.git");
  repository = path.join(workspace, "depot");
});

after(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

beforeEach(async () => {
  await rm(remote, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  await rm(repository, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

  execFileSync("git", ["init", "--bare", "-b", "main", remote], { stdio: "ignore" });
  execFileSync("git", ["clone", remote, repository], { stdio: "ignore" });
  git(repository, "config", "user.email", "test@nox.invalid");
  git(repository, "config", "user.name", "NOX Test");
  git(repository, "config", "core.autocrlf", "false");

  await writeFile(path.join(repository, "README.md"), "# Depot\n", "utf8");
  git(repository, "add", "-A");
  git(repository, "commit", "-m", "init");
  git(repository, "push", "-u", "origin", "main");
});

/** Etat de reference d'une correction, tel que la review l'aurait enregistre. */
async function reviewedState(): Promise<{
  sessionId: string;
  expectedBranch: string;
  expectedWorkspaceFingerprint: string;
}> {
  const result = await computeWorkspaceFingerprint(repository, KEY);
  assert.ok(result.ok, "l'empreinte de reference doit pouvoir etre calculee");
  return {
    sessionId: SESSION,
    expectedBranch: result.branch,
    expectedWorkspaceFingerprint: result.value,
  };
}

type RunOutcome = {
  validations: readonly RunValidationResultView[];
  labels: readonly string[];
  launch: LaunchRequest;
};

/**
 * Lance une execution — initiale ou correction — et rend ce qu'elle a produit.
 *
 * Le meme corps pour les deux : c'est precisement ce que la suite veut
 * demontrer. Seul `correction` change.
 */
async function launch(
  kind: "INITIAL" | "CORRECTION",
  lines: readonly string[],
  commands: readonly string[] = [VALIDATION],
): Promise<RunOutcome> {
  // Un dossier de travail sale : normal pour une correction, tolere ici pour
  // l'initial puisque `expectedGitHead` est relu juste avant.
  if (kind === "CORRECTION") {
    await writeFile(path.join(repository, "README.md"), "# Depot\n\nTravail relu.\n", "utf8");
  }

  const correction = kind === "CORRECTION" ? await reviewedState() : undefined;
  const registry = new ClaudeRunRegistry();

  let received: LaunchRequest | null = null;
  const result = await startClaudeRun(
    {
      runId: RUN_ID,
      repositoryPath: repository,
      prompt: "Prompt d'execution.",
      expectedGitHead: git(repository, "rev-parse", "HEAD").trim(),
      validationCommands: commands,
      taskKind: TASK_KIND.NORMAL,
      ...(correction === undefined ? {} : { correction }),
    },
    CLAUDE,
    registry,
    {
      probeVersion: version,
      fingerprintKey: KEY,
      launch: streamingLauncher(lines, (request) => {
        received = request;
      }),
    },
  );

  assert.ok(result.ok, `le lancement ${kind} a echoue`);
  await waitForFinal(registry);

  assert.ok(received !== null, "le lanceur n'a pas ete appele");
  return {
    validations: registry.validations(RUN_ID),
    labels: (registry.getEvents(RUN_ID, 0, 500)?.events ?? []).map((event) => event.label),
    launch: received,
  };
}

/** La ligne reellement observee : la validation noyee dans un enchainement. */
function realLines(): string[] {
  const cd = `cd "${repository.replaceAll("\\", "/")}"`;
  return [
    JSON.stringify({ type: "system", subtype: "init", session_id: SESSION }),
    toolUse(
      "b-1",
      `${cd} && ${VALIDATION} && echo "OK" && git status --short && git diff --stat`,
    ),
    toolResult("b-1", false),
  ];
}

describe("validations — equivalence INITIAL / CORRECTION", () => {
  it("conclut la validation d'un run initial", async () => {
    const outcome = await launch("INITIAL", realLines());

    assert.equal(outcome.validations.length, 1);
    assert.equal(outcome.validations[0]?.command, VALIDATION);
    assert.equal(outcome.validations[0]?.status, RUN_VALIDATION_STATUS.PASSED);
    assert.ok(outcome.labels.includes(`Running ${VALIDATION} && ... && git status --short && git diff --stat`));
    assert.ok(outcome.labels.includes("Validation succeeded"));
  });

  it("conclut la validation d'un run de correction, a l'identique", async () => {
    const outcome = await launch("CORRECTION", realLines());

    assert.equal(outcome.validations.length, 1);
    assert.equal(outcome.validations[0]?.command, VALIDATION);
    assert.equal(outcome.validations[0]?.status, RUN_VALIDATION_STATUS.PASSED);
    assert.ok(outcome.labels.includes(`Running ${VALIDATION} && ... && git status --short && git diff --stat`));
    assert.ok(outcome.labels.includes("Validation succeeded"));
  });

  it("produit exactement le meme instantane de validations dans les deux cas", async () => {
    const initial = await launch("INITIAL", realLines());
    const correction = await launch("CORRECTION", realLines());

    // Les horodatages different, forcement ; tout le reste doit coincider.
    const shape = (views: readonly RunValidationResultView[]) =>
      views.map(({ position, command, status, exitCode, summary }) => ({
        position,
        command,
        status,
        exitCode,
        summary,
      }));

    assert.deepEqual(shape(correction.validations), shape(initial.validations));
  });

  it("reprend la session pour une correction, et pour elle seule", async () => {
    const initial = await launch("INITIAL", realLines());
    assert.equal(initial.launch.resumeSessionId, null);

    const correction = await launch("CORRECTION", realLines());
    assert.equal(correction.launch.resumeSessionId, SESSION);
  });

  it("calcule les memes regles d'outils pour les deux", async () => {
    const initial = await launch("INITIAL", realLines());
    const correction = await launch("CORRECTION", realLines());

    assert.deepEqual(correction.launch.allowedTools, initial.launch.allowedTools);
    assert.deepEqual(correction.launch.disallowedTools, initial.launch.disallowedTools);
    assert.ok(initial.launch.allowedTools.includes(`Bash(${VALIDATION})`));
  });
});

describe("validations — propagation de bout en bout", () => {
  it("porte la meme commande a chaque etape du pipeline d'une correction", async () => {
    const commands = [VALIDATION];
    const outcome = await launch("CORRECTION", realLines(), commands);

    // 1. Les commandes demandees au lancement.
    assert.deepEqual(commands, [VALIDATION]);

    // 2. La politique d'outils qui en derive, transmise au processus.
    const rules = outcome.launch.allowedTools.filter((rule) => rule === `Bash(${VALIDATION})`);
    assert.equal(rules.length, 1, "la regle d'outil apparait exactement une fois");

    // 3. Le registre du runner, ou le tracker les a recopiees.
    const seeded = outcome.validations.filter((entry) => entry.command === VALIDATION);
    assert.equal(seeded.length, 1, "la table des validations la porte exactement une fois");

    // 4. Le verdict, qui ne peut venir que du tracker.
    assert.equal(seeded[0]?.status, RUN_VALIDATION_STATUS.PASSED);
  });

  it("laisse une correction sans commande enregistree sans aucune validation", async () => {
    const outcome = await launch("CORRECTION", realLines(), []);

    assert.deepEqual(outcome.validations, []);
    // La ligne reste lisible pour ses commandes Git, sans porter de verdict.
    assert.ok(outcome.labels.some((label) => label.startsWith("Running git diff --check")));
    assert.equal(outcome.labels.includes("Validation succeeded"), false);
  });
});

describe("validations — ce qui ne doit pas devenir une validation", () => {
  it("n'enregistre rien pour des commandes Git non enregistrees", async () => {
    const cd = `cd "${repository.replaceAll("\\", "/")}"`;
    const outcome = await launch("CORRECTION", [
      JSON.stringify({ type: "system", subtype: "init", session_id: SESSION }),
      toolUse("g-1", `${cd} && git status --short`),
      toolResult("g-1", false),
      toolUse("g-2", `${cd} && git diff --stat`),
      toolResult("g-2", false),
    ]);

    // Affichees, parce que Git en lecture seule — mais la validation attendue
    // n'a jamais tourne, et le dire est le coeur du sujet.
    assert.ok(outcome.labels.includes("Running git status --short"));
    assert.ok(outcome.labels.includes("Running git diff --stat"));
    assert.equal(outcome.labels.includes("Validation succeeded"), false);
    assert.equal(outcome.validations[0]?.status, RUN_VALIDATION_STATUS.NOT_RUN);
  });

  it("laisse une commande jamais lancee a NOT_RUN quand une autre reussit", async () => {
    const cd = `cd "${repository.replaceAll("\\", "/")}"`;
    const outcome = await launch(
      "CORRECTION",
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: SESSION }),
        toolUse("m-1", `${cd} && ${VALIDATION}`),
        toolResult("m-1", false),
      ],
      [VALIDATION, "npm run lint"],
    );

    assert.equal(outcome.validations.length, 2);
    assert.equal(outcome.validations[0]?.status, RUN_VALIDATION_STATUS.PASSED);
    assert.equal(outcome.validations[1]?.command, "npm run lint");
    assert.equal(outcome.validations[1]?.status, RUN_VALIDATION_STATUS.NOT_RUN);
  });

  it("laisse l'issue inconnue quand l'enchainement echoue", async () => {
    const cd = `cd "${repository.replaceAll("\\", "/")}"`;
    const outcome = await launch("CORRECTION", [
      JSON.stringify({ type: "system", subtype: "init", session_id: SESSION }),
      toolUse("f-1", `${cd} && ${VALIDATION} && echo "OK"`),
      toolResult("f-1", true),
    ]);

    // Le resultat unique ne dit pas quel maillon a cede.
    assert.equal(outcome.validations[0]?.status, RUN_VALIDATION_STATUS.UNKNOWN);
    assert.ok(outcome.labels.includes("Validation result unclear"));
  });

  it("laisse une validation interrompue par une annulation a UNKNOWN", async () => {
    // Le cas de l'annulation : la validation a demarre, son resultat n'arrivera
    // jamais. Ni `PASSED` — rien ne le prouve —, ni `NOT_RUN` — elle a bel et
    // bien tourne.
    await writeFile(path.join(repository, "README.md"), "# Depot\n\nTravail relu.\n", "utf8");
    const correction = await reviewedState();
    const registry = new ClaudeRunRegistry();
    const cd = `cd "${repository.replaceAll("\\", "/")}"`;

    const result = await startClaudeRun(
      {
        runId: RUN_ID,
        repositoryPath: repository,
        prompt: "Prompt d'execution.",
        expectedGitHead: git(repository, "rev-parse", "HEAD").trim(),
        validationCommands: [VALIDATION],
        taskKind: TASK_KIND.NORMAL,
        correction,
      },
      CLAUDE,
      registry,
      {
        probeVersion: version,
        fingerprintKey: KEY,
        launch: (request) => {
          request.onChunk?.(
            `${JSON.stringify({ type: "system", subtype: "init", session_id: SESSION })}\n`,
          );
          // Le `tool_use` part, le `tool_result` ne viendra pas : le processus
          // est tue entre les deux.
          request.onChunk?.(`${toolUse("c-1", `${cd} && ${VALIDATION}`)}\n`);
          return {
            completed: new Promise((resolve) => {
              setTimeout(() => {
                resolve({
                  exitCode: 1,
                  stdout: "",
                  stderrTail: "",
                  timedOut: false,
                  spawnError: null,
                });
              }, 60);
            }),
            kill: () => undefined,
          };
        },
      },
    );

    assert.ok(result.ok);
    registry.requestCancellation(RUN_ID);
    await waitForFinal(registry);

    assert.equal(registry.snapshot(RUN_ID)?.status, "CANCELLED");
    assert.equal(registry.validations(RUN_ID)[0]?.status, RUN_VALIDATION_STATUS.UNKNOWN);
  });

  it("impute l'echec quand la validation etait seule sur la ligne", async () => {
    const cd = `cd "${repository.replaceAll("\\", "/")}"`;
    const outcome = await launch("CORRECTION", [
      JSON.stringify({ type: "system", subtype: "init", session_id: SESSION }),
      toolUse("s-1", `${cd} && ${VALIDATION}`),
      toolResult("s-1", true),
    ]);

    assert.equal(outcome.validations[0]?.status, RUN_VALIDATION_STATUS.FAILED);
    assert.ok(outcome.labels.includes("Validation failed"));
  });
});
