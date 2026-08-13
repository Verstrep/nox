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
import {
  fetchArchitectContext,
  reviewArchitectTurn,
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

  it("enregistre le brouillon et son empreinte", async () => {
    const { sessionId } = await newSession();
    const reviewed = await review(sessionId, "Je veux ameliorer la recherche.");
    assert.ok(reviewed.ok);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.pendingTurn?.messageText, "Je veux ameliorer la recherche.");
    assert.equal(
      session?.pendingTurn?.contextFingerprint,
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

  it("refuse un transcript au-dela de la borne", async () => {
    // Aucun resume, aucune fenetre : la conversation s'arrete, et le dit.
    const { sessionId } = await newSession();
    const reviewed = await review(sessionId, "x".repeat(ARCHITECT_LIMITS.transcript + 1));

    assert.equal(reviewed.ok, false);
    assert.equal(
      "code" in reviewed ? reviewed.code : null,
      ARCHITECT_ERROR.ARCHITECT_CONVERSATION_TOO_LARGE,
    );
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
