import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FINAL_RUN_STATUSES,
  RUN_STATUSES,
  TASK_STATUSES,
  boundTail,
  boundText,
  canAutomateTaskStatusTransition,
  formatRunCode,
  isFinalRunStatus,
  isRunnerRunId,
  taskStatusForRunOutcome,
} from "../dist/index.js";

describe("etats finaux d'une execution", () => {
  it("expose les quatre etats finaux", () => {
    assert.deepEqual([...FINAL_RUN_STATUSES], ["BLOCKED", "FAILED", "CANCELLED", "COMPLETED"]);
  });

  it("distingue actif et final", () => {
    assert.equal(isFinalRunStatus("QUEUED"), false);
    assert.equal(isFinalRunStatus("RUNNING"), false);
    for (const status of FINAL_RUN_STATUSES) {
      assert.equal(isFinalRunStatus(status), true, status);
    }
  });

  it("couvre tous les statuts connus", () => {
    for (const status of RUN_STATUSES) {
      // Chaque statut est soit actif, soit final : aucun n'echappe au partage.
      assert.equal(typeof isFinalRunStatus(status), "boolean", status);
    }
  });
});

describe("code d'une execution", () => {
  it("complete le numero sur trois chiffres", () => {
    assert.equal(formatRunCode(1), "RUN-001");
    assert.equal(formatRunCode(42), "RUN-042");
    assert.equal(formatRunCode(1000), "RUN-1000");
  });

  it("refuse un numero qui ne peut pas venir du compteur", () => {
    assert.throws(() => formatRunCode(0), RangeError);
    assert.throws(() => formatRunCode(-1), RangeError);
    assert.throws(() => formatRunCode(2.5), RangeError);
  });
});

describe("identifiant transmis au runner", () => {
  it("accepte un UUID en minuscules", () => {
    assert.equal(isRunnerRunId("3f2504e0-4f89-41d3-9a0c-0305e82c3301"), true);
  });

  it("refuse tout ce qui n'est pas un UUID", () => {
    assert.equal(isRunnerRunId("3F2504E0-4F89-41D3-9A0C-0305E82C3301"), false);
    assert.equal(isRunnerRunId("pas-un-uuid"), false);
    assert.equal(isRunnerRunId("../../etc/passwd"), false);
    assert.equal(isRunnerRunId(""), false);
    assert.equal(isRunnerRunId(42), false);
    assert.equal(isRunnerRunId(null), false);
  });
});

describe("bornes des contenus exterieurs", () => {
  it("laisse intact un contenu sous la limite", () => {
    assert.equal(boundText("abc", 10), "abc");
    assert.equal(boundTail("abc", 10), "abc");
  });

  it("signale explicitement une troncature de debut", () => {
    const bounded = boundText("a".repeat(500), 100);
    assert.ok(bounded.length <= 100);
    assert.ok(bounded.includes("tronque"));
    assert.ok(bounded.startsWith("a"));
  });

  it("conserve la fin d'une sortie d'erreur", () => {
    const bounded = boundTail(`${"a".repeat(500)}CAUSE_REELLE`, 100);
    assert.ok(bounded.length <= 100);
    assert.ok(bounded.includes("CAUSE_REELLE"));
    assert.ok(bounded.includes("tronque"));
  });

  it("supporte une limite plus courte que l'avertissement", () => {
    assert.ok(boundText("a".repeat(100), 5).length <= 5 + "\n[…] Contenu tronque par NOX.".length);
    assert.doesNotThrow(() => boundTail("a".repeat(100), 3));
  });
});

describe("transitions automatisees de tache", () => {
  it("n'autorise que le passage a l'execution depuis READY", () => {
    assert.equal(canAutomateTaskStatusTransition("READY", "RUNNING"), true);
    for (const from of TASK_STATUSES) {
      if (from === "READY") {
        continue;
      }
      assert.equal(canAutomateTaskStatusTransition(from, "RUNNING"), false, from);
    }
  });

  it("n'autorise que les trois issues depuis RUNNING", () => {
    for (const to of ["REVIEW", "FAILED", "BLOCKED"] as const) {
      assert.equal(canAutomateTaskStatusTransition("RUNNING", to), true, to);
    }
    for (const to of ["DRAFT", "READY", "COMPLETED", "RUNNING"] as const) {
      assert.equal(canAutomateTaskStatusTransition("RUNNING", to), false, to);
    }
  });

  it("ne fait jamais passer une tache directement en COMPLETED", () => {
    // Un resultat de Claude Code n'est pas une validation humaine.
    for (const from of TASK_STATUSES) {
      assert.equal(canAutomateTaskStatusTransition(from, "COMPLETED"), false, from);
    }
  });

  it("ne touche a rien depuis un statut qui n'execute pas", () => {
    for (const from of ["DRAFT", "BLOCKED", "FAILED", "REVIEW", "COMPLETED"] as const) {
      for (const to of TASK_STATUSES) {
        assert.equal(canAutomateTaskStatusTransition(from, to), false, `${from} -> ${to}`);
      }
    }
  });
});

describe("issue d'une execution", () => {
  it("une reussite mene a la relecture, jamais a la validation", () => {
    assert.equal(taskStatusForRunOutcome("COMPLETED"), "REVIEW");
  });

  it("un echec mene a FAILED", () => {
    assert.equal(taskStatusForRunOutcome("FAILED"), "FAILED");
  });

  it("un blocage et une annulation menent a BLOCKED", () => {
    assert.equal(taskStatusForRunOutcome("BLOCKED"), "BLOCKED");
    assert.equal(taskStatusForRunOutcome("CANCELLED"), "BLOCKED");
  });

  it("ne conclut rien tant que l'execution est active", () => {
    assert.equal(taskStatusForRunOutcome("QUEUED"), null);
    assert.equal(taskStatusForRunOutcome("RUNNING"), null);
  });
});
