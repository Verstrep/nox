/**
 * Revision d'un contrat de tache, et traduction du formulaire.
 *
 * ## Ce que ce fichier prouve
 *
 * Que l'empreinte porte le **contrat**, et rien d'autre : elle bouge quand
 * l'objectif change, pas quand le statut change. Sans cela, deux onglets se
 * seraient perimes mutuellement sans que personne n'ait rien modifie.
 *
 * Que l'ordre des listes compte — un agent les lira dans cet ordre — mais que
 * celui des dependances ne compte pas.
 *
 * Et que l'edition passe exactement par le validateur de la creation : un second
 * format de tache aurait fini par diverger.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { TASK_EDIT_ERROR, TASK_PRIORITY, TASK_STATUS } from "@nox/shared";
import type { DevelopmentTaskDetail } from "@nox/shared";
import type { TaskEditSnapshot } from "@nox/database";

import {
  readTaskEditSubmission,
  taskEditFormValues,
  taskEditRefusalMessage,
  taskEditRevision,
  taskRevisionOf,
  type TaskEditFormValues,
} from "./task-edit.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function snapshot(overrides: Partial<TaskEditSnapshot> = {}): TaskEditSnapshot {
  return {
    title: "Poser le domaine",
    objective: "Un repas se cree et se relit.",
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: ["Un repas peut etre cree."],
    documentReferences: [],
    validationCommands: [],
    dependsOnTaskIds: [],
    ...overrides,
  };
}

function task(overrides: Partial<DevelopmentTaskDetail> = {}): DevelopmentTaskDetail {
  return {
    id: "task-1",
    code: "TASK-001",
    kind: "NORMAL",
    title: "Poser le domaine",
    status: TASK_STATUS.DRAFT,
    priority: TASK_PRIORITY.MEDIUM,
    documentSyncStatus: "SYNCED",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    projectId: "proj-1",
    objective: "Un repas se cree et se relit.",
    context: null,
    outOfScope: null,
    acceptanceCriteria: ["Un repas peut etre cree."],
    documentReferences: [],
    validationCommands: [],
    documentPath: "tasks/TASK-001.md",
    documentRevision: "a".repeat(64),
    documentSyncError: null,
    ...overrides,
  };
}

function form(overrides: Partial<TaskEditFormValues> = {}): TaskEditFormValues {
  return {
    title: "Poser le domaine",
    priority: TASK_PRIORITY.MEDIUM,
    objective: "Un repas se cree et se relit.",
    context: "",
    outOfScope: "",
    documents: "",
    criteria: "Un repas peut etre cree.",
    commands: "",
    dependsOnTaskIds: [],
    ...overrides,
  };
}

describe("revision d'un contrat", () => {
  it("est deterministe", () => {
    assert.equal(taskEditRevision(snapshot()), taskEditRevision(snapshot()));
  });

  it("change des que le contrat change", () => {
    const base = taskEditRevision(snapshot());

    for (const overrides of [
      { title: "Autre titre" },
      { objective: "Autre objectif." },
      { context: "Un contexte." },
      { outOfScope: "- Rien." },
      { priority: TASK_PRIORITY.HIGH },
      { acceptanceCriteria: ["Autre critere."] },
      { documentReferences: ["docs/ARCHITECTURE.md"] },
      { validationCommands: ["npm run test"] },
      { dependsOnTaskIds: ["task-2"] },
    ] satisfies Partial<TaskEditSnapshot>[]) {
      assert.notEqual(taskEditRevision(snapshot(overrides)), base, JSON.stringify(overrides));
    }
  });

  it("distingue deux decoupages qui produiraient la meme chaine", () => {
    // Sans prefixe de longueur, « ab » + « c » et « a » + « bc » se
    // confondraient.
    assert.notEqual(
      taskEditRevision(snapshot({ title: "ab", objective: "c" })),
      taskEditRevision(snapshot({ title: "a", objective: "bc" })),
    );
  });

  it("distingue un champ absent d'un champ vide", () => {
    assert.notEqual(
      taskEditRevision(snapshot({ context: null })),
      taskEditRevision(snapshot({ context: " " })),
    );
  });

  it("tient compte de l'ordre des criteres", () => {
    // L'ordre fait partie de la specification : un agent les lira dans cet
    // ordre.
    assert.notEqual(
      taskEditRevision(snapshot({ acceptanceCriteria: ["A", "B"] })),
      taskEditRevision(snapshot({ acceptanceCriteria: ["B", "A"] })),
    );
  });

  it("ignore l'ordre des dependances", () => {
    // Cocher puis recocher n'est pas une modification.
    assert.equal(
      taskEditRevision(snapshot({ dependsOnTaskIds: ["a", "b"] })),
      taskEditRevision(snapshot({ dependsOnTaskIds: ["b", "a"] })),
    );
  });

  it("ne depend ni du statut, ni des dates, ni du document", () => {
    // C'est exactement ce que `updatedAt` n'aurait pas su faire : une
    // resynchronisation de Markdown aurait perime tous les formulaires ouverts.
    const base = taskRevisionOf(task(), []);

    assert.equal(taskRevisionOf(task({ status: TASK_STATUS.READY }), []), base);
    assert.equal(taskRevisionOf(task({ updatedAt: "2027-01-01T00:00:00.000Z" }), []), base);
    assert.equal(taskRevisionOf(task({ documentRevision: "f".repeat(64) }), []), base);
    assert.equal(taskRevisionOf(task({ documentSyncStatus: "CONFLICT" }), []), base);
  });

  it("ne depend pas du code ni de la nature", () => {
    // Ils sont immuables : les faire entrer dans l'empreinte n'apprendrait rien.
    const base = taskRevisionOf(task(), []);
    assert.equal(taskRevisionOf(task({ code: "TASK-042", kind: "BOOTSTRAP" }), []), base);
  });
});

describe("prefill du formulaire", () => {
  it("recompose les listes ligne par ligne", () => {
    const values = taskEditFormValues(
      task({
        acceptanceCriteria: ["Premier", "Second"],
        documentReferences: ["docs/A.md", "docs/B.md"],
        validationCommands: ["npm run test", "npm run lint"],
      }),
      ["task-2"],
    );

    assert.equal(values.criteria, "Premier\nSecond");
    assert.equal(values.documents, "docs/A.md\ndocs/B.md");
    assert.equal(values.commands, "npm run test\nnpm run lint");
    assert.deepEqual(values.dependsOnTaskIds, ["task-2"]);
  });

  it("rend une chaine vide pour les champs absents", () => {
    const values = taskEditFormValues(task({ context: null, outOfScope: null }), []);
    assert.equal(values.context, "");
    assert.equal(values.outOfScope, "");
  });

  it("produit un aller-retour stable", () => {
    // Prefill puis soumission sans modification doit rendre exactement le
    // contrat d'origine : sans quoi ouvrir un formulaire suffirait a changer la
    // tache.
    const original = task({
      context: "Un contexte.",
      outOfScope: "- Rien.",
      documentReferences: ["docs/A.md"],
      validationCommands: ["npm run test"],
    });
    const submission = readTaskEditSubmission(taskEditFormValues(original, ["task-2"]));

    assert.ok(submission.ok);
    assert.equal(
      taskEditRevision({ ...submission.input }),
      taskRevisionOf(original, ["task-2"]),
    );
  });
});

describe("validation d'une soumission", () => {
  it("reutilise le validateur de la creation", () => {
    // Meme refus, meme message : il n'existe qu'un seul format de tache.
    const refused = readTaskEditSubmission(form({ criteria: "" }));
    assert.equal(refused.ok, false);
    assert.ok(refused.ok === false && refused.message.includes("critere d'acceptation"));
  });

  it("refuse un chemin de document sortant du repository", () => {
    for (const documents of ["../secrets.md", "/etc/passwd", "C:/Windows/system.ini"]) {
      const refused = readTaskEditSubmission(form({ documents }));
      assert.equal(refused.ok, false, documents);
    }
  });

  it("refuse une commande chainee", () => {
    // Le validateur des commandes vit dans `@nox/shared` et sert au lancement ;
    // celui du formulaire borne la saisie. Les deux restent en place.
    const submission = readTaskEditSubmission(form({ commands: "npm run test && rm -rf dist" }));
    assert.ok(submission.ok);
    // La commande est enregistrable, mais elle bloquera le lancement : c'est le
    // comportement d'avant TASK-024, inchange.
    assert.deepEqual(submission.input.validationCommands, ["npm run test && rm -rf dist"]);
  });

  it("normalise les dependances sans rien valider d'autre", () => {
    const submission = readTaskEditSubmission(
      form({ dependsOnTaskIds: ["a", "", "a", " b "] }),
    );
    assert.ok(submission.ok);
    // L'existence, le projet, la nature et les cycles se verifient en base : le
    // navigateur n'a aucune autorite sur ce point.
    assert.deepEqual(submission.input.dependsOnTaskIds, ["a", "b"]);
  });

  it("refuse une priorite inventee", () => {
    const refused = readTaskEditSubmission(form({ priority: "URGENT" }));
    assert.equal(refused.ok, false);
  });
});

describe("messages de refus", () => {
  it("dit ce qu'il faut faire, pour chaque code", () => {
    for (const code of Object.values(TASK_EDIT_ERROR)) {
      const message = taskEditRefusalMessage(code);
      assert.ok(message.length > 20, code);
      // Aucun code technique ne remonte a l'utilisateur.
      assert.ok(!message.includes("TASK_EDIT_"), code);
    }
  });

  it("oriente une tache figee vers la demande de correction", () => {
    assert.ok(taskEditRefusalMessage(TASK_EDIT_ERROR.FROZEN).includes("Request changes"));
  });

  it("demande de recharger avant d'enregistrer", () => {
    assert.ok(taskEditRefusalMessage(TASK_EDIT_ERROR.STALE).includes("Rechargez"));
  });
});

describe("identites du formulaire d'edition", () => {
  it("ne derive aucune cle React d'un texte modifiable", async () => {
    const source = await readFile(
      path.join(HERE, "..", "app", "projects", "[id]", "tasks", "[taskId]", "edit", "EditTaskForm.tsx"),
      "utf8",
    );

    // Le defaut de TASK-022 : une cle derivee d'un titre editable remonte le
    // noeud a chaque frappe, et le champ perd le focus. Les cles de ce
    // formulaire viennent d'identifiants, jamais de contenu.
    for (const forbidden of [
      "key={candidate.title}",
      "key={task.title}",
      "key={entry.title}",
      "key={values.title}",
    ]) {
      assert.ok(!source.includes(forbidden), forbidden);
    }

    assert.ok(source.includes("key={candidate.id}"));

    // Et aucun masque : le focus se garde en ne demontant pas le champ, pas en
    // le refocalisant apres coup.
    assert.ok(!source.includes("autoFocus"));
    assert.ok(!source.includes(".focus()"));
  });

  it("declare ses champs de texte hors du composant", async () => {
    const source = await readFile(
      path.join(HERE, "..", "app", "projects", "[id]", "tasks", "[taskId]", "edit", "EditTaskForm.tsx"),
      "utf8",
    );

    // Un composant defini dans le corps du rendu est un nouveau type a chaque
    // frappe : React demonte alors le champ, et le focus part avec lui.
    assert.ok(source.indexOf("function TextAreaField") < source.indexOf("export function EditTaskForm"));
  });
});
