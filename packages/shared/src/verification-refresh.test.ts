/**
 * Le contrat d'un rafraichissement de verification.
 *
 * ## Ce que ce fichier prouve
 *
 * Que le fournisseur ne peut **pas** changer le produit ici. Pas « ne devrait
 * pas » : n'a pas la place de l'ecrire, et se fait refuser en entier s'il
 * essaie quand meme.
 *
 * C'est le point de bascule de TASK-033. Le reste — le declencheur,
 * l'idempotence, l'ecriture atomique — repose sur cette garantie : une
 * proposition qui ne peut porter que quatre champs peut s'appliquer sans revue
 * humaine. Si ce fichier s'affaiblit, l'application automatique devient
 * indefendable.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMAND_EXECUTION_MODE,
  MAX_HUMAN_INSTRUCTIONS_LENGTH,
  VERIFICATION_MODE,
  VERIFICATION_REFRESH_MAX_OUTPUT_TOKENS,
  VERIFICATION_REFRESH_PROMPT_VERSION,
  VERIFICATION_REFRESH_SCHEMA_NAME,
  VERIFICATION_REFRESH_SCHEMA_VERSION,
  buildVerificationRefreshSchema,
  readVerificationRefreshProposal,
  renderVerificationRefreshPrompt,
  type VerificationRefreshTarget,
} from "../dist/index.js";

/** Les deux taches du pilote, telles que NOX les connait apres l'amorcage. */
const TARGETS: VerificationRefreshTarget[] = [
  { id: "task-001", code: "TASK-001", criteriaCount: 8 },
  { id: "task-002", code: "TASK-002", criteriaCount: 7 },
];

function criterion(automated: boolean): Record<string, unknown> {
  return automated
    ? {
        verificationMode: VERIFICATION_MODE.AUTOMATED,
        humanInstructions: null,
        validationCommandIndexes: [0],
      }
    : {
        verificationMode: VERIFICATION_MODE.HUMAN,
        humanInstructions: "Ouvrir l'ecran et regarder.",
        validationCommandIndexes: [],
      };
}

const COMMANDS = [
  { command: "npm test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
  { command: "npm run build", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
];

/** La reponse du pilote : 6 AUTO / 2 HUMAN, puis 7 AUTO / 0 HUMAN. */
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: VERIFICATION_REFRESH_SCHEMA_VERSION,
    message: "Le repository porte desormais npm test et npm run build.",
    tasks: [
      {
        taskId: "task-001",
        criteria: [
          criterion(true),
          criterion(true),
          criterion(false),
          criterion(false),
          criterion(true),
          criterion(true),
          criterion(true),
          criterion(true),
        ],
        validationCommands: COMMANDS,
      },
      {
        taskId: "task-002",
        criteria: Array.from({ length: 7 }, () => criterion(true)),
        validationCommands: COMMANDS,
      },
    ],
    ...overrides,
  };
}

describe("le contrat du pilote se lit", () => {
  it("rend 6 automatises et 2 humains sur TASK-001, 7 et 0 sur TASK-002", () => {
    const read = readVerificationRefreshProposal(payload(), TARGETS);
    assert.ok(read.ok);

    const first = read.proposal.tasks[0];
    const second = read.proposal.tasks[1];
    assert.equal(
      first?.criteria.filter((entry) => entry.verificationMode === VERIFICATION_MODE.AUTOMATED)
        .length,
      6,
    );
    assert.equal(
      first?.criteria.filter((entry) => entry.verificationMode === VERIFICATION_MODE.HUMAN).length,
      2,
    );
    assert.equal(
      second?.criteria.filter((entry) => entry.verificationMode === VERIFICATION_MODE.AUTOMATED)
        .length,
      7,
    );
    assert.equal(
      second?.criteria.filter((entry) => entry.verificationMode === VERIFICATION_MODE.HUMAN).length,
      0,
    );
  });

  it("accepte qu'une tache soit omise : elle reste telle quelle", () => {
    const read = readVerificationRefreshProposal(
      { ...payload(), tasks: [(payload()["tasks"] as unknown[])[0]] },
      TARGETS,
    );
    assert.ok(read.ok);
    assert.equal(read.proposal.tasks.length, 1);
  });

  it("ne transporte aucun texte de critere", () => {
    // La garantie « criteria text byte-identical » n'est pas une comparaison :
    // le texte n'a jamais quitte NOX, et n'a donc aucun chemin de retour.
    const read = readVerificationRefreshProposal(payload(), TARGETS);
    assert.ok(read.ok);
    for (const task of read.proposal.tasks) {
      for (const entry of task.criteria) {
        assert.equal("text" in entry, false);
      }
    }
  });
});

describe("le provider ne peut pas changer le produit", () => {
  const forbidden: Record<string, unknown>[] = [
    { title: "Un autre titre" },
    { objective: "Un autre objectif" },
    { context: "Un autre contexte" },
    { outOfScope: ["Autre chose"] },
    { priority: "HIGH" },
    { documentReferences: ["docs/A.md"] },
    { dependsOn: ["task-001"] },
    { position: 3 },
    { status: "READY" },
  ];

  for (const extra of forbidden) {
    const field = Object.keys(extra)[0] ?? "";
    it(`refuse la proposition entiere si elle porte « ${field} »`, () => {
      const body = payload();
      const tasks = body["tasks"] as Record<string, unknown>[];
      tasks[0] = { ...tasks[0], ...extra };

      const read = readVerificationRefreshProposal(body, TARGETS);
      assert.ok(!read.ok, field);
      // Nomme, jamais ignore : un champ ecarte en silence est exactement ce qui
      // laisserait passer un `title` un jour.
      assert.ok(read.refusal.message.includes(field), read.refusal.message);
      assert.match(read.refusal.message, /hors contrat/u);
    });
  }

  it("refuse un texte de critere renvoye", () => {
    const body = payload();
    const tasks = body["tasks"] as Record<string, unknown>[];
    const criteria = tasks[0]?.["criteria"] as Record<string, unknown>[];
    criteria[0] = { ...criteria[0], text: "Un critere reecrit" };

    const read = readVerificationRefreshProposal(body, TARGETS);
    assert.ok(!read.ok);
    assert.match(read.refusal.message, /ne touche ni au texte d'un critere, ni a sa place/u);
  });

  it("refuse un champ inconnu a la racine", () => {
    const read = readVerificationRefreshProposal(
      { ...payload(), replan: { mode: "PROPOSED" } },
      TARGETS,
    );
    assert.ok(!read.ok);
    assert.equal(read.refusal.field, "replan");
  });

  it("refuse un nombre de criteres different du contrat", () => {
    const body = payload();
    const tasks = body["tasks"] as Record<string, unknown>[];
    tasks[1] = { ...tasks[1], criteria: [criterion(true)] };

    const read = readVerificationRefreshProposal(body, TARGETS);
    assert.ok(!read.ok);
    assert.match(read.refusal.message, /ne cree, ne retire et ne reordonne aucun critere/u);
  });

  it("refuse une tache qui n'est pas replanifiable", () => {
    const body = payload();
    const tasks = body["tasks"] as Record<string, unknown>[];
    tasks[0] = { ...tasks[0], taskId: "task-000" };

    const read = readVerificationRefreshProposal(body, TARGETS);
    assert.ok(!read.ok);
    assert.match(read.refusal.message, /n'est pas replanifiable/u);
  });

  it("refuse la meme tache deux fois", () => {
    const body = payload();
    const tasks = body["tasks"] as Record<string, unknown>[];
    tasks[1] = { ...tasks[0] };

    const read = readVerificationRefreshProposal(body, TARGETS);
    assert.ok(!read.ok);
    assert.match(read.refusal.message, /deux fois/u);
  });
});

describe("les gardes de verification restent celles de TASK-027", () => {
  it("refuse un critere automatise sans preuve", () => {
    const body = payload();
    const tasks = body["tasks"] as Record<string, unknown>[];
    const criteria = tasks[1]?.["criteria"] as Record<string, unknown>[];
    criteria[0] = { ...criterion(true), validationCommandIndexes: [] };

    const read = readVerificationRefreshProposal(body, TARGETS);
    assert.ok(!read.ok);
    assert.match(read.refusal.message, /ne designe aucune commande/u);
  });

  it("refuse une preuve qui n'est pas autonome", () => {
    const body = payload();
    const tasks = body["tasks"] as Record<string, unknown>[];
    tasks[1] = {
      ...tasks[1],
      validationCommands: [{ command: "npm test", executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY }],
    };

    const read = readVerificationRefreshProposal(body, TARGETS);
    assert.ok(!read.ok);
    assert.match(read.refusal.message, /que NOX n'executera pas/u);
  });

  it("refuse un critere humain sans consigne", () => {
    const body = payload();
    const tasks = body["tasks"] as Record<string, unknown>[];
    const criteria = tasks[0]?.["criteria"] as Record<string, unknown>[];
    criteria[2] = { ...criterion(false), humanInstructions: "" };

    const read = readVerificationRefreshProposal(body, TARGETS);
    assert.ok(!read.ok);
  });

  it("refuse un critere humain qui nomme une commande", () => {
    const body = payload();
    const tasks = body["tasks"] as Record<string, unknown>[];
    const criteria = tasks[0]?.["criteria"] as Record<string, unknown>[];
    criteria[2] = { ...criterion(false), validationCommandIndexes: [0] };

    const read = readVerificationRefreshProposal(body, TARGETS);
    assert.ok(!read.ok);
    assert.match(read.refusal.message, /un jugement humain ne se prouve pas par une commande/u);
  });

  it("refuse une commande que NOX ne saurait pas lancer seul", () => {
    for (const command of ["npm run dev", "npm install", "git status"]) {
      const body = payload();
      const tasks = body["tasks"] as Record<string, unknown>[];
      tasks[1] = {
        ...tasks[1],
        validationCommands: [{ command, executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS }],
      };
      const read = readVerificationRefreshProposal(body, TARGETS);
      assert.ok(!read.ok, command);
    }
  });

  it("refuse un operateur shell dans une commande", () => {
    const body = payload();
    const tasks = body["tasks"] as Record<string, unknown>[];
    tasks[1] = {
      ...tasks[1],
      validationCommands: [
        { command: "npm test 2>&1 | tail -60", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
      ],
    };
    const read = readVerificationRefreshProposal(body, TARGETS);
    assert.ok(!read.ok);
  });
});

describe("le schema n'offre pas la place", () => {
  const schema = buildVerificationRefreshSchema();
  const serialized = JSON.stringify(schema);

  it("ne declare aucun champ de produit", () => {
    for (const forbidden of [
      "title",
      "objective",
      "outOfScope",
      "documentReferences",
      "dependsOn",
      "priority",
      "planningOrder",
      "status",
    ]) {
      assert.equal(serialized.includes(`"${forbidden}"`), false, forbidden);
    }
  });

  it("ferme chaque objet", () => {
    const tasks = (schema["properties"] as Record<string, unknown>)["tasks"] as Record<
      string,
      unknown
    >;
    const item = tasks["items"] as Record<string, unknown>;
    assert.equal(schema["additionalProperties"], false);
    assert.equal(item["additionalProperties"], false);
    const criteria = (item["properties"] as Record<string, unknown>)["criteria"] as Record<
      string,
      unknown
    >;
    assert.equal((criteria["items"] as Record<string, unknown>)["additionalProperties"], false);
  });

  it("ne declare aucune borne de taille", () => {
    for (const forbidden of ["maxItems", "minItems", "maxLength", "pattern"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });

  it("porte un nom et une version stables, et un plafond plus bas qu'une planification", () => {
    assert.equal(VERIFICATION_REFRESH_SCHEMA_NAME, "nox_verification_refresh");
    assert.equal(VERIFICATION_REFRESH_SCHEMA_VERSION, 1);
    assert.equal(VERIFICATION_REFRESH_PROMPT_VERSION, "verification-refresh/1");
    assert.ok(
      VERIFICATION_REFRESH_MAX_OUTPUT_TOKENS < 32_000,
      "« beaucoup plus borne » se mesure en jetons, pas en intentions",
    );
  });
});

describe("le prompt dit exactement ce qui est permis", () => {
  const prompt = renderVerificationRefreshPrompt({
    projectName: "TripKit",
    projectBrief: null,
    projectV1Plan: null,
    documents: [
      { path: "README.md", revision: "a".repeat(64), truncated: false, content: "npm test" },
    ],
    repositoryMarkers: ["package.json"],
    knownCommands: ["npm run build"],
    editableTasks: [],
  });

  it("est deterministe", () => {
    const again = renderVerificationRefreshPrompt({
      projectName: "TripKit",
      projectBrief: null,
      projectV1Plan: null,
      documents: [
        { path: "README.md", revision: "a".repeat(64), truncated: false, content: "npm test" },
      ],
      repositoryMarkers: ["package.json"],
      knownCommands: ["npm run build"],
      editableTasks: [],
    });
    assert.equal(prompt.instructions, again.instructions);
    assert.equal(prompt.input, again.input);
  });

  it("enumere les quatre champs modifiables", () => {
    assert.match(prompt.instructions, /le mode de verification de chaque critere/u);
    assert.match(prompt.instructions, /la consigne humaine/u);
    assert.match(prompt.instructions, /les commandes de validation d'une tache/u);
    assert.match(prompt.instructions, /le lien entre un critere `AUTOMATED`/u);
  });

  it("enumere ce qui ne se change pas", () => {
    assert.match(prompt.instructions, /Ni titre, ni priorite, ni objectif/u);
    assert.match(prompt.instructions, /ni ordre des taches, ni/u);
    assert.match(prompt.instructions, /Une reponse qui en porterait un serait refusee en entier/u);
  });

  it("dit qu'une tache omise reste telle quelle", () => {
    assert.match(prompt.instructions, /Une tache absente de ta/u);
  });

  it("interdit d'inventer une commande", () => {
    assert.match(prompt.instructions, /reellement presentes/u);
    assert.match(prompt.instructions, /N'en invente aucune/u);
  });

  it("garde la consigne conservatrice de TASK-027", () => {
    assert.match(prompt.instructions, /cette commande\n\s*precise echouerait-elle/u);
    assert.match(prompt.instructions, /garde `HUMAN`/u);
    assert.ok(prompt.instructions.includes(String(MAX_HUMAN_INSTRUCTIONS_LENGTH)));
  });

  it("transmet la documentation et les commandes deja connues", () => {
    assert.match(prompt.input, /README\.md/u);
    assert.match(prompt.input, /npm run build/u);
    assert.match(prompt.input, /package\.json/u);
  });
});
