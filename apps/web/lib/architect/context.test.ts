/**
 * Tests du bundle de contexte.
 *
 * La question a laquelle cette suite repond n'est pas « le contexte est-il
 * bon ? » mais « **que quitte la machine, exactement ?** ». D'ou les cas
 * negatifs, qui sont les plus importants : ce qui n'est jamais candidat ne peut
 * pas partir, quelle que soit la suite du programme.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DevelopmentTaskDetail, ProjectDocumentSummary } from "@nox/shared";

import { architectTaskRevision } from "./fingerprint.ts";
import {
  ARCHITECT_CONTEXT_LIMITS,
  ARCHITECT_DOCUMENT_ALLOWLIST,
  buildArchitectContext,
  buildAvailableDocuments,
  truncateAroundMiddle,
  type FetchedArchitectDocument,
} from "./context.ts";

const IDENTITY = (value: string): string => value;

function document(path: string, content: string): FetchedArchitectDocument {
  return { path, revision: "a".repeat(64), content };
}

function summary(path: string, category: ProjectDocumentSummary["category"]): ProjectDocumentSummary {
  return { path, name: path.split("/").pop() ?? path, category, size: 10, updatedAt: "2026-01-01T00:00:00.000Z" };
}

function task(code: string, overrides: Partial<DevelopmentTaskDetail> = {}): DevelopmentTaskDetail {
  return {
    id: `id-${code}`,
    projectId: "projet",
    code,
    title: `Titre ${code}`,
    status: "COMPLETED",
    priority: "MEDIUM",
    documentSyncStatus: "SYNCED",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    objective: `Objectif ${code}`,
    context: null,
    outOfScope: null,
    acceptanceCriteria: [`Critere ${code}`],
    documentReferences: ["docs/ARCHITECTURE.md"],
    validationCommands: ["npm run test"],
    documentPath: `tasks/${code}.md`,
    documentRevision: "b".repeat(64),
    documentSyncError: null,
    ...overrides,
  };
}

function build(
  documents: readonly FetchedArchitectDocument[],
  tasks: readonly DevelopmentTaskDetail[] = [],
  inventory: readonly ProjectDocumentSummary[] = [],
) {
  return buildArchitectContext({
    documents,
    inventory,
    tasks,
    sanitize: IDENTITY,
    taskRevision: architectTaskRevision,
  });
}

describe("buildArchitectContext — documents", () => {
  it("inclut les huit documents de la liste fermee", () => {
    const bundle = build(ARCHITECT_DOCUMENT_ALLOWLIST.map((path) => document(path, `# ${path}`)));

    assert.equal(bundle.instructionDocuments.length, 2);
    assert.equal(bundle.contextDocuments.length, 6);
    assert.deepEqual(bundle.manifest.missing, []);
  });

  it("fonctionne sans aucun document", () => {
    const bundle = build([]);

    assert.deepEqual(bundle.instructionDocuments, []);
    assert.deepEqual(bundle.contextDocuments, []);
    assert.equal(bundle.manifest.missing.length, ARCHITECT_DOCUMENT_ALLOWLIST.length);
    assert.equal(bundle.manifest.totalChars, 0);
  });

  it("nomme les documents absents sans en faire une erreur", () => {
    const bundle = build([document("CLAUDE.md", "# Regles")]);

    assert.equal(bundle.instructionDocuments.length, 1);
    assert.ok(bundle.manifest.missing.includes("AGENTS.md"));
    assert.ok(bundle.manifest.missing.includes("docs/DECISIONS.md"));
  });

  it("enregistre la revision de chaque document", () => {
    const bundle = build([document("CLAUDE.md", "# Regles")]);
    const source = bundle.manifest.sources[0];

    assert.equal(source?.identifier, "CLAUDE.md");
    assert.equal(source?.revision, "a".repeat(64));
    assert.equal(source?.kind, "INSTRUCTIONS");
  });

  it("distingue conventions et documentation", () => {
    const bundle = build([
      document("CLAUDE.md", "# Regles"),
      document("docs/ARCHITECTURE.md", "# Architecture"),
    ]);

    assert.equal(bundle.manifest.sources[0]?.kind, "INSTRUCTIONS");
    assert.equal(bundle.manifest.sources[1]?.kind, "DOCUMENT");
  });

  it("n'inclut jamais un document hors de la liste fermee", () => {
    const bundle = build([
      document("package.json", "{ \"name\": \"nox\" }"),
      document(".env", "NOX_RUNNER_TOKEN=secret"),
      document("apps/web/lib/runs.ts", "export const a = 1;"),
    ]);

    assert.deepEqual(bundle.instructionDocuments, []);
    assert.deepEqual(bundle.contextDocuments, []);
    assert.equal(bundle.manifest.totalChars, 0);
  });
});

describe("buildArchitectContext — bornes", () => {
  it("tronque un document trop grand en gardant debut et fin", () => {
    const content = `DEBUT${"x".repeat(ARCHITECT_CONTEXT_LIMITS.documentChars * 2)}FIN`;
    const bundle = build([document("docs/DECISIONS.md", content)]);
    const included = bundle.contextDocuments[0];

    assert.ok(included);
    assert.equal(included.truncated, true);
    assert.ok(included.content.startsWith("DEBUT"));
    assert.ok(included.content.endsWith("FIN"));
    assert.ok(included.content.includes("caracteres retires par NOX"));
    assert.ok(included.content.length <= ARCHITECT_CONTEXT_LIMITS.documentChars);
  });

  it("marque la troncature dans le manifest", () => {
    const content = "y".repeat(ARCHITECT_CONTEXT_LIMITS.documentChars + 1);
    const bundle = build([document("docs/ROADMAP.md", content)]);

    assert.equal(bundle.manifest.sources[0]?.truncated, true);
  });

  it("ne tronque pas un document qui tient dans la borne", () => {
    const bundle = build([document("docs/ROADMAP.md", "# Roadmap")]);
    assert.equal(bundle.manifest.sources[0]?.truncated, false);
  });

  it("respecte la borne totale", () => {
    // Huit documents de 32 Kio depassent les 128 Kio autorises : les derniers de
    // la liste sont donc rognes, puis omis.
    const huge = "z".repeat(ARCHITECT_CONTEXT_LIMITS.documentChars);
    const bundle = build(ARCHITECT_DOCUMENT_ALLOWLIST.map((path) => document(path, huge)));

    assert.ok(bundle.manifest.totalChars <= ARCHITECT_CONTEXT_LIMITS.totalChars);
  });

  it("omet plutot que d'inventer de la place", () => {
    const huge = "z".repeat(ARCHITECT_CONTEXT_LIMITS.documentChars);
    const bundle = build(ARCHITECT_DOCUMENT_ALLOWLIST.map((path) => document(path, huge)));
    const omitted = bundle.manifest.sources.filter((source) => source.includedChars === 0);

    assert.ok(omitted.length > 0, "les derniers documents doivent etre omis");
    // Un document omis n'est pas absent : il figure dans les sources, pas dans
    // la liste des manquants.
    assert.deepEqual(bundle.manifest.missing, []);
  });

  it("consomme le budget dans l'ordre de priorite", () => {
    const huge = "z".repeat(ARCHITECT_CONTEXT_LIMITS.documentChars);
    const bundle = build(ARCHITECT_DOCUMENT_ALLOWLIST.map((path) => document(path, huge)));
    const paths = bundle.contextDocuments.map((entry) => entry.path);

    // `docs/DECISIONS.md` ferme la liste : c'est le premier a etre sacrifie.
    assert.ok(paths.includes("docs/PROJECT_BRIEF.md"));
    assert.equal(paths.includes("docs/DECISIONS.md"), false);
  });
});

describe("truncateAroundMiddle", () => {
  it("laisse un texte court intact", () => {
    assert.deepEqual(truncateAroundMiddle("court", 100), { text: "court", truncated: false });
  });

  it("conserve le debut et la fin", () => {
    const result = truncateAroundMiddle(`A${"m".repeat(1_000)}Z`, 200);
    assert.equal(result.truncated, true);
    assert.ok(result.text.startsWith("A"));
    assert.ok(result.text.endsWith("Z"));
  });

  it("rend une chaine vide pour un budget nul", () => {
    assert.deepEqual(truncateAroundMiddle("texte", 0), { text: "", truncated: true });
  });
});

describe("buildArchitectContext — taches", () => {
  it("n'inclut aucune tache quand il n'y en a pas", () => {
    const bundle = build([], []);
    assert.deepEqual(bundle.recentTasks, []);
  });

  it("inclut une tache unique", () => {
    const bundle = build([], [task("TASK-001")]);

    assert.equal(bundle.recentTasks.length, 1);
    assert.equal(bundle.recentTasks[0]?.code, "TASK-001");
    assert.equal(bundle.manifest.sources[0]?.kind, "TASK");
  });

  it("s'arrete a dix taches", () => {
    const tasks = Array.from({ length: 25 }, (_, index) =>
      task(`TASK-${String(index + 1).padStart(3, "0")}`),
    );
    const bundle = build([], tasks);

    assert.equal(bundle.recentTasks.length, ARCHITECT_CONTEXT_LIMITS.recentTasks);
  });

  it("conserve l'ordre recu", () => {
    const bundle = build([], [task("TASK-012"), task("TASK-011"), task("TASK-010")]);
    assert.deepEqual(
      bundle.recentTasks.map((entry) => entry.code),
      ["TASK-012", "TASK-011", "TASK-010"],
    );
  });

  it("n'inclut que la specification d'une tache", () => {
    const bundle = build([], [task("TASK-001")]);
    const serialized = JSON.stringify(bundle.recentTasks);

    // Ni prompt, ni resultat, ni session, ni cout : le type ne les porte pas, et
    // ce test le fige.
    for (const forbidden of ["prompt", "sessionId", "stderr", "patch", "reportedCost"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });
});

describe("buildAvailableDocuments", () => {
  it("place les documents ordinaires avant ceux des taches", () => {
    const available = buildAvailableDocuments([
      summary("tasks/TASK-001.md", "TASK"),
      summary("docs/ARCHITECTURE.md", "DOCUMENTATION"),
      summary("CLAUDE.md", "CORE"),
    ]);

    assert.deepEqual(available, ["docs/ARCHITECTURE.md", "CLAUDE.md", "tasks/TASK-001.md"]);
  });

  it("borne la liste", () => {
    const inventory = Array.from({ length: 200 }, (_, index) =>
      summary(`docs/page-${String(index)}.md`, "DOCUMENTATION"),
    );
    assert.equal(
      buildAvailableDocuments(inventory).length,
      ARCHITECT_CONTEXT_LIMITS.availableDocuments,
    );
  });

  it("rend une liste vide pour un inventaire vide", () => {
    assert.deepEqual(buildAvailableDocuments([]), []);
  });
});

describe("buildArchitectContext — sanitation", () => {
  it("applique le nettoyeur a tout ce qui est transmis", () => {
    const bundle = buildArchitectContext({
      documents: [document("CLAUDE.md", "SECRET")],
      inventory: [],
      tasks: [task("TASK-001", { objective: "SECRET", title: "SECRET" })],
      sanitize: (value) => value.replaceAll("SECRET", "<masque>"),
      taskRevision: architectTaskRevision,
    });

    assert.equal(bundle.instructionDocuments[0]?.content, "<masque>");
    assert.equal(bundle.recentTasks[0]?.objective, "<masque>");
    assert.equal(bundle.recentTasks[0]?.title, "<masque>");
  });
});
