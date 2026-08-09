/**
 * Tests des sessions et generations Architecte.
 *
 * Base temporaire, isolee, detruite a la fin. Le package **compile** est importe
 * volontairement : c'est l'artefact que le web consomme reellement.
 *
 * Les deux tests centraux de ce fichier sont ceux des verrous : une generation a
 * la fois, une tache par session — y compris quand deux appels arrivent en meme
 * temps.
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
  ARCHITECT_LIMITS,
  ARCHITECT_SESSION_STATUS,
  type ArchitectContextManifest,
  type ArchitectTaskProposal,
} from "@nox/shared";

import {
  attachArchitectTask,
  claimArchitectSession,
  createArchitectSession,
  createDatabaseClient,
  createProject,
  createTask,
  finishArchitectGeneration,
  formatArchitectSessionCode,
  getArchitectSession,
  latestArchitectProposal,
  latestArchitectQuestions,
  listArchitectSessions,
  releaseArchitectSession,
  saveArchitectClarification,
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
  sources: [
    {
      kind: "DOCUMENT",
      identifier: "docs/ARCHITECTURE.md",
      revision: "a".repeat(64),
      includedChars: 1_000,
      truncated: false,
    },
  ],
  totalChars: 1_000,
  missing: ["AGENTS.md"],
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
  validationCommands: ["npm run test"],
  assumptions: ["Une hypothese."],
  questions: [],
};

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

/** Projet neuf, pour que chaque test parte d'un compteur vierge. */
async function newProject(): Promise<string> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  return project.id;
}

/** Session ouverte sur un projet neuf. */
async function newSession(): Promise<{ projectId: string; sessionId: string }> {
  const projectId = await newProject();
  const session = await createArchitectSession(db, {
    projectId,
    requestText: "Je veux exporter les taches en JSON.",
  });
  assert.ok(session !== null);
  return { projectId, sessionId: session.id };
}

/** Session portant une proposition prete, telle qu'une generation la laisse. */
async function readySession(): Promise<{ projectId: string; sessionId: string }> {
  const { projectId, sessionId } = await newSession();
  const started = await startArchitectGeneration(db, {
    sessionId,
    model: "modele",
    promptVersion: "architect/1",
    inputHash: "a".repeat(64),
    manifest: MANIFEST,
  });
  assert.ok(started.ok);
  await finishArchitectGeneration(db, {
    generationId: started.generation.id,
    status: ARCHITECT_GENERATION_STATUS.PROPOSAL_READY,
    proposal: PROPOSAL,
    questions: [],
  });
  return { projectId, sessionId };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-architect-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("createArchitectSession", () => {
  it("cree une session ouverte", async () => {
    const projectId = await newProject();
    const session = await createArchitectSession(db, {
      projectId,
      requestText: "Une demande.",
    });

    assert.ok(session !== null);
    assert.equal(session.status, ARCHITECT_SESSION_STATUS.OPEN);
    assert.equal(session.code, "ARCH-001");
    assert.equal(session.generationCount, 0);
    assert.equal(session.generationsLeft, ARCHITECT_LIMITS.generations);
    assert.equal(session.appliedTaskId, null);
  });

  it("numerote les sessions d'un projet", async () => {
    const projectId = await newProject();
    await createArchitectSession(db, { projectId, requestText: "Une." });
    const second = await createArchitectSession(db, { projectId, requestText: "Deux." });

    assert.equal(second?.code, "ARCH-002");
  });

  it("refuse un projet inconnu", async () => {
    assert.equal(
      await createArchitectSession(db, { projectId: "inexistant", requestText: "Une." }),
      null,
    );
  });

  it("formate un code de session", () => {
    assert.equal(formatArchitectSessionCode(7), "ARCH-007");
    assert.equal(formatArchitectSessionCode(1_234), "ARCH-1234");
  });
});

describe("startArchitectGeneration", () => {
  it("reserve la premiere generation", async () => {
    const { sessionId } = await newSession();
    const started = await startArchitectGeneration(db, {
      sessionId,
      model: "modele",
      promptVersion: "architect/1",
      inputHash: "a".repeat(64),
      manifest: MANIFEST,
    });

    assert.ok(started.ok);
    assert.equal(started.generation.sequence, 1);
    assert.equal(started.generation.status, ARCHITECT_GENERATION_STATUS.RUNNING);
    assert.deepEqual(started.generation.manifest, MANIFEST);
  });

  it("numerote les generations d'une session", async () => {
    const { sessionId } = await newSession();
    const first = await startArchitectGeneration(db, {
      sessionId,
      model: "modele",
      promptVersion: "architect/1",
      inputHash: "a".repeat(64),
      manifest: MANIFEST,
    });
    assert.ok(first.ok);
    await finishArchitectGeneration(db, {
      generationId: first.generation.id,
      status: ARCHITECT_GENERATION_STATUS.NEEDS_INPUT,
      questions: ["Une question ?"],
    });

    const second = await startArchitectGeneration(db, {
      sessionId,
      model: "modele",
      promptVersion: "architect/1",
      inputHash: "b".repeat(64),
      manifest: MANIFEST,
    });

    assert.ok(second.ok);
    assert.equal(second.generation.sequence, 2);
  });

  it("refuse une seconde generation pendant qu'une tourne", async () => {
    const { sessionId } = await newSession();
    const first = await startArchitectGeneration(db, {
      sessionId,
      model: "modele",
      promptVersion: "architect/1",
      inputHash: "a".repeat(64),
      manifest: MANIFEST,
    });
    assert.ok(first.ok);

    const second = await startArchitectGeneration(db, {
      sessionId,
      model: "modele",
      promptVersion: "architect/1",
      inputHash: "b".repeat(64),
      manifest: MANIFEST,
    });

    assert.equal(second.ok, false);
    assert.equal(second.ok ? null : second.reason, "active");
  });

  it("ne laisse qu'une seule generation naitre d'un double clic", async () => {
    const { sessionId } = await newSession();
    const input = {
      sessionId,
      model: "modele",
      promptVersion: "architect/1",
      inputHash: "a".repeat(64),
      manifest: MANIFEST,
    };

    const [left, right] = await Promise.all([
      startArchitectGeneration(db, input),
      startArchitectGeneration(db, input),
    ]);

    assert.equal([left, right].filter((result) => result.ok).length, 1);
  });

  it("borne le nombre de generations d'une session", async () => {
    const { sessionId } = await newSession();

    for (let index = 0; index < ARCHITECT_LIMITS.generations; index += 1) {
      const started = await startArchitectGeneration(db, {
        sessionId,
        model: "modele",
        promptVersion: "architect/1",
        inputHash: "a".repeat(64),
        manifest: MANIFEST,
      });
      assert.ok(started.ok, `generation ${String(index + 1)} refusee`);
      await finishArchitectGeneration(db, {
        generationId: started.generation.id,
        status: ARCHITECT_GENERATION_STATUS.FAILED,
        errorCode: "ARCHITECT_TIMEOUT",
      });
    }

    const extra = await startArchitectGeneration(db, {
      sessionId,
      model: "modele",
      promptVersion: "architect/1",
      inputHash: "a".repeat(64),
      manifest: MANIFEST,
    });

    // Les echecs comptent : sans cela, une boucle d'erreurs serait infinie.
    assert.equal(extra.ok ? null : extra.reason, "limit");
  });

  it("refuse une session inconnue", async () => {
    const result = await startArchitectGeneration(db, {
      sessionId: "inexistante",
      model: "modele",
      promptVersion: "architect/1",
      inputHash: "a".repeat(64),
      manifest: MANIFEST,
    });
    assert.equal(result.ok ? null : result.reason, "not_found");
  });
});

describe("finishArchitectGeneration", () => {
  it("enregistre une proposition et fait suivre la session", async () => {
    const { sessionId } = await readySession();
    const session = await getArchitectSession(db, sessionId);

    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.PROPOSAL_READY);
    assert.equal(session?.generations[0]?.status, ARCHITECT_GENERATION_STATUS.PROPOSAL_READY);
    assert.deepEqual(session?.generations[0]?.proposal, PROPOSAL);
  });

  it("enregistre la consommation rapportee", async () => {
    const { sessionId } = await newSession();
    const started = await startArchitectGeneration(db, {
      sessionId,
      model: "modele",
      promptVersion: "architect/1",
      inputHash: "a".repeat(64),
      manifest: MANIFEST,
    });
    assert.ok(started.ok);

    const finished = await finishArchitectGeneration(db, {
      generationId: started.generation.id,
      status: ARCHITECT_GENERATION_STATUS.PROPOSAL_READY,
      proposal: PROPOSAL,
      providerResponseId: "resp_abc",
      usage: {
        inputTokens: 1_200,
        outputTokens: 300,
        totalTokens: 1_500,
        cachedInputTokens: null,
      },
    });

    assert.equal(finished?.providerResponseId, "resp_abc");
    assert.equal(finished?.usage.totalTokens, 1_500);
    // Une valeur absente le reste : rien n'est estime.
    assert.equal(finished?.usage.cachedInputTokens, null);
  });

  it("enregistre les questions d'une demande de precisions", async () => {
    const { sessionId } = await newSession();
    const started = await startArchitectGeneration(db, {
      sessionId,
      model: "modele",
      promptVersion: "architect/1",
      inputHash: "a".repeat(64),
      manifest: MANIFEST,
    });
    assert.ok(started.ok);

    await finishArchitectGeneration(db, {
      generationId: started.generation.id,
      status: ARCHITECT_GENERATION_STATUS.NEEDS_INPUT,
      questions: ["Tous les projets ?", "Format stable ?"],
    });

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.NEEDS_INPUT);
    assert.deepEqual(latestArchitectQuestions(session!), ["Tous les projets ?", "Format stable ?"]);
  });

  it("enregistre un code d'erreur", async () => {
    const { sessionId } = await newSession();
    const started = await startArchitectGeneration(db, {
      sessionId,
      model: "modele",
      promptVersion: "architect/1",
      inputHash: "a".repeat(64),
      manifest: MANIFEST,
    });
    assert.ok(started.ok);

    const finished = await finishArchitectGeneration(db, {
      generationId: started.generation.id,
      status: ARCHITECT_GENERATION_STATUS.REFUSED,
      errorCode: "ARCHITECT_REFUSED",
    });

    assert.equal(finished?.errorCode, "ARCHITECT_REFUSED");
    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.FAILED);
  });

  it("refuse de reecrire une generation terminee", async () => {
    const { sessionId } = await readySession();
    const session = await getArchitectSession(db, sessionId);
    const generationId = session?.generations[0]?.id ?? "";

    const second = await finishArchitectGeneration(db, {
      generationId,
      status: ARCHITECT_GENERATION_STATUS.FAILED,
      errorCode: "ARCHITECT_TIMEOUT",
    });

    // Une generation terminee est un fait : elle a consomme des jetons.
    assert.equal(second, null);
    const after = await getArchitectSession(db, sessionId);
    assert.equal(after?.generations[0]?.status, ARCHITECT_GENERATION_STATUS.PROPOSAL_READY);
  });
});

describe("getArchitectSession", () => {
  it("rend les generations de la plus recente a la plus ancienne", async () => {
    const { sessionId } = await newSession();

    for (const hash of ["a", "b", "c"]) {
      const started = await startArchitectGeneration(db, {
        sessionId,
        model: "modele",
        promptVersion: "architect/1",
        inputHash: hash.repeat(64),
        manifest: MANIFEST,
      });
      assert.ok(started.ok);
      await finishArchitectGeneration(db, {
        generationId: started.generation.id,
        status: ARCHITECT_GENERATION_STATUS.NEEDS_INPUT,
        questions: [`Question ${hash} ?`],
      });
    }

    const session = await getArchitectSession(db, sessionId);
    assert.deepEqual(
      session?.generations.map((generation) => generation.sequence),
      [3, 2, 1],
    );
  });

  it("rend null pour une session inconnue", async () => {
    assert.equal(await getArchitectSession(db, "inexistante"), null);
  });

  it("trouve la derniere proposition", async () => {
    const { sessionId } = await readySession();
    const session = await getArchitectSession(db, sessionId);

    assert.equal(latestArchitectProposal(session!)?.proposal?.title, "Exporter les taches");
  });
});

describe("saveArchitectClarification", () => {
  it("enregistre les precisions", async () => {
    const { sessionId } = await newSession();
    assert.equal(await saveArchitectClarification(db, sessionId, "Oui, tous les projets."), true);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.clarificationText, "Oui, tous les projets.");
  });

  it("refuse de modifier une session appliquee", async () => {
    const { sessionId } = await readySession();
    assert.ok((await claimArchitectSession(db, sessionId)).ok);

    assert.equal(await saveArchitectClarification(db, sessionId, "Trop tard."), false);
  });
});

describe("claimArchitectSession", () => {
  it("reserve une session prete", async () => {
    const { sessionId } = await readySession();
    assert.deepEqual(await claimArchitectSession(db, sessionId), { ok: true });

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.APPLIED);
    // La tache n'existe pas encore : le rattachement est une seconde etape.
    assert.equal(session?.appliedTaskId, null);
  });

  it("refuse une session sans proposition prete", async () => {
    const { sessionId } = await newSession();
    const result = await claimArchitectSession(db, sessionId);
    assert.equal(result.ok ? null : result.reason, "not_ready");
  });

  it("refuse une seconde reservation", async () => {
    const { sessionId } = await readySession();
    assert.ok((await claimArchitectSession(db, sessionId)).ok);

    const second = await claimArchitectSession(db, sessionId);
    assert.equal(second.ok ? null : second.reason, "already_applied");
  });

  it("ne laisse qu'une seule reservation naitre d'un double clic", async () => {
    const { sessionId } = await readySession();

    const [left, right] = await Promise.all([
      claimArchitectSession(db, sessionId),
      claimArchitectSession(db, sessionId),
    ]);

    assert.equal([left, right].filter((result) => result.ok).length, 1);
  });

  it("refuse une session inconnue", async () => {
    const result = await claimArchitectSession(db, "inexistante");
    assert.equal(result.ok ? null : result.reason, "not_found");
  });
});

describe("attachArchitectTask et releaseArchitectSession", () => {
  it("rattache la tache creee", async () => {
    const { projectId, sessionId } = await readySession();
    assert.ok((await claimArchitectSession(db, sessionId)).ok);

    const task = await createTask(db, {
      projectId,
      title: "Exporter les taches",
      objective: "Un objectif.",
      context: null,
      outOfScope: null,
      priority: "MEDIUM",
      acceptanceCriteria: ["Un critere."],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(task !== null);

    assert.equal(await attachArchitectTask(db, sessionId, task.id), true);
    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.appliedTaskId, task.id);
  });

  it("rend la main quand la creation n'a pas abouti", async () => {
    const { sessionId } = await readySession();
    assert.ok((await claimArchitectSession(db, sessionId)).ok);

    assert.equal(await releaseArchitectSession(db, sessionId), true);
    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.PROPOSAL_READY);
  });

  it("ne rouvre jamais une session dont la tache existe", async () => {
    const { projectId, sessionId } = await readySession();
    assert.ok((await claimArchitectSession(db, sessionId)).ok);

    const task = await createTask(db, {
      projectId,
      title: "Une tache",
      objective: "Un objectif.",
      context: null,
      outOfScope: null,
      priority: "MEDIUM",
      acceptanceCriteria: ["Un critere."],
      documentReferences: [],
      validationCommands: [],
    });
    assert.ok(task !== null);
    await attachArchitectTask(db, sessionId, task.id);

    assert.equal(await releaseArchitectSession(db, sessionId), false);
    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.APPLIED);
  });
});

describe("listArchitectSessions", () => {
  it("liste les sessions d'un projet, de la plus recente a la plus ancienne", async () => {
    const projectId = await newProject();
    await createArchitectSession(db, { projectId, requestText: "Une." });
    await createArchitectSession(db, { projectId, requestText: "Deux." });

    const sessions = await listArchitectSessions(db, projectId);
    assert.deepEqual(
      sessions.map((session) => session.code),
      ["ARCH-002", "ARCH-001"],
    );
  });

  it("ne melange pas deux projets", async () => {
    const first = await newProject();
    const second = await newProject();
    await createArchitectSession(db, { projectId: first, requestText: "Une." });

    assert.deepEqual(await listArchitectSessions(db, second), []);
  });
});
