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
  ARCHITECT_DIAGNOSTIC_FIELD,
  ARCHITECT_ERROR,
  ARCHITECT_GENERATION_STATUS,
  ARCHITECT_TURN_FAILURE,
  ARCHITECT_LIMITS,
  ARCHITECT_SCHEMA_NAME,
  ARCHITECT_SESSION_STATUS,
} from "@nox/shared";
import {
  createArchitectSession,
  ensureProjectArchitectSession,
  createDatabaseClient,
  createProject,
  getArchitectSession,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
} from "@nox/database";

import { FakeArchitectProvider, type ArchitectProviderResult } from "./provider.ts";
import {
  fetchArchitectContext,
  reviewArchitectTurn,
  sendArchitectMessage,
  sendArchitectTurn,
  type ArchitectRepositoryPorts,
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
  NOX_RUNNER_TOKEN: "jeton-runner-de-test-0123456789",
};

/** Tour de discussion : une reponse, des questions, aucune proposition. */
const CONTINUE_JSON = {
  schemaVersion: 2,
  state: "CONTINUE",
  message: "Deux options se presentent. Je recommande la seconde.",
  questions: ["La fonctionnalite couvre-t-elle tous les projets ?"],
  proposal: null,
};

/**
 * Tour de discussion d'une **conversation projet**.
 *
 * Version 3 : le contrat d'une session `PROJECT` depuis TASK-021. `projectUpdate`
 * y est toujours present, et vaut `null` quand le tour n'etablit rien de durable
 * — ce qui est le cas ordinaire.
 */
const CONTINUE_V3 = { ...CONTINUE_JSON, schemaVersion: 3, projectUpdate: null };

/** Tour portant une proposition complete. */
const READY_JSON = {
  schemaVersion: 2,
  state: "PROPOSAL_READY",
  message: "Voici le plus petit increment que je recommande.",
  questions: [],
  proposal: {
    title: "Exporter les taches",
    priority: "MEDIUM",
    objective: "Un objectif.",
    context: null,
    acceptanceCriteria: ["Un critere."],
    outOfScope: [],
    documentReferences: ["docs/ARCHITECTURE.md"],
    validationCommands: ["npm run test"],
    assumptions: [],
  },
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

/** Documents relus apres modification du projet. */
const REVISED = { revision: "b".repeat(64) };

/** Aucun brief, aucun plan : l'etat de depart de tout projet. */
const NO_STRUCTURED_STATE = {
  brief: { present: false, stored: null, prompt: null, revision: null, chars: 0 },
  plan: { present: false, stored: null, prompt: null, revision: null, chars: 0 },
  combinedChars: 0,
};

/**
 * Nettoyeur et revisions du test.
 *
 * Deterministes et sans `node:crypto` : ce test ne verifie pas la forme d'une
 * revision, seulement qu'elle circule au bon endroit.
 */
const PLAN_TOOLS = {
  sanitize: (value: string): string => value,
  revisions: {
    brief: (): string => "revision-brief-de-test",
    plan: (): string => "revision-plan-de-test",
  },
};

/**
 * Ports simules : un inventaire et deux documents, sans runner.
 *
 * `revision` permet de rejouer un projet modifie entre deux tours sans
 * toucher au disque.
 */
function ports(
  overrides: Partial<ArchitectRepositoryPorts> & { revision?: string } = {},
): ArchitectRepositoryPorts {
  const revision = overrides.revision ?? "a".repeat(64);
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
        value: {
          path: documentPath,
          content: `# ${documentPath}\n\nRevision ${revision.slice(0, 4)}.`,
          revision,
        },
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

type TurnOverrides = { ports?: ArchitectRepositoryPorts };

/** Prepare un tour : c'est `Review context`, et il n'appelle personne. */
async function review(sessionId: string, message: string, overrides: TurnOverrides = {}) {
  const session = await getArchitectSession(db, sessionId);
  assert.ok(session !== null);
  return reviewArchitectTurn(db, {
    session,
    projectName: "NOX",
    repositoryPath: path.join(workspace, "depot"),
    message,
    tasks: [],
    memories: [],
    structuredState: NO_STRUCTURED_STATE,
    projectId: session.projectId,
    planTools: PLAN_TOOLS,
    planningState: null,
    model: "modele-de-test",
    environment: ENVIRONMENT,
    ports: overrides.ports ?? ports(),
  });
}

/** Envoie le tour prepare : c'est `Send to Architect`. */
async function send(
  sessionId: string,
  provider: FakeArchitectProvider,
  overrides: TurnOverrides = {},
) {
  const session = await getArchitectSession(db, sessionId);
  assert.ok(session !== null);
  return sendArchitectTurn(db, {
    session,
    projectName: "NOX",
    repositoryPath: path.join(workspace, "depot"),
    tasks: [],
    memories: [],
    structuredState: NO_STRUCTURED_STATE,
    projectId: session.projectId,
    planTools: PLAN_TOOLS,
    planningState: null,
    model: "modele-de-test",
    provider,
    environment: ENVIRONMENT,
    ports: overrides.ports ?? ports(),
  });
}

/** Un tour complet : les deux clics, dans l'ordre. */
async function turn(
  sessionId: string,
  provider: FakeArchitectProvider,
  message = "Un message.",
  overrides: TurnOverrides = {},
) {
  const reviewed = await review(sessionId, message, overrides);
  assert.ok(reviewed.ok, "preparation refusee");
  return send(sessionId, provider, overrides);
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

describe("reviewArchitectTurn — preparation", () => {
  it("n'appelle jamais le fournisseur", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([]);

    const reviewed = await review(sessionId, "Je veux ameliorer la recherche.");

    assert.ok(reviewed.ok);
    assert.equal(provider.calls.length, 0);
  });

  it("enregistre le brouillon et l'empreinte du tour", async () => {
    // C'est l'empreinte de **tour** qui est retenue, et non celle du seul
    // contexte projet : un message envoye depuis un second onglet doit rendre
    // cet apercu perime, alors qu'il ne change aucun document.
    const { sessionId } = await newSession();
    const reviewed = await review(sessionId, "Je veux ameliorer la recherche.");
    assert.ok(reviewed.ok);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.pendingTurn?.messageText, "Je veux ameliorer la recherche.");
    assert.equal(session?.pendingTurn?.contextFingerprint, reviewed.turn.prepared.turnFingerprint);
    assert.notEqual(
      reviewed.turn.prepared.turnFingerprint,
      reviewed.turn.prepared.contextFingerprint,
    );
  });

  it("ne compare rien au premier tour", async () => {
    const { sessionId } = await newSession();
    const reviewed = await review(sessionId, "Premier message.");

    assert.ok(reviewed.ok);
    assert.equal(reviewed.turn.comparable, false);
    assert.deepEqual(reviewed.turn.changes, []);
  });

  it("annonce un contexte inchange au tour suivant", async () => {
    const { sessionId } = await newSession();
    await turn(sessionId, new FakeArchitectProvider([success(CONTINUE_JSON)]), "Premier.");

    const reviewed = await review(sessionId, "Second.");
    assert.ok(reviewed.ok);
    assert.equal(reviewed.turn.comparable, true);
    assert.deepEqual(reviewed.turn.changes, []);
  });

  it("annonce un document modifie depuis le tour precedent", async () => {
    const { sessionId } = await newSession();
    await turn(sessionId, new FakeArchitectProvider([success(CONTINUE_JSON)]), "Premier.");

    const reviewed = await review(sessionId, "Second.", { ports: ports(REVISED) });
    assert.ok(reviewed.ok);
    assert.equal(reviewed.turn.comparable, true);
    assert.deepEqual(
      reviewed.turn.changes.map((change) => [change.identifier, change.kind]),
      [
        ["CLAUDE.md", "MODIFIED"],
        ["docs/ARCHITECTURE.md", "MODIFIED"],
      ],
    );
  });

  it("ne refuse plus un long transcript : il ecarte les tours les plus anciens", async () => {
    // Depuis TASK-020, une conversation qui dure ne s'arrete pas. Le message que
    // l'utilisateur vient d'ecrire est prioritaire ; l'histoire cede la place.
    const { sessionId } = await newSession();
    const reviewed = await review(sessionId, "Un message ordinaire.");

    assert.ok(reviewed.ok);
    assert.equal(reviewed.turn.prepared.window.omittedTurns, 0);
    assert.ok(reviewed.turn.prepared.transcriptChars <= ARCHITECT_LIMITS.transcript);
  });
});

describe("sendArchitectTurn — succes", () => {
  it("enregistre une proposition et fait suivre la conversation", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(READY_JSON)]);

    const outcome = await turn(sessionId, provider, "Propose-moi une tache.");

    assert.ok(outcome.ok);
    assert.equal(outcome.turn.proposal?.title, "Exporter les taches");
    assert.equal(outcome.generation.status, ARCHITECT_GENERATION_STATUS.PROPOSAL_READY);
    assert.equal(outcome.generation.turnState, "PROPOSAL_READY");
    assert.equal(outcome.generation.usage.totalTokens, 120);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.PROPOSAL_READY);
  });

  it("enregistre un tour de discussion et ses questions", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(CONTINUE_JSON)]);

    const outcome = await turn(sessionId, provider, "Je ne sais pas encore.");

    assert.ok(outcome.ok);
    assert.equal(outcome.generation.status, ARCHITECT_GENERATION_STATUS.CONTINUE);
    assert.deepEqual(outcome.generation.questions, [
      "La fonctionnalite couvre-t-elle tous les projets ?",
    ]);
    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.CONTINUE);
  });

  it("fige les deux messages du tour", async () => {
    const { sessionId } = await newSession();
    await turn(
      sessionId,
      new FakeArchitectProvider([success(CONTINUE_JSON)]),
      "Je veux ameliorer la recherche.",
    );

    const session = await getArchitectSession(db, sessionId);
    assert.deepEqual(
      session?.messages.map((message) => [message.role, message.content]),
      [
        ["USER", "Je veux ameliorer la recherche."],
        ["ARCHITECT", "Deux options se presentent. Je recommande la seconde."],
      ],
    );
  });

  it("transmet la conversation entiere au tour suivant", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(CONTINUE_JSON), success(READY_JSON)]);

    await turn(sessionId, provider, "Premier message.");
    await turn(sessionId, provider, "Second message.");

    const call = provider.calls[1];
    assert.ok(call);
    assert.ok(call.input.includes("Premier message."));
    assert.ok(call.input.includes("Deux options se presentent."));
    assert.ok(call.input.includes("Second message."));
  });

  it("rappelle la proposition d'un tour precedent", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(READY_JSON), success(READY_JSON)]);

    await turn(sessionId, provider, "Propose-moi une tache.");
    await turn(sessionId, provider, "Fais-la plus petite.");

    const call = provider.calls[1];
    assert.ok(call);
    assert.ok(call.input.includes("Proposition rendue a ce tour : Exporter les taches"));
  });

  it("transmet un contexte nettoye et un schema strict", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(READY_JSON)]);

    await turn(sessionId, provider, "Je veux exporter les taches en JSON.");

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

  it("enregistre le manifest et l'empreinte du contexte envoye", async () => {
    const { sessionId } = await newSession();
    await turn(sessionId, new FakeArchitectProvider([success(READY_JSON)]), "Un message.");

    const session = await getArchitectSession(db, sessionId);
    const generation = session?.generations[0];

    assert.ok(generation?.manifest);
    assert.deepEqual(
      generation.manifest.sources.map((source) => source.identifier),
      ["CLAUDE.md", "docs/ARCHITECTURE.md"],
    );
    assert.ok(generation.manifest.missing.includes("docs/DECISIONS.md"));
    assert.match(generation.contextFingerprint ?? "", /^[0-9a-f]{64}$/u);
  });
});

describe("sendArchitectTurn — contexte change", () => {
  it("refuse l'envoi et n'appelle pas le fournisseur", async () => {
    // Entre l'apercu et le clic, un fichier a ete enregistre.
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(READY_JSON)]);

    assert.ok((await review(sessionId, "Un message.")).ok);
    const outcome = await send(sessionId, provider, { ports: ports(REVISED) });

    assert.equal(outcome.ok, false);
    assert.equal(
      "code" in outcome ? outcome.code : null,
      ARCHITECT_ERROR.ARCHITECT_CONTEXT_CHANGED,
    );
    assert.equal(provider.calls.length, 0);

    const session = await getArchitectSession(db, sessionId);
    // Aucun tour reserve, aucun quota consomme, brouillon intact.
    assert.equal(session?.generationCount, 0);
    assert.equal(session?.pendingTurn?.messageText, "Un message.");
  });

  it("accepte apres une nouvelle relecture du contexte", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(READY_JSON)]);

    assert.ok((await review(sessionId, "Un message.")).ok);
    assert.equal((await send(sessionId, provider, { ports: ports(REVISED) })).ok, false);

    // L'utilisateur relit le contexte mis a jour, puis renvoie.
    const again = await review(sessionId, "Un message.", { ports: ports(REVISED) });
    assert.ok(again.ok);
    const outcome = await send(sessionId, provider, { ports: ports(REVISED) });

    assert.ok(outcome.ok);
    assert.equal(provider.calls.length, 1);
  });

  it("refuse un envoi sans brouillon prepare", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(READY_JSON)]);

    const outcome = await send(sessionId, provider);

    assert.equal(outcome.ok, false);
    assert.equal(
      "code" in outcome ? outcome.code : null,
      ARCHITECT_ERROR.ARCHITECT_NO_PENDING_TURN,
    );
    assert.equal(provider.calls.length, 0);
  });

  it("ne reemet rien apres un tour reussi", async () => {
    // Le brouillon est consomme dans la transaction qui fige le tour : un
    // rafraichissement du navigateur ne peut pas relancer l'appel.
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(CONTINUE_JSON)]);

    await turn(sessionId, provider, "Un message.");
    const again = await send(sessionId, provider);

    assert.equal(again.ok, false);
    assert.equal(provider.calls.length, 1);
  });
});

describe("sendArchitectTurn — refus", () => {
  it("conclut un tour en echec sans laisser le verrou pose", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_TIMEOUT },
      success(READY_JSON),
    ]);

    assert.ok((await review(sessionId, "Un message.")).ok);
    assert.equal((await send(sessionId, provider)).ok, false);

    // Le verrou doit etre rendu, et le brouillon survivre : l'utilisateur
    // reclique sans avoir a reecrire son message.
    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.pendingTurn?.messageText, "Un message.");
    assert.equal(session?.messages.length, 0);

    const retried = await send(sessionId, provider);
    assert.ok(retried.ok);
  });

  it("n'ecrit aucun faux message d'architecte", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR },
    ]);

    assert.ok((await review(sessionId, "Un message.")).ok);
    await send(sessionId, provider);

    const session = await getArchitectSession(db, sessionId);
    assert.deepEqual(session?.messages, []);
    // L'echec reste historique, et auditable.
    assert.equal(session?.generations[0]?.status, ARCHITECT_GENERATION_STATUS.FAILED);
    assert.equal(session?.generations[0]?.errorCode, ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR);
  });

  it("distingue un refus du modele d'une panne", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_REFUSED },
    ]);

    assert.ok((await review(sessionId, "Un message.")).ok);
    await send(sessionId, provider);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.generations[0]?.status, ARCHITECT_GENERATION_STATUS.REFUSED);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.FAILED);
  });

  it("refuse une reponse qui ne passe pas la validation NOX", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([
      success({
        ...READY_JSON,
        proposal: { ...READY_JSON.proposal, documentReferences: ["docs/INVENTED.md"] },
      }),
    ]);

    assert.ok((await review(sessionId, "Un message.")).ok);
    const outcome = await send(sessionId, provider);

    assert.equal(outcome.ok, false);
    assert.equal(
      "code" in outcome ? outcome.code : null,
      ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
    );

    const session = await getArchitectSession(db, sessionId);
    // La consommation est enregistree malgre tout : l'appel a bien eu lieu.
    assert.equal(session?.generations[0]?.usage.totalTokens, 120);
    assert.deepEqual(session?.messages, []);
  });

  it("refuse une commande de validation dangereuse", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([
      success({
        ...READY_JSON,
        proposal: { ...READY_JSON.proposal, validationCommands: ["npm run test && rm -rf /"] },
      }),
    ]);

    assert.ok((await review(sessionId, "Un message.")).ok);
    assert.equal((await send(sessionId, provider)).ok, false);
  });

  it("n'appelle pas le fournisseur quand le contexte est illisible", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(READY_JSON)]);
    const broken = {
      ports: ports({
        listDocuments: () => Promise.resolve({ ok: false as const, failure: { kind: "unreachable" as const } }),
      }),
    };

    const reviewed = await review(sessionId, "Un message.", broken);

    assert.equal(reviewed.ok, false);
    // Aucun appel, aucun tour consomme : la conversation est intacte.
    assert.equal(provider.calls.length, 0);
    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.generationCount, 0);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.OPEN);
  });

  it("refuse au-dela de la borne de tours", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider(
      Array.from({ length: ARCHITECT_LIMITS.generations + 1 }, () => success(CONTINUE_JSON)),
    );

    for (let index = 0; index < ARCHITECT_LIMITS.generations; index += 1) {
      assert.ok(
        (await turn(sessionId, provider, `Message ${String(index)}.`)).ok,
        `tour ${String(index + 1)}`,
      );
    }

    assert.ok((await review(sessionId, "Un de trop.")).ok);
    const extra = await send(sessionId, provider);
    assert.equal(
      "code" in extra ? extra.code : null,
      ARCHITECT_ERROR.ARCHITECT_GENERATION_LIMIT,
    );
    assert.equal(provider.calls.length, ARCHITECT_LIMITS.generations);
  });

  it("ne lance qu'un appel sur double envoi concurrent", async () => {
    const { sessionId } = await newSession();
    const provider = new FakeArchitectProvider([success(READY_JSON), success(READY_JSON)]);

    assert.ok((await review(sessionId, "Un message.")).ok);
    const [left, right] = await Promise.all([
      send(sessionId, provider),
      send(sessionId, provider),
    ]);

    assert.equal([left, right].filter((outcome) => outcome.ok).length, 1);
    assert.equal(provider.calls.length, 1);
  });
});


// --- Envoi direct : le parcours d'une conversation projet ---------------------

/** Ouvre une conversation projet, avec son role declare. */
async function newProjectSession(): Promise<{ projectId: string; sessionId: string }> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet direct ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-direct-${String(counter)}`),
  });
  const session = await ensureProjectArchitectSession(db, project.id);
  assert.ok(session !== null);
  return { projectId: project.id, sessionId: session.id };
}

/** Envoie un message : c'est `Send`, en un seul clic. */
async function sendMessage(
  sessionId: string,
  provider: FakeArchitectProvider,
  message: string,
  overrides: TurnOverrides & { expectedMessageCount?: number } = {},
) {
  const session = await getArchitectSession(db, sessionId);
  assert.ok(session !== null);
  return sendArchitectMessage(db, {
    session,
    projectName: "NOX",
    repositoryPath: path.join(workspace, "depot"),
    message,
    tasks: [],
    memories: [],
    structuredState: NO_STRUCTURED_STATE,
    projectId: session.projectId,
    planTools: PLAN_TOOLS,
    planningState: null,
    model: "modele-de-test",
    provider,
    environment: ENVIRONMENT,
    ports: overrides.ports ?? ports(),
    expectedMessageCount: overrides.expectedMessageCount ?? session.messages.length,
  });
}

describe("sendArchitectMessage — un clic, un appel", () => {
  it("envoie le premier message d'une conversation neuve", async () => {
    const { sessionId } = await newProjectSession();
    const provider = new FakeArchitectProvider([success(CONTINUE_V3)]);

    const outcome = await sendMessage(sessionId, provider, "Que veux-tu construire ?");

    assert.ok(outcome.ok);
    assert.equal(provider.calls.length, 1);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.messages.length, 2);
    assert.equal(session?.messages[0]?.content, "Que veux-tu construire ?");
    // Le brouillon a servi de verrou, puis a disparu avec le tour.
    assert.equal(session?.pendingTurn, null);
  });

  it("transmet les tours precedents au message suivant", async () => {
    const { sessionId } = await newProjectSession();
    const first = new FakeArchitectProvider([success(CONTINUE_V3)]);
    assert.ok((await sendMessage(sessionId, first, "Premier message.")).ok);

    const second = new FakeArchitectProvider([success(CONTINUE_V3)]);
    assert.ok((await sendMessage(sessionId, second, "Second message.")).ok);

    const sent = second.calls[0]?.input ?? "";
    assert.ok(sent.includes("Premier message."), "le premier message est transmis");
    assert.ok(sent.includes("Second message."), "le nouveau message aussi");
  });

  it("refuse un message vide sans appeler personne", async () => {
    const { sessionId } = await newProjectSession();
    const provider = new FakeArchitectProvider([success(CONTINUE_V3)]);

    const outcome = await sendMessage(sessionId, provider, "");

    assert.equal(outcome.ok, false);
    assert.equal("refusal" in outcome ? outcome.refusal : null, "empty");
    assert.equal(provider.calls.length, 0);
    assert.equal((await getArchitectSession(db, sessionId))?.generations.length, 0);
  });

  it("refuse un message d'espaces sans appeler personne", async () => {
    const { sessionId } = await newProjectSession();
    const provider = new FakeArchitectProvider([success(CONTINUE_V3)]);

    const outcome = await sendMessage(sessionId, provider, "   \n  ");

    assert.equal("refusal" in outcome ? outcome.refusal : null, "blank");
    assert.equal(provider.calls.length, 0);
  });

  it("refuse un message trop long sans appeler personne", async () => {
    const { sessionId } = await newProjectSession();
    const provider = new FakeArchitectProvider([success(CONTINUE_V3)]);

    const outcome = await sendMessage(
      sessionId,
      provider,
      "a".repeat(ARCHITECT_LIMITS.request + 1),
    );

    assert.equal("refusal" in outcome ? outcome.refusal : null, "too_long");
    assert.equal(provider.calls.length, 0);
    assert.equal((await getArchitectSession(db, sessionId))?.generations.length, 0);
  });

  it("refuse un onglet reste sur un etat depasse", async () => {
    const { sessionId } = await newProjectSession();
    const first = new FakeArchitectProvider([success(CONTINUE_V3)]);
    assert.ok((await sendMessage(sessionId, first, "L'onglet B parle.")).ok);

    // L'onglet A a ete rendu avant ce tour : il croit la conversation vide.
    const stale = new FakeArchitectProvider([success(CONTINUE_V3)]);
    const outcome = await sendMessage(sessionId, stale, "L'onglet A repond a l'ancien fil.", {
      expectedMessageCount: 0,
    });

    assert.equal(
      "code" in outcome ? outcome.code : null,
      ARCHITECT_ERROR.ARCHITECT_CONTEXT_CHANGED,
    );
    assert.equal(stale.calls.length, 0, "aucun appel n'est parti");
    assert.equal((await getArchitectSession(db, sessionId))?.messages.length, 2);
  });

  it("ne lance qu'un appel sur double envoi concurrent", async () => {
    const { sessionId } = await newProjectSession();
    const provider = new FakeArchitectProvider([success(CONTINUE_V3), success(CONTINUE_V3)]);

    const [left, right] = await Promise.all([
      sendMessage(sessionId, provider, "Double clic."),
      sendMessage(sessionId, provider, "Double clic."),
    ]);

    assert.equal([left, right].filter((outcome) => outcome.ok).length, 1);
    assert.equal(provider.calls.length, 1);
    assert.equal((await getArchitectSession(db, sessionId))?.messages.length, 2);
  });

  it("conclut la generation quand la reponse est invalide", async () => {
    const { sessionId } = await newProjectSession();
    const provider = new FakeArchitectProvider([success({ schemaVersion: 2, state: "NOPE" })]);

    const outcome = await sendMessage(sessionId, provider, "Un message.");

    assert.equal(
      "code" in outcome ? outcome.code : null,
      ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
    );
    const session = await getArchitectSession(db, sessionId);
    // Le verrou est rendu : la conversation reste utilisable.
    assert.notEqual(session?.status, "GENERATING");
    assert.equal(session?.messages.length, 0);
  });

  it("n'est borne par aucun nombre de tours", async () => {
    const { sessionId } = await newProjectSession();
    const total = ARCHITECT_LIMITS.generations + 2;
    const provider = new FakeArchitectProvider(
      Array.from({ length: total }, () => success(CONTINUE_V3)),
    );

    for (let index = 0; index < total; index += 1) {
      assert.ok(
        (await sendMessage(sessionId, provider, `Message ${String(index)}.`)).ok,
        `tour ${String(index + 1)}`,
      );
    }

    assert.equal(provider.calls.length, total);
  });

  it("utilise le contexte courant, jamais celui d'une inspection precedente", async () => {
    const { sessionId } = await newProjectSession();

    // Une inspection enregistre un brouillon avec l'empreinte d'alors.
    assert.ok((await review(sessionId, "Texte inspecte.")).ok);

    // Le projet change, puis l'envoi part avec un autre texte.
    const provider = new FakeArchitectProvider([success(CONTINUE_V3)]);
    const outcome = await sendMessage(sessionId, provider, "Texte reellement envoye.", {
      ports: ports({ revision: REVISED.revision }),
    });

    assert.ok(outcome.ok, "une inspection perimee ne bloque pas l'envoi");
    const sent = provider.calls[0]?.input ?? "";
    assert.ok(sent.includes("Texte reellement envoye."));
    assert.equal(sent.includes("Texte inspecte."), false);
    assert.ok(sent.includes(REVISED.revision.slice(0, 4)), "le contexte est celui d'aujourd'hui");

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.messages[0]?.content, "Texte reellement envoye.");
  });
});

// ---------------------------------------------------------------------------
// HOTFIX-003 — diagnostic d'un tour echoue
// ---------------------------------------------------------------------------

/**
 * Ce que le second pilote reel n'a pas pu savoir.
 *
 * TicketPulse a vu ses tours 8 et 9 echouer sur la meme phrase generique, en
 * demandant un ajustement du Living V1 Plan. Quatre causes de code distinctes
 * produisaient ce message, et rien d'enregistre ne permettait de les separer.
 *
 * Ces tests fixent le contraire : chaque cause laisse en base de quoi la
 * reconnaitre, sans qu'aucun contenu de projet ne quitte NOX.
 */
describe("HOTFIX-003 — un tour echoue enregistre pourquoi", () => {
  it("enregistre le champ et la phrase quand le contrat est viole", async () => {
    const { sessionId } = await newProjectSession();
    // Bien forme, lisible, et refuse par la validation metier : l'issue de tour
    // n'existe pas.
    const provider = new FakeArchitectProvider([success({ ...CONTINUE_V3, state: "DISCUSSION" })]);

    const outcome = await sendMessage(sessionId, provider, "Ajuste le plan de V1.");

    assert.equal(outcome.ok, false);
    const session = await getArchitectSession(db, sessionId);
    const generation = session?.generations[0];
    assert.equal(generation?.status, ARCHITECT_GENERATION_STATUS.FAILED);
    assert.equal(generation?.errorCode, ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID);
    assert.equal(generation?.diagnostic?.category, ARCHITECT_TURN_FAILURE.CONTRACT_INVALID);
    assert.equal(generation?.diagnostic?.field, "state");
    assert.notEqual(generation?.diagnostic?.message, null);
  });

  it("nomme le champ fautif a l'interieur d'une mise a jour de projet", async () => {
    const { sessionId } = await newProjectSession();
    const provider = new FakeArchitectProvider([
      success({
        ...CONTINUE_V3,
        projectUpdate: {
          reason: "Les decisions d'import changent la direction technique.",
          brief: { action: "UNCHANGED" },
          plan: { action: "REWRITE" },
        },
      }),
    ]);

    const outcome = await sendMessage(sessionId, provider, "Ajuste le plan de V1.");

    assert.equal(outcome.ok, false);
    const session = await getArchitectSession(db, sessionId);
    // Le chemin est prefixe : un `plan` nu ne dirait pas de quelle partie de la
    // reponse il parle.
    assert.equal(session?.generations[0]?.diagnostic?.field, "projectUpdate.plan");
  });

  it("distingue une reponse illisible d'un contrat viole", async () => {
    const { sessionId } = await newProjectSession();
    const provider = new FakeArchitectProvider([
      {
        ok: false,
        code: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
        diagnostic: {
          field: ARCHITECT_DIAGNOSTIC_FIELD.JSON,
          message: "Le texte rendu par le fournisseur n'est pas du JSON lisible.",
        },
      },
    ]);

    const outcome = await sendMessage(sessionId, provider, "Ajuste le plan.");

    assert.equal(outcome.ok, false);
    const session = await getArchitectSession(db, sessionId);
    assert.equal(
      session?.generations[0]?.diagnostic?.category,
      ARCHITECT_TURN_FAILURE.MALFORMED_JSON,
    );
  });

  it("classe une reponse interrompue a part, avec son motif", async () => {
    const { sessionId } = await newProjectSession();
    const provider = new FakeArchitectProvider([
      {
        ok: false,
        code: ARCHITECT_ERROR.ARCHITECT_RESPONSE_INCOMPLETE,
        diagnostic: {
          field: ARCHITECT_DIAGNOSTIC_FIELD.INCOMPLETE,
          message: "Le fournisseur a interrompu sa reponse (motif : max_output_tokens).",
        },
      },
    ]);

    const outcome = await sendMessage(sessionId, provider, "Ajuste le plan.");

    assert.equal(outcome.ok, false);
    const session = await getArchitectSession(db, sessionId);
    const diagnostic = session?.generations[0]?.diagnostic;
    assert.equal(diagnostic?.category, ARCHITECT_TURN_FAILURE.RESPONSE_INCOMPLETE);
    assert.match(diagnostic?.message ?? "", /max_output_tokens/u);
  });

  it("n'enregistre aucun champ fautif pour un delai depasse", async () => {
    // Un timeout n'a pas de champ : en inventer un ferait chercher une erreur
    // de contrat la ou le reseau a lache. C'est la distinction entre les tours
    // 5-6 et les tours 8-9 du pilote.
    const { sessionId } = await newProjectSession();
    const provider = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_TIMEOUT },
    ]);

    const outcome = await sendMessage(sessionId, provider, "Un long message.");

    assert.equal(outcome.ok, false);
    const session = await getArchitectSession(db, sessionId);
    const generation = session?.generations[0];
    assert.equal(generation?.errorCode, ARCHITECT_ERROR.ARCHITECT_TIMEOUT);
    assert.equal(generation?.diagnostic?.category, ARCHITECT_TURN_FAILURE.PROVIDER_ERROR);
    assert.equal(generation?.diagnostic?.field, null);
  });

  it("ne laisse fuir ni prompt, ni reponse brute, ni secret", async () => {
    const { sessionId } = await newProjectSession();
    const secret = "sk-proj-valeur-ultra-secrete";
    const projectContent = "Le contenu confidentiel du plan de TicketPulse.";
    const provider = new FakeArchitectProvider([
      success({
        ...CONTINUE_V3,
        state: "DISCUSSION",
        message: projectContent,
        projectUpdate: {
          reason: `${projectContent} ${secret}`,
          brief: { action: "UNCHANGED" },
          plan: { action: "UNCHANGED" },
        },
      }),
    ]);

    const outcome = await sendMessage(sessionId, provider, `Message avec ${secret}`);

    assert.equal(outcome.ok, false);
    const session = await getArchitectSession(db, sessionId);
    const serialized = JSON.stringify(session?.generations[0]?.diagnostic);

    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes("sk-"), false);
    assert.equal(serialized.includes(projectContent), false);
    assert.equal(serialized.includes("Authorization"), false);
    assert.equal(serialized.includes("node_modules"), false);
  });

  it("une generation reussie ne porte aucun diagnostic", async () => {
    const { sessionId } = await newProjectSession();
    const provider = new FakeArchitectProvider([success(CONTINUE_V3)]);

    assert.ok((await sendMessage(sessionId, provider, "Bonjour.")).ok);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.generations[0]?.diagnostic, null);
  });
});

/**
 * Le message soumis survit a un tour echoue.
 *
 * ## Le comportement, avant et apres
 *
 * Il etait **deja** correct : `finishArchitectGeneration` n'efface le brouillon
 * que lorsque le tour a abouti. Ce que le pilote ne pouvait pas savoir, c'est
 * que NOX le garantissait — rien ne le disait, ni a l'ecran, ni dans un test.
 *
 * Ces tests fixent la semantique retenue, pour qu'elle cesse d'etre un detail
 * d'implementation que la prochaine refonte pourrait perdre.
 */
describe("HOTFIX-003 — le brouillon survit a un echec", () => {
  it("conserve le message apres une reponse refusee", async () => {
    const { sessionId } = await newProjectSession();
    const provider = new FakeArchitectProvider([success({ ...CONTINUE_V3, state: "DISCUSSION" })]);

    assert.equal((await sendMessage(sessionId, provider, "Ajuste le plan de V1.")).ok, false);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.pendingTurn?.messageText, "Ajuste le plan de V1.");
  });

  it("conserve le message apres un delai depasse", async () => {
    const { sessionId } = await newProjectSession();
    const provider = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_TIMEOUT },
    ]);

    assert.equal((await sendMessage(sessionId, provider, "Un long message.")).ok, false);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.pendingTurn?.messageText, "Un long message.");
  });

  it("n'ecrit aucun message dans la conversation quand le tour echoue", async () => {
    // Ni question restee sans reponse, ni fausse reponse d'architecte : le tour
    // n'a pas eu lieu, et le transcript ne doit pas pretendre le contraire.
    const { sessionId } = await newProjectSession();
    const provider = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_TIMEOUT },
    ]);

    assert.equal((await sendMessage(sessionId, provider, "Un message perdu ?")).ok, false);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.messages.length, 0);
  });

  it("le message conserve repart tel quel au tour suivant", async () => {
    const { sessionId } = await newProjectSession();
    const failing = new FakeArchitectProvider([
      { ok: false, code: ARCHITECT_ERROR.ARCHITECT_TIMEOUT },
    ]);
    assert.equal((await sendMessage(sessionId, failing, "Ajuste le plan.")).ok, false);

    // Deuxieme envoi du **meme** texte : c'est ce que fait l'utilisateur qui
    // reclique apres un echec, et il doit aboutir.
    const retry = new FakeArchitectProvider([success(CONTINUE_V3)]);
    const outcome = await sendMessage(sessionId, retry, "Ajuste le plan.");

    assert.ok(outcome.ok);
    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.messages[0]?.content, "Ajuste le plan.");
    // Le brouillon disparait maintenant, et seulement maintenant.
    assert.equal(session?.pendingTurn, null);
  });
});
