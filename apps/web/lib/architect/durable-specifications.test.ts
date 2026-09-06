/**
 * HOTFIX-005 — la continuite d'une specification produit, de bout en bout.
 *
 * ## Ce que le second pilote reel a perdu
 *
 * TicketPulse a etabli, au fil d'une longue conversation Architecte, un contrat
 * d'import Excel complet : colonnes requises, lignes ignorees, normalisation,
 * semantique des doublons, semantique de mise a jour champ par champ.
 *
 * `architect/7` a eu **raison** de ne pas recopier ce detail dans le Living V1
 * Plan : ce n'est pas une capacite de V1, c'est une specification, et l'y mettre
 * aurait franchi les bornes du plan a la decision suivante.
 *
 * Mais il n'existait alors aucun endroit ou le poser. La memoire du projet etait
 * la bonne autorite — durable, bornee, et **deja** transmise a la planification —
 * et aucun chemin de code ne menait de la conversation jusqu'a elle. Le contrat
 * est reste dans le fil, hors de portee du planificateur, qui l'a dit lui-meme :
 *
 * ```text
 * « Le point restant incertain est le contrat Excel detaille : la liste complete
 *   des intitules et formats reellement observes n'apparait ni dans le brief ni
 *   dans le plan. »
 * ```
 *
 * Puis la tache 2 a renvoye aux « intitules exacts du contrat V1 » sans contenir
 * ce contrat, et a **affaibli** une regle en la resumant : « les numeros repetes
 * ne doivent pas creer deux incidents » autorise a en garder un, la ou la
 * decision reelle rejette toutes les occurrences.
 *
 * Ces tests fixent les deux moities du correctif : la regle survit a la
 * conversation, et la tache qui l'utilise la porte en toutes lettres.
 *
 * Base temporaire, faux fournisseur : aucun appel reseau, aucun quota consomme.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHITECT_PROJECT_UPDATE_STATUS,
  ARCHITECT_PROMPT_VERSION_V11,
  ARCHITECT_PROMPT_VERSION_V12,
  ARCHITECT_SESSION_KIND,
  ARCHITECT_TURN_SCHEMA_VERSION_V5,
  architectPromptVersion,
  architectTurnSchemaVersion,
  buildArchitectTurnSchema,
  renderArchitectPrompt,
  PROJECT_MEMORY_ACTION,
  PROJECT_MEMORY_CATEGORY,
  PROJECT_MEMORY_LIMITS,
  PROJECT_MEMORY_STATUS,
  PROJECT_PLAN_LIMITS,
  PROJECT_UPDATE_ACTION,
  readArchitectProjectUpdate,
  type ProjectMemoryProposal,
} from "@nox/shared";
import {
  createDatabaseClient,
  createProject,
  createProjectMemory,
  ensureProjectArchitectSession,
  getArchitectProjectUpdate,
  getArchitectSession,
  listActiveProjectMemories,
  listTaskObjectives,
  listTasksByProject,
  loadProjectStructuredState,
  loadReplanPlanningState,
  setProjectMemoryStatus,
  saveProjectV1Plan,
  toSqliteUrl,
  type DatabaseClient,
} from "@nox/database";

import {
  generateProjectBacklog,
  prepareProjectBacklog,
  type BacklogProjectInput,
} from "../backlog/service.ts";
import { projectPlanTools } from "../project-plan.ts";
import {
  applyProjectUpdate,
  checkProviderProjectUpdate,
  currentProjectMemoryRevision,
  loadTimelineProjectUpdates,
} from "./project-update.ts";
import {
  FakeArchitectProvider,
  fakeProjectTurn,
  fakeProviderSuccess,
} from "./provider.ts";
import {
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

// ---------------------------------------------------------------------------
// Le pilote, reproduit exactement
// ---------------------------------------------------------------------------

/**
 * Le Living V1 Plan de TicketPulse : quatre capacites, et rien de plus.
 *
 * C'est le point de depart du bug, et il est **correct**. Le plan doit rester
 * a ce niveau ; ces tests verifient qu'il n'a pas besoin d'en descendre.
 */
const TICKETPULSE_PLAN = {
  goal: "Ingerer un export d'incidents et le rendre exploitable.",
  technicalDirection: "Import synchrone d'un classeur Excel, stockage local, restitution web.",
  inScope: [
    "Import Excel controle avec validation structurelle",
    "Deduplication deterministe des incidents",
    "Analytique sur les incidents importes",
    "Exploration detaillee d'un incident",
  ],
  outOfScope: ["Connecteurs tiers", "Edition manuelle des incidents"],
  milestones: ["Le contrat d'import est fige", "La liste des incidents est utilisable"],
};

/** Les colonnes requises, telles que le pilote les a tranchees. */
const REQUIRED_COLUMNS = ["N° d'Incident", "Créé", "Site", "CI / Application"];

/** Les champs facultatifs retenus, tels que le pilote les a tranches. */
const OPTIONAL_FIELDS = [
  "Titre",
  "Description",
  "Résolution",
  "Priorité",
  "Résolu par (groupe)",
  "Cause réelle",
];

/**
 * Le contrat d'import durable, tel qu'il aurait du etre pose.
 *
 * Trois entrees plutot que dix-huit : les regles voisines se regroupent, et
 * c'est exactement ce que le prompt demande. Chacune se lit **sans** la
 * conversation qui l'a produite — c'est le seul critere qui compte.
 */
const IMPORT_CONTRACT: ProjectMemoryProposal[] = [
  {
    action: PROJECT_MEMORY_ACTION.CREATE,
    code: null,
    category: PROJECT_MEMORY_CATEGORY.DECISION,
    title: "Contrat d'import Excel : structure du classeur et colonnes requises",
    content: [
      "Le classeur porte exactement une feuille, quel que soit son nom.",
      `Les colonnes sont identifiees par intitule exact, jamais par position, et leur ordre est indifferent. Colonnes requises : ${REQUIRED_COLUMNS.join(", ")}.`,
      "La colonne CI / Application est requise mais sa cellule peut etre vide ; une valeur vide s'affiche « Non renseigné » dans l'analytique.",
      "Une ligne entierement vide est ignoree. Une ligne dont la premiere cellule commence par « Filtres appliqués : » est une metadonnee d'export et est ignoree.",
    ].join("\n"),
    rationale: "Fige au tour 9 de la conversation, apres examen d'un export reel.",
  },
  {
    action: PROJECT_MEMORY_ACTION.CREATE,
    code: null,
    category: PROJECT_MEMORY_CATEGORY.DECISION,
    title: "Contrat d'import Excel : normalisation et doublons",
    content: [
      "Les espaces de bord sont retires de toutes les valeurs textuelles ; les espaces internes sont preserves ; une valeur composee uniquement d'espaces devient vide.",
      "Si un meme numero d'incident apparait plusieurs fois dans un meme classeur, toutes ses occurrences sont rejetees — aucune n'est conservee, meme lorsque les lignes sont identiques.",
      "Les autres lignes valides du meme classeur restent importees : un doublon rejette un incident, jamais le fichier.",
    ].join("\n"),
    rationale: "Le rejet total evite d'avoir a choisir arbitrairement une occurrence.",
  },
  {
    action: PROJECT_MEMORY_ACTION.CREATE,
    code: null,
    category: PROJECT_MEMORY_CATEGORY.DECISION,
    title: "Contrat d'import Excel : semantique de mise a jour des incidents",
    content: [
      "Un incident inconnu est cree ; un incident connu dont les valeurs different est mis a jour ; un incident connu identique reste inchange.",
      "Le dernier export fait autorite pour les champs qu'il contient.",
      "Une colonne facultative absente du fichier ne modifie pas la valeur deja stockee. Une colonne facultative presente avec une cellule vide efface la valeur stockee.",
      `Champs facultatifs retenus en V1 : ${OPTIONAL_FIELDS.join(", ")}.`,
    ].join("\n"),
    rationale: null,
  },
];

/**
 * Les regles reellement tranchees par le pilote, une par ligne.
 *
 * Cette liste n'existe que pour montrer ce qui se serait passe si elles etaient
 * entrees dans le plan : dix-neuf lignes ajoutees a quatre deja presentes
 * franchissent la borne de vingt. C'est la demonstration que le detail n'avait
 * pas sa place la — et non une proposition de l'y mettre.
 */
const DETAILED_RULES = [
  "Le classeur porte exactement une feuille",
  "Le nom de la feuille est indifferent",
  "Les colonnes sont identifiees par intitule exact",
  "L'ordre des colonnes est indifferent",
  "Les quatre colonnes requises sont presentes",
  "La cellule CI / Application peut etre vide",
  "Une CI / Application vide s'affiche « Non renseigné »",
  "Une ligne entierement vide est ignoree",
  "Une ligne « Filtres appliqués : » est ignoree",
  "Les espaces de bord sont retires",
  "Les espaces internes sont preserves",
  "Une valeur d'espaces seuls devient vide",
  "Un numero d'incident duplique rejette toutes ses occurrences",
  "Les autres lignes valides restent importees",
  "Un incident inconnu est cree",
  "Un incident connu modifie est mis a jour",
  "Un incident connu identique reste inchange",
  "Une colonne facultative absente preserve la valeur stockee",
  "Une colonne facultative vide efface la valeur stockee",
];

/** Une regle durable qui n'a rien a voir avec l'import. */
const UNRELATED_RULE: ProjectMemoryProposal = {
  action: PROJECT_MEMORY_ACTION.CREATE,
  code: null,
  category: PROJECT_MEMORY_CATEGORY.CONVENTION,
  title: "Palette de l'interface",
  content: "Les graphiques utilisent la palette sobre du produit, sans couleur saturee.",
  rationale: null,
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

async function newProject(): Promise<{ id: string; repositoryPath: string }> {
  counter += 1;
  const project = await createProject(db, {
    name: `TicketPulse ${String(counter)}`,
    description: null,
    repositoryPath: path.join(workspace, `depot-${String(counter)}`),
  });
  await saveProjectV1Plan(db, {
    projectId: project.id,
    values: TICKETPULSE_PLAN,
    tools: projectPlanTools(project.repositoryPath),
  });
  return { id: project.id, repositoryPath: project.repositoryPath };
}

/** Pose le contrat d'import en memoire, comme une application le ferait. */
async function seedContract(
  projectId: string,
  entries: readonly ProjectMemoryProposal[] = IMPORT_CONTRACT,
): Promise<void> {
  for (const entry of entries) {
    const written = await createProjectMemory(db, {
      projectId,
      values: {
        category: entry.category,
        title: entry.title,
        content: entry.content,
        rationale: entry.rationale,
        status: PROJECT_MEMORY_STATUS.ACTIVE,
      },
      sanitize: (value) => value,
    });
    assert.ok(written.ok, `entree posee : ${entry.title}`);
  }
}

before(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "nox-durable-spec-"));
  const databaseUrl = toSqliteUrl(path.join(workspace, "test.db"));
  await applyMigrations(path.join(workspace, "test.db"));
  db = createDatabaseClient(databaseUrl);
});

after(async () => {
  await db.$disconnect();
  await rm(workspace, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe("HOTFIX-005 — le plan reste concis", () => {
  it("le Living V1 Plan de TicketPulse tient en quatre lignes de perimetre", () => {
    // Requirement 1 : il ne faut **pas** une puce par regle detaillee. Le plan
    // du pilote est correct tel quel, et le correctif ne le fait pas grossir.
    assert.equal(TICKETPULSE_PLAN.inScope.length, 4);
    assert.equal(TICKETPULSE_PLAN.inScope.length < PROJECT_PLAN_LIMITS.items, true);
  });

  it("les dix-huit regles d'import n'apparaissent nulle part dans le plan", () => {
    const planText = JSON.stringify(TICKETPULSE_PLAN);

    for (const detail of [
      "Filtres appliqués",
      "Non renseigné",
      "N° d'Incident",
      "Cause réelle",
      "espaces de bord",
    ]) {
      assert.equal(planText.includes(detail), false, detail);
    }
  });

  it("la borne du plan est inchangee", () => {
    // Requirement B : les vingt entrees restent vingt. Le correctif deplace le
    // detail, il n'agrandit pas le plan pour l'accueillir.
    assert.equal(PROJECT_PLAN_LIMITS.items, 20);
  });

  it("les mettre dans le plan aurait franchi la borne", () => {
    // La preuve que le detail n'y avait pas sa place : une puce par regle, sur
    // un plan deja fourni, depasse.
    const detailed = [...TICKETPULSE_PLAN.inScope, ...DETAILED_RULES];

    assert.equal(DETAILED_RULES.length, 19, "les regles reellement tranchees par le pilote");
    assert.equal(detailed.length > PROJECT_PLAN_LIMITS.items, true);
  });
});

describe("HOTFIX-005 — la regle survit a la conversation", () => {
  it("une regle posee en memoire se relit sans le transcript", async () => {
    // Requirement 1 de la liste des tests, et le coeur du correctif : la
    // conversation n'est plus le seul endroit ou la regle existe.
    const project = await newProject();
    await seedContract(project.id);

    const memories = await listActiveProjectMemories(db, project.id);

    assert.equal(memories.length, 3);
    const joined = memories.map((memory) => memory.content).join("\n");
    assert.match(joined, /toutes ses occurrences sont rejetees/u);
  });

  it("la regle des doublons ne peut pas se degrader en « pas de doublon »", async () => {
    // Requirement 5, et le defaut precis qu'a produit BACKLOG-003. « Les
    // numeros repetes ne doivent pas creer deux incidents » autorise a en
    // garder un ; la decision reelle n'en garde aucun.
    const project = await newProject();
    await seedContract(project.id);

    const memories = await listActiveProjectMemories(db, project.id);
    const rule = memories.find((memory) => memory.content.includes("numero d'incident"));

    assert.notEqual(rule, undefined);
    assert.match(rule?.content ?? "", /toutes ses occurrences sont rejetees/u);
    assert.match(rule?.content ?? "", /aucune n'est conservee/u);
    // La formulation faible est absente, et doit le rester.
    assert.equal((rule?.content ?? "").includes("ne doivent pas creer deux"), false);
  });

  it("la regle du CI / Application vide reste exacte", async () => {
    // Requirement 6 : requise, mais vide autorisee, et affichee « Non renseigné ».
    // Trois faits distincts qu'un resume aurait fondus en un.
    const project = await newProject();
    await seedContract(project.id);

    const joined = (await listActiveProjectMemories(db, project.id))
      .map((memory) => memory.content)
      .join("\n");

    assert.match(joined, /CI \/ Application est requise mais sa cellule peut etre vide/u);
    assert.match(joined, /Non renseigné/u);
  });

  it("la semantique colonne absente / cellule vide reste exacte", async () => {
    // Requirement 7. Les deux moities sont opposees, et perdre l'une inverse le
    // comportement sur la moitie des imports.
    const project = await newProject();
    await seedContract(project.id);

    const joined = (await listActiveProjectMemories(db, project.id))
      .map((memory) => memory.content)
      .join("\n");

    assert.match(joined, /absente du fichier ne modifie pas la valeur deja stockee/u);
    assert.match(joined, /presente avec une cellule vide efface la valeur stockee/u);
  });

  it("un projet sans aucune regle durable fonctionne exactement comme avant", async () => {
    // Requirement 15 : les projets anterieurs a HOTFIX-005 n'en ont aucune, et
    // « aucune » est un etat parfaitement valable.
    const project = await newProject();

    assert.deepEqual(await listActiveProjectMemories(db, project.id), []);
    const state = await loadProjectStructuredState(
      db,
      project.id,
      projectPlanTools(project.repositoryPath),
    );
    assert.equal(state.plan.present, true);
  });
});

describe("HOTFIX-005 — le contrat de tour porte les regles durables", () => {
  function proposal(memories: readonly ProjectMemoryProposal[]): Record<string, unknown> {
    return {
      reason: "Le contrat d'import est fige.",
      brief: { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null },
      plan: { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null },
      memories: [...memories],
    };
  }

  it("accepte une mise a jour qui ne pose que des regles durables", () => {
    // Le cas central : le contrat d'import de TicketPulse n'avait aucune raison
    // de modifier une capacite de V1 deja ecrite. Avant HOTFIX-005 une telle
    // proposition etait refusee comme « ne changeant rien ».
    const read = readArchitectProjectUpdate(proposal(IMPORT_CONTRACT));

    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal(read.proposal.memories.length, 3);
      assert.equal(read.proposal.brief.action, PROJECT_UPDATE_ACTION.UNCHANGED);
      assert.equal(read.proposal.plan.action, PROJECT_UPDATE_ACTION.UNCHANGED);
    }
  });

  it("refuse une mise a jour qui ne change vraiment rien", () => {
    const read = readArchitectProjectUpdate(proposal([]));

    assert.equal(read.ok, false);
  });

  it("borne le nombre de regles par tour, sans rien tronquer", () => {
    // Requirements 12 et 13. Ecarter silencieusement la neuvieme regle d'un
    // contrat produirait un contrat faux, et personne ne saurait laquelle
    // manque.
    const many = Array.from({ length: PROJECT_MEMORY_LIMITS.proposals + 1 }, (_, index) => ({
      ...IMPORT_CONTRACT[0]!,
      title: `Regle numero ${String(index + 1)}`,
    }));

    const read = readArchitectProjectUpdate(proposal(many));

    assert.equal(read.ok, false);
    if (!read.ok) {
      assert.equal(read.refusal.field, "memories");
      assert.match(read.refusal.message, /Rien n'a ete enregistre/u);
    }
  });

  it("accepte exactement la borne", () => {
    const exact = Array.from({ length: PROJECT_MEMORY_LIMITS.proposals }, (_, index) => ({
      ...IMPORT_CONTRACT[0]!,
      title: `Regle numero ${String(index + 1)}`,
    }));

    assert.equal(readArchitectProjectUpdate(proposal(exact)).ok, true);
  });

  it("refuse un contenu trop long plutot que de le couper", () => {
    const oversized: ProjectMemoryProposal = {
      ...IMPORT_CONTRACT[0]!,
      content: "x".repeat(PROJECT_MEMORY_LIMITS.content + 1),
    };

    const read = readArchitectProjectUpdate(proposal([oversized]));

    assert.equal(read.ok, false);
    if (!read.ok) {
      assert.match(read.refusal.field, /^memories\.0\./u);
      assert.match(read.refusal.message, /too_long/u);
    }
  });

  it("refuse un UPDATE qui ne designe aucune entree", () => {
    const read = readArchitectProjectUpdate(
      proposal([{ ...IMPORT_CONTRACT[0]!, action: PROJECT_MEMORY_ACTION.UPDATE, code: null }]),
    );

    assert.equal(read.ok, false);
    if (!read.ok) {
      assert.equal(read.refusal.field, "memories.0.code");
    }
  });

  it("refuse un CREATE qui designe une entree existante", () => {
    // Une contradiction : l'accepter ferait ecrire ailleurs que la ou le modele
    // croyait ecrire.
    const read = readArchitectProjectUpdate(
      proposal([{ ...IMPORT_CONTRACT[0]!, action: PROJECT_MEMORY_ACTION.CREATE, code: "MEM-004" }]),
    );

    assert.equal(read.ok, false);
    if (!read.ok) {
      assert.equal(read.refusal.field, "memories.0.code");
    }
  });

  it("refuse deux operations sur la meme entree dans un seul tour", () => {
    const twice: ProjectMemoryProposal = {
      ...IMPORT_CONTRACT[0]!,
      action: PROJECT_MEMORY_ACTION.UPDATE,
      code: "MEM-002",
    };

    const read = readArchitectProjectUpdate(proposal([twice, { ...twice, title: "Autre titre" }]));

    assert.equal(read.ok, false);
    if (!read.ok) {
      assert.equal(read.refusal.field, "memories.1");
    }
  });

  it("une proposition sans le champ reste lisible", () => {
    // Requirement 15 et 16 : les propositions enregistrees en version 3, avant
    // HOTFIX-005, n'ont pas ce champ. L'absence vaut liste vide, jamais une
    // panne — l'historique ne se reecrit pas.
    const read = readArchitectProjectUpdate({
      reason: "Une proposition d'avant HOTFIX-005.",
      brief: { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null },
      plan: {
        action: PROJECT_UPDATE_ACTION.SET,
        value: TICKETPULSE_PLAN,
      },
    });

    assert.equal(read.ok, true);
    if (read.ok) {
      assert.deepEqual(read.proposal.memories, []);
    }
  });
});

describe("HOTFIX-005 — le contexte reste borne", () => {
  it("le contrat d'import tient largement dans le budget de la memoire", async () => {
    // Requirement 6 des objectifs : pas de transcript illimite, et pas de champ
    // texte non borne. Le contrat reel du pilote occupe une fraction du budget.
    const project = await newProject();
    await seedContract(project.id);

    const memories = await listActiveProjectMemories(db, project.id);
    const used = memories.reduce(
      (total, memory) =>
        total + memory.title.length + memory.content.length + (memory.rationale?.length ?? 0),
      0,
    );

    assert.equal(used < PROJECT_MEMORY_LIMITS.activeChars, true);
    assert.equal(
      used < PROJECT_MEMORY_LIMITS.activeChars / 4,
      true,
      "le contrat reel tient confortablement",
    );
  });

  it("chaque entree reste sous sa propre borne", async () => {
    for (const entry of IMPORT_CONTRACT) {
      assert.equal(entry.title.length <= PROJECT_MEMORY_LIMITS.title, true, entry.title);
      assert.equal(entry.content.length <= PROJECT_MEMORY_LIMITS.content, true, entry.title);
    }
  });

  it("une regle sans rapport reste une entree distincte, archivable", async () => {
    // Requirement 4 : le mecanisme de pertinence existant est le statut
    // ACTIVE/ARCHIVED, controle par l'utilisateur. Une regle archivee ne part
    // pas, et c'est la seule selection que NOX sait faire honnetement.
    const project = await newProject();
    await seedContract(project.id, [...IMPORT_CONTRACT, UNRELATED_RULE]);

    const memories = await listActiveProjectMemories(db, project.id);

    assert.equal(memories.length, 4);
    assert.equal(
      memories.some((memory) => memory.title === UNRELATED_RULE.title),
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Le pipeline reel : conversation, proposition, application, planification
// ---------------------------------------------------------------------------

type Pilot = { id: string; repositoryPath: string; sessionId: string };

const ENVIRONMENT: Record<string, string | undefined> = {
  NOX_OPENAI_API_KEY: "cle-architecte-de-test-9876543210",
  NOX_RUNNER_TOKEN: "jeton-runner-de-test-0123456789",
};

/** Ports simules : deux documents, sans runner ni disque. */
function ports(): ArchitectRepositoryPorts {
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
        ],
      }),
    readDocument: (_repository, documentPath) =>
      Promise.resolve({
        ok: true,
        value: { path: documentPath, content: `# ${documentPath}`, revision: "a".repeat(64) },
      }),
  };
}

/** Un projet TicketPulse avec son plan et sa conversation principale. */
async function newTicketPulse(): Promise<Pilot> {
  const project = await newProject();
  const session = await ensureProjectArchitectSession(db, project.id);
  assert.ok(session !== null);
  return { ...project, sessionId: session.id };
}

/** Les entrees de memoire actives, dans la forme attendue par la preparation. */
async function memoriesOf(projectId: string) {
  return listActiveProjectMemories(db, projectId);
}

/** Prepare un tour : c'est `Review context`, et il n'appelle personne. */
async function review(project: Pilot, message: string) {
  const session = await getArchitectSession(db, project.sessionId);
  assert.ok(session !== null);
  return reviewArchitectTurn(db, {
    session,
    projectName: "TicketPulse",
    repositoryPath: project.repositoryPath,
    message,
    tasks: [],
    memories: await memoriesOf(project.id),
    structuredState: await loadProjectStructuredState(
      db,
      project.id,
      projectPlanTools(project.repositoryPath),
    ),
    projectId: project.id,
    planTools: projectPlanTools(project.repositoryPath),
    planningState: await loadReplanPlanningState(db, project.id),
    model: "modele-de-test",
    environment: ENVIRONMENT,
    ports: ports(),
  });
}

/** Envoie le tour prepare : c'est `Send to Architect`. */
async function send(project: Pilot, provider: FakeArchitectProvider) {
  const session = await getArchitectSession(db, project.sessionId);
  assert.ok(session !== null);
  return sendArchitectTurn(db, {
    session,
    projectName: "TicketPulse",
    repositoryPath: project.repositoryPath,
    tasks: [],
    memories: await memoriesOf(project.id),
    structuredState: await loadProjectStructuredState(
      db,
      project.id,
      projectPlanTools(project.repositoryPath),
    ),
    projectId: project.id,
    planTools: projectPlanTools(project.repositoryPath),
    planningState: await loadReplanPlanningState(db, project.id),
    model: "modele-de-test",
    provider,
    environment: ENVIRONMENT,
    ports: ports(),
  });
}

/** La derniere proposition de mise a jour du projet. */
async function lastProjectUpdate(projectId: string) {
  const rows = await db.architectProjectUpdate.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  const row = rows[0];
  return row === undefined ? null : getArchitectProjectUpdate(db, row.id);
}

/** Le texte exact qui partirait vers le fournisseur pour un tour. */
async function architectPromptFor(project: Pilot): Promise<string> {
  const prepared = await review(project, "Un message quelconque.");
  assert.ok(prepared.ok, "le contexte est preparable");
  return `${prepared.turn.prepared.prompt.instructions}\n${prepared.turn.prepared.prompt.input}`;
}

/** L'entree du service de planification, telle que la Server Action l'assemble. */
async function backlogInput(project: Pilot): Promise<BacklogProjectInput> {
  const [tasks, objectives, memories, structuredState] = await Promise.all([
    listTasksByProject(db, project.id),
    listTaskObjectives(db, project.id),
    memoriesOf(project.id),
    loadProjectStructuredState(db, project.id, projectPlanTools(project.repositoryPath)),
  ]);

  return {
    projectId: project.id,
    projectName: "TicketPulse",
    repositoryPath: project.repositoryPath,
    tasks,
    objectives,
    memories,
    structuredState,
    model: "modele-de-test",
    environment: ENVIRONMENT,
    ports: ports(),
  };
}

/** Le texte exact qui partirait vers le fournisseur pour une planification. */
async function backlogPromptFor(project: Pilot): Promise<string> {
  const prepared = await prepareProjectBacklog(await backlogInput(project));
  assert.ok(prepared.ok, "la planification est preparable");
  return `${prepared.prepared.prompt.instructions}\n${prepared.prepared.prompt.input}`;
}

/** Pose le contrat par le chemin reel : un tour, une proposition, une application. */
async function applyContract(): Promise<Pilot> {
  const project = await newTicketPulse();
  const provider = new FakeArchitectProvider([
    fakeProviderSuccess(
      fakeProjectTurn({
        projectUpdate: { reason: "Le contrat d'import est fige.", memories: IMPORT_CONTRACT },
      }),
    ),
  ]);

  await review(project, "Fige le contrat d'import Excel.");
  assert.ok((await send(project, provider)).ok);

  const update = await lastProjectUpdate(project.id);
  assert.ok(update !== null);
  const applied = await applyProjectUpdate(
    db,
    project,
    update.id,
    { brief: null, plan: null },
    update.proposed.memories,
    ENVIRONMENT,
  );
  assert.ok(applied.ok, "le contrat est applique");

  return project;
}

// ---------------------------------------------------------------------------
// HOTFIX-005 — de la conversation jusqu'a la planification
// ---------------------------------------------------------------------------

/**
 * Le chemin complet, celui qui n'existait pas.
 *
 * ```text
 * conversation → proposition → revue humaine → memoire → backlog / replan
 * ```
 *
 * Chaque fleche est verifiee ici. Avant HOTFIX-005 la deuxieme n'existait pas,
 * et tout ce qui suivait se faisait sans le contrat.
 */
describe("HOTFIX-005 — de la conversation jusqu'a la planification", () => {
  it("un tour propose le contrat, et rien n'est ecrit avant l'application", async () => {
    // Requirement 11 : une proposition non appliquee ne change rien. C'est la
    // regle de la memoire depuis TASK-018, et proposer ne l'entame pas.
    const project = await newTicketPulse();
    const provider = new FakeArchitectProvider([
      fakeProviderSuccess(
        fakeProjectTurn({
          message: "Je fige le contrat d'import.",
          projectUpdate: { reason: "Le contrat d'import est fige.", memories: IMPORT_CONTRACT },
        }),
      ),
    ]);

    await review(project, "Fige le contrat d'import Excel.");
    const outcome = await send(project, provider);

    assert.ok(outcome.ok);
    // La proposition existe...
    const update = await lastProjectUpdate(project.id);
    assert.notEqual(update, null);
    assert.equal(update?.proposed.memories.length, 3);
    // ...et la memoire est toujours vide.
    assert.deepEqual(await listActiveProjectMemories(db, project.id), []);
  });

  it("l'application ecrit les regles durables et le plan dans une seule transaction", async () => {
    // Requirement 19 : l'atomicite. Un plan qui annonce un import controle et
    // une memoire qui ne dit pas ce que « controle » veut dire serait
    // exactement le trou que ce correctif comble.
    const project = await newTicketPulse();
    const provider = new FakeArchitectProvider([
      fakeProviderSuccess(
        fakeProjectTurn({
          projectUpdate: {
            reason: "Le contrat d'import est fige.",
            plan: TICKETPULSE_PLAN,
            memories: IMPORT_CONTRACT,
          },
        }),
      ),
    ]);

    await review(project, "Fige le contrat.");
    assert.ok((await send(project, provider)).ok);

    const update = await lastProjectUpdate(project.id);
    assert.ok(update !== null);

    const applied = await applyProjectUpdate(
      db,
      project,
      update.id,
      { brief: null, plan: TICKETPULSE_PLAN },
      update.proposed.memories,
      ENVIRONMENT,
    );

    assert.ok(applied.ok, "l'application aboutit");

    const memories = await listActiveProjectMemories(db, project.id);
    assert.equal(memories.length, 3, "les trois regles sont en memoire");
    const state = await loadProjectStructuredState(db, project.id, projectPlanTools(project.repositoryPath));
    assert.equal(state.plan.present, true, "et le plan est ecrit");
  });

  it("les regles appliquees naissent ACTIVE, donc atteignent l'Architecte", async () => {
    // Une entree archivee serait capturee et inutile : seules les entrees
    // actives partent, et c'est pour y arriver qu'elle a ete posee.
    const project = await applyContract();

    const memories = await listActiveProjectMemories(db, project.id);

    assert.equal(memories.length, 3);
    for (const memory of memories) {
      assert.equal(memory.status, PROJECT_MEMORY_STATUS.ACTIVE);
    }
  });

  it("la planification du backlog recoit le contrat, mot pour mot", async () => {
    // Requirement 3, et la reponse directe au « point restant incertain » de
    // BACKLOG-003.
    const project = await applyContract();

    const prompt = await backlogPromptFor(project);

    assert.match(prompt, /toutes ses occurrences sont rejetees/u);
    assert.match(prompt, /N° d'Incident/u);
    assert.match(prompt, /Non renseigné/u);
    assert.match(prompt, /Filtres appliqués/u);
    assert.match(prompt, /Cause réelle/u);
    assert.match(prompt, /presente avec une cellule vide efface la valeur stockee/u);
  });

  it("la planification ne recoit toujours aucun transcript", async () => {
    // Requirement 14, et l'invariant de TASK-022 : ce qui a change est que la
    // regle est **ailleurs**, pas que la conversation soit envoyee.
    const project = await applyContract();

    const prompt = await backlogPromptFor(project);

    assert.equal(prompt.includes("<conversation>"), false);
    assert.equal(prompt.includes("Fige le contrat d'import Excel."), false);
  });

  it("une regle non appliquee n'atteint jamais la planification", async () => {
    // Requirement 11 : proposer n'est pas ecrire, et la planification consomme
    // ce qui a ete valide — jamais ce qui a ete suggere.
    const project = await newTicketPulse();
    const provider = new FakeArchitectProvider([
      fakeProviderSuccess(
        fakeProjectTurn({
          projectUpdate: { reason: "Proposition non appliquee.", memories: IMPORT_CONTRACT },
        }),
      ),
    ]);
    await review(project, "Fige le contrat.");
    assert.ok((await send(project, provider)).ok);

    const prompt = await backlogPromptFor(project);

    assert.equal(prompt.includes("toutes ses occurrences sont rejetees"), false);
  });

  it("la replanification recoit exactement le meme contrat", async () => {
    // Requirement 9, et l'objectif G : sans cela le bug se deplacerait de la
    // planification initiale vers la replanification.
    const project = await applyContract();

    const prompt = await architectPromptFor(project);

    assert.match(prompt, /toutes ses occurrences sont rejetees/u);
    assert.match(prompt, /absente du fichier ne modifie pas la valeur deja stockee/u);
  });

  it("une regle appliquee change l'empreinte de contexte", async () => {
    // Requirement 10 : la memoire entre dans l'empreinte depuis TASK-018, donc
    // une regle posee rend perimee toute proposition anterieure. Rien a ajouter
    // — ce test constate que la garantie couvre bien le nouveau chemin.
    const project = await newTicketPulse();
    const before = await currentProjectMemoryRevision(db, project.id, project.repositoryPath, ENVIRONMENT);

    await seedContract(project.id);
    const after = await currentProjectMemoryRevision(db, project.id, project.repositoryPath, ENVIRONMENT);

    assert.notEqual(before, after);
  });

  it("une proposition batie sur une memoire depuis reecrite est refusee", async () => {
    // Requirement 20 : la peremption couvre le troisieme axe. Fusionner deux
    // redactions d'une meme regle produirait un contrat que ni l'un ni l'autre
    // n'a valide.
    const project = await newTicketPulse();
    const provider = new FakeArchitectProvider([
      fakeProviderSuccess(
        fakeProjectTurn({
          projectUpdate: { reason: "Le contrat d'import est fige.", memories: IMPORT_CONTRACT },
        }),
      ),
    ]);
    await review(project, "Fige le contrat.");
    assert.ok((await send(project, provider)).ok);

    // L'utilisateur ecrit une entree a la main entre la proposition et le clic.
    await seedContract(project.id, [UNRELATED_RULE]);

    const update = await lastProjectUpdate(project.id);
    assert.ok(update !== null);
    const applied = await applyProjectUpdate(
      db,
      project,
      update.id,
      { brief: null, plan: null },
      update.proposed.memories,
      ENVIRONMENT,
    );

    assert.equal(applied.ok, false);
    assert.equal(!applied.ok && applied.reason, "stale");
    // Rien n'a ete ecrit : la memoire ne porte que l'entree manuelle.
    assert.equal((await listActiveProjectMemories(db, project.id)).length, 1);
  });

  it("un UPDATE remplace l'entree visee plutot que d'en creer une seconde", async () => {
    // Sans cela, la premiere refonte du contrat laisserait deux regles
    // contradictoires en memoire, et la planification recevrait les deux.
    const project = await applyContract();
    const before = await listActiveProjectMemories(db, project.id);
    const target = before[1];
    assert.ok(target !== undefined);

    const revised: ProjectMemoryProposal = {
      action: PROJECT_MEMORY_ACTION.UPDATE,
      code: target.code,
      category: PROJECT_MEMORY_CATEGORY.DECISION,
      title: target.title,
      content:
        "Si un meme numero d'incident apparait plusieurs fois dans un meme classeur, toutes ses " +
        "occurrences sont rejetees. Le rejet est trace dans le rapport d'import.",
      rationale: null,
    };

    const provider = new FakeArchitectProvider([
      fakeProviderSuccess(
        fakeProjectTurn({
          projectUpdate: { reason: "Le rejet est desormais trace.", memories: [revised] },
        }),
      ),
    ]);
    await review(project, "Trace les rejets.");
    assert.ok((await send(project, provider)).ok);

    const update = await lastProjectUpdate(project.id);
    assert.ok(update !== null);
    assert.ok(
      (
        await applyProjectUpdate(
          db,
          project,
          update.id,
          { brief: null, plan: null },
          update.proposed.memories,
          ENVIRONMENT,
        )
      ).ok,
    );

    const after = await listActiveProjectMemories(db, project.id);
    assert.equal(after.length, before.length, "aucune entree de plus");
    const rewritten = after.find((memory) => memory.code === target.code);
    assert.match(rewritten?.content ?? "", /trace dans le rapport d'import/u);
    assert.match(rewritten?.content ?? "", /toutes ses occurrences sont rejetees/u);
  });

  it("un UPDATE qui vise une entree inexistante refuse tout", async () => {
    const project = await applyContract();
    const before = await listActiveProjectMemories(db, project.id);

    const provider = new FakeArchitectProvider([
      fakeProviderSuccess(
        fakeProjectTurn({
          projectUpdate: {
            reason: "Une entree qui n'existe pas.",
            memories: [
              {
                action: PROJECT_MEMORY_ACTION.UPDATE,
                code: "MEM-900",
                category: PROJECT_MEMORY_CATEGORY.DECISION,
                title: "Une regle sur une entree absente",
                content: "Un contenu quelconque.",
                rationale: null,
              },
            ],
          },
        }),
      ),
    ]);
    await review(project, "Modifie une entree absente.");
    assert.ok((await send(project, provider)).ok);

    const update = await lastProjectUpdate(project.id);
    assert.ok(update !== null);
    const applied = await applyProjectUpdate(
      db,
      project,
      update.id,
      { brief: null, plan: null },
      update.proposed.memories,
      ENVIRONMENT,
    );

    assert.equal(applied.ok, false);
    assert.equal((await listActiveProjectMemories(db, project.id)).length, before.length);
  });

  it("la planification reste stricte sur tout le reste", async () => {
    // Requirement 17 : le contrat de backlog n'a pas ete assoupli pour laisser
    // passer plus de detail. Une proposition invalide reste refusee.
    const project = await applyContract();
    const provider = new FakeArchitectProvider([
      fakeProviderSuccess({ schemaVersion: 3, message: "Voici.", tasks: [] }),
    ]);

    const generated = await generateProjectBacklog(db, {
      ...(await backlogInput(project)),
      provider,
    });

    assert.equal(generated.ok, false);
  });

  it("aucune cle, aucun chemin absolu, aucun secret n'entre dans une regle durable", async () => {
    // Requirement 18. Le nettoyeur de l'Architecte s'applique au texte transmis,
    // exactement comme pour toute autre entree de memoire : le nouveau chemin
    // n'ouvre aucune surface.
    const project = await newTicketPulse();
    await seedContract(project.id, [
      {
        action: PROJECT_MEMORY_ACTION.CREATE,
        code: null,
        category: PROJECT_MEMORY_CATEGORY.KNOWLEDGE,
        title: "Une entree qui cite des choses sensibles",
        content: `La cle est ${ENVIRONMENT["NOX_OPENAI_API_KEY"] ?? ""} et le depot est ${project.repositoryPath}.`,
        rationale: null,
      },
    ]);

    const prompt = await architectPromptFor(project);

    assert.equal(prompt.includes(ENVIRONMENT["NOX_OPENAI_API_KEY"] ?? "?"), false);
    assert.equal(prompt.includes(project.repositoryPath), false);
    assert.equal(prompt.includes("NOX_OPENAI_API_KEY"), false);
  });
});

describe("HOTFIX-005 — une tache generee se suffit a elle-meme", () => {
  it("le planificateur recoit l'interdiction d'ecrire une exigence par renvoi", async () => {
    // Requirement 8, et le second defaut de BACKLOG-003 : la tache 2 renvoyait
    // aux « intitules exacts du contrat V1 » sans contenir ce contrat. Une
    // formule pareille a l'air precise et ne verifie rien.
    const project = await applyContract();

    const prompt = await backlogPromptFor(project);

    assert.match(prompt, /Une tache se suffit a elle-meme/u);
    assert.match(prompt, /n'ecris jamais une exigence par renvoi/iu);
    assert.match(prompt, /contrat d'import V1/u);
  });

  it("il lui est dit que l'implementeur n'aura ni la conversation, ni la memoire", async () => {
    // C'est la raison, et elle doit etre dite : sans elle, la consigne
    // ressemble a une preference de style.
    const project = await applyContract();

    const prompt = await backlogPromptFor(project);

    assert.match(prompt, /n'aura pas la conversation sous les yeux/u);
    assert.match(prompt, /ni le brief, ni le plan, ni la memoire/u);
  });

  it("il lui est demande de recopier la regle exacte, jamais son resume", async () => {
    // Requirement 5 vu depuis le prompt : c'est la consigne qui empeche
    // « toutes les occurrences sont rejetees » de devenir « pas de doublon ».
    const project = await applyContract();

    const prompt = await backlogPromptFor(project);

    assert.match(prompt, /Recopie la regle exacte, jamais son resume/u);
    assert.match(prompt, /Un resume affaiblit/u);
    // La formulation faible exacte que BACKLOG-003 avait produite est citee
    // dans le prompt comme contre-exemple.
    assert.match(prompt, /les doublons ne creent pas deux incidents/u);
  });

  it("il lui est demande de ne recopier que ce dont la tache a besoin", async () => {
    // Requirement D : ne pas injecter aveuglement toute la memoire dans chaque
    // tache. La borne de pertinence est dite au fournisseur, qui est le seul a
    // savoir ce que chaque tache demande.
    const project = await applyContract();

    const prompt = await backlogPromptFor(project);

    assert.match(prompt, /Seulement ce dont \*\*cette/u);
    assert.match(prompt, /Une regle d'import n'a rien a faire dans une tache/u);
  });

  it("une regle manquante se signale, elle ne s'invente pas", async () => {
    // Ce que BACKLOG-003 avait fait a moitie : il **avait** signale le manque,
    // puis avait quand meme ecrit un renvoi. Les deux consignes sont desormais
    // explicites, et la seconde interdit le renvoi.
    const project = await applyContract();

    const prompt = await backlogPromptFor(project);

    assert.match(prompt, /ne l'invente pas et ne renvoie pas a un contrat absent/u);
  });

  it("la memoire est presentee comme la source des regles exactes a recopier", async () => {
    const project = await applyContract();

    const prompt = await backlogPromptFor(project);

    assert.match(prompt, /recopie dans tes taches celles dont l'implementeur aura besoin/u);
  });
});

describe("HOTFIX-005 — la pertinence est celle que NOX sait etablir", () => {
  it("une regle archivee n'atteint ni la conversation, ni la planification", async () => {
    // Requirement 4. Le mecanisme de selection existe deja et appartient a
    // l'utilisateur : `ACTIVE` part, `ARCHIVED` reste. NOX n'invente pas une
    // pertinence semantique qu'il ne saurait pas justifier.
    const project = await newTicketPulse();
    await seedContract(project.id, [UNRELATED_RULE]);

    const before = await backlogPromptFor(project);
    assert.match(before, /palette sobre/u);

    const entries = await listActiveProjectMemories(db, project.id);
    const target = entries[0];
    assert.ok(target !== undefined);
    await setProjectMemoryStatus(db, {
      memoryId: target.id,
      status: PROJECT_MEMORY_STATUS.ARCHIVED,
      sanitize: (value) => value,
    });

    const after = await backlogPromptFor(project);
    assert.equal(after.includes("palette sobre"), false);
    assert.equal((await architectPromptFor(project)).includes("palette sobre"), false);
  });

  it("aucune selection automatique ne retire une regle active", async () => {
    // Toutes les entrees actives partent, et c'est un invariant de TASK-018 :
    // une selection silencieuse ferait mentir l'interface, qui annonce
    // « active » comme « envoyee a l'Architecte ».
    const project = await newTicketPulse();
    await seedContract(project.id, [...IMPORT_CONTRACT, UNRELATED_RULE]);

    const prompt = await backlogPromptFor(project);

    assert.match(prompt, /palette sobre/u);
    assert.match(prompt, /toutes ses occurrences sont rejetees/u);
  });
});

describe("HOTFIX-005 — la planification consomme, elle ne redefinit pas", () => {
  it("generer un backlog n'ecrit aucune regle durable", async () => {
    // Requirement F, et l'invariant de TASK-022. La planification lit la
    // memoire ; elle n'y touche pas. Sans ce test, le nouveau chemin
    // d'ecriture pourrait un jour etre branche la sans que rien ne le signale.
    const project = await applyContract();
    const before = await listActiveProjectMemories(db, project.id);

    const provider = new FakeArchitectProvider([
      fakeProviderSuccess({ schemaVersion: 3, message: "Voici.", tasks: [] }),
    ]);
    await generateProjectBacklog(db, { ...(await backlogInput(project)), provider });

    const after = await listActiveProjectMemories(db, project.id);
    assert.deepEqual(
      after.map((memory) => memory.content),
      before.map((memory) => memory.content),
    );
  });

  it("le service de planification n'importe aucun ecrivain de memoire", () => {
    // Verifie sur la **source** du module, comme la review depuis TASK-016 :
    // une garantie qui vit dans le code plutot que dans la discipline.
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "backlog", "service.ts"),
      "utf8",
    );

    for (const forbidden of [
      "createProjectMemory",
      "updateProjectMemory",
      "writeProposedMemory",
      "setProjectMemoryStatus",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// HOTFIX-005 (reprise) — la demande reelle du pilote, et ce qu'elle doit rendre
// ---------------------------------------------------------------------------

/**
 * Le tour 12 de TicketPulse, reproduit.
 *
 * ## Ce qui s'est passe
 *
 * L'utilisateur a envoye le contrat d'import complet, en demandant
 * explicitement de l'enregistrer en regles durables, de ne toucher au brief et
 * au plan que si necessaire, et de ne pas planifier. Le modele a repondu :
 *
 * ```text
 * « Le Brief et le Living V1 Plan couvrent deja correctement les capacites
 *   attendues ; aucune modification n'est necessaire. Je propose six entrees
 *   consolidees de Project Memory [...] Elles ne seront enregistrees qu'apres
 *   votre validation dans NOX. »
 * ```
 *
 * Puis il a rendu `projectUpdate: null`. Aucune carte, rien a valider — et NOX a
 * affiche exactement ce qu'il avait recu : une discussion.
 *
 * ## La cause
 *
 * Le champ s'appelait, dans sa propre description, « mise a jour proposee du
 * Project Brief et du Living V1 Plan ». Un tour qui ne changeait ni l'un ni
 * l'autre le mettait donc a `null` — et emportait les regles avec lui. Le prompt
 * disait **ce qui** merite une entree de memoire, et jamais **par ou** elle
 * passe.
 */
const PILOT_REQUEST =
  "Je veux maintenant enregistrer comme regles durables du projet le contrat " +
  "d'import Excel que nous avons valide. Ne modifie le Brief ou le Living V1 Plan " +
  "que si cela est strictement necessaire. Ne genere pas de backlog.";

describe("HOTFIX-005 (reprise) — une mise a jour de memoire seule est de plein droit", () => {
  it("le contrat accepte une mise a jour sans aucun changement de brief ni de plan", () => {
    // Requirement 1 et 5. C'etait deja vrai — `projectUpdateTouchesSomething`
    // compte les regles depuis HOTFIX-005 — et ce test le fixe explicitement,
    // parce que c'est la forme exacte que le pilote attendait.
    const read = readArchitectProjectUpdate({
      reason: "Le contrat d'import est fige.",
      brief: { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null },
      plan: { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null },
      memories: IMPORT_CONTRACT,
    });

    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal(read.proposal.memories.length, 3);
    }
  });

  it("la validation du fournisseur ne reclame aucun changement de brief ni de plan", async () => {
    // Requirement 5, sur le chemin reel : `checkProviderProjectUpdate` mesure
    // un budget, il n'exige pas qu'une section change.
    const project = await newTicketPulse();
    const current = await loadProjectStructuredState(
      db,
      project.id,
      projectPlanTools(project.repositoryPath),
    );
    const read = readArchitectProjectUpdate({
      reason: "Le contrat d'import est fige.",
      brief: { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null },
      plan: { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null },
      memories: IMPORT_CONTRACT,
    });
    assert.ok(read.ok);

    const checked = checkProviderProjectUpdate(
      current,
      read.proposal,
      projectPlanTools(project.repositoryPath),
    );

    assert.equal(checked.ok, true);
  });

  it("la demande reelle du pilote produit une carte a valider", async () => {
    // Requirement 2. Le tour aboutit, et une proposition existe en base — ce
    // qui manquait au tour 12 reel.
    const project = await newTicketPulse();
    const provider = new FakeArchitectProvider([
      fakeProviderSuccess(
        fakeProjectTurn({
          message:
            "Le brief et le plan couvrent deja ces capacites. Je pose le contrat en regles durables.",
          projectUpdate: { reason: "Le contrat d'import est fige.", memories: IMPORT_CONTRACT },
        }),
      ),
    ]);

    await review(project, PILOT_REQUEST);
    const outcome = await send(project, provider);

    assert.ok(outcome.ok);
    const update = await lastProjectUpdate(project.id);
    assert.notEqual(update, null, "une carte existe");
    assert.equal(update?.status, ARCHITECT_PROJECT_UPDATE_STATUS.PENDING);
    assert.equal(update?.proposed.memories.length, 3);
    // Et le brief comme le plan restent explicitement inchanges.
    assert.equal(update?.proposed.brief.action, PROJECT_UPDATE_ACTION.UNCHANGED);
    assert.equal(update?.proposed.plan.action, PROJECT_UPDATE_ACTION.UNCHANGED);
  });

  it("la carte de conversation annonce les regles, et ne parait pas vide", async () => {
    // Requirement 3 vu du fil : sans ce compteur, la carte affichait « 0 champ »
    // sur ses deux lignes et donnait a croire qu'il n'y avait rien a ouvrir.
    const project = await newTicketPulse();
    const provider = new FakeArchitectProvider([
      fakeProviderSuccess(
        fakeProjectTurn({
          projectUpdate: { reason: "Le contrat d'import est fige.", memories: IMPORT_CONTRACT },
        }),
      ),
    ]);
    await review(project, PILOT_REQUEST);
    assert.ok((await send(project, provider)).ok);

    const current = await loadProjectStructuredState(
      db,
      project.id,
      projectPlanTools(project.repositoryPath),
    );
    const cards = await loadTimelineProjectUpdates(db, project, project.sessionId, current);

    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.memoryChanges, 3);
    assert.equal(cards[0]?.briefChanges, 0);
    assert.equal(cards[0]?.planChanges, 0);
  });

  it("la revue rend la section des regles durables", async () => {
    // Requirement 3. La page lit la proposition enregistree, et c'est elle qui
    // porte le detail que l'utilisateur valide.
    const project = await newTicketPulse();
    const provider = new FakeArchitectProvider([
      fakeProviderSuccess(
        fakeProjectTurn({
          projectUpdate: { reason: "Le contrat d'import est fige.", memories: IMPORT_CONTRACT },
        }),
      ),
    ]);
    await review(project, PILOT_REQUEST);
    assert.ok((await send(project, provider)).ok);

    const update = await lastProjectUpdate(project.id);
    assert.ok(update !== null);

    for (const memory of update.proposed.memories) {
      assert.notEqual(memory.title, "");
      assert.notEqual(memory.content, "");
    }
    assert.match(
      update.proposed.memories.map((memory) => memory.content).join("\n"),
      /toutes ses occurrences sont rejetees/u,
    );
  });

  it("appliquer une carte sans brief ni plan ecrit bien la memoire", async () => {
    // Requirement 4 et 5 reunis : le chemin d'application ne reclame pas non
    // plus une section a ecrire.
    const project = await newTicketPulse();
    const provider = new FakeArchitectProvider([
      fakeProviderSuccess(
        fakeProjectTurn({
          projectUpdate: { reason: "Le contrat d'import est fige.", memories: IMPORT_CONTRACT },
        }),
      ),
    ]);
    await review(project, PILOT_REQUEST);
    assert.ok((await send(project, provider)).ok);

    const update = await lastProjectUpdate(project.id);
    assert.ok(update !== null);
    const applied = await applyProjectUpdate(
      db,
      project,
      update.id,
      { brief: null, plan: null },
      update.proposed.memories,
      ENVIRONMENT,
    );

    assert.ok(applied.ok, "une proposition sans brief ni plan s'applique");
    assert.equal((await listActiveProjectMemories(db, project.id)).length, 3);
  });

  it("une discussion sans proposition n'ecrit toujours rien", async () => {
    // Requirements 6 et 9 : le tour 12 reel reste un cas parfaitement valable —
    // c'est ce qu'il **disait** qui etait faux, pas ce qu'il faisait.
    const project = await newTicketPulse();
    const provider = new FakeArchitectProvider([
      fakeProviderSuccess(
        fakeProjectTurn({
          message: "Avant de poser ces regles, le format de la date Cree est-il toujours ISO ?",
          questions: ["Quel est le format exact de la colonne Cree ?"],
        }),
      ),
    ]);

    await review(project, PILOT_REQUEST);
    const outcome = await send(project, provider);

    assert.ok(outcome.ok);
    assert.equal(await lastProjectUpdate(project.id), null, "aucune carte inventee");
    assert.deepEqual(await listActiveProjectMemories(db, project.id), []);
  });

  it("brief, plan et regles dans un meme tour restent une seule transaction", async () => {
    // Requirement 10 : le cas combine n'a pas ete casse par le cas simple.
    const project = await newTicketPulse();
    const provider = new FakeArchitectProvider([
      fakeProviderSuccess(
        fakeProjectTurn({
          projectUpdate: {
            reason: "Le plan et le contrat evoluent ensemble.",
            plan: TICKETPULSE_PLAN,
            memories: IMPORT_CONTRACT,
          },
        }),
      ),
    ]);
    await review(project, PILOT_REQUEST);
    assert.ok((await send(project, provider)).ok);

    const update = await lastProjectUpdate(project.id);
    assert.ok(update !== null);
    assert.ok(
      (
        await applyProjectUpdate(
          db,
          project,
          update.id,
          { brief: null, plan: TICKETPULSE_PLAN },
          update.proposed.memories,
          ENVIRONMENT,
        )
      ).ok,
    );

    const state = await loadProjectStructuredState(
      db,
      project.id,
      projectPlanTools(project.repositoryPath),
    );
    assert.equal(state.plan.present, true);
    assert.equal((await listActiveProjectMemories(db, project.id)).length, 3);
  });
});

describe("HOTFIX-005 (reprise) — le contrat dit par ou passe une regle durable", () => {
  function projectInstructions(): string {
    return renderArchitectPrompt({
      sessionKind: ARCHITECT_SESSION_KIND.PROJECT,
      projectName: "TicketPulse",
      instructionDocuments: [],
      projectMemory: [],
      projectBrief: null,
      projectV1Plan: null,
      contextDocuments: [],
      recentTasks: [],
      planningState: null,
      availableDocuments: [],
      transcript: [],
      newMessage: PILOT_REQUEST,
    }).instructions;
  }

  it("nomme le seul champ par lequel une entree se propose", () => {
    // Requirement 7. C'est la phrase qui manquait : `architect/9` disait quoi
    // poser, jamais ou l'ecrire.
    const instructions = projectInstructions();

    assert.match(instructions, /projectUpdate\.memories/u);
    assert.match(instructions, /Il n'existe aucun autre canal/u);
  });

  it("dit qu'une mise a jour de memoire seule est valide et attendue", () => {
    // La cause exacte du tour 12 : brief et plan corrects, donc `null`, donc
    // rien. Cette phrase retire l'inference.
    const instructions = projectInstructions();

    assert.match(instructions, /ne porte que des entrees `memories` est valide/u);
    assert.match(instructions, /laisse-les/u);
  });

  it("dit quand `projectUpdate` peut valoir null", () => {
    const instructions = projectInstructions();

    assert.match(instructions, /ni\*\* brief, \*\*ni\*\*/u);
  });

  it("interdit d'annoncer des regles qui ne sont pas emises", () => {
    // Requirement 8, avec les phrases exactes du pilote comme contre-exemples.
    const instructions = projectInstructions();

    assert.match(instructions, /N'annonce jamais des regles durables que tu n'as pas emises/u);
    assert.match(instructions, /Je propose six entrees de Project Memory/u);
    assert.match(instructions, /Elles seront enregistrees apres votre validation/u);
  });

  it("laisse la discussion valide, a condition de le dire", () => {
    // Requirement 9 : demander une precision reste la bonne reponse ; ce qui
    // est interdit est de laisser croire qu'une carte existe.
    const instructions = projectInstructions();

    assert.match(instructions, /une discussion/u);
    assert.match(instructions, /aucune\n?\s*proposition n'a encore ete creee/u);
  });

  it("la version de prompt suit le changement d'instructions", () => {
    assert.equal(
      architectPromptVersion(ARCHITECT_SESSION_KIND.PROJECT, false),
      ARCHITECT_PROMPT_VERSION_V11,
    );
    assert.equal(
      architectPromptVersion(ARCHITECT_SESSION_KIND.PROJECT, true),
      ARCHITECT_PROMPT_VERSION_V12,
    );
  });

  it("le schema, lui, ne bouge pas", () => {
    // Requirement 6 du rapport : la **forme** est identique — memes champs,
    // meme liste requise. Seules des descriptions ont change, et une consigne
    // ne bumpe pas un contrat.
    assert.equal(
      architectTurnSchemaVersion(ARCHITECT_SESSION_KIND.PROJECT, false),
      ARCHITECT_TURN_SCHEMA_VERSION_V5,
    );

    const schema = buildArchitectTurnSchema(ARCHITECT_TURN_SCHEMA_VERSION_V5);
    const update = (schema["properties"] as Record<string, Record<string, unknown>>)[
      "projectUpdate"
    ];
    assert.deepEqual(update?.["required"], ["reason", "brief", "plan", "memories"]);
  });

  it("la description du champ ne parle plus du seul brief et du seul plan", () => {
    // La misdirection d'origine, fixee la ou le fournisseur la lit vraiment.
    const schema = buildArchitectTurnSchema(ARCHITECT_TURN_SCHEMA_VERSION_V5);
    const update = (schema["properties"] as Record<string, Record<string, unknown>>)[
      "projectUpdate"
    ];
    const description = String(update?.["description"] ?? "");

    assert.match(description, /regles durables/u);
    assert.match(description, /QUE des entrees memories/u);
    assert.match(description, /UNCHANGED, est valide/u);
  });

  it("la description de memories dit qu'elle est le seul canal", () => {
    const schema = buildArchitectTurnSchema(ARCHITECT_TURN_SCHEMA_VERSION_V5);
    const update = (schema["properties"] as Record<string, Record<string, unknown>>)[
      "projectUpdate"
    ];
    const memories = (update?.["properties"] as Record<string, Record<string, unknown>>)[
      "memories"
    ];
    const description = String(memories?.["description"] ?? "");

    assert.match(description, /SEUL moyen de proposer une entree de memoire/u);
    assert.match(description, /meme lorsque brief et plan restent UNCHANGED/u);
  });
});

describe("HOTFIX-005 (reprise) — aucune lecture de prose", () => {
  it("aucun module ne cherche une intention dans le texte du modele", () => {
    // Requirement 13, et la contrainte explicite : le correctif passe par les
    // instructions et la description du contrat, jamais par une detection de
    // langage naturel. Une entree de memoire ne peut naitre que d'un tableau
    // structure.
    for (const file of [
      "lib/architect/service.ts",
      "lib/architect/project-update.ts",
      "lib/architect/timeline.ts",
    ]) {
      const source = readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", file),
        "utf8",
      )
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/^\s*\/\/.*$/gmu, "");

      for (const forbidden of ["je propose", "turn.message.includes", "message.match"]) {
        assert.equal(source.toLowerCase().includes(forbidden), false, `${file} : ${forbidden}`);
      }
    }
  });

  it("le message du modele n'entre dans aucune decision de memoire", () => {
    // Le seul chemin vers une entree est `projectUpdate.memories`. Un tour dont
    // le message decrit des regles, sans tableau, n'en propose aucune.
    const read = readArchitectProjectUpdate({
      reason: "Le contrat d'import est fige.",
      brief: { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null },
      plan: { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null },
      memories: [],
    });

    assert.equal(read.ok, false, "une mise a jour qui ne pose rien est refusee");
  });
});
