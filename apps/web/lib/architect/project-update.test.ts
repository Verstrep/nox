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
  ARCHITECT_DIAGNOSTIC_FIELD,
  ARCHITECT_ERROR,
  ARCHITECT_TURN_FAILURE,
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
  loadReplanPlanningState,
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
    // L'etat reel du projet, comme la Server Action le lit. Ces projets n'ont
    // aucun backlog applique : la replanification y est donc indisponible, et le
    // tour parle encore `architect/4` — exactement comme avant TASK-032.
    planningState: await loadReplanPlanningState(db, project.id),
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
    // Ce test attendait `ARCHITECT_OUTPUT_INVALID` jusqu'a HOTFIX-003. Un
    // depassement de budget n'est pas une violation de contrat : la reponse
    // etait bien formee, et NOX refuse de l'ecrire. Les confondre disait a
    // l'utilisateur de relancer un appel dont le refus est deterministe — ce
    // que le second pilote reel a fait deux fois de suite.
    assert.equal(
      "code" in outcome ? outcome.code : null,
      ARCHITECT_ERROR.ARCHITECT_UPDATE_TOO_LARGE,
    );
    assert.equal(await lastUpdate(project), null, "aucune proposition impossible n'est stockee");

    const session = await getArchitectSession(db, project.sessionId);
    assert.equal(session?.messages.length, 0, "aucun message n'a ete fige");
    assert.notEqual(session?.status, "GENERATING", "le verrou est rendu");

    // Le diagnostic dit ou regarder et quoi faire, avec deux nombres que NOX a
    // calcules lui-meme — jamais recopies de la reponse.
    const generation = session?.generations[0];
    assert.equal(generation?.diagnostic?.category, ARCHITECT_TURN_FAILURE.UPDATE_TOO_LARGE);
    assert.equal(generation?.diagnostic?.field, ARCHITECT_DIAGNOSTIC_FIELD.BUDGET);
    assert.match(generation?.diagnostic?.message ?? "", /caracteres/u);

    // Et le message de l'utilisateur reste disponible pour un nouvel envoi.
    assert.notEqual(session?.pendingTurn, null);
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

// ---------------------------------------------------------------------------
// HOTFIX-003 (suite) — le tour 10 de TicketPulse, et l'ordre des validations
// ---------------------------------------------------------------------------

/**
 * La forme exacte du pilote : un plan deja fourni, cinq decisions nouvelles.
 *
 * Le tour 10 a rejoue la demande des tours 8 et 9 et le diagnostic a nomme la
 * cause : `projectUpdate.plan.inScope` refuse pour `too_many`. Ces tests fixent
 * les deux moities du correctif — le refus reste strict, et la reponse qui
 * consolide passe.
 */
describe("HOTFIX-003 — le cas TicketPulse, de bout en bout", () => {
  /** Un perimetre deja substantiellement rempli, comme celui du pilote. */
  const EXISTING = Array.from(
    { length: PROJECT_PLAN_LIMITS.items - 2 },
    (_, index) => `Regle de perimetre deja etablie ${String(index + 1)}`,
  );

  /** Les cinq decisions durables que l'utilisateur vient de trancher. */
  const NEW_DECISIONS = [
    "Le classeur porte exactement une feuille, quel que soit son nom",
    "Un CI ou une application vide reste valide et s'affiche « Non renseigne »",
    "Un numero d'incident duplique rejette toutes ses occurrences, pas le fichier",
    "Les valeurs textuelles sont debarrassees de leurs espaces de bord",
    "Seuls les champs de ticket definis en V1 sont persistes",
  ];

  function planTurn(inScope: readonly string[]): Record<string, unknown> {
    return {
      ...fakeProjectTurn({}),
      projectUpdate: {
        reason: "Les decisions de contrat d'import sont tranchees.",
        brief: { action: "UNCHANGED", value: null },
        plan: {
          action: "SET",
          value: {
            goal: "Ingerer un export de tickets et les afficher.",
            technicalDirection: "Import synchrone d'un classeur a feuille unique.",
            inScope: [...inScope],
            outOfScope: ["Connecteurs tiers"],
            milestones: ["Contrat d'import fige", "Ecran de liste utilisable"],
          },
        },
      },
    };
  }

  it("refuse la reponse qui ajoute une ligne par decision", async () => {
    // Exactement ce qui s'est passe : 18 entrees existantes + 5 ajouts = 23.
    const project = await newProject();
    const provider = new FakeArchitectProvider([
      respond(planTurn([...EXISTING, ...NEW_DECISIONS])),
    ]);

    const outcome = await send(project, provider);

    assert.equal(outcome.ok, false);
    assert.equal(
      "code" in outcome ? outcome.code : null,
      ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
    );

    const session = await getArchitectSession(db, project.sessionId);
    const diagnostic = session?.generations[0]?.diagnostic;
    // Le diagnostic que le pilote a effectivement lu au tour 10.
    assert.equal(diagnostic?.field, "projectUpdate.plan.inScope");
    assert.match(diagnostic?.message ?? "", /too_many/u);

    // Rien n'est tronque, rien n'est applique, et le message reste disponible.
    assert.equal(await lastUpdate(project), null);
    assert.notEqual(session?.pendingTurn, null);
  });

  it("accepte la reponse qui consolide au lieu d'ajouter", async () => {
    // Le geste que le prompt demande desormais : les cinq decisions tiennent en
    // deux entrees consolidees, et le plan reste dans ses bornes.
    const project = await newProject();
    const consolidated = [
      ...EXISTING,
      "Import d'un classeur a feuille unique : valeurs textuelles normalisees, " +
        "CI et application vides affiches « Non renseigne »",
      "Doublons d'incident rejetes occurrence par occurrence, sans rejeter le fichier",
    ];
    assert.equal(consolidated.length, PROJECT_PLAN_LIMITS.items);

    const provider = new FakeArchitectProvider([respond(planTurn(consolidated))]);

    const outcome = await send(project, provider);

    assert.ok(outcome.ok, "une section pleine reste proposable");
    const update = await lastUpdate(project);
    assert.notEqual(update, null, "la proposition est enregistree");
  });

  it("le refus survient au contrat, avant le budget de seize Kio", async () => {
    // Les deux verifications ne doivent pas se confondre : le tour 10 a echoue
    // sur le **nombre d'entrees**, pas sur la taille cumulee du brief et du
    // plan. Une section qui viole les deux doit rendre le code du contrat.
    const project = await newProject();
    const enormous = Array.from({ length: PROJECT_PLAN_LIMITS.items + 1 }, () =>
      "x".repeat(PROJECT_PLAN_LIMITS.item),
    );
    const provider = new FakeArchitectProvider([respond(planTurn(enormous))]);

    const outcome = await send(project, provider);

    assert.equal(outcome.ok, false);
    // `ARCHITECT_OUTPUT_INVALID`, et non `ARCHITECT_UPDATE_TOO_LARGE` : le
    // contrat par champ est verifie dans `readArchitectTurn`, le budget cumule
    // seulement apres, dans `checkProviderProjectUpdate`.
    assert.equal(
      "code" in outcome ? outcome.code : null,
      ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
    );
    const session = await getArchitectSession(db, project.sessionId);
    assert.equal(session?.generations[0]?.diagnostic?.field, "projectUpdate.plan.inScope");
  });

  it("le budget de seize Kio reste applique a ce qui passe le contrat", async () => {
    // Une section dans ses bornes de comptage peut encore depasser le budget
    // cumule. Les deux gardes restent distinctes, et toutes les deux actives.
    const project = await newProject();
    // Chaque champ dans sa borne, et pourtant hors budget cumule : trois listes
    // pleines d'entrees maximales plus deux textes longs depassent seize Kio.
    // C'est precisement pourquoi les deux gardes existent separement.
    const full = Array.from({ length: PROJECT_PLAN_LIMITS.items }, () =>
      "y".repeat(PROJECT_PLAN_LIMITS.item),
    );
    const provider = new FakeArchitectProvider([
      respond({
        ...fakeProjectTurn({}),
        projectUpdate: {
          reason: "Un plan volumineux mais formellement valide.",
          brief: { action: "UNCHANGED", value: null },
          plan: {
            action: "SET",
            value: {
              goal: "g".repeat(PROJECT_PLAN_LIMITS.goal),
              technicalDirection: "t".repeat(PROJECT_PLAN_LIMITS.technicalDirection),
              inScope: full,
              outOfScope: full,
              milestones: full,
            },
          },
        },
      }),
    ]);

    const outcome = await send(project, provider);

    assert.equal(outcome.ok, false);
    assert.equal(
      "code" in outcome ? outcome.code : null,
      ARCHITECT_ERROR.ARCHITECT_UPDATE_TOO_LARGE,
    );
    const session = await getArchitectSession(db, project.sessionId);
    assert.equal(
      session?.generations[0]?.diagnostic?.category,
      ARCHITECT_TURN_FAILURE.UPDATE_TOO_LARGE,
    );
  });
});
