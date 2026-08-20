/**
 * Amorcage d'un projet, de bout en bout.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'aucune etape n'appelle un fournisseur. Il n'y a meme pas de fournisseur a
 * injecter ici : le service n'en prend aucun, et c'est la garantie la plus
 * solide qu'on puisse offrir — pas un compteur a zero, une absence de chemin.
 *
 * Que les preconditions sont verifiees **avant** de faire travailler le runner,
 * et qu'elles sont toutes nommees.
 *
 * Que la peremption ferme la porte : un plan, une memoire, un inventaire ou un
 * repository modifie entre l'apercu et la creation refuse la creation, sans
 * fusion et sans « creer quand meme ».
 *
 * Et qu'une creation ne touche a rien d'autre : ni compteur, ni tache
 * existante, ni execution.
 *
 * Base temporaire, ports de repository simules : aucun appel reseau.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BOOTSTRAP_TASK_CODE,
  PROJECT_MEMORY_STATUS,
  REPOSITORY_SHAPE,
  TASK_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
  type ProjectBriefInput,
  type ProjectV1PlanInput,
  type RepositoryInspection,
} from "@nox/shared";
import {
  createDatabaseClient,
  createProject,
  createProjectMemory,
  createTask,
  listActiveProjectMemories,
  listTaskObjectives,
  listTasksByProject,
  loadProjectStructuredState,
  peekNextTaskSequence,
  saveProjectBrief,
  saveProjectV1Plan,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
} from "@nox/database";

import { projectPlanTools } from "../project-plan.ts";
import {
  bootstrapBlockers,
  createProjectBootstrapTask,
  prepareBootstrapPreview,
  type BootstrapProjectInput,
  type BootstrapRepositoryPorts,
} from "./service.ts";

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

let workspace: string;
let db: DatabaseClient;
let counter = 0;

const ENVIRONMENT: Record<string, string | undefined> = {
  NOX_RUNNER_TOKEN: "jeton-de-test-0123456789",
};

const BRIEF: ProjectBriefInput = {
  summary: "Un suivi de lectures personnel.",
  problem: "Rien ne centralise ce que je lis.",
  targetUsers: "Moi seul.",
  desiredOutcome: "Savoir ce que j'ai lu cette annee.",
  goals: ["Enregistrer un livre"],
  nonGoals: ["Reseau social"],
};

const PLAN: ProjectV1PlanInput = {
  goal: "Suivre une annee de lectures.",
  inScope: ["Liste des livres"],
  outOfScope: ["Application mobile"],
  technicalDirection: "Application web simple ; stockage local ou backend minimal.",
  milestones: ["La liste est utilisable"],
};

const EMPTY_REPOSITORY: RepositoryInspection = {
  manifests: [],
  sourceDirectories: [],
  foundationalDocuments: [],
  hasCommits: false,
  rootEntryCount: 0,
  rootEntryCountTruncated: false,
};

const EXISTING_REPOSITORY: RepositoryInspection = {
  manifests: ["package.json"],
  sourceDirectories: ["src"],
  foundationalDocuments: ["README.md"],
  hasCommits: true,
  rootEntryCount: 9,
  rootEntryCountTruncated: false,
};

/** Ports qui rendent une inspection donnee, et comptent leurs appels. */
function ports(inspection: RepositoryInspection = EMPTY_REPOSITORY): BootstrapRepositoryPorts & {
  calls: number;
} {
  const state = {
    calls: 0,
    inspect: (_repositoryPath: string) => {
      state.calls += 1;
      return Promise.resolve({ ok: true as const, value: inspection });
    },
  };
  return state;
}

/** Ports d'un runner arrete. */
function brokenPorts(): BootstrapRepositoryPorts & { calls: number } {
  const state = {
    calls: 0,
    inspect: (_repositoryPath: string) => {
      state.calls += 1;
      return Promise.resolve({
        ok: false as const,
        failure: { kind: "unreachable" as const, message: "Runner injoignable." },
      });
    },
  };
  return state as unknown as BootstrapRepositoryPorts & { calls: number };
}

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

async function newProject(): Promise<{ id: string; name: string; repositoryPath: string }> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  return { id: project.id, name: project.name, repositoryPath: project.repositoryPath };
}

/**
 * Assemble l'entree du service, exactement comme la page le fait.
 *
 * `appliedBacklogCount` est passe explicitement : ce test n'a pas besoin
 * d'appliquer un vrai backlog pour verifier la precondition, et le faire
 * ajouterait une dependance sans rapport avec ce qui est teste.
 */
async function input(
  project: { id: string; name: string; repositoryPath: string },
  overrides: Partial<BootstrapProjectInput> = {},
): Promise<BootstrapProjectInput> {
  const [tasks, objectives, memories, structuredState] = await Promise.all([
    listTasksByProject(db, project.id),
    listTaskObjectives(db, project.id),
    listActiveProjectMemories(db, project.id),
    loadProjectStructuredState(db, project.id, projectPlanTools(project.repositoryPath)),
  ]);

  return {
    projectId: project.id,
    projectName: project.name,
    repositoryPath: project.repositoryPath,
    tasks,
    objectives,
    memories,
    structuredState,
    appliedBacklogCount: 1,
    existingTask: null,
    environment: ENVIRONMENT,
    ...overrides,
  };
}

async function withBriefAndPlan(): Promise<{ id: string; name: string; repositoryPath: string }> {
  const project = await newProject();
  const tools = projectPlanTools(project.repositoryPath);
  await saveProjectBrief(db, { projectId: project.id, values: BRIEF, tools });
  await saveProjectV1Plan(db, { projectId: project.id, values: PLAN, tools });
  return project;
}

async function addTask(projectId: string, title: string): Promise<void> {
  await createTask(db, {
    projectId,
    title,
    objective: `Objectif de ${title}.`,
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: [`${title} est verifiable`],
    documentReferences: [],
    validationCommands: [],
  });
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-bootstrap-service-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("preconditions", () => {
  it("nomme les trois manquants d'un projet vierge", async () => {
    const project = await newProject();
    const blockers = bootstrapBlockers(await input(project, { appliedBacklogCount: 0 }));
    assert.deepEqual(blockers, ["brief_missing", "plan_missing", "backlog_missing"]);
  });

  it("ne bloque plus sur le brief une fois qu'il existe", async () => {
    const project = await newProject();
    await saveProjectBrief(db, {
      projectId: project.id,
      values: BRIEF,
      tools: projectPlanTools(project.repositoryPath),
    });
    const blockers = bootstrapBlockers(await input(project, { appliedBacklogCount: 0 }));
    assert.deepEqual(blockers, ["plan_missing", "backlog_missing"]);
  });

  it("bloque encore sur le backlog quand brief et plan existent", async () => {
    const project = await withBriefAndPlan();
    const blockers = bootstrapBlockers(await input(project, { appliedBacklogCount: 0 }));
    assert.deepEqual(blockers, ["backlog_missing"]);
  });

  it("ne bloque plus rien quand tout est reuni", async () => {
    const project = await withBriefAndPlan();
    assert.deepEqual(bootstrapBlockers(await input(project)), []);
  });

  it("ne fait pas travailler le runner quand une precondition manque", async () => {
    const project = await newProject();
    const repository = ports();
    const preview = await prepareBootstrapPreview(
      await input(project, { appliedBacklogCount: 0 }),
      repository,
    );

    assert.ok(!preview.ok);
    assert.equal(repository.calls, 0, "aucune inspection inutile");
  });

  it("signale un repository injoignable, sans le confondre avec autre chose", async () => {
    const project = await withBriefAndPlan();
    const preview = await prepareBootstrapPreview(await input(project), brokenPorts());

    assert.ok(!preview.ok);
    assert.deepEqual(preview.blockers, ["repository_unreachable"]);
  });
});

describe("apercu", () => {
  it("construit TASK-000 a partir de l'etat du projet", async () => {
    const project = await withBriefAndPlan();
    await addTask(project.id, "Poser le domaine");

    const preview = await prepareBootstrapPreview(await input(project), ports());
    assert.ok(preview.ok);

    const { spec } = preview.context;
    assert.equal(spec.title, "Bootstrap project repository and foundational documentation");
    assert.ok(spec.context.includes("Suivre une annee de lectures."));
    assert.ok(spec.context.includes("TASK-001"));
  });

  it("ne lit le repository qu'une fois", async () => {
    const project = await withBriefAndPlan();
    const repository = ports();
    await prepareBootstrapPreview(await input(project), repository);
    assert.equal(repository.calls, 1);
  });

  it("n'ecrit rien : aucune tache, aucun compteur consomme", async () => {
    const project = await withBriefAndPlan();
    const before = await peekNextTaskSequence(db, project.id);

    await prepareBootstrapPreview(await input(project), ports());

    assert.equal((await listTasksByProject(db, project.id)).length, 0);
    assert.equal(await peekNextTaskSequence(db, project.id), before);
  });

  it("reflete un repository existant", async () => {
    const project = await withBriefAndPlan();
    const preview = await prepareBootstrapPreview(
      await input(project),
      ports(EXISTING_REPOSITORY),
    );

    assert.ok(preview.ok);
    assert.equal(preview.context.spec.shape, REPOSITORY_SHAPE.APPLICATION);
    assert.ok(preview.context.spec.context.includes("ne remplace pas une pile technique en place"));
  });

  it("reflete un repository vide", async () => {
    const project = await withBriefAndPlan();
    const preview = await prepareBootstrapPreview(await input(project), ports(EMPTY_REPOSITORY));

    assert.ok(preview.ok);
    assert.equal(preview.context.spec.shape, REPOSITORY_SHAPE.EMPTY);
    assert.ok(preview.context.spec.context.includes("choisis la solution **minimale**"));
  });

  it("porte la memoire active, et elle seule", async () => {
    const project = await withBriefAndPlan();
    await createProjectMemory(db, {
      projectId: project.id,
      values: {
        category: "CONSTRAINT",
        title: "Aucune dependance payante",
        content: "Le projet tourne sans service payant.",
        rationale: null,
        status: PROJECT_MEMORY_STATUS.ACTIVE,
      },
      sanitize: (value) => value,
    });
    await createProjectMemory(db, {
      projectId: project.id,
      values: {
        category: "DECISION",
        title: "Une idee abandonnee",
        content: "Ne doit pas partir.",
        rationale: null,
        status: PROJECT_MEMORY_STATUS.ARCHIVED,
      },
      sanitize: (value) => value,
    });

    const preview = await prepareBootstrapPreview(await input(project), ports());
    assert.ok(preview.ok);
    assert.equal(preview.context.memories.length, 1);
    assert.ok(preview.context.spec.context.includes("Aucune dependance payante"));
    assert.equal(preview.context.spec.context.includes("Une idee abandonnee"), false);
  });

  it("rend deux fois la meme empreinte pour le meme etat", async () => {
    const project = await withBriefAndPlan();
    const first = await prepareBootstrapPreview(await input(project), ports());
    const second = await prepareBootstrapPreview(await input(project), ports());
    assert.ok(first.ok && second.ok);
    assert.equal(first.context.fingerprint, second.context.fingerprint);
  });
});

describe("creation", () => {
  it("cree TASK-000 en DRAFT, de nature BOOTSTRAP", async () => {
    const project = await withBriefAndPlan();
    const repository = ports();
    const prepared = await prepareBootstrapPreview(await input(project), repository);
    assert.ok(prepared.ok);

    const created = await createProjectBootstrapTask(
      db,
      await input(project),
      prepared.context.fingerprint,
      repository,
    );

    assert.ok(created.ok);
    assert.equal(created.task.code, BOOTSTRAP_TASK_CODE);
    assert.equal(created.task.kind, TASK_KIND.BOOTSTRAP);
    assert.equal(created.task.status, TASK_STATUS.DRAFT);
  });

  it("ne consomme aucun numero de tache", async () => {
    const project = await withBriefAndPlan();
    await addTask(project.id, "Une tache");
    await addTask(project.id, "Une autre");

    const before = await peekNextTaskSequence(db, project.id);
    assert.equal(before, 3);

    const repository = ports();
    const prepared = await prepareBootstrapPreview(await input(project), repository);
    assert.ok(prepared.ok);
    const created = await createProjectBootstrapTask(
      db,
      await input(project),
      prepared.context.fingerprint,
      repository,
    );
    assert.ok(created.ok);

    assert.equal(await peekNextTaskSequence(db, project.id), 3);
  });

  it("laisse les taches existantes intactes", async () => {
    const project = await withBriefAndPlan();
    await addTask(project.id, "Une tache");

    const before = await listTasksByProject(db, project.id);
    const repository = ports();
    const prepared = await prepareBootstrapPreview(await input(project), repository);
    assert.ok(prepared.ok);
    await createProjectBootstrapTask(db, await input(project), prepared.context.fingerprint, repository);

    const after = (await listTasksByProject(db, project.id)).filter(
      (task) => task.kind !== TASK_KIND.BOOTSTRAP,
    );
    assert.deepEqual(after, before);
  });

  it("refuse la seconde creation", async () => {
    const project = await withBriefAndPlan();
    const repository = ports();
    const prepared = await prepareBootstrapPreview(await input(project), repository);
    assert.ok(prepared.ok);

    const first = await createProjectBootstrapTask(
      db,
      await input(project),
      prepared.context.fingerprint,
      repository,
    );
    assert.ok(first.ok);

    const second = await createProjectBootstrapTask(
      db,
      await input(project, { existingTask: first.task }),
      prepared.context.fingerprint,
      repository,
    );
    assert.ok(!second.ok);
    assert.equal(second.reason, "already_exists");
  });

  it("refuse aussi quand l'entree n'a pas vu la tache existante", async () => {
    // Le garde-fou applicatif peut manquer la tache ; la contrainte d'unicite,
    // elle, ne la manque jamais.
    const project = await withBriefAndPlan();
    const repository = ports();
    const prepared = await prepareBootstrapPreview(await input(project), repository);
    assert.ok(prepared.ok);

    assert.ok(
      (
        await createProjectBootstrapTask(
          db,
          await input(project),
          prepared.context.fingerprint,
          repository,
        )
      ).ok,
    );

    const second = await createProjectBootstrapTask(
      db,
      await input(project, { existingTask: null }),
      prepared.context.fingerprint,
      repository,
    );
    assert.ok(!second.ok);
    assert.equal(second.reason, "already_exists");
  });
});

describe("peremption", () => {
  async function stale(
    project: { id: string; name: string; repositoryPath: string },
    change: () => Promise<void>,
    repository: BootstrapRepositoryPorts = ports(),
  ): Promise<void> {
    const prepared = await prepareBootstrapPreview(await input(project), repository);
    assert.ok(prepared.ok);

    await change();

    const created = await createProjectBootstrapTask(
      db,
      await input(project),
      prepared.context.fingerprint,
      repository,
    );

    assert.ok(!created.ok);
    assert.equal(created.reason, "stale");
    assert.equal((await listTasksByProject(db, project.id)).filter((t) => t.kind === TASK_KIND.BOOTSTRAP).length, 0);
  }

  it("refuse quand le plan a change", async () => {
    const project = await withBriefAndPlan();
    await stale(project, async () => {
      await saveProjectV1Plan(db, {
        projectId: project.id,
        values: { ...PLAN, goal: "Un autre objectif de V1." },
        tools: projectPlanTools(project.repositoryPath),
      });
    });
  });

  it("refuse quand le brief a change", async () => {
    const project = await withBriefAndPlan();
    await stale(project, async () => {
      await saveProjectBrief(db, {
        projectId: project.id,
        values: { ...BRIEF, summary: "Un autre resume." },
        tools: projectPlanTools(project.repositoryPath),
      });
    });
  });

  it("refuse quand la memoire active a change", async () => {
    const project = await withBriefAndPlan();
    await stale(project, async () => {
      await createProjectMemory(db, {
        projectId: project.id,
        values: {
          category: "CONSTRAINT",
          title: "Nouvelle contrainte",
          content: "Ajoutee apres l'apercu.",
          rationale: null,
          status: PROJECT_MEMORY_STATUS.ACTIVE,
        },
        sanitize: (value) => value,
      });
    });
  });

  it("refuse quand une tache est apparue", async () => {
    const project = await withBriefAndPlan();
    await stale(project, async () => {
      await addTask(project.id, "Tache apparue entre-temps");
    });
  });

  it("refuse quand le repository a change", async () => {
    // Le cas dangereux : une application est apparue entre l'apercu et le clic.
    // Creer la tache « choisis une pile » la detruirait.
    const project = await withBriefAndPlan();
    const repository = ports();
    const prepared = await prepareBootstrapPreview(await input(project), repository);
    assert.ok(prepared.ok);
    assert.equal(prepared.context.spec.shape, REPOSITORY_SHAPE.EMPTY);

    const created = await createProjectBootstrapTask(
      db,
      await input(project),
      prepared.context.fingerprint,
      ports(EXISTING_REPOSITORY),
    );

    assert.ok(!created.ok);
    assert.equal(created.reason, "stale");
  });

  it("accepte quand rien n'a change", async () => {
    const project = await withBriefAndPlan();
    const repository = ports();
    const prepared = await prepareBootstrapPreview(await input(project), repository);
    assert.ok(prepared.ok);

    const created = await createProjectBootstrapTask(
      db,
      await input(project),
      prepared.context.fingerprint,
      repository,
    );
    assert.ok(created.ok);
  });

  it("refuse une empreinte inventee", async () => {
    const project = await withBriefAndPlan();
    const created = await createProjectBootstrapTask(
      db,
      await input(project),
      "0".repeat(64),
      ports(),
    );
    assert.ok(!created.ok);
    assert.equal(created.reason, "stale");
  });
});

describe("aucun fournisseur, aucune execution", () => {
  it("le service n'importe aucun fournisseur ni aucune fonction d'execution", async () => {
    const source = await readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "service.ts"),
      "utf8",
    );

    // La garantie n'est pas une intention : ces symboles ne sont pas
    // atteignables depuis ce module, et un ajout futur ferait echouer ce test.
    for (const forbidden of [
      "OpenAIArchitectProvider",
      "ArchitectProvider",
      "generateBacklog",
      "startClaudeRun",
      "startTaskExecution",
      "createRun",
      "openai",
    ]) {
      assert.ok(!source.includes(forbidden), forbidden);
    }
  });

  it("ne cree ni memoire, ni message, ni mise a jour de projet", async () => {
    const project = await withBriefAndPlan();
    const repository = ports();
    const prepared = await prepareBootstrapPreview(await input(project), repository);
    assert.ok(prepared.ok);
    await createProjectBootstrapTask(db, await input(project), prepared.context.fingerprint, repository);

    assert.equal(await db.projectMemoryEntry.count({ where: { projectId: project.id } }), 0);
    assert.equal(await db.architectProjectUpdate.count({ where: { projectId: project.id } }), 0);
    assert.equal(await db.architectSession.count({ where: { projectId: project.id } }), 0);
  });

  it("ne lance aucune execution", async () => {
    const project = await withBriefAndPlan();
    const repository = ports();
    const prepared = await prepareBootstrapPreview(await input(project), repository);
    assert.ok(prepared.ok);
    const created = await createProjectBootstrapTask(
      db,
      await input(project),
      prepared.context.fingerprint,
      repository,
    );
    assert.ok(created.ok);

    assert.equal(await db.run.count({ where: { taskId: created.task.id } }), 0);
  });
});
