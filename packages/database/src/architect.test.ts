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
  ARCHITECT_MESSAGE_ROLE,
  ARCHITECT_SESSION_STATUS,
  ARCHITECT_TURN_STATE,
  type ArchitectContextManifest,
  type ArchitectTaskProposal,
} from "@nox/shared";

import {
  architectProposalOfMessage,
  architectTranscriptChars,
  attachArchitectTask,
  canCreateArchitectTask,
  claimArchitectSession,
  clearArchitectTurnDraft,
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

/** Empreinte de contexte, arbitraire : ce module ne la calcule pas. */
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

/**
 * Prepare un brouillon puis reserve le tour, comme le fait le service.
 *
 * Les deux vont ensemble : depuis TASK-014, une generation ne se reserve pas
 * sans un message prepare et son empreinte de contexte.
 */
async function startTurn(sessionId: string, hash = 'a'.repeat(64), message = 'Un message.') {
  await saveArchitectTurnDraft(db, {
    sessionId,
    messageText: message,
    contextFingerprint: FINGERPRINT,
    manifest: MANIFEST,
  });
  return startArchitectGeneration(db, {
    sessionId,
    model: "modele",
    promptVersion: "architect/2",
    inputHash: hash,
    contextFingerprint: FINGERPRINT,
    manifest: MANIFEST,
  });
}

/** Les deux messages d'un tour abouti. */
function turnMessages(userText = 'Un message.', architectText = 'Une reponse.') {
  return [
    { role: ARCHITECT_MESSAGE_ROLE.USER, content: userText },
    { role: ARCHITECT_MESSAGE_ROLE.ARCHITECT, content: architectText },
  ];
}

/** Session portant une proposition prete, telle qu'un tour la laisse. */
async function readySession(): Promise<{ projectId: string; sessionId: string }> {
  const { projectId, sessionId } = await newSession();
  const started = await startTurn(sessionId, "a".repeat(64));
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
    const started = await startTurn(sessionId, "a".repeat(64));

    assert.ok(started.ok);
    assert.equal(started.generation.sequence, 1);
    assert.equal(started.generation.status, ARCHITECT_GENERATION_STATUS.RUNNING);
    assert.deepEqual(started.generation.manifest, MANIFEST);
  });

  it("numerote les generations d'une session", async () => {
    const { sessionId } = await newSession();
    const first = await startTurn(sessionId, "a".repeat(64));
    assert.ok(first.ok);
    await finishArchitectGeneration(db, {
      generationId: first.generation.id,
      status: ARCHITECT_GENERATION_STATUS.CONTINUE,
      questions: ["Une question ?"],
    });

    const second = await startTurn(sessionId, "b".repeat(64));

    assert.ok(second.ok);
    assert.equal(second.generation.sequence, 2);
  });

  it("refuse une seconde generation pendant qu'une tourne", async () => {
    const { sessionId } = await newSession();
    const first = await startTurn(sessionId, "a".repeat(64));
    assert.ok(first.ok);

    const second = await startTurn(sessionId, "b".repeat(64));

    assert.equal(second.ok, false);
    assert.equal(second.ok ? null : second.reason, "active");
  });

  it("ne laisse qu'une seule generation naitre d'un double clic", async () => {
    const { sessionId } = await newSession();
    await saveArchitectTurnDraft(db, {
      sessionId,
      messageText: "Un message.",
      contextFingerprint: FINGERPRINT,
      manifest: MANIFEST,
    });
    const input = {
      sessionId,
      model: "modele",
      promptVersion: "architect/2",
      inputHash: "a".repeat(64),
      contextFingerprint: FINGERPRINT,
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
      const started = await startTurn(sessionId, "a".repeat(64));
      assert.ok(started.ok, `tour ${String(index + 1)} refuse`);
      await finishArchitectGeneration(db, {
        generationId: started.generation.id,
        status: ARCHITECT_GENERATION_STATUS.FAILED,
        errorCode: "ARCHITECT_TIMEOUT",
      });
    }

    const extra = await startTurn(sessionId, "a".repeat(64));

    // Les echecs comptent : sans cela, une boucle d'erreurs serait infinie.
    assert.equal(extra.ok ? null : extra.reason, "limit");
  });

  it("refuse une session inconnue", async () => {
    const result = await startArchitectGeneration(db, {
      sessionId: "inexistante",
      model: "modele",
      promptVersion: "architect/2",
      inputHash: "a".repeat(64),
      contextFingerprint: FINGERPRINT,
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
    const started = await startTurn(sessionId, "a".repeat(64));
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
    const started = await startTurn(sessionId, "a".repeat(64));
    assert.ok(started.ok);

    await finishArchitectGeneration(db, {
      generationId: started.generation.id,
      status: ARCHITECT_GENERATION_STATUS.CONTINUE,
      questions: ["Tous les projets ?", "Format stable ?"],
    });

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.status, ARCHITECT_SESSION_STATUS.CONTINUE);
    assert.deepEqual(latestArchitectQuestions(session!), ["Tous les projets ?", "Format stable ?"]);
  });

  it("enregistre un code d'erreur", async () => {
    const { sessionId } = await newSession();
    const started = await startTurn(sessionId, "a".repeat(64));
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
      const started = await startTurn(sessionId, hash.repeat(64));
      assert.ok(started.ok);
      await finishArchitectGeneration(db, {
        generationId: started.generation.id,
        status: ARCHITECT_GENERATION_STATUS.CONTINUE,
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

describe("brouillon d'un tour", () => {
  it("enregistre le message prepare et son empreinte", async () => {
    const { sessionId } = await newSession();
    assert.equal(
      await saveArchitectTurnDraft(db, {
        sessionId,
        messageText: "Je veux commencer par la recherche.",
        contextFingerprint: FINGERPRINT,
        manifest: MANIFEST,
      }),
      true,
    );

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.pendingTurn?.messageText, "Je veux commencer par la recherche.");
    assert.equal(session?.pendingTurn?.contextFingerprint, FINGERPRINT);
    assert.deepEqual(session?.pendingTurn?.manifest, MANIFEST);
  });

  it("remplace le brouillon precedent", async () => {
    // Un seul brouillon par conversation : l'utilisateur qui recommence son
    // apercu ne doit pas se retrouver avec deux tours en attente.
    const { sessionId } = await newSession();
    await saveArchitectTurnDraft(db, {
      sessionId,
      messageText: "Premiere version.",
      contextFingerprint: FINGERPRINT,
      manifest: MANIFEST,
    });
    await saveArchitectTurnDraft(db, {
      sessionId,
      messageText: "Seconde version.",
      contextFingerprint: "b".repeat(64),
      manifest: MANIFEST,
    });

    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.pendingTurn?.messageText, "Seconde version.");
    assert.equal(session?.pendingTurn?.contextFingerprint, "b".repeat(64));
  });

  it("abandonne un brouillon sans laisser de message", async () => {
    const { sessionId } = await newSession();
    await saveArchitectTurnDraft(db, {
      sessionId,
      messageText: "Finalement non.",
      contextFingerprint: FINGERPRINT,
      manifest: MANIFEST,
    });

    assert.equal(await clearArchitectTurnDraft(db, sessionId), true);
    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.pendingTurn, null);
    // Un tour abandonne n'a pas eu lieu : la conversation n'en garde rien.
    assert.equal(session?.messages.length, 0);
  });

  it("refuse un brouillon sur une conversation appliquee", async () => {
    const { sessionId } = await readySession();
    assert.ok((await claimArchitectSession(db, sessionId)).ok);

    assert.equal(
      await saveArchitectTurnDraft(db, {
        sessionId,
        messageText: "Trop tard.",
        contextFingerprint: FINGERPRINT,
        manifest: MANIFEST,
      }),
      false,
    );
  });

  it("refuse un brouillon pendant qu'un tour est en vol", async () => {
    const { sessionId } = await newSession();
    assert.ok((await startTurn(sessionId)).ok);

    assert.equal(
      await saveArchitectTurnDraft(db, {
        sessionId,
        messageText: "En meme temps.",
        contextFingerprint: FINGERPRINT,
        manifest: MANIFEST,
      }),
      false,
    );
  });

  it("refuse de reserver un tour sans brouillon", async () => {
    const { sessionId } = await newSession();
    const result = await startArchitectGeneration(db, {
      sessionId,
      model: "modele",
      promptVersion: "architect/2",
      inputHash: "a".repeat(64),
      contextFingerprint: FINGERPRINT,
      manifest: MANIFEST,
    });
    assert.equal(result.ok ? null : result.reason, "no_draft");
  });

  it("refuse de reserver un tour dont le contexte a change", async () => {
    // Le controle vit dans la transaction : entre l'apercu et le clic, un
    // fichier a pu etre enregistre.
    const { sessionId } = await newSession();
    await saveArchitectTurnDraft(db, {
      sessionId,
      messageText: "Un message.",
      contextFingerprint: FINGERPRINT,
      manifest: MANIFEST,
    });

    const result = await startArchitectGeneration(db, {
      sessionId,
      model: "modele",
      promptVersion: "architect/2",
      inputHash: "a".repeat(64),
      contextFingerprint: "c".repeat(64),
      manifest: MANIFEST,
      expectedFingerprint: "c".repeat(64),
    });

    assert.equal(result.ok ? null : result.reason, "changed");
    const session = await getArchitectSession(db, sessionId);
    // Aucun tour reserve, aucun quota consomme, brouillon intact.
    assert.equal(session?.generationCount, 0);
    assert.equal(session?.pendingTurn?.messageText, "Un message.");
  });

  it("rend le message prepare a la reservation", async () => {
    const { sessionId } = await newSession();
    const started = await startTurn(sessionId, "a".repeat(64), "Le texte prepare.");
    assert.ok(started.ok);
    assert.equal(started.pendingMessage, "Le texte prepare.");
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

describe("messages de conversation", () => {
  it("n'ecrit aucun message a l'ouverture", async () => {
    // Le message d'ouverture est du texte tant qu'il n'a pas ete envoye. Il
    // n'existe qu'en un exemplaire, dans `requestText`.
    const { sessionId } = await newSession();
    const session = await getArchitectSession(db, sessionId);
    assert.equal(session?.messages.length, 0);
    assert.equal(session?.requestText, "Je veux exporter les taches en JSON.");
  });

  it("fige les deux messages d'un tour abouti", async () => {
    const { sessionId } = await newSession();
    const started = await startTurn(sessionId);
    assert.ok(started.ok);

    await finishArchitectGeneration(db, {
      generationId: started.generation.id,
      status: ARCHITECT_GENERATION_STATUS.CONTINUE,
      turnState: ARCHITECT_TURN_STATE.CONTINUE,
      messages: turnMessages("Je veux ameliorer la recherche.", "Deux options se presentent."),
    });

    const session = await getArchitectSession(db, sessionId);
    assert.deepEqual(
      session?.messages.map((message) => [message.role, message.content]),
      [
        [ARCHITECT_MESSAGE_ROLE.USER, "Je veux ameliorer la recherche."],
        [ARCHITECT_MESSAGE_ROLE.ARCHITECT, "Deux options se presentent."],
      ],
    );
    // Les deux portent la generation de leur tour : c'est ce qui relie une
    // reponse a son modele et a sa consommation.
    assert.deepEqual(
      session?.messages.map((message) => message.generationId),
      [started.generation.id, started.generation.id],
    );
  });

  it("efface le brouillon dans la meme transaction", async () => {
    const { sessionId } = await newSession();
    const started = await startTurn(sessionId);
    assert.ok(started.ok);

    await finishArchitectGeneration(db, {
      generationId: started.generation.id,
      status: ARCHITECT_GENERATION_STATUS.CONTINUE,
      turnState: ARCHITECT_TURN_STATE.CONTINUE,
      messages: turnMessages(),
    });

    const session = await getArchitectSession(db, sessionId);
    // Un rafraichissement du navigateur ne peut donc pas reemettre l'appel.
    assert.equal(session?.pendingTurn, null);
  });

  it("conserve le brouillon quand le tour echoue", async () => {
    const { sessionId } = await newSession();
    const started = await startTurn(sessionId, "a".repeat(64), "Mon texte.");
    assert.ok(started.ok);

    await finishArchitectGeneration(db, {
      generationId: started.generation.id,
      status: ARCHITECT_GENERATION_STATUS.FAILED,
      errorCode: "ARCHITECT_TIMEOUT",
    });

    const session = await getArchitectSession(db, sessionId);
    // Le texte de l'utilisateur lui reste acquis : la panne n'est pas la sienne.
    assert.equal(session?.pendingTurn?.messageText, "Mon texte.");
    // Et la conversation ne montre ni message sans reponse, ni fausse reponse.
    assert.equal(session?.messages.length, 0);
    assert.equal(session?.generations[0]?.status, ARCHITECT_GENERATION_STATUS.FAILED);
  });

  it("numerote les messages sans jamais reculer", async () => {
    const { sessionId } = await newSession();

    for (const index of [1, 2, 3]) {
      const started = await startTurn(sessionId, String(index).repeat(64));
      assert.ok(started.ok);
      await finishArchitectGeneration(db, {
        generationId: started.generation.id,
        status: ARCHITECT_GENERATION_STATUS.CONTINUE,
        turnState: ARCHITECT_TURN_STATE.CONTINUE,
        messages: turnMessages(`Question ${String(index)}.`, `Reponse ${String(index)}.`),
      });
    }

    const session = await getArchitectSession(db, sessionId);
    assert.deepEqual(
      session?.messages.map((message) => message.sequence),
      [1, 2, 3, 4, 5, 6],
    );
  });

  it("mesure le transcript sur ce qui partirait", async () => {
    const { sessionId } = await newSession();
    const started = await startTurn(sessionId);
    assert.ok(started.ok);
    await finishArchitectGeneration(db, {
      generationId: started.generation.id,
      status: ARCHITECT_GENERATION_STATUS.CONTINUE,
      turnState: ARCHITECT_TURN_STATE.CONTINUE,
      messages: turnMessages("abcde", "fghij"),
    });

    const session = await getArchitectSession(db, sessionId);
    assert.equal(architectTranscriptChars(session!), 10);
  });

  it("retrouve la proposition d'un message d'architecte", async () => {
    const { sessionId } = await newSession();
    const started = await startTurn(sessionId);
    assert.ok(started.ok);
    await finishArchitectGeneration(db, {
      generationId: started.generation.id,
      status: ARCHITECT_GENERATION_STATUS.PROPOSAL_READY,
      turnState: ARCHITECT_TURN_STATE.PROPOSAL_READY,
      proposal: PROPOSAL,
      messages: turnMessages("Propose une tache.", "Voici le plus petit increment."),
    });

    const session = await getArchitectSession(db, sessionId);
    const reply = session?.messages[1];
    assert.ok(reply !== undefined);
    assert.equal(architectProposalOfMessage(session!, reply)?.title, "Exporter les taches");
    // Un message de l'utilisateur n'en porte jamais.
    assert.equal(architectProposalOfMessage(session!, session!.messages[0]!), null);
  });
});

describe("propositions successives", () => {
  /** Joue un tour abouti et rend l'identifiant de sa generation. */
  async function playTurn(
    sessionId: string,
    hash: string,
    ready: boolean,
  ): Promise<string> {
    const started = await startTurn(sessionId, hash.repeat(64));
    assert.ok(started.ok);
    await finishArchitectGeneration(db, {
      generationId: started.generation.id,
      status: ready
        ? ARCHITECT_GENERATION_STATUS.PROPOSAL_READY
        : ARCHITECT_GENERATION_STATUS.CONTINUE,
      turnState: ready ? ARCHITECT_TURN_STATE.PROPOSAL_READY : ARCHITECT_TURN_STATE.CONTINUE,
      proposal: ready ? { ...PROPOSAL, title: `Proposition ${hash}` } : null,
      messages: turnMessages(`Message ${hash}.`, `Reponse ${hash}.`),
    });
    return started.generation.id;
  }

  it("garde la plus recente comme derniere proposition", async () => {
    const { sessionId } = await newSession();
    await playTurn(sessionId, "a", true);
    await playTurn(sessionId, "b", true);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(latestArchitectProposal(session!)?.proposal?.title, "Proposition b");
  });

  it("laisse l'ancienne proposition intacte", async () => {
    const { sessionId } = await newSession();
    await playTurn(sessionId, "a", true);
    await playTurn(sessionId, "b", true);

    const session = await getArchitectSession(db, sessionId);
    const titles = session?.generations.map((generation) => generation.proposal?.title);
    assert.deepEqual(titles, ["Proposition b", "Proposition a"]);
  });

  it("autorise la creation juste apres une proposition", async () => {
    const { sessionId } = await newSession();
    await playTurn(sessionId, "a", true);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(canCreateArchitectTask(session!), true);
  });

  it("interdit la creation quand la discussion a continue depuis", async () => {
    // Creer cette proposition reviendrait a ignorer ce que l'utilisateur vient
    // de dire a l'architecte.
    const { sessionId } = await newSession();
    await playTurn(sessionId, "a", true);
    await playTurn(sessionId, "b", false);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(canCreateArchitectTask(session!), false);
    // Et la reservation echoue aussi, sans dependre de l'interface.
    const claimed = await claimArchitectSession(db, sessionId);
    assert.equal(claimed.ok ? null : claimed.reason, "not_ready");
  });

  it("reautorise la creation des qu'une nouvelle proposition arrive", async () => {
    const { sessionId } = await newSession();
    await playTurn(sessionId, "a", true);
    await playTurn(sessionId, "b", false);
    await playTurn(sessionId, "c", true);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(canCreateArchitectTask(session!), true);
    assert.equal(latestArchitectProposal(session!)?.proposal?.title, "Proposition c");
  });

  it("n'invalide pas une proposition a cause d'un echec", async () => {
    // Un echec n'a fige aucun message : il ne peut pas rendre une proposition
    // obsolete.
    const { sessionId } = await newSession();
    await playTurn(sessionId, "a", true);
    const started = await startTurn(sessionId, "d".repeat(64));
    assert.ok(started.ok);
    await finishArchitectGeneration(db, {
      generationId: started.generation.id,
      status: ARCHITECT_GENERATION_STATUS.FAILED,
      errorCode: "ARCHITECT_TIMEOUT",
    });

    const session = await getArchitectSession(db, sessionId);
    assert.equal(canCreateArchitectTask(session!), true);
  });

  it("interdit la creation sur une conversation appliquee", async () => {
    const { sessionId } = await newSession();
    await playTurn(sessionId, "a", true);
    assert.ok((await claimArchitectSession(db, sessionId)).ok);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(canCreateArchitectTask(session!), false);
  });

  it("interdit la creation sans aucune proposition", async () => {
    const { sessionId } = await newSession();
    await playTurn(sessionId, "a", false);

    const session = await getArchitectSession(db, sessionId);
    assert.equal(canCreateArchitectTask(session!), false);
  });
});

describe("sessions historiques de TASK-013", () => {
  /** Session au format d'avant TASK-014, ecrite directement en base. */
  async function legacySession(): Promise<string> {
    const projectId = await newProject();
    const session = await createArchitectSession(db, {
      projectId,
      requestText: "Une demande de TASK-013.",
    });
    assert.ok(session !== null);
    await db.architectSession.update({
      where: { id: session.id },
      data: {
        conversationVersion: 1,
        clarificationText: "Oui, pour tous les projets.",
      },
    });
    return session.id;
  }

  it("reste lisible", async () => {
    const sessionId = await legacySession();
    const session = await getArchitectSession(db, sessionId);

    assert.equal(session?.conversationVersion, 1);
    assert.equal(session?.conversational, false);
    assert.equal(session?.requestText, "Une demande de TASK-013.");
    assert.equal(session?.clarificationText, "Oui, pour tous les projets.");
  });

  it("n'invente aucune conversation", async () => {
    const sessionId = await legacySession();
    const session = await getArchitectSession(db, sessionId);
    assert.deepEqual(session?.messages, []);
  });

  it("refuse un brouillon", async () => {
    const sessionId = await legacySession();
    assert.equal(
      await saveArchitectTurnDraft(db, {
        sessionId,
        messageText: "Continuons.",
        contextFingerprint: FINGERPRINT,
        manifest: MANIFEST,
      }),
      false,
    );
  });

  it("refuse un nouveau tour", async () => {
    const sessionId = await legacySession();
    const result = await startArchitectGeneration(db, {
      sessionId,
      model: "modele",
      promptVersion: "architect/2",
      inputHash: "a".repeat(64),
      contextFingerprint: FINGERPRINT,
      manifest: MANIFEST,
    });
    assert.equal(result.ok ? null : result.reason, "legacy");
  });

  it("garde ses generations et sa proposition", async () => {
    // Une generation ecrite au format de TASK-013 — sans `turnState`, sans
    // empreinte de contexte — doit se relire sans erreur.
    const sessionId = await legacySession();
    await db.architectGeneration.create({
      data: {
        sessionId,
        sequence: 1,
        model: "modele-013",
        promptVersion: "architect/1",
        inputHash: "a".repeat(64),
        contextManifestJson: JSON.stringify(MANIFEST),
        status: ARCHITECT_GENERATION_STATUS.PROPOSAL_READY,
        proposalJson: JSON.stringify(PROPOSAL),
        inputTokens: 1_200,
      },
    });

    const session = await getArchitectSession(db, sessionId);
    const generation = session?.generations[0];
    assert.equal(generation?.model, "modele-013");
    assert.equal(generation?.turnState, null);
    assert.equal(generation?.contextFingerprint, null);
    assert.equal(generation?.usage.inputTokens, 1_200);
    assert.equal(latestArchitectProposal(session!)?.proposal?.title, "Exporter les taches");
  });
});
