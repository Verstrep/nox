import {
  RUN_STATUSES,
  TASK_DOCUMENT_SYNC_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  allowedTaskStatusTransitions,
} from "@nox/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  documentSyncStatusLabel,
  runStatusLabel,
  taskPriorityLabel,
  taskStatusLabel,
  taskTransitionLabel,
} from "./labels.ts";

describe("libelles des statuts de tache", () => {
  it("couvre chaque statut", () => {
    for (const status of TASK_STATUSES) {
      assert.ok(taskStatusLabel(status).length > 0, status);
    }
  });

  it("affiche exactement les libelles attendus", () => {
    assert.equal(taskStatusLabel("DRAFT"), "Draft");
    assert.equal(taskStatusLabel("READY"), "Ready");
    assert.equal(taskStatusLabel("RUNNING"), "Running");
    assert.equal(taskStatusLabel("BLOCKED"), "Blocked");
    assert.equal(taskStatusLabel("FAILED"), "Failed");
    assert.equal(taskStatusLabel("REVIEW"), "Review");
    // `Done` et non `Completed` : la page d'une tache affiche aussi des
    // executions, qui ont leur propre `COMPLETED`.
    assert.equal(taskStatusLabel("COMPLETED"), "Done");
  });
});

describe("libelles des statuts d'execution", () => {
  it("affiche exactement les libelles attendus", () => {
    assert.equal(runStatusLabel("QUEUED"), "Queued");
    assert.equal(runStatusLabel("RUNNING"), "Running");
    assert.equal(runStatusLabel("BLOCKED"), "Blocked");
    assert.equal(runStatusLabel("FAILED"), "Failed");
    assert.equal(runStatusLabel("CANCELLED"), "Cancelled");
    assert.equal(runStatusLabel("COMPLETED"), "Completed");
  });

  it("couvre chaque statut", () => {
    for (const status of RUN_STATUSES) {
      assert.ok(runStatusLabel(status).length > 0, status);
    }
  });
});

describe("libelles de synchronisation", () => {
  it("affiche exactement les libelles attendus", () => {
    assert.equal(documentSyncStatusLabel("PENDING"), "Pending");
    assert.equal(documentSyncStatusLabel("SYNCED"), "Synced");
    assert.equal(documentSyncStatusLabel("ERROR"), "Error");
    assert.equal(documentSyncStatusLabel("CONFLICT"), "Conflict");
  });

  it("couvre chaque etat", () => {
    for (const status of TASK_DOCUMENT_SYNC_STATUSES) {
      assert.ok(documentSyncStatusLabel(status).length > 0, status);
    }
  });
});

describe("libelles de priorite", () => {
  it("affiche exactement les libelles attendus", () => {
    assert.equal(taskPriorityLabel("LOW"), "Low");
    assert.equal(taskPriorityLabel("MEDIUM"), "Medium");
    assert.equal(taskPriorityLabel("HIGH"), "High");
    assert.equal(taskPriorityLabel("CRITICAL"), "Critical");
  });

  it("couvre chaque priorite", () => {
    for (const priority of TASK_PRIORITIES) {
      assert.ok(taskPriorityLabel(priority).length > 0, priority);
    }
  });
});

describe("libelles de transition", () => {
  /**
   * Le vrai filet de securite de ce module.
   *
   * `taskTransitionLabel` possede un repli, faute de pouvoir exprimer en
   * TypeScript « uniquement les paires autorisees ». Ce test rend ce repli
   * inatteignable en pratique : toute transition reellement proposee a
   * l'utilisateur doit avoir son libelle explicite, et une transition ajoutee
   * plus tard sans libelle fait echouer la suite.
   */
  it("nomme explicitement chaque transition autorisee", () => {
    for (const from of TASK_STATUSES) {
      for (const to of allowedTaskStatusTransitions(from)) {
        const label = taskTransitionLabel(from, to);
        assert.notEqual(
          label,
          `Set ${taskStatusLabel(to)}`,
          `transition ${from} -> ${to} sans libelle dedie`,
        );
      }
    }
  });

  it("nomme le geste, pas la destination", () => {
    assert.equal(taskTransitionLabel("DRAFT", "READY"), "Mark ready");
    assert.equal(taskTransitionLabel("DRAFT", "BLOCKED"), "Mark blocked");
    assert.equal(taskTransitionLabel("READY", "COMPLETED"), "Mark done");
    assert.equal(taskTransitionLabel("READY", "DRAFT"), "Back to draft");
    assert.equal(taskTransitionLabel("COMPLETED", "READY"), "Reopen");
    // Deux transitions vers `COMPLETED`, deux gestes differents : accepter un
    // travail relu n'est pas cocher une case.
    assert.equal(taskTransitionLabel("REVIEW", "COMPLETED"), "Approve");
    assert.equal(taskTransitionLabel("REVIEW", "READY"), "Reopen");
    assert.equal(taskTransitionLabel("FAILED", "READY"), "Retry");
  });

  it("n'invente aucune transition depuis une execution en cours", () => {
    assert.deepEqual(allowedTaskStatusTransitions("RUNNING"), []);
  });
});

describe("valeurs internes", () => {
  /**
   * Garde-fou explicite : TASK-009 change des libelles, jamais des valeurs. Une
   * valeur renommee casserait la base, les contrats et les documents deja
   * generes.
   */
  it("laisse les identifiants inchanges", () => {
    assert.deepEqual([...TASK_STATUSES], [
      "DRAFT",
      "READY",
      "RUNNING",
      "BLOCKED",
      "FAILED",
      "REVIEW",
      "COMPLETED",
    ]);
    // `CANCELLING` est ajoute par TASK-010 ; aucune valeur existante ne bouge.
    assert.deepEqual([...RUN_STATUSES], [
      "QUEUED",
      "RUNNING",
      "CANCELLING",
      "BLOCKED",
      "FAILED",
      "CANCELLED",
      "COMPLETED",
    ]);
    assert.deepEqual([...TASK_PRIORITIES], ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
    assert.deepEqual([...TASK_DOCUMENT_SYNC_STATUSES], [
      "PENDING",
      "SYNCED",
      "ERROR",
      "CONFLICT",
    ]);
  });
});
