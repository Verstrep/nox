/**
 * Ce qu'un replan peut toucher, et ce qui lui est ferme.
 *
 * La regle testee ici est la plus importante de TASK-032, et c'est une regle
 * d'**inclusion stricte** : tout ce que l'editeur de tache future refuse, le
 * replan le refuse aussi. Le test qui compte le plus est donc celui qui compare
 * les deux, pour qu'un assouplissement de l'un ne puisse pas se glisser dans
 * l'autre.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REPLAN_LOCK_REASON,
  REPLAN_UNAVAILABLE,
  TASK_KIND,
  TASK_STATUS,
  TASK_STATUSES,
  checkTaskEditable,
  classifyReplanTask,
  classifyReplanTasks,
  lockedTaskIsHistorical,
  replanAvailability,
  type ReplanTaskFacts,
} from "../dist/index.js";

function facts(overrides: Partial<ReplanTaskFacts> = {}): ReplanTaskFacts {
  return {
    id: "t-006",
    code: "TASK-006",
    kind: TASK_KIND.NORMAL,
    status: TASK_STATUS.READY,
    runCount: 0,
    queued: false,
    ...overrides,
  };
}

describe("classification d'une tache", () => {
  it("accepte une tache future neuve", () => {
    for (const status of [TASK_STATUS.DRAFT, TASK_STATUS.READY]) {
      const classified = classifyReplanTask(facts({ status }));
      assert.equal(classified.editable, true, status);
      assert.equal(classified.lockReason, null);
    }
  });

  it("verrouille la tache d'amorcage, quel que soit son etat", () => {
    for (const status of TASK_STATUSES) {
      const classified = classifyReplanTask(facts({ kind: TASK_KIND.BOOTSTRAP, status }));
      assert.equal(classified.editable, false, status);
      assert.equal(classified.lockReason, REPLAN_LOCK_REASON.BOOTSTRAP);
    }
  });

  it("verrouille une tache qui a deja tourne, meme rouverte", () => {
    // Le cas qui justifie `runCount` plutot que le statut : une tache passee en
    // echec puis rouverte est `READY` avec un historique. Son passe la fige.
    const classified = classifyReplanTask(facts({ status: TASK_STATUS.READY, runCount: 1 }));
    assert.equal(classified.editable, false);
    assert.equal(classified.lockReason, REPLAN_LOCK_REASON.STARTED);
  });

  it("verrouille une tache inscrite en file", () => {
    const classified = classifyReplanTask(facts({ queued: true }));
    assert.equal(classified.editable, false);
    assert.equal(classified.lockReason, REPLAN_LOCK_REASON.QUEUED);
  });

  it("verrouille tout statut d'apres execution", () => {
    for (const status of [
      TASK_STATUS.RUNNING,
      TASK_STATUS.REVIEW,
      TASK_STATUS.COMPLETED,
      TASK_STATUS.FAILED,
      TASK_STATUS.BLOCKED,
    ]) {
      const classified = classifyReplanTask(facts({ status }));
      assert.equal(classified.editable, false, status);
    }
  });

  it("n'est jamais plus permissif que l'editeur de tache future", () => {
    // La garantie centrale. Elle est verifiee par balayage, pas par confiance :
    // toute tache que le replan croit modifiable doit passer `checkTaskEditable`.
    for (const status of TASK_STATUSES) {
      for (const runCount of [0, 1, 7]) {
        for (const queued of [false, true]) {
          for (const kind of [TASK_KIND.NORMAL, TASK_KIND.BOOTSTRAP]) {
            const state = facts({ status, runCount, queued, kind });
            const classified = classifyReplanTask(state);
            if (classified.editable) {
              assert.ok(
                checkTaskEditable({ status, runCount }).ok,
                `${kind}/${status}/${String(runCount)}/${String(queued)}`,
              );
              assert.equal(queued, false);
              assert.equal(kind, TASK_KIND.NORMAL);
            }
          }
        }
      }
    }
  });

  it("conserve l'ordre recu", () => {
    const classified = classifyReplanTasks([
      facts({ id: "a", code: "TASK-002" }),
      facts({ id: "b", code: "TASK-001" }),
    ]);
    assert.deepEqual(
      classified.map((entry) => entry.code),
      ["TASK-002", "TASK-001"],
    );
  });
});

describe("travail historique", () => {
  it("distingue une tache qui a produit du travail d'une tache mise de cote", () => {
    assert.equal(lockedTaskIsHistorical(facts({ status: TASK_STATUS.COMPLETED })), true);
    assert.equal(lockedTaskIsHistorical(facts({ runCount: 1 })), true);
    assert.equal(lockedTaskIsHistorical(facts({ status: TASK_STATUS.BLOCKED })), false);
  });
});

describe("disponibilite de la replanification", () => {
  it("refuse un projet qui n'a jamais eu de backlog applique", () => {
    // Le replan n'est pas un second chemin de planification initiale : sans quoi
    // NOX aurait deux facons de creer son premier plan.
    const availability = replanAvailability({ appliedBacklogCount: 0 });
    assert.equal(availability.available, false);
    assert.equal(
      availability.available ? null : availability.code,
      REPLAN_UNAVAILABLE.NO_INITIAL_PLAN,
    );
  });

  it("autorise un projet deja planifie, meme entierement termine", () => {
    // Ce qui compte n'est pas qu'il reste du travail, c'est qu'un plan ait
    // existe : le replan y ajoutera de nouvelles taches futures.
    assert.equal(replanAvailability({ appliedBacklogCount: 1 }).available, true);
  });
});
