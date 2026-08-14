/**
 * Tests de la conversation Architecte principale d'un projet.
 *
 * Base temporaire, isolee, detruite a la fin. Le package **compile** est importe
 * volontairement : c'est l'artefact que le web consomme reellement.
 *
 * Trois garanties structurent ce fichier, et ce sont exactement les trois que
 * TASK-020 deplace :
 *
 * 1. **Une conversation principale par projet**, y compris sur deux ouvertures
 *    simultanees. La garantie est portee par une colonne du projet, pas par une
 *    lecture suivie d'une ecriture.
 * 2. **Une conversation cree plusieurs taches** au fil du temps. C'est ce que
 *    l'ancien modele interdisait.
 * 3. **Une proposition n'en cree jamais deux**, y compris sur double clic. Le
 *    verrou a simplement descendu d'un cran : de la session a la generation.
 *
 * Les sessions historiques sont testees a cote, pour verifier qu'elles gardent
 * exactement le comportement qu'elles avaient.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHITECT_GENERATION_STATUS,
  ARCHITECT_MESSAGE_ROLE,
  ARCHITECT_SESSION_KIND,
  ARCHITECT_SESSION_STATUS,
  ARCHITECT_TURN_STATE,
  TASK_STATUS,
  type ArchitectContextManifest,
  type ArchitectTaskProposal,
} from "@nox/shared";

import {
  attachArchitectGenerationTask,
  canCreateArchitectTask,
  claimArchitectGeneration,
  createArchitectSession,
  createDatabaseClient,
  createProject,
  createTask,
  creatableArchitectProposal,
  ensureProjectArchitectSession,
  findArchitectSessionForTask,
  findProjectArchitectSession,
  finishArchitectGeneration,
  getArchitectSession,
  listArchitectSessions,
  listArchitectSessionTasks,
  releaseArchitectGeneration,
  saveArchitectTurnDraft,
  startArchitectGeneration,
  toDatabaseFilePath,
  toSqliteUrl,
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

const MANIFEST: ArchitectContextManifest = {
  schemaVersion: 1,
  sources: [],
  totalChars: 0,
  missing: [],
};

const PROPOSAL: ArchitectTaskProposal = {
  schemaVersion: 1,
  status: "PROPOSAL_READY",
  title: "Exporter les taches",
  priority: "MEDIUM",
  objective: "Un objectif.",
  context: null,
  acceptanceCriteria: ["Un critere."],
  outOfScope: [],
  documentReferences: [],
  validationCommands: [],
  assumptions: [],
  questions: [],
};

const FINGERPRINT = "f".repeat(64);

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

async function newProject(): Promise<string> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  return project.id;
}

/** Joue un tour complet et le conclut avec l'issue demandee. */
async function playTurn(
  sessionId: string,
  outcome: "PROPOSAL_READY" | "CONTINUE",
  message = "Un message.",
): Promise<string> {
  await saveArchitectTurnDraft(db, {
    sessionId,
    messageText: message,
    contextFingerprint: FINGERPRINT,
    manifest: MANIFEST,
  });
  const started = await startArchitectGeneration(db, {
    sessionId,
    model: "modele",
    promptVersion: "architect/3",
    inputHash: "a".repeat(64),
    contextFingerprint: FINGERPRINT,
    manifest: MANIFEST,
  });
  assert.ok(started.ok);

  await finishArchitectGeneration(db, {
    generationId: started.generation.id,
    status:
      outcome === "PROPOSAL_READY"
        ? ARCHITECT_GENERATION_STATUS.PROPOSAL_READY
        : ARCHITECT_GENERATION_STATUS.CONTINUE,
    turnState:
      outcome === "PROPOSAL_READY"
        ? ARCHITECT_TURN_STATE.PROPOSAL_READY
        : ARCHITECT_TURN_STATE.CONTINUE,
    proposal: outcome === "PROPOSAL_READY" ? PROPOSAL : null,
    questions: [],
    messages: [
      { role: ARCHITECT_MESSAGE_ROLE.USER, content: message },
      { role: ARCHITECT_MESSAGE_ROLE.ARCHITECT, content: "Une reponse." },
    ],
  });

  return started.generation.id;
}

/** Cree la tache d'une proposition, comme le fait `applyArchitectProposal`. */
async function createTaskFrom(
  projectId: string,
  generationId: string,
  title: string,
): Promise<string> {
  const claimed = await claimArchitectGeneration(db, generationId);
  assert.ok(claimed.ok);

  const task = await createTask(db, {
    title,
    priority: "MEDIUM",
    objective: "Un objectif.",
    context: null,
    acceptanceCriteria: ["Un critere."],
    outOfScope: null,
    documentReferences: [],
    validationCommands: [],
    projectId,
  });
  assert.ok(task !== null);

  assert.equal(await attachArchitectGenerationTask(db, generationId, task.id), true);
  return task.id;
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-project-architect-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("ensureProjectArchitectSession", () => {
  it("cree une conversation principale, ouverte et conversationnelle", async () => {
    const projectId = await newProject();
    const session = await ensureProjectArchitectSession(db, projectId);

    assert.ok(session !== null);
    assert.equal(session.kind, ARCHITECT_SESSION_KIND.PROJECT);
    assert.equal(session.status, ARCHITECT_SESSION_STATUS.OPEN);
    assert.equal(session.conversational, true);
    assert.equal(session.appliedTaskId, null);
    // Une conversation projet n'a pas de « demande » d'ouverture : elle commence
    // par un message comme les suivants.
    assert.equal(session.requestText, "");
  });

  it("rend la meme conversation aux appels suivants", async () => {
    const projectId = await newProject();
    const first = await ensureProjectArchitectSession(db, projectId);
    const second = await ensureProjectArchitectSession(db, projectId);

    assert.equal(first?.id, second?.id);
    assert.equal((await listArchitectSessions(db, projectId)).length, 1);
  });

  it("n'en cree qu'une sur deux ouvertures simultanees", async () => {
    const projectId = await newProject();

    const [left, right] = await Promise.all([
      ensureProjectArchitectSession(db, projectId),
      ensureProjectArchitectSession(db, projectId),
    ]);

    assert.ok(left !== null);
    assert.ok(right !== null);
    assert.equal(left.id, right.id);
    // La session creee par le perdant disparait avec sa transaction : rien
    // n'est laisse derriere.
    assert.equal((await listArchitectSessions(db, projectId)).length, 1);
  });

  it("donne une conversation distincte a chaque projet", async () => {
    const first = await newProject();
    const second = await newProject();

    const left = await ensureProjectArchitectSession(db, first);
    const right = await ensureProjectArchitectSession(db, second);

    assert.notEqual(left?.id, right?.id);
    assert.equal(left?.projectId, first);
    assert.equal(right?.projectId, second);
  });

  it("ne cree rien pour un projet inconnu", async () => {
    assert.equal(await ensureProjectArchitectSession(db, "projet-inexistant"), null);
  });

  it("n'a pas de borne de generations", async () => {
    const projectId = await newProject();
    const session = await ensureProjectArchitectSession(db, projectId);

    assert.equal(session?.generationsLeft, null);
  });
});

describe("findProjectArchitectSession", () => {
  it("ne trouve rien tant que la conversation n'a pas ete ouverte", async () => {
    const projectId = await newProject();
    assert.equal(await findProjectArchitectSession(db, projectId), null);
  });

  it("trouve la conversation sans la creer", async () => {
    const projectId = await newProject();
    const created = await ensureProjectArchitectSession(db, projectId);

    assert.equal((await findProjectArchitectSession(db, projectId))?.id, created?.id);
  });

  it("ignore les sessions historiques du meme projet", async () => {
    const projectId = await newProject();
    await createArchitectSession(db, { projectId, requestText: "Une demande historique." });

    assert.equal(await findProjectArchitectSession(db, projectId), null);
  });
});

describe("une conversation projet cree plusieurs taches", () => {
  it("reste active apres la creation d'une tache", async () => {
    const projectId = await newProject();
    const opened = await ensureProjectArchitectSession(db, projectId);
    assert.ok(opened !== null);

    const generationId = await playTurn(opened.id, "PROPOSAL_READY");
    await createTaskFrom(projectId, generationId, "Premiere tache");

    const session = await getArchitectSession(db, opened.id);
    assert.ok(session !== null);
    assert.notEqual(session.status, ARCHITECT_SESSION_STATUS.APPLIED);
    assert.equal(session.appliedTaskId, null);
    assert.equal(session.kind, ARCHITECT_SESSION_KIND.PROJECT);
  });

  it("cree deux taches distinctes depuis la meme conversation", async () => {
    const projectId = await newProject();
    const opened = await ensureProjectArchitectSession(db, projectId);
    assert.ok(opened !== null);

    const first = await playTurn(opened.id, "PROPOSAL_READY", "Premiere demande.");
    const taskA = await createTaskFrom(projectId, first, "Tache A");

    await playTurn(opened.id, "CONTINUE", "Discutons d'autre chose.");
    const second = await playTurn(opened.id, "PROPOSAL_READY", "Seconde demande.");
    const taskB = await createTaskFrom(projectId, second, "Tache B");

    assert.notEqual(taskA, taskB);

    // Les deux taches designent la meme conversation.
    const originA = await findArchitectSessionForTask(db, taskA);
    const originB = await findArchitectSessionForTask(db, taskB);
    assert.equal(originA?.sessionId, opened.id);
    assert.equal(originB?.sessionId, opened.id);
    assert.equal(originA?.kind, ARCHITECT_SESSION_KIND.PROJECT);
    assert.notEqual(originA?.generationSequence, originB?.generationSequence);
  });

  it("cree la tache en DRAFT, comme toute tache", async () => {
    const projectId = await newProject();
    const opened = await ensureProjectArchitectSession(db, projectId);
    assert.ok(opened !== null);

    const generationId = await playTurn(opened.id, "PROPOSAL_READY");
    const taskId = await createTaskFrom(projectId, generationId, "Une tache");

    const session = await getArchitectSession(db, opened.id);
    const generation = session?.generations.find((entry) => entry.id === generationId);
    assert.equal(generation?.appliedTaskId, taskId);

    const tasks = await listArchitectSessions(db, projectId);
    assert.equal(tasks.length, 1);
    const created = await createTask(db, {
      title: "Temoin",
      priority: "MEDIUM",
      objective: "Un objectif.",
      context: null,
      acceptanceCriteria: ["Un critere."],
      outOfScope: null,
      documentReferences: [],
      validationCommands: [],
      projectId,
    });
    assert.equal(created?.status, TASK_STATUS.DRAFT);
  });
});

describe("une proposition ne cree jamais deux taches", () => {
  it("refuse une seconde creation depuis la meme generation", async () => {
    const projectId = await newProject();
    const opened = await ensureProjectArchitectSession(db, projectId);
    assert.ok(opened !== null);

    const generationId = await playTurn(opened.id, "PROPOSAL_READY");
    await createTaskFrom(projectId, generationId, "Tache unique");

    const again = await claimArchitectGeneration(db, generationId);
    assert.equal(again.ok, false);
    assert.equal(again.ok === false ? again.reason : null, "already_applied");
  });

  it("n'accorde la reservation qu'a un seul de deux clics simultanes", async () => {
    const projectId = await newProject();
    const opened = await ensureProjectArchitectSession(db, projectId);
    assert.ok(opened !== null);

    const generationId = await playTurn(opened.id, "PROPOSAL_READY");

    const [left, right] = await Promise.all([
      claimArchitectGeneration(db, generationId),
      claimArchitectGeneration(db, generationId),
    ]);

    assert.equal([left.ok, right.ok].filter(Boolean).length, 1);
  });

  it("refuse une generation qui ne porte aucune proposition", async () => {
    const projectId = await newProject();
    const opened = await ensureProjectArchitectSession(db, projectId);
    assert.ok(opened !== null);

    const generationId = await playTurn(opened.id, "CONTINUE");
    const claimed = await claimArchitectGeneration(db, generationId);

    assert.equal(claimed.ok, false);
    assert.equal(claimed.ok === false ? claimed.reason : null, "not_ready");
  });

  it("rend la main quand la creation echoue", async () => {
    const projectId = await newProject();
    const opened = await ensureProjectArchitectSession(db, projectId);
    assert.ok(opened !== null);

    const generationId = await playTurn(opened.id, "PROPOSAL_READY");
    assert.ok((await claimArchitectGeneration(db, generationId)).ok);

    assert.equal(await releaseArchitectGeneration(db, generationId), true);
    assert.ok((await claimArchitectGeneration(db, generationId)).ok);
  });
});

describe("creatableArchitectProposal", () => {
  it("designe la derniere proposition tant qu'aucun tour ne lui a succede", async () => {
    const projectId = await newProject();
    const opened = await ensureProjectArchitectSession(db, projectId);
    assert.ok(opened !== null);

    const generationId = await playTurn(opened.id, "PROPOSAL_READY");
    const session = await getArchitectSession(db, opened.id);

    assert.ok(session !== null);
    assert.equal(creatableArchitectProposal(session)?.id, generationId);
    assert.equal(canCreateArchitectTask(session), true);
  });

  it("cesse de la designer des qu'un tour lui succede", async () => {
    const projectId = await newProject();
    const opened = await ensureProjectArchitectSession(db, projectId);
    assert.ok(opened !== null);

    await playTurn(opened.id, "PROPOSAL_READY");
    await playTurn(opened.id, "CONTINUE", "En fait, non.");

    const session = await getArchitectSession(db, opened.id);
    assert.ok(session !== null);
    assert.equal(creatableArchitectProposal(session), null);
  });

  it("cesse de la designer une fois sa tache creee", async () => {
    const projectId = await newProject();
    const opened = await ensureProjectArchitectSession(db, projectId);
    assert.ok(opened !== null);

    const generationId = await playTurn(opened.id, "PROPOSAL_READY");
    await createTaskFrom(projectId, generationId, "Une tache");

    const session = await getArchitectSession(db, opened.id);
    assert.ok(session !== null);
    assert.equal(creatableArchitectProposal(session), null);
    assert.equal(canCreateArchitectTask(session), false);
  });

  it("la designe a nouveau apres une nouvelle proposition", async () => {
    const projectId = await newProject();
    const opened = await ensureProjectArchitectSession(db, projectId);
    assert.ok(opened !== null);

    const first = await playTurn(opened.id, "PROPOSAL_READY");
    await createTaskFrom(projectId, first, "Tache A");
    const second = await playTurn(opened.id, "PROPOSAL_READY", "Et maintenant ?");

    const session = await getArchitectSession(db, opened.id);
    assert.ok(session !== null);
    assert.equal(creatableArchitectProposal(session)?.id, second);
  });
});

describe("les sessions historiques ne changent pas", () => {
  it("gardent leur role et leur borne de generations", async () => {
    const projectId = await newProject();
    const session = await createArchitectSession(db, {
      projectId,
      requestText: "Une demande historique.",
    });

    assert.equal(session?.kind, ARCHITECT_SESSION_KIND.TASK_DESIGN_LEGACY);
    assert.equal(typeof session?.generationsLeft, "number");
  });

  it("coexistent avec une conversation projet, sans se melanger", async () => {
    const projectId = await newProject();
    const legacy = await createArchitectSession(db, {
      projectId,
      requestText: "Une demande historique.",
    });
    const project = await ensureProjectArchitectSession(db, projectId);

    assert.ok(legacy !== null);
    assert.ok(project !== null);
    assert.notEqual(legacy.id, project.id);

    await playTurn(project.id, "CONTINUE", "Un message de projet.");

    const legacyView = await getArchitectSession(db, legacy.id);
    const projectView = await getArchitectSession(db, project.id);
    assert.equal(legacyView?.messages.length, 0);
    assert.equal(projectView?.messages.length, 2);
  });

  it("restent trouvables comme origine de leur tache", async () => {
    const projectId = await newProject();
    const session = await createArchitectSession(db, {
      projectId,
      requestText: "Une demande historique.",
    });
    assert.ok(session !== null);

    const task = await createTask(db, {
      title: "Tache historique",
      priority: "MEDIUM",
      objective: "Un objectif.",
      context: null,
      acceptanceCriteria: ["Un critere."],
      outOfScope: null,
      documentReferences: [],
      validationCommands: [],
      projectId,
    });
    assert.ok(task !== null);

    await db.architectSession.update({
      where: { id: session.id },
      data: { appliedTaskId: task.id, status: ARCHITECT_SESSION_STATUS.APPLIED },
    });

    const origin = await findArchitectSessionForTask(db, task.id);
    assert.equal(origin?.sessionId, session.id);
    assert.equal(origin?.kind, ARCHITECT_SESSION_KIND.TASK_DESIGN_LEGACY);
    assert.equal(origin?.generationSequence, null);
  });
});

describe("isolation entre projets", () => {
  it("ne rend jamais la conversation d'un autre projet", async () => {
    const first = await newProject();
    const second = await newProject();

    const left = await ensureProjectArchitectSession(db, first);
    await ensureProjectArchitectSession(db, second);

    const found = await findProjectArchitectSession(db, second);
    assert.notEqual(found?.id, left?.id);
  });

  it("ne trouve aucune origine pour une tache ecrite a la main", async () => {
    const projectId = await newProject();
    const task = await createTask(db, {
      title: "Tache manuelle",
      priority: "MEDIUM",
      objective: "Un objectif.",
      context: null,
      acceptanceCriteria: ["Un critere."],
      outOfScope: null,
      documentReferences: [],
      validationCommands: [],
      projectId,
    });
    assert.ok(task !== null);

    assert.equal(await findArchitectSessionForTask(db, task.id), null);
  });
});


describe("listArchitectSessionTasks", () => {
  it("ne rend rien tant qu'aucune tache n'a ete creee", async () => {
    const projectId = await newProject();
    const session = await ensureProjectArchitectSession(db, projectId);
    assert.ok(session !== null);
    await playTurn(session.id, "PROPOSAL_READY");

    // Une proposition n'est pas une tache. Tant que personne n'a clique, il n'y
    // a rien a annoncer dans le fil.
    assert.deepEqual(await listArchitectSessionTasks(db, session.id), []);
  });

  it("rattache la tache a la generation qui l'a proposee", async () => {
    const projectId = await newProject();
    const session = await ensureProjectArchitectSession(db, projectId);
    assert.ok(session !== null);
    const generationId = await playTurn(session.id, "PROPOSAL_READY");
    const taskId = await createTaskFrom(projectId, generationId, "Filtrer les livres");

    const events = await listArchitectSessionTasks(db, session.id);

    assert.equal(events.length, 1);
    assert.equal(events[0]?.generationId, generationId);
    assert.equal(events[0]?.taskId, taskId);
    assert.equal(events[0]?.title, "Filtrer les livres");
    assert.match(events[0]?.code ?? "", /^TASK-\d{3,}$/u);
  });

  it("rend deux taches, chacune sur sa generation, dans l'ordre des tours", async () => {
    const projectId = await newProject();
    const session = await ensureProjectArchitectSession(db, projectId);
    assert.ok(session !== null);

    const first = await playTurn(session.id, "PROPOSAL_READY", "Premiere demande.");
    await createTaskFrom(projectId, first, "Premiere tache");
    await playTurn(session.id, "CONTINUE", "On discute.");
    const second = await playTurn(session.id, "PROPOSAL_READY", "Seconde demande.");
    await createTaskFrom(projectId, second, "Seconde tache");

    const events = await listArchitectSessionTasks(db, session.id);

    assert.deepEqual(
      events.map((event) => event.title),
      ["Premiere tache", "Seconde tache"],
    );
    assert.deepEqual(
      events.map((event) => event.generationId),
      [first, second],
    );
  });

  it("ignore les taches des autres conversations", async () => {
    const projectId = await newProject();
    const session = await ensureProjectArchitectSession(db, projectId);
    assert.ok(session !== null);
    const generationId = await playTurn(session.id, "PROPOSAL_READY");
    await createTaskFrom(projectId, generationId, "Une tache");

    const otherProject = await newProject();
    const other = await ensureProjectArchitectSession(db, otherProject);
    assert.ok(other !== null);

    assert.deepEqual(await listArchitectSessionTasks(db, other.id), []);
  });

  it("ne rend pas une generation reservee dont la creation a echoue", async () => {
    const projectId = await newProject();
    const session = await ensureProjectArchitectSession(db, projectId);
    assert.ok(session !== null);
    const generationId = await playTurn(session.id, "PROPOSAL_READY");

    assert.equal((await claimArchitectGeneration(db, generationId)).ok, true);
    assert.equal(await releaseArchitectGeneration(db, generationId), true);

    // Reservee puis rendue : rien n'a ete cree, donc rien ne s'affiche.
    assert.deepEqual(await listArchitectSessionTasks(db, session.id), []);
  });

  it("ne rend aucune tache pour une session de conception", async () => {
    // Son verrou porte sur la session, pas sur la generation : son affichage
    // reste exactement celui d'avant, sans evenement.
    const projectId = await newProject();
    const legacy = await createArchitectSession(db, {
      projectId,
      requestText: "Je veux une tache.",
    });
    assert.ok(legacy !== null);
    await playTurn(legacy.id, "PROPOSAL_READY");

    assert.deepEqual(await listArchitectSessionTasks(db, legacy.id), []);
  });
});
