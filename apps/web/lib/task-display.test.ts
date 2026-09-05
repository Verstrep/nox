import { TASK_STATUS, TASK_STATUSES, type DevelopmentTaskSummary, type TaskStatus } from "@nox/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { taskStatusLabel } from "./labels.ts";

import {
  backlogUrl,
  breakdownLabel,
  countTasksByStatus,
  readStatusFilter,
  taskBreakdown,
  taskStatusTone,
  taskSummaryLine,
  taskUrl,
} from "./task-display.ts";

/** Une table de comptages complete, dont seules les valeurs nommees sont non nulles. */
function counts(overrides: Partial<Record<TaskStatus, number>> = {}): Record<TaskStatus, number> {
  const base = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
    TaskStatus,
    number
  >;
  return { ...base, ...overrides };
}

function summary(overrides: Partial<DevelopmentTaskSummary> = {}): DevelopmentTaskSummary {
  return {
    id: "t1",
    code: "TASK-001",
    kind: "NORMAL",
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

describe("taskBreakdown", () => {
  it("omet les statuts vides", () => {
    const breakdown = taskBreakdown(counts({ COMPLETED: 2, DRAFT: 5 }));
    assert.deepEqual(breakdown, [
      { status: TASK_STATUS.COMPLETED, count: 2 },
      { status: TASK_STATUS.DRAFT, count: 5 },
    ]);
  });

  it("suit l'ordre du workflow, pas celui de l'enum", () => {
    const breakdown = taskBreakdown(
      counts({ DRAFT: 1, READY: 1, RUNNING: 1, REVIEW: 1, COMPLETED: 1 }),
    );
    assert.deepEqual(
      breakdown.map((entry) => entry.status),
      [
        TASK_STATUS.COMPLETED,
        TASK_STATUS.REVIEW,
        TASK_STATUS.RUNNING,
        TASK_STATUS.READY,
        TASK_STATUS.DRAFT,
      ],
    );
  });

  it("rend une liste vide pour un projet sans tache", () => {
    assert.deepEqual(taskBreakdown(counts()), []);
  });
});

/**
 * Le langage visuel des statuts.
 *
 * ## Pourquoi ces tests existent
 *
 * Le premier pilote reel a montre qu'un utilisateur devait **lire** chaque
 * pastille pour savoir ou en etait son projet : `Done` s'affichait dans le ton
 * le plus efface de la palette, et `Blocked` comme `Failed` dans le gris d'un
 * statut ordinaire.
 *
 * Ces tests fixent le contrat qui en est sorti. Ils ne verifient pas des
 * couleurs — ils verifient des **roles** : ce qui est fini, ce qui est casse, ce
 * qui tourne, et ce qui n'appelle aucune reaction.
 */
describe("langage visuel des statuts de tache", () => {
  it("rend une tache terminee immediatement identifiable", () => {
    assert.equal(taskStatusTone(TASK_STATUS.COMPLETED), "success");
  });

  it("rend un blocage et un echec immediatement identifiables", () => {
    assert.equal(taskStatusTone(TASK_STATUS.BLOCKED), "danger");
    assert.equal(taskStatusTone(TASK_STATUS.FAILED), "danger");
  });

  it("laisse un brouillon neutre", () => {
    // Un brouillon n'appelle aucune reaction : le peindre le ferait ressortir
    // au milieu de ce qui compte.
    assert.equal(taskStatusTone(TASK_STATUS.DRAFT), "muted");
  });

  it("distingue prete, en cours et en review", () => {
    const ready = taskStatusTone(TASK_STATUS.READY);
    const running = taskStatusTone(TASK_STATUS.RUNNING);
    const review = taskStatusTone(TASK_STATUS.REVIEW);

    assert.equal(new Set([ready, running, review]).size, 3);
    // `accent` — le teal de NOX — ne designe plus que ce qui se passe en ce
    // moment. Une tache prete n'est pas une tache active.
    assert.equal(running, "accent");
    assert.notEqual(ready, "accent");
    // Une review demande quelque chose a un humain : c'est la seule ligne d'une
    // liste sur laquelle il doit agir lui-meme.
    assert.equal(review, "warn");
  });

  it("attribue un ton a chaque statut, sans exception", () => {
    for (const status of TASK_STATUSES) {
      assert.equal(typeof taskStatusTone(status), "string", status);
    }
  });

  it("ne fait jamais porter l'information par la seule couleur", () => {
    // `Blocked` et `Failed` partagent volontairement le meme ton : les deux
    // appellent la meme reaction. Ce qui les distingue est le libelle, et il
    // doit rester distinct — sinon la pastille cesse d'etre lisible pour qui ne
    // percoit pas la difference de couleur.
    const labels = TASK_STATUSES.map(taskStatusLabel);
    assert.equal(new Set(labels).size, TASK_STATUSES.length);
    for (const label of labels) {
      assert.notEqual(label.trim(), "");
    }
  });
});

describe("taskSummaryLine", () => {
  it("resume l'avancement en une seule chaine cherchable", () => {
    assert.equal(
      taskSummaryLine(counts({ COMPLETED: 3, RUNNING: 1, BLOCKED: 1, DRAFT: 4 })),
      // L'ordre est celui du workflow, pas celui de l'appelant : `Draft`
      // precede `Blocked` parce qu'une tache pas encore prete vient avant une
      // tache arretee. Un ordre par nombre changerait a chaque rendu.
      "3 Done · 1 Running · 4 Draft · 1 Blocked",
    );
  });

  it("suit l'ordre du workflow, pas celui des comptages", () => {
    assert.equal(taskSummaryLine(counts({ DRAFT: 2, COMPLETED: 1 })), "1 Done · 2 Draft");
  });

  it("ne dit rien plutot que de dire zero", () => {
    assert.equal(taskSummaryLine(counts()), null);
  });

  it("compose une entree avec son libelle metier", () => {
    assert.equal(breakdownLabel({ status: TASK_STATUS.COMPLETED, count: 2 }), "2 Done");
  });
});
