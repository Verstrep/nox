/**
 * Reprendre une execution qui a echoue, sur le travail qu'elle a laisse.
 *
 * ## Ce que ce fichier rejoue
 *
 * Le second pilote reel, dans sa forme exacte. `TASK-000` de TicketPulse a
 * tourne onze minutes et vingt-quatre secondes, produit vingt-quatre fichiers
 * non commites, puis le processus est sorti en code 1 sur une derniere
 * verification. NOX a enregistre `CLAUDE_PROCESS_FAILED`, `exit 1`, un `HEAD`
 * inchange — et n'a su proposer qu'un `Retry`, qui exige un repository propre.
 * Le seul chemin offert commencait donc par jeter le travail.
 *
 * Les tests ci-dessous protegent les deux moities du correctif :
 *
 * ```text
 * ce que NOX conserve   →  categorie, constat, code de sortie, sortie d'erreur,
 *                          dernieres actions reconnues, empreintes par entree
 * ce que NOX propose    →  une reprise qui part du dossier de travail sale,
 *                          quand — et seulement quand — il est encore le bon
 * ```
 *
 * ## Aucun fournisseur, aucun processus
 *
 * Base temporaire, ports de runner simules, faux resultats de Claude Code.
 * Aucun appel reseau, aucun quota consomme, aucun binaire lance.
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
  RUN_FAILURE_LIMITS,
  RUN_KIND,
  RUN_STATUS,
  TASK_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
  WORKSPACE_FINGERPRINT_VERSION,
  serializeWorkspaceEntries,
  type ClaudeRunEventDraft,
  type WorkspaceEntryDigest,
} from "@nox/shared";
import {
  appendRunEvents,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  failRun,
  getCorrectionAttemptForRun,
  getRunById,
  getTaskById,
  listRunEvents,
  markRunRunning,
  reserveCorrection,
  saveRunReview,
  startTaskExecution,
  toDatabaseFilePath,
  updateTaskStatus,
  toSqliteUrl,
  type DatabaseClient,
} from "@nox/database";

import { loadCorrectionContext } from "./correction-cycle.ts";
import { launchCorrection, type CorrectionLaunchPorts } from "./correction-launch.ts";

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

/** Les vingt-quatre fichiers du pilote reel, en plus petit. */
const CHANGED_FILES = ["src/app.ts", "src/lib/import.ts", "docs/CHOICES.md"];

const ENTRIES: WorkspaceEntryDigest[] = CHANGED_FILES.map((file, index) => ({
  path: file,
  code: index === 2 ? "??" : " M",
  digest: `d${String(index)}`.padEnd(32, "0"),
}));

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
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-failed-run-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

type Scene = {
  projectId: string;
  repositoryPath: string;
  taskId: string;
  runId: string;
};

/**
 * Une tache dont l'execution s'est arretee en cours de route.
 *
 * Les valeurs sont celles d'un vrai echec : un code de sortie non nul, des
 * fichiers laisses sur le disque, une session Claude rapportee, une review et
 * une empreinte capturees a la conclusion. C'est exactement ce que le runner
 * ecrit — les tests du runner le verifient de leur cote ; ici, on part de la.
 */
async function failedRun(
  overrides: {
    exitCode?: number | null;
    errorCode?: string;
    failureCategory?: string;
    failureDetail?: string;
    changedFiles?: readonly string[];
    entries?: string | null;
    sessionId?: string | null;
    withReview?: boolean;
  } = {},
): Promise<Scene> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });

  const task = await createTask(db, {
    projectId: project.id,
    title: "Importer un fichier Excel d'incidents",
    objective: "Permettre l'import controle d'un classeur.",
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: ["Le classeur est lu", "Les doublons sont rejetes"],
    documentReferences: [],
    validationCommands: ["npm run test"],
  });
  assert.ok(task !== null, "la tache de test doit pouvoir etre creee");

  const created = await createRun(db, {
    projectId: project.id,
    taskId: task.id,
    prompt: "Prompt initial de la tache.",
    promptSha256: "b".repeat(64),
    runnerRunId: "11111111-2222-4333-8444-555555555555",
  });
  assert.ok(created.ok, "l'execution initiale doit pouvoir etre creee");
  // Le cycle reel, sans raccourci : un humain passe la tache en `READY`, puis le
  // lancement la met en `RUNNING`. Ecrire `FAILED` directement contournerait
  // `canAutomateTaskStatusTransition`, c'est-a-dire la regle meme qu'on teste.
  const ready = await updateTaskStatus(db, task.id, project.id, TASK_STATUS.READY);
  assert.ok(ready.ok, "la tache doit pouvoir passer en READY");
  assert.equal(await startTaskExecution(db, task.id), true);
  await markRunRunning(db, created.run.id, new Date());

  const changed = overrides.changedFiles ?? CHANGED_FILES;

  await failRun(db, created.run.id, {
    finishedAt: new Date(),
    exitCode: overrides.exitCode === undefined ? 1 : overrides.exitCode,
    errorCode: overrides.errorCode ?? "CLAUDE_PROCESS_FAILED",
    failureCategory: overrides.failureCategory ?? RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO,
    failureDetail:
      overrides.failureDetail ??
      "Le processus Claude Code s'est termine avec le code 1. Ce qu'il avait deja ecrit reste dans le dossier de travail.",
    stderrTail: "Error: verification finale interrompue\n",
    claudeSessionId: overrides.sessionId === undefined ? SESSION : overrides.sessionId,
    numTurns: 81,
    git: {
      branch: BRANCH,
      upstream: "origin/main",
      headBefore: HEAD,
      headAfter: HEAD,
      diffStat: " 3 files changed, 4101 insertions(+)",
      changedFiles: [...changed],
    },
  });

  if (overrides.withReview !== false) {
    await saveRunReview(db, created.run.id, {
      capturedAt: new Date().toISOString(),
      headBefore: HEAD,
      unreliable: false,
      files: changed.map((file, position) => ({
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
        entries:
          overrides.entries === undefined ? serializeWorkspaceEntries(ENTRIES) : overrides.entries,
      },
    });
  }

  return {
    projectId: project.id,
    repositoryPath: project.repositoryPath,
    taskId: task.id,
    runId: created.run.id,
  };
}

/** Les evenements que le pilote reel a laisses en dernier. */
async function appendActivity(runId: string): Promise<void> {
  const drafts: ClaudeRunEventDraft[] = [
    {
      kind: "TOOL_STARTED",
      label: "Running npm run test",
      detail: "Ligne executee : npm run test",
      toolName: "Bash",
      isError: false,
    },
    {
      kind: "VALIDATION",
      label: "Validation failed",
      detail: "En reponse a : npm run test Code de sortie : 1.",
      toolName: "Bash",
      isError: true,
    },
    {
      kind: "RESULT",
      label: "Finished with an error",
      detail: "Sous-type rapporte par Claude Code : error_during_execution.",
      toolName: null,
      isError: true,
    },
  ];
  await appendRunEvents(
    db,
    runId,
    drafts.map((draft, index) => ({
      ...draft,
      sequence: index + 1,
      occurredAt: new Date(Date.now() + index).toISOString(),
    })),
  );
}

/** Ports d'un runner qui accepte tout : le refus a deja ete teste ailleurs. */
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

// ---------------------------------------------------------------------------
// A. Ce que NOX conserve d'un echec
// ---------------------------------------------------------------------------

describe("un echec apres travail est diagnosticable", () => {
  it("conserve la categorie, le constat et le code de sortie", async () => {
    const scene = await failedRun();
    const run = await getRunById(db, scene.runId);

    assert.ok(run !== null);
    assert.equal(run.status, RUN_STATUS.FAILED);
    assert.equal(run.errorCode, "CLAUDE_PROCESS_FAILED", "le code du contrat ne change pas");
    assert.equal(run.failureCategory, RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO);
    assert.ok(run.failureDetail !== null);
    assert.match(run.failureDetail, /code 1/u);
    assert.equal(run.claude.exitCode, 1);
    assert.ok(run.stderrTail !== null);
  });

  it("mene la tache en echec, et conserve le travail partiel", async () => {
    const scene = await failedRun();
    const task = await getTaskById(db, scene.taskId);
    const run = await getRunById(db, scene.runId);

    assert.equal(task?.status, TASK_STATUS.FAILED);
    assert.deepEqual(run?.git.changedFiles, CHANGED_FILES);
    // NOX ne restaure rien : `HEAD` est reste ou il etait.
    assert.equal(run?.git.headAfter, HEAD);
  });

  it("capture la review et l'empreinte malgre l'echec", async () => {
    // C'est justement apres un echec qu'on a le plus besoin de voir ce qui a
    // ete laisse sur le disque.
    const scene = await failedRun();
    const cycle = await loadCorrectionContext(db, { runId: scene.runId, taskId: scene.taskId });

    assert.ok(cycle !== null);
    assert.equal(cycle.failureCategory, RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO);
  });

  it("propose une correction", async () => {
    // Le coeur du correctif. Avant HOTFIX-006, cette decision etait toujours un
    // refus, et l'utilisateur n'avait que `Retry`.
    const scene = await failedRun();
    const cycle = await loadCorrectionContext(db, { runId: scene.runId, taskId: scene.taskId });

    assert.equal(cycle?.processFailure.eligible, true);
    // Et surtout : la porte humaine, elle, reste fermee — la tache n'est pas en
    // review, personne n'a rien relu.
    assert.equal(cycle?.human.eligible, false);
  });

  it("ne propose rien quand le processus n'a jamais demarre", async () => {
    // Un `Retry` repare une installation ; une reprise ne continuerait rien.
    const scene = await failedRun({
      errorCode: "CLAUDE_START_FAILED",
      failureCategory: RUN_FAILURE_CATEGORY.SPAWN_FAILED,
      exitCode: null,
      changedFiles: [],
    });
    const cycle = await loadCorrectionContext(db, { runId: scene.runId, taskId: scene.taskId });

    assert.equal(cycle?.processFailure.eligible, false);
    assert.equal(
      cycle?.processFailure.eligible === false ? cycle.processFailure.code : null,
      CORRECTION_REFUSAL.NO_PARTIAL_WORK,
    );
  });

  it("derive la categorie d'une execution anterieure a HOTFIX-006", async () => {
    // Colonne vide : la lecture retombe sur les faits deja enregistres, sans
    // qu'aucune ligne historique n'ait ete reecrite.
    const scene = await failedRun();
    await db.run.update({ where: { id: scene.runId }, data: { failureCategory: null } });

    const cycle = await loadCorrectionContext(db, { runId: scene.runId, taskId: scene.taskId });
    assert.equal(cycle?.failureCategory, RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO);
    assert.equal(cycle?.processFailure.eligible, true);
  });
});

// ---------------------------------------------------------------------------
// J. Les diagnostics restent bornes
// ---------------------------------------------------------------------------

describe("un diagnostic reste borne", () => {
  it("borne le constat a l'ecriture, quoi qu'en dise l'appelant", async () => {
    const scene = await failedRun({ failureDetail: "x".repeat(RUN_FAILURE_LIMITS.detail * 4) });
    const run = await getRunById(db, scene.runId);

    assert.ok(run?.failureDetail !== null && run?.failureDetail !== undefined);
    assert.ok(run.failureDetail.length <= RUN_FAILURE_LIMITS.detail);
  });

  it("ne conserve que la fin de la sortie d'erreur", async () => {
    const scene = await failedRun();
    const run = await getRunById(db, scene.runId);

    // Le debut d'une sortie d'erreur est un preambule ; la cause est a la fin.
    assert.match(run?.stderrTail ?? "", /verification finale interrompue/u);
  });
});

// ---------------------------------------------------------------------------
// G. Ce qu'une reprise fait, et ce qu'elle ne touche pas
// ---------------------------------------------------------------------------

describe("une reprise part du travail partiel", () => {
  it("cree une correction reliee a l'execution echouee", async () => {
    const scene = await failedRun();
    await appendActivity(scene.runId);

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

    const attempt = await getCorrectionAttemptForRun(db, launched.runId);
    assert.equal(attempt?.source, CORRECTION_SOURCE.PROCESS_FAILURE);
    assert.equal(attempt?.sourceRunId, scene.runId);
  });

  it("reprend la session Claude de l'execution echouee", async () => {
    // NOX ne pretend pas reprendre : il passe l'identifiant de session relu en
    // base, et le runner le donne a `--resume`.
    const scene = await failedRun();
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
    assert.ok(launched.ok);

    const start = ports.startCalls[0] as { correction?: { sessionId: string } };
    assert.equal(start.correction?.sessionId, SESSION);
  });

  it("n'exige aucun repository propre, et transmet l'etat attendu", async () => {
    // La difference exacte avec `Retry` : le lancement passe par le preflight de
    // correction, qui verifie branche, `HEAD` et empreinte — jamais la proprete.
    const scene = await failedRun();
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
    assert.ok(launched.ok);

    const preflight = ports.preflightCalls[0] as {
      expectedGitHead: string;
      expectedBranch: string;
      expectedWorkspaceFingerprint: string;
      expectedWorkspaceEntries: string | null;
    };
    assert.equal(preflight.expectedGitHead, HEAD);
    assert.equal(preflight.expectedBranch, BRANCH);
    assert.equal(preflight.expectedWorkspaceFingerprint, FINGERPRINT);
    // Les entrees suivent : c'est ce qui permettra de nommer les chemins d'un
    // refus, sans jamais en provoquer un.
    assert.ok(preflight.expectedWorkspaceEntries !== null);
    assert.match(preflight.expectedWorkspaceEntries, /src\/app\.ts/u);
  });

  it("laisse le contrat de la tache exactement ou il etait", async () => {
    // Une correction essaie de satisfaire le contrat gele ; elle ne le
    // renegocie pas.
    const scene = await failedRun();
    const before = await getTaskById(db, scene.taskId);

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

    const after = await getTaskById(db, scene.taskId);
    assert.deepEqual(after?.acceptanceCriteria, before?.acceptanceCriteria);
    assert.deepEqual(after?.validationCommands, before?.validationCommands);
    assert.equal(after?.objective, before?.objective);
    assert.equal(after?.code, before?.code);
  });

  it("transmet le diagnostic de l'echec dans le prompt de reprise", async () => {
    const scene = await failedRun();
    await appendActivity(scene.runId);

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
    assert.ok(launched.ok);

    const correction = await getRunById(db, launched.runId);
    const prompt = correction?.prompt ?? "";

    assert.match(prompt, /s'est arretee avant d'avoir fini/u);
    assert.match(prompt, new RegExp(RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO, "u"));
    assert.match(prompt, /code de sortie : 1/u);
    assert.match(prompt, /dernieres actions reconnues/u);
    assert.match(prompt, /Validation failed/u);
    // Le contrat gele part aussi : une correction reste auditable seule.
    assert.match(prompt, /Les doublons sont rejetes/u);
    // Et NOX dit ce qu'il ne sait pas, plutot que de laisser croire.
    assert.match(prompt, /n'expose pas systematiquement/u);
  });

  it("n'ecrit aucun feedback : personne n'a rien relu", async () => {
    const scene = await failedRun();
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

    const feedbacks = await db.reviewFeedback.findMany({ where: { taskId: scene.taskId } });
    assert.equal(feedbacks.length, 0);
  });

  it("laisse les evenements de l'execution echouee intacts", async () => {
    // L'historique d'un echec est ce qui permet de le comprendre six mois plus
    // tard. Une reprise s'ajoute a lui, elle ne le remplace pas.
    const scene = await failedRun();
    await appendActivity(scene.runId);
    const before = await listRunEvents(db, scene.runId);

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

    assert.deepEqual(await listRunEvents(db, scene.runId), before);
  });
});

// ---------------------------------------------------------------------------
// I. Concurrence
// ---------------------------------------------------------------------------

describe("deux reprises simultanees n'en produisent qu'une", () => {
  it("une seule reservation est accordee", async () => {
    // La reservation **est** le verrou : deux onglets, deux clics, une seule
    // correction. Le perdant recoit un refus nomme, pas une exception brute.
    const scene = await failedRun();

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

    const granted = [first, second].filter((entry) => entry.ok);
    const refused = [first, second].filter((entry) => !entry.ok);

    assert.equal(granted.length, 1, "une seule reservation");
    assert.equal(refused.length, 1);
    assert.equal(refused[0]?.ok === false ? refused[0].reason : null, "already_reserved");
  });

  it("une reservation deja prise fait refuser la suivante par un code nomme", async () => {
    const scene = await failedRun();
    const reserved = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.ok(reserved.ok);

    const cycle = await loadCorrectionContext(db, { runId: scene.runId, taskId: scene.taskId });
    assert.equal(cycle?.processFailure.eligible, false);
    assert.equal(
      cycle?.processFailure.eligible === false ? cycle.processFailure.code : null,
      CORRECTION_REFUSAL.ALREADY_RESERVED,
    );
  });

  it("refuse une seconde reprise apres une correction deja lancee", async () => {
    const scene = await failedRun();
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

    const again = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.equal(again.ok, false);
  });
});


// ---------------------------------------------------------------------------
// Le cas exact du second pilote : un amorcage
// ---------------------------------------------------------------------------

describe("un amorcage echoue est reprenable", () => {
  it("propose une reprise sur TASK-000, comme sur une tache ordinaire", async () => {
    // Le pilote reel a echoue sur `TASK-000`, apres onze minutes et vingt-quatre
    // fichiers. Refuser la reprise aux amorcages aurait exclu le cas meme qui a
    // motive ce correctif.
    //
    // Ce n'est pas une entorse a « un amorcage ne se corrige jamais tout seul » :
    // cette regle vise la boucle **automatique**, et cette porte-ci est humaine.
    // Une correction d'amorcage garde par ailleurs les permissions d'un
    // amorcage — le pipeline le prevoit depuis TASK-028.
    const scene = await failedRun();
    await db.task.update({ where: { id: scene.taskId }, data: { kind: TASK_KIND.BOOTSTRAP } });

    const cycle = await loadCorrectionContext(db, { runId: scene.runId, taskId: scene.taskId });
    assert.equal(cycle?.processFailure.eligible, true);
    // La boucle automatique, elle, continue de le refuser.
    assert.equal(cycle?.automatic.eligible, false);
  });

  it("transmet les permissions d'amorcage a la reprise", async () => {
    const scene = await failedRun();
    await db.task.update({ where: { id: scene.taskId }, data: { kind: TASK_KIND.BOOTSTRAP } });

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

    const start = ports.startCalls[0] as { taskKind: string };
    assert.equal(start.taskKind, TASK_KIND.BOOTSTRAP);
  });
});


// ---------------------------------------------------------------------------
// 8. Ce qu'une reprise ne peut pas ecraser
// ---------------------------------------------------------------------------

describe("l'echec relu reste immuable", () => {
  it("un resultat tardif du processus mort ne rouvre rien", async () => {
    // Le premier etat final gagne, et le reste est ignore. Sans cette regle, une
    // reponse arrivee apres coup pourrait ressusciter l'execution que la
    // correction est en train de reprendre.
    const scene = await failedRun();

    await failRun(db, scene.runId, {
      exitCode: 0,
      errorCode: null,
      failureCategory: null,
      failureDetail: null,
      stderrTail: null,
    });

    const run = await getRunById(db, scene.runId);
    assert.equal(run?.status, RUN_STATUS.FAILED);
    assert.equal(run?.errorCode, "CLAUDE_PROCESS_FAILED");
    assert.equal(run?.failureCategory, RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO);
    assert.equal(run?.claude.exitCode, 1);
  });

  it("une reprise ne touche ni au diagnostic, ni aux fichiers de l'echec", async () => {
    const scene = await failedRun();
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
    assert.equal(after?.status, before?.status);
    assert.equal(after?.failureCategory, before?.failureCategory);
    assert.equal(after?.failureDetail, before?.failureDetail);
    assert.deepEqual(after?.git.changedFiles, before?.git.changedFiles);
  });

  it("refuse une reprise pendant qu'une execution occupe deja le repository", async () => {
    // « Au plus une execution Claude active par repository canonique » vaut ici
    // entierement : une correction est une nouvelle execution.
    const scene = await failedRun();

    const other = await createRun(db, {
      projectId: scene.projectId,
      taskId: scene.taskId,
      prompt: "Une autre execution.",
      promptSha256: "c".repeat(64),
      runnerRunId: "99999999-8888-4777-8666-555555555555",
    });
    assert.ok(other.ok);

    // Le modele de lecture ne consulte pas les executions actives : ce n'est pas
    // lui qui autorise. La barriere est au lancement, ou `checkResumeCandidate`
    // recoit `hasActiveRun` et refuse — et elle refuse **avant** de solliciter
    // le runner.
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

    assert.equal(launched.ok, false);
    assert.equal(ports.startCalls.length, 0, "aucun processus demande");
    assert.equal(ports.preflightCalls.length, 0, "le runner n'est meme pas sonde");
  });

  it("refuse une reprise dont le point de depart n'est plus celui de l'echec", async () => {
    // Le refus vient du runner, sur l'etat reel du disque. Ici, le port simule
    // rejoue ce refus : ce qui est verifie, c'est que NOX **rend** la
    // reservation au lieu de la consommer pour rien.
    const scene = await failedRun();
    const reserved = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.ok(reserved.ok);

    const ports = acceptingPorts();
    const refusing: CorrectionLaunchPorts = {
      ...ports,
      preflight: () =>
        Promise.resolve({
          ok: false,
          failure: {
            kind: "runner_error",
            code: "REVIEW_WORKTREE_CHANGED",
            detail: "Le dossier de travail a diverge depuis l'execution relue — modifies : src/app.ts.",
          },
        }),
    };

    const launched = await launchCorrection(
      db,
      {
        projectId: scene.projectId,
        taskId: scene.taskId,
        sourceRunId: scene.runId,
        attemptId: reserved.attempt.id,
      },
      refusing,
    );

    assert.equal(launched.ok, false);
    // Le message nomme le chemin : c'est tout l'objet des empreintes par entree.
    assert.match(launched.ok ? "" : launched.message, /src\/app\.ts/u);
    // Aucune execution n'a demarre, et la tache n'a pas bouge.
    assert.equal(ports.startCalls.length, 0);
    const task = await getTaskById(db, scene.taskId);
    assert.equal(task?.status, TASK_STATUS.FAILED);

    // La reservation est **rendue** : la place se libere pour un geste ulterieur.
    const again = await reserveCorrection(db, {
      taskId: scene.taskId,
      sourceRunId: scene.runId,
      source: CORRECTION_SOURCE.PROCESS_FAILURE,
    });
    assert.equal(again.ok, true);
  });
});
