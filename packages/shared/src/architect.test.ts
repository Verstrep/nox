/**
 * Tests du contrat de l'Architecte.
 *
 * La garantie centrale : **le Structured Output ne dispense d'aucune
 * validation**. Chaque cas ci-dessous decrit une reponse qui respecterait un
 * schema strict tout en etant inacceptable pour NOX — une reference inventee,
 * une commande avec un tuyau, douze questions au lieu de cinq.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARCHITECT_LIMITS,
  ARCHITECT_PROPOSAL_STATUS,
  ARCHITECT_SCHEMA_VERSION,
  buildArchitectProposalSchema,
  checkArchitectText,
  isArchitectContextManifest,
  normalizeArchitectText,
  readArchitectProposal,
} from "../dist/index.js";

const DOCUMENTS = ["CLAUDE.md", "docs/ARCHITECTURE.md", "docs/PROJECT_STATE.md"];

/** Proposition prete minimale, a laquelle chaque test applique sa variation. */
function ready(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: ARCHITECT_SCHEMA_VERSION,
    status: ARCHITECT_PROPOSAL_STATUS.PROPOSAL_READY,
    title: "Exporter les taches d'un projet en JSON",
    priority: "MEDIUM",
    objective: "Permettre le telechargement des taches d'un projet.",
    context: "Le backlog n'est consultable que depuis l'interface.",
    acceptanceCriteria: ["Un bouton telecharge un fichier JSON."],
    outOfScope: ["Import JSON"],
    documentReferences: ["docs/ARCHITECTURE.md"],
    validationCommands: ["npm run test"],
    assumptions: ["Le format n'a pas besoin d'etre stable entre versions."],
    questions: [],
    ...overrides,
  };
}

function read(value: unknown) {
  return readArchitectProposal(value, DOCUMENTS);
}

describe("readArchitectProposal — proposition prete", () => {
  it("accepte une proposition complete", () => {
    const result = read(ready());
    assert.ok(result.ok);
    assert.equal(result.proposal.status, ARCHITECT_PROPOSAL_STATUS.PROPOSAL_READY);
    assert.equal(result.proposal.title, "Exporter les taches d'un projet en JSON");
    assert.deepEqual(result.proposal.validationCommands, ["npm run test"]);
  });

  it("ecarte les questions d'une proposition prete", () => {
    // Une proposition prete n'attend rien : conserver des questions ferait
    // afficher un formulaire de reponse pour une tache deja proposee.
    const result = read(ready({ questions: ["Vraiment ?"] }));
    assert.ok(result.ok);
    assert.deepEqual(result.proposal.questions, []);
  });

  it("refuse une proposition prete sans titre", () => {
    const result = read(ready({ title: null }));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.refusal.field, "title");
  });

  it("refuse une proposition prete sans objectif", () => {
    assert.equal(read(ready({ objective: null })).ok, false);
  });

  it("refuse une proposition prete sans priorite", () => {
    assert.equal(read(ready({ priority: null })).ok, false);
  });

  it("refuse une proposition prete sans critere", () => {
    const result = read(ready({ acceptanceCriteria: [] }));
    assert.equal(result.ok ? null : result.refusal.field, "acceptanceCriteria");
  });

  it("conserve l'ordre des criteres", () => {
    const result = read(ready({ acceptanceCriteria: ["Un", "Deux", "Trois"] }));
    assert.ok(result.ok);
    assert.deepEqual(result.proposal.acceptanceCriteria, ["Un", "Deux", "Trois"]);
  });

  it("retire les doublons sans les compter", () => {
    const result = read(ready({ acceptanceCriteria: ["Un", "Un", "Deux"] }));
    assert.ok(result.ok);
    assert.deepEqual(result.proposal.acceptanceCriteria, ["Un", "Deux"]);
  });

  it("preserve l'Unicode", () => {
    const result = read(ready({ title: "Éléphant 🐘 你好" }));
    assert.ok(result.ok);
    assert.equal(result.proposal.title, "Éléphant 🐘 你好");
  });
});

describe("readArchitectProposal — demande de precisions", () => {
  it("accepte des champs absents en NEEDS_INPUT", () => {
    const result = read({
      schemaVersion: ARCHITECT_SCHEMA_VERSION,
      status: ARCHITECT_PROPOSAL_STATUS.NEEDS_INPUT,
      title: null,
      priority: null,
      objective: null,
      context: null,
      acceptanceCriteria: [],
      outOfScope: [],
      documentReferences: [],
      validationCommands: [],
      assumptions: [],
      questions: ["La fonctionnalite doit-elle couvrir tous les projets ?"],
    });

    assert.ok(result.ok);
    assert.equal(result.proposal.questions.length, 1);
  });

  it("refuse NEEDS_INPUT sans la moindre question", () => {
    const result = read(
      ready({ status: ARCHITECT_PROPOSAL_STATUS.NEEDS_INPUT, questions: [] }),
    );
    assert.equal(result.ok ? null : result.refusal.field, "questions");
  });

  it("refuse plus de cinq questions", () => {
    const questions = Array.from({ length: ARCHITECT_LIMITS.questions.max + 1 }, (_, index) =>
      `Question ${String(index)} ?`,
    );
    const result = read(ready({ status: ARCHITECT_PROPOSAL_STATUS.NEEDS_INPUT, questions }));
    assert.equal(result.ok ? null : result.refusal.field, "questions");
  });

  it("refuse une question trop longue", () => {
    const result = read(
      ready({
        status: ARCHITECT_PROPOSAL_STATUS.NEEDS_INPUT,
        questions: ["q".repeat(ARCHITECT_LIMITS.questions.length + 1)],
      }),
    );
    assert.equal(result.ok, false);
  });
});

describe("readArchitectProposal — refus de forme", () => {
  it("refuse une valeur qui n'est pas un objet", () => {
    assert.equal(read("PROPOSAL_READY").ok, false);
    assert.equal(read(null).ok, false);
    assert.equal(read([]).ok, false);
  });

  it("refuse une version de contrat inconnue", () => {
    const result = read(ready({ schemaVersion: 2 }));
    assert.equal(result.ok ? null : result.refusal.field, "schemaVersion");
  });

  it("refuse un statut inconnu", () => {
    const result = read(ready({ status: "MAYBE" }));
    assert.equal(result.ok ? null : result.refusal.field, "status");
  });

  it("refuse une priorite inconnue", () => {
    const result = read(ready({ priority: "URGENT" }));
    assert.equal(result.ok ? null : result.refusal.field, "priority");
  });

  it("refuse un titre trop long", () => {
    const result = read(ready({ title: "t".repeat(ARCHITECT_LIMITS.title + 1) }));
    assert.equal(result.ok ? null : result.refusal.field, "title");
  });

  it("refuse trop de criteres", () => {
    const criteria = Array.from({ length: ARCHITECT_LIMITS.criteria.max + 1 }, (_, index) =>
      `Critere ${String(index)}`,
    );
    const result = read(ready({ acceptanceCriteria: criteria }));
    assert.equal(result.ok ? null : result.refusal.field, "acceptanceCriteria");
  });

  it("refuse une liste qui n'en est pas une", () => {
    assert.equal(read(ready({ acceptanceCriteria: "Un critere" })).ok, false);
  });

  it("refuse une entree de liste qui n'est pas une chaine", () => {
    assert.equal(read(ready({ acceptanceCriteria: [42] })).ok, false);
  });
});

describe("readArchitectProposal — references documentaires", () => {
  it("refuse un document inconnu du repository", () => {
    const result = read(ready({ documentReferences: ["docs/INVENTED.md"] }));
    assert.equal(result.ok ? null : result.refusal.field, "documentReferences");
  });

  it("refuse une traversee de repertoire", () => {
    const result = read(ready({ documentReferences: ["../../secret.md"] }));
    assert.equal(result.ok, false);
  });

  it("refuse un chemin absolu", () => {
    assert.equal(read(ready({ documentReferences: ["/etc/passwd"] })).ok, false);
  });

  it("refuse un fichier reel mais absent de la liste fermee", () => {
    // `package.json` existe dans tous les projets ; il n'est pas dans la liste
    // transmise, donc l'architecte ne peut pas le referencer.
    assert.equal(read(ready({ documentReferences: ["package.json"] })).ok, false);
  });

  it("accepte une liste vide", () => {
    const result = read(ready({ documentReferences: [] }));
    assert.ok(result.ok);
    assert.deepEqual(result.proposal.documentReferences, []);
  });
});

describe("readArchitectProposal — commandes de validation", () => {
  it("refuse un chainage", () => {
    const result = read(ready({ validationCommands: ["npm run test && npm run lint"] }));
    assert.equal(result.ok ? null : result.refusal.field, "validationCommands");
  });

  it("refuse un tuyau", () => {
    assert.equal(read(ready({ validationCommands: ["npm run test | tee out"] })).ok, false);
  });

  it("refuse une redirection", () => {
    assert.equal(read(ready({ validationCommands: ["npm run test > out.txt"] })).ok, false);
  });

  it("refuse un point-virgule", () => {
    assert.equal(read(ready({ validationCommands: ["npm run test; rm -rf /"] })).ok, false);
  });

  it("refuse une commande d'ecriture Git", () => {
    assert.equal(read(ready({ validationCommands: ["git push"] })).ok, false);
  });

  it("accepte une commande simple", () => {
    const result = read(ready({ validationCommands: ["npm run typecheck", "npm run build"] }));
    assert.ok(result.ok);
    assert.deepEqual(result.proposal.validationCommands, ["npm run typecheck", "npm run build"]);
  });
});

describe("buildArchitectProposalSchema", () => {
  it("declare tous les champs comme requis", () => {
    const schema = buildArchitectProposalSchema();
    const properties = Object.keys(schema["properties"] as Record<string, unknown>);
    assert.deepEqual([...(schema["required"] as string[])].sort(), [...properties].sort());
  });

  it("interdit les proprietes supplementaires", () => {
    assert.equal(buildArchitectProposalSchema()["additionalProperties"], false);
  });

  it("ne declare aucune borne de taille", () => {
    // Le mode strict d'OpenAI ignore `maxItems` et `maxLength` ; les declarer
    // ferait echouer la requete entiere. Les bornes vivent dans la validation.
    const serialized = JSON.stringify(buildArchitectProposalSchema());
    assert.equal(serialized.includes("maxItems"), false);
    assert.equal(serialized.includes("minItems"), false);
    assert.equal(serialized.includes("maxLength"), false);
    assert.equal(serialized.includes("pattern"), false);
  });

  it("fige la version du contrat", () => {
    const schema = buildArchitectProposalSchema();
    const properties = schema["properties"] as Record<string, Record<string, unknown>>;
    assert.deepEqual(properties["schemaVersion"]?.["enum"], [ARCHITECT_SCHEMA_VERSION]);
  });

  it("ferme la liste des priorites, valeur nulle comprise", () => {
    const schema = buildArchitectProposalSchema();
    const properties = schema["properties"] as Record<string, Record<string, unknown>>;
    const values = properties["priority"]?.["enum"] as unknown[];
    assert.ok(values.includes("CRITICAL"));
    assert.ok(values.includes(null));
    assert.equal(values.includes("URGENT"), false);
  });
});

describe("checkArchitectText", () => {
  it("accepte un texte ordinaire", () => {
    assert.equal(checkArchitectText("Je veux exporter les taches.", 1_000), null);
  });

  it("refuse un texte vide", () => {
    assert.equal(checkArchitectText("", 1_000), "empty");
  });

  it("refuse un texte blanc", () => {
    assert.equal(checkArchitectText("   \n  ", 1_000), "blank");
  });

  it("refuse un texte trop long", () => {
    assert.equal(checkArchitectText("a".repeat(11), 10), "too_long");
  });

  it("refuse un caractere de controle", () => {
    assert.equal(checkArchitectText(`abc${String.fromCodePoint(0x07)}def`, 1_000), "control_character");
  });

  it("accepte les sauts de ligne et les tabulations", () => {
    assert.equal(checkArchitectText("une ligne\n\tindentee\r\nfin", 1_000), null);
  });

  it("accepte l'Unicode", () => {
    assert.equal(checkArchitectText("Éléphant 🐘 你好", 1_000), null);
  });
});

describe("normalizeArchitectText", () => {
  it("normalise les fins de ligne", () => {
    assert.equal(normalizeArchitectText("a\r\nb\rc"), "a\nb\nc");
  });

  it("retire les marges", () => {
    assert.equal(normalizeArchitectText("  texte  \n\n"), "texte");
  });
});

describe("isArchitectContextManifest", () => {
  it("reconnait un manifest valide", () => {
    assert.equal(
      isArchitectContextManifest({
        schemaVersion: ARCHITECT_SCHEMA_VERSION,
        sources: [
          {
            kind: "DOCUMENT",
            identifier: "docs/ARCHITECTURE.md",
            revision: "a".repeat(64),
            includedChars: 1_200,
            truncated: false,
          },
        ],
        totalChars: 1_200,
        missing: ["AGENTS.md"],
      }),
      true,
    );
  });

  it("refuse une version inconnue", () => {
    assert.equal(
      isArchitectContextManifest({ schemaVersion: 9, sources: [], totalChars: 0, missing: [] }),
      false,
    );
  });

  it("refuse une source d'un genre inconnu", () => {
    assert.equal(
      isArchitectContextManifest({
        schemaVersion: ARCHITECT_SCHEMA_VERSION,
        sources: [{ kind: "CODE", identifier: "x", revision: null, includedChars: 0, truncated: false }],
        totalChars: 0,
        missing: [],
      }),
      false,
    );
  });
});
