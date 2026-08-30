/**
 * Ce que le fournisseur voit du plan, et ce que NOX refuse plutot que de couper.
 *
 * Le test central de ce fichier est celui du budget : une tache modifiable ne
 * disparait **jamais** du contexte. Un plan cible concu sur une liste amputee
 * supprimerait les taches absentes en pretendant les avoir examinees.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMAND_EXECUTION_MODE,
  REPLAN_LOCK_REASON,
  REPLAN_UNAVAILABLE,
  TASK_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
  VERIFICATION_MODE,
} from "@nox/shared";
import type { ReplanStateTask } from "@nox/database";

import {
  REPLAN_CONTEXT_ERROR,
  REPLAN_CONTEXT_LIMITS,
  buildReplanPlanningContext,
} from "./planning-context.ts";

const IDENTITY = (value: string): string => value;

function editable(code: string, overrides: Partial<ReplanStateTask> = {}): ReplanStateTask {
  const id = `id-${code}`;
  return {
    classified: {
      id,
      code,
      kind: TASK_KIND.NORMAL,
      status: TASK_STATUS.READY,
      runCount: 0,
      queued: false,
      editable: true,
      lockReason: null,
    },
    title: `Titre de ${code}`,
    objective: `Objectif de ${code}`,
    priority: TASK_PRIORITY.MEDIUM,
    status: TASK_STATUS.READY,
    dependsOnCodes: [],
    dependsOnTaskIds: [],
    planningOrder: null,
    context: null,
    outOfScope: null,
    documentReferences: [],
    contract: {
      title: `Titre de ${code}`,
      objective: `Objectif de ${code}`,
      context: null,
      outOfScope: null,
      priority: TASK_PRIORITY.MEDIUM,
      acceptanceCriteria: [
        {
          text: "Le resultat est visible.",
          verificationMode: VERIFICATION_MODE.HUMAN,
          humanInstructions: "Ouvrir la page.",
          commandPositions: [],
        },
      ],
      documentReferences: [],
      validationCommands: [
        { command: "npm run test", executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY },
      ],
      dependsOnTaskIds: [],
    },
    ...overrides,
  };
}

function locked(code: string, overrides: Partial<ReplanStateTask> = {}): ReplanStateTask {
  const id = `id-${code}`;
  return {
    classified: {
      id,
      code,
      kind: TASK_KIND.NORMAL,
      status: TASK_STATUS.COMPLETED,
      runCount: 1,
      queued: false,
      editable: false,
      lockReason: REPLAN_LOCK_REASON.STARTED,
    },
    title: `Titre de ${code}`,
    objective: `Objectif de ${code}`,
    priority: TASK_PRIORITY.MEDIUM,
    status: TASK_STATUS.COMPLETED,
    dependsOnCodes: [],
    dependsOnTaskIds: [],
    planningOrder: null,
    context: null,
    outOfScope: null,
    documentReferences: [],
    contract: null,
    ...overrides,
  };
}

function build(tasks: readonly ReplanStateTask[], appliedBacklogCount = 1) {
  return buildReplanPlanningContext({
    tasks,
    appliedBacklogCount,
    briefRevision: "a".repeat(64),
    planRevision: "b".repeat(64),
    sanitize: IDENTITY,
  });
}

describe("disponibilite", () => {
  it("refuse un projet sans backlog initial applique", () => {
    const result = build([editable("TASK-006")], 0);
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, REPLAN_UNAVAILABLE.NO_INITIAL_PLAN);
  });
});

describe("ce qui part au fournisseur", () => {
  it("separe les taches verrouillees des taches modifiables", () => {
    const result = build([locked("TASK-003"), editable("TASK-006")]);
    assert.ok(result.ok);
    assert.deepEqual(
      result.bundle.promptState.locked.map((task) => task.code),
      ["TASK-003"],
    );
    assert.deepEqual(
      result.bundle.promptState.editable.map((task) => task.code),
      ["TASK-006"],
    );
  });

  it("transmet le contrat complet d'une tache modifiable", () => {
    const result = build([editable("TASK-006")]);
    assert.ok(result.ok);
    const task = result.bundle.promptState.editable[0];
    assert.equal(task?.objective, "Objectif de TASK-006");
    assert.equal(task?.criteria.length, 1);
    assert.equal(task?.commands.length, 1);
  });

  it("ne transmet qu'un resume d'une tache verrouillee", () => {
    const long = "x".repeat(REPLAN_CONTEXT_LIMITS.lockedObjectiveChars + 200);
    const result = build([locked("TASK-003", { objective: long })]);
    assert.ok(result.ok);
    const task = result.bundle.promptState.locked[0];
    assert.ok((task?.objective?.length ?? 0) <= REPLAN_CONTEXT_LIMITS.lockedObjectiveChars);
  });

  it("nomme la raison du verrouillage", () => {
    const result = build([
      locked("TASK-003"),
      locked("TASK-004", {
        classified: {
          id: "id-TASK-004",
          code: "TASK-004",
          kind: TASK_KIND.NORMAL,
          status: TASK_STATUS.READY,
          runCount: 0,
          queued: true,
          editable: false,
          lockReason: REPLAN_LOCK_REASON.QUEUED,
        },
      }),
    ]);
    assert.ok(result.ok);
    assert.deepEqual(
      result.bundle.promptState.locked.map((task) => task.lockReason),
      [REPLAN_LOCK_REASON.STARTED, REPLAN_LOCK_REASON.QUEUED],
    );
  });

  it("traite comme verrouillee une tache modifiable dont le contrat manque", () => {
    // Le defaut sur : mieux vaut ne pas pouvoir la replanifier que la
    // replanifier sur un contrat qu'on n'a pas vu.
    const result = build([editable("TASK-006", { contract: null })]);
    assert.ok(result.ok);
    assert.equal(result.bundle.promptState.editable.length, 0);
    assert.equal(result.bundle.promptState.locked.length, 1);
    assert.equal(result.bundle.source.editable.length, 0);
  });
});

describe("budget", () => {
  it("ne retire jamais une tache modifiable pour tenir", () => {
    // La regle centrale. Elle est verifiee par l'absurde : si le budget est
    // depasse, le resultat est un refus — jamais une liste plus courte.
    const huge = Array.from({ length: 40 }, (_unused, index) =>
      editable(`TASK-${String(100 + index)}`, {
        contract: {
          ...editable(`TASK-${String(100 + index)}`).contract!,
          objective: "y".repeat(6_000),
        },
      }),
    );

    const result = build(huge);
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, REPLAN_CONTEXT_ERROR.CONTEXT_TOO_LARGE);
  });

  it("laisse ceder la queue de l'inventaire verrouille, et l'annonce", () => {
    const many = Array.from({ length: REPLAN_CONTEXT_LIMITS.lockedTasks + 5 }, (_unused, index) =>
      locked(`TASK-${String(200 + index)}`),
    );

    const result = build(many);
    assert.ok(result.ok);
    assert.equal(result.bundle.promptState.locked.length, REPLAN_CONTEXT_LIMITS.lockedTasks);
    assert.equal(result.bundle.promptState.omittedLocked, 5);
  });

  it("garde toutes les taches dans l'etat source, meme non montrees", () => {
    // Une reference vers une tache verrouillee ancienne doit se resoudre plutot
    // que d'echouer : elle existe, elle est simplement absente de l'inventaire.
    const many = Array.from({ length: REPLAN_CONTEXT_LIMITS.lockedTasks + 5 }, (_unused, index) =>
      locked(`TASK-${String(200 + index)}`),
    );

    const result = build(many);
    assert.ok(result.ok);
    assert.equal(result.bundle.source.locked.length, many.length);
  });
});

describe("empreinte", () => {
  it("ne depend pas de l'ordre de deux lectures identiques", () => {
    const tasks = [locked("TASK-003"), editable("TASK-006")];
    const first = build(tasks);
    const second = build([...tasks]);
    assert.ok(first.ok && second.ok);
    assert.equal(first.bundle.planningFingerprint, second.bundle.planningFingerprint);
  });

  it("change quand une tache passe de modifiable a verrouillee", () => {
    const free = build([editable("TASK-006")]);
    const queued = build([
      editable("TASK-006", {
        classified: {
          id: "id-TASK-006",
          code: "TASK-006",
          kind: TASK_KIND.NORMAL,
          status: TASK_STATUS.READY,
          runCount: 0,
          queued: true,
          editable: false,
          lockReason: REPLAN_LOCK_REASON.QUEUED,
        },
      }),
    ]);
    assert.ok(free.ok && queued.ok);
    assert.notEqual(free.bundle.planningFingerprint, queued.bundle.planningFingerprint);
  });

  it("change quand un contrat change", () => {
    const before = build([editable("TASK-006")]);
    const after = build([
      editable("TASK-006", {
        contract: { ...editable("TASK-006").contract!, objective: "Autre objectif." },
      }),
    ]);
    assert.ok(before.ok && after.ok);
    assert.notEqual(before.bundle.planningFingerprint, after.bundle.planningFingerprint);
  });

  it("change quand l'ordre de planification change", () => {
    const before = build([editable("TASK-006", { planningOrder: 0 })]);
    const after = build([editable("TASK-006", { planningOrder: 3 })]);
    assert.ok(before.ok && after.ok);
    assert.notEqual(before.bundle.planningFingerprint, after.bundle.planningFingerprint);
  });

  it("change quand une execution apparait", () => {
    const before = build([editable("TASK-006")]);
    const after = build([
      editable("TASK-006", {
        classified: {
          id: "id-TASK-006",
          code: "TASK-006",
          kind: TASK_KIND.NORMAL,
          status: TASK_STATUS.RUNNING,
          runCount: 1,
          queued: false,
          editable: false,
          lockReason: REPLAN_LOCK_REASON.STARTED,
        },
      }),
    ]);
    assert.ok(before.ok && after.ok);
    assert.notEqual(before.bundle.planningFingerprint, after.bundle.planningFingerprint);
  });

  it("change quand le brief change", () => {
    const tasks = [editable("TASK-006")];
    const before = buildReplanPlanningContext({
      tasks,
      appliedBacklogCount: 1,
      briefRevision: "a".repeat(64),
      planRevision: null,
      sanitize: IDENTITY,
    });
    const after = buildReplanPlanningContext({
      tasks,
      appliedBacklogCount: 1,
      briefRevision: "c".repeat(64),
      planRevision: null,
      sanitize: IDENTITY,
    });
    assert.ok(before.ok && after.ok);
    assert.notEqual(before.bundle.planningFingerprint, after.bundle.planningFingerprint);
  });
});
