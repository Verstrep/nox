/**
 * Tests de l'orchestration d'une generation.
 *
 * Base temporaire, faux fournisseur, ports de repository simules : **aucun
 * appel reseau, aucun quota consomme**. Ce qui est verifie ici, c'est
 * l'enchainement — ce qui est reserve, ce qui est appele, ce qui est enregistre —
 * et surtout ce qui ne l'est pas.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHITECT_ERROR,
  ARCHITECT_GENERATION_STATUS,
  ARCHITECT_LIMITS,
  ARCHITECT_SCHEMA_NAME,
  ARCHITECT_SESSION_STATUS,
} from "@nox/shared";
import {
  createArchitectSession,
  createDatabaseClient,
  createProject,
  getArchitectSession,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
} from "@nox/database";

import { FakeArchitectProvider, type ArchitectProviderResult } from "./provider.ts";
import { fetchArchitectContext, runArchitectGeneration, type ArchitectRepositoryPorts } from "./service.ts";

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
  NOX_RUNNER_TOKEN: "jeton-runner-de-test-0123456789",
};

const PROPOSAL_JSON = {
  schemaVersion: 1,
  status: "PROPOSAL_READY",
  title: "Exporter les taches",
  priority: "MEDIUM",
  objective: "Un objectif.",
  context: null,
  acceptanceCriteria: ["Un critere."],
  outOfScope: [],
  documentReferences: ["docs/ARCHITECTURE.md"],
  validationCommands: ["npm run test"],
  assumptions: [],
  questions: [],
};

const QUESTIONS_JSON = {
  ...PROPOSAL_JSON,
  status: "NEEDS_INPUT",
  title: null,
  priority: null,
  objective: null,
  acceptanceCriteria: [],
  documentReferences: [],
  validationCommands: [],
  questions: ["La fonctionnalite couvre-t-elle tous les projets ?"],
};

function success(raw: unknown): ArchitectProviderResult {
  return {
    ok: true,
    value: {
      raw,
      responseId: "resp_test",
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: null },
    },
  };
}

/** Ports simules : un inventaire et deux documents, sans runner. */
function ports(overrides: Partial<ArchitectRepositoryPorts> = {}): ArchitectRepositoryPorts {
  return {
    listDocuments: () =>
      Promise.resolve({
        ok: true,
        value: [
          {
            path: "CLAUDE.md",
            name: "CLAUDE.md",
            category: "CORE",
            size: 10,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
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
        value: { path: documentPath, content: `# ${documentPath}`, revision: "a".repeat(64) },
      }),
    ...overrides,
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

async function newSession(): Promise<{ projectId: string; sessionId: string }> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  const session = await createArchitectSession(db, {
    projectId: project.id,
    requestText: "Je veux exporter les taches en JSON.",
  });
  assert.ok(session !== null);
  return { projectId: project.id, sessionId: session.id };
}

function generate(
  sessionId: string,
  provider: FakeArchitectProvider,
  overrides: Partial<Parameters<typeof runArchitectGeneration>[1]> = {},
) {
  return runArchitectGeneration(db, {
    sessionId,
    projectName: "NOX",
    repositoryPath: path.join(workspace, "depot"),
    request: "Je veux exporter les taches en JSON.",
    clarification: null,
    previousQuestions: [],
    tasks: [],
    model: "modele-de-test",
    provider,
    environment: ENVIRONMENT,
    ports: ports(),
    ...overrides,
  });
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-arch-service-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("fetchArchitectContext", () => {
  it("ne lit que les documents de la liste fermee presents", async () => {
    const read: string[] = [];
    const result = await fetchArchitectContext(
      "/depot",
      ports({
        readDocument: (_repository, documentPath) => {
          read.push(documentPath);
          return Promise.resolve({
            ok: true,
            value: { path: documentPath, content: "#", revision: "a".repeat(64) },
          });
        },
      }),
    );

    assert.ok(result.ok);
    // L'inventaire ne contient que deux entrees : aucune autre lecture n'a lieu.
    assert.deepEqual(read, ["CLAUDE.md", "docs/ARCHITECTURE.md"]);
  });

  it("refuse quand l'inventaire est indisponible", async () => {
    const result = await fetchArchitectContext(
      "/depot",
      ports({
        listDocuments: () =>
          Promise.resolve({ ok: false, failure: { kind: "unreachable" } }),
      }),
    );

    // Sans inventaire, NOX ne sait pas ce qu'il enverrait : refuser vaut mieux.
    assert.equal(result.ok, false);
  });

  it("traite un document illisible comme absent", async () => {
    const result = await fetchArchitectContext(
      "/depot",
      ports({
        readDocument: (_repository, documentPath) =>
          documentPath === "CLAUDE.md"
            ? Promise.resolve({ ok: false, failure: { kind: "unreachable" } })
            : Promise.resolve({
                ok: true,
                value: { path: documentPath, content: "#", revision: "a".repeat(64) },
              }),
      }),
    );

    assert.ok(result.ok);
    assert.deepEqual(
      result.context.documents.map((document) => document.path),
      ["docs/ARCHITECTURE.md"],
    );
  });
});

describe("runArchitectGeneration — succes", () => {
  it("enregistre une proposition et fait suivre la session", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(PROPOSAL_JSON)]);

    const outcome = await generate(sessionId, provider);

    assert.ok(outcome.ok);
    assert.equal(outcome.proposal.title, "Exporter les taches");
    assert.equal(outcome.generation.status, ARCHITECT_GENERATION_STATUS.PROPOSAL_READY);
    assert.equal(outcome.generation.usage.totalTokens, 120);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.PROPOSAL_READY);
  });

  it("enregistre une demande de precisions", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(QUESTIONS_JSON)]);

    const outcome = await generate(sessionId, provider);

    assert.ok(outcome.ok);
    assert.equal(outcome.generation.status, ARCHITECT_GENERATION_STATUS.NEEDS_INPUT);
    assert.deepEqual(outcome.generation.questions, [
      "La fonctionnalite couvre-t-elle tous les projets ?",
    ]);
  });

  it("transmet un contexte nettoye et un schema strict", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(PROPOSAL_JSON)]);

    await generate(sessionId, provider);

    const call = provider.calls[0];
    assert.ok(call);
    assert.equal(call.model, "modele-de-test");
    assert.equal(call.schemaName, ARCHITECT_SCHEMA_NAME);
    assert.ok(call.input.includes("Je veux exporter les taches en JSON."));
    // Ni cle, ni jeton, ni chemin absolu ne peuvent atteindre le fournisseur.
    assert.equal(call.input.includes("cle-architecte-de-test-9876543210"), false);
    assert.equal(call.input.includes("jeton-runner-de-test-0123456789"), false);
    assert.equal(JSON.stringify(call).includes(workspace), false);
  });

  it("enregistre le manifest du contexte envoye", async () => {
    const { sessionId } = await newSession();
    await generate(sessionId, new FakeArchitectProvider([success(PROPOSAL_JSON)]));

    const session = await getArchitectSession(db, sessionId);
    const manifest = session?.generations[0]?.manifest;

    assert.ok(manifest);
    assert.deepEqual(
      manifest.sources.map((source) => source.identifier),
      ["CLAUDE.md", "docs/ARCHITECTURE.md"],
    );
    assert.ok(manifest.missing.includes("docs/DECISIONS.md"));
  });
});

describe("runArchitectGeneration — refus", () => {
  it("conclut une generation en echec sans laisser le verrou pose", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_TIMEOUT },
      success(PROPOSAL_JSON),
    ]);

    const failed = await generate(sessionId, provider);
    assert.equal(failed.ok, false);

    // Le verrou doit etre rendu : sinon la session serait bloquee pour toujours.
    const retried = await generate(sessionId, provider);
    assert.ok(retried.ok);
  });

  it("distingue un refus du modele d'une panne", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_REFUSED },
    ]);

    await generate(sessionId, provider);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.generations[0]?.status, ARCHITECT_GENERATION_STATUS.REFUSED);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.FAILED);
  });

  it("refuse une reponse qui ne passe pas la validation NOX", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([
      success({ ...PROPOSAL_JSON, documentReferences: ["docs/INVENTED.md"] }),
    ]);

    const outcome = await generate(sessionId, provider);

    assert.equal(outcome.ok, false);
    assert.equal(
      "code" in outcome ? outcome.code : null,
      ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
    );

    const session = await getArchitectSession(db, sessionId);
    // La consommation est enregistree malgre tout : l'appel a bien eu lieu.
    assert.equal(session?.generations[0]?.usage.totalTokens, 120);
  });

  it("refuse une commande de validation dangereuse", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([
      success({ ...PROPOSAL_JSON, validationCommands: ["npm run test && rm -rf /"] }),
    ]);

    const outcome = await generate(sessionId, provider);
    assert.equal(outcome.ok, false);
  });

  it("n'appelle pas le fournisseur quand le contexte est illisible", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(PROPOSAL_JSON)]);

    const outcome = await generate(sessionId, provider, {
      ports: ports({
        listDocuments: () => Promise.resolve({ ok: false, failure: { kind: "unreachable" } }),
      }),
    });

    assert.equal(outcome.ok, false);
    // Aucun appel, aucune generation consommee : la session est intacte.
    assert.equal(provider.calls.length, 0);
    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.generationCount, 0);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.OPEN);
  });

  it("refuse au-dela de la borne de generations", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider(
      Array.from({ length: ARCHITECT_LIMITS.generations + 1 }, () => success(PROPOSAL_JSON)),
    );

    for (let index = 0; index < ARCHITECT_LIMITS.generations; index += 1) {
      assert.ok((await generate(sessionId, provider)).ok, `generation ${String(index + 1)}`);
    }

    const extra = await generate(sessionId, provider);
    assert.equal(
      "code" in extra ? extra.code : null,
      ARCHITECT_ERROR.ARCHITECT_GENERATION_LIMIT,
    );
    assert.equal(provider.calls.length, ARCHITECT_LIMITS.generations);
  });

  it("ne lance qu'un appel sur double clic concurrent", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(PROPOSAL_JSON), success(PROPOSAL_JSON)]);

    const [left, right] = await Promise.all([
      generate(sessionId, provider),
      generate(sessionId, provider),
    ]);

    assert.equal([left, right].filter((outcome) => outcome.ok).length, 1);
    assert.equal(provider.calls.length, 1);
  });
});
