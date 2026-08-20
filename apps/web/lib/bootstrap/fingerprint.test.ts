/**
 * Empreintes du contexte d'amorcage.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'elles sont deterministes, et qu'elles changent des que change **ce qui
 * decide de la tache** : le brief, le plan, la memoire active, l'inventaire des
 * taches, et l'etat constate du repository.
 *
 * Et qu'une absence n'est pas une valeur vide. « Pas de brief » et « un brief
 * qui ne dit rien » ne produisent pas la meme tache, donc pas la meme empreinte.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ArchitectPromptMemory, RepositoryInspection } from "@nox/shared";

import {
  BOOTSTRAP_FINGERPRINT_VERSION,
  bootstrapFingerprint,
  bootstrapMemoryRevision,
  bootstrapTaskInventoryRevision,
  repositoryInspectionRevision,
  type BootstrapFingerprintInput,
} from "./fingerprint.ts";

const INSPECTION: RepositoryInspection = {
  manifests: ["package.json"],
  sourceDirectories: ["src"],
  foundationalDocuments: ["README.md"],
  hasCommits: true,
  rootEntryCount: 8,
  rootEntryCountTruncated: false,
};

const MEMORY: ArchitectPromptMemory = {
  code: "MEM-001",
  category: "DECISION",
  revision: "mem-rev-1",
  title: "SQLite",
  content: "Le stockage local suffit.",
  rationale: null,
};

const TASK = {
  code: "TASK-001",
  title: "Poser le domaine",
  status: "DRAFT",
  priority: "HIGH",
  objective: "Un repas se cree.",
};

function base(overrides: Partial<BootstrapFingerprintInput> = {}): BootstrapFingerprintInput {
  return {
    briefRevision: "brief-1",
    planRevision: "plan-1",
    memoryRevision: bootstrapMemoryRevision([MEMORY]),
    taskInventoryRevision: bootstrapTaskInventoryRevision([TASK]),
    inspectionRevision: repositoryInspectionRevision(INSPECTION),
    specVersion: "bootstrap/1",
    ...overrides,
  };
}

describe("forme", () => {
  it("rend une empreinte SHA-256 hexadecimale", () => {
    assert.match(bootstrapFingerprint(base()), /^[0-9a-f]{64}$/u);
  });

  it("declare sa version", () => {
    assert.equal(BOOTSTRAP_FINGERPRINT_VERSION, "bootstrap-context/1");
  });
});

describe("determinisme", () => {
  it("rend deux fois la meme valeur pour la meme entree", () => {
    assert.equal(bootstrapFingerprint(base()), bootstrapFingerprint(base()));
  });

  it("ne lit ni horloge, ni aleatoire", () => {
    const first = bootstrapFingerprint(base());
    const second = bootstrapFingerprint(base());
    assert.equal(first, second);
  });
});

describe("ce qui rend une empreinte differente", () => {
  const reference = bootstrapFingerprint(base());

  it("un brief modifie", () => {
    assert.notEqual(bootstrapFingerprint(base({ briefRevision: "brief-2" })), reference);
  });

  it("un plan modifie", () => {
    assert.notEqual(bootstrapFingerprint(base({ planRevision: "plan-2" })), reference);
  });

  it("une memoire modifiee", () => {
    assert.notEqual(
      bootstrapFingerprint(base({ memoryRevision: bootstrapMemoryRevision([]) })),
      reference,
    );
  });

  it("un inventaire de taches modifie", () => {
    assert.notEqual(
      bootstrapFingerprint(base({ taskInventoryRevision: bootstrapTaskInventoryRevision([]) })),
      reference,
    );
  });

  it("un repository modifie", () => {
    assert.notEqual(
      bootstrapFingerprint(
        base({
          inspectionRevision: repositoryInspectionRevision({
            ...INSPECTION,
            manifests: [],
            sourceDirectories: [],
          }),
        }),
      ),
      reference,
    );
  });

  it("une version de constructeur modifiee", () => {
    // Un texte de tache different est un contexte different : l'apercu lu ne
    // decrirait plus la tache creee.
    assert.notEqual(bootstrapFingerprint(base({ specVersion: "bootstrap/2" })), reference);
  });
});

describe("absence et vide ne se confondent pas", () => {
  it("distingue un brief absent d'un brief vide", () => {
    const absent = bootstrapFingerprint(base({ briefRevision: null }));
    const vide = bootstrapFingerprint(base({ briefRevision: "" }));
    assert.notEqual(absent, vide);
  });

  it("distingue un plan absent d'un plan vide", () => {
    assert.notEqual(
      bootstrapFingerprint(base({ planRevision: null })),
      bootstrapFingerprint(base({ planRevision: "" })),
    );
  });
});

describe("revision de l'inspection", () => {
  it("change avec un manifeste apparu", () => {
    assert.notEqual(
      repositoryInspectionRevision(INSPECTION),
      repositoryInspectionRevision({ ...INSPECTION, manifests: ["package.json", "go.mod"] }),
    );
  });

  it("change avec un dossier de code apparu", () => {
    assert.notEqual(
      repositoryInspectionRevision(INSPECTION),
      repositoryInspectionRevision({ ...INSPECTION, sourceDirectories: ["src", "lib"] }),
    );
  });

  it("change avec un document fondamental apparu", () => {
    assert.notEqual(
      repositoryInspectionRevision(INSPECTION),
      repositoryInspectionRevision({
        ...INSPECTION,
        foundationalDocuments: ["README.md", "CLAUDE.md"],
      }),
    );
  });

  it("change quand le repository passe de vide a peuple", () => {
    assert.notEqual(
      repositoryInspectionRevision({ ...INSPECTION, rootEntryCount: 0 }),
      repositoryInspectionRevision({ ...INSPECTION, rootEntryCount: 3 }),
    );
  });

  it("change avec l'apparition d'un premier commit", () => {
    assert.notEqual(
      repositoryInspectionRevision({ ...INSPECTION, hasCommits: false }),
      repositoryInspectionRevision({ ...INSPECTION, hasCommits: true }),
    );
  });

  it("distingue un comptage exact d'un comptage tronque", () => {
    assert.notEqual(
      repositoryInspectionRevision({ ...INSPECTION, rootEntryCountTruncated: false }),
      repositoryInspectionRevision({ ...INSPECTION, rootEntryCountTruncated: true }),
    );
  });

  it("ne change pas quand rien ne change", () => {
    assert.equal(repositoryInspectionRevision(INSPECTION), repositoryInspectionRevision(INSPECTION));
  });
});

describe("revision de l'inventaire", () => {
  it("change avec un statut de tache", () => {
    assert.notEqual(
      bootstrapTaskInventoryRevision([TASK]),
      bootstrapTaskInventoryRevision([{ ...TASK, status: "COMPLETED" }]),
    );
  });

  it("change avec l'ordre des taches", () => {
    const second = { ...TASK, code: "TASK-002" };
    assert.notEqual(
      bootstrapTaskInventoryRevision([TASK, second]),
      bootstrapTaskInventoryRevision([second, TASK]),
    );
  });

  it("distingue une liste vide d'une liste d'une tache vide", () => {
    assert.notEqual(
      bootstrapTaskInventoryRevision([]),
      bootstrapTaskInventoryRevision([
        { code: "", title: "", status: "", priority: "", objective: "" },
      ]),
    );
  });

  it("ne confond pas deux decoupages de meme concatenation", () => {
    // Sans prefixe de longueur, `["ab","c"]` et `["a","bc"]` se confondraient.
    assert.notEqual(
      bootstrapTaskInventoryRevision([{ ...TASK, title: "ab", objective: "c" }]),
      bootstrapTaskInventoryRevision([{ ...TASK, title: "a", objective: "bc" }]),
    );
  });
});

describe("revision de la memoire", () => {
  it("change quand une entree est ajoutee", () => {
    assert.notEqual(bootstrapMemoryRevision([]), bootstrapMemoryRevision([MEMORY]));
  });

  it("change quand une revision d'entree change", () => {
    assert.notEqual(
      bootstrapMemoryRevision([MEMORY]),
      bootstrapMemoryRevision([{ ...MEMORY, revision: "mem-rev-2" }]),
    );
  });

  it("change avec l'ordre", () => {
    const second = { ...MEMORY, code: "MEM-002", revision: "mem-rev-2" };
    assert.notEqual(
      bootstrapMemoryRevision([MEMORY, second]),
      bootstrapMemoryRevision([second, MEMORY]),
    );
  });
});
