import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMPTY_TASK_FORM_VALUES,
  TASK_LIMITS,
  readLines,
  readTaskSubmission,
  type TaskFormValues,
} from "./task-input.ts";

function values(overrides: Partial<TaskFormValues> = {}): TaskFormValues {
  return {
    ...EMPTY_TASK_FORM_VALUES,
    title: "Ajouter la gestion des projets",
    objective: "Permettre d'enregistrer un repository local.",
    criteria: "Un projet peut etre cree.",
    ...overrides,
  };
}

/** Raccourci : echoue si la soumission a ete refusee. */
function accepted(overrides: Partial<TaskFormValues> = {}) {
  const result = readTaskSubmission(values(overrides));
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  if (!result.ok) {
    throw new Error("soumission refusee");
  }
  return result.input;
}

function refused(overrides: Partial<TaskFormValues>): string {
  const result = readTaskSubmission(values(overrides));
  assert.equal(result.ok, false);
  return result.ok ? "" : result.message;
}

describe("readLines", () => {
  it("produit une entree par ligne non vide", () => {
    assert.deepEqual(readLines("a\nb\nc"), ["a", "b", "c"]);
  });

  it("ignore les lignes vides et les espaces de bord", () => {
    assert.deepEqual(readLines("  a  \n\n\n   \n b\n"), ["a", "b"]);
  });

  it("accepte les fins de ligne du navigateur", () => {
    // La specification HTML impose CRLF a la soumission d'un `<textarea>`.
    assert.deepEqual(readLines("a\r\nb\rc"), ["a", "b", "c"]);
  });

  it("retourne une liste vide pour une saisie vide", () => {
    assert.deepEqual(readLines(""), []);
    assert.deepEqual(readLines("   \n  "), []);
  });
});

describe("readTaskSubmission - champs obligatoires", () => {
  it("accepte une tache minimale", () => {
    const input = accepted();

    assert.equal(input.title, "Ajouter la gestion des projets");
    assert.equal(input.priority, "MEDIUM");
    assert.equal(input.context, null);
    assert.equal(input.outOfScope, null);
    assert.deepEqual(input.acceptanceCriteria, ["Un projet peut etre cree."]);
    assert.deepEqual(input.documentReferences, []);
    assert.deepEqual(input.validationCommands, []);
  });

  it("refuse un titre vide", () => {
    assert.match(refused({ title: "" }), /titre/i);
    assert.match(refused({ title: "   \n  " }), /titre/i);
  });

  it("refuse un objectif vide", () => {
    assert.match(refused({ objective: "" }), /objectif/i);
    assert.match(refused({ objective: "  " }), /objectif/i);
  });

  it("refuse une liste de criteres vide", () => {
    assert.match(refused({ criteria: "" }), /critere/i);
    assert.match(refused({ criteria: "\n\n   \n" }), /critere/i);
  });

  it("refuse une priorite invalide", () => {
    assert.match(refused({ priority: "URGENT" }), /priorite/i);
    assert.match(refused({ priority: "" }), /priorite/i);
    assert.match(refused({ priority: "medium" }), /priorite/i);
  });

  it("accepte les quatre priorites", () => {
    for (const priority of ["LOW", "MEDIUM", "HIGH", "CRITICAL"]) {
      assert.equal(accepted({ priority }).priority, priority);
    }
  });
});

describe("readTaskSubmission - nettoyage", () => {
  it("ramene un titre multiligne a une seule ligne", () => {
    assert.equal(accepted({ title: "  Titre\n  sur deux lignes  " }).title, "Titre sur deux lignes");
  });

  it("retire les lignes vides des trois listes", () => {
    const input = accepted({
      criteria: "\n  Premier  \n\n  Second\n\n",
      documents: "\n docs/A.md \n\n docs/B.md\n",
      commands: "\nnpm run test\n\n\nnpm run lint\n",
    });

    assert.deepEqual(input.acceptanceCriteria, ["Premier", "Second"]);
    assert.deepEqual(input.documentReferences, ["docs/A.md", "docs/B.md"]);
    assert.deepEqual(input.validationCommands, ["npm run test", "npm run lint"]);
  });

  it("deduplique les documents en conservant le premier ordre", () => {
    const input = accepted({
      documents: "docs/B.md\ndocs/A.md\ndocs/B.md\ndocs/C.md\ndocs/A.md",
    });

    assert.deepEqual(input.documentReferences, ["docs/B.md", "docs/A.md", "docs/C.md"]);
  });

  it("ne deduplique ni les criteres ni les commandes", () => {
    // Un critere repete est un signe de saisie a revoir, pas une erreur que NOX
    // doive corriger a la place de l'utilisateur.
    const input = accepted({ criteria: "Idem\nIdem", commands: "npm run test\nnpm run test" });

    assert.deepEqual(input.acceptanceCriteria, ["Idem", "Idem"]);
    assert.deepEqual(input.validationCommands, ["npm run test", "npm run test"]);
  });

  it("transforme un contexte vide en absence", () => {
    assert.equal(accepted({ context: "  \n " }).context, null);
    assert.equal(accepted({ context: "Un contexte." }).context, "Un contexte.");
  });

  it("conserve les retours a la ligne d'un texte libre", () => {
    assert.equal(accepted({ outOfScope: "- A\r\n- B" }).outOfScope, "- A\n- B");
  });
});

describe("readTaskSubmission - chemins de documents", () => {
  it("accepte un chemin relatif", () => {
    assert.deepEqual(accepted({ documents: "docs/ARCHITECTURE.md" }).documentReferences, [
      "docs/ARCHITECTURE.md",
    ]);
  });

  it("accepte un chemin qui n'existe pas encore", () => {
    // Une tache peut referencer un fichier qui sera cree avant son execution :
    // le disque n'est jamais consulte ici.
    assert.deepEqual(accepted({ documents: "docs/A_CREER.md" }).documentReferences, [
      "docs/A_CREER.md",
    ]);
  });

  it("refuse un chemin absolu", () => {
    assert.match(refused({ documents: "/etc/passwd" }), /relatif/i);
    assert.match(refused({ documents: "D:\\Projets\\secret.md" }), /relatif/i);
    assert.match(refused({ documents: "file:///etc/passwd" }), /relatif/i);
    assert.match(refused({ documents: "\\\\serveur\\part\\a.md" }), /relatif/i);
  });

  it("refuse une remontee", () => {
    assert.match(refused({ documents: "../secret.md" }), /\.\./);
    assert.match(refused({ documents: "docs/../../secret.md" }), /\.\./);
    assert.match(refused({ documents: "docs\\..\\secret.md" }), /\.\./);
  });

  it("refuse un caractere nul", () => {
    assert.match(refused({ documents: "docs/a\u0000b.md" }), /interdit/i);
  });

  it("accepte un point qui ne forme pas une remontee", () => {
    assert.deepEqual(accepted({ documents: "docs/v1.2/notes.md" }).documentReferences, [
      "docs/v1.2/notes.md",
    ]);
  });
});

describe("readTaskSubmission - limites", () => {
  it("refuse un titre trop long", () => {
    assert.match(refused({ title: "a".repeat(TASK_LIMITS.title + 1) }), /titre/i);
    assert.equal(accepted({ title: "a".repeat(TASK_LIMITS.title) }).title.length, TASK_LIMITS.title);
  });

  it("refuse un objectif trop long", () => {
    assert.match(refused({ objective: "a".repeat(TASK_LIMITS.objective + 1) }), /objectif/i);
  });

  it("refuse un contexte trop long", () => {
    assert.match(refused({ context: "a".repeat(TASK_LIMITS.context + 1) }), /contexte/i);
  });

  it("refuse un hors perimetre trop long", () => {
    assert.match(refused({ outOfScope: "a".repeat(TASK_LIMITS.outOfScope + 1) }), /perimetre/i);
  });

  it("refuse trop de criteres", () => {
    const many = Array.from({ length: TASK_LIMITS.criteria.count + 1 }, (_, i) => `Critere ${String(i)}`);
    assert.match(refused({ criteria: many.join("\n") }), /criteres/i);
  });

  it("refuse un critere trop long", () => {
    assert.match(refused({ criteria: "a".repeat(TASK_LIMITS.criteria.length + 1) }), /critere/i);
  });

  it("refuse trop de documents", () => {
    const many = Array.from({ length: TASK_LIMITS.documents.count + 1 }, (_, i) => `docs/${String(i)}.md`);
    assert.match(refused({ documents: many.join("\n") }), /documents/i);
  });

  it("refuse un chemin de document trop long", () => {
    const long = `docs/${"a".repeat(TASK_LIMITS.documents.length)}.md`;
    assert.match(refused({ documents: long }), /document/i);
  });

  it("refuse trop de commandes", () => {
    const many = Array.from({ length: TASK_LIMITS.commands.count + 1 }, (_, i) => `cmd ${String(i)}`);
    assert.match(refused({ commands: many.join("\n") }), /commandes/i);
  });

  it("refuse une commande trop longue", () => {
    assert.match(refused({ commands: "a".repeat(TASK_LIMITS.commands.length + 1) }), /commande/i);
  });
});
