/**
 * Cycle de vie d'un backlog de V1.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'un backlog ne cree aucune tache sans qu'un humain le demande, qu'il ne le
 * fait qu'une fois, et qu'il est refuse des que le projet a change depuis la
 * planification.
 *
 * Et surtout : que la creation est **atomique**. L'etat « trois taches creees,
 * la quatrieme en erreur, proposition marquee appliquee » ne doit exister sous
 * aucune circonstance — c'est ce que teste l'injection d'une erreur au milieu du
 * lot.
 *
 * Base temporaire, aucun reseau, aucun fournisseur.
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
  ARCHITECT_BACKLOG_PROPOSAL_STATUS,
  ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
  ARCHITECT_ERROR,
  COMMAND_EXECUTION_MODE,
  DEFAULT_HUMAN_INSTRUCTIONS,
  VERIFICATION_MODE,
  TASK_PRIORITY,
  TASK_STATUS,
  type ArchitectBacklogProposalV3,
  type BacklogContextManifest,
} from "@nox/shared";

import {
  applyBacklogProposal,
  createDatabaseClient,
  createProject,
  createTask,
  dismissBacklogProposal,
  finishBacklogGeneration,
  getBacklogGeneration,
  getBacklogProposal,
  getBacklogProposalForGeneration,
  listBacklogTasks,
  listTasksByProject,
  loadProjectBacklog,
  startBacklogGeneration,
  toDatabaseFilePath,
  toSqliteUrl,
  type BacklogPlanningBase,
  type BacklogTaskToCreate,
  type DatabaseClient,
} from "../dist/index.js";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma",
  "migrations",
);

let workspace: string;
let db: DatabaseClient;
let counter = 0;

const MANIFEST: BacklogContextManifest = {
  schemaVersion: 1,
  sources: [],
  totalChars: 0,
  missing: [],
  taskInventoryRevision: "inv-1",
};

const FINGERPRINT = "f".repeat(64);

function planningBase(overrides: Partial<BacklogPlanningBase> = {}): BacklogPlanningBase {
  return {
    planningFingerprint: FINGERPRINT,
    briefRevision: "brief-1",
    planRevision: "plan-1",
    taskInventoryRevision: "inv-1",
    memoryRevision: "mem-1",
    ...overrides,
  };
}

function backlog(titles: readonly string[]): ArchitectBacklogProposalV3 {
  return {
    schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
    message: "Ce decoupage couvre le plan.",
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
      dependsOn: [],
    })),
  };
}

function toCreate(titles: readonly string[]): BacklogTaskToCreate[] {
  return titles.map((title) => ({
    title,
    objective: `Objectif de ${title}.`,
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: [`${title} est verifiable`],
    documentReferences: [],
    validationCommands: [],
  }));
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

async function newProject(): Promise<string> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  return project.id;
}

/** Reserve, conclut, et rend la proposition qui en sort. */
async function newProposal(
  projectId: string,
  titles: readonly string[] = ["Premiere", "Deuxieme"],
  base: BacklogPlanningBase = planningBase(),
): Promise<{ generationId: string; proposalId: string }> {
  const reserved = await startBacklogGeneration(db, {
    projectId,
    model: "modele-de-test",
    promptVersion: "backlog/1",
    inputHash: "hash-1",
    manifest: MANIFEST,
    base,
  });
  assert.ok(reserved.ok, "la reservation aboutit");

  await finishBacklogGeneration(db, {
    generationId: reserved.generation.id,
    status: ARCHITECT_BACKLOG_GENERATION_STATUS.READY,
    proposal: backlog(titles),
    usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140, cachedInputTokens: null },
  });

  const proposal = await getBacklogProposalForGeneration(db, projectId, reserved.generation.id);
  assert.ok(proposal !== null, "la proposition est enregistree");
  return { generationId: reserved.generation.id, proposalId: proposal.id };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-backlog-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("reservation d'une planification", () => {
  it("attribue un code, et le premier vaut BACKLOG-001", async () => {
    const projectId = await newProject();
    const reserved = await startBacklogGeneration(db, {
      projectId,
      model: "m",
      promptVersion: "backlog/1",
      inputHash: "h",
      manifest: MANIFEST,
      base: planningBase(),
    });

    assert.ok(reserved.ok);
    assert.equal(reserved.generation.code, "BACKLOG-001");
    assert.equal(reserved.generation.status, ARCHITECT_BACKLOG_GENERATION_STATUS.RUNNING);
  });

  it("enregistre l'etat vu par le fournisseur, tel qu'il lui est donne", async () => {
    const projectId = await newProject();
    const base = planningBase({ briefRevision: "brief-A", planRevision: "plan-A" });
    const reserved = await startBacklogGeneration(db, {
      projectId,
      model: "m",
      promptVersion: "backlog/1",
      inputHash: "h",
      manifest: MANIFEST,
      base,
    });

    assert.ok(reserved.ok);
    assert.deepEqual(reserved.generation.base, base);
  });

  it("refuse une seconde planification tant que la premiere est en vol", async () => {
    const projectId = await newProject();
    const first = await startBacklogGeneration(db, {
      projectId,
      model: "m",
      promptVersion: "backlog/1",
      inputHash: "h",
      manifest: MANIFEST,
      base: planningBase(),
    });
    assert.ok(first.ok);

    const second = await startBacklogGeneration(db, {
      projectId,
      model: "m",
      promptVersion: "backlog/1",
      inputHash: "h",
      manifest: MANIFEST,
      base: planningBase(),
    });
    assert.equal(second.ok, false);
    assert.ok(!second.ok && second.reason === "active");
  });

  it("ne produit qu'une seule generation pour deux reservations simultanees", async () => {
    const projectId = await newProject();
    const results = await Promise.all([
      startBacklogGeneration(db, {
        projectId,
        model: "m",
        promptVersion: "backlog/1",
        inputHash: "h",
        manifest: MANIFEST,
        base: planningBase(),
      }),
      startBacklogGeneration(db, {
        projectId,
        model: "m",
        promptVersion: "backlog/1",
        inputHash: "h",
        manifest: MANIFEST,
        base: planningBase(),
      }),
    ]);

    assert.equal(results.filter((result) => result.ok).length, 1, "une seule reservation gagne");
  });

  it("refuse quand une proposition attend deja une decision", async () => {
    const projectId = await newProject();
    await newProposal(projectId);

    const refused = await startBacklogGeneration(db, {
      projectId,
      model: "m",
      promptVersion: "backlog/1",
      inputHash: "h",
      manifest: MANIFEST,
      base: planningBase(),
    });
    assert.equal(refused.ok, false);
    assert.ok(!refused.ok && refused.reason === "pending_proposal");
  });

  it("refuse un projet inconnu", async () => {
    const refused = await startBacklogGeneration(db, {
      projectId: "projet-inexistant",
      model: "m",
      promptVersion: "backlog/1",
      inputHash: "h",
      manifest: MANIFEST,
      base: planningBase(),
    });
    assert.equal(refused.ok, false);
    assert.ok(!refused.ok && refused.reason === "not_found");
  });
});

describe("conclusion d'une planification", () => {
  it("rend le verrou en cas d'echec, et permet de reessayer", async () => {
    const projectId = await newProject();
    const reserved = await startBacklogGeneration(db, {
      projectId,
      model: "m",
      promptVersion: "backlog/1",
      inputHash: "h",
      manifest: MANIFEST,
      base: planningBase(),
    });
    assert.ok(reserved.ok);

    await finishBacklogGeneration(db, {
      generationId: reserved.generation.id,
      status: ARCHITECT_BACKLOG_GENERATION_STATUS.FAILED,
      errorCode: "ARCHITECT_TIMEOUT",
    });

    const again = await startBacklogGeneration(db, {
      projectId,
      model: "m",
      promptVersion: "backlog/1",
      inputHash: "h",
      manifest: MANIFEST,
      base: planningBase(),
    });
    assert.ok(again.ok, "une nouvelle planification redevient possible");
    assert.equal(again.generation.code, "BACKLOG-002", "le numero ne recule jamais");
  });

  it("n'ecrit aucune proposition quand l'appel echoue", async () => {
    const projectId = await newProject();
    const reserved = await startBacklogGeneration(db, {
      projectId,
      model: "m",
      promptVersion: "backlog/1",
      inputHash: "h",
      manifest: MANIFEST,
      base: planningBase(),
    });
    assert.ok(reserved.ok);

    await finishBacklogGeneration(db, {
      generationId: reserved.generation.id,
      status: ARCHITECT_BACKLOG_GENERATION_STATUS.REFUSED,
      errorCode: "ARCHITECT_REFUSED",
    });

    const view = await loadProjectBacklog(db, projectId);
    assert.equal(view.pending, null);
    assert.equal(view.running, null);
  });

  it("enregistre la consommation rapportee sans rien inventer", async () => {
    const projectId = await newProject();
    const { generationId } = await newProposal(projectId);
    const generation = await getBacklogGeneration(db, generationId);

    assert.equal(generation?.usage.inputTokens, 100);
    assert.equal(generation?.usage.totalTokens, 140);
    assert.equal(generation?.usage.cachedInputTokens, null, "« non fourni » reste null");
  });

  it("ne modifie jamais une generation deja conclue", async () => {
    const projectId = await newProject();
    const { generationId } = await newProposal(projectId);

    await finishBacklogGeneration(db, {
      generationId,
      status: ARCHITECT_BACKLOG_GENERATION_STATUS.FAILED,
      errorCode: "ARCHITECT_TIMEOUT",
    });

    const generation = await getBacklogGeneration(db, generationId);
    assert.equal(generation?.status, ARCHITECT_BACKLOG_GENERATION_STATUS.READY);
    assert.equal(generation?.errorCode, null);
  });
});

describe("application d'un backlog", () => {
  it("cree toutes les taches, en DRAFT, dans l'ordre humain", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A", "B", "C"]);

    const applied = await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["C", "A", "B"]),
      currentPlanningFingerprint: FINGERPRINT,
      message: "3 taches appliquees.",
    });

    assert.ok(applied.ok);
    assert.equal(applied.tasks.length, 3);
    assert.deepEqual(
      applied.tasks.map((task) => task.title),
      ["C", "A", "B"],
      "l'ordre applique est celui de l'humain, pas celui du fournisseur",
    );
    assert.ok(applied.tasks.every((task) => task.status === TASK_STATUS.DRAFT));
  });

  it("attribue des codes sequentiels a partir du compteur du projet", async () => {
    const projectId = await newProject();
    // Dix taches existent deja : le backlog s'ajoute a la suite.
    for (let index = 0; index < 10; index += 1) {
      await createTask(db, {
        projectId,
        title: `Existante ${String(index)}`,
        objective: "Deja specifiee.",
        context: null,
        outOfScope: null,
        priority: TASK_PRIORITY.LOW,
        acceptanceCriteria: ["Verifiable"],
        documentReferences: [],
        validationCommands: [],
      });
    }

    const { proposalId } = await newProposal(projectId, ["A", "B", "C", "D"]);
    const applied = await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["A", "B", "C", "D"]),
      currentPlanningFingerprint: FINGERPRINT,
      message: "4 taches appliquees.",
    });

    assert.ok(applied.ok);
    assert.deepEqual(
      applied.tasks.map((task) => task.code),
      ["TASK-011", "TASK-012", "TASK-013", "TASK-014"],
    );
  });

  it("ne renumerote et ne modifie aucune tache existante", async () => {
    const projectId = await newProject();
    const existing = await createTask(db, {
      projectId,
      title: "Deja la",
      objective: "Deja specifiee.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.HIGH,
      acceptanceCriteria: ["Verifiable"],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(existing !== null);

    const { proposalId } = await newProposal(projectId, ["Nouvelle"]);
    await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["Nouvelle"]),
      currentPlanningFingerprint: FINGERPRINT,
      message: "1 tache appliquee.",
    });

    const tasks = await listTasksByProject(db, projectId);
    const unchanged = tasks.find((task) => task.id === existing.id);
    assert.equal(unchanged?.code, existing.code);
    assert.equal(unchanged?.title, "Deja la");
    assert.equal(unchanged?.priority, TASK_PRIORITY.HIGH);
    assert.equal(tasks.length, 2, "la tache existante est conservee, pas remplacee");
  });

  it("rattache chaque tache a sa proposition et a sa position", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A", "B", "C"]);
    await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["C", "A"]),
      currentPlanningFingerprint: FINGERPRINT,
      message: "2 taches appliquees.",
    });

    const created = await listBacklogTasks(db, proposalId);
    assert.deepEqual(
      created.map((task) => [task.position, task.title]),
      [
        [0, "C"],
        [1, "A"],
      ],
    );
  });

  it("conserve la proposition du fournisseur et la version humaine, distinctes", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["Titre du fournisseur", "Retiree"]);

    await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["Titre corrige par l'humain"]),
      currentPlanningFingerprint: FINGERPRINT,
      message: "1 tache appliquee.",
    });

    const proposal = await getBacklogProposal(db, projectId, proposalId);
    assert.ok(proposal !== null);
    assert.deepEqual(
      proposal.provided.tasks.map((task) => task.title),
      ["Titre du fournisseur", "Retiree"],
      "le payload du fournisseur n'est jamais reecrit",
    );
    assert.deepEqual(
      proposal.applied?.tasks.map((task) => task.title),
      ["Titre corrige par l'humain"],
      "la version humaine est conservee separement",
    );
  });

  it("retire le pointeur d'attente, ce qui rouvre la planification", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A"]);
    await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["A"]),
      currentPlanningFingerprint: FINGERPRINT,
      message: "1 tache appliquee.",
    });

    const again = await startBacklogGeneration(db, {
      projectId,
      model: "m",
      promptVersion: "backlog/1",
      inputHash: "h",
      manifest: MANIFEST,
      base: planningBase(),
    });
    assert.ok(again.ok, "une nouvelle planification redevient possible apres application");
  });

  it("refuse un backlog vide", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A"]);
    const applied = await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: [],
      currentPlanningFingerprint: FINGERPRINT,
      message: "",
    });
    assert.equal(applied.ok, false);
    assert.ok(!applied.ok && applied.reason === "empty");
  });

  it("refuse une proposition d'un autre projet", async () => {
    const projectId = await newProject();
    const otherId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A"]);

    const applied = await applyBacklogProposal(db, {
      projectId: otherId,
      proposalId,
      tasks: toCreate(["A"]),
      currentPlanningFingerprint: FINGERPRINT,
      message: "1 tache appliquee.",
    });
    assert.equal(applied.ok, false);
    assert.ok(!applied.ok && applied.reason === "not_found");
  });

  it("refuse une seconde application", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A"]);
    await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["A"]),
      currentPlanningFingerprint: FINGERPRINT,
      message: "1 tache appliquee.",
    });

    const twice = await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["A"]),
      currentPlanningFingerprint: FINGERPRINT,
      message: "1 tache appliquee.",
    });
    assert.equal(twice.ok, false);
    assert.ok(!twice.ok && twice.reason === "not_pending");

    const tasks = await listTasksByProject(db, projectId);
    assert.equal(tasks.length, 1, "aucune tache en double");
  });
});

describe("peremption", () => {
  it("refuse une application quand le contexte de planification a change", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A"]);

    const applied = await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["A"]),
      currentPlanningFingerprint: "a".repeat(64),
      message: "1 tache appliquee.",
    });

    assert.equal(applied.ok, false);
    assert.ok(!applied.ok && applied.reason === "stale");

    const tasks = await listTasksByProject(db, projectId);
    assert.equal(tasks.length, 0, "aucune tache creee");
  });

  it("laisse la proposition en attente apres un refus pour peremption", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A"]);
    await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["A"]),
      currentPlanningFingerprint: "b".repeat(64),
      message: "1 tache appliquee.",
    });

    const proposal = await getBacklogProposal(db, projectId, proposalId);
    assert.equal(proposal?.status, ARCHITECT_BACKLOG_PROPOSAL_STATUS.PENDING);
  });

  it("laisse ecarter une proposition perimee", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A"]);
    await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["A"]),
      currentPlanningFingerprint: "c".repeat(64),
      message: "1 tache appliquee.",
    });

    const dismissed = await dismissBacklogProposal(db, { projectId, proposalId });
    assert.ok(dismissed.ok);
    assert.equal(dismissed.proposal.status, ARCHITECT_BACKLOG_PROPOSAL_STATUS.DISMISSED);
  });
});

describe("abandon", () => {
  it("ne cree aucune tache et rouvre la planification", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A", "B"]);

    const dismissed = await dismissBacklogProposal(db, { projectId, proposalId });
    assert.ok(dismissed.ok);
    assert.equal((await listTasksByProject(db, projectId)).length, 0);

    const again = await startBacklogGeneration(db, {
      projectId,
      model: "m",
      promptVersion: "backlog/1",
      inputHash: "h",
      manifest: MANIFEST,
      base: planningBase(),
    });
    assert.ok(again.ok);
  });

  it("refuse un second abandon", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A"]);
    await dismissBacklogProposal(db, { projectId, proposalId });

    const twice = await dismissBacklogProposal(db, { projectId, proposalId });
    assert.equal(twice.ok, false);
    assert.ok(!twice.ok && twice.reason === "not_pending");
  });

  it("refuse d'ecarter une proposition deja appliquee", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A"]);
    await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["A"]),
      currentPlanningFingerprint: FINGERPRINT,
      message: "1 tache appliquee.",
    });

    const dismissed = await dismissBacklogProposal(db, { projectId, proposalId });
    assert.equal(dismissed.ok, false);
    assert.ok(!dismissed.ok && dismissed.reason === "not_pending");
  });

  it("refuse d'appliquer une proposition ecartee", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A"]);
    await dismissBacklogProposal(db, { projectId, proposalId });

    const applied = await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["A"]),
      currentPlanningFingerprint: FINGERPRINT,
      message: "1 tache appliquee.",
    });
    assert.equal(applied.ok, false);
    assert.ok(!applied.ok && applied.reason === "not_pending");
  });
});

describe("concurrence entre Apply et Dismiss", () => {
  it("laisse une seule transition gagner", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A"]);

    const [applied, dismissed] = await Promise.all([
      applyBacklogProposal(db, {
        projectId,
        proposalId,
        tasks: toCreate(["A"]),
        currentPlanningFingerprint: FINGERPRINT,
        message: "1 tache appliquee.",
      }),
      dismissBacklogProposal(db, { projectId, proposalId }),
    ]);

    const winners = [applied.ok, dismissed.ok].filter(Boolean).length;
    assert.equal(winners, 1, "une seule transition aboutit");

    const proposal = await getBacklogProposal(db, projectId, proposalId);
    const tasks = await listTasksByProject(db, projectId);

    if (proposal?.status === ARCHITECT_BACKLOG_PROPOSAL_STATUS.APPLIED) {
      assert.equal(tasks.length, 1);
    } else {
      assert.equal(proposal?.status, ARCHITECT_BACKLOG_PROPOSAL_STATUS.DISMISSED);
      assert.equal(tasks.length, 0, "un backlog ecarte ne cree jamais de tache");
    }
  });

  it("ne reutilise jamais un code pour deux applications concurrentes", async () => {
    const first = await newProject();
    const second = await newProject();
    const a = await newProposal(first, ["A", "B"]);
    const b = await newProposal(second, ["C", "D"]);

    await Promise.all([
      applyBacklogProposal(db, {
        projectId: first,
        proposalId: a.proposalId,
        tasks: toCreate(["A", "B"]),
        currentPlanningFingerprint: FINGERPRINT,
        message: "2 taches.",
      }),
      applyBacklogProposal(db, {
        projectId: second,
        proposalId: b.proposalId,
        tasks: toCreate(["C", "D"]),
        currentPlanningFingerprint: FINGERPRINT,
        message: "2 taches.",
      }),
    ]);

    for (const projectId of [first, second]) {
      const codes = (await listTasksByProject(db, projectId)).map((task) => task.code);
      assert.equal(new Set(codes).size, codes.length, "aucun code en double");
    }
  });
});

describe("atomicite du lot", () => {
  it("ne cree aucune tache quand une ecriture echoue au milieu du lot", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A", "B", "C"]);

    // Une erreur deterministe injectee dans la troisieme tache : un titre est
    // obligatoire en base, et `null` fait echouer l'insertion. La transaction
    // entiere doit etre annulee.
    const tasks = toCreate(["A", "B", "C"]);
    const broken = tasks.map((task, index) =>
      index === 2 ? { ...task, title: null as unknown as string } : task,
    );

    await assert.rejects(
      applyBacklogProposal(db, {
        projectId,
        proposalId,
        tasks: broken,
        currentPlanningFingerprint: FINGERPRINT,
        message: "3 taches.",
      }),
    );

    const created = await listTasksByProject(db, projectId);
    assert.equal(created.length, 0, "aucune tache a moitie creee");

    const proposal = await getBacklogProposal(db, projectId, proposalId);
    assert.equal(
      proposal?.status,
      ARCHITECT_BACKLOG_PROPOSAL_STATUS.PENDING,
      "la proposition n'est jamais annoncee appliquee",
    );
    assert.equal(proposal?.applied, null);

    // Et l'etat reste recuperable : la meme proposition s'applique ensuite.
    const retried = await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks,
      currentPlanningFingerprint: FINGERPRINT,
      message: "3 taches.",
    });
    assert.ok(retried.ok, "l'application reste possible apres l'echec");
    assert.equal(retried.tasks.length, 3);
  });
});

describe("une tache de backlog est une tache comme les autres", () => {
  it("ne differe d'une tache manuelle que par sa provenance", async () => {
    const projectId = await newProject();

    const manual = await createTask(db, {
      projectId,
      title: "Ecrite a la main",
      objective: "Objectif de Ecrite a la main.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: ["Ecrite a la main est verifiable"],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(manual !== null);

    const { proposalId } = await newProposal(projectId, ["Issue du backlog"]);
    const applied = await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["Issue du backlog"]),
      currentPlanningFingerprint: FINGERPRINT,
      message: "1 tache.",
    });
    assert.ok(applied.ok);

    const fromBacklog = applied.tasks[0];
    assert.ok(fromBacklog !== undefined);

    // Meme statut initial, meme etat de document, meme forme de chemin : le
    // workflow guide et l'ecran de tache les traitent donc a l'identique.
    assert.equal(fromBacklog.status, manual.status);
    assert.equal(fromBacklog.documentSyncStatus, manual.documentSyncStatus);
    assert.equal(fromBacklog.documentRevision, manual.documentRevision);
    assert.equal(fromBacklog.documentPath, "tasks/TASK-002.md");
    assert.equal(fromBacklog.status, TASK_STATUS.DRAFT, "jamais READY, jamais QUEUED");
  });

  it("n'attribue aucune provenance a une tache ecrite a la main", async () => {
    const projectId = await newProject();
    const manual = await createTask(db, {
      projectId,
      title: "Ecrite a la main",
      objective: "Objectif.",
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.LOW,
      acceptanceCriteria: ["Verifiable"],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(manual !== null);

    const { proposalId } = await newProposal(projectId, ["A"]);
    const linked = await listBacklogTasks(db, proposalId);
    assert.deepEqual(linked, [], "aucune tache n'est rattachee avant application");
  });
});

describe("lecture de la page", () => {
  it("decrit un projet sans planification", async () => {
    const projectId = await newProject();
    const view = await loadProjectBacklog(db, projectId);
    assert.equal(view.running, null);
    assert.equal(view.pending, null);
    assert.equal(view.lastApplied, null);
    assert.deepEqual(view.history, []);
  });

  it("decrit une proposition en attente avec sa generation", async () => {
    const projectId = await newProject();
    const { generationId, proposalId } = await newProposal(projectId, ["A", "B"]);

    const view = await loadProjectBacklog(db, projectId);
    assert.equal(view.pending?.id, proposalId);
    assert.equal(view.pending?.taskCount, 2);
    assert.equal(view.pendingGeneration?.id, generationId);
    assert.equal(view.pendingGeneration?.code, "BACKLOG-001");
  });

  it("decrit le dernier backlog applique et ses taches", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A", "B"]);
    await applyBacklogProposal(db, {
      projectId,
      proposalId,
      tasks: toCreate(["A", "B"]),
      currentPlanningFingerprint: FINGERPRINT,
      message: "2 taches.",
    });

    const view = await loadProjectBacklog(db, projectId);
    assert.equal(view.lastApplied?.id, proposalId);
    assert.equal(view.lastAppliedTasks.length, 2);
    assert.deepEqual(
      view.lastAppliedTasks.map((task) => task.title),
      ["A", "B"],
    );
  });

  it("conserve l'historique des planifications, de la plus recente en tete", async () => {
    const projectId = await newProject();
    const first = await newProposal(projectId, ["A"]);
    await dismissBacklogProposal(db, { projectId, proposalId: first.proposalId });
    await newProposal(projectId, ["B"]);

    const view = await loadProjectBacklog(db, projectId);
    assert.deepEqual(
      view.history.map((generation) => generation.code),
      ["BACKLOG-002", "BACKLOG-001"],
    );
  });

  it("n'expose jamais la proposition d'un autre projet", async () => {
    const projectId = await newProject();
    const otherId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A"]);

    assert.equal(await getBacklogProposal(db, otherId, proposalId), null);
    assert.equal((await loadProjectBacklog(db, otherId)).pending, null);
  });
});

describe("relecture d'une proposition historique", () => {
  it("releve un payload backlog/1 avec les defauts surs", async () => {
    // Une proposition enregistree avant TASK-027 ne porte aucune
    // classification. La relire ne doit ni echouer, ni en inventer une : les
    // criteres deviennent `HUMAN`, les commandes `AGENT_ONLY`.
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A"]);

    const historical = JSON.stringify({
      schemaVersion: 1,
      message: "Ancien backlog.",
      tasks: [
        {
          title: "A",
          priority: TASK_PRIORITY.MEDIUM,
          objective: "Objectif de A.",
          context: null,
          acceptanceCriteria: ["A est verifiable"],
          outOfScope: [],
          documentReferences: [],
          validationCommands: ["npm test"],
        },
      ],
    });
    await db.architectBacklogProposal.update({
      where: { id: proposalId },
      data: { providerJson: historical },
    });

    const proposal = await getBacklogProposal(db, projectId, proposalId);
    assert.ok(proposal !== null);

    const first = proposal.provided.tasks[0];
    assert.equal(first?.acceptanceCriteria[0]?.text, "A est verifiable");
    assert.equal(first?.acceptanceCriteria[0]?.verificationMode, VERIFICATION_MODE.HUMAN);
    assert.equal(first?.acceptanceCriteria[0]?.humanInstructions, DEFAULT_HUMAN_INSTRUCTIONS);
    assert.equal(first?.validationCommands[0]?.command, "npm test");
    assert.equal(first?.validationCommands[0]?.executionMode, COMMAND_EXECUTION_MODE.AGENT_ONLY);

    // Le document enregistre n'a pas bouge : il raconte toujours ce que le
    // fournisseur avait rendu ce jour-la.
    const row = await db.architectBacklogProposal.findUnique({
      where: { id: proposalId },
      select: { providerJson: true },
    });
    assert.equal(row?.providerJson, historical);
  });

  it("ne fait jamais retomber un mode illisible sur autonome", async () => {
    const projectId = await newProject();
    const { proposalId } = await newProposal(projectId, ["A"]);

    await db.architectBacklogProposal.update({
      where: { id: proposalId },
      data: {
        providerJson: JSON.stringify({
          schemaVersion: 2,
          message: "m",
          tasks: [
            {
              title: "A",
              priority: TASK_PRIORITY.MEDIUM,
              objective: "Objectif.",
              context: null,
              acceptanceCriteria: [
                {
                  text: "Un",
                  verificationMode: "PEUT_ETRE",
                  humanInstructions: null,
                  validationCommandIndexes: [0],
                },
              ],
              outOfScope: [],
              documentReferences: [],
              validationCommands: [{ command: "npm test", executionMode: "SUDO" }],
            },
          ],
        }),
      },
    });

    const proposal = await getBacklogProposal(db, projectId, proposalId);
    assert.ok(proposal !== null);
    const first = proposal.provided.tasks[0];
    assert.equal(first?.acceptanceCriteria[0]?.verificationMode, VERIFICATION_MODE.HUMAN);
    assert.equal(first?.validationCommands[0]?.executionMode, COMMAND_EXECUTION_MODE.AGENT_ONLY);
    assert.deepEqual(first?.acceptanceCriteria[0]?.validationCommandIndexes, []);
  });
});


describe("diagnostic d'un echec de planification", () => {
  /** Reserve une generation, sans la conclure. */
  async function reserve(projectId: string, model = "modele-de-test"): Promise<string> {
    const reserved = await startBacklogGeneration(db, {
      projectId,
      model,
      promptVersion: "backlog/2",
      inputHash: "hash-1",
      manifest: MANIFEST,
      base: planningBase(),
    });
    assert.ok(reserved.ok, "la reservation aboutit");
    return reserved.generation.id;
  }

  it("conserve le champ refuse et sa phrase", async () => {
    const projectId = await newProject();
    const generationId = await reserve(projectId);

    await finishBacklogGeneration(db, {
      generationId,
      status: ARCHITECT_BACKLOG_GENERATION_STATUS.FAILED,
      errorCode: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
      errorField: "tasks.0.acceptanceCriteria",
      errorDetail: "Un critere de Tache 1 est vide ou trop long.",
    });

    const generation = await getBacklogGeneration(db, generationId);
    assert.ok(generation !== null);
    assert.deepEqual(generation.diagnostic, {
      category: ARCHITECT_BACKLOG_FAILURE.OUTPUT_INVALID,
      field: "tasks.0.acceptanceCriteria",
      message: "Un critere de Tache 1 est vide ou trop long.",
    });
  });

  it("nettoie et borne le diagnostic a l'ecriture", async () => {
    const projectId = await newProject();
    const generationId = await reserve(projectId);

    await finishBacklogGeneration(db, {
      generationId,
      status: ARCHITECT_BACKLOG_GENERATION_STATUS.FAILED,
      errorCode: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
      errorField: "tasks.0.acceptanceCriteria",
      errorDetail: `  Un critere ${String.fromCharCode(0)} trop long. ${"a".repeat(2_000)}  `,
    });

    const generation = await getBacklogGeneration(db, generationId);
    assert.ok(generation?.diagnostic?.message != null);
    // Ce qui est stocke est deja ce qui peut etre affiche : aucune lecture n'a a
    // s'en souvenir.
    assert.ok(generation.diagnostic.message.length <= 600);
    assert.equal(generation.diagnostic.message.includes(String.fromCharCode(0)), false);
    assert.ok(generation.diagnostic.message.endsWith("[…]"));
  });

  it("distingue une panne du fournisseur d'une sortie refusee", async () => {
    const projectId = await newProject();
    const generationId = await reserve(projectId);

    // Aucune reponse recue : il n'y a pas de champ fautif, et en inventer un
    // enverrait relire un backlog qui n'a jamais existe.
    await finishBacklogGeneration(db, {
      generationId,
      status: ARCHITECT_BACKLOG_GENERATION_STATUS.FAILED,
      errorCode: ARCHITECT_ERROR.ARCHITECT_TIMEOUT,
    });

    const generation = await getBacklogGeneration(db, generationId);
    assert.deepEqual(generation?.diagnostic, {
      category: ARCHITECT_BACKLOG_FAILURE.PROVIDER_ERROR,
      field: null,
      message: null,
    });
  });

  it("n'attache aucun diagnostic a une generation reussie", async () => {
    const projectId = await newProject();
    const { generationId } = await newProposal(projectId, ["A"]);

    const generation = await getBacklogGeneration(db, generationId);
    assert.equal(generation?.diagnostic, null);
  });

  it("laisse lisible une generation echouee sans diagnostic enregistre", async () => {
    const projectId = await newProject();
    const generationId = await reserve(projectId, "gpt-5-mini");

    // Exactement la forme de `BACKLOG-001` : echouee avant HOTFIX-001, donc sans
    // champ ni phrase. NOX ne reconstruit rien depuis les logs.
    await finishBacklogGeneration(db, {
      generationId,
      status: ARCHITECT_BACKLOG_GENERATION_STATUS.FAILED,
      errorCode: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
    });

    const generation = await getBacklogGeneration(db, generationId);
    assert.ok(generation !== null);
    assert.equal(generation.status, ARCHITECT_BACKLOG_GENERATION_STATUS.FAILED);
    assert.deepEqual(generation.diagnostic, {
      category: ARCHITECT_BACKLOG_FAILURE.OUTPUT_INVALID,
      field: null,
      message: null,
    });
  });

  it("rend a chaque generation le modele reellement utilise", async () => {
    const projectId = await newProject();

    // Une generation historique garde son modele : la ligne raconte l'appel qui
    // a eu lieu, pas la configuration d'aujourd'hui.
    const ancienne = await reserve(projectId, "gpt-5-mini");
    await finishBacklogGeneration(db, {
      generationId: ancienne,
      status: ARCHITECT_BACKLOG_GENERATION_STATUS.FAILED,
      errorCode: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
    });

    const recente = await reserve(projectId, "gpt-5.6-sol");
    await finishBacklogGeneration(db, {
      generationId: recente,
      status: ARCHITECT_BACKLOG_GENERATION_STATUS.READY,
      proposal: backlog(["A"]),
    });

    assert.equal((await getBacklogGeneration(db, ancienne))?.model, "gpt-5-mini");
    assert.equal((await getBacklogGeneration(db, recente))?.model, "gpt-5.6-sol");
  });
});
