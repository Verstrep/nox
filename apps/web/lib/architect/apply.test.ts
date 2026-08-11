/**
 * Tests de la creation de tache depuis une proposition.
 *
 * Base temporaire, sans runner ni repository. Ce qui est verifie ici, c'est le
 * **contrat de creation** — un clic, une tache, en brouillon — et rien de ce que
 * TASK-007 garantit deja. La synchronisation du document appartient a
 * l'appelant, comme dans la creation ordinaire.
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
  ARCHITECT_SESSION_STATUS,
  TASK_STATUS,
  type ArchitectContextManifest,
  type ArchitectTaskProposal,
} from "@nox/shared";
import {
  createArchitectSession,
  createDatabaseClient,
  createProject,
  finishArchitectGeneration,
  getArchitectSession,
  getTaskById,
  listTasksByProject,
  saveArchitectTurnDraft,
  startArchitectGeneration,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
} from "@nox/database";

import type { TaskFormValues } from "../task-input.ts";
import { applyArchitectProposal } from "./apply.ts";
import { proposalToFormValues } from "./display.ts";

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

const MANIFEST: ArchitectContextManifest = {
  schemaVersion: 1,
  sources: [],
  totalChars: 0,
  missing: [],
};

const PROPOSAL: ArchitectTaskProposal = {
  schemaVersion: 1,
  status: "PROPOSAL_READY",
  title: "Exporter les taches d'un projet en JSON",
  priority: "HIGH",
  objective: "Permettre le telechargement des taches d'un projet.",
  context: "Le backlog n'est consultable que depuis l'interface.",
  acceptanceCriteria: ["Un bouton telecharge un fichier JSON.", "Le fichier contient les codes."],
  outOfScope: ["Import JSON"],
  documentReferences: ["docs/ARCHITECTURE.md"],
  validationCommands: ["npm run test"],
  assumptions: ["Le format n'a pas besoin d'etre stable."],
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

/** Session portant une proposition prete, sur un projet neuf. */
async function readySession(
  proposal: ArchitectTaskProposal = PROPOSAL,
): Promise<{ projectId: string; sessionId: string; repositoryPath: string }> {
  counter += 1;
  const repositoryPath = path.join(workspace, `depot-${String(counter)}`);
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath,
  });

  const session = await createArchitectSession(db, {
    projectId: project.id,
    requestText: "Je veux exporter les taches en JSON.",
  });
  assert.ok(session !== null);

  await saveArchitectTurnDraft(db, {
    sessionId: session.id,
    messageText: "Propose-moi une tache.",
    contextFingerprint: "f".repeat(64),
    manifest: MANIFEST,
  });
  const started = await startArchitectGeneration(db, {
    sessionId: session.id,
    model: "modele",
    promptVersion: "architect/2",
    inputHash: "a".repeat(64),
    contextFingerprint: "f".repeat(64),
    manifest: MANIFEST,
  });
  assert.ok(started.ok);
  await finishArchitectGeneration(db, {
    generationId: started.generation.id,
    status: ARCHITECT_GENERATION_STATUS.PROPOSAL_READY,
    turnState: "PROPOSAL_READY",
    proposal,
    messages: [
      { role: "USER", content: "Propose-moi une tache." },
      { role: "ARCHITECT", content: "Voici le plus petit increment." },
    ],
  });

  return { projectId: project.id, sessionId: session.id, repositoryPath };
}

function values(overrides: Partial<TaskFormValues> = {}): TaskFormValues {
  return { ...proposalToFormValues(PROPOSAL), ...overrides };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-apply-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("applyArchitectProposal — creation", () => {
  it("cree une tache en brouillon", async () => {
    const { projectId, sessionId } = await readySession();

    const applied = await applyArchitectProposal(db, { sessionId, projectId, values: values() });

    assert.ok(applied.ok);
    const task = await getTaskById(db, applied.task.id);
    assert.equal(task?.status, TASK_STATUS.DRAFT);
    assert.equal(task?.title, "Exporter les taches d'un projet en JSON");
    assert.equal(task?.priority, "HIGH");
    assert.deepEqual(task?.acceptanceCriteria, [
      "Un bouton telecharge un fichier JSON.",
      "Le fichier contient les codes.",
    ]);
    assert.deepEqual(task?.validationCommands, ["npm run test"]);
  });

  it("attribue un code de tache monotone", async () => {
    const { projectId, sessionId } = await readySession();
    const first = await applyArchitectProposal(db, { sessionId, projectId, values: values() });
    assert.ok(first.ok);

    const second = await readySession();
    // Deuxieme session, deuxieme projet : chaque projet a sa propre suite.
    const applied = await applyArchitectProposal(db,
      {
        sessionId: second.sessionId,
        projectId: second.projectId,
        values: values(),
      },
    );
    assert.ok(applied.ok);

    const task = await getTaskById(db, applied.task.id);
    assert.equal(task?.code, "TASK-001");
  });

  it("relie la session a la tache creee", async () => {
    const { projectId, sessionId } = await readySession();
    const applied = await applyArchitectProposal(db, { sessionId, projectId, values: values() });
    assert.ok(applied.ok);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.APPLIED);
    assert.equal(session?.appliedTaskId, applied.task.id);
  });

  it("conserve les modifications humaines", async () => {
    const { projectId, sessionId } = await readySession();

    const applied = await applyArchitectProposal(db,
      {
        sessionId,
        projectId,
        values: values({
          title: "Titre reecrit a la main",
          criteria: "Critere modifie par un humain",
          priority: "LOW",
        }),
      },
    );
    assert.ok(applied.ok);

    const task = await getTaskById(db, applied.task.id);
    assert.equal(task?.title, "Titre reecrit a la main");
    assert.deepEqual(task?.acceptanceCriteria, ["Critere modifie par un humain"]);
    assert.equal(task?.priority, "LOW");
  });
});

describe("applyArchitectProposal — une seule tache", () => {
  it("refuse une seconde creation", async () => {
    const { projectId, sessionId } = await readySession();
    const input = { sessionId, projectId, values: values() };

    assert.ok((await applyArchitectProposal(db, input)).ok);
    const second = await applyArchitectProposal(db, input);

    assert.equal(second.ok, false);
    assert.ok(second.ok ? "" : second.message.includes("deja produit une tache"));
  });

  it("ne cree qu'une tache sur double clic concurrent", async () => {
    const { projectId, sessionId } = await readySession();
    const input = { sessionId, projectId, values: values() };

    const [left, right] = await Promise.all([
      applyArchitectProposal(db, input),
      applyArchitectProposal(db, input),
    ]);

    assert.equal([left, right].filter((result) => result.ok).length, 1);
    assert.equal((await listTasksByProject(db, projectId)).length, 1);
  });

  it("refuse une session sans proposition prete", async () => {
    counter += 1;
    const repositoryPath = path.join(workspace, `depot-vide-${String(counter)}`);
    const project = await createProject(db, {
      name: `Projet vide ${String(counter)}`,
      description: null,
      repositoryPath,
    });
    const session = await createArchitectSession(db, {
      projectId: project.id,
      requestText: "Une demande.",
    });
    assert.ok(session !== null);

    const result = await applyArchitectProposal(db,
      { sessionId: session.id, projectId: project.id, values: values() },
    );

    assert.equal(result.ok, false);
    assert.ok(result.ok ? "" : result.message.includes("aucune proposition prete"));
  });
});

describe("applyArchitectProposal — revalidation", () => {
  it("refuse un titre vide", async () => {
    const { projectId, sessionId } = await readySession();
    const result = await applyArchitectProposal(db,
      { sessionId, projectId, values: values({ title: "   " }) },
    );

    assert.equal(result.ok, false);
    // La validation precede la reservation : la session reste utilisable.
    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.PROPOSAL_READY);
  });

  it("refuse une tache sans critere", async () => {
    const { projectId, sessionId } = await readySession();
    const result = await applyArchitectProposal(db,
      { sessionId, projectId, values: values({ criteria: "" }) },
    );
    assert.equal(result.ok, false);
  });

  it("refuse un chemin de document sortant du repository", async () => {
    const { projectId, sessionId } = await readySession();
    const result = await applyArchitectProposal(db,
      { sessionId, projectId, values: values({ documents: "../../secret.md" }) },
    );
    assert.equal(result.ok, false);
  });

  it("refuse une commande de validation dangereuse", async () => {
    const { projectId, sessionId } = await readySession();
    const result = await applyArchitectProposal(db,
      {
        sessionId,
        projectId,
        values: values({ commands: "npm run test && rm -rf /" }),
      },
    );

    assert.equal(result.ok, false);
    assert.ok(result.ok ? "" : result.message.includes("ne peut pas etre autorisee"));
  });

  it("refuse une commande d'ecriture Git ajoutee a la main", async () => {
    const { projectId, sessionId } = await readySession();
    const result = await applyArchitectProposal(db,
      { sessionId, projectId, values: values({ commands: "git push" }) },
    );
    assert.equal(result.ok, false);
  });

  it("refuse un projet inconnu", async () => {
    const { sessionId } = await readySession();
    const result = await applyArchitectProposal(db,
      { sessionId, projectId: "inexistant", values: values() },
    );

    assert.equal(result.ok, false);
    // La session est rendue a son etat precedent : rien n'a ete consomme.
    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.PROPOSAL_READY);
  });
});
