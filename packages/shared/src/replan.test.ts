/**
 * Ce que `replan/1` accepte, et surtout ce qu'il refuse.
 *
 * Le coeur de TASK-032 est un refus : une tache deja engagee n'est jamais
 * reecrite. Ce fichier verifie ce refus sous toutes ses formes, plus les gardes
 * qui l'accompagnent — identites, dependances, graphe, bornes.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REPLAN_LIMITS,
  REPLAN_MODE,
  REPLAN_PROMPT_VERSION,
  REPLAN_SCHEMA_VERSION,
  buildReplanSchema,
  checkReplanTargetGraph,
  readArchitectReplan,
  type ReplanSourceState,
  type ReplanTargetTask,
} from "../dist/index.js";

const DOCUMENTS = ["docs/ARCHITECTURE.md"];

const SOURCE: ReplanSourceState = {
  editable: [
    { id: "t-006", code: "TASK-006", dependsOnTaskIds: [] },
    { id: "t-007", code: "TASK-007", dependsOnTaskIds: ["t-006"] },
  ],
  locked: [
    { id: "t-000", code: "TASK-000", dependsOnTaskIds: [] },
    { id: "t-003", code: "TASK-003", dependsOnTaskIds: [] },
  ],
};

/** Un element de cible valide, que chaque test deforme a sa facon. */
function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    existingTaskId: null,
    tempId: null,
    title: "Partager une liste par lien",
    priority: "MEDIUM",
    objective: "Permettre le partage d'une liste par un lien.",
    context: null,
    acceptanceCriteria: [
      {
        text: "Le lien ouvre la liste en lecture seule.",
        verificationMode: "HUMAN",
        humanInstructions: "Ouvrir le lien dans une fenetre privee.",
        validationCommandIndexes: [],
      },
    ],
    outOfScope: [],
    documentReferences: [],
    validationCommands: [],
    dependsOn: [],
    ...overrides,
  };
}

function replan(tasks: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    mode: REPLAN_MODE.PROPOSED,
    rationale: "L'utilisateur abandonne l'export PDF.",
    futureTasks: tasks,
  };
}

function read(value: unknown, source: ReplanSourceState = SOURCE) {
  return readArchitectReplan(value, source, DOCUMENTS);
}

describe("replan/1 — versions", () => {
  it("porte une version de prompt distincte du backlog", () => {
    // Deux consignes differentes, deux versions differentes : sans quoi une
    // proposition ne se relirait plus avec les regles qui l'ont produite.
    assert.equal(REPLAN_PROMPT_VERSION, "replan/1");
    assert.equal(REPLAN_SCHEMA_VERSION, 1);
  });
});

describe("replan/1 — mode", () => {
  it("lit une absence comme UNCHANGED", () => {
    for (const value of [null, undefined]) {
      const result = read(value);
      assert.ok(result.ok);
      assert.equal(result.replan.mode, REPLAN_MODE.UNCHANGED);
    }
  });

  it("lit UNCHANGED sans rien exiger d'autre", () => {
    const result = read({ mode: REPLAN_MODE.UNCHANGED, rationale: null, futureTasks: [] });
    assert.ok(result.ok);
    assert.equal(result.replan.mode, REPLAN_MODE.UNCHANGED);
  });

  it("refuse un mode inconnu", () => {
    const result = read({ mode: "PATCH", rationale: "x", futureTasks: [] });
    assert.equal(result.ok, false);
  });

  it("refuse une proposition sans justification", () => {
    const result = read({ mode: REPLAN_MODE.PROPOSED, rationale: "", futureTasks: [] });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.refusal.field, "replan.rationale");
  });

  it("accepte une cible vide", () => {
    // Legitime : l'utilisateur reduit sa V1 et tout le reste est deja fait.
    // NOX n'inventera pas une tache « recette finale » pour eviter une liste vide.
    const result = read(replan([]));
    assert.ok(result.ok);
    assert.equal(result.replan.mode, REPLAN_MODE.PROPOSED);
    assert.deepEqual(result.replan.mode === REPLAN_MODE.PROPOSED ? result.replan.futureTasks : null, []);
  });
});

describe("replan/1 — identites", () => {
  it("accepte une tache existante designee par son identifiant", () => {
    const result = read(replan([item({ existingTaskId: "t-006" })]));
    assert.ok(result.ok);
    const target = result.replan.mode === REPLAN_MODE.PROPOSED ? result.replan.futureTasks[0] : null;
    assert.equal(target?.existingTaskId, "t-006");
    assert.equal(target?.tempId, null);
  });

  it("accepte une tache existante designee par son code", () => {
    // Le fournisseur voit les deux ; exiger l'un des deux ne rendrait service a
    // personne, et NOX normalise vers l'identifiant.
    const result = read(replan([item({ existingTaskId: "TASK-006" })]));
    assert.ok(result.ok);
    const target = result.replan.mode === REPLAN_MODE.PROPOSED ? result.replan.futureTasks[0] : null;
    assert.equal(target?.existingTaskId, "t-006");
  });

  it("refuse un element qui ne dit pas ce qu'il est", () => {
    const result = read(replan([item()]));
    assert.equal(result.ok, false);
  });

  it("refuse un element qui se declare des deux facons", () => {
    const result = read(replan([item({ existingTaskId: "t-006", tempId: "N1" })]));
    assert.equal(result.ok, false);
  });

  it("refuse un identifiant inconnu", () => {
    // Invention du modele, tache supprimee entre-temps, tache d'un autre projet :
    // les trois se refusent, et aucun ne devient une creation implicite.
    const result = read(replan([item({ existingTaskId: "abc" })]));
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.refusal.message, /n'existe pas dans ce projet/u);
  });

  it("refuse une tache d'un autre projet", () => {
    const result = read(replan([item({ existingTaskId: "TASK-999" })]));
    assert.equal(result.ok, false);
  });

  it("refuse deux fois la meme tache existante", () => {
    const result = read(
      replan([item({ existingTaskId: "t-006" }), item({ existingTaskId: "TASK-006" })]),
    );
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.refusal.message, /deux fois la meme tache/u);
  });

  it("refuse deux identifiants temporaires identiques", () => {
    const result = read(replan([item({ tempId: "N1" }), item({ tempId: "N1" })]));
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.refusal.message, /identifiant temporaire/u);
  });

  it("refuse un identifiant temporaire qui usurpe une tache existante", () => {
    for (const forged of ["TASK-003", "t-003", "TASK-006"]) {
      const result = read(replan([item({ tempId: forged })]));
      assert.equal(result.ok, false, forged);
    }
  });
});

describe("replan/1 — le passe est immuable", () => {
  it("refuse de reecrire une tache verrouillee", () => {
    const result = read(replan([item({ existingTaskId: "t-003" })]));
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.refusal.message, /verrouillee/u);
  });

  it("refuse de reecrire la tache d'amorcage", () => {
    const result = read(replan([item({ existingTaskId: "TASK-000" })]));
    assert.equal(result.ok, false);
  });

  it("ne convertit jamais une edition verrouillee en tache nouvelle", () => {
    // Ce serait decider a la place du fournisseur ce que la decision de
    // l'utilisateur voulait dire. NOX refuse, et le dit.
    const result = read(replan([item({ existingTaskId: "t-003" })]));
    assert.equal(result.ok, false);
  });

  it("autorise une tache nouvelle qui depend d'une tache terminee", () => {
    // Le chemin correct quand une decision remet en cause du travail livre :
    // une nouvelle tache future, rattachee a l'ancienne.
    const result = read(replan([item({ tempId: "N1", dependsOn: ["TASK-003"] })]));
    assert.ok(result.ok);
    const target = result.replan.mode === REPLAN_MODE.PROPOSED ? result.replan.futureTasks[0] : null;
    assert.deepEqual(target?.dependsOnTaskIds, ["t-003"]);
  });
});

describe("replan/1 — dependances", () => {
  it("resout une dependance vers une tache nouvelle du meme lot", () => {
    const result = read(
      replan([item({ tempId: "N1" }), item({ tempId: "N2", dependsOn: ["N1"] })]),
    );
    assert.ok(result.ok);
    const second = result.replan.mode === REPLAN_MODE.PROPOSED ? result.replan.futureTasks[1] : null;
    assert.deepEqual(second?.dependsOnTempIds, ["N1"]);
    assert.deepEqual(second?.dependsOnTaskIds, []);
  });

  it("refuse une dependance pendante", () => {
    const result = read(replan([item({ tempId: "N1", dependsOn: ["N2"] })]));
    assert.equal(result.ok, false);
  });

  it("refuse une tache qui s'attend elle-meme", () => {
    const result = read(replan([item({ existingTaskId: "t-006", dependsOn: ["TASK-006"] })]));
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.refusal.message, /s'attend elle-meme/u);
  });

  it("refuse d'attendre une tache que la cible supprime", () => {
    // `t-007` n'est pas dans la cible : elle sera supprimee, et rien ne peut
    // plus l'attendre.
    const result = read(replan([item({ existingTaskId: "t-006", dependsOn: ["TASK-007"] })]));
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.refusal.message, /supprime par ailleurs/u);
  });

  it("refuse un cycle", () => {
    const result = read(
      replan([
        item({ tempId: "N1", dependsOn: ["N2"] }),
        item({ tempId: "N2", dependsOn: ["N1"] }),
      ]),
    );
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.refusal.message, /cycle/u);
  });

  it("refuse de supprimer une tache qu'une tache verrouillee attend", () => {
    const source: ReplanSourceState = {
      editable: [{ id: "t-007", code: "TASK-007", dependsOnTaskIds: [] }],
      locked: [{ id: "t-004", code: "TASK-004", dependsOnTaskIds: ["t-007"] }],
    };

    // La cible ne conserve pas `TASK-007` : `TASK-004` resterait bloquee pour
    // toujours. NOX refuse la cible ; il ne modifie jamais la tache verrouillee
    // pour « resoudre » le probleme.
    const result = read(replan([item({ tempId: "N1" })]), source);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.refusal.message, /TASK-004 attend encore/u);
  });
});

describe("replan/1 — contrat de tache", () => {
  it("applique les memes gardes que le backlog sur les commandes", () => {
    const result = read(
      replan([
        item({
          tempId: "N1",
          validationCommands: [{ command: "npm run test && rm -rf /", executionMode: "AGENT_ONLY" }],
        }),
      ]),
    );
    assert.equal(result.ok, false);
  });

  it("refuse un critere automatise sans preuve", () => {
    const result = read(
      replan([
        item({
          tempId: "N1",
          acceptanceCriteria: [
            {
              text: "Le partage fonctionne.",
              verificationMode: "AUTOMATED",
              humanInstructions: null,
              validationCommandIndexes: [],
            },
          ],
        }),
      ]),
    );
    assert.equal(result.ok, false);
  });

  it("refuse un document hors de la liste fermee", () => {
    const result = read(replan([item({ tempId: "N1", documentReferences: ["docs/SECRET.md"] })]));
    assert.equal(result.ok, false);
  });

  it("refuse une priorite inconnue", () => {
    const result = read(replan([item({ tempId: "N1", priority: "URGENT" })]));
    assert.equal(result.ok, false);
  });
});

describe("replan/1 — bornes", () => {
  it("refuse plus de taches nouvelles que la borne", () => {
    const tasks = Array.from({ length: REPLAN_LIMITS.newTasks.max + 1 }, (_unused, index) =>
      item({ tempId: `N${String(index)}` }),
    );
    const result = read(replan(tasks));
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.refusal.message, /taches nouvelles/u);
  });

  it("refuse une cible plus grande que la borne totale", () => {
    const tasks = Array.from({ length: REPLAN_LIMITS.targetTasks.max + 1 }, (_unused, index) =>
      item({ tempId: `N${String(index)}` }),
    );
    const result = read(replan(tasks));
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.refusal.message, /taches futures/u);
  });
});

describe("checkReplanTargetGraph", () => {
  function target(overrides: Partial<ReplanTargetTask>): ReplanTargetTask {
    return {
      existingTaskId: null,
      tempId: null,
      title: "T",
      priority: "MEDIUM",
      objective: "O",
      context: null,
      acceptanceCriteria: [],
      outOfScope: [],
      documentReferences: [],
      validationCommands: [],
      dependsOnTaskIds: [],
      dependsOnTempIds: [],
      ...overrides,
    };
  }

  it("accepte un graphe acyclique", () => {
    assert.equal(
      checkReplanTargetGraph(
        [
          target({ tempId: "N1", dependsOnTaskIds: ["t-003"] }),
          target({ existingTaskId: "t-006", dependsOnTempIds: ["N1"] }),
        ],
        SOURCE,
      ),
      null,
    );
  });

  it("attrape un cycle introduit a la main", () => {
    // Une edition humaine dans la review peut en creer un : la meme fonction est
    // rejouee, et refuse de la meme facon.
    const refusal = checkReplanTargetGraph(
      [
        target({ existingTaskId: "t-006", dependsOnTaskIds: ["t-007"] }),
        target({ existingTaskId: "t-007", dependsOnTaskIds: ["t-006"] }),
      ],
      SOURCE,
    );
    assert.notEqual(refusal, null);
  });
});

describe("schema strict", () => {
  it("declare tous ses champs et n'en accepte aucun autre", () => {
    const schema = buildReplanSchema();
    assert.equal(schema["additionalProperties"], false);
    assert.deepEqual(schema["required"], ["mode", "rationale", "futureTasks"]);

    const properties = schema["properties"] as Record<string, Record<string, unknown>>;
    const task = (properties["futureTasks"]?.["items"] ?? {}) as Record<string, unknown>;
    assert.equal(task["additionalProperties"], false);
    assert.deepEqual(task["required"], [
      "existingTaskId",
      "tempId",
      "title",
      "priority",
      "objective",
      "context",
      "acceptanceCriteria",
      "outOfScope",
      "documentReferences",
      "validationCommands",
      "dependsOn",
    ]);
  });

  it("ne declare aucune borne de taille", () => {
    // Le mode strict d'OpenAI ignore `maxItems`, `minItems` et `maxLength` : les
    // declarer ferait echouer la requete entiere. Les bornes vivent dans le
    // prompt et dans la validation metier.
    const serialized = JSON.stringify(buildReplanSchema());
    for (const forbidden of ["maxItems", "minItems", "maxLength", "pattern"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });
});
