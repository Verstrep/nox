import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Le package compile est importe volontairement : c'est l'artefact que
// consomment `apps/web` et `apps/runner`.
import {
  RESERVED_TASK_STATUSES,
  TASK_DOCUMENT_SYNC_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  allowedTaskStatusTransitions,
  canTransitionTaskStatus,
  formatTaskCode,
  isReservedTaskStatus,
  isTaskCode,
  isTaskDocumentSyncStatus,
  isTaskPriority,
  taskDocumentPath,
  taskPriorityRank,
  type TaskStatus,
} from "../dist/index.js";

describe("priorites", () => {
  it("expose les quatre niveaux", () => {
    assert.deepEqual([...TASK_PRIORITIES], ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  });

  it("reconnait une priorite valide et refuse le reste", () => {
    assert.equal(isTaskPriority("HIGH"), true);
    assert.equal(isTaskPriority("URGENT"), false);
    assert.equal(isTaskPriority("high"), false);
    assert.equal(isTaskPriority(3), false);
    assert.equal(isTaskPriority(null), false);
  });

  it("ordonne les priorites de la plus urgente a la moins urgente", () => {
    assert.ok(taskPriorityRank("CRITICAL") > taskPriorityRank("HIGH"));
    assert.ok(taskPriorityRank("HIGH") > taskPriorityRank("MEDIUM"));
    assert.ok(taskPriorityRank("MEDIUM") > taskPriorityRank("LOW"));
  });
});

describe("etats de synchronisation", () => {
  it("expose les quatre etats", () => {
    assert.deepEqual([...TASK_DOCUMENT_SYNC_STATUSES], ["PENDING", "SYNCED", "ERROR", "CONFLICT"]);
  });

  it("refuse une valeur inconnue", () => {
    assert.equal(isTaskDocumentSyncStatus("SYNCED"), true);
    assert.equal(isTaskDocumentSyncStatus("STALE"), false);
  });
});

describe("transitions de statut", () => {
  const ALLOWED: readonly (readonly [TaskStatus, TaskStatus])[] = [
    ["DRAFT", "READY"],
    ["DRAFT", "BLOCKED"],
    ["READY", "DRAFT"],
    ["READY", "BLOCKED"],
    ["READY", "COMPLETED"],
    ["BLOCKED", "DRAFT"],
    ["BLOCKED", "READY"],
    ["COMPLETED", "READY"],
  ];

  it("autorise exactement les huit transitions manuelles prevues", () => {
    for (const [from, to] of ALLOWED) {
      assert.equal(canTransitionTaskStatus(from, to), true, `${from} -> ${to} devrait etre permis`);
    }

    const allowedKeys = new Set(ALLOWED.map(([from, to]) => `${from}->${to}`));
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        if (allowedKeys.has(`${from}->${to}`)) {
          continue;
        }
        assert.equal(
          canTransitionTaskStatus(from, to),
          false,
          `${from} -> ${to} ne devrait pas etre permis`,
        );
      }
    }
  });

  it("refuse le passage d'un statut a lui-meme", () => {
    for (const status of TASK_STATUSES) {
      assert.equal(canTransitionTaskStatus(status, status), false);
    }
  });

  it("n'autorise jamais d'atteindre un statut reserve", () => {
    for (const from of TASK_STATUSES) {
      for (const reserved of RESERVED_TASK_STATUSES) {
        assert.equal(canTransitionTaskStatus(from, reserved), false);
      }
    }
  });

  it("laisse les statuts reserves sans issue manuelle", () => {
    for (const reserved of RESERVED_TASK_STATUSES) {
      assert.deepEqual([...allowedTaskStatusTransitions(reserved)], []);
      assert.equal(isReservedTaskStatus(reserved), true);
    }
    assert.equal(isReservedTaskStatus("DRAFT"), false);
  });

  it("propose les transitions attendues depuis chaque statut manuel", () => {
    assert.deepEqual([...allowedTaskStatusTransitions("DRAFT")], ["READY", "BLOCKED"]);
    assert.deepEqual([...allowedTaskStatusTransitions("READY")], ["DRAFT", "BLOCKED", "COMPLETED"]);
    assert.deepEqual([...allowedTaskStatusTransitions("BLOCKED")], ["DRAFT", "READY"]);
    assert.deepEqual([...allowedTaskStatusTransitions("COMPLETED")], ["READY"]);
  });
});

describe("code d'une tache", () => {
  it("complete le numero sur trois chiffres", () => {
    assert.equal(formatTaskCode(1), "TASK-001");
    assert.equal(formatTaskCode(42), "TASK-042");
    assert.equal(formatTaskCode(999), "TASK-999");
  });

  it("ne tronque pas au-dela de trois chiffres", () => {
    assert.equal(formatTaskCode(1000), "TASK-1000");
    assert.equal(formatTaskCode(12345), "TASK-12345");
  });

  it("refuse un numero qui ne peut pas venir du compteur", () => {
    assert.throws(() => formatTaskCode(0), RangeError);
    assert.throws(() => formatTaskCode(-3), RangeError);
    assert.throws(() => formatTaskCode(1.5), RangeError);
    assert.throws(() => formatTaskCode(Number.NaN), RangeError);
  });

  it("reconnait un code valide", () => {
    assert.equal(isTaskCode("TASK-001"), true);
    assert.equal(isTaskCode("TASK-1000"), true);
  });

  it("refuse tout ce qui pourrait designer un autre fichier", () => {
    assert.equal(isTaskCode("TASK-1"), false);
    assert.equal(isTaskCode("TASK-01"), false);
    assert.equal(isTaskCode("task-001"), false);
    assert.equal(isTaskCode("TASK-001.md"), false);
    assert.equal(isTaskCode("TASK-001/../secret"), false);
    assert.equal(isTaskCode("../TASK-001"), false);
    assert.equal(isTaskCode("TASK-001 "), false);
    assert.equal(isTaskCode(""), false);
    assert.equal(isTaskCode(42), false);
    assert.equal(isTaskCode(null), false);
  });

  it("derive un chemin stable, sans le titre", () => {
    assert.equal(taskDocumentPath("TASK-001"), "tasks/TASK-001.md");
    assert.equal(taskDocumentPath(formatTaskCode(7)), "tasks/TASK-007.md");
  });
});
