/**
 * `Retry` ne doit jamais laisser une tache nulle part.
 *
 * ## Ce que ce fichier rejoue
 *
 * La suite exacte du second pilote reel, apres l'echec de `TASK-000` :
 *
 * ```text
 * 1. RUN-001 echoue, 24 fichiers non commites restent sur le disque
 * 2. l'utilisateur clique Retry — le seul geste offert a l'epoque
 * 3. la tache passe FAILED → READY          ← une ecriture, sans precondition
 * 4. le lancement est refuse : repository sale
 * 5. plus rien : tache READY, aucune execution, echec devenu inatteignable
 * ```
 *
 * L'etape 3 est le defaut. `Retry` ne lance rien — le lancement est une seconde
 * action, sur une autre page — et rien ne verifiait qu'un lancement etait
 * seulement possible. La transition partait donc en aveugle.
 *
 * ## Les deux moities du correctif
 *
 * ```text
 * empecher   →  un Retry qui ne pourrait pas demarrer ne change plus le statut
 * reparer    →  une tache deja echouee dans cet etat reste reprenable
 * ```
 *
 * ## Aucun fournisseur, aucun processus
 *
 * Base temporaire, ports de runner simules. Aucun appel reseau, aucun quota
 * consomme, aucun binaire lance, aucun repository reel touche.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CORRECTION_REFUSAL,
  CORRECTION_SOURCE,
  RUN_FAILURE_CATEGORY,
  RUN_KIND,
  RUN_STATUS,
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
  getRunById,
  getTaskById,
  listRunsByTask,
  markRunRunning,
  reserveCorrection,
  saveRunReview,
  startTaskExecution,
  toDatabaseFilePath,
  toSqliteUrl,
  updateTaskStatus,
  type DatabaseClient,
} from "@nox/database";

import { loadCorrectionContext } from "./correction-cycle.ts";
import { launchCorrection, type CorrectionLaunchPorts } from "./correction-launch.ts";
import {
  applyTaskTransition,
  RETRY_PRESERVED_SUFFIX,
  type TaskTransitionPorts,
} from "./task-lifecycle.ts";

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
const HEAD = "a".repeat(40);
const SESSION = "3f2a6b1c-4d5e-4f60-9a71-8b2c3d4e5f60";
const FINGERPRINT = "f".repeat(64);
const CHANGED_FILES = ["src/app.ts", "src/lib/import.ts"];

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
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-retry-recovery-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

type Scene = { projectId: string; taskId: string; runId: string };

/** Un preflight qui accepte : le repository est propre et synchronise. */
function cleanRepository(): TaskTransitionPorts {
  return {
    preflight: () =>
      Promise.resolve({
        ok: true,
        value: {
          ok: true,
          claude: { available: true, version: "2.1.223" },
          git: {
            clean: true,
            branch: BRANCH,
            upstream: "origin/main",
            head: HEAD,
            ahead: 0,
            behind: 0,
          },
        },
      }),
  };
}

/** Un preflight qui refuse, avec le code du runner. */
function refusingRepository(code: string): TaskTransitionPorts {
  return {
    preflight: () =>
      Promise.resolve({
        ok: false,
        failure: { kind: "runner_error", code } as never,
      }),
  };
}

/**
 * Une tache dont l'unique execution a echoue en laissant du travail.
 *
 * Le cycle est joue en entier — `READY`, puis `RUNNING`, puis `FAILED` — plutot
 * qu'ecrit directement : contourner `canAutomateTaskStatusTransition` reviendrait
 * a tester autre chose que ce que NOX fait.
 */
async function failedRun(options: { entries?: string | null } = {}): Promise<Scene> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
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

  const created = await createRun(db, {
    projectId: project.id,
    taskId: task.id,
    prompt: "Prompt initial.",
    promptSha256: "b".repeat(64),
    runnerRunId: `1111${String(counter).padStart(4, "0")}-2222-4333-8444-555555555555`,
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
    claudeSessionId: SESSION,
    git: {
      branch: BRANCH,
      upstream: "origin/main",
      headBefore: HEAD,
      headAfter: HEAD,
      diffStat: " 2 files changed, 4101 insertions(+)",
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
      // `null` par defaut : c'est l'etat exact d'une execution anterieure a
      // HOTFIX-006, celle du pilote reel.
      entries: options.entries ?? null,
    },
  });

  return { projectId: project.id, taskId: task.id, runId: created.run.id };
}

/** Ports de correction qui acceptent tout, en comptant les appels. */
function acceptingPorts(): CorrectionLaunchPorts & {
  preflightCalls: unknown[];
  startCalls: unknown[];
} {
  const preflightCalls: unknown[] = [];
  const startCalls: unknown[] = [];
  return {
    preflightCalls,
    startCalls,
    preflight: (request) => {
      preflightCalls.push(request);
      return Promise.resolve({
        ok: true,
        value: {
          ok: true,
          claude: { available: true, version: "2.1.223" },
          git: { branch: BRANCH, head: HEAD, upstream: "origin/main" },
        },
      });
    },
    start: (request) => {
      startCalls.push(request);
      return Promise.resolve({ ok: true, value: { startedAt: new Date().toISOString() } });
    },
  };
}

/** Ports de correction dont le runner refuse : l'etat du disque a change. */
function divergedPorts(code: string): CorrectionLaunchPorts {
  return {
    preflight: () =>
      Promise.resolve({ ok: false, failure: { kind: "runner_error", code } as never }),
    start: () => {
      throw new Error("le lancement ne doit jamais etre atteint");
    },
  };
}

async function runCount(taskId: string): Promise<number> {
  return (await listRunsByTask(db, taskId)).length;
}

// ---------------------------------------------------------------------------
// A / B. Un Retry qui ne peut pas partir ne touche a rien
// ---------------------------------------------------------------------------

describe("un Retry refuse laisse la tache en echec", () => {
  it("refuse sur un repository sale, sans rien ecrire", async () => {
    // Le cas A, et la scene exacte du pilote reel : le travail partiel est la,
    // donc le lancement sera refuse. Avant le correctif, la tache passait
    // quand meme en `READY`.
    const scene = await failedRun();
    const before = await runCount(scene.taskId);

    const outcome = await applyTaskTransition(
      db,
      { projectId: scene.projectId, taskId: scene.taskId, status: TASK_STATUS.READY },
      refusingRepository("REPOSITORY_DIRTY"),
    );

    assert.equal(outcome.ok, false);
    const task = await getTaskById(db, scene.taskId);
    assert.equal(task?.status, TASK_STATUS.FAILED, "la tache ne quitte pas l'echec");
    assert.equal(await runCount(scene.taskId), before, "aucune execution creee");
  });

  it("dit que rien n'a demarre et que l'echec est preserve", async () => {
    // La moitie la plus utile du message : l'utilisateur veut savoir ce qu'il
    // vient de casser. La reponse est « rien », et il faut l'ecrire.
    const scene = await failedRun();

    const outcome = await applyTaskTransition(
      db,
      { projectId: scene.projectId, taskId: scene.taskId, status: TASK_STATUS.READY },
      refusingRepository("REPOSITORY_DIRTY"),
    );

    assert.equal(outcome.ok, false);
    const message = outcome.ok ? "" : outcome.message;
    assert.ok(message.includes(RETRY_PRESERVED_SUFFIX));
    assert.match(message, /Aucune execution n'a demarre/u);
  });

  it("refuse aussi sur une branche ou un HEAD inattendus", async () => {
    // Le cas B. Le code du runner change, la garantie ne change pas.
    for (const code of ["GIT_BRANCH_CHANGED", "GIT_HEAD_CHANGED", "GIT_NOT_SYNCHRONIZED"]) {
      const scene = await failedRun();

      const outcome = await applyTaskTransition(
        db,
        { projectId: scene.projectId, taskId: scene.taskId, status: TASK_STATUS.READY },
        refusingRepository(code),
      );

      assert.equal(outcome.ok, false, code);
      assert.equal((await getTaskById(db, scene.taskId))?.status, TASK_STATUS.FAILED, code);
    }
  });

  it("refuse quand le runner est injoignable, plutot que de parier", async () => {
    // NOX ne peut pas prouver qu'un lancement partirait. Rester en echec garde
    // les deux gestes ouverts ; en sortir les perdrait tous les deux.
    const scene = await failedRun();

    const outcome = await applyTaskTransition(
      db,
      { projectId: scene.projectId, taskId: scene.taskId, status: TASK_STATUS.READY },
      { preflight: () => Promise.resolve({ ok: false, failure: { kind: "unreachable" } }) },
    );

    assert.equal(outcome.ok, false);
    assert.equal((await getTaskById(db, scene.taskId))?.status, TASK_STATUS.FAILED);
  });

  it("refuse pendant qu'une execution occupe le repository", async () => {
    const scene = await failedRun();
    const other = await createRun(db, {
      projectId: scene.projectId,
      taskId: scene.taskId,
      prompt: "Une autre execution.",
      promptSha256: "c".repeat(64),
      runnerRunId: "99999999-8888-4777-8666-555555555555",
    });
    assert.ok(other.ok);

    const outcome = await applyTaskTransition(
      db,
      { projectId: scene.projectId, taskId: scene.taskId, status: TASK_STATUS.READY },
      cleanRepository(),
    );

    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? "" : outcome.message, /travaille deja sur ce repository/u);
    assert.equal((await getTaskById(db, scene.taskId))?.status, TASK_STATUS.FAILED);
  });

  it("laisse la reprise ciblee disponible apres un Retry refuse", async () => {
    // La consequence qui compte : refuser le `Retry` **preserve** l'autre geste.
    const scene = await failedRun();

    await applyTaskTransition(
      db,
      { projectId: scene.projectId, taskId: scene.taskId, status: TASK_STATUS.READY },
      refusingRepository("REPOSITORY_DIRTY"),
    );

    const cycle = await loadCorrectionContext(db, { runId: scene.runId, taskId: scene.taskId });
    assert.equal(cycle?.processFailure.eligible, true);
  });
});

// ---------------------------------------------------------------------------
// C. Un Retry possible garde exactement son sens
// ---------------------------------------------------------------------------

describe("un Retry possible se comporte comme avant", () => {
  it("fait passer la tache en READY sur un repository propre", async () => {
    const scene = await failedRun();

    const outcome = await applyTaskTransition(
      db,
      { projectId: scene.projectId, taskId: scene.taskId, status: TASK_STATUS.READY },
      cleanRepository(),
    );

    assert.equal(outcome.ok, true);
    assert.equal((await getTaskById(db, scene.taskId))?.status, TASK_STATUS.READY);
  });

  it("ne sonde le runner pour aucune autre transition", async () => {
    // Les autres transitions restent des ecritures SQLite : les pages doivent
    // continuer de fonctionner runner arrete.
    const scene = await failedRun();
    let probes = 0;
    const counting: TaskTransitionPorts = {
      preflight: (repositoryPath, policy) => {
        probes += 1;
        return cleanRepository().preflight(repositoryPath, policy);
      },
    };

    const blocked = await applyTaskTransition(
      db,
      { projectId: scene.projectId, taskId: scene.taskId, status: TASK_STATUS.BLOCKED },
      counting,
    );
    assert.equal(blocked.ok, true);
    assert.equal(probes, 0, "aucun aller-retour vers le runner");
  });

  it("ne sonde pas le runner pour un brouillon qu'on rend pret", async () => {
    // `DRAFT → READY` est le parcours normal d'ecriture d'une tache. Il n'a
    // jamais rien eu a voir avec un repository, et n'en depend toujours pas.
    counter += 1;
    const project = await createProject(db, {
      name: `Projet brouillon ${String(counter)}`,
      description: null,
      repositoryPath: path.join(workspace, `brouillon-${String(counter)}`),
    });
    const task = await createTask(db, {
      projectId: project.id,
      title: "Une tache neuve",
      objective: "Faire quelque chose.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: ["Cela fonctionne"],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(task !== null);

    let probes = 0;
    const outcome = await applyTaskTransition(
      db,
      { projectId: project.id, taskId: task.id, status: TASK_STATUS.READY },
      {
        preflight: () => {
          probes += 1;
          throw new Error("le runner ne doit pas etre sollicite");
        },
      },
    );

    assert.equal(outcome.ok, true);
    assert.equal(probes, 0);
    assert.equal((await getTaskById(db, task.id))?.status, TASK_STATUS.READY);
  });
});

// ---------------------------------------------------------------------------
// D / E / H. La reprise d'un READY echoue en chemin
// ---------------------------------------------------------------------------

describe("une tache READY par un Retry avorte reste reprenable", () => {
  /** Reproduit l'etat exact du pilote : `Retry` clique, lancement jamais fait. */
  async function stranded(): Promise<Scene> {
    const scene = await failedRun();
    // La transition telle qu'elle se produisait **avant** ce correctif : le
    // statut change sans qu'aucune execution ne parte.
    await db.task.update({
      where: { id: scene.taskId },
      data: { status: TASK_STATUS.READY },
    });
    return scene;
  }

  it("offre la reprise, et sait dire pourquoi", async () => {
    // Le cas D, avec `workspaceEntries = NULL` comme le pilote reel.
    const scene = await stranded();
    const cycle = await loadCorrectionContext(db, { runId: scene.runId, taskId: scene.taskId });

    assert.equal(cycle?.processFailure.eligible, true);
    assert.equal(cycle?.strandedRetry, true, "l'ecran doit pouvoir l'expliquer");
  });

  it("demarre la reprise, ancree a l'execution echouee", async () => {
    const scene = await stranded();

    const reserved = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.ok(reserved.ok);

    const ports = acceptingPorts();
    const launched = await launchCorrection(
      db,
      {
        projectId: scene.projectId,
        taskId: scene.taskId,
        sourceRunId: scene.runId,
        attemptId: reserved.attempt.id,
      },
      ports,
    );

    assert.ok(launched.ok, launched.ok ? "" : launched.message);
    const correction = await getRunById(db, launched.runId);
    assert.equal(correction?.kind, RUN_KIND.CORRECTION);
    assert.equal(correction?.parentRunId, scene.runId);
    // La tache passe en execution, sans aucune edition manuelle.
    assert.equal((await getTaskById(db, scene.taskId))?.status, TASK_STATUS.RUNNING);
  });

  it("transmet l'empreinte globale malgre l'absence d'entrees", async () => {
    // La garantie ne faiblit pas parce que le diagnostic par chemin manque :
    // l'empreinte part, et le runner la verifiera.
    const scene = await stranded();
    const reserved = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.ok(reserved.ok);

    const ports = acceptingPorts();
    await launchCorrection(
      db,
      {
        projectId: scene.projectId,
        taskId: scene.taskId,
        sourceRunId: scene.runId,
        attemptId: reserved.attempt.id,
      },
      ports,
    );

    const preflight = ports.preflightCalls[0] as {
      expectedWorkspaceFingerprint: string;
      expectedWorkspaceEntries: string | null;
    };
    assert.equal(preflight.expectedWorkspaceFingerprint, FINGERPRINT);
    assert.equal(preflight.expectedWorkspaceEntries, null);
  });

  it("refuse des qu'une execution plus recente existe", async () => {
    // Le cas E : un `Retry` qui a **reellement** demarre. L'echec n'est plus le
    // dernier fait de la tache, et sa session n'est plus celle a reprendre.
    const scene = await stranded();
    const later = await createRun(db, {
      projectId: scene.projectId,
      taskId: scene.taskId,
      prompt: "Le vrai second essai.",
      promptSha256: "d".repeat(64),
      runnerRunId: "77777777-6666-4555-8444-333333333333",
    });
    assert.ok(later.ok);

    const cycle = await loadCorrectionContext(db, { runId: scene.runId, taskId: scene.taskId });
    assert.equal(cycle?.processFailure.eligible, false);
    assert.equal(
      cycle?.processFailure.eligible === false ? cycle.processFailure.code : null,
      CORRECTION_REFUSAL.TASK_NOT_IN_REVIEW,
    );
  });

  it("refuse une tache READY qui n'a jamais echoue", async () => {
    // Le cas H : une tache prete ordinaire. Y reprendre une session serait faux,
    // et le statut seul ne suffit donc jamais a autoriser.
    counter += 1;
    const project = await createProject(db, {
      name: `Projet neuf ${String(counter)}`,
      description: null,
      repositoryPath: path.join(workspace, `neuf-${String(counter)}`),
    });
    const task = await createTask(db, {
      projectId: project.id,
      title: "Une tache jamais lancee",
      objective: "Faire autre chose.",
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
      promptSha256: "e".repeat(64),
      runnerRunId: "66666666-5555-4444-8333-222222222222",
    });
    assert.ok(created.ok);
    await updateTaskStatus(db, task.id, project.id, TASK_STATUS.READY);

    // L'execution n'a pas echoue : elle est simplement en file.
    const cycle = await loadCorrectionContext(db, { runId: created.run.id, taskId: task.id });
    assert.equal(cycle?.processFailure.eligible, false);
  });

  it("refuse une reprise deja consommee sur cette execution", async () => {
    const scene = await stranded();
    const reserved = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.ok(reserved.ok);
    const launched = await launchCorrection(
      db,
      {
        projectId: scene.projectId,
        taskId: scene.taskId,
        sourceRunId: scene.runId,
        attemptId: reserved.attempt.id,
      },
      acceptingPorts(),
    );
    assert.ok(launched.ok);

    // La correction existe : l'echec a desormais une suite, et `strandedRetry`
    // cesse de le reconnaitre.
    const cycle = await loadCorrectionContext(db, { runId: scene.runId, taskId: scene.taskId });
    assert.equal(cycle?.strandedRetry, false);
  });
});

// ---------------------------------------------------------------------------
// F / G. L'etat du disque reste la seule autorite
// ---------------------------------------------------------------------------

describe("le disque decide, pas le statut", () => {
  async function stranded(): Promise<Scene> {
    const scene = await failedRun();
    await db.task.update({ where: { id: scene.taskId }, data: { status: TASK_STATUS.READY } });
    return scene;
  }

  it("refuse quand l'empreinte du dossier de travail a change", async () => {
    // Le cas F. Reconnaitre le `Retry` avorte n'accorde rien : le runner
    // recalcule l'empreinte, et son refus fait tomber la reprise.
    const scene = await stranded();
    const reserved = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.ok(reserved.ok);

    const launched = await launchCorrection(
      db,
      {
        projectId: scene.projectId,
        taskId: scene.taskId,
        sourceRunId: scene.runId,
        attemptId: reserved.attempt.id,
      },
      divergedPorts("REVIEW_WORKTREE_CHANGED"),
    );

    assert.equal(launched.ok, false);
    // La tache n'a pas bouge : elle etait `READY`, elle le reste.
    assert.equal((await getTaskById(db, scene.taskId))?.status, TASK_STATUS.READY);
  });

  it("refuse quand HEAD a bouge depuis l'echec", async () => {
    // Le cas G : un commit a eu lieu entre-temps. Le point de depart de la
    // session reprise n'existe plus.
    const scene = await stranded();
    const reserved = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.ok(reserved.ok);

    const launched = await launchCorrection(
      db,
      {
        projectId: scene.projectId,
        taskId: scene.taskId,
        sourceRunId: scene.runId,
        attemptId: reserved.attempt.id,
      },
      divergedPorts("GIT_HEAD_CHANGED"),
    );

    assert.equal(launched.ok, false);
    assert.equal((await getTaskById(db, scene.taskId))?.status, TASK_STATUS.READY);
  });

  it("rend la reservation apres un refus, pour un geste ulterieur", async () => {
    const scene = await stranded();
    const first = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.ok(first.ok);
    await launchCorrection(
      db,
      {
        projectId: scene.projectId,
        taskId: scene.taskId,
        sourceRunId: scene.runId,
        attemptId: first.attempt.id,
      },
      divergedPorts("REVIEW_WORKTREE_CHANGED"),
    );

    const second = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.equal(second.ok, true);
  });
});

// ---------------------------------------------------------------------------
// I. Concurrence
// ---------------------------------------------------------------------------

describe("une seule execution de recuperation", () => {
  it("n'accorde qu'une reservation, meme sur deux clics simultanes", async () => {
    const scene = await failedRun();
    await db.task.update({ where: { id: scene.taskId }, data: { status: TASK_STATUS.READY } });

    const [first, second] = await Promise.all([
      reserveCorrection(db, {
        taskId: scene.taskId,
        sourceRunId: scene.runId,
        source: CORRECTION_SOURCE.PROCESS_FAILURE,
      }),
      reserveCorrection(db, {
        taskId: scene.taskId,
        sourceRunId: scene.runId,
        source: CORRECTION_SOURCE.PROCESS_FAILURE,
      }),
    ]);

    assert.equal([first, second].filter((entry) => entry.ok).length, 1);
  });

  it("ne produit qu'une correction quand deux lancements se croisent", async () => {
    const scene = await failedRun();
    await db.task.update({ where: { id: scene.taskId }, data: { status: TASK_STATUS.READY } });

    const reserved = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.ok(reserved.ok);

    const input = {
      projectId: scene.projectId,
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      attemptId: reserved.attempt.id,
    };
    const [a, b] = await Promise.all([
      launchCorrection(db, input, acceptingPorts()),
      launchCorrection(db, input, acceptingPorts()),
    ]);

    // `createRun` refuse la seconde dans sa propre transaction : l'exclusion par
    // repository est le verrou, pas la vigilance de l'appelant.
    assert.equal([a, b].filter((entry) => entry.ok).length, 1);
    const corrections = (await listRunsByTask(db, scene.taskId)).filter(
      (entry) => entry.kind === RUN_KIND.CORRECTION,
    );
    assert.equal(corrections.length, 1);
  });

  it("laisse l'execution echouee intacte apres la reprise", async () => {
    const scene = await failedRun();
    await db.task.update({ where: { id: scene.taskId }, data: { status: TASK_STATUS.READY } });
    const before = await getRunById(db, scene.runId);

    const reserved = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.ok(reserved.ok);
    await launchCorrection(
      db,
      {
        projectId: scene.projectId,
        taskId: scene.taskId,
        sourceRunId: scene.runId,
        attemptId: reserved.attempt.id,
      },
      acceptingPorts(),
    );

    const after = await getRunById(db, scene.runId);
    assert.equal(after?.status, RUN_STATUS.FAILED);
    assert.equal(after?.failureCategory, before?.failureCategory);
    assert.deepEqual(after?.git.changedFiles, before?.git.changedFiles);
  });
});
