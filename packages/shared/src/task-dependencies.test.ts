/**
 * Le graphe de dependances, sans base de donnees.
 *
 * ## Ce que ce fichier prouve
 *
 * Que la convention `taskId attend dependsOnTaskId` est tenue dans le seul sens
 * possible — c'est l'erreur qu'aucun test d'integration n'attraperait, parce
 * qu'un graphe inverse bloque des taches, mais bloque quelque chose.
 *
 * Que les cycles **transitifs** sont vus, pas seulement l'arete inverse.
 *
 * Que la satisfaction se derive du statut courant, et de lui seul : rien n'est
 * stocke, donc rouvrir une tache terminee remet immediatement ses dependants en
 * attente.
 *
 * Et que les numeros ne disent rien : `TASK-002` peut attendre `TASK-004`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TASK_DEPENDENCY_ERROR,
  TASK_KIND,
  TASK_STATUS,
  checkTaskDependencyPair,
  createsDependencyCycle,
  dependencyPathExists,
  isDependencySatisfied,
  normalizeDependencyIds,
  sameDependencySet,
  summarizeTaskDependencies,
  type TaskDependencyEdge,
  type TaskDependencyRef,
} from "../dist/index.js";

function ref(overrides: Partial<TaskDependencyRef> = {}): TaskDependencyRef {
  return {
    id: "task-1",
    code: "TASK-001",
    title: "Poser le domaine",
    status: TASK_STATUS.DRAFT,
    kind: TASK_KIND.NORMAL,
    ...overrides,
  };
}

/** « A attend B » — la seule lecture correcte d'une arete. */
function edge(taskId: string, dependsOnTaskId: string): TaskDependencyEdge {
  return { taskId, dependsOnTaskId };
}

describe("satisfaction d'une dependance", () => {
  it("n'est acquise que par une tache terminee", () => {
    assert.equal(isDependencySatisfied(TASK_STATUS.COMPLETED), true);
  });

  it("refuse tous les autres statuts", () => {
    // `REVIEW` est le cas piegeux : le travail existe, mais aucun humain n'a
    // tranche. Une dependance qui s'en satisferait ne contraindrait rien.
    for (const status of [
      TASK_STATUS.DRAFT,
      TASK_STATUS.READY,
      TASK_STATUS.RUNNING,
      TASK_STATUS.REVIEW,
      TASK_STATUS.BLOCKED,
      TASK_STATUS.FAILED,
    ]) {
      assert.equal(isDependencySatisfied(status), false, status);
    }
  });
});

describe("lecture derivee", () => {
  it("compte ce qui est terminee et ce qui attend", () => {
    const summary = summarizeTaskDependencies({
      dependsOn: [
        ref({ id: "a", code: "TASK-001", status: TASK_STATUS.COMPLETED }),
        ref({ id: "b", code: "TASK-002", status: TASK_STATUS.DRAFT }),
      ],
      dependents: [],
    });

    assert.equal(summary.total, 2);
    assert.equal(summary.resolved, 1);
    assert.equal(summary.unresolved, 1);
    assert.equal(summary.allSatisfied, false);
    assert.deepEqual(
      summary.waiting.map((entry) => entry.code),
      ["TASK-002"],
    );
  });

  it("considere une tache sans dependance comme satisfaite", () => {
    const summary = summarizeTaskDependencies({ dependsOn: [], dependents: [] });

    assert.equal(summary.total, 0);
    assert.equal(summary.unresolved, 0);
    assert.equal(summary.allSatisfied, true);
  });

  it("ne compte pas les dependants dans les compteurs", () => {
    // Savoir que trois taches attendent celle-ci n'empeche jamais de la lancer.
    const summary = summarizeTaskDependencies({
      dependsOn: [],
      dependents: [ref({ id: "x" }), ref({ id: "y" }), ref({ id: "z" })],
    });

    assert.equal(summary.total, 0);
    assert.equal(summary.allSatisfied, true);
    assert.equal(summary.dependents.length, 3);
  });

  it("marque chaque entree, dans les deux sens", () => {
    const summary = summarizeTaskDependencies({
      dependsOn: [ref({ id: "a", status: TASK_STATUS.COMPLETED })],
      dependents: [ref({ id: "b", status: TASK_STATUS.DRAFT })],
    });

    assert.equal(summary.dependsOn[0]?.satisfied, true);
    assert.equal(summary.dependents[0]?.satisfied, false);
  });

  it("change des que le statut change, sans rien reecrire", () => {
    const waiting = summarizeTaskDependencies({
      dependsOn: [ref({ status: TASK_STATUS.COMPLETED })],
      dependents: [],
    });
    assert.equal(waiting.allSatisfied, true);

    // Une tache rouverte : meme arete, meme identifiant, autre reponse.
    const reopened = summarizeTaskDependencies({
      dependsOn: [ref({ status: TASK_STATUS.READY })],
      dependents: [],
    });
    assert.equal(reopened.allSatisfied, false);
  });
});

describe("chemins du graphe", () => {
  it("suit le sens « attend »", () => {
    // A attend B, B attend C.
    const edges = [edge("a", "b"), edge("b", "c")];

    assert.equal(dependencyPathExists(edges, "a", "c"), true);
    // Et surtout : pas l'inverse. C'est ce test qui detecte une convention
    // inversee ailleurs dans le code.
    assert.equal(dependencyPathExists(edges, "c", "a"), false);
  });

  it("rend faux sur un graphe vide", () => {
    assert.equal(dependencyPathExists([], "a", "b"), false);
  });

  it("termine sur un graphe deja cyclique", () => {
    // Impossible a produire par NOX, possible par une base modifiee a la main.
    const edges = [edge("a", "b"), edge("b", "a")];
    assert.equal(dependencyPathExists(edges, "a", "a"), true);
  });
});

describe("detection de cycle", () => {
  it("refuse une tache qui s'attendrait elle-meme", () => {
    assert.equal(createsDependencyCycle([], "a", "a"), true);
  });

  it("refuse un cycle direct", () => {
    assert.equal(createsDependencyCycle([edge("a", "b")], "b", "a"), true);
  });

  it("refuse un cycle transitif", () => {
    // A attend B, B attend C. Ajouter « C attend A » fermerait la boucle, et
    // aucune relecture d'une seule ligne ne le montrerait.
    const edges = [edge("a", "b"), edge("b", "c")];
    assert.equal(createsDependencyCycle(edges, "c", "a"), true);
  });

  it("refuse un cycle a quatre sommets", () => {
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "d")];
    assert.equal(createsDependencyCycle(edges, "d", "a"), true);
  });

  it("accepte un losange", () => {
    // B et C attendent tous deux D : ce n'est pas un cycle, c'est le cas le plus
    // courant d'un vrai backlog.
    const edges = [edge("b", "d"), edge("c", "d")];
    assert.equal(createsDependencyCycle(edges, "a", "b"), false);
    assert.equal(createsDependencyCycle(edges, "a", "c"), false);
  });

  it("accepte une seconde dependance vers la meme tache", () => {
    assert.equal(createsDependencyCycle([edge("b", "a")], "c", "a"), false);
  });

  it("ignore les aretes d'un sous-graphe deconnecte", () => {
    const edges = [edge("x", "y"), edge("y", "z")];
    assert.equal(createsDependencyCycle(edges, "a", "b"), false);
  });
});

describe("regles de nature et de projet", () => {
  const normal = { id: "a", projectId: "p1", kind: TASK_KIND.NORMAL } as const;
  const bootstrap = { id: "boot", projectId: "p1", kind: TASK_KIND.BOOTSTRAP } as const;

  it("accepte une tache produit qui attend l'amorcage", () => {
    // Le cas utile : TASK-001 attend TASK-000.
    assert.equal(checkTaskDependencyPair({ task: normal, dependsOn: bootstrap }), null);
  });

  it("refuse une tache d'amorcage qui attendrait une tache produit", () => {
    // L'amorcage prepare le terrain que les taches produit utiliseront ensuite.
    assert.equal(
      checkTaskDependencyPair({ task: bootstrap, dependsOn: normal }),
      TASK_DEPENDENCY_ERROR.BOOTSTRAP_SOURCE,
    );
  });

  it("refuse une tache qui se designerait elle-meme", () => {
    assert.equal(
      checkTaskDependencyPair({ task: normal, dependsOn: normal }),
      TASK_DEPENDENCY_ERROR.SELF,
    );
  });

  it("refuse deux projets differents", () => {
    assert.equal(
      checkTaskDependencyPair({
        task: normal,
        dependsOn: { id: "b", projectId: "p2", kind: TASK_KIND.NORMAL },
      }),
      TASK_DEPENDENCY_ERROR.CROSS_PROJECT,
    );
  });

  it("verifie l'identite avant le projet", () => {
    // Une tache comparee a elle-meme partage forcement son projet : dire
    // « projets differents » serait faux, et « cycle » arriverait trop tard.
    assert.equal(
      checkTaskDependencyPair({ task: normal, dependsOn: { ...normal } }),
      TASK_DEPENDENCY_ERROR.SELF,
    );
  });

  it("accepte deux taches produit du meme projet", () => {
    assert.equal(
      checkTaskDependencyPair({
        task: normal,
        dependsOn: { id: "b", projectId: "p1", kind: TASK_KIND.NORMAL },
      }),
      null,
    );
  });
});

describe("normalisation d'un ensemble soumis", () => {
  it("retire les doublons en gardant la premiere position", () => {
    assert.deepEqual(normalizeDependencyIds(["a", "b", "a"]), ["a", "b"]);
  });

  it("retire les entrees vides", () => {
    assert.deepEqual(normalizeDependencyIds(["a", "", "  ", "b"]), ["a", "b"]);
  });

  it("compare deux ensembles sans tenir compte de l'ordre", () => {
    // Cocher puis recocher ne modifie rien : l'ordre des dependances ne signifie
    // rien, contrairement a celui des criteres.
    assert.equal(sameDependencySet(["a", "b"], ["b", "a"]), true);
    assert.equal(sameDependencySet(["a"], ["a", "b"]), false);
    assert.equal(sameDependencySet([], []), true);
  });
});
