/**
 * Le tour d'une conversation projet, version 4.
 *
 * Deux garanties se croisent ici, et elles comptent autant l'une que l'autre :
 *
 * - un tour **peut** proposer une mise a jour du projet et une replanification
 *   ensemble — c'est le cas central de TASK-032 ;
 * - un tour enregistre en version 2 ou 3 reste lisible **exactement** comme
 *   avant. NOX ne migre aucun payload : un tour dit quelle version il suivait,
 *   et se relit avec elle.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARCHITECT_PROMPT_VERSION,
  ARCHITECT_PROMPT_VERSION_V4,
  ARCHITECT_PROMPT_VERSION_V5,
  ARCHITECT_PROMPT_VERSION_V6,
  ARCHITECT_SESSION_KIND,
  ARCHITECT_TURN_SCHEMA_VERSION,
  ARCHITECT_TURN_SCHEMA_VERSION_V3,
  ARCHITECT_TURN_SCHEMA_VERSION_V4,
  ARCHITECT_TURN_STATE,
  PROJECT_UPDATE_ACTION,
  REPLAN_MODE,
  architectPromptVersion,
  architectTurnSchemaVersion,
  buildArchitectTurnSchema,
  readArchitectTurn,
  type ReplanSourceState,
} from "../dist/index.js";

const SOURCE: ReplanSourceState = {
  editable: [{ id: "t-006", code: "TASK-006", dependsOnTaskIds: [] }],
  locked: [{ id: "t-003", code: "TASK-003", dependsOnTaskIds: [] }],
};

const REPLAN = {
  mode: REPLAN_MODE.PROPOSED,
  rationale: "L'utilisateur abandonne l'export PDF.",
  futureTasks: [
    {
      existingTaskId: "TASK-006",
      tempId: null,
      title: "Partager une liste par lien",
      priority: "MEDIUM",
      objective: "Permettre le partage par lien.",
      context: null,
      acceptanceCriteria: [
        {
          text: "Le lien ouvre la liste.",
          verificationMode: "HUMAN",
          humanInstructions: "Ouvrir le lien.",
          validationCommandIndexes: [],
        },
      ],
      outOfScope: [],
      documentReferences: [],
      validationCommands: [],
      dependsOn: ["TASK-003"],
    },
  ],
};

const PROJECT_UPDATE = {
  reason: "Le perimetre change.",
  brief: { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null },
  plan: {
    action: PROJECT_UPDATE_ACTION.SET,
    value: {
      goal: "Partager une liste de lecture.",
      inScope: ["Partage par lien"],
      outOfScope: ["Export PDF"],
      technicalDirection: "Application web simple.",
      milestones: ["Le partage est utilisable"],
    },
  },
};

function turn(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: ARCHITECT_TURN_SCHEMA_VERSION_V4,
    state: ARCHITECT_TURN_STATE.CONTINUE,
    message: "Voici ce que je propose.",
    questions: [],
    proposal: null,
    projectUpdate: null,
    replan: null,
    ...overrides,
  };
}

describe("version du contrat", () => {
  it("depend du role de la session et de ce qui est transmis", () => {
    assert.equal(
      architectTurnSchemaVersion(ARCHITECT_SESSION_KIND.TASK_DESIGN_LEGACY, true),
      ARCHITECT_TURN_SCHEMA_VERSION,
    );
    assert.equal(
      architectTurnSchemaVersion(ARCHITECT_SESSION_KIND.PROJECT, false),
      ARCHITECT_TURN_SCHEMA_VERSION_V3,
    );
    assert.equal(
      architectTurnSchemaVersion(ARCHITECT_SESSION_KIND.PROJECT, true),
      ARCHITECT_TURN_SCHEMA_VERSION_V4,
    );
  });

  it("etiquette le prompt de la version dont il porte les regles", () => {
    // Un projet sans plan transmis ne recoit pas les consignes de
    // replanification : il parle donc encore `architect/4`.
    assert.equal(
      architectPromptVersion(ARCHITECT_SESSION_KIND.TASK_DESIGN_LEGACY),
      ARCHITECT_PROMPT_VERSION,
    );
    assert.equal(
      architectPromptVersion(ARCHITECT_SESSION_KIND.PROJECT, false),
      ARCHITECT_PROMPT_VERSION_V4,
    );
    // `architect/6` depuis TASK-033 : les consignes de dependance disent ce
    // qu'une dependance **est**, la ou `architect/5` n'en decrivait que la
    // syntaxe. Les generations deja enregistrees gardent leur version.
    assert.equal(
      architectPromptVersion(ARCHITECT_SESSION_KIND.PROJECT, true),
      ARCHITECT_PROMPT_VERSION_V6,
    );
    assert.notEqual(ARCHITECT_PROMPT_VERSION_V6, ARCHITECT_PROMPT_VERSION_V5);
  });
});

describe("schema strict du tour", () => {
  it("n'ouvre le champ replan qu'en version 4", () => {
    for (const schema of [
      buildArchitectTurnSchema(ARCHITECT_TURN_SCHEMA_VERSION),
      buildArchitectTurnSchema(ARCHITECT_TURN_SCHEMA_VERSION_V3),
    ]) {
      assert.equal((schema["required"] as string[]).includes("replan"), false);
    }

    const v4 = buildArchitectTurnSchema(ARCHITECT_TURN_SCHEMA_VERSION_V4);
    assert.ok((v4["required"] as string[]).includes("replan"));
    assert.ok((v4["required"] as string[]).includes("projectUpdate"));
  });
});

describe("lecture d'un tour version 4", () => {
  it("lit un tour sans replanification", () => {
    const result = readArchitectTurn(turn(), [], ARCHITECT_TURN_SCHEMA_VERSION_V4, SOURCE);
    assert.ok(result.ok);
    assert.equal(result.turn.replan.mode, REPLAN_MODE.UNCHANGED);
  });

  it("lit une replanification proposee", () => {
    const result = readArchitectTurn(
      turn({ replan: REPLAN }),
      [],
      ARCHITECT_TURN_SCHEMA_VERSION_V4,
      SOURCE,
    );
    assert.ok(result.ok);
    assert.equal(result.turn.replan.mode, REPLAN_MODE.PROPOSED);
  });

  it("lit une mise a jour du projet et une replanification dans le meme tour", () => {
    // Le cas central de TASK-032 : une decision qui change le perimetre change
    // generalement le plan **et** ce qui reste a faire.
    const result = readArchitectTurn(
      turn({ projectUpdate: PROJECT_UPDATE, replan: REPLAN }),
      [],
      ARCHITECT_TURN_SCHEMA_VERSION_V4,
      SOURCE,
    );
    assert.ok(result.ok);
    assert.notEqual(result.turn.projectUpdate, null);
    assert.equal(result.turn.replan.mode, REPLAN_MODE.PROPOSED);
  });

  it("refuse une replanification quand le projet n'en autorise aucune", () => {
    // Sans etat source, NOX ne saurait dire ni ce qui est modifiable, ni ce qui
    // existe. Il refuse plutot que de valider contre rien.
    const result = readArchitectTurn(
      turn({ replan: REPLAN }),
      [],
      ARCHITECT_TURN_SCHEMA_VERSION_V4,
      null,
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.refusal.field, "replan");
  });

  it("fait tomber le tour entier quand la replanification est invalide", () => {
    const result = readArchitectTurn(
      turn({
        replan: {
          ...REPLAN,
          futureTasks: [{ ...REPLAN.futureTasks[0], existingTaskId: "TASK-003" }],
        },
      }),
      [],
      ARCHITECT_TURN_SCHEMA_VERSION_V4,
      SOURCE,
    );
    assert.equal(result.ok, false);
  });
});

describe("compatibilite historique", () => {
  it("lit un tour version 3 sans jamais voir de replanification", () => {
    const result = readArchitectTurn(
      {
        schemaVersion: ARCHITECT_TURN_SCHEMA_VERSION_V3,
        state: ARCHITECT_TURN_STATE.CONTINUE,
        message: "Reponse historique.",
        questions: [],
        proposal: null,
        projectUpdate: PROJECT_UPDATE,
        // Un fournisseur qui en rendrait une malgre tout est simplement ignore :
        // la version 3 n'a jamais eu le droit d'en proposer.
        replan: REPLAN,
      },
      [],
      ARCHITECT_TURN_SCHEMA_VERSION_V3,
      SOURCE,
    );

    assert.ok(result.ok);
    assert.equal(result.turn.replan.mode, REPLAN_MODE.UNCHANGED);
    assert.notEqual(result.turn.projectUpdate, null);
  });

  it("lit un tour version 2 sans mise a jour ni replanification", () => {
    const result = readArchitectTurn(
      {
        schemaVersion: ARCHITECT_TURN_SCHEMA_VERSION,
        state: ARCHITECT_TURN_STATE.CONTINUE,
        message: "Reponse d'une session de conception.",
        questions: [],
        proposal: null,
      },
      [],
      ARCHITECT_TURN_SCHEMA_VERSION,
      SOURCE,
    );

    assert.ok(result.ok);
    assert.equal(result.turn.projectUpdate, null);
    assert.equal(result.turn.replan.mode, REPLAN_MODE.UNCHANGED);
  });

  it("refuse un tour dont la version ne correspond pas a celle attendue", () => {
    const result = readArchitectTurn(turn(), [], ARCHITECT_TURN_SCHEMA_VERSION_V3, SOURCE);
    assert.equal(result.ok, false);
  });
});
