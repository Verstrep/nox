/**
 * Tests de la persistance de l'etat structure.
 *
 * Base temporaire, nettoyeur et revisions injectes : aucun reseau, aucun
 * fournisseur. Ce qui est verifie ici est ce qui distingue une sauvegarde d'une
 * ecriture naive — le budget commun, le jeton de concurrence, et le fait qu'une
 * valeur identique ne change pas de revision.
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
  PROJECT_PLAN_LIMITS,
  type ArchitectPromptBrief,
  type ArchitectPromptV1Plan,
  type ProjectBriefInput,
  type ProjectV1PlanInput,
} from "@nox/shared";

import {
  createDatabaseClient,
  createProject,
  getProjectBrief,
  getProjectV1Plan,
  loadProjectStructuredState,
  saveProjectBrief,
  saveProjectV1Plan,
  toDatabaseFilePath,
  toSqliteUrl,
  type DatabaseClient,
  type ProjectPlanTools,
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

/** Nettoyeur de test : masque un secret, comme le vrai le ferait. */
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

/** Revisions de test : memes proprietes que les vraies, en plus court. */
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
  goals: ["Enregistrer un livre", "Retrouver une lecture"],
  nonGoals: ["Reseau social"],
};

const PLAN: ProjectV1PlanInput = {
  goal: "Suivre une annee.",
  inScope: ["Liste", "Ajout"],
  outOfScope: ["Mobile"],
  technicalDirection: "Web simple.",
  milestones: ["Liste utilisable"],
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

async function newProject(): Promise<string> {
  counter += 1;
  const project = await createProject(db, {
    name: `Projet ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  return project.id;
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-project-plan-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(toDatabaseFilePath(databaseUrl));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("etat absent", () => {
  it("ne rend aucun brief ni plan sur un projet neuf", async () => {
    const projectId = await newProject();

    assert.equal(await getProjectBrief(db, projectId), null);
    assert.equal(await getProjectV1Plan(db, projectId), null);
  });

  it("decrit un etat structure vide, sans inventer de ligne", async () => {
    const projectId = await newProject();
    const state = await loadProjectStructuredState(db, projectId, TOOLS);

    assert.equal(state.brief.present, false);
    assert.equal(state.brief.prompt, null);
    assert.equal(state.brief.revision, null);
    assert.equal(state.plan.present, false);
    assert.equal(state.combinedChars, 0);
  });
});

describe("creation et modification", () => {
  it("cree le brief a la premiere sauvegarde", async () => {
    const projectId = await newProject();
    const result = await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS });

    assert.ok(result.ok);
    assert.equal(result.state.brief.present, true);
    assert.equal(result.state.brief.stored?.summary, "Un suivi de lectures.");
    assert.match(result.state.brief.revision ?? "", /^[0-9a-f]{64}$/u);
  });

  it("cree le plan a la premiere sauvegarde", async () => {
    const projectId = await newProject();
    const result = await saveProjectV1Plan(db, { projectId, values: PLAN, tools: TOOLS });

    assert.ok(result.ok);
    assert.equal(result.state.plan.present, true);
    assert.deepEqual(result.state.plan.stored?.milestones, ["Liste utilisable"]);
  });

  it("garde la meme revision pour une sauvegarde identique", async () => {
    const projectId = await newProject();
    const first = await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS });
    assert.ok(first.ok);

    const again = await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS });
    assert.ok(again.ok);
    assert.equal(again.state.brief.revision, first.state.brief.revision);
  });

  it("change de revision quand le contenu change", async () => {
    const projectId = await newProject();
    const first = await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS });
    assert.ok(first.ok);

    const changed = await saveProjectBrief(db, {
      projectId,
      values: { ...BRIEF, summary: "Autre chose." },
      tools: TOOLS,
    });
    assert.ok(changed.ok);
    assert.notEqual(changed.state.brief.revision, first.state.brief.revision);
  });

  it("change de revision quand une liste est reordonnee", async () => {
    // L'ordre est significatif : deux objectifs intervertis ne se lisent pas
    // pareil, donc ne produisent pas le meme prompt.
    const projectId = await newProject();
    const first = await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS });
    assert.ok(first.ok);

    const reordered = await saveProjectBrief(db, {
      projectId,
      values: { ...BRIEF, goals: [...BRIEF.goals].reverse() },
      tools: TOOLS,
    });
    assert.ok(reordered.ok);
    assert.notEqual(reordered.state.brief.revision, first.state.brief.revision);
  });

  it("normalise avant d'ecrire", async () => {
    const projectId = await newProject();
    const result = await saveProjectBrief(db, {
      projectId,
      values: { ...BRIEF, summary: "  Avec des marges.  ", goals: ["A", "  ", "B"] },
      tools: TOOLS,
    });

    assert.ok(result.ok);
    assert.equal(result.state.brief.stored?.summary, "Avec des marges.");
    assert.deepEqual(result.state.brief.stored?.goals, ["A", "B"]);
  });

  it("refuse un champ hors borne", async () => {
    const projectId = await newProject();
    const result = await saveProjectBrief(db, {
      projectId,
      values: { ...BRIEF, summary: "a".repeat(PROJECT_PLAN_LIMITS.summary + 1) },
      tools: TOOLS,
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.reason, "invalid");
    assert.equal(await getProjectBrief(db, projectId), null, "rien n'a ete ecrit");
  });

  it("refuse un projet inconnu", async () => {
    const result = await saveProjectBrief(db, {
      projectId: "projet-inexistant",
      values: BRIEF,
      tools: TOOLS,
    });
    assert.equal(result.ok ? null : result.reason, "not_found");
  });
});

describe("sanitation", () => {
  it("mesure et hache le texte transmis, pas la saisie", async () => {
    const projectId = await newProject();
    const result = await saveProjectBrief(db, {
      projectId,
      values: { ...BRIEF, summary: "La cle est SECRET-REEL." },
      tools: TOOLS,
    });

    assert.ok(result.ok);
    // Stocke tel qu'ecrit…
    assert.ok(result.state.brief.stored?.summary.includes("SECRET-REEL"));
    // …mais ce qui part est nettoye.
    assert.equal(result.state.brief.prompt?.summary.includes("SECRET-REEL"), false);
    assert.ok(result.state.brief.prompt?.summary.includes("[masque]"));
  });
});

describe("budget commun", () => {
  const filler = (total: number): string => "a".repeat(total);

  it("accepte un brief seul qui tient dans le budget", async () => {
    const projectId = await newProject();
    const result = await saveProjectBrief(db, {
      projectId,
      values: { ...BRIEF, problem: filler(PROJECT_PLAN_LIMITS.problem) },
      tools: TOOLS,
    });
    assert.ok(result.ok);
  });

  it("refuse quand le brief et le plan depassent ensemble", async () => {
    const projectId = await newProject();

    // Un plan lourd, mais valide seul.
    const heavyPlan = await saveProjectV1Plan(db, {
      projectId,
      values: {
        ...PLAN,
        goal: filler(PROJECT_PLAN_LIMITS.goal),
        technicalDirection: filler(PROJECT_PLAN_LIMITS.technicalDirection),
        inScope: [],
        outOfScope: [],
        // Le plan atteint exactement la borne : seul, il passe.
        milestones: Array.from({ length: PROJECT_PLAN_LIMITS.items }, () =>
          filler(PROJECT_PLAN_LIMITS.item),
        ),
      },
      tools: TOOLS,
    });
    assert.ok(heavyPlan.ok, "le plan seul tient");

    // Un brief lourd, valide seul lui aussi. Leur somme, non.
    const heavyBrief = await saveProjectBrief(db, {
      projectId,
      values: {
        ...BRIEF,
        summary: filler(PROJECT_PLAN_LIMITS.summary),
        problem: filler(PROJECT_PLAN_LIMITS.problem),
        targetUsers: "",
        desiredOutcome: "",
        goals: Array.from({ length: 12 }, () => filler(PROJECT_PLAN_LIMITS.item)),
        nonGoals: [],
      },
      tools: TOOLS,
    });

    assert.equal(heavyBrief.ok, false);
    assert.equal(heavyBrief.ok ? null : heavyBrief.reason, "budget");
    assert.equal(await getProjectBrief(db, projectId), null, "aucune ecriture partielle");
  });

  it("mesure le budget apres sanitation", async () => {
    const projectId = await newProject();
    const state = await loadProjectStructuredState(db, projectId, TOOLS);
    assert.equal(state.combinedChars, 0);

    const saved = await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS });
    assert.ok(saved.ok);
    assert.equal(saved.state.combinedChars, saved.state.brief.chars);
  });
});

describe("concurrence optimiste", () => {
  it("accepte une sauvegarde qui annonce la bonne revision", async () => {
    const projectId = await newProject();
    const first = await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS });
    assert.ok(first.ok);

    const second = await saveProjectBrief(db, {
      projectId,
      values: { ...BRIEF, summary: "Mise a jour." },
      tools: TOOLS,
      expectedRevision: first.state.brief.revision,
    });
    assert.ok(second.ok);
  });

  it("refuse un onglet reste sur une revision depassee", async () => {
    const projectId = await newProject();
    const initial = await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS });
    assert.ok(initial.ok);
    const staleRevision = initial.state.brief.revision;

    // Un autre onglet ecrit entre-temps.
    const other = await saveProjectBrief(db, {
      projectId,
      values: { ...BRIEF, summary: "Ecrit par l'onglet B." },
      tools: TOOLS,
      expectedRevision: staleRevision,
    });
    assert.ok(other.ok);

    const late = await saveProjectBrief(db, {
      projectId,
      values: { ...BRIEF, summary: "Ecrit par l'onglet A." },
      tools: TOOLS,
      expectedRevision: staleRevision,
    });

    assert.equal(late.ok, false);
    assert.equal(late.ok ? null : late.reason, "stale");
    const current = await getProjectBrief(db, projectId);
    assert.equal(current?.summary, "Ecrit par l'onglet B.", "le premier ecrivain garde la main");
  });

  it("attend `null` quand aucun brief n'existe encore", async () => {
    const projectId = await newProject();
    const result = await saveProjectBrief(db, {
      projectId,
      values: BRIEF,
      tools: TOOLS,
      expectedRevision: null,
    });
    assert.ok(result.ok);
  });

  it("refuse une creation qui croit a tort qu'un brief existe", async () => {
    const projectId = await newProject();
    const result = await saveProjectBrief(db, {
      projectId,
      values: BRIEF,
      tools: TOOLS,
      expectedRevision: "f".repeat(64),
    });
    assert.equal(result.ok ? null : result.reason, "stale");
  });

  it("ne produit qu'une ligne sur deux creations simultanees", async () => {
    const projectId = await newProject();

    await Promise.all([
      saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS }),
      saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS }),
    ]).catch(() => undefined);

    const rows = await db.projectBrief.findMany({ where: { projectId } });
    assert.equal(rows.length, 1, "une seule ligne, jamais un doublon");
  });
});

describe("isolation entre projets", () => {
  it("n'ecrit jamais dans le projet voisin", async () => {
    const first = await newProject();
    const second = await newProject();

    assert.ok((await saveProjectBrief(db, { projectId: first, values: BRIEF, tools: TOOLS })).ok);

    assert.equal(await getProjectBrief(db, second), null);
    const state = await loadProjectStructuredState(db, second, TOOLS);
    assert.equal(state.brief.present, false);
  });

  it("garde deux briefs distincts", async () => {
    const first = await newProject();
    const second = await newProject();

    await saveProjectBrief(db, { projectId: first, values: BRIEF, tools: TOOLS });
    await saveProjectBrief(db, {
      projectId: second,
      values: { ...BRIEF, summary: "Un autre projet." },
      tools: TOOLS,
    });

    assert.equal((await getProjectBrief(db, first))?.summary, "Un suivi de lectures.");
    assert.equal((await getProjectBrief(db, second))?.summary, "Un autre projet.");
  });
});

describe("suppression du projet", () => {
  it("emporte le brief et le plan, sans orphelin", async () => {
    const projectId = await newProject();
    await saveProjectBrief(db, { projectId, values: BRIEF, tools: TOOLS });
    await saveProjectV1Plan(db, { projectId, values: PLAN, tools: TOOLS });

    await db.project.delete({ where: { id: projectId } });

    assert.equal(await db.projectBrief.count({ where: { projectId } }), 0);
    assert.equal(await db.projectV1Plan.count({ where: { projectId } }), 0);
  });
});
