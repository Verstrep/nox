/**
 * Contexte de planification.
 *
 * ## Ce que ce fichier prouve
 *
 * Que la liste de ce qui part est **fermee** : le brief, le plan, la memoire
 * active, l'inventaire des taches et huit chemins connus a l'avance. Rien
 * d'autre n'entre, quel que soit ce que contient le repository.
 *
 * Que la memoire active n'est jamais tronquee — la garantie « ACTIVE = envoye »
 * de TASK-017 vaut ici exactement comme dans une conversation.
 *
 * Et qu'aucune conversation n'y figure. C'est la demonstration de TASK-021 :
 * si l'etat structure ne suffisait pas a planifier, il n'aurait servi a rien.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PROJECT_DOCUMENT_CATEGORY,
  PROJECT_MEMORY_STATUS,
  type ArchitectPromptBrief,
  type ArchitectPromptMemory,
  type ArchitectPromptV1Plan,
  type DevelopmentTaskSummary,
  type ProjectDocumentSummary,
  type ProjectMemoryEntry,
} from "@nox/shared";

import type { FetchedArchitectDocument } from "../architect/context.ts";
import {
  BACKLOG_CONTEXT_LIMITS,
  buildBacklogPlanningContext,
  type BacklogPlanningInput,
} from "./planning-context.ts";

const BRIEF: ArchitectPromptBrief = {
  revision: "brief-1",
  summary: "Un planificateur de repas.",
  problem: "Preparer la semaine prend du temps.",
  targetUsers: "Une personne seule.",
  desiredOutcome: "Une semaine preparee vite.",
  goals: ["planifier"],
  nonGoals: ["reseau social"],
};

const PLAN: ArchitectPromptV1Plan = {
  revision: "plan-1",
  goal: "Preparer une semaine.",
  inScope: ["planning"],
  outOfScope: ["mobile"],
  technicalDirection: "Web simple.",
  milestones: ["planning utilisable"],
};

function task(overrides: Partial<DevelopmentTaskSummary> = {}): DevelopmentTaskSummary {
  return {
    id: "task-1",
    code: "TASK-001",
    kind: "NORMAL",
    title: "Poser le schema",
    status: "DRAFT",
    priority: "HIGH",
    documentSyncStatus: "SYNCED",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function memoryEntry(overrides: Partial<ProjectMemoryEntry> = {}): ProjectMemoryEntry {
  return {
    id: "mem-1",
    projectId: "proj-1",
    sequence: 1,
    code: "MEM-001",
    category: "DECISION",
    status: PROJECT_MEMORY_STATUS.ACTIVE,
    title: "SQLite",
    content: "Le stockage local suffit.",
    rationale: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function inventoryEntry(path: string): ProjectDocumentSummary {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    category: path.startsWith("tasks/")
      ? PROJECT_DOCUMENT_CATEGORY.TASK
      : PROJECT_DOCUMENT_CATEGORY.DOCUMENTATION,
    size: 100,
    updatedAt: "2026-08-01T10:00:00.000Z",
  };
}

const MEMORY_REVISION = (memory: ArchitectPromptMemory): string =>
  `rev(${memory.code}:${memory.title}:${memory.content})`;

function build(overrides: Partial<BacklogPlanningInput> = {}) {
  return buildBacklogPlanningContext({
    documents: [],
    inventory: [inventoryEntry("docs/ARCHITECTURE.md")],
    tasks: [],
    objectives: new Map(),
    memories: [],
    projectBrief: BRIEF,
    projectV1Plan: PLAN,
    sanitize: (value) => value,
    memoryRevision: MEMORY_REVISION,
    ...overrides,
  });
}

const DOCUMENT = (path: string, content: string): FetchedArchitectDocument => ({
  path,
  revision: `rev-${path}`,
  content,
});

describe("liste fermee", () => {
  it("n'envoie que les chemins de l'allowlist de l'Architecte", () => {
    const bundle = build({
      documents: [
        DOCUMENT("CLAUDE.md", "# Regles"),
        DOCUMENT("docs/ARCHITECTURE.md", "# Architecture"),
        DOCUMENT("src/secret.ts", "const cle = 1;"),
        DOCUMENT(".env", "NOX_OPENAI_API_KEY=xxx"),
      ],
    });

    const paths = [
      ...bundle.instructionDocuments.map((entry) => entry.path),
      ...bundle.contextDocuments.map((entry) => entry.path),
    ];
    assert.deepEqual(paths, ["CLAUDE.md", "docs/ARCHITECTURE.md"]);
    assert.equal(paths.includes("src/secret.ts"), false);
    assert.equal(paths.includes(".env"), false);
  });

  it("nomme les documents attendus mais absents", () => {
    const bundle = build();
    assert.ok(bundle.manifest.missing.includes("docs/ARCHITECTURE.md"));
    assert.ok(bundle.manifest.missing.includes("CLAUDE.md"));
  });

  it("borne la liste fermee des documents referencables", () => {
    const inventory = Array.from({ length: 200 }, (_unused, index) =>
      inventoryEntry(`docs/D${String(index)}.md`),
    );
    const bundle = build({ inventory });
    assert.equal(bundle.availableDocuments.length, BACKLOG_CONTEXT_LIMITS.availableDocuments);
  });
});

describe("etat structure", () => {
  it("porte le brief et le plan avec leur revision", () => {
    const bundle = build();
    assert.equal(bundle.projectBrief?.revision, "brief-1");
    assert.equal(bundle.projectV1Plan?.revision, "plan-1");

    const kinds = bundle.manifest.sources.map((source) => source.kind);
    assert.ok(kinds.includes("PROJECT_BRIEF"));
    assert.ok(kinds.includes("PROJECT_V1_PLAN"));
  });

  it("distingue un brief absent d'un brief vide", () => {
    const absent = build({ projectBrief: null });
    assert.equal(absent.projectBrief, null);
    assert.equal(
      absent.manifest.sources.some((source) => source.kind === "PROJECT_BRIEF"),
      false,
    );

    const vide = build({
      projectBrief: {
        revision: "brief-vide",
        summary: "",
        problem: "",
        targetUsers: "",
        desiredOutcome: "",
        goals: [],
        nonGoals: [],
      },
    });
    assert.ok(vide.manifest.sources.some((source) => source.kind === "PROJECT_BRIEF"));
    assert.notEqual(absent.planningFingerprint, vide.planningFingerprint);
  });
});

describe("memoire", () => {
  it("n'envoie que les entrees actives", () => {
    const bundle = build({
      memories: [
        memoryEntry({ code: "MEM-001" }),
        memoryEntry({ code: "MEM-002", status: PROJECT_MEMORY_STATUS.ARCHIVED }),
      ],
    });
    assert.deepEqual(
      bundle.projectMemory.map((entry) => entry.code),
      ["MEM-001"],
    );
  });

  it("refiltre les archivees plutot que de les supposer absentes", () => {
    const bundle = build({
      memories: [memoryEntry({ status: PROJECT_MEMORY_STATUS.ARCHIVED })],
    });
    assert.equal(bundle.projectMemory.length, 0);
    assert.equal(
      bundle.manifest.sources.some((source) => source.kind === "MEMORY"),
      false,
    );
  });

  it("calcule la revision sur le texte sanitise, jamais sur le texte stocke", () => {
    const bundle = build({
      memories: [memoryEntry({ content: "La cle est SECRET-REEL." })],
      sanitize: (value) => value.replaceAll("SECRET-REEL", "[masque]"),
    });
    assert.equal(bundle.projectMemory[0]?.content, "La cle est [masque].");
    assert.ok(bundle.projectMemory[0]?.revision.includes("[masque]"));
    assert.equal(bundle.projectMemory[0]?.revision.includes("SECRET-REEL"), false);
  });

  it("ne tronque jamais une entree active", () => {
    const bundle = build({
      memories: Array.from({ length: 20 }, (_unused, index) =>
        memoryEntry({ code: `MEM-${String(index).padStart(3, "0")}`, content: "x".repeat(2_000) }),
      ),
    });
    assert.equal(bundle.projectMemory.length, 20);
    assert.equal(
      bundle.manifest.sources.filter((source) => source.kind === "MEMORY").every((source) => !source.truncated),
      true,
    );
  });
});

describe("inventaire des taches", () => {
  it("le rend dans l'ordre des codes", () => {
    const bundle = build({
      tasks: [task({ id: "b", code: "TASK-003" }), task({ id: "a", code: "TASK-001" })],
      objectives: new Map([
        ["a", "Premier objectif."],
        ["b", "Troisieme objectif."],
      ]),
    });
    assert.deepEqual(
      bundle.existingTasks.map((entry) => entry.code),
      ["TASK-001", "TASK-003"],
    );
  });

  it("porte le statut, la priorite et l'objectif", () => {
    const bundle = build({
      tasks: [task({ status: "COMPLETED", priority: "LOW" })],
      objectives: new Map([["task-1", "Un repas se cree."]]),
    });
    assert.equal(bundle.existingTasks[0]?.status, "COMPLETED");
    assert.equal(bundle.existingTasks[0]?.priority, "LOW");
    assert.equal(bundle.existingTasks[0]?.objective, "Un repas se cree.");
  });

  it("ne porte ni critere, ni execution, ni diff", () => {
    const bundle = build({ tasks: [task()], objectives: new Map([["task-1", "Objectif."]]) });
    const entry = bundle.existingTasks[0];
    assert.ok(entry !== undefined);
    assert.deepEqual(Object.keys(entry).sort(), [
      "code",
      "objective",
      "priority",
      "revision",
      "status",
      "title",
    ]);
  });

  it("retient les plus recentes au-dela de la borne", () => {
    const count = BACKLOG_CONTEXT_LIMITS.tasks + 5;
    const tasks = Array.from({ length: count }, (_unused, index) =>
      task({ id: `t${String(index)}`, code: `TASK-${String(index + 1).padStart(3, "0")}` }),
    );
    const bundle = build({ tasks, objectives: new Map() });

    assert.equal(bundle.existingTasks.length, BACKLOG_CONTEXT_LIMITS.tasks);
    assert.equal(bundle.existingTasks[0]?.code, "TASK-006");
    assert.equal(
      bundle.existingTasks[bundle.existingTasks.length - 1]?.code,
      `TASK-${String(count).padStart(3, "0")}`,
    );
  });

  it("sanitise les titres et les objectifs", () => {
    const bundle = build({
      tasks: [task({ title: "Corriger SECRET-REEL" })],
      objectives: new Map([["task-1", "Retirer SECRET-REEL du code."]]),
      sanitize: (value) => value.replaceAll("SECRET-REEL", "[masque]"),
    });
    assert.equal(bundle.existingTasks[0]?.title, "Corriger [masque]");
    assert.equal(bundle.existingTasks[0]?.objective, "Retirer [masque] du code.");
  });

  it("supporte une tache dont l'objectif n'a pas ete relu", () => {
    const bundle = build({ tasks: [task()], objectives: new Map() });
    assert.equal(bundle.existingTasks[0]?.objective, "");
  });

  it("expose la revision de l'inventaire dans le manifest", () => {
    const bundle = build({ tasks: [task()], objectives: new Map([["task-1", "Objectif."]]) });
    assert.equal(bundle.manifest.taskInventoryRevision, bundle.taskInventoryRevision);
    assert.match(bundle.taskInventoryRevision, /^[0-9a-f]{64}$/u);
  });
});

describe("budget", () => {
  it("laisse tenir l'etat structure, les conventions, la memoire et l'inventaire", () => {
    // 16 (etat structure) + 64 (conventions) + 48 (memoire) + 32 (inventaire)
    // = 160 Kio, sous les 192 Kio du budget. Les documents produit se
    // partagent le reste, et eux seuls ont le droit d'etre coupes.
    const structured = 16 * 1024;
    const conventions = 2 * BACKLOG_CONTEXT_LIMITS.documentChars;
    const memory = 48 * 1024;
    const inventory = BACKLOG_CONTEXT_LIMITS.tasks * BACKLOG_CONTEXT_LIMITS.taskChars;
    assert.ok(
      structured + conventions + memory + inventory < BACKLOG_CONTEXT_LIMITS.totalChars,
      "les quatre categories non-tronquables tiennent dans le budget",
    );
  });

  it("tronque un document trop long en le signalant", () => {
    const bundle = build({
      documents: [DOCUMENT("docs/DECISIONS.md", "x".repeat(BACKLOG_CONTEXT_LIMITS.documentChars * 2))],
    });
    const source = bundle.manifest.sources.find(
      (entry) => entry.identifier === "docs/DECISIONS.md",
    );
    assert.ok(source?.truncated);
    assert.ok(source.includedChars <= BACKLOG_CONTEXT_LIMITS.documentChars);
  });

  it("compte le total transmis", () => {
    const bundle = build({ documents: [DOCUMENT("CLAUDE.md", "abcdef")] });
    assert.ok(bundle.manifest.totalChars > 0);
  });
});

describe("empreinte", () => {
  it("est produite avec le bundle", () => {
    assert.match(build().planningFingerprint, /^[0-9a-f]{64}$/u);
  });

  it("change quand une tache change de statut", () => {
    const before = build({
      tasks: [task({ status: "DRAFT" })],
      objectives: new Map([["task-1", "Objectif."]]),
    });
    const after = build({
      tasks: [task({ status: "COMPLETED" })],
      objectives: new Map([["task-1", "Objectif."]]),
    });
    assert.notEqual(before.planningFingerprint, after.planningFingerprint);
  });

  it("change quand une memoire active est archivee", () => {
    const before = build({ memories: [memoryEntry()] });
    const after = build({ memories: [memoryEntry({ status: PROJECT_MEMORY_STATUS.ARCHIVED })] });
    assert.notEqual(before.planningFingerprint, after.planningFingerprint);
  });

  it("ne change pas quand un fichier hors liste fermee apparait", () => {
    const before = build({ documents: [DOCUMENT("CLAUDE.md", "# Regles")] });
    const after = build({
      documents: [DOCUMENT("CLAUDE.md", "# Regles"), DOCUMENT("src/nouveau.ts", "const x = 1;")],
    });
    assert.equal(before.planningFingerprint, after.planningFingerprint);
  });
});

describe("aucune conversation", () => {
  it("n'accepte aucun transcript", () => {
    // Le type d'entree ne porte ni `transcript`, ni `newMessage` : ce n'est pas
    // un filtre, c'est une absence. Aucun chemin de code ne peut y amener un
    // message de conversation.
    const bundle = build();
    assert.equal("transcript" in bundle, false);
    assert.equal("newMessage" in bundle, false);
  });
});
