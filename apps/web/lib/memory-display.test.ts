/**
 * Tests de la presentation de la memoire projet.
 *
 * Deux choses y sont verifiees : les fonctions pures d'affichage, et — plus
 * important — le fait qu'aucune operation de memoire ne puisse joindre un
 * fournisseur, le runner, Claude Code, le disque ou Git.
 *
 * Ce second test lit le **source** des modules plutot que leur comportement.
 * C'est volontaire : un appel glisse dans une action de memoire serait
 * invisible a l'execution — la page continuerait de fonctionner — et
 * parfaitement lisible dans le texte.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  PROJECT_MEMORY_LIMITS,
  PROJECT_MEMORY_STATUS,
  type ProjectMemoryEntry,
} from "@nox/shared";

import {
  MEMORY_ARCHIVE_NOTICE,
  MEMORY_PRIVACY_NOTICE,
  filterMemories,
  formatMemorySize,
  isMemoryBudgetTight,
  memoryBudgetRatio,
  memoryEntryUrl,
  memoryRefusalMessage,
  memoryStatusToggle,
  memoryUrl,
  memoryWriteRefusalMessage,
  newMemoryUrl,
  readMemoryFilter,
} from "./memory-display.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function entry(overrides: Partial<ProjectMemoryEntry> = {}): ProjectMemoryEntry {
  return {
    id: "memoire-1",
    projectId: "projet-1",
    sequence: 1,
    code: "MEM-001",
    category: "DECISION",
    title: "Un titre",
    content: "Un contenu.",
    rationale: null,
    status: PROJECT_MEMORY_STATUS.ACTIVE,
    createdAt: "2026-08-12T09:00:00.000Z",
    updatedAt: "2026-08-12T09:00:00.000Z",
    ...overrides,
  };
}

describe("URL", () => {
  it("mene a la memoire d'un projet", () => {
    assert.equal(memoryUrl("projet-1"), "/projects/projet-1/memory");
    assert.equal(newMemoryUrl("projet-1"), "/projects/projet-1/memory/new");
    assert.equal(memoryEntryUrl("projet-1", "m-1"), "/projects/projet-1/memory/m-1");
  });

  it("porte le filtre, sauf quand il est celui par defaut de la liste complete", () => {
    assert.equal(memoryUrl("p", "ALL"), "/projects/p/memory");
    assert.equal(memoryUrl("p", "ACTIVE"), "/projects/p/memory?filter=ACTIVE");
    assert.equal(memoryUrl("p", "ARCHIVED"), "/projects/p/memory?filter=ARCHIVED");
  });
});

describe("readMemoryFilter", () => {
  it("reconnait les trois filtres", () => {
    assert.equal(readMemoryFilter("ACTIVE"), "ACTIVE");
    assert.equal(readMemoryFilter("ARCHIVED"), "ARCHIVED");
    assert.equal(readMemoryFilter("ALL"), "ALL");
  });

  it("retombe sur Active pour toute valeur inconnue", () => {
    // Un lien errone ne doit pas produire une page d'erreur.
    assert.equal(readMemoryFilter("DELETED"), "ACTIVE");
    assert.equal(readMemoryFilter(""), "ACTIVE");
    assert.equal(readMemoryFilter(undefined), "ACTIVE");
    assert.equal(readMemoryFilter(["ACTIVE", "ALL"]), "ACTIVE");
  });
});

describe("filterMemories", () => {
  const entries = [
    entry({ code: "MEM-001" }),
    entry({ id: "m2", code: "MEM-002", status: PROJECT_MEMORY_STATUS.ARCHIVED }),
  ];

  it("ne garde que les actives", () => {
    assert.deepEqual(
      filterMemories(entries, "ACTIVE").map((item) => item.code),
      ["MEM-001"],
    );
  });

  it("ne garde que les archivees", () => {
    assert.deepEqual(
      filterMemories(entries, "ARCHIVED").map((item) => item.code),
      ["MEM-002"],
    );
  });

  it("garde tout sans reordonner", () => {
    assert.deepEqual(
      filterMemories(entries, "ALL").map((item) => item.code),
      ["MEM-001", "MEM-002"],
    );
  });
});

describe("formatMemorySize", () => {
  it("compte en caracteres sous le kibioctet", () => {
    assert.equal(formatMemorySize(0), "0 car.");
    assert.equal(formatMemorySize(842), "842 car.");
  });

  it("passe en Kio au-dela", () => {
    assert.equal(formatMemorySize(1024), "1.0 Kio");
    assert.equal(formatMemorySize(18_842), "18.4 Kio");
  });
});

describe("budget", () => {
  it("borne le ratio entre 0 et 1", () => {
    assert.equal(memoryBudgetRatio(0, 100), 0);
    assert.equal(memoryBudgetRatio(50, 100), 0.5);
    assert.equal(memoryBudgetRatio(500, 100), 1);
    assert.equal(memoryBudgetRatio(10, 0), 0);
  });

  it("signale un budget proche de sa borne", () => {
    assert.equal(isMemoryBudgetTight(89, 100), false);
    assert.equal(isMemoryBudgetTight(90, 100), true);
    assert.equal(isMemoryBudgetTight(100, 100), true);
  });
});

describe("messages de refus", () => {
  it("dit ce qui manque, et quoi faire", () => {
    assert.ok(memoryRefusalMessage({ field: "title", reason: "required" }).includes("titre"));
    assert.ok(memoryRefusalMessage({ field: "content", reason: "required" }).includes("contenu"));
    assert.ok(
      memoryRefusalMessage({ field: "title", reason: "multiline" }).includes("une seule ligne"),
    );
  });

  it("nomme la limite exacte du champ trop long", () => {
    const message = memoryRefusalMessage({ field: "content", reason: "too_long" });
    assert.ok(message.includes(String(PROJECT_MEMORY_LIMITS.content)));
  });

  it("annonce le depassement de budget par son nom, et les trois sorties", () => {
    const message = memoryWriteRefusalMessage("budget", {
      activeChars: 47_000,
      requiredChars: 3_000,
    });

    assert.ok(message.includes("Memory budget exceeded"));
    assert.ok(message.includes("raccourcissez"));
    assert.ok(message.includes("archivez"));
    assert.ok(message.includes("Archived"));
    // Et il dit explicitement qu'aucune troncature n'aura lieu.
    assert.ok(message.includes("jamais une partie seulement"));
  });

  it("distingue le budget du nombre d'entrees", () => {
    const entries = memoryWriteRefusalMessage("entries");
    assert.ok(entries.includes(String(PROJECT_MEMORY_LIMITS.entries)));
    assert.ok(entries.includes("Supprimez"));
    assert.equal(entries.includes("Memory budget exceeded"), false);
  });
});

describe("memoryStatusToggle", () => {
  it("propose d'archiver une entree active", () => {
    const toggle = memoryStatusToggle(PROJECT_MEMORY_STATUS.ACTIVE);
    assert.equal(toggle.label, "Archive");
    assert.equal(toggle.next, PROJECT_MEMORY_STATUS.ARCHIVED);
  });

  it("propose de restaurer une entree archivee", () => {
    const toggle = memoryStatusToggle(PROJECT_MEMORY_STATUS.ARCHIVED);
    assert.equal(toggle.label, "Restore");
    assert.equal(toggle.next, PROJECT_MEMORY_STATUS.ACTIVE);
  });
});

describe("phrases de confidentialite", () => {
  it("dit ce qui part, et surtout quand", () => {
    // « Envoyees a OpenAI » sans la seconde moitie laisserait croire a un envoi
    // permanent, ce qui est faux.
    assert.ok(MEMORY_PRIVACY_NOTICE.includes("OpenAI"));
    assert.ok(MEMORY_PRIVACY_NOTICE.includes("explicitement"));
    assert.ok(MEMORY_PRIVACY_NOTICE.includes("archivees ne quittent jamais"));
  });

  it("dit ce que l'archivage change", () => {
    assert.ok(MEMORY_ARCHIVE_NOTICE.includes("ne sera plus incluse"));
  });
});

describe("aucune operation de memoire ne joint un service exterieur", () => {
  const forbidden = [
    "OpenAIArchitectProvider",
    "analyzeArchitectReview",
    "sendArchitectTurn",
    "generateTaskTurn",
    "runnerFetch",
    "claudePreflight",
    "startClaudeRun",
    "createTaskDocument",
    "updateProjectDocument",
    "deleteProjectDocument",
    "node:child_process",
    "writeFile",
    "execFile",
    "git ",
  ];

  it("le chargeur de memoire n'appelle ni fournisseur, ni runner, ni disque", async () => {
    const source = await readFile(path.join(HERE, "memory.ts"), "utf8");
    for (const needle of forbidden) {
      assert.ok(!source.includes(needle), needle);
    }
  });

  it("les Server Actions de memoire non plus", async () => {
    const source = await readFile(
      path.join(HERE, "..", "app", "projects", "[id]", "memory", "actions.ts"),
      "utf8",
    );
    for (const needle of forbidden) {
      assert.ok(!source.includes(needle), needle);
    }
  });

  it("la couche de persistance non plus", async () => {
    const source = await readFile(
      path.join(HERE, "..", "..", "..", "packages", "database", "src", "project-memory.ts"),
      "utf8",
    );
    for (const needle of forbidden) {
      assert.ok(!source.includes(needle), needle);
    }
  });

  it("le module de presentation reste pur", async () => {
    const source = await readFile(path.join(HERE, "memory-display.ts"), "utf8");
    for (const needle of ["await ", "async ", "fetch(", "process.env", "node:"]) {
      assert.ok(!source.includes(needle), needle);
    }
  });
});
