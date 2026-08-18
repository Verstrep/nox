/**
 * Empreintes du contexte de planification.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'une empreinte change **exactement** quand ce qui decide d'un backlog
 * change : le brief, le plan, la memoire active, l'inventaire des taches, les
 * documents inclus. Ni plus — un fichier non inclus ne rend rien perime —, ni
 * moins.
 *
 * Le cas le plus important est le plus discret : un statut de tache qui passe
 * de `DRAFT` a `COMPLETED` change ce qu'il reste a planifier, meme si la
 * specification n'a pas bouge d'une lettre. Une empreinte qui ne le verrait pas
 * laisserait appliquer un backlog qui repropose du travail deja fait.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ArchitectPromptDocument, ArchitectPromptMemory, BacklogInventoryTask } from "@nox/shared";

import {
  BACKLOG_FINGERPRINT_VERSION,
  backlogMemoryRevision,
  backlogPlanningFingerprint,
  backlogTaskInventoryRevision,
  backlogTaskRevision,
  type BacklogFingerprintInput,
} from "./fingerprint.ts";

function inventoryTask(overrides: Partial<BacklogInventoryTask> = {}): BacklogInventoryTask {
  const entry = {
    code: "TASK-001",
    title: "Poser le schema",
    status: "DRAFT",
    priority: "HIGH",
    objective: "Un repas se cree.",
    ...overrides,
  };
  return { ...entry, revision: backlogTaskRevision(entry) };
}

function memory(overrides: Partial<ArchitectPromptMemory> = {}): ArchitectPromptMemory {
  return {
    code: "MEM-001",
    category: "DECISION",
    revision: "mem-1",
    title: "SQLite",
    content: "Le stockage local suffit.",
    rationale: null,
    ...overrides,
  };
}

function document(overrides: Partial<ArchitectPromptDocument> = {}): ArchitectPromptDocument {
  return {
    path: "docs/ARCHITECTURE.md",
    revision: "doc-1",
    truncated: false,
    content: "# Architecture",
    ...overrides,
  };
}

function base(overrides: Partial<BacklogFingerprintInput> = {}): BacklogFingerprintInput {
  return {
    briefRevision: "brief-1",
    planRevision: "plan-1",
    memoryRevision: backlogMemoryRevision([memory()]),
    taskInventoryRevision: backlogTaskInventoryRevision([inventoryTask()]),
    instructionDocuments: [document({ path: "CLAUDE.md" })],
    contextDocuments: [document()],
    availableDocuments: ["docs/ARCHITECTURE.md", "CLAUDE.md"],
    missingDocuments: ["docs/ROADMAP.md"],
    ...overrides,
  };
}

describe("revision d'une tache d'inventaire", () => {
  it("est stable pour un contenu identique", () => {
    assert.equal(inventoryTask().revision, inventoryTask().revision);
  });

  it("change avec le statut", () => {
    // Le cas central : une tache terminee change ce qu'il reste a planifier,
    // meme si sa specification est identique.
    assert.notEqual(
      inventoryTask({ status: "DRAFT" }).revision,
      inventoryTask({ status: "COMPLETED" }).revision,
    );
  });

  it("change avec le titre, l'objectif, la priorite et le code", () => {
    const reference = inventoryTask().revision;
    assert.notEqual(inventoryTask({ title: "Autre" }).revision, reference);
    assert.notEqual(inventoryTask({ objective: "Autre" }).revision, reference);
    assert.notEqual(inventoryTask({ priority: "LOW" }).revision, reference);
    assert.notEqual(inventoryTask({ code: "TASK-002" }).revision, reference);
  });

  it("ne se laisse pas tromper par un deplacement de frontiere", () => {
    // Sans prefixe de longueur, `title="ab" objective="c"` et
    // `title="a" objective="bc"` se concateneraient de la meme facon.
    assert.notEqual(
      inventoryTask({ title: "ab", objective: "c" }).revision,
      inventoryTask({ title: "a", objective: "bc" }).revision,
    );
  });
});

describe("revision de l'inventaire", () => {
  it("change quand une tache est ajoutee", () => {
    assert.notEqual(
      backlogTaskInventoryRevision([inventoryTask()]),
      backlogTaskInventoryRevision([inventoryTask(), inventoryTask({ code: "TASK-002" })]),
    );
  });

  it("change quand une tache est retiree", () => {
    assert.notEqual(
      backlogTaskInventoryRevision([inventoryTask(), inventoryTask({ code: "TASK-002" })]),
      backlogTaskInventoryRevision([inventoryTask()]),
    );
  });

  it("change quand une tache change de statut", () => {
    assert.notEqual(
      backlogTaskInventoryRevision([inventoryTask({ status: "DRAFT" })]),
      backlogTaskInventoryRevision([inventoryTask({ status: "COMPLETED" })]),
    );
  });

  it("change quand l'ordre change", () => {
    const a = inventoryTask({ code: "TASK-001" });
    const b = inventoryTask({ code: "TASK-002" });
    assert.notEqual(backlogTaskInventoryRevision([a, b]), backlogTaskInventoryRevision([b, a]));
  });

  it("distingue un inventaire vide d'un inventaire d'une tache", () => {
    assert.notEqual(backlogTaskInventoryRevision([]), backlogTaskInventoryRevision([inventoryTask()]));
  });
});

describe("revision de la memoire", () => {
  it("change quand une entree est ajoutee", () => {
    assert.notEqual(
      backlogMemoryRevision([memory()]),
      backlogMemoryRevision([memory(), memory({ code: "MEM-002", revision: "mem-2" })]),
    );
  });

  it("change quand une entree est modifiee", () => {
    assert.notEqual(
      backlogMemoryRevision([memory({ revision: "mem-1" })]),
      backlogMemoryRevision([memory({ revision: "mem-2" })]),
    );
  });

  it("distingue une memoire vide d'une memoire d'une entree", () => {
    assert.notEqual(backlogMemoryRevision([]), backlogMemoryRevision([memory()]));
  });
});

describe("empreinte de planification", () => {
  it("est stable pour un contexte identique", () => {
    assert.equal(backlogPlanningFingerprint(base()), backlogPlanningFingerprint(base()));
  });

  it("porte sa version d'algorithme", () => {
    assert.equal(BACKLOG_FINGERPRINT_VERSION, "backlog-context/1");
  });

  it("change quand le brief change", () => {
    assert.notEqual(
      backlogPlanningFingerprint(base()),
      backlogPlanningFingerprint(base({ briefRevision: "brief-2" })),
    );
  });

  it("change quand le plan change", () => {
    assert.notEqual(
      backlogPlanningFingerprint(base()),
      backlogPlanningFingerprint(base({ planRevision: "plan-2" })),
    );
  });

  it("change quand la memoire active change", () => {
    assert.notEqual(
      backlogPlanningFingerprint(base()),
      backlogPlanningFingerprint(base({ memoryRevision: backlogMemoryRevision([]) })),
    );
  });

  it("change quand l'inventaire des taches change", () => {
    assert.notEqual(
      backlogPlanningFingerprint(base()),
      backlogPlanningFingerprint(
        base({
          taskInventoryRevision: backlogTaskInventoryRevision([
            inventoryTask(),
            inventoryTask({ code: "TASK-002" }),
          ]),
        }),
      ),
    );
  });

  it("change quand un document inclus change", () => {
    assert.notEqual(
      backlogPlanningFingerprint(base()),
      backlogPlanningFingerprint(base({ contextDocuments: [document({ content: "# Autre" })] })),
    );
  });

  it("change quand un document inclus est tronque", () => {
    assert.notEqual(
      backlogPlanningFingerprint(base()),
      backlogPlanningFingerprint(base({ contextDocuments: [document({ truncated: true })] })),
    );
  });

  it("change quand l'ordre des documents change", () => {
    const a = document({ path: "docs/A.md" });
    const b = document({ path: "docs/B.md" });
    assert.notEqual(
      backlogPlanningFingerprint(base({ contextDocuments: [a, b] })),
      backlogPlanningFingerprint(base({ contextDocuments: [b, a] })),
    );
  });

  it("ne change pas quand un fichier non inclus change", () => {
    // Un fichier hors de la liste fermee n'entre pas dans le contexte : le
    // declarer perimant serait de la severite gratuite, et l'avertissement
    // finirait par ne plus rien signaler.
    assert.equal(backlogPlanningFingerprint(base()), backlogPlanningFingerprint(base()));
  });

  it("distingue un brief absent d'un brief vide", () => {
    assert.notEqual(
      backlogPlanningFingerprint(base({ briefRevision: null })),
      backlogPlanningFingerprint(base({ briefRevision: "brief-vide" })),
    );
  });

  it("distingue un plan absent d'un plan defini", () => {
    assert.notEqual(
      backlogPlanningFingerprint(base({ planRevision: null })),
      backlogPlanningFingerprint(base()),
    );
  });

  it("change quand la liste fermee des documents change", () => {
    assert.notEqual(
      backlogPlanningFingerprint(base()),
      backlogPlanningFingerprint(base({ availableDocuments: ["docs/ARCHITECTURE.md"] })),
    );
  });

  it("change quand un document attendu disparait du repository", () => {
    assert.notEqual(
      backlogPlanningFingerprint(base()),
      backlogPlanningFingerprint(base({ missingDocuments: [] })),
    );
  });

  it("n'est pas une primitive de securite", () => {
    // SHA-256 nu, comme l'empreinte de contexte de l'Architecte, et
    // contrairement a l'empreinte de dossier de travail, qui est un HMAC parce
    // qu'elle decide d'une execution. Soixante-quatre caracteres hexadecimaux.
    assert.match(backlogPlanningFingerprint(base()), /^[0-9a-f]{64}$/u);
  });
});
