/**
 * Ce que NOX derive d'un etat cible.
 *
 * Le test central de ce fichier est celui de l'`UPDATE` cosmetique : deux
 * saisies qui decrivent la meme chose doivent produire `KEEP`. Une revue qui
 * annoncerait « 12 taches modifiees » pour une difference d'ordre de
 * serialisation ferait redescendre douze taches de `READY` a `DRAFT`, et
 * personne ne s'en apercevrait avant la file.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMAND_EXECUTION_MODE,
  REPLAN_CHANGE,
  REPLAN_FIELD,
  REPLAN_LOCK_REASON,
  TASK_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
  VERIFICATION_MODE,
} from "@nox/shared";
import type { ReplanApplyItem, ReplanStateTask, TaskEditSnapshot } from "@nox/database";

import { buildReplanDiff } from "./diff.ts";

function contract(code: string, overrides: Partial<TaskEditSnapshot> = {}): TaskEditSnapshot {
  return {
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
    documentReferences: ["docs/ARCHITECTURE.md"],
    validationCommands: [
      { command: "npm run test", executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY },
    ],
    dependsOnTaskIds: [],
    ...overrides,
  };
}

function current(code: string, overrides: Partial<ReplanStateTask> = {}): ReplanStateTask {
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
    documentReferences: ["docs/ARCHITECTURE.md"],
    contract: contract(code),
    ...overrides,
  };
}

function keep(code: string, overrides: Partial<ReplanApplyItem> = {}): ReplanApplyItem {
  return {
    existingTaskId: `id-${code}`,
    tempId: null,
    values: contract(code),
    dependsOnTaskIds: [],
    dependsOnTempIds: [],
    ...overrides,
  };
}

function add(tempId: string, title: string, overrides: Partial<ReplanApplyItem> = {}): ReplanApplyItem {
  return {
    existingTaskId: null,
    tempId,
    values: { ...contract(tempId), title },
    dependsOnTaskIds: [],
    dependsOnTempIds: [],
    ...overrides,
  };
}

const CODES = new Map([
  ["id-TASK-006", "TASK-006"],
  ["id-TASK-007", "TASK-007"],
  ["id-TASK-003", "TASK-003"],
]);

function diff(
  currentTasks: readonly ReplanStateTask[],
  target: readonly ReplanApplyItem[],
) {
  return buildReplanDiff({ current: currentTasks, target, codeByTaskId: CODES });
}

describe("derivation", () => {
  it("reconnait une conservation, une modification, une suppression et un ajout", () => {
    const result = diff(
      [current("TASK-006"), current("TASK-007")],
      [
        keep("TASK-006"),
        keep("TASK-007", { values: contract("TASK-007", { objective: "Un autre objectif." }) }),
        add("N1", "Partager par lien"),
      ],
    );

    assert.deepEqual(
      result.entries.map((entry) => entry.change),
      [REPLAN_CHANGE.KEEP, REPLAN_CHANGE.UPDATE, REPLAN_CHANGE.ADD],
    );
    assert.deepEqual(result.summary, {
      added: 1,
      updated: 1,
      removed: 0,
      kept: 1,
      reordered: 0,
      dependencyChanged: 0,
    });
  });

  it("place les suppressions apres la cible, dans l'ordre du plan actuel", () => {
    const result = diff([current("TASK-006"), current("TASK-007")], [keep("TASK-007")]);

    assert.deepEqual(
      result.entries.map((entry) => [entry.code, entry.change]),
      [
        ["TASK-007", REPLAN_CHANGE.KEEP],
        ["TASK-006", REPLAN_CHANGE.REMOVE],
      ],
    );
    assert.equal(result.summary.removed, 1);
  });

  it("nomme les champs qui changent, et eux seuls", () => {
    const result = diff(
      [current("TASK-006")],
      [
        keep("TASK-006", {
          values: contract("TASK-006", {
            title: "Un autre titre",
            priority: TASK_PRIORITY.HIGH,
          }),
        }),
      ],
    );

    assert.deepEqual(result.entries[0]?.changedFields, [
      REPLAN_FIELD.TITLE,
      REPLAN_FIELD.PRIORITY,
    ]);
    assert.equal(result.entries[0]?.previousTitle, "Titre de TASK-006");
  });

  it("n'invente pas d'element pour une tache que le plan courant ne porte plus", () => {
    const result = diff([], [keep("TASK-006")]);
    assert.deepEqual(result.entries, []);
  });
});

describe("aucun UPDATE cosmetique", () => {
  it("ignore une instruction humaine posee sur un critere automatise", () => {
    // La canonicalisation de TASK-024 : une instruction n'existe que pour un
    // critere humain. Deux saisies qui decrivent la meme chose doivent donner
    // `KEEP`, sinon un formulaire ouvert puis referme degraderait un `READY`.
    const automated = contract("TASK-006", {
      acceptanceCriteria: [
        {
          text: "Les tests passent.",
          verificationMode: VERIFICATION_MODE.AUTOMATED,
          humanInstructions: null,
          commandPositions: [0],
        },
      ],
    });
    const noisy = contract("TASK-006", {
      acceptanceCriteria: [
        {
          text: "Les tests passent.",
          verificationMode: VERIFICATION_MODE.AUTOMATED,
          humanInstructions: "Une consigne qui n'a aucun sens ici.",
          commandPositions: [0, 0, 9],
        },
      ],
    });

    const result = diff(
      [current("TASK-006", { contract: automated })],
      [keep("TASK-006", { values: noisy })],
    );

    assert.equal(result.entries[0]?.change, REPLAN_CHANGE.KEEP);
    assert.deepEqual(result.entries[0]?.changedFields, []);
  });

  it("ignore l'ordre des dependances, qui ne signifie rien", () => {
    const result = diff(
      [current("TASK-006", { dependsOnTaskIds: ["id-TASK-003", "id-TASK-007"] })],
      [keep("TASK-006", { dependsOnTaskIds: ["id-TASK-007", "id-TASK-003"] })],
    );

    assert.equal(result.entries[0]?.dependencyChanged, false);
    assert.equal(result.entries[0]?.change, REPLAN_CHANGE.KEEP);
  });

  it("declare le plan inchange quand il l'est reellement", () => {
    const result = diff([current("TASK-006"), current("TASK-007")], [
      keep("TASK-006"),
      keep("TASK-007"),
    ]);
    assert.equal(result.unchanged, true);
    assert.equal(result.orderChanged, false);
  });
});

describe("reordonnancement", () => {
  it("ne produit qu'un deplacement, jamais une modification", () => {
    const result = diff([current("TASK-006"), current("TASK-007")], [
      keep("TASK-007"),
      keep("TASK-006"),
    ]);

    assert.equal(result.orderChanged, true);
    assert.equal(result.summary.updated, 0);
    assert.equal(result.summary.reordered, 2);
    for (const entry of result.entries) {
      assert.equal(entry.change, REPLAN_CHANGE.KEEP);
      assert.deepEqual(entry.changedFields, []);
    }
  });

  it("ne compte pas un decalage cause par une insertion", () => {
    // Inserer une tache en tete decale toutes les positions suivantes sans que
    // rien n'ait change de place. Un ecran qui annoncerait « tout a bouge »
    // serait faux, et ferait chercher un changement qui n'existe pas.
    const result = diff([current("TASK-006"), current("TASK-007")], [
      add("N1", "Nouvelle"),
      keep("TASK-006"),
      keep("TASK-007"),
    ]);

    assert.equal(result.orderChanged, false);
    assert.equal(result.summary.reordered, 0);
    assert.equal(result.summary.added, 1);
  });
});

describe("dependances", () => {
  it("sont un axe distinct du contrat", () => {
    const result = diff(
      [current("TASK-006")],
      [keep("TASK-006", { dependsOnTaskIds: ["id-TASK-003"] })],
    );

    assert.equal(result.entries[0]?.change, REPLAN_CHANGE.KEEP, "un ajout de dependance n'est pas un UPDATE");
    assert.equal(result.entries[0]?.dependencyChanged, true);
    assert.deepEqual(result.entries[0]?.dependenciesBefore, []);
    assert.deepEqual(result.entries[0]?.dependenciesAfter, ["TASK-003"]);
    assert.equal(result.summary.updated, 0);
    assert.equal(result.summary.dependencyChanged, 1);
  });

  it("designent une tache nouvelle par son identifiant temporaire", () => {
    const result = diff(
      [current("TASK-006")],
      [add("N1", "Socle"), keep("TASK-006", { dependsOnTempIds: ["N1"] })],
    );

    assert.deepEqual(result.entries[1]?.dependenciesAfter, ["nouvelle · N1"]);
    assert.equal(result.entries[1]?.dependencyChanged, true);
  });

  it("comptent un element modifie et redirige une seule fois par axe", () => {
    // Un element peut etre `UPDATE` **et** voir ses dependances changer. Les
    // deux axes sont annonces separement ; les additionner donnerait un total
    // que rien ne verifie.
    const result = diff(
      [current("TASK-006")],
      [
        keep("TASK-006", {
          values: contract("TASK-006", { objective: "Autre." }),
          dependsOnTaskIds: ["id-TASK-003"],
        }),
      ],
    );

    assert.equal(result.summary.updated, 1);
    assert.equal(result.summary.dependencyChanged, 1);
    assert.equal(result.summary.kept, 0);
  });
});

describe("taches verrouillees", () => {
  it("n'entrent jamais dans la comparaison", () => {
    // Le plan courant ne porte que les taches modifiables : une tache
    // verrouillee absente de la cible ne doit pas apparaitre comme supprimee.
    void REPLAN_LOCK_REASON;
    const result = diff([current("TASK-006")], [keep("TASK-006")]);
    assert.equal(result.summary.removed, 0);
  });
});
