/**
 * Contrat `backlog/2` : la classification entre dans la proposition.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'un backlog ne peut pas se declarer automatise sans preuve, ni s'appuyer sur
 * une commande que NOX n'executera jamais. C'est la garantie centrale de
 * TASK-027 au niveau du planificateur : une classification qui n'engage rien
 * serait pire que pas de classification du tout.
 *
 * Que le contrat historique reste lisible, et qu'il est releve avec les
 * **defauts surs** — jamais avec une classification devinee.
 *
 * Et qu'un seul element invalide condamne toute la proposition : un backlog est
 * une unite.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARCHITECT_BACKLOG_SCHEMA_VERSION,
  ARCHITECT_BACKLOG_SCHEMA_VERSION_2,
  ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
  COMMAND_EXECUTION_MODE,
  DEFAULT_HUMAN_INSTRUCTIONS,
  MAX_AUTONOMOUS_COMMANDS_PER_RUN,
  MAX_HUMAN_INSTRUCTIONS_LENGTH,
  TASK_PRIORITY,
  VERIFICATION_MODE,
  buildArchitectBacklogSchemaV2,
  readAnyArchitectBacklogProposal,
  readArchitectBacklogProposalV2,
  upgradeBacklogProposal,
} from "../dist/index.js";

const DOCUMENTS = ["docs/ARCHITECTURE.md"];

function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Poser le domaine",
    priority: TASK_PRIORITY.MEDIUM,
    objective: "Un repas se cree et se relit.",
    context: null,
    acceptanceCriteria: [
      {
        text: "Un repas peut etre cree.",
        verificationMode: VERIFICATION_MODE.HUMAN,
        humanInstructions: "Creer un repas depuis l'ecran.",
        validationCommandIndexes: [],
      },
    ],
    outOfScope: [],
    documentReferences: [],
    validationCommands: [],
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION_2,
    message: "Ce decoupage couvre la premiere etape du plan.",
    tasks: [task()],
    ...overrides,
  };
}

describe("lecture d'une proposition backlog/2", () => {
  it("accepte un backlog entierement humain", () => {
    const read = readArchitectBacklogProposalV2(payload(), DOCUMENTS);
    assert.ok(read.ok);
    assert.equal(read.proposal.tasks[0]?.acceptanceCriteria[0]?.verificationMode, "HUMAN");
  });

  it("accepte un critere automatise prouve par une commande autonome", () => {
    const read = readArchitectBacklogProposalV2(
      payload({
        tasks: [
          task({
            validationCommands: [
              { command: "npm test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
            ],
            acceptanceCriteria: [
              {
                text: "La suite passe.",
                verificationMode: VERIFICATION_MODE.AUTOMATED,
                humanInstructions: null,
                validationCommandIndexes: [0],
              },
            ],
          }),
        ],
      }),
      DOCUMENTS,
    );
    assert.ok(read.ok);
    assert.deepEqual(read.proposal.tasks[0]?.acceptanceCriteria[0]?.validationCommandIndexes, [0]);
  });

  it("refuse un critere automatise sans preuve", () => {
    // Une classification qui n'engage rien serait pire que pas de
    // classification : elle donnerait a NOX le droit de conclure sans rien.
    const read = readArchitectBacklogProposalV2(
      payload({
        tasks: [
          task({
            acceptanceCriteria: [
              {
                text: "La suite passe.",
                verificationMode: VERIFICATION_MODE.AUTOMATED,
                humanInstructions: null,
                validationCommandIndexes: [],
              },
            ],
          }),
        ],
      }),
      DOCUMENTS,
    );
    assert.equal(read.ok, false);
  });

  it("refuse une preuve qui n'est pas une commande autonome", () => {
    const read = readArchitectBacklogProposalV2(
      payload({
        tasks: [
          task({
            validationCommands: [
              { command: "npm test", executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY },
            ],
            acceptanceCriteria: [
              {
                text: "La suite passe.",
                verificationMode: VERIFICATION_MODE.AUTOMATED,
                humanInstructions: null,
                validationCommandIndexes: [0],
              },
            ],
          }),
        ],
      }),
      DOCUMENTS,
    );
    assert.equal(read.ok, false);
  });

  it("refuse une preuve qui designe une commande inexistante", () => {
    const read = readArchitectBacklogProposalV2(
      payload({
        tasks: [
          task({
            acceptanceCriteria: [
              {
                text: "La suite passe.",
                verificationMode: VERIFICATION_MODE.AUTOMATED,
                humanInstructions: null,
                validationCommandIndexes: [3],
              },
            ],
          }),
        ],
      }),
      DOCUMENTS,
    );
    assert.equal(read.ok, false);
  });

  it("refuse un critere humain sans instruction", () => {
    const read = readArchitectBacklogProposalV2(
      payload({
        tasks: [
          task({
            acceptanceCriteria: [
              {
                text: "L'ecran est lisible.",
                verificationMode: VERIFICATION_MODE.HUMAN,
                humanInstructions: null,
                validationCommandIndexes: [],
              },
            ],
          }),
        ],
      }),
      DOCUMENTS,
    );
    assert.equal(read.ok, false);
  });

  it("refuse un critere humain qui nomme des commandes", () => {
    const read = readArchitectBacklogProposalV2(
      payload({
        tasks: [
          task({
            validationCommands: [
              { command: "npm test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
            ],
            acceptanceCriteria: [
              {
                text: "L'ecran est lisible.",
                verificationMode: VERIFICATION_MODE.HUMAN,
                humanInstructions: "Regarder.",
                validationCommandIndexes: [0],
              },
            ],
          }),
        ],
      }),
      DOCUMENTS,
    );
    assert.equal(read.ok, false);
  });

  it("refuse une instruction humaine trop longue", () => {
    const read = readArchitectBacklogProposalV2(
      payload({
        tasks: [
          task({
            acceptanceCriteria: [
              {
                text: "L'ecran est lisible.",
                verificationMode: VERIFICATION_MODE.HUMAN,
                humanInstructions: "x".repeat(MAX_HUMAN_INSTRUCTIONS_LENGTH + 1),
                validationCommandIndexes: [],
              },
            ],
          }),
        ],
      }),
      DOCUMENTS,
    );
    assert.equal(read.ok, false);
  });

  it("refuse un mode de verification invente", () => {
    const read = readArchitectBacklogProposalV2(
      payload({
        tasks: [
          task({
            acceptanceCriteria: [
              {
                text: "Peut-etre.",
                verificationMode: "MAYBE",
                humanInstructions: "Regarder.",
                validationCommandIndexes: [],
              },
            ],
          }),
        ],
      }),
      DOCUMENTS,
    );
    assert.equal(read.ok, false);
  });

  it("refuse une commande sans mode d'execution", () => {
    const read = readArchitectBacklogProposalV2(
      payload({ tasks: [task({ validationCommands: [{ command: "npm test" }] })] }),
      DOCUMENTS,
    );
    assert.equal(read.ok, false);
  });

  it("refuse une commande chainee, comme en version 1", () => {
    const read = readArchitectBacklogProposalV2(
      payload({
        tasks: [
          task({
            validationCommands: [
              { command: "npm test && rm -rf .", executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY },
            ],
          }),
        ],
      }),
      DOCUMENTS,
    );
    assert.equal(read.ok, false);
  });

  it("refuse une commande autonome que NOX n'a pas le droit de lancer", () => {
    for (const command of ["npm install", "git push", "npm run dev", "sudo make"]) {
      const read = readArchitectBacklogProposalV2(
        payload({
          tasks: [
            task({
              validationCommands: [
                { command, executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
              ],
            }),
          ],
        }),
        DOCUMENTS,
      );
      assert.equal(read.ok, false, command);
    }
  });

  it("accepte la meme commande en mode agent seul", () => {
    // `npm install` n'a rien d'interdit a l'implementeur : ce qui est refuse,
    // c'est que **NOX** la lance de lui-meme.
    const read = readArchitectBacklogProposalV2(
      payload({
        tasks: [
          task({
            validationCommands: [
              { command: "npm install", executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY },
            ],
          }),
        ],
      }),
      DOCUMENTS,
    );
    assert.ok(read.ok);
  });

  it("refuse plus de validations autonomes qu'une execution n'en accepte", () => {
    const commands = Array.from({ length: MAX_AUTONOMOUS_COMMANDS_PER_RUN + 1 }, (_u, index) => ({
      command: `npm run check-${String(index)}`,
      executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS,
    }));
    const read = readArchitectBacklogProposalV2(
      payload({ tasks: [task({ validationCommands: commands })] }),
      DOCUMENTS,
    );
    assert.equal(read.ok, false);
  });

  it("refuse un document invente", () => {
    const read = readArchitectBacklogProposalV2(
      payload({ tasks: [task({ documentReferences: ["docs/INVENTE.md"] })] }),
      DOCUMENTS,
    );
    assert.equal(read.ok, false);
  });

  it("refuse tout le backlog quand un seul element est invalide", () => {
    const read = readArchitectBacklogProposalV2(
      payload({
        tasks: [
          task(),
          task({
            acceptanceCriteria: [
              {
                text: "La suite passe.",
                verificationMode: VERIFICATION_MODE.AUTOMATED,
                humanInstructions: null,
                validationCommandIndexes: [],
              },
            ],
          }),
        ],
      }),
      DOCUMENTS,
    );
    assert.equal(read.ok, false);
  });

  it("refuse une reponse qui declare la version 1", () => {
    const read = readArchitectBacklogProposalV2(
      payload({ schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION }),
      DOCUMENTS,
    );
    assert.equal(read.ok, false);
  });
});

describe("compatibilite backlog/1", () => {
  const v1 = {
    schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION,
    message: "Ancien backlog.",
    tasks: [
      {
        title: "Poser le domaine",
        priority: TASK_PRIORITY.MEDIUM,
        objective: "Un repas se cree et se relit.",
        context: null,
        acceptanceCriteria: ["Un repas peut etre cree."],
        outOfScope: [],
        documentReferences: [],
        validationCommands: ["npm test"],
      },
    ],
  };

  it("releve une proposition historique avec les defauts surs", () => {
    const read = readAnyArchitectBacklogProposal(v1, DOCUMENTS);
    assert.ok(read.ok);

    const first = read.proposal.tasks[0];
    // La forme rendue est **toujours** la forme courante : une proposition de
    // `backlog/1` est relevee jusqu'a la version 3, jamais reecrite en base.
    assert.equal(read.proposal.schemaVersion, ARCHITECT_BACKLOG_SCHEMA_VERSION_3);
    assert.deepEqual(
      first?.dependsOn,
      [],
      "une proposition d'avant TASK-033 n'a jamais exprime de dependance",
    );
    assert.equal(first?.acceptanceCriteria[0]?.verificationMode, VERIFICATION_MODE.HUMAN);
    assert.equal(first?.acceptanceCriteria[0]?.humanInstructions, DEFAULT_HUMAN_INSTRUCTIONS);
    assert.deepEqual(first?.acceptanceCriteria[0]?.validationCommandIndexes, []);
    assert.equal(
      first?.validationCommands[0]?.executionMode,
      COMMAND_EXECUTION_MODE.AGENT_ONLY,
      "une proposition d'avant TASK-027 ne gagne aucun droit apres coup",
    );
  });

  it("ne releve rien d'invalide", () => {
    const read = readAnyArchitectBacklogProposal(
      { ...v1, tasks: [{ ...v1.tasks[0], acceptanceCriteria: [] }] },
      DOCUMENTS,
    );
    assert.equal(read.ok, false);
  });

  it("laisse la version 2 telle quelle", () => {
    const read = readAnyArchitectBacklogProposal(payload(), DOCUMENTS);
    assert.ok(read.ok);
    assert.equal(read.proposal.tasks[0]?.acceptanceCriteria[0]?.humanInstructions, "Creer un repas depuis l'ecran.");
  });

  it("est idempotente sur une proposition deja relevee", () => {
    const once = upgradeBacklogProposal({
      schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION,
      message: v1.message,
      tasks: v1.tasks.map((entry) => ({ ...entry, priority: TASK_PRIORITY.MEDIUM })),
    });
    const read = readArchitectBacklogProposalV2(once, DOCUMENTS);
    assert.ok(read.ok);
    assert.deepEqual(read.proposal, once);
  });
});

describe("schema transmis au fournisseur", () => {
  it("decrit exactement ce que la validation accepte", () => {
    const schema = buildArchitectBacklogSchemaV2();
    const properties = schema["properties"] as Record<string, unknown>;
    const tasks = properties["tasks"] as Record<string, unknown>;
    const items = tasks["items"] as Record<string, unknown>;
    const fields = items["properties"] as Record<string, unknown>;

    const criterion = (fields["acceptanceCriteria"] as Record<string, unknown>)["items"] as Record<
      string,
      unknown
    >;
    const criterionFields = criterion["properties"] as Record<string, unknown>;
    assert.deepEqual((criterionFields["verificationMode"] as Record<string, unknown>)["enum"], [
      VERIFICATION_MODE.AUTOMATED,
      VERIFICATION_MODE.HUMAN,
    ]);

    const command = (fields["validationCommands"] as Record<string, unknown>)["items"] as Record<
      string,
      unknown
    >;
    const commandFields = command["properties"] as Record<string, unknown>;
    assert.deepEqual((commandFields["executionMode"] as Record<string, unknown>)["enum"], [
      COMMAND_EXECUTION_MODE.AGENT_ONLY,
      COMMAND_EXECUTION_MODE.AUTONOMOUS,
    ]);

    assert.deepEqual((properties["schemaVersion"] as Record<string, unknown>)["enum"], [2]);
  });

  it("ne declare aucune borne de taille", () => {
    // Le sous-ensemble de JSON Schema accepte en mode strict les ignore, et les
    // declarer ferait echouer la requete entiere.
    const text = JSON.stringify(buildArchitectBacklogSchemaV2());
    for (const forbidden of ["maxItems", "minItems", "maxLength", "minLength", "pattern"]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });
});
