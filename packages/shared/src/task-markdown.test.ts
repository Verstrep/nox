import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderTaskMarkdown, type TaskSpecification } from "../dist/index.js";

const MINIMAL: TaskSpecification = {
  code: "TASK-001",
  title: "Ajouter la gestion des projets",
  objective: "Permettre a l'utilisateur d'enregistrer un repository local.",
  context: null,
  outOfScope: null,
  documentReferences: [],
  acceptanceCriteria: ["Un projet peut etre cree."],
  validationCommands: [],
};

const COMPLETE: TaskSpecification = {
  code: "TASK-042",
  title: "Ajouter la gestion des projets",
  objective: "Permettre a l'utilisateur d'enregistrer un repository local.",
  context: "NOX possede actuellement un tableau de bord statique.",
  outOfScope: "- Suppression de projet.\n- Integration Claude Code.",
  documentReferences: ["CLAUDE.md", "docs/V1_SCOPE.md", "docs/ARCHITECTURE.md"],
  acceptanceCriteria: [
    "Un projet peut etre cree.",
    "Le chemin du repository est valide.",
    "Le projet persiste apres redemarrage.",
  ],
  validationCommands: ["npm run test", "npm run lint", "npm run typecheck", "npm run build"],
};

describe("renderTaskMarkdown", () => {
  it("rend une tache complete a l'identique", () => {
    assert.equal(
      renderTaskMarkdown(COMPLETE),
      [
        "# TASK-042 — Ajouter la gestion des projets",
        "",
        "## Objectif",
        "",
        "Permettre a l'utilisateur d'enregistrer un repository local.",
        "",
        "## Contexte",
        "",
        "NOX possede actuellement un tableau de bord statique.",
        "",
        "## Documents obligatoires",
        "",
        "- `CLAUDE.md`",
        "- `docs/V1_SCOPE.md`",
        "- `docs/ARCHITECTURE.md`",
        "",
        "## Critères d'acceptation",
        "",
        "- [ ] Un projet peut etre cree.",
        "- [ ] Le chemin du repository est valide.",
        "- [ ] Le projet persiste apres redemarrage.",
        "",
        "## Commandes de validation",
        "",
        "```bash",
        "npm run test",
        "npm run lint",
        "npm run typecheck",
        "npm run build",
        "```",
        "",
        "## Hors périmètre",
        "",
        "- Suppression de projet.",
        "- Integration Claude Code.",
        "",
        "## Règles d'exécution",
        "",
        "- Implémenter uniquement cette tâche.",
        "- Ne commencer aucune autre tâche.",
        "- Ne créer aucun commit ni push sans demande explicite.",
        "",
      ].join("\n"),
    );
  });

  it("rend une tache minimale sans section vide", () => {
    const rendered = renderTaskMarkdown(MINIMAL);

    assert.equal(
      rendered,
      [
        "# TASK-001 — Ajouter la gestion des projets",
        "",
        "## Objectif",
        "",
        "Permettre a l'utilisateur d'enregistrer un repository local.",
        "",
        "## Critères d'acceptation",
        "",
        "- [ ] Un projet peut etre cree.",
        "",
        "## Règles d'exécution",
        "",
        "- Implémenter uniquement cette tâche.",
        "- Ne commencer aucune autre tâche.",
        "- Ne créer aucun commit ni push sans demande explicite.",
        "",
      ].join("\n"),
    );

    for (const absent of ["## Contexte", "## Documents obligatoires", "## Commandes", "## Hors"]) {
      assert.equal(rendered.includes(absent), false, `${absent} ne devrait pas apparaitre`);
    }
  });

  it("ignore les listes dont toutes les entrees sont vides", () => {
    const rendered = renderTaskMarkdown({
      ...MINIMAL,
      documentReferences: ["", "   "],
      validationCommands: ["  "],
    });

    assert.equal(rendered.includes("## Documents obligatoires"), false);
    assert.equal(rendered.includes("## Commandes de validation"), false);
  });

  it("traite une section facultative vide comme absente", () => {
    const rendered = renderTaskMarkdown({ ...MINIMAL, context: "   \n  ", outOfScope: "" });

    assert.equal(rendered.includes("## Contexte"), false);
    assert.equal(rendered.includes("## Hors périmètre"), false);
  });

  it("conserve l'ordre de saisie des trois listes", () => {
    const rendered = renderTaskMarkdown(COMPLETE);

    assert.ok(rendered.indexOf("CLAUDE.md") < rendered.indexOf("docs/V1_SCOPE.md"));
    assert.ok(rendered.indexOf("docs/V1_SCOPE.md") < rendered.indexOf("docs/ARCHITECTURE.md"));
    assert.ok(rendered.indexOf("Un projet peut") < rendered.indexOf("Le chemin du repository"));
    assert.ok(rendered.indexOf("npm run test") < rendered.indexOf("npm run build"));
  });

  it("encadre les chemins en code inline", () => {
    const rendered = renderTaskMarkdown({ ...MINIMAL, documentReferences: ["docs/A B.md"] });
    assert.ok(rendered.includes("- `docs/A B.md`"));
  });

  it("allonge la cloture d'un chemin contenant un accent grave", () => {
    const rendered = renderTaskMarkdown({ ...MINIMAL, documentReferences: ["docs/a`b.md"] });
    assert.ok(rendered.includes("- ``docs/a`b.md``"));
  });

  it("allonge la cloture d'un bloc de commandes qui en contient une", () => {
    const rendered = renderTaskMarkdown({
      ...MINIMAL,
      validationCommands: ["echo ```danger```"],
    });

    assert.ok(rendered.includes("````bash"));
    assert.ok(rendered.includes("\n````\n"));
  });

  it("preserve le contenu Unicode", () => {
    const rendered = renderTaskMarkdown({
      ...MINIMAL,
      title: "Étude détaillée — 日本語",
      objective: "Gerer les emoji 🎯 et les accents.",
      acceptanceCriteria: ["Les caracteres « français » restent intacts."],
    });

    assert.ok(rendered.includes("# TASK-001 — Étude détaillée — 日本語"));
    assert.ok(rendered.includes("🎯"));
    assert.ok(rendered.includes("« français »"));
  });

  it("est deterministe", () => {
    assert.equal(renderTaskMarkdown(COMPLETE), renderTaskMarkdown(COMPLETE));
    assert.equal(renderTaskMarkdown(COMPLETE), renderTaskMarkdown({ ...COMPLETE }));
  });

  it("normalise ses propres fins de ligne", () => {
    const rendered = renderTaskMarkdown({
      ...MINIMAL,
      context: "Premiere ligne.\r\nSeconde ligne.\rTroisieme.",
    });

    assert.equal(rendered.includes("\r"), false);
    assert.ok(rendered.includes("Premiere ligne.\nSeconde ligne.\nTroisieme."));
  });

  it("ramene un titre multiligne a une seule ligne", () => {
    const rendered = renderTaskMarkdown({ ...MINIMAL, title: "Titre\nsur deux lignes" });
    assert.ok(rendered.startsWith("# TASK-001 — Titre sur deux lignes\n"));
  });

  it("termine le fichier par exactement un saut de ligne", () => {
    for (const task of [MINIMAL, COMPLETE]) {
      const rendered = renderTaskMarkdown(task);
      assert.ok(rendered.endsWith("\n"));
      assert.equal(rendered.endsWith("\n\n"), false);
    }
  });

  it("ne contient aucune valeur mutable", () => {
    const rendered = renderTaskMarkdown(COMPLETE);

    for (const mutable of ["DRAFT", "READY", "BLOCKED", "COMPLETED", "Statut", "Priorite", "HIGH"]) {
      assert.equal(rendered.includes(mutable), false, `${mutable} ne doit pas figurer`);
    }
  });

  it("rappelle les regles d'execution a la fin", () => {
    assert.ok(renderTaskMarkdown(MINIMAL).includes("## Règles d'exécution"));
  });
});
