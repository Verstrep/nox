/**
 * Un tour de conversation projet qui propose une mise a jour, de bout en bout.
 *
 * ## Ce que ce fichier prouve
 *
 * Que le tour et sa proposition sont enregistres **ensemble**, que la proposition
 * porte l'etat que le fournisseur avait sous les yeux, qu'elle ne change rien
 * tant qu'un humain ne l'applique pas, et qu'une proposition de tache et une
 * proposition de projet ne se commandent pas l'une l'autre.
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
  ARCHITECT_ERROR,
  ARCHITECT_PROJECT_UPDATE_STATUS,
  ARCHITECT_TURN_STATE,
  PROJECT_PLAN_LIMITS,
  type ProjectBriefInput,
  type ProjectV1PlanInput,
} from "@nox/shared";
import {
  createDatabaseClient,
  createProject,
  ensureProjectArchitectSession,
  getArchitectProjectUpdateForGeneration,
  getArchitectSession,
  listArchitectProjectUpdatesForSession,
  loadProjectStructuredState,
  saveProjectV1Plan,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
} from "@nox/database";

import { projectPlanTools } from "../project-plan.ts";
import {
  applyProjectUpdate,
  dismissProjectUpdate,
  projectUpdateReview,
} from "./project-update.ts";
import {
  FakeArchitectProvider,
  fakeProjectTurn,
  fakeProviderSuccess,
  type ArchitectProviderResult,
} from "./provider.ts";
import { sendArchitectMessage, type ArchitectRepositoryPorts } from "./service.ts";

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
  milestones: ["La liste est utilisable"],
};

const TASK = {
  title: "Exporter les livres",
  priority: "MEDIUM",
  objective: "Sortir la liste en JSON.",
  acceptanceCriteria: ["Un fichier JSON est produit."],
  documentReferences: ["docs/ARCHITECTURE.md"],
  validationCommands: ["npm run test"],
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

type Project = { id: string; repositoryPath: string; sessionId: string };

async function newProject(): Promise<Project> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  const session = await ensureProjectArchitectSession(db, project.id);
  assert.ok(session !== null);
  return { id: project.id, repositoryPath: project.repositoryPath, sessionId: session.id };
}

/** Envoie un message, avec l'etat structure relu comme le fait la Server Action. */
async function send(
  project: Project,
  provider: FakeArchitectProvider,
  message = "Voici mon produit.",
) {
  const session = await getArchitectSession(db, project.sessionId);
  assert.ok(session !== null);
  return sendArchitectMessage(db, {
    session,
    projectName: "Projet",
    repositoryPath: project.repositoryPath,
    message,
    tasks: [],
    memories: [],
    structuredState: await loadProjectStructuredState(
      db,
      project.id,
      projectPlanTools(project.repositoryPath),
    ),
    projectId: project.id,
    planTools: projectPlanTools(project.repositoryPath),
    model: "modele-de-test",
    provider,
    environment: ENVIRONMENT,
    ports: ports(),
    expectedMessageCount: session.messages.length,
  });
}

function respond(raw: unknown): ArchitectProviderResult {
  return fakeProviderSuccess(raw);
}

/** Derniere proposition enregistree dans la conversation. */
async function lastUpdate(project: Project) {
  const updates = await listArchitectProjectUpdatesForSession(db, project.sessionId);
  return updates.at(-1) ?? null;
}

async function state(project: Project) {
  return loadProjectStructuredState(db, project.id, projectPlanTools(project.repositoryPath));
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-update-service-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("les quatre combinaisons, de bout en bout", () => {
  it("A — discussion seule : aucune proposition enregistree", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(fakeProjectTurn({}))]);

    const outcome = await send(project, provider);

    assert.ok(outcome.ok);
    assert.equal(outcome.turn.state, ARCHITECT_TURN_STATE.CONTINUE);
    assert.equal(await lastUpdate(project), null);
  });

  it("B — projet neuf : le brief et le plan sont proposes, sans tache", async () => {
    // Le scenario naturel d'un debut de projet : l'utilisateur colle une
    // description detaillee, l'architecte pose l'etat structure, et aucune tache
    // n'est encore utile.
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      respond(
        fakeProjectTurn({
          projectUpdate: { reason: "La description etablit le produit.", brief: BRIEF, plan: PLAN },
        }),
      ),
    ]);

    const outcome = await send(project, provider);

    assert.ok(outcome.ok);
    assert.equal(outcome.turn.state, ARCHITECT_TURN_STATE.CONTINUE);
    assert.equal(outcome.turn.proposal, null);

    const update = await lastUpdate(project);
    assert.equal(update?.status, ARCHITECT_PROJECT_UPDATE_STATUS.PENDING);
    assert.equal(update?.proposed.brief.value?.summary, BRIEF.summary);
    assert.equal(update?.proposed.plan.value?.goal, PLAN.goal);

    // Proposer ne change rien.
    assert.equal((await state(project)).brief.present, false);
  });

  it("C — une tache, aucune mise a jour", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([respond(fakeProjectTurn({ proposal: TASK }))]);

    const outcome = await send(project, provider);

    assert.ok(outcome.ok);
    assert.equal(outcome.turn.state, ARCHITECT_TURN_STATE.PROPOSAL_READY);
    assert.equal(outcome.turn.proposal?.title, TASK.title);
    assert.equal(await lastUpdate(project), null);
  });

  it("D — une tache et une mise a jour dans le meme tour", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      respond(
        fakeProjectTurn({
          proposal: TASK,
          projectUpdate: { reason: "Le perimetre s'est precise.", plan: PLAN },
        }),
      ),
    ]);

    const outcome = await send(project, provider);

    assert.ok(outcome.ok);
    assert.equal(outcome.turn.proposal?.title, TASK.title);

    const update = await lastUpdate(project);
    assert.equal(update?.proposed.plan.value?.goal, PLAN.goal);
    assert.equal(update?.proposed.brief.action, "UNCHANGED");
  });
});

describe("persistance liee au tour", () => {
  it("attache la proposition a la generation qui l'a produite", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      respond(fakeProjectTurn({ projectUpdate: { reason: "Parce que.", brief: BRIEF } })),
    ]);

    const outcome = await send(project, provider);
    assert.ok(outcome.ok);

    const update = await getArchitectProjectUpdateForGeneration(db, outcome.generation.id);
    assert.notEqual(update, null);
    assert.equal(update?.projectId, project.id);
  });

  it("un tour aboutit avec sa proposition, ou pas du tout", async () => {
    // L'etat impossible qu'on cherche a exclure : une reponse affichee qui
    // annonce une modification du plan sans proposition enregistree.
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      respond(fakeProjectTurn({ projectUpdate: { reason: "Parce que.", brief: BRIEF } })),
    ]);

    const outcome = await send(project, provider);
    assert.ok(outcome.ok);

    const session = await getArchitectSession(db, project.sessionId);
    assert.equal(session?.messages.length, 2, "les messages sont figes");
    assert.notEqual(
      await getArchitectProjectUpdateForGeneration(db, outcome.generation.id),
      null,
      "et la proposition avec eux",
    );
  });

  it("n'enregistre rien quand la mise a jour depasse le budget", async () => {
    const project = await newProject();
    const huge: ProjectBriefInput = {
      ...BRIEF,
      summary: "a".repeat(PROJECT_PLAN_LIMITS.summary),
      problem: "b".repeat(PROJECT_PLAN_LIMITS.problem),
      targetUsers: "c".repeat(PROJECT_PLAN_LIMITS.targetUsers),
      desiredOutcome: "d".repeat(PROJECT_PLAN_LIMITS.desiredOutcome),
      goals: Array.from({ length: PROJECT_PLAN_LIMITS.items }, () =>
        "g".repeat(PROJECT_PLAN_LIMITS.item),
      ),
    };
    const provider = new FakeArchitectProvider([
      respond(fakeProjectTurn({ projectUpdate: { reason: "Trop gros.", brief: huge } })),
    ]);

    const outcome = await send(project, provider);

    assert.equal(outcome.ok, false);
    assert.equal(
      "code" in outcome ? outcome.code : null,
      ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
    );
    assert.equal(await lastUpdate(project), null, "aucune proposition impossible n'est stockee");

    const session = await getArchitectSession(db, project.sessionId);
    assert.equal(session?.messages.length, 0, "aucun message n'a ete fige");
    assert.notEqual(session?.status, "GENERATING", "le verrou est rendu");
  });

  it("n'enregistre rien quand la mise a jour est incoherente", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      respond({
        ...fakeProjectTurn({}),
        projectUpdate: {
          reason: "Incoherente.",
          brief: { action: "SET", value: null },
          plan: { action: "UNCHANGED", value: null },
        },
      }),
    ]);

    const outcome = await send(project, provider);

    assert.equal(outcome.ok, false);
    assert.equal(await lastUpdate(project), null);
  });
});

describe("revisions de base et concurrence", () => {
  it("enregistre l'etat vu par le fournisseur, pas celui d'apres l'appel", async () => {
    // Le scenario du bug corrige. Le tour part a l'etat A ; le plan est
    // enregistre a la main pendant l'appel ; la proposition doit rester en A.
    const project = await newProject();
    const tools = projectPlanTools(project.repositoryPath);

    assert.ok((await saveProjectV1Plan(db, { projectId: project.id, values: PLAN, tools })).ok);
    const stateA = await state(project);

    // Un fournisseur qui modifie le projet pendant que la reponse est en vol.
    const provider = new FakeArchitectProvider([]);
    const inFlight = {
      generateTaskTurn: async () => {
        await saveProjectV1Plan(db, {
          projectId: project.id,
          values: { ...PLAN, goal: "Un tout autre objectif." },
          tools,
        });
        return respond(
          fakeProjectTurn({ projectUpdate: { reason: "Le brief se precise.", brief: BRIEF } }),
        );
      },
      analyzeRunReview: () => provider.analyzeRunReview({} as never),
    };

    const outcome = await send(project, inFlight as unknown as FakeArchitectProvider);
    assert.ok(outcome.ok);

    const stateB = await state(project);
    assert.notEqual(stateA.plan.revision, stateB.plan.revision, "le plan a bien change");

    const update = await lastUpdate(project);
    assert.equal(
      update?.basePlanRevision,
      stateA.plan.revision,
      "la base est l'etat vu par le fournisseur",
    );
    assert.notEqual(update?.basePlanRevision, stateB.plan.revision);
    assert.equal(update?.status, ARCHITECT_PROJECT_UPDATE_STATUS.PENDING);

    // Et l'application est refusee.
    assert.ok(update !== null);
    const applied = await applyProjectUpdate(db, project, update.id, {
      brief: BRIEF,
      plan: null,
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "stale");
    assert.equal((await state(project)).brief.present, false, "aucune ecriture");
  });
});

describe("le contexte avant et apres application", () => {
  it("garde l'ancien etat tant que rien n'est applique", async () => {
    const project = await newProject();

    const first = new FakeArchitectProvider([
      respond(fakeProjectTurn({ projectUpdate: { reason: "Le brief.", brief: BRIEF } })),
    ]);
    assert.ok((await send(project, first, "Premier message.")).ok);

    const second = new FakeArchitectProvider([respond(fakeProjectTurn({}))]);
    assert.ok((await send(project, second, "Second message.")).ok);

    const sent = second.calls[0]?.input ?? "";
    assert.ok(sent.includes("Project Brief : non defini."), "l'etat n'a pas change");
    assert.equal(sent.includes(BRIEF.summary), false, "une proposition n'est pas un etat");
  });

  it("transmet le nouvel etat au tour suivant une fois applique", async () => {
    const project = await newProject();

    const first = new FakeArchitectProvider([
      respond(fakeProjectTurn({ projectUpdate: { reason: "Le brief.", brief: BRIEF } })),
    ]);
    assert.ok((await send(project, first, "Premier message.")).ok);

    const update = await lastUpdate(project);
    assert.ok(update !== null);
    const applied = await applyProjectUpdate(db, project, update.id, { brief: BRIEF, plan: null });
    assert.ok(applied.ok);

    const second = new FakeArchitectProvider([respond(fakeProjectTurn({}))]);
    assert.ok((await send(project, second, "Second message.")).ok);

    const sent = second.calls[0]?.input ?? "";
    assert.ok(sent.includes(BRIEF.summary), "le nouveau brief est transmis");
    assert.equal(sent.includes("Project Brief : non defini."), false);
  });

  it("n'ecrit aucun message de conversation pour une action locale", async () => {
    // Ni la proposition, ni l'application, ni l'abandon n'entrent dans le
    // transcript. Le fournisseur decouvrira le nouvel etat au tour suivant.
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      respond(fakeProjectTurn({ projectUpdate: { reason: "Le brief.", brief: BRIEF } })),
    ]);
    assert.ok((await send(project, provider)).ok);

    const before = await getArchitectSession(db, project.sessionId);
    assert.equal(before?.messages.length, 2);

    const update = await lastUpdate(project);
    assert.ok(update !== null);
    assert.ok((await applyProjectUpdate(db, project, update.id, { brief: BRIEF, plan: null })).ok);

    const after = await getArchitectSession(db, project.sessionId);
    assert.equal(after?.messages.length, 2, "l'application n'ecrit aucun message");
  });

  it("n'ecrit aucun message a l'abandon non plus", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      respond(fakeProjectTurn({ projectUpdate: { reason: "Le brief.", brief: BRIEF } })),
    ]);
    assert.ok((await send(project, provider)).ok);

    const update = await lastUpdate(project);
    assert.ok(update !== null);
    assert.ok((await dismissProjectUpdate(db, project, update.id)).ok);

    const session = await getArchitectSession(db, project.sessionId);
    assert.equal(session?.messages.length, 2);
  });
});

describe("coexistence avec une proposition de tache", () => {
  it("creer la tache laisse la mise a jour en attente", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      respond(
        fakeProjectTurn({
          proposal: TASK,
          projectUpdate: { reason: "Le perimetre.", plan: PLAN },
        }),
      ),
    ]);

    const outcome = await send(project, provider);
    assert.ok(outcome.ok);
    assert.equal(outcome.turn.proposal?.title, TASK.title);

    // La proposition de tache existe, la mise a jour reste en attente, et l'etat
    // du projet n'a pas bouge : les deux ne se commandent pas.
    const update = await lastUpdate(project);
    assert.equal(update?.status, ARCHITECT_PROJECT_UPDATE_STATUS.PENDING);
    assert.equal((await state(project)).plan.present, false);
  });

  it("appliquer la mise a jour laisse la proposition de tache intacte", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      respond(
        fakeProjectTurn({
          proposal: TASK,
          projectUpdate: { reason: "Le perimetre.", plan: PLAN },
        }),
      ),
    ]);
    const outcome = await send(project, provider);
    assert.ok(outcome.ok);

    const update = await lastUpdate(project);
    assert.ok(update !== null);
    assert.ok((await applyProjectUpdate(db, project, update.id, { brief: null, plan: PLAN })).ok);

    // Le plan est ecrit ; la generation et sa proposition de tache n'ont pas bouge.
    assert.equal((await state(project)).plan.stored?.goal, PLAN.goal);
    const session = await getArchitectSession(db, project.sessionId);
    const generation = session?.generations.find((entry) => entry.id === outcome.generation.id);
    assert.equal(generation?.proposal?.title, TASK.title);
    assert.equal(session?.appliedTaskId ?? null, null, "aucune tache n'a ete creee");
  });
});

describe("revue", () => {
  it("compare l'etat courant a l'etat propose", async () => {
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      respond(fakeProjectTurn({ projectUpdate: { reason: "Le brief.", brief: BRIEF } })),
    ]);
    assert.ok((await send(project, provider)).ok);

    const update = await lastUpdate(project);
    assert.ok(update !== null);
    const review = projectUpdateReview(await state(project), update.proposed);

    assert.equal(review.reason, "Le brief.");
    assert.equal(review.brief.present, false, "aucun brief n'existait");
    assert.equal(review.brief.changed, true);
    assert.equal(review.plan.changed, false, "le plan n'est pas touche");

    const summary = review.brief.fields.find((field) => field.field === "summary");
    assert.equal(summary?.currentText, "");
    assert.equal(summary?.proposedText, BRIEF.summary);
  });
});
