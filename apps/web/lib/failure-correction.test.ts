/**
 * Ce que la page de reprise decide reellement.
 *
 * ## La contradiction que ce fichier existe pour empecher
 *
 * Le troisieme pilote reel a lu, sur le meme ecran :
 *
 * ```text
 * « un Retry l'y a menee, mais aucune execution n'a demarre »   ← reconnu
 * « Task is in Failed — Blocked »                              ← refuse
 * « Git branch and HEAD unchanged — Blocked »                  ← jamais verifie
 * ```
 *
 * La cause n'etait pas une regle trop stricte : il y en avait **deux**. Le cycle
 * assemblait le candidat depuis la base — `isLatestRun` compris — et la page le
 * reassemblait a la main sans ce champ. Les deux repondaient donc l'inverse l'un
 * de l'autre sur le seul cas que HOTFIX-006 venait d'ouvrir.
 *
 * ## Ce qui est teste ici
 *
 * `evaluateFailureCorrection`, c'est-a-dire **la fonction que la route appelle**,
 * et non des aides isolees. Un test qui verifierait les gardes une par une
 * n'aurait rien vu du defaut : chacune, prise seule, etait correcte.
 *
 * Base temporaire, port de runner simule. Aucun reseau, aucun processus, aucun
 * repository reel.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CORRECTION_SOURCE,
  RUN_FAILURE_CATEGORY,
  TASK_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
  WORKSPACE_FINGERPRINT_VERSION,
} from "@nox/shared";
import {
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  failRun,
  getTaskById,
  markRunRunning,
  reserveCorrection,
  saveRunReview,
  startTaskCorrection,
  startTaskExecution,
  toDatabaseFilePath,
  toSqliteUrl,
  updateTaskStatus,
  type DatabaseClient,
} from "@nox/database";

import { NOT_EVALUATED_DETAIL, type Precondition } from "./correction-display.ts";
import {
  STRANDED_TASK_PRECONDITION_LABEL,
  evaluateFailureCorrection,
  type FailureCorrectionPorts,
} from "./failure-correction.ts";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "database",
  "prisma",
  "migrations",
);

let workspace: string;
let db: DatabaseClient;
let counter = 0;

const BRANCH = "main";
const HEAD = "3cf6b465654e".padEnd(40, "0");
const SESSION = "3f2a6b1c-4d5e-4f60-9a71-8b2c3d4e5f60";
const FINGERPRINT = "f".repeat(64);
const CHANGED_FILES = ["src/app.ts", "package.json", "tsconfig.json"];

async function applyMigrations(target: string): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const sqlite = new DatabaseSync(target);
  try {
    for (const directory of directories) {
      sqlite.exec(await readFile(path.join(MIGRATIONS_DIR, directory, "migration.sql"), "utf8"));
    }
  } finally {
    sqlite.close();
  }
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-failure-gate-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

type Scene = { projectId: string; repositoryPath: string; taskId: string; runId: string };

/** Un preflight qui accepte : le dossier de travail est encore le bon. */
function matchingRepository(): FailureCorrectionPorts {
  return {
    preflight: () =>
      Promise.resolve({
        ok: true,
        value: {
          ok: true,
          claude: { available: true, version: "2.1.223" },
          git: { branch: BRANCH, head: HEAD, upstream: "origin/main" },
        },
      }),
  };
}

/** Un preflight qui refuse, avec le code du runner. */
function refusingRepository(code: string): FailureCorrectionPorts {
  return {
    preflight: () =>
      Promise.resolve({ ok: false, failure: { kind: "runner_error", code } as never }),
  };
}

/** Le runner ne repond pas du tout. */
function unreachableRunner(): FailureCorrectionPorts {
  return {
    preflight: () => Promise.resolve({ ok: false, failure: { kind: "unreachable" } }),
  };
}

/** Une sonde qui compte ses appels, pour prouver qu'elle n'a pas eu lieu. */
function countingRepository(): FailureCorrectionPorts & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    preflight: (request) => {
      state.calls += 1;
      return matchingRepository().preflight(request);
    },
  } as FailureCorrectionPorts & { calls: number };
}

function row(preconditions: readonly Precondition[], fragment: string): Precondition {
  const found = preconditions.find((entry) => entry.label.includes(fragment));
  assert.ok(found !== undefined, `precondition « ${fragment} » absente`);
  return found;
}

/**
 * Le pilote reel, reproduit exactement.
 *
 * `TASK-000`, nature `BOOTSTRAP`, une seule execution, sortie en code 1 avec du
 * travail sur le disque, review et empreinte globale capturees, et
 * `workspaceEntries` a `NULL` — l'execution est anterieure au diagnostic par
 * chemin.
 */
async function pilotFailure(
  options: { entries?: string | null; sessionId?: string | null } = {},
): Promise<Scene> {
  counter += 1;
  const project = await createProject(db, {
    name: `TicketPulse ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });

  const task = await createTask(db, {
    projectId: project.id,
    title: "Amorcer le repository",
    objective: "Poser les fondations du projet.",
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: ["Le projet compile"],
    documentReferences: [],
    validationCommands: ["npm run test"],
  });
  assert.ok(task !== null);
  await db.task.update({ where: { id: task.id }, data: { kind: TASK_KIND.BOOTSTRAP } });

  const created = await createRun(db, {
    projectId: project.id,
    taskId: task.id,
    prompt: "Prompt d'amorcage.",
    promptSha256: "b".repeat(64),
    runnerRunId: `2222${String(counter).padStart(4, "0")}-3333-4444-8555-666666666666`,
  });
  assert.ok(created.ok);

  const ready = await updateTaskStatus(db, task.id, project.id, TASK_STATUS.READY);
  assert.ok(ready.ok);
  assert.equal(await startTaskExecution(db, task.id), true);
  await markRunRunning(db, created.run.id, new Date());

  await failRun(db, created.run.id, {
    finishedAt: new Date(),
    exitCode: 1,
    errorCode: "CLAUDE_PROCESS_FAILED",
    failureCategory: RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO,
    failureDetail: "Le processus s'est termine avec le code 1.",
    stderrTail: "Error: verification finale interrompue\n",
    claudeSessionId: options.sessionId === undefined ? SESSION : options.sessionId,
    numTurns: 81,
    git: {
      branch: BRANCH,
      upstream: "origin/main",
      headBefore: HEAD,
      headAfter: HEAD,
      diffStat: " 13 files changed, 4101 insertions(+)",
      changedFiles: [...CHANGED_FILES],
    },
  });

  await saveRunReview(db, created.run.id, {
    capturedAt: new Date().toISOString(),
    headBefore: HEAD,
    unreliable: false,
    files: CHANGED_FILES.map((file, position) => ({
      path: file,
      previousPath: null,
      changeType: "MODIFIED",
      position,
      additions: 10,
      deletions: 0,
      isBinary: false,
      isSensitive: false,
      isTruncated: false,
      patch: null,
    })),
    omittedFiles: 0,
    validations: [],
    workspace: {
      value: FINGERPRINT,
      version: WORKSPACE_FINGERPRINT_VERSION,
      errorCode: null,
      entries: options.entries ?? null,
    },
  });

  return {
    projectId: project.id,
    repositoryPath: project.repositoryPath,
    taskId: task.id,
    runId: created.run.id,
  };
}

/** Le geste `Retry` d'avant le correctif : le statut change, rien ne demarre. */
async function strandByLegacyRetry(scene: Scene): Promise<void> {
  await db.task.update({ where: { id: scene.taskId }, data: { status: TASK_STATUS.READY } });
}

async function evaluate(
  scene: Scene,
  ports: FailureCorrectionPorts = matchingRepository(),
): Promise<NonNullable<Awaited<ReturnType<typeof evaluateFailureCorrection>>>> {
  const task = await getTaskById(db, scene.taskId);
  assert.ok(task !== null);
  const result = await evaluateFailureCorrection(
    db,
    {
      project: { id: scene.projectId, repositoryPath: scene.repositoryPath },
      task: { id: task.id, status: task.status },
      runId: scene.runId,
    },
    ports,
  );
  assert.ok(result !== null);
  return result;
}

// ---------------------------------------------------------------------------
// A / H. Le cas exact du pilote
// ---------------------------------------------------------------------------

describe("le Retry avorte du pilote reel", () => {
  it("autorise la reprise, et active le bouton", async () => {
    // Le cas A. Avant le correctif, cette meme composition rendait `ready`
    // faux, avec quatre preconditions « Blocked ».
    const scene = await pilotFailure();
    await strandByLegacyRetry(scene);

    const result = await evaluate(scene);

    assert.equal(result.history.ok, true, "l'historique autorise");
    assert.equal(result.strandedRetry, true);
    assert.equal(result.ready, true, "le bouton peut partir");
  });

  it("n'affiche plus « Task is in Failed — Blocked »", async () => {
    // La contradiction litterale. La ligne porte desormais ce qui est vrai :
    // un `Retry` a laisse la tache prete sans jamais rien lancer.
    const scene = await pilotFailure();
    await strandByLegacyRetry(scene);

    const { preconditions } = await evaluate(scene);

    assert.equal(
      preconditions.some((entry) => entry.label === "Task is in Failed"),
      false,
    );
    const status = row(preconditions, STRANDED_TASK_PRECONDITION_LABEL);
    assert.equal(status.state, "met");
  });

  it("marque toutes les preconditions comme tenues", async () => {
    const scene = await pilotFailure();
    await strandByLegacyRetry(scene);

    const { preconditions } = await evaluate(scene);

    assert.deepEqual(
      preconditions.filter((entry) => entry.state !== "met").map((entry) => entry.label),
      [],
    );
  });

  it("autorise malgre l'absence d'empreintes par entree", async () => {
    // Le cas H. `workspaceEntries = NULL` retire le diagnostic par chemin, et
    // rien d'autre : l'empreinte globale decide comme partout ailleurs.
    const scene = await pilotFailure({ entries: null });
    await strandByLegacyRetry(scene);

    const result = await evaluate(scene);

    assert.equal(result.entriesUnavailable, true);
    assert.equal(result.ready, true);
  });

  it("interroge reellement le runner sur la branche, HEAD et l'empreinte", async () => {
    // Le cas 5 : une fois l'historique franchi, la sonde a bien lieu, avec les
    // valeurs enregistrees a l'echec.
    const scene = await pilotFailure();
    await strandByLegacyRetry(scene);

    let received: Record<string, unknown> | null = null;
    const ports: FailureCorrectionPorts = {
      preflight: (request) => {
        received = request as unknown as Record<string, unknown>;
        return matchingRepository().preflight(request);
      },
    };
    const result = await evaluate(scene, ports);

    assert.equal(result.probed, true);
    const sent = received as Record<string, unknown> | null;
    assert.ok(sent !== null);
    assert.equal(sent["expectedBranch"], BRANCH);
    assert.equal(sent["expectedGitHead"], HEAD);
    assert.equal(sent["expectedWorkspaceFingerprint"], FINGERPRINT);
    assert.equal(sent["expectedWorkspaceEntries"], null);
  });
});

// ---------------------------------------------------------------------------
// B. Le chemin d'ecriture accepte le meme cas
// ---------------------------------------------------------------------------

describe("le chemin de soumission accepte le meme cas", () => {
  it("reserve puis bascule la tache, sans edition manuelle", async () => {
    // Le cas B. Activer le bouton ne suffit pas : la transaction qui ecrit
    // rejoue la preuve, et doit accepter exactement ce que l'ecran a annonce.
    const scene = await pilotFailure();
    await strandByLegacyRetry(scene);
    assert.equal((await evaluate(scene)).ready, true);

    const reserved = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.ok(reserved.ok);

    assert.equal(await startTaskCorrection(db, scene.taskId, scene.runId), true);
    assert.equal((await getTaskById(db, scene.taskId))?.status, TASK_STATUS.RUNNING);
  });

  it("refuse la bascule sans l'execution source", async () => {
    // Le `READY` n'est jamais accepte sur son seul statut : la preuve est
    // l'execution, et sans elle la transaction refuse.
    const scene = await pilotFailure();
    await strandByLegacyRetry(scene);

    assert.equal(await startTaskCorrection(db, scene.taskId), false);
    assert.equal((await getTaskById(db, scene.taskId))?.status, TASK_STATUS.READY);
  });
});

// ---------------------------------------------------------------------------
// C / D / E. Ce qui reste refuse
// ---------------------------------------------------------------------------

describe("les READY ordinaires restent refuses", () => {
  it("refuse une tache prete qui n'a jamais echoue", async () => {
    // Le cas C. Une tache prete attend une execution **neuve** ; y reprendre
    // une ancienne session serait faux.
    counter += 1;
    const project = await createProject(db, {
      name: `Projet neuf ${String(counter)}`,
      description: null,
      repositoryPath: path.join(workspace, `neuf-${String(counter)}`),
    });
    const task = await createTask(db, {
      projectId: project.id,
      title: "Une tache jamais lancee",
      objective: "Faire quelque chose.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: ["Cela fonctionne"],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(task !== null);
    const created = await createRun(db, {
      projectId: project.id,
      taskId: task.id,
      prompt: "Prompt.",
      promptSha256: "c".repeat(64),
      runnerRunId: `3333${String(counter).padStart(4, "0")}-4444-4555-8666-777777777777`,
    });
    assert.ok(created.ok);
    await updateTaskStatus(db, task.id, project.id, TASK_STATUS.READY);

    const result = await evaluateFailureCorrection(
      db,
      {
        project: { id: project.id, repositoryPath: project.repositoryPath },
        task: { id: task.id, status: TASK_STATUS.READY },
        runId: created.run.id,
      },
      matchingRepository(),
    );

    assert.ok(result !== null);
    assert.equal(result.history.ok, false);
    assert.equal(result.strandedRetry, false);
    assert.equal(result.ready, false);
  });

  it("refuse des qu'une execution plus recente existe", async () => {
    // Le cas D : un `Retry` qui a **reellement** demarre.
    const scene = await pilotFailure();
    await strandByLegacyRetry(scene);
    const later = await createRun(db, {
      projectId: scene.projectId,
      taskId: scene.taskId,
      prompt: "Le vrai second essai.",
      promptSha256: "d".repeat(64),
      runnerRunId: "44440000-5555-4666-8777-888888888888",
    });
    assert.ok(later.ok);

    const result = await evaluate(scene);

    assert.equal(result.history.ok, false);
    assert.equal(result.ready, false);
  });

  it("refuse quand une correction est deja nee de cet echec", async () => {
    // Le cas E. La tache est alors passee par une reprise, et son `READY` ne
    // vient plus d'un `Retry` avorte.
    const scene = await pilotFailure();
    await strandByLegacyRetry(scene);

    const reserved = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.ok(reserved.ok);

    const result = await evaluate(scene);
    assert.equal(result.history.ok, false);
    assert.equal(result.ready, false);
  });
});

// ---------------------------------------------------------------------------
// F / G / I. Le disque et le runner, distingues du statut
// ---------------------------------------------------------------------------

describe("un refus du repository ne se deguise pas en refus de statut", () => {
  it("distingue la branche du statut de la tache", async () => {
    // Le cas F : l'historique passe, la branche non. Les deux lignes doivent
    // raconter des choses differentes.
    const scene = await pilotFailure();
    await strandByLegacyRetry(scene);

    const { history, preconditions, ready } = await evaluate(
      scene,
      refusingRepository("GIT_BRANCH_CHANGED"),
    );

    assert.equal(history.ok, true, "l'historique, lui, autorise");
    assert.equal(row(preconditions, STRANDED_TASK_PRECONDITION_LABEL).state, "met");
    assert.equal(row(preconditions, "Git branch and HEAD").state, "unmet");
    assert.equal(ready, false);
  });

  it("nomme une divergence du dossier de travail", async () => {
    // Le cas G. L'empreinte globale refuse, et c'est bien elle qu'on lit.
    const scene = await pilotFailure();
    await strandByLegacyRetry(scene);

    const { history, preconditions, ready } = await evaluate(
      scene,
      refusingRepository("REVIEW_WORKTREE_CHANGED"),
    );

    assert.equal(history.ok, true);
    const workspace = row(preconditions, "Repository matches");
    assert.equal(workspace.state, "unmet");
    assert.ok(workspace.detail !== null, "le refus du runner est affiche");
    assert.equal(ready, false);
  });

  it("montre un runner injoignable comme tel", async () => {
    // Le cas I. Ce n'est ni le statut, ni le dossier de travail : c'est la
    // machine qui ne repond pas, et l'ecran ne doit pas accuser autre chose.
    const scene = await pilotFailure();
    await strandByLegacyRetry(scene);

    const { history, preconditions, ready } = await evaluate(scene, unreachableRunner());

    assert.equal(history.ok, true);
    assert.equal(row(preconditions, STRANDED_TASK_PRECONDITION_LABEL).state, "met");
    assert.equal(row(preconditions, "Claude Code available").state, "unmet");
    assert.equal(ready, false);
  });

  it("dit « non verifie » plutot que « bloque » quand la sonde n'a pas eu lieu", async () => {
    // Le defaut le plus trompeur du pilote : trois lignes « Blocked » sur un
    // repository que NOX n'avait jamais regarde.
    const scene = await pilotFailure();
    // Tache laissee en `FAILED`… puis remise en `DRAFT` : l'historique refuse,
    // et la sonde n'a plus lieu d'etre.
    await db.task.update({ where: { id: scene.taskId }, data: { status: TASK_STATUS.DRAFT } });

    const ports = countingRepository();
    const { preconditions, probed, ready } = await evaluate(scene, ports);

    assert.equal(ports.calls, 0, "le runner n'est pas derange pour rien");
    assert.equal(probed, false);
    for (const label of ["Git branch and HEAD", "Repository matches", "Claude Code available"]) {
      const entry = row(preconditions, label);
      assert.equal(entry.state, "unknown", label);
      assert.equal(entry.detail, NOT_EVALUATED_DETAIL, label);
    }
    assert.equal(ready, false);
  });
});

// ---------------------------------------------------------------------------
// J / K. Les chemins existants ne bougent pas
// ---------------------------------------------------------------------------

describe("les cas existants restent inchanges", () => {
  it("accepte une tache restee en echec, sans Retry", async () => {
    // Le cas J : le chemin normal de HOTFIX-006, celui d'une tache que
    // personne n'a touchee apres l'echec.
    const scene = await pilotFailure();

    const result = await evaluate(scene);

    assert.equal(result.history.ok, true);
    assert.equal(result.strandedRetry, false, "aucun Retry n'a eu lieu");
    assert.equal(result.ready, true);
    assert.equal(row(result.preconditions, "Task is in Failed").state, "met");
  });

  it("refuse une reprise apres echec sur une tache en review", async () => {
    // Le cas K. `REVIEW` appartient au chemin humain — `Request changes` —, et
    // cette porte-ci ne s'y substitue pas.
    const scene = await pilotFailure();
    await db.task.update({ where: { id: scene.taskId }, data: { status: TASK_STATUS.REVIEW } });

    const result = await evaluate(scene);

    // L'execution a echoue : elle ne remplit pas les conditions d'une reprise
    // apres echec sur une tache en review.
    assert.equal(result.history.ok, false);
    assert.equal(result.strandedRetry, false);
  });

  it("refuse quand aucune session Claude n'a ete rapportee", async () => {
    // Sans session, il n'y a rien a reprendre — et le refus ne parle ni de
    // statut, ni de repository.
    const scene = await pilotFailure({ sessionId: null });
    await strandByLegacyRetry(scene);

    const { history, preconditions, probed } = await evaluate(scene);

    assert.equal(history.ok, false);
    assert.equal(row(preconditions, "Claude session available").state, "unmet");
    assert.equal(probed, false, "inutile de sonder le disque");
  });
});
