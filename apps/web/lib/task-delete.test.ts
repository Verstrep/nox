import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONFIRMATION_MISMATCH_MESSAGE,
  TASK_DOCUMENT_CONFLICT_MESSAGE,
  TASK_HAS_RUNS_MESSAGE,
  TASK_RUNNING_MESSAGE,
  checkTaskDeletion,
  type TaskDeletionState,
} from "./task-delete.ts";

function state(overrides: Partial<TaskDeletionState> = {}): TaskDeletionState {
  return {
    code: "TASK-001",
    status: "DRAFT",
    documentSyncStatus: "SYNCED",
    runCount: 0,
    ...overrides,
  };
}

describe("checkTaskDeletion - acceptation", () => {
  it("accepte une tache sans execution avec le bon code", () => {
    assert.deepEqual(checkTaskDeletion(state(), "TASK-001"), { ok: true });
  });

  it("tolere les espaces autour du code recopie", () => {
    // Un copier-coller entraine souvent une espace ; la refuser pour cela
    // n'apporterait aucune surete.
    assert.deepEqual(checkTaskDeletion(state(), "  TASK-001  "), { ok: true });
  });

  it("accepte depuis les statuts ou la suppression a un sens", () => {
    for (const status of ["DRAFT", "READY", "BLOCKED", "FAILED", "REVIEW", "COMPLETED"] as const) {
      assert.deepEqual(checkTaskDeletion(state({ status }), "TASK-001"), { ok: true }, status);
    }
  });

  it("accepte une tache dont le document n'a jamais ete cree", () => {
    // `PENDING` et `ERROR` sont precisement les cas ou la tache de test doit
    // pouvoir disparaitre : son document n'existe pas.
    for (const documentSyncStatus of ["PENDING", "ERROR"] as const) {
      assert.deepEqual(
        checkTaskDeletion(state({ documentSyncStatus }), "TASK-001"),
        { ok: true },
        documentSyncStatus,
      );
    }
  });
});

describe("checkTaskDeletion - refus", () => {
  it("refuse une tache possedant une execution", () => {
    assert.deepEqual(checkTaskDeletion(state({ runCount: 1 }), "TASK-001"), {
      ok: false,
      message: TASK_HAS_RUNS_MESSAGE,
    });
  });

  it("refuse quelle que soit l'issue de l'execution", () => {
    // La regle porte sur l'existence d'un historique, jamais sur son resultat :
    // une execution annulee a tout de meme consomme du quota et modifie un
    // repository.
    assert.equal(checkTaskDeletion(state({ runCount: 5 }), "TASK-001").ok, false);
  });

  it("annonce l'archivage plutot qu'un refus sec", () => {
    const result = checkTaskDeletion(state({ runCount: 1 }), "TASK-001");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.message.includes("archivage"));
  });

  it("refuse une tache en cours d'execution", () => {
    assert.deepEqual(checkTaskDeletion(state({ status: "RUNNING" }), "TASK-001"), {
      ok: false,
      message: TASK_RUNNING_MESSAGE,
    });
  });

  it("refuse un document en conflit", () => {
    assert.deepEqual(
      checkTaskDeletion(state({ documentSyncStatus: "CONFLICT" }), "TASK-001"),
      { ok: false, message: TASK_DOCUMENT_CONFLICT_MESSAGE },
    );
  });

  it("refuse un code de confirmation incorrect", () => {
    for (const typed of ["", "TASK-002", "task-001", "TASK001", "TASK-0011"]) {
      assert.deepEqual(
        checkTaskDeletion(state(), typed),
        { ok: false, message: CONFIRMATION_MISMATCH_MESSAGE },
        typed,
      );
    }
  });
});

describe("checkTaskDeletion - ordre des refus", () => {
  it("annonce l'historique avant l'erreur de saisie", () => {
    // Dire a l'utilisateur qu'il a mal recopie un code avant de lui apprendre
    // que la suppression est de toute facon impossible le ferait travailler
    // pour rien.
    assert.deepEqual(checkTaskDeletion(state({ runCount: 1 }), "code-errone"), {
      ok: false,
      message: TASK_HAS_RUNS_MESSAGE,
    });
  });

  it("annonce l'historique avant l'execution en cours", () => {
    assert.deepEqual(
      checkTaskDeletion(state({ runCount: 1, status: "RUNNING" }), "TASK-001"),
      { ok: false, message: TASK_HAS_RUNS_MESSAGE },
    );
  });

  it("annonce le conflit avant l'erreur de saisie", () => {
    assert.deepEqual(
      checkTaskDeletion(state({ documentSyncStatus: "CONFLICT" }), "mauvais"),
      { ok: false, message: TASK_DOCUMENT_CONFLICT_MESSAGE },
    );
  });
});
