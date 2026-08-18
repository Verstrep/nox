/**
 * Contrat du backlog de V1.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'un Structured Output conforme au schema peut rester **inacceptable**, et
 * que NOX le refuse : vingt-cinq taches, une reference documentaire inventee,
 * une commande avec un tuyau, un critere manquant. Chacune de ces reponses
 * passerait le mode strict du fournisseur.
 *
 * Et surtout : qu'un backlog est une **unite**. Un seul element fautif condamne
 * toute la proposition — jamais huit taches sur neuf, avec un trou dont
 * personne ne saurait ce qu'il contenait.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARCHITECT_BACKLOG_LIMITS,
  ARCHITECT_BACKLOG_MAX_OUTPUT_TOKENS,
  ARCHITECT_BACKLOG_SCHEMA_VERSION,
  BACKLOG_CODE_PREFIX,
  TASK_PRIORITY,
  buildArchitectBacklogSchema,
  formatBacklogCode,
  isArchitectBacklogGenerationStatus,
  isArchitectBacklogProposalStatus,
  isBacklogContextManifest,
  readArchitectBacklogProposal,
} from "../dist/index.js";

const DOCUMENTS = ["docs/ARCHITECTURE.md", "docs/V1_SCOPE.md", "CLAUDE.md"];

/** Un element valide, dont chaque test ne modifie que ce qui l'interesse. */
function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Poser le schema des repas",
    priority: TASK_PRIORITY.HIGH,
    objective: "Une semaine de repas peut etre enregistree et relue.",
    context: "Rien ne stocke encore les repas.",
    acceptanceCriteria: ["Un repas se cree", "Un repas se relit"],
    outOfScope: ["L'interface"],
    documentReferences: ["docs/ARCHITECTURE.md"],
    validationCommands: ["npm run typecheck"],
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION,
    message: "Ce decoupage couvre les trois etapes du plan.",
    tasks: [task()],
    ...overrides,
  };
}

function read(value: unknown) {
  return readArchitectBacklogProposal(value, DOCUMENTS);
}

describe("code d'une planification", () => {
  it("se derive du numero, sur trois chiffres au moins", () => {
    assert.equal(formatBacklogCode(1), "BACKLOG-001");
    assert.equal(formatBacklogCode(42), "BACKLOG-042");
    assert.equal(formatBacklogCode(1_234), "BACKLOG-1234");
  });

  it("porte le prefixe declare", () => {
    assert.ok(formatBacklogCode(7).startsWith(BACKLOG_CODE_PREFIX));
  });

  it("refuse un numero qui n'en est pas un", () => {
    assert.throws(() => formatBacklogCode(0), RangeError);
    assert.throws(() => formatBacklogCode(-1), RangeError);
    assert.throws(() => formatBacklogCode(1.5), RangeError);
  });
});

describe("statuts", () => {
  it("reconnaissent les valeurs declarees, et elles seules", () => {
    assert.ok(isArchitectBacklogGenerationStatus("READY"));
    assert.ok(isArchitectBacklogGenerationStatus("FAILED"));
    assert.equal(isArchitectBacklogGenerationStatus("APPLIED"), false);

    assert.ok(isArchitectBacklogProposalStatus("PENDING"));
    assert.ok(isArchitectBacklogProposalStatus("DISMISSED"));
    assert.equal(isArchitectBacklogProposalStatus("READY"), false);
  });

  it("n'a pas de statut STALE : la peremption se derive", () => {
    assert.equal(isArchitectBacklogProposalStatus("STALE"), false);
  });
});

describe("lecture d'une proposition valide", () => {
  it("accepte une seule tache", () => {
    const result = read(payload());
    assert.ok(result.ok);
    assert.equal(result.proposal.tasks.length, 1);
    assert.equal(result.proposal.schemaVersion, ARCHITECT_BACKLOG_SCHEMA_VERSION);
  });

  it("accepte plusieurs taches et conserve leur ordre", () => {
    const result = read(
      payload({
        tasks: [
          task({ title: "Premiere" }),
          task({ title: "Deuxieme" }),
          task({ title: "Troisieme" }),
        ],
      }),
    );
    assert.ok(result.ok);
    assert.deepEqual(
      result.proposal.tasks.map((entry) => entry.title),
      ["Premiere", "Deuxieme", "Troisieme"],
    );
  });

  it("accepte le nombre maximal de taches", () => {
    const tasks = Array.from({ length: ARCHITECT_BACKLOG_LIMITS.tasks.max }, (_unused, index) =>
      task({ title: `Tache ${String(index)}` }),
    );
    const result = read(payload({ tasks }));
    assert.ok(result.ok);
    assert.equal(result.proposal.tasks.length, ARCHITECT_BACKLOG_LIMITS.tasks.max);
  });

  it("ramene un contexte vide a l'absence", () => {
    const result = read(payload({ tasks: [task({ context: "" })] }));
    assert.ok(result.ok);
    assert.equal(result.proposal.tasks[0]?.context, null);
  });

  it("retire les doublons d'une liste sans la refuser", () => {
    const result = read(
      payload({ tasks: [task({ acceptanceCriteria: ["Un repas se cree", "Un repas se cree"] })] }),
    );
    assert.ok(result.ok);
    assert.deepEqual(result.proposal.tasks[0]?.acceptanceCriteria, ["Un repas se cree"]);
  });
});

describe("refus d'une proposition", () => {
  it("refuse une reponse qui n'est pas une structure", () => {
    assert.equal(read("un backlog").ok, false);
    assert.equal(read(null).ok, false);
    assert.equal(read([task()]).ok, false);
  });

  it("refuse une version de contrat inattendue", () => {
    const result = read(payload({ schemaVersion: 2 }));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.refusal.field === "schemaVersion");
  });

  it("refuse un message absent ou vide", () => {
    assert.equal(read(payload({ message: "" })).ok, false);
    assert.equal(read(payload({ message: null })).ok, false);
  });

  it("refuse un message trop long", () => {
    const result = read(payload({ message: "a".repeat(ARCHITECT_BACKLOG_LIMITS.message + 1) }));
    assert.equal(result.ok, false);
  });

  it("refuse une liste de taches vide", () => {
    const result = read(payload({ tasks: [] }));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.refusal.field === "tasks");
  });

  it("refuse plus de taches que la borne", () => {
    const tasks = Array.from(
      { length: ARCHITECT_BACKLOG_LIMITS.tasks.max + 1 },
      (_unused, index) => task({ title: `Tache ${String(index)}` }),
    );
    const result = read(payload({ tasks }));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.refusal.message.includes(String(ARCHITECT_BACKLOG_LIMITS.tasks.max)));
  });

  it("refuse tout le backlog quand un seul element est invalide", () => {
    const result = read(
      payload({
        tasks: [task({ title: "Valide" }), task({ title: "" }), task({ title: "Aussi valide" })],
      }),
    );
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.refusal.field === "tasks.1.title");
  });

  it("nomme la tache fautive par son rang affiche", () => {
    const result = read(payload({ tasks: [task(), task(), task({ priority: "URGENT" })] }));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.refusal.message.startsWith("Tache 3"));
  });

  it("refuse un titre absent", () => {
    assert.equal(read(payload({ tasks: [task({ title: null })] })).ok, false);
    assert.equal(read(payload({ tasks: [task({ title: "   " })] })).ok, false);
  });

  it("refuse un titre trop long", () => {
    const result = read(
      payload({ tasks: [task({ title: "a".repeat(ARCHITECT_BACKLOG_LIMITS.title + 1) })] }),
    );
    assert.equal(result.ok, false);
  });

  it("refuse une priorite inconnue", () => {
    const result = read(payload({ tasks: [task({ priority: "URGENT" })] }));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.refusal.field === "tasks.0.priority");
  });

  it("refuse un objectif absent", () => {
    assert.equal(read(payload({ tasks: [task({ objective: "" })] })).ok, false);
  });

  it("refuse une tache sans critere d'acceptation", () => {
    const result = read(payload({ tasks: [task({ acceptanceCriteria: [] })] }));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.refusal.field === "tasks.0.acceptanceCriteria");
  });

  it("refuse trop de criteres", () => {
    const criteria = Array.from(
      { length: ARCHITECT_BACKLOG_LIMITS.criteria.max + 1 },
      (_unused, index) => `Critere ${String(index)}`,
    );
    assert.equal(read(payload({ tasks: [task({ acceptanceCriteria: criteria })] })).ok, false);
  });

  it("refuse un document invente", () => {
    const result = read(
      payload({ tasks: [task({ documentReferences: ["docs/INVENTE.md"] })] }),
    );
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.refusal.message.includes("docs/INVENTE.md"));
  });

  it("refuse un document invente meme au fond d'un backlog valide", () => {
    const result = read(
      payload({
        tasks: [task(), task(), task({ documentReferences: ["docs/AILLEURS.md"] })],
      }),
    );
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.refusal.field === "tasks.2.documentReferences");
  });

  it("refuse une commande avec un operateur shell", () => {
    for (const command of ["npm run lint && npm test", "npm test | tee log", "npm test > out"]) {
      const result = read(payload({ tasks: [task({ validationCommands: [command] })] }));
      assert.equal(result.ok, false, command);
      assert.ok(!result.ok && result.refusal.field === "tasks.0.validationCommands");
    }
  });

  it("refuse trop de commandes", () => {
    const commands = Array.from(
      { length: ARCHITECT_BACKLOG_LIMITS.commands.max + 1 },
      (_unused, index) => `npm run tache-${String(index)}`,
    );
    assert.equal(read(payload({ tasks: [task({ validationCommands: commands })] })).ok, false);
  });

  it("refuse une liste qui n'en est pas une", () => {
    assert.equal(read(payload({ tasks: [task({ acceptanceCriteria: "un critere" })] })).ok, false);
    assert.equal(read(payload({ tasks: [task({ outOfScope: [42] })] })).ok, false);
  });

  it("refuse un element qui n'est pas un objet", () => {
    const result = read(payload({ tasks: ["une tache"] }));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.refusal.field === "tasks.0");
  });
});

describe("deux taches aux titres proches", () => {
  it("ne sont pas refusees par le serveur", () => {
    // Le prompt decourage fortement les doublons ; le serveur ne les interdit
    // pas. Deux increments peuvent legitimement porter des titres voisins, et
    // trancher a leur place demanderait un moteur semantique que TASK-022
    // n'introduit pas. La revue humaine est le vrai filtre.
    const result = read(
      payload({ tasks: [task({ title: "Poser le schema" }), task({ title: "Poser le schema" })] }),
    );
    assert.ok(result.ok);
    assert.equal(result.proposal.tasks.length, 2);
  });
});

describe("schema strict transmis au fournisseur", () => {
  const schema = buildArchitectBacklogSchema();

  it("ferme l'objet racine", () => {
    assert.equal(schema["type"], "object");
    assert.equal(schema["additionalProperties"], false);
    assert.deepEqual(schema["required"], ["schemaVersion", "message", "tasks"]);
  });

  it("declare tous les champs d'une tache comme requis", () => {
    const properties = schema["properties"] as Record<string, Record<string, unknown>>;
    const items = (properties["tasks"] as Record<string, unknown>)["items"] as Record<
      string,
      unknown
    >;
    assert.equal(items["additionalProperties"], false);
    assert.deepEqual(items["required"], [
      "title",
      "priority",
      "objective",
      "context",
      "acceptanceCriteria",
      "outOfScope",
      "documentReferences",
      "validationCommands",
    ]);
  });

  it("ne declare aucune borne de taille", () => {
    // Le mode strict d'OpenAI refuse `maxItems`, `minItems`, `maxLength` et
    // `pattern` : les declarer ferait echouer la requete entiere. Les bornes
    // vivent dans le prompt et dans la validation NOX.
    const serialized = JSON.stringify(schema);
    for (const keyword of ["maxItems", "minItems", "maxLength", "minLength", "pattern"]) {
      assert.equal(serialized.includes(keyword), false, keyword);
    }
  });

  it("fige la version de contrat", () => {
    const properties = schema["properties"] as Record<string, Record<string, unknown>>;
    assert.deepEqual(properties["schemaVersion"]?.["enum"], [ARCHITECT_BACKLOG_SCHEMA_VERSION]);
  });
});

describe("budget de sortie", () => {
  it("couvre tres largement un backlog reel", () => {
    // Vingt taches d'environ 1,5 Kio font 30 Kio, soit a peu pres 10 000 jetons.
    // Le plafond en offre plus du triple.
    const realistic = (ARCHITECT_BACKLOG_LIMITS.tasks.max * 1_536) / 3;
    assert.ok(
      ARCHITECT_BACKLOG_MAX_OUTPUT_TOKENS > realistic * 2,
      "le plafond laisse une marge reelle",
    );
  });

  it("est une constante, jamais une variable d'environnement", () => {
    assert.equal(typeof ARCHITECT_BACKLOG_MAX_OUTPUT_TOKENS, "number");
  });
});

describe("manifest de planification", () => {
  it("reconnait un manifest complet", () => {
    assert.ok(
      isBacklogContextManifest({
        schemaVersion: 1,
        sources: [
          {
            kind: "PROJECT_V1_PLAN",
            identifier: "Living V1 Plan",
            revision: "abc",
            includedChars: 120,
            truncated: false,
          },
        ],
        totalChars: 120,
        missing: [],
        taskInventoryRevision: "def",
      }),
    );
  });

  it("refuse un manifest sans revision d'inventaire", () => {
    assert.equal(
      isBacklogContextManifest({
        schemaVersion: 1,
        sources: [],
        totalChars: 0,
        missing: [],
      }),
      false,
    );
  });

  it("refuse une source d'un genre inconnu", () => {
    assert.equal(
      isBacklogContextManifest({
        schemaVersion: 1,
        sources: [
          { kind: "DIFF", identifier: "x", revision: null, includedChars: 1, truncated: false },
        ],
        totalChars: 1,
        missing: [],
        taskInventoryRevision: "def",
      }),
      false,
    );
  });
});
