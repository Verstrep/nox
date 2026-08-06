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
  isManagedTaskDocumentPath,
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
    // Ajoutees par TASK-008 : une execution peut poser `REVIEW` et `FAILED`,
    // et c'est ensuite l'utilisateur qui tranche.
    ["REVIEW", "COMPLETED"],
    ["REVIEW", "READY"],
    ["FAILED", "READY"],
    ["FAILED", "BLOCKED"],
  ];

  it("autorise exactement les transitions manuelles prevues", () => {
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

  it("reconnait les statuts reserves", () => {
    for (const reserved of RESERVED_TASK_STATUSES) {
      assert.equal(isReservedTaskStatus(reserved), true);
    }
    assert.equal(isReservedTaskStatus("DRAFT"), false);
  });

  it("laisse une tache en cours d'execution sans issue manuelle", () => {
    // Seule la fin du processus peut sortir une tache de `RUNNING` : un clic ne
    // le doit pas, sans quoi NOX afficherait un etat que le processus contredit.
    assert.deepEqual([...allowedTaskStatusTransitions("RUNNING")], []);
  });

  it("propose les transitions attendues depuis chaque statut manuel", () => {
    assert.deepEqual([...allowedTaskStatusTransitions("DRAFT")], ["READY", "BLOCKED"]);
    assert.deepEqual([...allowedTaskStatusTransitions("READY")], ["DRAFT", "BLOCKED", "COMPLETED"]);
    assert.deepEqual([...allowedTaskStatusTransitions("BLOCKED")], ["DRAFT", "READY"]);
    assert.deepEqual([...allowedTaskStatusTransitions("COMPLETED")], ["READY"]);
    assert.deepEqual([...allowedTaskStatusTransitions("REVIEW")], ["COMPLETED", "READY"]);
    assert.deepEqual([...allowedTaskStatusTransitions("FAILED")], ["READY", "BLOCKED"]);
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

describe("isManagedTaskDocumentPath", () => {
  it("reconnait un document de tache", () => {
    assert.equal(isManagedTaskDocumentPath("tasks/TASK-001.md"), true);
    assert.equal(isManagedTaskDocumentPath("tasks/TASK-002.md"), true);
    assert.equal(isManagedTaskDocumentPath("tasks/TASK-1234.md"), true);
  });

  it("reconnait tout chemin que le disque considererait identique", () => {
    // Sous Windows, ces quatre chemins designent le meme fichier. Une
    // comparaison sensible a la casse laisserait donc contourner la protection
    // par une simple variation d'orthographe.
    assert.equal(isManagedTaskDocumentPath("Tasks/TASK-001.md"), true);
    assert.equal(isManagedTaskDocumentPath("tasks/task-001.md"), true);
    assert.equal(isManagedTaskDocumentPath("TASKS/Task-001.MD"), true);
    assert.equal(isManagedTaskDocumentPath("tasks/TASK-001.MD"), true);
  });

  it("protege aussi un document orphelin", () => {
    // Le controle porte sur la forme du chemin, pas sur l'existence d'une
    // tache : NOX ne peut pas savoir si `TASK-999` precede une tache a venir ou
    // en suit une disparue.
    assert.equal(isManagedTaskDocumentPath("tasks/TASK-999.md"), true);
  });

  it("laisse les autres documents de tasks/ ordinaires", () => {
    assert.equal(isManagedTaskDocumentPath("tasks/NOTES.md"), false);
    assert.equal(isManagedTaskDocumentPath("tasks/README.md"), false);
    assert.equal(isManagedTaskDocumentPath("tasks/TASK-01.md"), false);
    assert.equal(isManagedTaskDocumentPath("tasks/TASK-001.txt"), false);
    assert.equal(isManagedTaskDocumentPath("tasks/TASK-001.md.bak"), false);
  });

  it("ne protege rien hors du dossier tasks/", () => {
    assert.equal(isManagedTaskDocumentPath("docs/TASK-001.md"), false);
    assert.equal(isManagedTaskDocumentPath("TASK-001.md"), false);
    assert.equal(isManagedTaskDocumentPath("archive/tasks/TASK-001.md"), false);
    assert.equal(isManagedTaskDocumentPath(""), false);
  });
});
