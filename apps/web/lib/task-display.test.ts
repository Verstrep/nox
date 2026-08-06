import { TASK_STATUSES, type DevelopmentTaskSummary } from "@nox/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { backlogUrl, countTasksByStatus, readStatusFilter, taskUrl } from "./task-display.ts";

function summary(overrides: Partial<DevelopmentTaskSummary> = {}): DevelopmentTaskSummary {
  return {
    id: "t1",
    code: "TASK-001",
    title: "Une tache",
    status: "DRAFT",
    priority: "MEDIUM",
    documentSyncStatus: "SYNCED",
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    ...overrides,
  };
}

describe("countTasksByStatus", () => {
  it("retourne zero pour chaque statut sur un backlog vide", () => {
    const counts = countTasksByStatus([]);

    for (const status of TASK_STATUSES) {
      assert.equal(counts[status], 0, status);
    }
  });

  it("compte les taches par statut", () => {
    const counts = countTasksByStatus([
      summary({ id: "a", status: "DRAFT" }),
      summary({ id: "b", status: "READY" }),
      summary({ id: "c", status: "READY" }),
      summary({ id: "d", status: "BLOCKED" }),
    ]);

    assert.equal(counts.DRAFT, 1);
    assert.equal(counts.READY, 2);
    assert.equal(counts.BLOCKED, 1);
    assert.equal(counts.COMPLETED, 0);
    // Les statuts reserves restent presents, a zero : l'appelant n'a pas a
    // distinguer « aucune » de « inconnu ».
    assert.equal(counts.RUNNING, 0);
  });
});

describe("readStatusFilter", () => {
  it("accepte un statut connu", () => {
    for (const status of TASK_STATUSES) {
      assert.equal(readStatusFilter(status), status);
    }
  });

  it("ignore une valeur inconnue plutot que de lever", () => {
    assert.equal(readStatusFilter("ARCHIVED"), null);
    assert.equal(readStatusFilter("ready"), null);
    assert.equal(readStatusFilter(""), null);
    assert.equal(readStatusFilter("<script>"), null);
  });

  it("ignore un parametre absent ou repete", () => {
    assert.equal(readStatusFilter(undefined), null);
    assert.equal(readStatusFilter(["READY", "DRAFT"]), null);
  });
});

describe("URL", () => {
  it("construit l'URL du backlog, filtre ou non", () => {
    assert.equal(backlogUrl("p1"), "/projects/p1/tasks");
    assert.equal(backlogUrl("p1", "READY"), "/projects/p1/tasks?status=READY");
  });

  it("construit l'URL d'une tache", () => {
    assert.equal(taskUrl("p1", "t1"), "/projects/p1/tasks/t1");
  });
});
