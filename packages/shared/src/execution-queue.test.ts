/**
 * Semantique de la file d'execution.
 *
 * ## Ce que ce fichier protege
 *
 * La selection : **sans blocage de tete**. Une entree qui attend une dependance
 * est sautee, garde sa place, et ne fige pas le reste de la file. C'est la
 * regle qui distingue une file utilisable d'une file qui s'arrete au premier
 * obstacle.
 *
 * La barriere : une entree dont le travail est commence reste l'element courant
 * jusqu'a ce que la tache soit acceptee. `REVIEW` n'est pas une acceptation.
 *
 * Et les refus d'inscription : l'amorcage n'entre jamais dans une file, une
 * tache qui n'est pas prete non plus, et une tache deja inscrite n'est pas une
 * erreur.
 *
 * Pur : ni base, ni disque, ni reseau.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXECUTION_QUEUE_ERROR,
  QUEUE_STATE,
  TASK_KIND,
  TASK_STATUS,
  checkQueueCandidate,
  deriveQueueState,
  isQueueBarrier,
  isQueueEntryEligible,
  isQueueLockedStatusChange,
  selectNextQueueEntry,
  selectQueueBarrier,
  type QueueEntryFacts,
  type TaskDependencyLink,
  type TaskStatus,
} from "../dist/index.js";

function waiting(code: string): TaskDependencyLink {
  return {
    id: `task-${code}`,
    code,
    title: `Tache ${code}`,
    status: TASK_STATUS.READY,
    kind: TASK_KIND.NORMAL,
    satisfied: false,
  };
}

function entry(overrides: Partial<QueueEntryFacts> = {}): QueueEntryFacts {
  return {
    taskId: "task-1",
    code: "TASK-001",
    title: "Une tache",
    sequence: 1,
    status: TASK_STATUS.READY,
    waiting: [],
    started: false,
    ...overrides,
  };
}

describe("isQueueEntryEligible", () => {
  it("accepte une tache prete sans dependance en attente", () => {
    assert.equal(isQueueEntryEligible(entry()), true);
  });

  it("refuse une tache qui attend", () => {
    assert.equal(isQueueEntryEligible(entry({ waiting: [waiting("TASK-002")] })), false);
  });

  for (const status of [
    TASK_STATUS.DRAFT,
    TASK_STATUS.RUNNING,
    TASK_STATUS.REVIEW,
    TASK_STATUS.FAILED,
    TASK_STATUS.BLOCKED,
    TASK_STATUS.COMPLETED,
  ]) {
    it(`refuse une tache ${status}`, () => {
      assert.equal(isQueueEntryEligible(entry({ status })), false);
    });
  }
});

describe("isQueueBarrier", () => {
  it("ne voit pas une tache prete qui n'a rien lance comme une barriere", () => {
    assert.equal(isQueueBarrier(entry()), false);
  });

  it("ne voit pas une tache terminee comme une barriere", () => {
    // Une tache acceptee n'a plus d'entree du tout : le cas n'existe pas en
    // base, et le declarer ici evite qu'il en apparaisse un.
    assert.equal(isQueueBarrier(entry({ status: TASK_STATUS.COMPLETED })), false);
  });

  it("voit une barriere dans une tache rouverte, redevenue prete", () => {
    // Le coeur du correctif : `READY` ne suffit pas a rendre la main. Une
    // inscription qui a deja lance une execution reste la barriere, meme quand
    // son statut est revenu a l'etat d'une tache jamais commencee.
    assert.equal(isQueueBarrier(entry({ status: TASK_STATUS.READY, started: true })), true);
  });

  it("ne voit plus de barriere dans une tache acceptee, meme commencee", () => {
    assert.equal(isQueueBarrier(entry({ status: TASK_STATUS.COMPLETED, started: true })), false);
  });

  for (const status of [
    TASK_STATUS.RUNNING,
    TASK_STATUS.REVIEW,
    TASK_STATUS.FAILED,
    TASK_STATUS.BLOCKED,
    TASK_STATUS.DRAFT,
  ]) {
    it(`voit une barriere dans une tache ${status}`, () => {
      assert.equal(isQueueBarrier(entry({ status })), true);
    });
  }
});

describe("selectNextQueueEntry", () => {
  it("prend la premiere entree eligible", () => {
    const next = selectNextQueueEntry([
      entry({ taskId: "a", sequence: 1 }),
      entry({ taskId: "b", sequence: 2 }),
    ]);
    assert.equal(next?.taskId, "a");
  });

  it("saute une entree bloquee sans figer la file", () => {
    // Le scenario exact de TASK-026 : l'entree #1 attend, #2 est eligible. Une
    // file qui s'arreterait sur #1 immobiliserait tout le travail restant pour
    // une raison qui ne le concerne pas.
    const next = selectNextQueueEntry([
      entry({ taskId: "c", sequence: 1, waiting: [waiting("TASK-001")] }),
      entry({ taskId: "a", sequence: 2 }),
      entry({ taskId: "b", sequence: 3 }),
    ]);
    assert.equal(next?.taskId, "a");
  });

  it("respecte l'ordre meme si la liste arrive melangee", () => {
    const next = selectNextQueueEntry([
      entry({ taskId: "b", sequence: 5 }),
      entry({ taskId: "a", sequence: 2 }),
    ]);
    assert.equal(next?.taskId, "a");
  });

  it("rend `null` quand toutes les entrees attendent", () => {
    assert.equal(
      selectNextQueueEntry([
        entry({ taskId: "a", sequence: 1, waiting: [waiting("TASK-009")] }),
        entry({ taskId: "b", sequence: 2, waiting: [waiting("TASK-009")] }),
      ]),
      null,
    );
  });

  it("rend `null` sur une file vide", () => {
    assert.equal(selectNextQueueEntry([]), null);
  });

  it("ignore une entree dont le travail est commence", () => {
    const next = selectNextQueueEntry([
      entry({ taskId: "a", sequence: 1, status: TASK_STATUS.REVIEW }),
      entry({ taskId: "b", sequence: 2 }),
    ]);
    assert.equal(next?.taskId, "b");
  });
});

describe("selectQueueBarrier", () => {
  it("designe la premiere entree dont le travail est commence", () => {
    const barrier = selectQueueBarrier([
      entry({ taskId: "a", sequence: 1 }),
      entry({ taskId: "b", sequence: 2, status: TASK_STATUS.RUNNING }),
    ]);
    assert.equal(barrier?.taskId, "b");
  });

  it("rend `null` quand toutes les entrees sont pretes", () => {
    assert.equal(selectQueueBarrier([entry(), entry({ taskId: "b", sequence: 2 })]), null);
  });
});

describe("deriveQueueState", () => {
  it("dit `EMPTY` pour une file sans entree, active ou non", () => {
    assert.equal(deriveQueueState({ active: false, entries: [] }).state, QUEUE_STATE.EMPTY);
    assert.equal(deriveQueueState({ active: true, entries: [] }).state, QUEUE_STATE.EMPTY);
  });

  it("dit `PAUSED` quand l'autorisation n'est pas ouverte", () => {
    assert.equal(deriveQueueState({ active: false, entries: [entry()] }).state, QUEUE_STATE.PAUSED);
  });

  it("dit `READY_TO_START` quand une tache pourrait partir", () => {
    const model = deriveQueueState({ active: true, entries: [entry()], repository: "ready" });
    assert.equal(model.state, QUEUE_STATE.READY_TO_START);
    assert.equal(model.nextEligible?.taskId, "task-1");
  });

  it("dit `WAITING_DEPENDENCIES` quand rien n'est eligible", () => {
    const model = deriveQueueState({
      active: true,
      entries: [entry({ waiting: [waiting("TASK-002")] })],
    });
    assert.equal(model.state, QUEUE_STATE.WAITING_DEPENDENCIES);
    assert.equal(model.waitingDependencyCount, 1);
  });

  it("dit `WAITING_REPOSITORY` quand seul le repository bloque", () => {
    const model = deriveQueueState({
      active: true,
      entries: [entry()],
      repository: "not_ready",
    });
    assert.equal(model.state, QUEUE_STATE.WAITING_REPOSITORY);
  });

  it("ne conclut pas au repository quand il n'a pas ete sonde", () => {
    // « Ne pas avoir demande » n'est pas « avoir recu un refus ».
    const model = deriveQueueState({ active: true, entries: [entry()] });
    assert.equal(model.state, QUEUE_STATE.READY_TO_START);
  });

  it("dit `RUNNING` quand la barriere travaille", () => {
    const model = deriveQueueState({
      active: true,
      entries: [entry({ status: TASK_STATUS.RUNNING }), entry({ taskId: "b", sequence: 2 })],
    });
    assert.equal(model.state, QUEUE_STATE.RUNNING);
    assert.equal(model.current?.taskId, "task-1");
  });

  it("dit `WAITING_REVIEW` quand la barriere attend une decision", () => {
    const model = deriveQueueState({
      active: true,
      entries: [entry({ status: TASK_STATUS.REVIEW })],
    });
    assert.equal(model.state, QUEUE_STATE.WAITING_REVIEW);
  });

  it("dit `FAILED_CURRENT` quand la barriere s'est mal terminee", () => {
    for (const status of [TASK_STATUS.FAILED, TASK_STATUS.BLOCKED]) {
      const model = deriveQueueState({ active: false, entries: [entry({ status })] });
      assert.equal(model.state, QUEUE_STATE.FAILED_CURRENT);
    }
  });

  it("compte separement les eligibles et celles qui attendent", () => {
    const model = deriveQueueState({
      active: true,
      entries: [
        entry({ taskId: "a", sequence: 1 }),
        entry({ taskId: "b", sequence: 2, waiting: [waiting("TASK-009")] }),
        entry({ taskId: "c", sequence: 3 }),
      ],
    });
    assert.equal(model.queuedCount, 3);
    assert.equal(model.eligibleCount, 2);
    assert.equal(model.waitingDependencyCount, 1);
  });

  it("rend les entrees ordonnees", () => {
    const model = deriveQueueState({
      active: false,
      entries: [entry({ taskId: "b", sequence: 9 }), entry({ taskId: "a", sequence: 2 })],
    });
    assert.deepEqual(
      model.entries.map((row) => row.taskId),
      ["a", "b"],
    );
  });
});

describe("checkQueueCandidate", () => {
  it("accepte une tache prete, normale, libre et non inscrite", () => {
    assert.deepEqual(
      checkQueueCandidate({
        status: TASK_STATUS.READY,
        kind: TASK_KIND.NORMAL,
        hasActiveRun: false,
        alreadyQueued: false,
      }),
      { ok: true },
    );
  });

  it("refuse une tache d'amorcage, avant toute autre raison", () => {
    // L'amorcage installe une fondation avec des permissions elargies : il ne
    // passe jamais par la file, et ce refus prime sur tous les autres.
    const check = checkQueueCandidate({
      status: TASK_STATUS.DRAFT,
      kind: TASK_KIND.BOOTSTRAP,
      hasActiveRun: true,
      alreadyQueued: true,
    });
    assert.equal(check.ok, false);
    assert.equal(
      check.ok === false && check.code,
      EXECUTION_QUEUE_ERROR.BOOTSTRAP_NOT_QUEUEABLE,
    );
  });

  it("signale une tache deja inscrite", () => {
    const check = checkQueueCandidate({
      status: TASK_STATUS.READY,
      kind: TASK_KIND.NORMAL,
      hasActiveRun: false,
      alreadyQueued: true,
    });
    assert.equal(check.ok === false && check.code, EXECUTION_QUEUE_ERROR.TASK_ALREADY_QUEUED);
  });

  for (const status of [
    TASK_STATUS.DRAFT,
    TASK_STATUS.RUNNING,
    TASK_STATUS.REVIEW,
    TASK_STATUS.FAILED,
    TASK_STATUS.BLOCKED,
    TASK_STATUS.COMPLETED,
  ] satisfies TaskStatus[]) {
    it(`refuse une tache ${status}`, () => {
      const check = checkQueueCandidate({
        status,
        kind: TASK_KIND.NORMAL,
        hasActiveRun: false,
        alreadyQueued: false,
      });
      assert.equal(check.ok === false && check.code, EXECUTION_QUEUE_ERROR.TASK_NOT_READY);
    });
  }

  it("refuse une tache dont une execution travaille deja", () => {
    const check = checkQueueCandidate({
      status: TASK_STATUS.READY,
      kind: TASK_KIND.NORMAL,
      hasActiveRun: true,
      alreadyQueued: false,
    });
    assert.equal(check.ok === false && check.code, EXECUTION_QUEUE_ERROR.TASK_HAS_ACTIVE_RUN);
  });
});

describe("isQueueLockedStatusChange", () => {
  it("verrouille les deux facons de retirer une tache du jeu", () => {
    assert.equal(isQueueLockedStatusChange(TASK_STATUS.DRAFT), true);
    assert.equal(isQueueLockedStatusChange(TASK_STATUS.BLOCKED), true);
  });

  it("laisse passer ce que la file attend", () => {
    // `Approve` doit fonctionner sur la barriere courante, `Reopen` aussi, et
    // `Retry` remet une tache echouee en file d'attente.
    assert.equal(isQueueLockedStatusChange(TASK_STATUS.COMPLETED), false);
    assert.equal(isQueueLockedStatusChange(TASK_STATUS.READY), false);
  });
});

// ---------------------------------------------------------------------------
// La barriere survit a une reouverture.
//
// Un `Reopen` ramene la tache a `READY`, c'est-a-dire au statut d'une tache
// jamais lancee. Sans `started`, la file confondrait les deux : elle relancerait
// la premiere en croyant demarrer la seconde. Ces tests decrivent la difference,
// puisqu'aucun statut ne la porte.
// ---------------------------------------------------------------------------

describe("file dont l'element courant a ete rouvert", () => {
  function reopened(): QueueEntryFacts[] {
    return [
      entry({ taskId: "a", code: "TASK-001", sequence: 1, started: true }),
      entry({ taskId: "b", code: "TASK-002", sequence: 2 }),
    ];
  }

  it("garde la tache rouverte comme element courant", () => {
    const model = deriveQueueState({ active: true, entries: reopened(), repository: "ready" });
    assert.equal(model.current?.code, "TASK-001");
  });

  it("ne designe aucune suivante tant que la barriere tient", () => {
    // Le modele de lecture ne doit designer personne : un « prochain » affiche
    // alors que rien ne peut partir finirait par etre cru.
    const model = deriveQueueState({ active: true, entries: reopened(), repository: "ready" });
    assert.equal(model.nextEligible, null);
  });

  it("annonce une attente de reprise, pas un echec ni une disponibilite", () => {
    const model = deriveQueueState({ active: true, entries: reopened(), repository: "ready" });
    assert.equal(model.state, QUEUE_STATE.WAITING_CURRENT_TASK);
  });

  it("ne se laisse pas depasser par une entree plus recente", () => {
    // Sans la barriere, `TASK-002` serait parfaitement eligible : prete, sans
    // dependance en attente, et deuxieme dans l'ordre.
    const entries = reopened();
    assert.equal(isQueueEntryEligible(entries[1] as QueueEntryFacts), true);
    assert.equal(
      deriveQueueState({ active: true, entries, repository: "ready" }).nextEligible,
      null,
    );
  });

  it("ne redevient pas une entree ordinaire quand on inscrit une tache de plus", () => {
    const entries = [
      ...reopened(),
      entry({ taskId: "c", code: "TASK-003", sequence: 3 }),
    ];
    const model = deriveQueueState({ active: true, entries, repository: "ready" });
    assert.equal(model.current?.code, "TASK-001");
    assert.equal(model.queuedCount, 3);
  });

  it("rend la voie libre des que la tache rouverte quitte la file", () => {
    const model = deriveQueueState({
      active: true,
      entries: [entry({ taskId: "b", code: "TASK-002", sequence: 2 })],
      repository: "ready",
    });
    assert.equal(model.current, null);
    assert.equal(model.nextEligible?.code, "TASK-002");
    assert.equal(model.state, QUEUE_STATE.READY_TO_START);
  });

  it("distingue une tache rouverte d'une tache prete jamais commencee", () => {
    const never = entry({ taskId: "a", started: false });
    const reopenedEntry = entry({ taskId: "a", started: true });
    assert.equal(isQueueEntryEligible(never), true);
    assert.equal(isQueueEntryEligible(reopenedEntry), false);
    assert.equal(isQueueBarrier(never), false);
    assert.equal(isQueueBarrier(reopenedEntry), true);
  });

  it("ne considere pas comme commencee une entree dont la tache a un passe", () => {
    // La question n'est pas « cette tache a-t-elle deja tourne un jour », mais
    // « cette inscription a-t-elle deja lance quelque chose ». Reinscrire une
    // tache rouverte cree une entree neuve, qui repart de zero.
    const fresh = entry({ taskId: "a", started: false });
    assert.equal(isQueueBarrier(fresh), false);
    assert.equal(
      deriveQueueState({ active: true, entries: [fresh], repository: "ready" }).state,
      QUEUE_STATE.READY_TO_START,
    );
  });
});
