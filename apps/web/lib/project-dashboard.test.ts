/**
 * Affichage du tableau de bord des projets.
 *
 * ## Ce que ce fichier protege
 *
 * Qu'une carte ne montre que des donnees derivees, et qu'aucune absence ne se
 * lise comme une panne : un projet sans brief dit « Brief not defined yet », un
 * projet sans tache dit « 0 Tasks », un projet sans amorcage dit « Not
 * prepared ». Jamais `undefined`, jamais un etat vide technique.
 *
 * Et que l'ordre est deterministe : deux rendus consecutifs donnent la meme
 * liste, y compris quand deux projets partagent la meme date.
 *
 * Pur : ni base, ni disque, ni reseau.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROJECT_STATUS, TASK_STATUS, TASK_STATUSES, type TaskStatus } from "@nox/shared";

import {
  CARD_SUMMARY_MAX_LENGTH,
  bootstrapCardLabel,
  cardSummary,
  projectCard,
  sortProjectCards,
  taskBreakdown,
  taskTotalLabel,
  waitingLabel,
  type ProjectCardFacts,
} from "./project-dashboard.ts";

function counts(overrides: Partial<Record<TaskStatus, number>> = {}): Record<TaskStatus, number> {
  const base = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
    TaskStatus,
    number
  >;
  return { ...base, ...overrides };
}

function facts(overrides: Partial<ProjectCardFacts> = {}): ProjectCardFacts {
  return {
    briefSummary: null,
    taskCounts: counts(),
    taskTotal: 0,
    bootstrapStatus: null,
    readyWaitingOnDependencies: 0,
    lastTaskActivityAt: null,
    ...overrides,
  };
}

function project(overrides: Partial<Parameters<typeof projectCard>[0]> = {}) {
  return {
    id: "projet-1",
    name: "Planificateur de repas",
    status: PROJECT_STATUS.DRAFT,
    repositoryPath: "D:/Projets/meal-planner",
    updatedAt: new Date("2026-01-01T10:00:00Z"),
    ...overrides,
  };
}

describe("cardSummary", () => {
  it("rend `null` sans brief", () => {
    assert.equal(cardSummary(null), null);
  });

  it("rend `null` pour un resume qui n'est que des espaces", () => {
    // « Defini mais vide » se lit comme « absent » sur une carte : afficher une
    // ligne blanche ferait croire a un defaut d'affichage.
    assert.equal(cardSummary("   \n  "), null);
  });

  it("normalise les espaces d'un resume multiligne", () => {
    assert.equal(cardSummary("Une\n  application\tpersonnelle."), "Une application personnelle.");
  });

  it("laisse un resume court intact", () => {
    const text = "Application personnelle pour planifier quatre semaines de repas.";
    assert.equal(cardSummary(text), text);
  });

  it("coupe un resume long sans casser un mot", () => {
    const text = `${"mot ".repeat(120)}fin`;
    const cut = cardSummary(text);

    assert.ok(cut !== null);
    assert.ok(cut.length <= CARD_SUMMARY_MAX_LENGTH + 1);
    assert.ok(cut.endsWith("…"));
    assert.ok(!cut.includes("  "));
  });
});

describe("bootstrapCardLabel", () => {
  it("dit « Not prepared » quand TASK-000 n'existe pas", () => {
    assert.equal(bootstrapCardLabel(null), "Not prepared");
  });

  it("delegue au statut de la tache, sans seconde machine a etats", () => {
    assert.equal(bootstrapCardLabel(TASK_STATUS.DRAFT), "Draft");
    assert.equal(bootstrapCardLabel(TASK_STATUS.READY), "Ready");
    assert.equal(bootstrapCardLabel(TASK_STATUS.RUNNING), "Running");
    assert.equal(bootstrapCardLabel(TASK_STATUS.REVIEW), "Review");
    assert.equal(bootstrapCardLabel(TASK_STATUS.COMPLETED), "Done");
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

describe("taskTotalLabel", () => {
  it("dit « 0 Tasks » plutot qu'un etat vide", () => {
    assert.equal(taskTotalLabel(0), "0 Tasks");
  });

  it("accorde le singulier", () => {
    assert.equal(taskTotalLabel(1), "1 Task");
    assert.equal(taskTotalLabel(6), "6 Tasks");
  });
});

describe("waitingLabel", () => {
  it("ne dit rien quand rien n'attend", () => {
    assert.equal(waitingLabel(0), null);
  });

  it("accorde le singulier et le pluriel", () => {
    assert.equal(waitingLabel(1), "1 tâche prête attend une dépendance");
    assert.equal(waitingLabel(3), "3 tâches prêtes attendent une dépendance");
  });
});

describe("projectCard", () => {
  it("construit la carte d'un projet vide sans rien inventer", () => {
    const card = projectCard(project(), facts());

    assert.equal(card.summary, null);
    assert.equal(card.taskTotal, 0);
    assert.deepEqual(card.breakdown, []);
    assert.equal(card.bootstrapLabel, "Not prepared");
    assert.equal(card.waitingOnDependencies, 0);
    assert.equal(card.repositoryPath, "D:/Projets/meal-planner");
  });

  it("reprend les faits derives d'un projet actif", () => {
    const card = projectCard(
      project(),
      facts({
        briefSummary: "Planifier quatre semaines de repas.",
        taskCounts: counts({ COMPLETED: 1, READY: 2, DRAFT: 3 }),
        taskTotal: 6,
        bootstrapStatus: TASK_STATUS.COMPLETED,
        readyWaitingOnDependencies: 1,
      }),
    );

    assert.equal(card.summary, "Planifier quatre semaines de repas.");
    assert.equal(card.taskTotal, 6);
    assert.equal(card.bootstrapLabel, "Done");
    assert.equal(card.waitingOnDependencies, 1);
    assert.deepEqual(
      card.breakdown.map((entry) => `${String(entry.count)} ${entry.status}`),
      ["1 COMPLETED", "2 READY", "3 DRAFT"],
    );
  });

  it("retient la plus recente des deux dates d'activite", () => {
    // Une execution change le statut d'une tache, pas la ligne du projet :
    // ignorer les taches ferait descendre en bas de liste le projet le plus
    // travaille de la semaine.
    const recent = new Date("2026-02-01T09:00:00Z");
    const card = projectCard(project(), facts({ lastTaskActivityAt: recent }));
    assert.equal(card.lastActivityAt.toISOString(), recent.toISOString());
  });

  it("garde la date du projet quand aucune tache n'est plus recente", () => {
    const card = projectCard(
      project({ updatedAt: new Date("2026-03-01T09:00:00Z") }),
      facts({ lastTaskActivityAt: new Date("2026-01-01T09:00:00Z") }),
    );
    assert.equal(card.lastActivityAt.toISOString(), "2026-03-01T09:00:00.000Z");
  });
});

describe("sortProjectCards", () => {
  function card(id: string, name: string, at: string) {
    return projectCard(project({ id, name, updatedAt: new Date(at) }), facts());
  }

  it("place le plus recemment actif en premier", () => {
    const sorted = sortProjectCards([
      card("a", "Ancien", "2026-01-01T00:00:00Z"),
      card("b", "Recent", "2026-03-01T00:00:00Z"),
      card("c", "Intermediaire", "2026-02-01T00:00:00Z"),
    ]);

    assert.deepEqual(
      sorted.map((entry) => entry.id),
      ["b", "c", "a"],
    );
  });

  it("tranche par le nom a egalite de date", () => {
    // Deux projets crees dans la meme seconde ne doivent pas s'echanger de
    // place d'un rendu a l'autre.
    const sorted = sortProjectCards([
      card("z", "Zebre", "2026-01-01T00:00:00Z"),
      card("a", "Antilope", "2026-01-01T00:00:00Z"),
    ]);

    assert.deepEqual(
      sorted.map((entry) => entry.id),
      ["a", "z"],
    );
  });

  it("ne modifie pas la liste recue", () => {
    const input = [card("a", "A", "2026-01-01T00:00:00Z"), card("b", "B", "2026-03-01T00:00:00Z")];
    const order = input.map((entry) => entry.id);
    sortProjectCards(input);
    assert.deepEqual(
      input.map((entry) => entry.id),
      order,
    );
  });

  it("accepte une liste vide", () => {
    assert.deepEqual(sortProjectCards([]), []);
  });
});
