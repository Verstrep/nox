/**
 * Planification d'un backlog, de bout en bout.
 *
 * ## Ce que ce fichier prouve
 *
 * Que **un Generate vaut au plus un appel** : chaque refus — plan absent,
 * planification en vol, proposition en attente — est constate avant que la
 * moindre requete ne parte, et le faux fournisseur le confirme en comptant zero.
 *
 * Que le contexte transmis contient bien le brief, le plan, la memoire, les
 * taches existantes et les documents autorises — et **aucune conversation**.
 *
 * Que l'humain peut editer, reordonner et retirer avant d'appliquer, et que
 * c'est sa version qui est creee.
 *
 * Base temporaire, faux fournisseur, ports de repository simules : aucun appel
 * reseau, aucun quota consomme.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHITECT_BACKLOG_FAILURE,
  ARCHITECT_BACKLOG_GENERATION_STATUS,
  ARCHITECT_BACKLOG_LIMITS,
  ARCHITECT_BACKLOG_MAX_OUTPUT_TOKENS,
  ARCHITECT_BACKLOG_SCHEMA_NAME_3,
  ARCHITECT_BACKLOG_SCHEMA_VERSION,
  ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
  COMMAND_EXECUTION_MODE,
  VERIFICATION_MODE,
  ARCHITECT_ERROR,
  PROJECT_MEMORY_STATUS,
  TASK_PRIORITY,
  TASK_STATUS,
  type ProjectBriefInput,
  type ProjectV1PlanInput,
} from "@nox/shared";
import {
  cancelBacklogGeneration,
  createDatabaseClient,
  createProject,
  createProjectMemory,
  createTask,
  getBacklogProposal,
  listActiveProjectMemories,
  listTaskObjectives,
  listTasksByProject,
  loadProjectBacklog,
  loadProjectStructuredState,
  saveProjectBrief,
  saveProjectV1Plan,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
  readVerificationPlan,
} from "@nox/database";

import {
  abortArchitectCall,
  activeArchitectCallCount,
} from "../architect/cancellation.ts";
import { ARCHITECT_HARD_TIMEOUT_MS } from "../architect/config.ts";
import {
  FakeArchitectProvider,
  fakeProviderSuccess,
  type ArchitectProvider,
  type ArchitectProviderInput,
  type ArchitectProviderResult,
} from "../architect/provider.ts";
import type { ArchitectRepositoryPorts } from "../architect/service.ts";
import { projectPlanTools } from "../project-plan.ts";
import type { TaskEditFormValues } from "../task-edit.ts";
import {
  applyProjectBacklog,
  backlogProposalToFormValues,
  dismissProjectBacklog,
  generateProjectBacklog,
  isBacklogProposalStale,
  prepareProjectBacklog,
  type BacklogProjectInput,
  type BacklogReviewItem,
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
  NOX_OPENAI_API_KEY: "cle-architecte-de-test-9876543210",
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
  technicalDirection: "Application web simple.",
  milestones: ["La liste est utilisable", "Les statistiques sont lisibles"],
};

function ports(): ArchitectRepositoryPorts {
  const revision = "a".repeat(64);
  return {
    listDocuments: () =>
      Promise.resolve({
        ok: true,
        value: [
          {
            path: "docs/ARCHITECTURE.md",
            name: "ARCHITECTURE.md",
            category: "DOCUMENTATION",
            size: 10,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    readDocument: (_repository, documentPath) =>
      Promise.resolve({
        ok: true,
        value: { path: documentPath, content: `# ${documentPath}`, revision },
      }),
  };
}

/** Ports d'un runner arrete : l'inventaire est bloquant, tout le reste suit. */
function brokenPorts(): ArchitectRepositoryPorts {
  return {
    listDocuments: () =>
      Promise.resolve({ ok: false, failure: { kind: "unreachable" } as never }),
    readDocument: () =>
      Promise.resolve({ ok: false, failure: { kind: "unreachable" } as never }),
  };
}

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

type Project = { id: string; repositoryPath: string };

async function newProject(options: { plan?: boolean; brief?: boolean } = {}): Promise<Project> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });

  const tools = projectPlanTools(project.repositoryPath);
  if (options.brief !== false) {
    await saveProjectBrief(db, { projectId: project.id, values: BRIEF, tools });
  }
  if (options.plan !== false) {
    await saveProjectV1Plan(db, { projectId: project.id, values: PLAN, tools });
  }

  return { id: project.id, repositoryPath: project.repositoryPath };
}

/** Assemble l'entree du service exactement comme la Server Action le fait. */
async function inputFor(
  project: Project,
  overrides: Partial<BacklogProjectInput> = {},
): Promise<BacklogProjectInput> {
  const [tasks, objectives, memories, structuredState] = await Promise.all([
    listTasksByProject(db, project.id),
    listTaskObjectives(db, project.id),
    listActiveProjectMemories(db, project.id),
    loadProjectStructuredState(db, project.id, projectPlanTools(project.repositoryPath)),
  ]);

  return {
    projectId: project.id,
    projectName: "Projet de test",
    repositoryPath: project.repositoryPath,
    tasks,
    objectives,
    memories,
    structuredState,
    model: "modele-de-test",
    environment: ENVIRONMENT,
    ports: ports(),
    ...overrides,
  };
}

/** Un backlog brut, tel qu'un fournisseur le rendrait. */
function backlogPayload(
  titles: readonly string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
    message: "Ce decoupage couvre les deux etapes du plan.",
    tasks: titles.map((title) => ({
      title,
      priority: TASK_PRIORITY.MEDIUM,
      objective: `Objectif de ${title}.`,
      context: null,
      acceptanceCriteria: [
        {
          text: `${title} est verifiable`,
          verificationMode: VERIFICATION_MODE.HUMAN,
          humanInstructions: "Verifier a la main.",
          validationCommandIndexes: [],
        },
      ],
      outOfScope: [],
      documentReferences: [],
      validationCommands: [],
    })),
    ...overrides,
  };
}

/** Le meme backlog, ecrit dans le contrat historique `backlog/1`. */
function backlogPayloadV1(
  titles: readonly string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION,
    message: "Ce decoupage couvre les deux etapes du plan.",
    tasks: titles.map((title) => ({
      title,
      priority: TASK_PRIORITY.MEDIUM,
      objective: `Objectif de ${title}.`,
      context: null,
      acceptanceCriteria: [`${title} est verifiable`],
      outOfScope: [],
      documentReferences: [],
      validationCommands: [],
    })),
    ...overrides,
  };
}

function respond(raw: unknown): ArchitectProviderResult {
  return fakeProviderSuccess(raw);
}

/** Valeurs de formulaire pour un titre donne, sans rien d'autre. */
function item(
  title: string,
  overrides: Partial<BacklogReviewItem> = {},
): BacklogReviewItem {
  return {
    title,
    priority: TASK_PRIORITY.MEDIUM,
    objective: `Objectif de ${title}.`,
    context: "",
    outOfScope: "",
    documents: "",
    criteria: [
      {
        key: "c0",
        text: `${title} est verifiable`,
        verificationMode: VERIFICATION_MODE.HUMAN,
        humanInstructions: "Verifier a la main.",
        commandKeys: [],
      },
    ],
    commands: [],
    dependsOnTaskIds: [],
    dependsOnPositions: [],
    ...overrides,
  };
}

/** Une ligne de commande de formulaire. */
function commandRow(
  key: string,
  command: string,
  executionMode: string,
): TaskEditFormValues["commands"][number] {
  return { key, command, executionMode };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-backlog-service-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("un Generate = au plus un appel", () => {
  it("appelle exactement une fois quand tout est en place", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A", "B"]))]);

    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });

    assert.ok(generated.ok);
    assert.equal(provider.backlogCalls.length, 1);
    assert.equal(provider.turnCalls.length, 0, "aucune surface conversationnelle n'est touchee");
    assert.equal(provider.reviewCalls.length, 0);
  });

  it("n'appelle pas quand le plan de V1 n'est pas defini", async () => {
    const project = await newProject({ plan: false });
    const provider = new FakeArchitectProvider([]);

    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });

    assert.equal(generated.ok, false);
    assert.ok(!generated.ok && "refusal" in generated && generated.refusal === "no_plan");
    assert.equal(provider.calls.length, 0, "zero appel");
  });

  it("n'appelle pas quand une proposition attend deja une decision", async () => {
    const project = await newProject();
    const first = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    await generateProjectBacklog(db, { ...(await inputFor(project)), provider: first });

    const second = new FakeArchitectProvider([]);
    const refused = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider: second,
    });

    assert.equal(refused.ok, false);
    assert.ok(!refused.ok && "refusal" in refused && refused.refusal === "pending_proposal");
    assert.equal(second.calls.length, 0, "zero appel");
  });

  it("ne produit qu'un appel et qu'une proposition pour deux clics simultanes", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      respond(backlogPayload(["A"])),
      respond(backlogPayload(["B"])),
    ]);

    const input = await inputFor(project);
    const results = await Promise.all([
      generateProjectBacklog(db, { ...input, provider }),
      generateProjectBacklog(db, { ...input, provider }),
    ]);

    assert.equal(results.filter((result) => result.ok).length, 1, "une seule generation aboutit");
    assert.equal(provider.backlogCalls.length, 1, "un seul appel part");

    const view = await loadProjectBacklog(db, project.id);
    assert.ok(view.pending !== null);
  });

  it("ne persiste rien quand le fournisseur echoue, et rend la main", async () => {
    const project = await newProject();
    const failing = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_TIMEOUT },
    ]);

    const failed = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider: failing,
    });
    assert.equal(failed.ok, false);
    assert.ok(!failed.ok && "code" in failed && failed.code === ARCHITECT_ERROR.ARCHITECT_TIMEOUT);

    const view = await loadProjectBacklog(db, project.id);
    assert.equal(view.pending, null, "aucune proposition applicable");
    assert.equal(view.running, null, "le verrou a ete rendu");

    const retry = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    const again = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider: retry,
    });
    assert.ok(again.ok, "Generate redevient possible");
  });
});

describe("contrat backlog/2", () => {
  it("refuse une reponse ecrite dans le contrat historique", async () => {
    // Une generation d'aujourd'hui demande `backlog/2`. Une reponse en
    // `backlog/1` n'est pas relevee au vol : elle ne porte aucune
    // classification, et l'accepter reviendrait a en inventer une.
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayloadV1(["A"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });

    assert.equal(generated.ok, false);
    assert.ok(
      !generated.ok &&
        "code" in generated &&
        generated.code === ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
    );
    assert.equal((await loadProjectBacklog(db, project.id)).pending, null, "rien de persiste");
  });

  it("conserve la classification jusqu'aux taches creees", async () => {
    const project = await newProject();
    const payload = backlogPayload(["A"]);
    const tasks = payload["tasks"] as Record<string, unknown>[];
    const first = tasks[0];
    assert.ok(first !== undefined);
    first["validationCommands"] = [
      { command: "npm test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
    ];
    first["acceptanceCriteria"] = [
      {
        text: "La suite de tests passe.",
        verificationMode: VERIFICATION_MODE.AUTOMATED,
        humanInstructions: null,
        validationCommandIndexes: [0],
      },
    ];

    const provider = new FakeArchitectProvider([respond(payload)]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    const applied = await applyProjectBacklog(db, {
      ...(await inputFor(project)),
      proposalId: generated.proposal.id,
      items: backlogProposalToFormValues(generated.proposal.provided),
    });
    assert.ok(applied.ok);

    const created = applied.tasks[0];
    assert.ok(created !== undefined);
    const plan = await readVerificationPlan(db, created.id);
    assert.equal(plan.criteria[0]?.verificationMode, VERIFICATION_MODE.AUTOMATED);
    assert.equal(plan.commands[0]?.executionMode, COMMAND_EXECUTION_MODE.AUTONOMOUS);
    assert.deepEqual(plan.criteria[0]?.commandIds, [plan.commands[0]?.id]);
  });

  it("applique la correction humaine, pas la proposition du fournisseur", async () => {
    // Le fournisseur declare le critere automatise ; l'humain le ramene a la
    // main. C'est sa version qui doit atteindre la base.
    const project = await newProject();
    const payload = backlogPayload(["A"]);
    const tasks = payload["tasks"] as Record<string, unknown>[];
    const first = tasks[0];
    assert.ok(first !== undefined);
    first["validationCommands"] = [
      { command: "npm test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
    ];
    first["acceptanceCriteria"] = [
      {
        text: "L'ecran est lisible.",
        verificationMode: VERIFICATION_MODE.AUTOMATED,
        humanInstructions: null,
        validationCommandIndexes: [0],
      },
    ];

    const provider = new FakeArchitectProvider([respond(payload)]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    const corrected = backlogProposalToFormValues(generated.proposal.provided).map((values) => ({
      ...values,
      criteria: values.criteria.map((row) => ({
        ...row,
        verificationMode: VERIFICATION_MODE.HUMAN,
        humanInstructions: "Ouvrir la page et regarder.",
        commandKeys: [],
      })),
    }));

    const applied = await applyProjectBacklog(db, {
      ...(await inputFor(project)),
      proposalId: generated.proposal.id,
      items: corrected,
    });
    assert.ok(applied.ok);

    const created = applied.tasks[0];
    assert.ok(created !== undefined);
    const plan = await readVerificationPlan(db, created.id);
    assert.equal(plan.criteria[0]?.verificationMode, VERIFICATION_MODE.HUMAN);
    assert.equal(plan.criteria[0]?.humanInstructions, "Ouvrir la page et regarder.");
    assert.deepEqual(plan.criteria[0]?.commandIds, []);

    // La proposition du fournisseur reste ce qu'elle etait ; ce qui a ete
    // retenu est enregistre a cote.
    assert.equal(
      applied.proposal.provided.tasks[0]?.acceptanceCriteria[0]?.verificationMode,
      VERIFICATION_MODE.AUTOMATED,
    );
    assert.equal(
      applied.proposal.applied?.tasks[0]?.acceptanceCriteria[0]?.verificationMode,
      VERIFICATION_MODE.HUMAN,
    );
  });

  it("refuse une preuve qui n'est pas une commande autonome", async () => {
    const project = await newProject();
    const payload = backlogPayload(["A"]);
    const tasks = payload["tasks"] as Record<string, unknown>[];
    const first = tasks[0];
    assert.ok(first !== undefined);
    first["validationCommands"] = [
      { command: "npm test", executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY },
    ];
    first["acceptanceCriteria"] = [
      {
        text: "La suite passe.",
        verificationMode: VERIFICATION_MODE.AUTOMATED,
        humanInstructions: null,
        validationCommandIndexes: [0],
      },
    ];

    const provider = new FakeArchitectProvider([respond(payload)]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.equal(generated.ok, false);
  });

  it("refuse une commande autonome que NOX n'a pas le droit de lancer", async () => {
    const project = await newProject();
    const payload = backlogPayload(["A"]);
    const tasks = payload["tasks"] as Record<string, unknown>[];
    const first = tasks[0];
    assert.ok(first !== undefined);
    first["validationCommands"] = [
      { command: "npm install", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
    ];

    const provider = new FakeArchitectProvider([respond(payload)]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.equal(generated.ok, false);
  });
});

describe("validation de la sortie du fournisseur", () => {
  it("refuse tout le backlog quand une seule tache est invalide", async () => {
    const project = await newProject();
    const payload = backlogPayload(["A", "B", "C"]);
    const tasks = payload["tasks"] as Record<string, unknown>[];
    const second = tasks[1];
    assert.ok(second !== undefined);
    second["validationCommands"] = ["npm run lint && npm test"];

    const provider = new FakeArchitectProvider([respond(payload)]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });

    assert.equal(generated.ok, false);
    assert.ok(
      !generated.ok && "code" in generated && generated.code === ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
    );
    assert.equal((await loadProjectBacklog(db, project.id)).pending, null, "rien de persiste");
  });

  it("refuse un document invente", async () => {
    const project = await newProject();
    const payload = backlogPayload(["A"]);
    const tasks = payload["tasks"] as Record<string, unknown>[];
    const first = tasks[0];
    assert.ok(first !== undefined);
    first["documentReferences"] = ["docs/INVENTE.md"];

    const provider = new FakeArchitectProvider([respond(payload)]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.equal(generated.ok, false);
  });

  it("refuse plus de taches que la borne", async () => {
    const project = await newProject();
    const titles = Array.from({ length: ARCHITECT_BACKLOG_LIMITS.tasks.max + 1 }, (_u, i) =>
      `Tache ${String(i)}`,
    );
    const provider = new FakeArchitectProvider([respond(backlogPayload(titles))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.equal(generated.ok, false);
  });

  it("refuse une liste de taches vide", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload([]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.equal(generated.ok, false);
  });
});

describe("ce qui est transmis au fournisseur", () => {
  it("porte le brief, le plan, la memoire, les taches et les documents autorises", async () => {
    const project = await newProject();
    await createProjectMemory(db, {
      projectId: project.id,
      values: {
        category: "DECISION",
        title: "SQLite comme base",
        content: "Le stockage local suffit.",
        rationale: null,
        status: PROJECT_MEMORY_STATUS.ACTIVE,
      },
      sanitize: (value) => value,
    });
    await createTask(db, {
      projectId: project.id,
      title: "Filtrer les livres",
      objective: "Retrouver un livre rapidement.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: ["Un filtre existe"],
      documentReferences: [],
      validationCommands: [],
    });

    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    await generateProjectBacklog(db, { ...(await inputFor(project)), provider });

    const call = provider.backlogCalls[0];
    assert.ok(call !== undefined);

    assert.ok(call.input.includes("Suivre une annee de lectures."), "le plan de V1");
    assert.ok(call.input.includes("Un suivi de lectures personnel."), "le brief");
    assert.ok(call.input.includes("SQLite comme base"), "la memoire active");
    assert.ok(call.input.includes("TASK-001"), "l'inventaire des taches");
    assert.ok(call.input.includes("Filtrer les livres"));
    assert.ok(call.input.includes("docs/ARCHITECTURE.md"), "la liste fermee des documents");
  });

  it("ne transmet aucune conversation", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    await generateProjectBacklog(db, { ...(await inputFor(project)), provider });

    const call = provider.backlogCalls[0];
    assert.ok(call !== undefined);
    assert.equal(call.input.includes("<conversation>"), false);
    assert.equal(call.input.includes("<user_message>"), false);
  });

  it("declare le schema, le plafond de sortie, et aucun outil", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    await generateProjectBacklog(db, { ...(await inputFor(project)), provider });

    const call = provider.backlogCalls[0];
    assert.ok(call !== undefined);
    assert.equal(call.schemaName, ARCHITECT_BACKLOG_SCHEMA_NAME_3);
    assert.equal(call.maxOutputTokens, ARCHITECT_BACKLOG_MAX_OUTPUT_TOKENS);
    assert.equal("tools" in call, false, "aucun outil n'est declare");
  });

  it("ne laisse fuir aucune cle dans l'entree", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    await generateProjectBacklog(db, { ...(await inputFor(project)), provider });

    const call = provider.backlogCalls[0];
    assert.ok(call !== undefined);
    assert.equal(call.input.includes("cle-architecte-de-test-9876543210"), false);
    assert.equal(call.instructions.includes("cle-architecte-de-test-9876543210"), false);
  });

  it("refuse de preparer quand le repository ne repond pas", async () => {
    const project = await newProject();
    const prepared = await prepareProjectBacklog(await inputFor(project, { ports: brokenPorts() }));
    assert.equal(prepared.ok, false);
  });
});

describe("application par un humain", () => {
  it("cree les taches editees, dans l'ordre valide", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A", "B", "C"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    // L'humain retire A, deplace C avant B, et renomme B.
    const applied = await applyProjectBacklog(db, {
      ...(await inputFor(project)),
      proposalId: generated.proposal.id,
      items: [item("C"), item("B corrigee")],
    });

    assert.ok(applied.ok);
    assert.deepEqual(
      applied.tasks.map((task) => task.title),
      ["C", "B corrigee"],
    );
    assert.ok(applied.tasks.every((task) => task.status === TASK_STATUS.DRAFT));
    assert.equal(provider.backlogCalls.length, 1, "aucun appel supplementaire");
  });

  it("conserve la proposition du fournisseur intacte", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["Originale"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    await applyProjectBacklog(db, {
      ...(await inputFor(project)),
      proposalId: generated.proposal.id,
      items: [item("Modifiee par l'humain")],
    });

    const proposal = await getBacklogProposal(db, project.id, generated.proposal.id);
    assert.deepEqual(
      proposal?.provided.tasks.map((task) => task.title),
      ["Originale"],
    );
    assert.deepEqual(
      proposal?.applied?.tasks.map((task) => task.title),
      ["Modifiee par l'humain"],
    );
  });

  it("revalide chaque tache editee, et refuse tout le lot", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A", "B"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    const applied = await applyProjectBacklog(db, {
      ...(await inputFor(project)),
      proposalId: generated.proposal.id,
      items: [item("A"), item("B", { criteria: [] })],
    });

    assert.equal(applied.ok, false);
    assert.ok(!applied.ok && "message" in applied && applied.message.startsWith("Tache 2"));
    assert.equal((await listTasksByProject(db, project.id)).length, 0, "aucune tache creee");
  });

  it("refuse une commande interdite ajoutee a la main", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    const applied = await applyProjectBacklog(db, {
      ...(await inputFor(project)),
      proposalId: generated.proposal.id,
      items: [item("A", { commands: [commandRow("v0", "npm test && rm -rf .", COMMAND_EXECUTION_MODE.AGENT_ONLY)] })],
    });
    assert.equal(applied.ok, false);
    assert.equal((await listTasksByProject(db, project.id)).length, 0);
  });

  it("refuse un document hors de la liste fermee ajoute a la main", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    const applied = await applyProjectBacklog(db, {
      ...(await inputFor(project)),
      proposalId: generated.proposal.id,
      items: [item("A", { documents: "docs/INVENTE.md" })],
    });
    assert.equal(applied.ok, false);
    assert.ok(!applied.ok && "message" in applied && applied.message.includes("docs/INVENTE.md"));
  });

  it("refuse un backlog vide", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    const applied = await applyProjectBacklog(db, {
      ...(await inputFor(project)),
      proposalId: generated.proposal.id,
      items: [],
    });
    assert.equal(applied.ok, false);
  });

  it("refuse d'appliquer quand le repository ne repond pas", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    const applied = await applyProjectBacklog(db, {
      ...(await inputFor(project, { ports: brokenPorts() })),
      proposalId: generated.proposal.id,
      items: [item("A")],
    });

    assert.equal(applied.ok, false);
    assert.equal(
      (await listTasksByProject(db, project.id)).length,
      0,
      "un runner arrete ne laisse aucune tache orpheline",
    );
  });
});

describe("peremption", () => {
  it("refuse quand le plan a change apres la generation", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    await saveProjectV1Plan(db, {
      projectId: project.id,
      values: { ...PLAN, goal: "Suivre deux annees de lectures." },
      tools: projectPlanTools(project.repositoryPath),
    });

    const applied = await applyProjectBacklog(db, {
      ...(await inputFor(project)),
      proposalId: generated.proposal.id,
      items: [item("A")],
    });

    assert.equal(applied.ok, false);
    assert.ok(!applied.ok && "stale" in applied && applied.stale);
    assert.equal((await listTasksByProject(db, project.id)).length, 0);
  });

  it("refuse quand une tache a ete creee entre-temps", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    await createTask(db, {
      projectId: project.id,
      title: "Creee a la main",
      objective: "Un travail decide entre-temps.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: ["Verifiable"],
      documentReferences: [],
      validationCommands: [],
    });

    const applied = await applyProjectBacklog(db, {
      ...(await inputFor(project)),
      proposalId: generated.proposal.id,
      items: [item("A")],
    });

    assert.equal(applied.ok, false);
    assert.ok(!applied.ok && "stale" in applied && applied.stale);
    assert.equal(
      (await listTasksByProject(db, project.id)).length,
      1,
      "seule la tache creee a la main subsiste",
    );
  });

  it("refuse quand une memoire active a change", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    await createProjectMemory(db, {
      projectId: project.id,
      values: {
        category: "CONSTRAINT",
        title: "Pas de dependance reseau",
        content: "L'application doit fonctionner hors ligne.",
        rationale: null,
        status: PROJECT_MEMORY_STATUS.ACTIVE,
      },
      sanitize: (value) => value,
    });

    const applied = await applyProjectBacklog(db, {
      ...(await inputFor(project)),
      proposalId: generated.proposal.id,
      items: [item("A")],
    });

    assert.equal(applied.ok, false);
    assert.ok(!applied.ok && "stale" in applied && applied.stale);
  });

  it("se derive sans aucun appel au fournisseur", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    const view = await loadProjectBacklog(db, project.id);
    assert.ok(view.pendingGeneration !== null);

    const fresh = await isBacklogProposalStale({
      ...(await inputFor(project)),
      baseFingerprint: view.pendingGeneration.base.planningFingerprint,
    });
    assert.equal(fresh, false);
    assert.equal(provider.backlogCalls.length, 1, "aucun appel supplementaire");

    await saveProjectBrief(db, {
      projectId: project.id,
      values: { ...BRIEF, summary: "Autre chose." },
      tools: projectPlanTools(project.repositoryPath),
    });

    const stale = await isBacklogProposalStale({
      ...(await inputFor(project)),
      baseFingerprint: view.pendingGeneration.base.planningFingerprint,
    });
    assert.equal(stale, true);
    assert.equal(provider.backlogCalls.length, 1);
  });

  it("dit « je ne sais pas » quand le repository ne repond pas", async () => {
    const project = await newProject();
    const unknown = await isBacklogProposalStale({
      ...(await inputFor(project, { ports: brokenPorts() })),
      baseFingerprint: "f".repeat(64),
    });
    assert.equal(unknown, null);
  });
});

describe("abandon", () => {
  it("ne cree aucune tache et rouvre la planification", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    const dismissed = await dismissProjectBacklog(db, {
      projectId: project.id,
      proposalId: generated.proposal.id,
    });
    assert.ok(dismissed.ok);
    assert.equal((await listTasksByProject(db, project.id)).length, 0);
    assert.equal(provider.backlogCalls.length, 1, "aucun appel");

    const again = new FakeArchitectProvider([respond(backlogPayload(["B"]))]);
    const regenerated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider: again,
    });
    assert.ok(regenerated.ok);
  });
});

describe("planifier le travail restant", () => {
  it("transmet les taches existantes, et la nouvelle proposition ne les remplace pas", async () => {
    const project = await newProject();
    const existing = await createTask(db, {
      projectId: project.id,
      title: "La liste des livres est utilisable",
      objective: "Afficher et filtrer les livres.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.HIGH,
      acceptanceCriteria: ["La liste s'affiche"],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(existing !== null);

    const provider = new FakeArchitectProvider([respond(backlogPayload(["Les statistiques"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    assert.ok(generated.ok);

    const call = provider.backlogCalls[0];
    assert.ok(call !== undefined);
    assert.ok(
      call.input.includes("La liste des livres est utilisable"),
      "l'inventaire des taches est bien parti",
    );

    const applied = await applyProjectBacklog(db, {
      ...(await inputFor(project)),
      proposalId: generated.proposal.id,
      items: backlogProposalToFormValues(generated.proposal.provided),
    });
    assert.ok(applied.ok);

    const tasks = await listTasksByProject(db, project.id);
    assert.equal(tasks.length, 2, "la tache existante n'est ni remplacee, ni supprimee");
    assert.ok(tasks.some((task) => task.id === existing.id));
  });
});

describe("conversion en valeurs de formulaire", () => {
  it("rend une ligne par entree de liste", () => {
    const values = backlogProposalToFormValues({
      schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
      message: "m",
      tasks: [
        {
          title: "A",
          priority: TASK_PRIORITY.HIGH,
          objective: "Objectif.",
          context: "Contexte.",
          acceptanceCriteria: [
            {
              text: "Un",
              verificationMode: VERIFICATION_MODE.AUTOMATED,
              humanInstructions: null,
              validationCommandIndexes: [0],
            },
            {
              text: "Deux",
              verificationMode: VERIFICATION_MODE.HUMAN,
              humanInstructions: "Regarder.",
              validationCommandIndexes: [],
            },
          ],
          outOfScope: ["Trois"],
          documentReferences: ["docs/A.md"],
          validationCommands: [
            { command: "npm test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
          ],
          dependsOn: [],
        },
      ],
    });

    assert.equal(values.length, 1);
    assert.equal(values[0]?.criteria.length, 2);
    assert.equal(values[0]?.criteria[0]?.verificationMode, VERIFICATION_MODE.AUTOMATED);
    // La preuve designe la **ligne** de commande, pas son texte.
    assert.deepEqual(values[0]?.criteria[0]?.commandKeys, [values[0]?.commands[0]?.key]);
    assert.deepEqual(values[0]?.criteria[1]?.commandKeys, []);
    assert.equal(values[0]?.outOfScope, "Trois");
    assert.equal(values[0]?.documents, "docs/A.md");
    assert.equal(values[0]?.commands[0]?.command, "npm test");
    assert.equal(values[0]?.commands[0]?.executionMode, COMMAND_EXECUTION_MODE.AUTONOMOUS);
  });

  it("donne des cles distinctes a deux taches du meme backlog", () => {
    // Elles vivent dans un seul formulaire : deux cles identiques y feraient
    // partager leurs champs.
    const values = backlogProposalToFormValues({
      schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
      message: "m",
      tasks: [
        {
          title: "A",
          priority: TASK_PRIORITY.LOW,
          objective: "Objectif.",
          context: null,
          acceptanceCriteria: [
            {
              text: "Un",
              verificationMode: VERIFICATION_MODE.HUMAN,
              humanInstructions: "Regarder.",
              validationCommandIndexes: [],
            },
          ],
          outOfScope: [],
          documentReferences: [],
          validationCommands: [],
          dependsOn: [],
        },
        {
          title: "B",
          priority: TASK_PRIORITY.LOW,
          objective: "Objectif.",
          context: null,
          acceptanceCriteria: [
            {
              text: "Un",
              verificationMode: VERIFICATION_MODE.HUMAN,
              humanInstructions: "Regarder.",
              validationCommandIndexes: [],
            },
          ],
          outOfScope: [],
          documentReferences: [],
          validationCommands: [],
          dependsOn: [],
        },
      ],
    });

    assert.notEqual(values[0]?.criteria[0]?.key, values[1]?.criteria[0]?.key);
  });

  it("ramene un contexte absent a une chaine vide", () => {
    const values = backlogProposalToFormValues({
      schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
      message: "m",
      tasks: [
        {
          title: "A",
          priority: TASK_PRIORITY.LOW,
          objective: "Objectif.",
          context: null,
          acceptanceCriteria: [
            {
              text: "Un",
              verificationMode: VERIFICATION_MODE.HUMAN,
              humanInstructions: "Regarder.",
              validationCommandIndexes: [],
            },
          ],
          outOfScope: [],
          documentReferences: [],
          validationCommands: [],
          dependsOn: [],
        },
      ],
    });
    assert.equal(values[0]?.context, "");
  });
});


describe("regression TripKit — un critere d'acceptation refuse", () => {
  /**
   * La reponse du pilote, dans sa forme exacte.
   *
   * Un backlog par ailleurs impeccable, dont `tasks[0].acceptanceCriteria`
   * porte un critere vide. Le mode strict du fournisseur l'accepte : c'est bien
   * un tableau de chaines. NOX le refuse, et c'est ce refus qui restait muet.
   */
  function tripkitPayload(criterion: string): Record<string, unknown> {
    const payload = backlogPayload(["Importer un itineraire", "Partager un carnet"]);
    const tasks = payload["tasks"] as Record<string, unknown>[];
    tasks[0]!["acceptanceCriteria"] = [
      {
        text: criterion,
        verificationMode: VERIFICATION_MODE.HUMAN,
        humanInstructions: "Verifier a la main.",
        validationCommandIndexes: [],
      },
    ];
    return payload;
  }

  /** Genere avec la charge utile donnee, et rend l'issue et le fournisseur. */
  async function generateWith(raw: unknown) {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(raw)]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    return { project, provider, generated };
  }

  it("refuse un critere vide, et dit lequel", async () => {
    const { project, provider, generated } = await generateWith(tripkitPayload("   "));

    assert.equal(generated.ok, false);
    assert.ok("code" in generated && generated.code === ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID);
    assert.ok("diagnostic" in generated && generated.diagnostic !== undefined);
    assert.equal(generated.diagnostic.category, ARCHITECT_BACKLOG_FAILURE.OUTPUT_INVALID);
    assert.equal(generated.diagnostic.field, "tasks.0.acceptanceCriteria");
    assert.ok(generated.diagnostic.message !== null);
    assert.match(generated.diagnostic.message, /Tache 1/u);

    // Un seul appel, et aucune tache creee.
    assert.equal(provider.backlogCalls.length, 1);
    assert.equal((await listTasksByProject(db, project.id)).length, 0);
  });

  it("refuse un critere trop long, et dit lequel", async () => {
    const { generated } = await generateWith(
      tripkitPayload("a".repeat(ARCHITECT_BACKLOG_LIMITS.criteria.length + 1)),
    );

    assert.ok("diagnostic" in generated && generated.diagnostic !== undefined);
    assert.equal(generated.diagnostic.field, "tasks.0.acceptanceCriteria");
  });

  it("enregistre la generation, son modele et sa cause", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(tripkitPayload(""))]);
    await generateProjectBacklog(db, {
      ...(await inputFor(project, { model: "gpt-5.6-sol" })),
      provider,
    });

    const view = await loadProjectBacklog(db, project.id);
    const generation = view.history[0];
    assert.ok(generation !== undefined);
    assert.equal(generation.status, ARCHITECT_BACKLOG_GENERATION_STATUS.FAILED);
    assert.equal(generation.model, "gpt-5.6-sol");
    assert.equal(generation.diagnostic?.field, "tasks.0.acceptanceCriteria");
    assert.ok(generation.diagnostic?.message !== null);

    // Aucune proposition applicable, et le verrou est rendu.
    assert.equal(view.pending, null);
    assert.equal(view.running, null);
  });

  it("ne relance aucun second appel", async () => {
    // HOTFIX-001 n'implemente ni reparation de sortie, ni reessai, ni modele de
    // repli. Un clic vaut exactement un appel, echec compris.
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(tripkitPayload(""))]);

    await generateProjectBacklog(db, { ...(await inputFor(project)), provider });

    assert.equal(provider.calls.length, 1);
    assert.equal(provider.backlogCalls.length, 1);
  });

  it("laisse une reponse valide inchangee", async () => {
    const { generated, provider } = await generateWith(backlogPayload(["A", "B"]));

    assert.ok(generated.ok);
    assert.equal(generated.proposal.taskCount, 2);
    assert.equal(provider.backlogCalls.length, 1);
  });

  it("n'attache aucun diagnostic de champ a une panne du fournisseur", async () => {
    // « Je n'ai pas pu regarder » n'est pas « j'ai regarde et c'est faux ».
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_TIMEOUT },
    ]);

    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });

    assert.ok("code" in generated && generated.code === ARCHITECT_ERROR.ARCHITECT_TIMEOUT);
    assert.equal("diagnostic" in generated ? generated.diagnostic : undefined, undefined);

    const view = await loadProjectBacklog(db, project.id);
    assert.equal(view.history[0]?.diagnostic?.category, ARCHITECT_BACKLOG_FAILURE.PROVIDER_ERROR);
    assert.equal(view.history[0]?.diagnostic?.field, null);
  });

  it("transmet le modele que le serveur lui donne, et rien d'autre", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);

    await generateProjectBacklog(db, {
      ...(await inputFor(project, { model: "gpt-5.6-sol" })),
      provider,
    });

    assert.equal(provider.backlogCalls[0]?.model, "gpt-5.6-sol");
  });
});

// ---------------------------------------------------------------------------
// HOTFIX-004 — arreter une planification en vol
// ---------------------------------------------------------------------------

/**
 * La surface exacte sur laquelle le second pilote reel a perdu deux appels.
 *
 * `Generate V1 backlog` a depasse le delai deux fois de suite, sur un projet
 * dont le brief et le plan etaient substantiels, avec `gpt-5.6-sol` en
 * raisonnement eleve. Rien a l'ecran ne disait depuis combien de temps la
 * planification travaillait, et la seule issue etait de recharger la page — ce
 * qui laissait la requete continuer.
 *
 * Ces tests fixent les trois garanties du correctif : un plafond genereux, un
 * arret qui ferme reellement la requete, et **aucune proposition** derriere une
 * planification arretee.
 */
class StoppableBacklogProvider implements ArchitectProvider {
  readonly calls: ArchitectProviderInput[] = [];
  readonly started: Promise<void>;

  #announceStart!: () => void;
  #respond: ((result: ArchitectProviderResult) => void) | null = null;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.#announceStart = resolve;
    });
  }

  #call(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    this.calls.push(input);
    return new Promise<ArchitectProviderResult>((resolve) => {
      this.#respond = resolve;
      input.signal?.addEventListener(
        "abort",
        () => {
          resolve({ ok: false, code: ARCHITECT_ERROR.ARCHITECT_CANCELLED });
        },
        { once: true },
      );
      this.#announceStart();
    });
  }

  generateTaskTurn(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    return this.#call(input);
  }
  analyzeRunReview(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    return this.#call(input);
  }
  generateBacklog(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    return this.#call(input);
  }
  refreshVerification(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    return this.#call(input);
  }

  respond(result: ArchitectProviderResult): void {
    this.#respond?.(result);
  }
}

/** Rejoue la route d'arret : la base d'abord, la requete ensuite. */
async function stopBacklog(projectId: string): Promise<{ stopped: boolean; aborted: boolean }> {
  const cancelled = await cancelBacklogGeneration(db, { projectId });
  if (!cancelled.ok) {
    return { stopped: false, aborted: false };
  }
  return { stopped: true, aborted: abortArchitectCall(cancelled.generation.id) };
}

describe("HOTFIX-004 — arreter une planification de backlog", () => {
  it("recoit le plafond genereux, et aucune echeance propre", async () => {
    const project = await newProject();
    const provider = new StoppableBacklogProvider();

    const pending = generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    await provider.started;

    // Toujours en vol : rien cote NOX ne l'a interrompue.
    const during = await loadProjectBacklog(db, project.id);
    assert.equal(during.history[0]?.status, ARCHITECT_BACKLOG_GENERATION_STATUS.RUNNING);

    provider.respond(respond(backlogPayload(["A", "B"])));
    const generated = await pending;

    assert.ok(generated.ok);
    assert.equal(provider.calls[0]?.timeoutMs, ARCHITECT_HARD_TIMEOUT_MS);
    assert.equal(provider.calls[0]?.timeoutMs > 90_000, true);
  });

  it("un arret ferme la requete et conclut en CANCELLED", async () => {
    // Requirements 3 et 4.
    const project = await newProject();
    const provider = new StoppableBacklogProvider();

    const pending = generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    await provider.started;

    const result = await stopBacklog(project.id);
    const generated = await pending;

    assert.equal(result.stopped, true);
    assert.equal(result.aborted, true);
    assert.equal(provider.calls[0]?.signal?.aborted, true);

    assert.equal(generated.ok, false);
    assert.equal(
      "code" in generated ? generated.code : null,
      ARCHITECT_ERROR.ARCHITECT_CANCELLED,
    );

    const backlog = await loadProjectBacklog(db, project.id);
    assert.equal(backlog.history[0]?.status, ARCHITECT_BACKLOG_GENERATION_STATUS.CANCELLED);
    assert.notEqual(backlog.history[0]?.status, ARCHITECT_BACKLOG_GENERATION_STATUS.FAILED);
  });

  it("une planification arretee ne laisse aucune proposition et aucune tache", async () => {
    // Requirement 6. Une proposition creee derriere un arret offrirait un
    // bouton `Apply` sur un travail que personne n'a laisse finir.
    const project = await newProject();
    const provider = new StoppableBacklogProvider();

    const pending = generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    await provider.started;
    await stopBacklog(project.id);
    await pending;

    const backlog = await loadProjectBacklog(db, project.id);
    assert.equal(backlog.pending, null);
    assert.equal((await listTasksByProject(db, project.id)).length, 0);
  });

  it("un resultat arrive apres l'arret ne cree aucune proposition", async () => {
    // Requirement 8. La proposition appartient a la transaction de conclusion :
    // refuser celle-ci refuse aussi celle-la, sans qu'aucun appelant ait a y
    // penser.
    const project = await newProject();
    const provider = new StoppableBacklogProvider();

    const pending = generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    await provider.started;

    const cancelled = await cancelBacklogGeneration(db, { projectId: project.id });
    assert.ok(cancelled.ok);
    provider.respond(respond(backlogPayload(["A", "B", "C"])));

    const generated = await pending;

    assert.equal(generated.ok, false);
    assert.equal(
      "code" in generated ? generated.code : null,
      ARCHITECT_ERROR.ARCHITECT_CANCELLED,
    );

    const backlog = await loadProjectBacklog(db, project.id);
    assert.equal(backlog.pending, null, "aucune proposition tardive");
    assert.equal(backlog.history[0]?.status, ARCHITECT_BACKLOG_GENERATION_STATUS.CANCELLED);
    assert.equal((await listTasksByProject(db, project.id)).length, 0);
  });

  it("un arret rend le verrou : le projet reste replanifiable", async () => {
    // Sans cela, un arret condamnerait le projet a ne plus jamais pouvoir
    // relancer une planification.
    const project = await newProject();
    const premier = new StoppableBacklogProvider();

    const pending = generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider: premier,
    });
    await premier.started;
    await stopBacklog(project.id);
    await pending;

    const second = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);
    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider: second,
    });

    assert.ok(generated.ok, "une seconde planification reste possible");
  });

  it("un second arret est idempotent", async () => {
    // Requirement 9.
    const project = await newProject();
    const provider = new StoppableBacklogProvider();

    const pending = generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    await provider.started;

    const premier = await stopBacklog(project.id);
    const second = await stopBacklog(project.id);
    await pending;

    assert.equal(premier.stopped, true);
    assert.equal(second.stopped, false);
    assert.equal(second.aborted, false);
  });

  it("un arret arrive apres la reussite ne defait rien", async () => {
    const project = await newProject();
    const provider = new StoppableBacklogProvider();

    const pending = generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    await provider.started;
    provider.respond(respond(backlogPayload(["A", "B"])));
    const generated = await pending;
    assert.ok(generated.ok);

    const result = await stopBacklog(project.id);

    assert.equal(result.stopped, false);

    const backlog = await loadProjectBacklog(db, project.id);
    assert.equal(backlog.history[0]?.status, ARCHITECT_BACKLOG_GENERATION_STATUS.READY);
    assert.notEqual(backlog.pending, null, "la proposition obtenue reste");
  });

  it("le controleur est retire apres une reussite comme apres un arret", async () => {
    // Requirements 10 et 13, du cote de la planification.
    const avant = activeArchitectCallCount();

    const abouti = await newProject();
    const premier = new StoppableBacklogProvider();
    const aboutiPending = generateProjectBacklog(db, {
      ...(await inputFor(abouti)),
      provider: premier,
    });
    await premier.started;
    premier.respond(respond(backlogPayload(["A"])));
    await aboutiPending;

    assert.equal(activeArchitectCallCount(), avant);

    const arrete = await newProject();
    const second = new StoppableBacklogProvider();
    const arretePending = generateProjectBacklog(db, {
      ...(await inputFor(arrete)),
      provider: second,
    });
    await second.started;
    await stopBacklog(arrete.id);
    await arretePending;

    assert.equal(activeArchitectCallCount(), avant);
  });

  it("le controleur est retire apres une panne du fournisseur", async () => {
    // Requirement 11.
    const avant = activeArchitectCallCount();
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR },
    ]);

    await generateProjectBacklog(db, { ...(await inputFor(project)), provider });

    assert.equal(activeArchitectCallCount(), avant);
  });

  it("le controleur est retire apres un plafond atteint", async () => {
    // Requirement 12. Un delai depasse reste un delai depasse : il ne devient
    // pas un arret parce que la requete a ete fermee.
    const avant = activeArchitectCallCount();
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_TIMEOUT },
    ]);

    const generated = await generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });

    assert.equal(activeArchitectCallCount(), avant);
    assert.equal(generated.ok, false);
    assert.equal("code" in generated ? generated.code : null, ARCHITECT_ERROR.ARCHITECT_TIMEOUT);

    const backlog = await loadProjectBacklog(db, project.id);
    assert.equal(backlog.history[0]?.status, ARCHITECT_BACKLOG_GENERATION_STATUS.FAILED);
    assert.notEqual(
      backlog.history[0]?.status,
      ARCHITECT_BACKLOG_GENERATION_STATUS.CANCELLED,
      "un plafond atteint n'est pas un arret",
    );
  });

  it("une planification conclue enregistre sa duree", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(backlogPayload(["A"]))]);

    await generateProjectBacklog(db, { ...(await inputFor(project)), provider });

    const backlog = await loadProjectBacklog(db, project.id);
    assert.equal(typeof backlog.history[0]?.durationMs, "number");
    assert.equal((backlog.history[0]?.durationMs ?? -1) >= 0, true);
  });

  it("une planification en vol n'a pas de duree, et pas zero", async () => {
    const project = await newProject();
    const provider = new StoppableBacklogProvider();

    const pending = generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    await provider.started;

    const during = await loadProjectBacklog(db, project.id);
    assert.equal(during.history[0]?.durationMs, null);
    assert.equal(during.history[0]?.finishedAt, null);

    provider.respond(respond(backlogPayload(["A"])));
    await pending;
  });
});

describe("HOTFIX-004 — un arret pendant la validation garde le dernier mot", () => {
  it("un backlog refuse apres un arret se lit comme un arret", async () => {
    // Meme course que du cote de la conversation : la reponse arrive, elle est
    // invalide, et l'arret a deja conclu la ligne. Le verdict enregistre fait
    // foi, et la phrase rendue doit le suivre.
    const project = await newProject();
    const provider = new StoppableBacklogProvider();

    const pending = generateProjectBacklog(db, {
      ...(await inputFor(project)),
      provider,
    });
    await provider.started;

    const cancelled = await cancelBacklogGeneration(db, { projectId: project.id });
    assert.ok(cancelled.ok);
    // Un backlog vide : refuse par `readArchitectBacklogProposalV3`.
    provider.respond(respond(backlogPayload([])));

    const generated = await pending;

    assert.equal(generated.ok, false);
    assert.equal(
      "code" in generated ? generated.code : null,
      ARCHITECT_ERROR.ARCHITECT_CANCELLED,
    );

    const backlog = await loadProjectBacklog(db, project.id);
    assert.equal(backlog.history[0]?.status, ARCHITECT_BACKLOG_GENERATION_STATUS.CANCELLED);
    assert.equal(backlog.pending, null);
  });
});
