/**
 * Reparation de transport d'une tache d'amorcage deja creee.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'une `TASK-000` non terminee, construite a partir d'un etat produit qui n'a
 * pas bouge, recoit dans son prompt de correction la source canonique que son
 * contrat n'avait pas transportee.
 *
 * Que rien d'autre ne bouge : ni la tache, ni ses criteres, ni ses commandes, ni
 * son perimetre, ni les prompts des executions passees.
 *
 * Et que la porte est etroite. Un brief modifie depuis, un amorcage termine, une
 * tache ordinaire, un contexte ecrit a la main : chacun obtient un refus nomme,
 * jamais un supplement approximatif.
 *
 * Base temporaire, aucun runner, aucun fournisseur, aucun reseau.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BOOTSTRAP_SUPPLEMENT_HEADING,
  PROJECT_MEMORY_STATUS,
  TASK_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
  buildBootstrapTaskSpec,
  renderLegacyBootstrapSource,
  type ArchitectPromptMemory,
  type DevelopmentTaskDetail,
  type ProjectBriefInput,
  type ProjectMemoryEntry,
  type ProjectV1PlanInput,
  type RepositoryInspection,
} from "@nox/shared";
import {
  createDatabaseClient,
  createProject,
  createBootstrapTask,
  createProjectMemory,
  createTask,
  getTaskById,
  listActiveProjectMemories,
  loadProjectStructuredState,
  saveProjectBrief,
  setProjectMemoryStatus,
  saveProjectV1Plan,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
} from "@nox/database";

import { createArchitectSanitizer } from "../architect/sanitize.ts";
import { projectPlanTools } from "../project-plan.ts";

import { buildCorrectionPromptFor } from "../correction-prompt.ts";

import { prepareBootstrapSourceSupplement } from "./source-recovery.ts";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "packages",
  "database",
  "prisma",
  "migrations",
);

const ENVIRONMENT: Record<string, string | undefined> = {
  NOX_RUNNER_TOKEN: "jeton-de-test-0123456789",
};

const DIRECTION_TAIL = "FIN-DIRECTION-CANONIQUE-b71e";
const MEMORY_TAIL = "FIN-MEMOIRE-CANONIQUE-3d90";

function sized(length: number, tail: string): string {
  const filler = "texte de remplissage lisible et sans interet. ";
  return (
    filler.repeat(Math.ceil(length / filler.length)).slice(0, Math.max(0, length - tail.length)) +
    tail
  );
}

const BRIEF: ProjectBriefInput = {
  summary: "Un outil de consolidation des exports d'incidents.",
  problem: "Rien ne compare un site a l'ensemble des autres.",
  targetUsers: "Les responsables d'exploitation.",
  desiredOutcome: "Preparer une intervention avec le contexte du site.",
  goals: ["Consolider les exports"],
  nonGoals: ["Remplacer l'outil de ticketing"],
};

/** Une direction technique assez longue pour que l'ancien rendu la coupe. */
const PLAN: ProjectV1PlanInput = {
  goal: "Livrer une application locale de consolidation.",
  inScope: ["Import controle des classeurs"],
  outOfScope: ["Hebergement distant"],
  technicalDirection: sized(1_500, DIRECTION_TAIL),
  milestones: ["L'import fonctionne"],
};

const EMPTY_REPOSITORY: RepositoryInspection = {
  manifests: [],
  sourceDirectories: [],
  foundationalDocuments: [],
  hasCommits: false,
  rootEntryCount: 0,
  rootEntryCountTruncated: false,
};

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

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-bootstrap-recovery-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "nox.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

type Project = { id: string; name: string; repositoryPath: string };

async function newProject(): Promise<Project> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  return { id: project.id, name: project.name, repositoryPath: project.repositoryPath };
}

/** Un projet dote de son brief, de son plan et d'une entree de memoire longue. */
async function projectWithSource(): Promise<Project> {
  const project = await newProject();
  const tools = projectPlanTools(project.repositoryPath);
  await saveProjectBrief(db, { projectId: project.id, values: BRIEF, tools });
  await saveProjectV1Plan(db, { projectId: project.id, values: PLAN, tools });
  await createProjectMemory(db, {
    projectId: project.id,
    values: {
      status: PROJECT_MEMORY_STATUS.ACTIVE,
      category: "CONSTRAINT",
      title: "Structure obligatoire des classeurs importables",
      content: sized(1_200, MEMORY_TAIL),
      rationale: "Separer les erreurs de structure des erreurs de ligne.",
    },
    sanitize: tools.sanitize,
  });
  return project;
}

function promptMemories(
  project: Project,
  entries: readonly ProjectMemoryEntry[],
): ArchitectPromptMemory[] {
  const sanitize = createArchitectSanitizer({
    repositoryRoot: project.repositoryPath,
    environment: ENVIRONMENT,
  });
  return entries
    .filter((entry) => entry.status === PROJECT_MEMORY_STATUS.ACTIVE)
    .map((entry) => ({
      code: entry.code,
      category: entry.category,
      revision: "",
      title: sanitize(entry.title),
      content: sanitize(entry.content),
      rationale: entry.rationale === null ? null : sanitize(entry.rationale),
    }));
}

/**
 * Cree une `TASK-000` portant le contexte **lossy** de l'epoque.
 *
 * C'est le seul moyen honnete de tester la reparation : reconstruire une tache
 * avec le generateur d'aujourd'hui produirait une source integrale, donc rien a
 * reparer, donc un test qui ne prouverait rien.
 */
async function legacyBootstrapTask(project: Project): Promise<DevelopmentTaskDetail> {
  const structuredState = await loadProjectStructuredState(
    db,
    project.id,
    projectPlanTools(project.repositoryPath),
  );
  const memories = promptMemories(project, await listActiveProjectMemories(db, project.id));

  const built = buildBootstrapTaskSpec({
    projectName: project.name,
    brief: structuredState.brief.prompt,
    v1Plan: structuredState.plan.prompt,
    memories,
    upcomingTasks: [],
    inspection: EMPTY_REPOSITORY,
  });
  assert.ok(built.ok);

  const legacyContext = [
    "### Ce que cette tache est",
    "",
    `Projet : ${project.name}`,
    "",
    renderLegacyBootstrapSource({
      brief: structuredState.brief.prompt,
      v1Plan: structuredState.plan.prompt,
      memories,
    }),
    "",
    "### Taches produit a venir",
    "",
    "- TASK-001 · HIGH · DRAFT · Importer les classeurs — Consolider les exports.",
  ].join("\n\n");

  const created = await createBootstrapTask(db, {
    projectId: project.id,
    title: built.spec.title,
    objective: built.spec.objective,
    context: legacyContext,
    outOfScope: built.spec.outOfScope,
    priority: TASK_PRIORITY.HIGH,
    acceptanceCriteria: built.spec.acceptanceCriteria,
    documentReferences: [],
    validationCommands: [],
  });
  assert.ok(created.ok);

  const detail = await getTaskById(db, created.task.id);
  assert.ok(detail !== null);
  return detail;
}

async function supplementFor(
  project: Project,
  task: DevelopmentTaskDetail,
): Promise<ReturnType<typeof prepareBootstrapSourceSupplement>> {
  const [structuredState, memories] = await Promise.all([
    loadProjectStructuredState(db, project.id, projectPlanTools(project.repositoryPath)),
    listActiveProjectMemories(db, project.id),
  ]);

  return prepareBootstrapSourceSupplement({
    task,
    repositoryPath: project.repositoryPath,
    structuredState,
    memories,
    environment: ENVIRONMENT,
  });
}

describe("I. un amorcage non termine issu de la meme source recoit son supplement", () => {
  it("restitue la direction technique et le contenu de memoire tronques", async () => {
    const project = await projectWithSource();
    const task = await legacyBootstrapTask(project);

    // La tache porte bien une source amputee : sans cela, le test suivant
    // passerait pour une raison sans rapport.
    assert.equal((task.context ?? "").includes(DIRECTION_TAIL), false);
    assert.equal((task.context ?? "").includes(MEMORY_TAIL), false);

    const outcome = await supplementFor(project, task);

    assert.ok(outcome.ok);
    assert.ok(outcome.supplement.includes(BOOTSTRAP_SUPPLEMENT_HEADING));
    assert.ok(outcome.supplement.includes(PLAN.technicalDirection));
    assert.ok(outcome.supplement.includes(DIRECTION_TAIL));
    assert.ok(outcome.supplement.includes(MEMORY_TAIL));
  });

  it("nomme les champs qu'il restitue", async () => {
    const project = await projectWithSource();
    const outcome = await supplementFor(project, await legacyBootstrapTask(project));

    assert.ok(outcome.ok);
    assert.ok(outcome.missingFields.includes("plan.technicalDirection"));
    assert.ok(outcome.missingFields.some((field) => field.endsWith(".content")));
  });

  it("ne restitue rien quand la source de l'epoque tenait deja entiere", async () => {
    const project = await newProject();
    const tools = projectPlanTools(project.repositoryPath);
    await saveProjectBrief(db, { projectId: project.id, values: BRIEF, tools });
    await saveProjectV1Plan(db, {
      projectId: project.id,
      values: { ...PLAN, technicalDirection: "Une direction technique courte." },
      tools,
    });

    const outcome = await supplementFor(project, await legacyBootstrapTask(project));

    assert.equal(outcome.ok, false);
    assert.ok(!outcome.ok && outcome.reason === "already_complete");
  });
});

describe("J. rien d'autre ne bouge", () => {
  it("laisse la tache exactement telle qu'elle etait", async () => {
    const project = await projectWithSource();
    const task = await legacyBootstrapTask(project);
    const before = await getTaskById(db, task.id);

    const outcome = await supplementFor(project, task);
    assert.ok(outcome.ok);

    const now = await getTaskById(db, task.id);
    assert.deepEqual(now, before);
  });

  it("n'ecrit aucun critere, aucune commande et aucun perimetre nouveau", async () => {
    const project = await projectWithSource();
    const task = await legacyBootstrapTask(project);

    const outcome = await supplementFor(project, task);
    assert.ok(outcome.ok);

    const now = await getTaskById(db, task.id);
    assert.ok(now !== null);
    assert.deepEqual([...now.acceptanceCriteria], [...task.acceptanceCriteria]);
    assert.deepEqual([...now.validationCommands], [...task.validationCommands]);
    assert.equal(now.outOfScope, task.outOfScope);
    assert.equal(now.objective, task.objective);
    assert.equal(now.context, task.context);
  });

  it("laisse les prompts des executions passees octet pour octet", async () => {
    const project = await projectWithSource();
    const task = await legacyBootstrapTask(project);

    // Deux executions historiques, avec leur prompt tel qu'il est parti a
    // l'epoque : c'est ce texte-la qui ne doit jamais etre reecrit pour faire
    // croire qu'il portait la source complete.
    const historical = ["RUN-001 : prompt d'origine.", "RUN-002 : prompt de correction."];
    for (const [index, prompt] of historical.entries()) {
      await db.run.create({
        data: {
          taskId: task.id,
          sequence: index + 1,
          status: "COMPLETED",
          prompt,
          promptSha256: `sha-${String(index)}`,
          runnerRunId: `runner-${String(index)}`,
          updatedAt: new Date(),
        },
      });
    }

    const outcome = await supplementFor(project, task);
    assert.ok(outcome.ok);

    const rows = await db.run.findMany({
      where: { taskId: task.id },
      orderBy: { sequence: "asc" },
      select: { prompt: true },
    });
    assert.deepEqual(
      rows.map((row) => row.prompt),
      historical,
    );
  });
});

describe("le prompt de correction porte reellement le supplement", () => {
  it("le joint pour un amorcage abime, et pas pour une tache ordinaire", async () => {
    const project = await projectWithSource();
    const task = await legacyBootstrapTask(project);

    const bootstrap = await buildCorrectionPromptFor(db, {
      task,
      project,
      sourceRunCode: "RUN-002",
      feedback: "docs/V1_SCOPE.md s'arrete au milieu d'une phrase.",
      contract: null,
      evidence: null,
      environment: ENVIRONMENT,
    });

    assert.ok(bootstrap.supplement.ok);
    assert.ok(bootstrap.prompt.includes(BOOTSTRAP_SUPPLEMENT_HEADING));
    assert.ok(bootstrap.prompt.includes(DIRECTION_TAIL));
    assert.ok(bootstrap.prompt.includes(MEMORY_TAIL));

    const ordinary = await buildCorrectionPromptFor(db, {
      task: { ...task, kind: TASK_KIND.NORMAL },
      project,
      sourceRunCode: "RUN-002",
      feedback: "Un retour ordinaire.",
      contract: null,
      evidence: null,
      environment: ENVIRONMENT,
    });

    assert.equal(ordinary.supplement.ok, false);
    assert.equal(ordinary.prompt.includes(BOOTSTRAP_SUPPLEMENT_HEADING), false);
    assert.equal(ordinary.prompt.includes(DIRECTION_TAIL), false);
  });

  it("ne renegocie ni l'objectif, ni les criteres, ni le perimetre", async () => {
    const project = await projectWithSource();
    const task = await legacyBootstrapTask(project);

    const built = await buildCorrectionPromptFor(db, {
      task,
      project,
      sourceRunCode: "RUN-002",
      feedback: null,
      contract: null,
      evidence: null,
      environment: ENVIRONMENT,
    });
    assert.ok(built.supplement.ok);

    const start = built.prompt.indexOf(BOOTSTRAP_SUPPLEMENT_HEADING);
    const section = built.prompt.slice(start);

    // Le supplement annonce lui-meme ce qu'il ne touche pas, et n'introduit
    // aucun critere : ce sont deux choses differentes, et les deux comptent.
    assert.ok(section.includes("inchanges"));
    for (const criterion of task.acceptanceCriteria) {
      assert.equal(built.prompt.includes(criterion), false);
    }
  });
});

describe("le chemin de reparation n'ecrit rien", () => {
  it("ne contient aucune ecriture, ni dans la decision ni dans sa lecture", async () => {
    const directory = path.dirname(fileURLToPath(import.meta.url));

    for (const name of ["source-recovery.ts", "source-supplement.ts"]) {
      const body = (await readFile(path.join(directory, name), "utf8"))
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/\/\/.*$/gmu, "");

      for (const forbidden of [
        ".create(",
        ".update(",
        ".updateMany(",
        ".delete(",
        ".deleteMany(",
        ".upsert(",
        "$transaction",
        "$executeRaw",
      ]) {
        assert.equal(
          body.includes(forbidden),
          false,
          `« ${forbidden} » n'a rien a faire dans une reparation de transport (${name})`,
        );
      }
    }
  });
});

describe("K. une source qui a change refuse le supplement", () => {
  it("refuse apres une reecriture du plan de V1", async () => {
    const project = await projectWithSource();
    const task = await legacyBootstrapTask(project);

    await saveProjectV1Plan(db, {
      projectId: project.id,
      values: { ...PLAN, goal: "Un objectif de V1 entierement different." },
      tools: projectPlanTools(project.repositoryPath),
    });

    const outcome = await supplementFor(project, task);

    assert.equal(outcome.ok, false);
    assert.ok(!outcome.ok && outcome.reason === "source_changed");
  });

  it("refuse apres une reecriture du brief", async () => {
    const project = await projectWithSource();
    const task = await legacyBootstrapTask(project);

    await saveProjectBrief(db, {
      projectId: project.id,
      values: { ...BRIEF, summary: "Un resume produit entierement different." },
      tools: projectPlanTools(project.repositoryPath),
    });

    const outcome = await supplementFor(project, task);

    assert.equal(outcome.ok, false);
    assert.ok(!outcome.ok && outcome.reason === "source_changed");
  });

  it("refuse apres l'ajout d'une entree de memoire", async () => {
    const project = await projectWithSource();
    const task = await legacyBootstrapTask(project);

    await createProjectMemory(db, {
      projectId: project.id,
      values: {
        status: PROJECT_MEMORY_STATUS.ACTIVE,
        category: "DECISION",
        title: "Une regle durable posee apres coup",
        content: "Elle n'existait pas quand la tache a ete construite.",
        rationale: null,
      },
      sanitize: projectPlanTools(project.repositoryPath).sanitize,
    });

    const outcome = await supplementFor(project, task);

    assert.equal(outcome.ok, false);
    assert.ok(!outcome.ok && outcome.reason === "source_changed");
  });

  it("refuse un contexte qui ne vient pas du generateur", async () => {
    const project = await projectWithSource();
    const task = await legacyBootstrapTask(project);

    const outcome = await supplementFor(project, {
      ...task,
      context: "Un contexte ecrit a la main, sans les sections de l'amorcage.",
    });

    assert.equal(outcome.ok, false);
    assert.ok(!outcome.ok && outcome.reason === "not_generated");
  });
});

describe("L. une tache ordinaire est inchangee", () => {
  it("refuse le supplement sans regarder la source du projet", async () => {
    const project = await projectWithSource();
    const created = await createTask(db, {
      projectId: project.id,
      title: "Importer les classeurs",
      objective: "Consolider les exports Excel.",
      context: "Un contexte ordinaire.",
      outOfScope: null,
      priority: TASK_PRIORITY.HIGH,
      acceptanceCriteria: ["L'import fonctionne"],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(created !== null);
    const detail = await getTaskById(db, created.id);
    assert.ok(detail !== null);

    const outcome = await supplementFor(project, detail);

    assert.equal(outcome.ok, false);
    assert.ok(!outcome.ok && outcome.reason === "not_bootstrap");
  });
});

describe("M. un amorcage termine ne se repare pas", () => {
  it("refuse le supplement sur une tache COMPLETED", async () => {
    const project = await projectWithSource();
    const task = await legacyBootstrapTask(project);

    const outcome = await supplementFor(project, {
      ...task,
      status: TASK_STATUS.COMPLETED,
    });

    assert.equal(outcome.ok, false);
    assert.ok(!outcome.ok && outcome.reason === "task_completed");
  });
});

describe("N. la memoire archivee reste exclue", () => {
  it("ne la transporte pas, et ne la compte pas comme un changement", async () => {
    const project = await projectWithSource();
    const archived = await createProjectMemory(db, {
      projectId: project.id,
      values: {
        status: PROJECT_MEMORY_STATUS.ACTIVE,
        category: "DECISION",
        title: "Une regle qui ne s'applique plus",
        content: "REGLE-ARCHIVEE-NE-DOIT-PAS-PARTIR",
        rationale: null,
      },
      sanitize: projectPlanTools(project.repositoryPath).sanitize,
    });
    assert.ok(archived.ok);
    await setProjectMemoryStatus(db, {
      memoryId: archived.entry.id,
      status: PROJECT_MEMORY_STATUS.ARCHIVED,
      sanitize: projectPlanTools(project.repositoryPath).sanitize,
    });

    const task = await legacyBootstrapTask(project);
    const outcome = await supplementFor(project, task);

    assert.ok(outcome.ok);
    assert.equal(outcome.supplement.includes("REGLE-ARCHIVEE-NE-DOIT-PAS-PARTIR"), false);
  });
});
