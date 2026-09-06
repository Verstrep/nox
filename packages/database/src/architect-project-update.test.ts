/**
 * Cycle de vie d'une proposition de mise a jour du projet.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'une proposition ne peut pas modifier le projet sans qu'un humain le
 * demande, qu'elle ne peut le faire qu'une fois, et qu'elle est refusee des que
 * l'etat qu'elle avait sous les yeux a change.
 *
 * Le scenario central est celui de la concurrence : une proposition batie sur
 * l'etat A, un plan modifie a la main pendant l'appel, et un Apply qui doit etre
 * refuse. C'est exactement le bug que la correction des revisions de base repare,
 * et le test est ecrit pour echouer si on relit l'etat courant au moment
 * d'enregistrer.
 *
 * Base temporaire, aucun reseau, aucun fournisseur.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHITECT_GENERATION_STATUS,
  ARCHITECT_MESSAGE_ROLE,
  ARCHITECT_PROJECT_UPDATE_STATUS,
  ARCHITECT_SESSION_KIND,
  ARCHITECT_TURN_STATE,
  PROJECT_PLAN_LIMITS,
  PROJECT_UPDATE_ACTION,
  type ArchitectContextManifest,
  type ArchitectProjectUpdateProposal,
  type ArchitectPromptBrief,
  type ArchitectPromptV1Plan,
  type ProjectBriefInput,
  type ProjectMemoryProposal,
  type ProjectV1PlanInput,
} from "@nox/shared";

import {
  applyArchitectProjectUpdate,
  createArchitectProjectUpdate,
  createArchitectSession,
  createDatabaseClient,
  createProject,
  dismissArchitectProjectUpdate,
  finishArchitectGeneration,
  getArchitectProjectUpdate,
  getArchitectProjectUpdateForGeneration,
  listArchitectProjectUpdatesForSession,
  loadProjectStructuredState,
  saveArchitectTurnDraft,
  saveProjectBrief,
  saveProjectV1Plan,
  startArchitectGeneration,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
  type ProjectPlanTools,
  type ProjectUpdateBase,
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

const SANITIZE = (value: string): string => value.replaceAll("SECRET-REEL", "[masque]");

function hashOf(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part.length));
    hash.update(" ");
    hash.update(part, "utf8");
  }
  return hash.digest("hex");
}

const TOOLS: ProjectPlanTools = {
  sanitize: SANITIZE,
  revisions: {
    brief: (brief: ArchitectPromptBrief) =>
      hashOf([
        "brief",
        brief.summary,
        brief.problem,
        brief.targetUsers,
        brief.desiredOutcome,
        ...brief.goals,
        "|",
        ...brief.nonGoals,
      ]),
    plan: (plan: ArchitectPromptV1Plan) =>
      hashOf([
        "plan",
        plan.goal,
        plan.technicalDirection,
        ...plan.inScope,
        "|",
        ...plan.outOfScope,
        "|",
        ...plan.milestones,
      ]),
  },
};

const BRIEF: ProjectBriefInput = {
  summary: "Un suivi de lectures.",
  problem: "Rien ne centralise mes lectures.",
  targetUsers: "Moi seul.",
  desiredOutcome: "Savoir ce que j'ai lu.",
  goals: ["Enregistrer un livre"],
  nonGoals: ["Reseau social"],
};

const PLAN: ProjectV1PlanInput = {
  goal: "Suivre une annee.",
  inScope: ["Liste"],
  outOfScope: ["Mobile"],
  technicalDirection: "Web simple.",
  milestones: ["Liste utilisable"],
};

const MANIFEST: ArchitectContextManifest = {
  schemaVersion: 1,
  sources: [],
  totalChars: 0,
  missing: [],
};

const FINGERPRINT = "f".repeat(64);

function proposal(
  overrides: {
    reason?: string;
    brief?: ProjectBriefInput | null;
    plan?: ProjectV1PlanInput | null;
    /** Regles durables proposees, depuis HOTFIX-005. Vide dans le cas ordinaire. */
    memories?: ProjectMemoryProposal[];
  } = {},
): ArchitectProjectUpdateProposal {
  const brief = overrides.brief === undefined ? BRIEF : overrides.brief;
  const plan = overrides.plan === undefined ? null : overrides.plan;
  return {
    memories: overrides.memories ?? [],
    reason: overrides.reason ?? "La discussion a etabli le produit.",
    brief:
      brief === null
        ? { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null }
        : { action: PROJECT_UPDATE_ACTION.SET, value: brief },
    plan:
      plan === null
        ? { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null }
        : { action: PROJECT_UPDATE_ACTION.SET, value: plan },
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

async function newProject(): Promise<string> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  return project.id;
}

/** Ouvre une conversation projet et joue un tour, qui reste a conclure. */
async function newTurn(projectId: string): Promise<{ sessionId: string; generationId: string }> {
  const session = await createArchitectSession(db, {
    projectId,
    requestText: "",
    kind: ARCHITECT_SESSION_KIND.PROJECT,
  });
  assert.ok(session !== null);

  await saveArchitectTurnDraft(db, {
    sessionId: session.id,
    messageText: "Voici mon produit.",
    contextFingerprint: FINGERPRINT,
    manifest: MANIFEST,
  });
  const started = await startArchitectGeneration(db, {
    sessionId: session.id,
    model: "modele",
    promptVersion: "architect/4",
    inputHash: "a".repeat(64),
    contextFingerprint: FINGERPRINT,
    manifest: MANIFEST,
  });
  assert.ok(started.ok);

  await finishArchitectGeneration(db, {
    generationId: started.generation.id,
    status: ARCHITECT_GENERATION_STATUS.CONTINUE,
    turnState: ARCHITECT_TURN_STATE.CONTINUE,
    questions: [],
    messages: [
      { role: ARCHITECT_MESSAGE_ROLE.USER, content: "Voici mon produit." },
      { role: ARCHITECT_MESSAGE_ROLE.ARCHITECT, content: "Compris." },
    ],
  });

  return { sessionId: session.id, generationId: started.generation.id };
}

/** Etat structure courant, sous la forme attendue comme base de proposition. */
async function baseOf(projectId: string): Promise<ProjectUpdateBase> {
  const state = await loadProjectStructuredState(db, projectId, TOOLS);
  // La revision de memoire n'est pas calculee ici : ces tests ne posent aucune
  // regle durable, et `null` decrit exactement cela — « rien a proteger ».
  return {
    briefRevision: state.brief.revision,
    planRevision: state.plan.revision,
    memoryRevision: null,
  };
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-project-update-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("enregistrement d'une proposition", () => {
  it("attache la proposition a son tour, en attente", async () => {
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);

    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: await baseOf(projectId),
    });

    assert.ok(created.ok);
    assert.equal(created.update.status, ARCHITECT_PROJECT_UPDATE_STATUS.PENDING);
    assert.equal(created.update.generationId, generationId);
    assert.equal(created.update.applied, null, "rien n'a encore ete applique");
    assert.equal(created.update.appliedAt, null);
    assert.equal(created.update.dismissedAt, null);
  });

  it("conserve le payload du fournisseur tel quel", async () => {
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);
    const proposed = proposal({ plan: PLAN });

    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed,
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);

    const relu = await getArchitectProjectUpdate(db, created.update.id);
    assert.deepEqual(relu?.proposed, proposed);
  });

  it("n'accepte qu'une proposition par generation", async () => {
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);
    const base = await baseOf(projectId);

    assert.ok(
      (await createArchitectProjectUpdate(db, { generationId, projectId, proposed: proposal(), baseState: base }))
        .ok,
    );
    const second = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: base,
    });

    assert.equal(second.ok, false);
    assert.equal(second.ok ? null : second.reason, "already_exists");
  });

  it("refuse une generation inconnue", async () => {
    const projectId = await newProject();
    const created = await createArchitectProjectUpdate(db, {
      generationId: "generation-inexistante",
      projectId,
      proposed: proposal(),
      baseState: await baseOf(projectId),
    });
    assert.equal(created.ok, false);
    assert.equal(created.ok ? null : created.reason, "not_found");
  });

  it("se retrouve depuis son tour, et depuis sa conversation", async () => {
    const projectId = await newProject();
    const { sessionId, generationId } = await newTurn(projectId);
    await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: await baseOf(projectId),
    });

    assert.notEqual(await getArchitectProjectUpdateForGeneration(db, generationId), null);
    assert.equal((await listArchitectProjectUpdatesForSession(db, sessionId)).length, 1);
  });
});

describe("revisions de base", () => {
  it("enregistre null quand rien n'etait defini", async () => {
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);

    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: await baseOf(projectId),
    });

    assert.ok(created.ok);
    assert.equal(created.update.baseBriefRevision, null);
    assert.equal(created.update.basePlanRevision, null);
  });

  it("enregistre l'etat vu par le fournisseur, pas l'etat d'arrivee", async () => {
    // Le scenario du bug. Le tour part a l'etat A ; l'utilisateur enregistre un
    // plan pendant que l'appel est en vol ; la proposition arrive et doit rester
    // etiquetee A.
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);

    assert.ok((await saveProjectV1Plan(db, { projectId, values: PLAN, tools: TOOLS })).ok);
    const stateA = await baseOf(projectId);

    // Pendant l'appel : modification manuelle du plan.
    assert.ok(
      (
        await saveProjectV1Plan(db, {
          projectId,
          values: { ...PLAN, goal: "Un tout autre objectif." },
          tools: TOOLS,
        })
      ).ok,
    );
    const stateB = await baseOf(projectId);
    assert.notEqual(stateA.planRevision, stateB.planRevision, "le plan a bien change");

    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: stateA,
    });

    assert.ok(created.ok);
    assert.equal(
      created.update.basePlanRevision,
      stateA.planRevision,
      "la base est l'etat vu par le fournisseur",
    );
    assert.notEqual(
      created.update.basePlanRevision,
      stateB.planRevision,
      "surtout pas l'etat courant a l'arrivee",
    );

    // Et cette proposition doit etre refusee a l'application.
    const applied = await applyArchitectProjectUpdate(db, {
      projectId,
      updateId: created.update.id,
      target: { brief: BRIEF, plan: null },
      tools: TOOLS,
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "stale");

    // Aucune ecriture : le brief n'a pas ete cree.
    const state = await loadProjectStructuredState(db, projectId, TOOLS);
    assert.equal(state.brief.present, false, "aucune ecriture apres un refus");
  });
});

describe("application", () => {
  it("ecrit le brief propose et passe la proposition a APPLIED", async () => {
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);

    const applied = await applyArchitectProjectUpdate(db, {
      projectId,
      updateId: created.update.id,
      target: { brief: BRIEF, plan: null },
      tools: TOOLS,
    });

    assert.ok(applied.ok);
    assert.equal(applied.update.status, ARCHITECT_PROJECT_UPDATE_STATUS.APPLIED);
    assert.notEqual(applied.update.appliedAt, null);
    assert.equal(applied.state.brief.stored?.summary, BRIEF.summary);
    assert.equal(applied.state.plan.present, false, "le plan n'a pas ete touche");
  });

  it("ecrit le brief et le plan sous une seule transaction", async () => {
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal({ plan: PLAN }),
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);

    const applied = await applyArchitectProjectUpdate(db, {
      projectId,
      updateId: created.update.id,
      target: { brief: BRIEF, plan: PLAN },
      tools: TOOLS,
    });

    assert.ok(applied.ok);
    assert.equal(applied.state.brief.stored?.summary, BRIEF.summary);
    assert.equal(applied.state.plan.stored?.goal, PLAN.goal);
  });

  it("conserve separement ce que le fournisseur proposait et ce qui a ete applique", async () => {
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);
    const proposed = proposal();
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed,
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);

    // L'utilisateur restreint la cible avant d'appliquer.
    const edited: ProjectBriefInput = { ...BRIEF, targetUsers: "Moi seul, et personne d'autre." };
    const applied = await applyArchitectProjectUpdate(db, {
      projectId,
      updateId: created.update.id,
      target: { brief: edited, plan: null },
      tools: TOOLS,
    });
    assert.ok(applied.ok);

    const relu = await getArchitectProjectUpdate(db, created.update.id);
    assert.deepEqual(relu?.proposed, proposed, "le payload du fournisseur n'a pas bouge");
    assert.equal(relu?.applied?.brief?.targetUsers, edited.targetUsers, "et l'applique est celui de l'humain");
    assert.notEqual(relu?.proposed.brief.value?.targetUsers, relu?.applied?.brief?.targetUsers);
  });

  it("fige les deux artefacts, meme si le projet change ensuite", async () => {
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal({ plan: PLAN }),
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);

    assert.ok(
      (
        await applyArchitectProjectUpdate(db, {
          projectId,
          updateId: created.update.id,
          target: { brief: BRIEF, plan: PLAN },
          tools: TOOLS,
        })
      ).ok,
    );
    const justAfter = await getArchitectProjectUpdate(db, created.update.id);

    // Le plan est ensuite modifie a la main : l'historique ne bouge pas.
    assert.ok(
      (
        await saveProjectV1Plan(db, {
          projectId,
          values: { ...PLAN, goal: "Encore autre chose." },
          tools: TOOLS,
        })
      ).ok,
    );

    const later = await getArchitectProjectUpdate(db, created.update.id);
    assert.deepEqual(later?.proposed, justAfter?.proposed);
    assert.deepEqual(later?.applied, justAfter?.applied);
  });

  it("revalide la cible editee par l'humain", async () => {
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);

    // La proposition d'origine etait valide ; la valeur editee ne l'est pas.
    const applied = await applyArchitectProjectUpdate(db, {
      projectId,
      updateId: created.update.id,
      target: {
        brief: { ...BRIEF, summary: "a".repeat(PROJECT_PLAN_LIMITS.summary + 1) },
        plan: null,
      },
      tools: TOOLS,
    });

    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "invalid");
    const state = await loadProjectStructuredState(db, projectId, TOOLS);
    assert.equal(state.brief.present, false, "aucune ecriture");
  });

  it("refuse une cible qui depasserait le budget commun", async () => {
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);

    const huge: ProjectBriefInput = {
      summary: "a".repeat(PROJECT_PLAN_LIMITS.summary),
      problem: "b".repeat(PROJECT_PLAN_LIMITS.problem),
      targetUsers: "c".repeat(PROJECT_PLAN_LIMITS.targetUsers),
      desiredOutcome: "d".repeat(PROJECT_PLAN_LIMITS.desiredOutcome),
      goals: Array.from({ length: PROJECT_PLAN_LIMITS.items }, () =>
        "g".repeat(PROJECT_PLAN_LIMITS.item),
      ),
      nonGoals: [],
    };

    const applied = await applyArchitectProjectUpdate(db, {
      projectId,
      updateId: created.update.id,
      target: { brief: huge, plan: null },
      tools: TOOLS,
    });

    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "budget");
  });

  it("refuse une cible qui n'ecrirait rien", async () => {
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);

    const applied = await applyArchitectProjectUpdate(db, {
      projectId,
      updateId: created.update.id,
      target: { brief: null, plan: null },
      tools: TOOLS,
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "invalid");
  });

  it("refuse une seconde application", async () => {
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);

    assert.ok(
      (
        await applyArchitectProjectUpdate(db, {
          projectId,
          updateId: created.update.id,
          target: { brief: BRIEF, plan: null },
          tools: TOOLS,
        })
      ).ok,
    );

    // Pas d'idempotence silencieuse : le second appel dit non.
    const again = await applyArchitectProjectUpdate(db, {
      projectId,
      updateId: created.update.id,
      target: { brief: BRIEF, plan: null },
      tools: TOOLS,
    });
    assert.equal(again.ok, false);
    assert.equal(again.ok ? null : again.reason, "not_pending");
  });
});

describe("peremption", () => {
  async function pending(projectId: string): Promise<string> {
    const { generationId } = await newTurn(projectId);
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal({ plan: PLAN }),
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);
    return created.update.id;
  }

  it("refuse quand le brief a change depuis la proposition", async () => {
    const projectId = await newProject();
    assert.ok((await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS })).ok);
    const updateId = await pending(projectId);

    assert.ok(
      (
        await saveProjectBrief(db, {
          projectId,
          values: { ...BRIEF, summary: "Autre chose." },
          tools: TOOLS,
        })
      ).ok,
    );

    const applied = await applyArchitectProjectUpdate(db, {
      projectId,
      updateId,
      target: { brief: BRIEF, plan: null },
      tools: TOOLS,
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "stale");
  });

  it("refuse quand le plan a change, meme si la proposition ne touche que le brief", async () => {
    // Le modele a vu le plan en formulant ce brief : un plan modifie depuis peut
    // invalider son raisonnement, sans que rien dans la proposition ne le montre.
    const projectId = await newProject();
    assert.ok((await saveProjectV1Plan(db, { projectId, values: PLAN, tools: TOOLS })).ok);
    const { generationId } = await newTurn(projectId);
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);

    assert.ok(
      (
        await saveProjectV1Plan(db, {
          projectId,
          values: { ...PLAN, goal: "Un autre objectif." },
          tools: TOOLS,
        })
      ).ok,
    );

    const applied = await applyArchitectProjectUpdate(db, {
      projectId,
      updateId: created.update.id,
      target: { brief: BRIEF, plan: null },
      tools: TOOLS,
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "stale");
  });

  it("refuse quand une section absente a ete creee entre-temps", async () => {
    // `null` et « defini » sont deux etats distincts, et la difference compte :
    // le fournisseur n'avait aucun brief sous les yeux.
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal({ brief: null, plan: PLAN }),
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);
    assert.equal(created.update.baseBriefRevision, null);

    assert.ok((await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS })).ok);

    const applied = await applyArchitectProjectUpdate(db, {
      projectId,
      updateId: created.update.id,
      target: { brief: null, plan: PLAN },
      tools: TOOLS,
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "stale");
  });

  it("rend les revisions courantes avec son refus", async () => {
    const projectId = await newProject();
    const updateId = await pending(projectId);
    assert.ok((await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS })).ok);

    const applied = await applyArchitectProjectUpdate(db, {
      projectId,
      updateId,
      target: { brief: BRIEF, plan: null },
      tools: TOOLS,
    });

    assert.equal(applied.ok, false);
    if (!applied.ok && applied.reason === "stale") {
      const state = await loadProjectStructuredState(db, projectId, TOOLS);
      assert.equal(applied.currentBriefRevision, state.brief.revision);
      assert.equal(applied.currentPlanRevision, state.plan.revision);
    }
  });

  it("laisse la proposition en attente apres un refus", async () => {
    // Perimee ne veut pas dire perdue : elle reste lisible, et l'interface
    // pourra expliquer la situation.
    const projectId = await newProject();
    const updateId = await pending(projectId);
    assert.ok((await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS })).ok);

    await applyArchitectProjectUpdate(db, {
      projectId,
      updateId,
      target: { brief: BRIEF, plan: null },
      tools: TOOLS,
    });

    const relu = await getArchitectProjectUpdate(db, updateId);
    assert.equal(relu?.status, ARCHITECT_PROJECT_UPDATE_STATUS.PENDING);
  });
});

describe("abandon", () => {
  async function pending(projectId: string): Promise<string> {
    const { generationId } = await newTurn(projectId);
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);
    return created.update.id;
  }

  it("passe a DISMISSED sans rien ecrire", async () => {
    const projectId = await newProject();
    const updateId = await pending(projectId);

    const dismissed = await dismissArchitectProjectUpdate(db, { projectId, updateId, tools: TOOLS });

    assert.ok(dismissed.ok);
    assert.equal(dismissed.update.status, ARCHITECT_PROJECT_UPDATE_STATUS.DISMISSED);
    assert.notEqual(dismissed.update.dismissedAt, null);
    assert.equal(dismissed.state.brief.present, false, "aucun brief ecrit");
    assert.equal(dismissed.state.plan.present, false, "aucun plan ecrit");
  });

  it("garde la proposition lisible", async () => {
    const projectId = await newProject();
    const updateId = await pending(projectId);
    await dismissArchitectProjectUpdate(db, { projectId, updateId, tools: TOOLS });

    const relu = await getArchitectProjectUpdate(db, updateId);
    assert.equal(relu?.proposed.brief.action, PROJECT_UPDATE_ACTION.SET);
    assert.equal(relu?.applied, null, "rien n'a ete applique");
  });

  it("refuse un abandon apres application", async () => {
    const projectId = await newProject();
    const updateId = await pending(projectId);
    assert.ok(
      (
        await applyArchitectProjectUpdate(db, {
          projectId,
          updateId,
          target: { brief: BRIEF, plan: null },
          tools: TOOLS,
        })
      ).ok,
    );

    const dismissed = await dismissArchitectProjectUpdate(db, { projectId, updateId, tools: TOOLS });
    assert.equal(dismissed.ok, false);
    assert.equal(dismissed.ok ? null : dismissed.reason, "not_pending");
  });

  it("refuse une application apres abandon", async () => {
    const projectId = await newProject();
    const updateId = await pending(projectId);
    assert.ok((await dismissArchitectProjectUpdate(db, { projectId, updateId, tools: TOOLS })).ok);

    const applied = await applyArchitectProjectUpdate(db, {
      projectId,
      updateId,
      target: { brief: BRIEF, plan: null },
      tools: TOOLS,
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "not_pending");

    const state = await loadProjectStructuredState(db, projectId, TOOLS);
    assert.equal(state.brief.present, false);
  });

  it("refuse un second abandon", async () => {
    const projectId = await newProject();
    const updateId = await pending(projectId);
    assert.ok((await dismissArchitectProjectUpdate(db, { projectId, updateId, tools: TOOLS })).ok);

    const again = await dismissArchitectProjectUpdate(db, { projectId, updateId, tools: TOOLS });
    assert.equal(again.ok, false);
  });
});

describe("concurrence entre application et abandon", () => {
  it("une seule des deux aboutit", async () => {
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);
    const updateId = created.update.id;

    const [applied, dismissed] = await Promise.all([
      applyArchitectProjectUpdate(db, {
        projectId,
        updateId,
        target: { brief: BRIEF, plan: null },
        tools: TOOLS,
      }),
      dismissArchitectProjectUpdate(db, { projectId, updateId, tools: TOOLS }),
    ]);

    assert.equal([applied, dismissed].filter((result) => result.ok).length, 1);

    // Et surtout : l'etat « brief modifie, proposition ecartee » n'existe pas.
    const relu = await getArchitectProjectUpdate(db, updateId);
    const state = await loadProjectStructuredState(db, projectId, TOOLS);
    if (relu?.status === ARCHITECT_PROJECT_UPDATE_STATUS.APPLIED) {
      assert.equal(state.brief.present, true, "applique : le brief existe");
    } else {
      assert.equal(state.brief.present, false, "ecartee : rien n'a ete ecrit");
    }
  });

  it("deux applications simultanees n'en font qu'une", async () => {
    const projectId = await newProject();
    const { generationId } = await newTurn(projectId);
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);

    const results = await Promise.all([
      applyArchitectProjectUpdate(db, {
        projectId,
        updateId: created.update.id,
        target: { brief: BRIEF, plan: null },
        tools: TOOLS,
      }),
      applyArchitectProjectUpdate(db, {
        projectId,
        updateId: created.update.id,
        target: { brief: BRIEF, plan: null },
        tools: TOOLS,
      }),
    ]);

    assert.equal(results.filter((result) => result.ok).length, 1);
  });
});

describe("isolation entre projets", () => {
  it("un autre projet ne peut ni appliquer ni ecarter", async () => {
    const projectId = await newProject();
    const autre = await newProject();
    const { generationId } = await newTurn(projectId);
    const created = await createArchitectProjectUpdate(db, {
      generationId,
      projectId,
      proposed: proposal(),
      baseState: await baseOf(projectId),
    });
    assert.ok(created.ok);

    const applied = await applyArchitectProjectUpdate(db, {
      projectId: autre,
      updateId: created.update.id,
      target: { brief: BRIEF, plan: null },
      tools: TOOLS,
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "not_found");

    const dismissed = await dismissArchitectProjectUpdate(db, {
      projectId: autre,
      updateId: created.update.id,
      tools: TOOLS,
    });
    assert.equal(dismissed.ok, false);
    assert.equal(dismissed.ok ? null : dismissed.reason, "not_found");

    // La proposition d'origine n'a pas bouge.
    const relu = await getArchitectProjectUpdate(db, created.update.id);
    assert.equal(relu?.status, ARCHITECT_PROJECT_UPDATE_STATUS.PENDING);
  });

  it("refuse une proposition inconnue", async () => {
    const projectId = await newProject();
    const applied = await applyArchitectProjectUpdate(db, {
      projectId,
      updateId: "proposition-inexistante",
      target: { brief: BRIEF, plan: null },
      tools: TOOLS,
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.ok ? null : applied.reason, "not_found");
  });
});
