/**
 * Les compteurs d'activite d'un projet, sur une vraie base.
 *
 * ## Pourquoi une base reelle plutot que des doublures
 *
 * Parce que ce qui est teste ici n'est pas une arithmetique — c'est un
 * **rattachement**. « Combien d'executions appartiennent a ce projet » traverse
 * `Run -> Task -> Project` ; « combien de criteres humains » traverse
 * `TaskAcceptanceCriterion -> Task -> Project`. Une doublure repondrait ce
 * qu'on lui a dit de repondre, et laisserait passer exactement la faute qui
 * compte : un compteur qui additionne les lignes d'un autre projet.
 *
 * ## Le decor
 *
 * TripKit, tel que le premier pilote reel l'a produit :
 *
 * ```text
 * TASK-000  amorcage, terminee
 * TASK-001  terminee par acceptation humaine, deux criteres confirmes
 * TASK-002  terminee par completion automatique, sept criteres automatises
 * ```
 *
 * Plus un second projet, present pour une seule raison : prouver qu'aucun de
 * ses nombres ne fuit dans les compteurs du premier.
 *
 * ## Aucun appel reel
 *
 * Base temporaire, aucun runner, aucun fournisseur, aucun reseau.
 */

import {
  COMMAND_EXECUTION_MODE,
  DELIVERY_POLICY,
  REVIEW_DECISION_SOURCE,
  TASK_PRIORITY,
  TASK_STATUS,
  VERIFICATION_MODE,
} from "@nox/shared";
import {
  collectProjectMetrics,
  completeRun,
  createDatabaseClient,
  createProject,
  createRun,
  createTask,
  startTaskExecution,
  toDatabaseFilePath,
  toSqliteUrl,
  updateTaskStatus,
  writeVerificationPlan,
  type DatabaseClient,
} from "@nox/database";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  METRICS_NOTICE,
  NOT_REPORTED,
  costRows,
  formatTokens,
  fraction,
  humanDecisionRows,
  verificationRows,
  workRows,
} from "./project-metrics-display.ts";
import { formatReportedCost } from "./run-display.ts";

/**
 * Le separateur de milliers de `formatTokens`.
 *
 * Nomme plutot que recopie dans une chaine litterale : une espace fine
 * insecable et une espace ordinaire sont indistinguables a la lecture, et un
 * test qui echouerait sur cette difference afficherait deux valeurs identiques.
 */
const THIN_SPACE = "\u202f";

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

async function applyMigrations(file: string): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const sqlite = new DatabaseSync(file);
  try {
    for (const directory of directories) {
      sqlite.exec(await readFile(path.join(MIGRATIONS_DIR, directory, "migration.sql"), "utf8"));
    }
  } finally {
    sqlite.close();
  }
}

async function newProject(name: string) {
  counter += 1;
  return createProject(db, {
    name: `${name} ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
}

type TaskShape = {
  title: string;
  automated: number;
  human: number;
};

async function newTask(projectId: string, shape: TaskShape): Promise<string> {
  const criteria = [
    ...Array.from(
      { length: shape.automated },
      (_, index) => `Critere automatise ${String(index + 1)}`,
    ),
    ...Array.from({ length: shape.human }, (_, index) => `Critere humain ${String(index + 1)}`),
  ];

  const task = await createTask(db, {
    projectId,
    title: shape.title,
    objective: `Objectif de ${shape.title}.`,
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: criteria,
    documentReferences: [],
    validationCommands: ["npm test"],
  });
  assert.ok(task !== null);

  await writeVerificationPlan(db, task.id, {
    criteria: criteria.map((text, index) => ({
      text,
      verificationMode:
        index < shape.automated ? VERIFICATION_MODE.AUTOMATED : VERIFICATION_MODE.HUMAN,
      humanInstructions: index < shape.automated ? null : "Ouvrir l'ecran et regarder.",
      commandPositions: index < shape.automated ? [0] : [],
    })),
    commands: [{ command: "npm test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS }],
  });

  return task.id;
}

/** Une execution terminee, avec le cout que Claude Code a rapporte — ou aucun. */
async function newRun(
  projectId: string,
  taskId: string,
  options: { cost?: number | null; kind?: "INITIAL" | "CORRECTION" } = {},
): Promise<string> {
  assert.ok((await updateTaskStatus(db, taskId, projectId, TASK_STATUS.READY)).ok);
  await startTaskExecution(db, taskId);

  counter += 1;
  const run = await createRun(db, {
    projectId,
    taskId,
    prompt: "Prompt de test.",
    promptSha256: "e".repeat(64),
    runnerRunId: `runner-${String(counter)}`,
  });
  assert.ok(run.ok, JSON.stringify(run));
  assert.ok((await completeRun(db, run.run.id)) !== null);

  // Le cout et la nature sont ecrits directement : ce test mesure des
  // compteurs, pas le pipeline qui les remplit — celui-ci a ses propres tests.
  await db.run.update({
    where: { id: run.run.id },
    data: {
      reportedCostUsd: options.cost ?? null,
      kind: options.kind ?? "INITIAL",
    },
  });
  return run.run.id;
}

/** Une planification enregistree, avec ou sans consommation rapportee. */
async function newBacklogGeneration(
  projectId: string,
  options: {
    status?: string;
    model?: string;
    promptVersion?: string;
    totalTokens?: number | null;
  } = {},
): Promise<void> {
  counter += 1;
  await db.architectBacklogGeneration.create({
    data: {
      projectId,
      sequence: counter,
      status: options.status ?? "COMPLETED",
      model: options.model ?? "gpt-5.6-sol",
      promptVersion: options.promptVersion ?? "backlog/3",
      inputHash: "0".repeat(64),
      contextManifestJson: "{}",
      planningFingerprint: `${String(counter)}`.padStart(64, "f"),
      baseTaskInventoryRevision: "rev-tasks",
      baseMemoryRevision: "rev-memory",
      totalTokens: options.totalTokens ?? null,
    },
  });
}

async function approve(
  runId: string,
  source: string,
  confirmations: readonly string[] = [],
): Promise<void> {
  const decision = await db.runReviewDecision.create({ data: { runId, source } });
  for (const text of confirmations) {
    await db.runHumanCriterionConfirmation.create({
      data: { decisionId: decision.id, criterionText: text },
    });
  }
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-project-metrics-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// ---------------------------------------------------------------------------
// Le decor TripKit
// ---------------------------------------------------------------------------

describe("compteurs d'un projet de la forme TripKit", () => {
  it("compte exactement ce qui est persiste, et rien d'un autre projet", async () => {
    const project = await newProject("TripKit");
    const other = await newProject("Autre projet");

    // TASK-000 : l'amorcage. Terminee, mais ce n'est pas du travail produit.
    const bootstrap = await newTask(project.id, {
      title: "Preparer le repository",
      automated: 0,
      human: 1,
    });
    await db.task.update({ where: { id: bootstrap }, data: { kind: "BOOTSTRAP" } });

    // TASK-001 : six preuves, deux criteres humains, acceptee a la main.
    const first = await newTask(project.id, {
      title: "Gerer les deplacements et leurs hotels",
      automated: 6,
      human: 2,
    });
    const firstRun = await newRun(project.id, first, { cost: 1.5 });
    await approve(firstRun, REVIEW_DECISION_SOURCE.HUMAN, [
      "Critere humain 1",
      "Critere humain 2",
    ]);
    assert.ok((await updateTaskStatus(db, first, project.id, TASK_STATUS.COMPLETED)).ok);

    // TASK-002 : sept preuves, zero critere humain, conclue par NOX.
    const second = await newTask(project.id, {
      title: "Gerer les notes de frais et leur total",
      automated: 7,
      human: 0,
    });
    const secondRun = await newRun(project.id, second, { cost: 2.25 });
    await approve(secondRun, REVIEW_DECISION_SOURCE.AUTOMATED);
    assert.ok((await updateTaskStatus(db, second, project.id, TASK_STATUS.COMPLETED)).ok);

    // Une panne de validation, puis sa reprise : deux lots sur la meme
    // execution, comme le pilote les a produits.
    await db.autonomousValidationBatch.create({
      data: {
        runId: secondRun,
        attempt: 1,
        status: "ERROR",
        errorCode: "VALIDATION_SPAWN_FAILED",
        errorMessage: "Code systeme : ENOENT.",
      },
    });
    await db.autonomousValidationBatch.create({
      data: { runId: secondRun, attempt: 2, status: "PASSED" },
    });

    // Les appels Architect, dans trois des quatre tables.
    await newBacklogGeneration(project.id, {
      // Le pilote a genere BACKLOG-002 avec ce modele, par accident. La ligne
      // historique doit continuer de le dire.
      model: "gpt-5-mini",
      promptVersion: "backlog/2",
      totalTokens: 12_000,
    });
    await db.verificationRefresh.create({
      data: {
        projectId: project.id,
        bootstrapTaskId: bootstrap,
        status: "APPLIED",
        model: "gpt-5.6-sol",
        promptVersion: "verification-refresh/1",
        planningFingerprint: "a".repeat(64),
        totalTokens: 3_000,
      },
    });

    // Les livraisons : une par la politique, une a la main.
    for (const [taskId, runId, trigger] of [
      [first, firstRun, "MANUAL"],
      [second, secondRun, "AUTOMATIC"],
    ] as const) {
      await db.gitDelivery.create({
        data: {
          projectId: project.id,
          taskId,
          sourceRunId: runId,
          policy: DELIVERY_POLICY.AUTO_COMMIT,
          trigger,
          status: "COMMITTED",
          expectedHead: "b".repeat(40),
          expectedBranch: "main",
          candidateFingerprint: "c".repeat(64),
          candidateJson: "[]",
          // Fige a la reservation, et jamais recalcule : une reprise commite
          // exactement le meme texte, sinon le trailer ne prouverait plus rien.
          commitMessage: `${taskId} — travail valide`,
        },
      });
    }

    // Le decor du **second** projet : rien de tout ceci ne doit apparaitre
    // dans les compteurs du premier.
    const foreign = await newTask(other.id, { title: "Autre chose", automated: 3, human: 3 });
    const foreignRun = await newRun(other.id, foreign, { cost: 99 });
    await approve(foreignRun, REVIEW_DECISION_SOURCE.HUMAN_OVERRIDE);

    const metrics = await collectProjectMetrics(db, project.id);

    assert.equal(metrics.tasks.total, 3);
    assert.equal(metrics.tasks.completed, 2);
    assert.equal(metrics.tasks.bootstrap, 1);

    assert.equal(metrics.runs.total, 2);
    assert.equal(metrics.runs.corrections, 0);
    assert.equal(metrics.runs.reportedCostUsd, 3.75);
    assert.equal(metrics.runs.reportedCostRuns, 2);

    // 6 + 7 automatises, 1 (amorcage) + 2 humains.
    assert.equal(metrics.criteria.automated, 13);
    assert.equal(metrics.criteria.human, 3);

    assert.equal(metrics.approvals.human, 1);
    assert.equal(metrics.approvals.automated, 1);
    // Le passage en force appartient a l'autre projet : il ne doit pas
    // apparaitre ici.
    assert.equal(metrics.approvals.override, 0);
    assert.equal(metrics.approvals.criterionConfirmations, 2);

    assert.equal(metrics.validation.attempts, 2);
    assert.equal(metrics.validation.errored, 1);
    assert.equal(metrics.validation.failed, 0);

    assert.equal(metrics.architect.calls, 2);
    assert.equal(metrics.architect.totalTokens, 15_000);
    assert.equal(metrics.architect.reportedTokenCalls, 2);

    assert.equal(metrics.delivery.manual, 1);
    assert.equal(metrics.delivery.automatic, 1);
    assert.equal(metrics.delivery.failed, 0);
  });

  it("compte une correction comme une execution, et comme une correction", async () => {
    const project = await newProject("Projet corrige");
    const task = await newTask(project.id, { title: "Une tache", automated: 1, human: 0 });
    await newRun(project.id, task);
    await newRun(project.id, task, { kind: "CORRECTION" });

    const metrics = await collectProjectMetrics(db, project.id);

    assert.equal(metrics.runs.total, 2);
    assert.equal(metrics.runs.corrections, 1);
  });
});

// ---------------------------------------------------------------------------
// Les cas limites que le pilote n'a pas produits, et qui arriveront
// ---------------------------------------------------------------------------

describe("projets partiels et lignes historiques", () => {
  it("rend des zeros et des absences pour un projet vide, jamais un NaN", async () => {
    const project = await newProject("Projet vide");
    const metrics = await collectProjectMetrics(db, project.id);

    assert.equal(metrics.tasks.total, 0);
    assert.equal(metrics.runs.total, 0);
    // `null`, et non zero : « aucun cout rapporte » et « zero dollar » sont deux
    // affirmations differentes, et la seconde inventerait une gratuite.
    assert.equal(metrics.runs.reportedCostUsd, null);
    assert.equal(metrics.architect.totalTokens, null);

    const serialized = JSON.stringify([
      workRows(metrics),
      verificationRows(metrics),
      humanDecisionRows(metrics),
      costRows(metrics, formatReportedCost),
    ]);
    assert.equal(serialized.includes("NaN"), false);
    assert.equal(serialized.includes("undefined"), false);
    assert.equal(serialized.includes("Infinity"), false);
  });

  it("ignore les couts et jetons absents sans les compter comme zero", async () => {
    const project = await newProject("Projet sans cout");
    const task = await newTask(project.id, { title: "Une tache", automated: 1, human: 0 });
    await newRun(project.id, task, { cost: null });
    await newRun(project.id, task, { cost: 4 });

    // Une generation sans jetons : c'est le cas d'un appel en echec, et il a
    // quand meme eu lieu.
    await newBacklogGeneration(project.id, {
      status: "FAILED",
      totalTokens: null,
    });

    const metrics = await collectProjectMetrics(db, project.id);

    assert.equal(metrics.runs.total, 2);
    assert.equal(metrics.runs.reportedCostUsd, 4);
    // Le denominateur compte : la somme porte sur une seule execution.
    assert.equal(metrics.runs.reportedCostRuns, 1);

    // L'appel a eu lieu, et il a pu etre facture : il compte comme appel, pas
    // comme consommation.
    assert.equal(metrics.architect.calls, 1);
    assert.equal(metrics.architect.totalTokens, null);
    assert.equal(metrics.architect.reportedTokenCalls, 0);
  });
});

// ---------------------------------------------------------------------------
// L'affichage
// ---------------------------------------------------------------------------

describe("affichage des compteurs", () => {
  const metrics = {
    tasks: { total: 3, completed: 2, bootstrap: 1 },
    runs: { total: 2, corrections: 0, reportedCostUsd: 3.75, reportedCostRuns: 2 },
    criteria: { automated: 13, human: 3 },
    approvals: { human: 1, automated: 1, override: 0, criterionConfirmations: 2 },
    validation: { attempts: 2, failed: 0, errored: 1 },
    architect: { calls: 2, totalTokens: 15_000, reportedTokenCalls: 2 },
    delivery: { automatic: 1, manual: 1, failed: 0 },
  };

  it("ecrit une fraction plutot qu'un pourcentage", () => {
    // Un pourcentage cache son denominateur. « 1 / 2 » et « 500 / 1000 » ne
    // meritent pas la meme confiance, et « 50 % » les rend identiques.
    assert.equal(fraction(13, 16), "13 / 16");
    // Aucune division n'a lieu : un denominateur nul reste lisible.
    assert.equal(fraction(0, 0), "0 / 0");
  });

  it("compte l'amorcage a part du travail produit", () => {
    const rows = workRows(metrics);
    const product = rows.find((row) => row.label === "Tâches produit");

    assert.equal(product?.value, "2");
  });

  it("montre l'automatisation comme deux nombres, jamais comme un score", () => {
    const rows = humanDecisionRows(metrics);
    const approvals = rows.find((row) => row.label === "Approbations");

    assert.equal(approvals?.value, "1 / 2");
    assert.equal(approvals?.value.includes("%"), false);
  });

  it("dit « non rapporté » plutot que zero", () => {
    const empty = { ...metrics, architect: { calls: 1, totalTokens: null, reportedTokenCalls: 0 } };
    const rows = costRows(empty, formatReportedCost);
    const tokens = rows.find((row) => row.label === "Jetons Architect");

    assert.equal(tokens?.value, NOT_REPORTED);
    // L'appel a bien eu lieu : ne pas connaitre sa consommation ne l'efface pas.
    assert.equal(rows.find((row) => row.label === "Appels Architect")?.value, "1");
  });

  it("n'affiche aucun prix calcule", () => {
    const rows = costRows(metrics, formatReportedCost);
    const cost = rows.find((row) => row.label === "Coût Claude rapporté");

    // Le cout affiche est exactement celui que Claude Code a rapporte. NOX ne
    // consulte aucun catalogue de prix et ne convertit aucune devise.
    assert.equal(cost?.value, "3.7500 $");
  });

  it("groupe les milliers pour rester lisible", () => {
    assert.equal(formatTokens(15_000), ["15", "000"].join(THIN_SPACE));
    assert.equal(formatTokens(1_284_007), ["1", "284", "007"].join(THIN_SPACE));
    assert.equal(formatTokens(42), "42");
    assert.equal(formatTokens(-1), NOT_REPORTED);
    assert.equal(formatTokens(Number.NaN), NOT_REPORTED);
  });

  it("separe un echec de preuve d'une panne d'infrastructure", () => {
    const rows = verificationRows(metrics);

    assert.equal(rows.find((row) => row.label === "Échecs de preuve")?.value, "0");
    assert.equal(rows.find((row) => row.label === "Pannes de validation")?.value, "1");
  });

  it("dit explicitement ce que ces nombres ne mesurent pas", () => {
    assert.equal(METRICS_NOTICE.includes("pas un score"), true);
    assert.equal(METRICS_NOTICE.includes("taux"), true);
  });
});
