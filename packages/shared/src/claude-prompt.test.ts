import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TASK_KIND,
  renderClaudeExecutionPrompt,
  type TaskSpecification,
  type TaskKind,
} from "../dist/index.js";

type PromptInput = TaskSpecification & { documentPath: string; kind: TaskKind };

const MINIMAL: PromptInput = {
  code: "TASK-012",
  title: "Ajouter la gestion des projets",
  objective: "Permettre d'enregistrer un repository local.",
  context: null,
  outOfScope: null,
  documentReferences: [],
  acceptanceCriteria: ["Un projet peut etre cree."],
  validationCommands: [],
  documentPath: "tasks/TASK-012.md",
  kind: TASK_KIND.NORMAL,
};

const COMPLETE: PromptInput = {
  ...MINIMAL,
  context: "NOX possede actuellement un tableau de bord statique.",
  outOfScope: "- Suppression de projet.\n- Integration Claude Code.",
  documentReferences: ["docs/V1_SCOPE.md", "docs/ARCHITECTURE.md", "docs/DECISIONS.md"],
  acceptanceCriteria: [
    "Un projet peut etre cree.",
    "Le chemin du repository est valide.",
    "Le projet persiste apres redemarrage.",
  ],
  validationCommands: ["npm run test", "npm run lint", "npm run typecheck", "npm run build"],
};

describe("renderClaudeExecutionPrompt - contenu", () => {
  it("nomme la tache active par son code", () => {
    const prompt = renderClaudeExecutionPrompt(MINIMAL);
    assert.ok(prompt.includes("TASK-012 — Ajouter la gestion des projets"));
    assert.ok(prompt.includes("implémente uniquement TASK-012"));
  });

  it("impose la lecture des documents de reference", () => {
    const prompt = renderClaudeExecutionPrompt(COMPLETE);

    assert.ok(prompt.includes("- CLAUDE.md"));
    assert.ok(prompt.includes("- AGENTS.md s'il existe"));
    assert.ok(prompt.includes("- tasks/TASK-012.md"));
    assert.ok(prompt.includes("- docs/V1_SCOPE.md"));
  });

  it("reference les documents sans en recopier le contenu", () => {
    const prompt = renderClaudeExecutionPrompt(COMPLETE);

    // Le prompt reste compact : il cite des chemins, pas des documents.
    assert.ok(prompt.length < 4000, `prompt trop long : ${String(prompt.length)}`);
  });

  it("conserve l'ordre des documents", () => {
    const prompt = renderClaudeExecutionPrompt(COMPLETE);

    assert.ok(prompt.indexOf("docs/V1_SCOPE.md") < prompt.indexOf("docs/ARCHITECTURE.md"));
    assert.ok(prompt.indexOf("docs/ARCHITECTURE.md") < prompt.indexOf("docs/DECISIONS.md"));
  });

  it("conserve l'ordre des criteres et des commandes", () => {
    const prompt = renderClaudeExecutionPrompt(COMPLETE);

    assert.ok(prompt.indexOf("Un projet peut etre cree.") < prompt.indexOf("Le chemin du repository"));
    assert.ok(prompt.indexOf("npm run test") < prompt.indexOf("npm run build"));
  });

  it("annonce les commandes comme les seules preautorisees", () => {
    const prompt = renderClaudeExecutionPrompt(COMPLETE);

    assert.ok(prompt.includes("seules commandes applicatives préautorisées"));
    assert.ok(prompt.includes("- npm run test"));
    assert.ok(prompt.includes("- npm run lint"));
  });

  it("le dit explicitement quand aucune commande n'est enregistree", () => {
    const prompt = renderClaudeExecutionPrompt(MINIMAL);

    assert.ok(prompt.includes("aucune commande de validation n'est enregistrée"));
    assert.ok(prompt.includes("n'en lance aucune"));
  });

  it("interdit le commit et le push", () => {
    const prompt = renderClaudeExecutionPrompt(MINIMAL);

    assert.ok(prompt.includes("ne crée aucun commit"));
    assert.ok(prompt.includes("ne lance aucun push"));
    assert.ok(prompt.includes("ne modifie pas l'historique Git"));
  });

  it("demande un compte rendu structure", () => {
    const prompt = renderClaudeExecutionPrompt(MINIMAL);

    for (const section of [
      "## Résultat",
      "## Fonctionnalités réalisées",
      "## Fichiers modifiés",
      "## Validations exécutées",
      "## Erreurs ou blocages",
      "## Décisions prises",
      "## Dette ou limites",
      "## Git",
    ]) {
      assert.ok(prompt.includes(section), section);
    }
  });

  it("omet les sections facultatives absentes", () => {
    const prompt = renderClaudeExecutionPrompt(MINIMAL);

    assert.equal(prompt.includes("Contexte :"), false);
    assert.equal(prompt.includes("Hors périmètre :"), false);
  });
});

describe("renderClaudeExecutionPrompt - ce qui ne doit pas y figurer", () => {
  it("ne contient aucun chemin absolu", () => {
    const prompt = renderClaudeExecutionPrompt(COMPLETE);

    assert.equal(/[A-Za-z]:\\/.test(prompt), false, "chemin Windows detecte");
    assert.equal(/(^|\s)\/(home|Users|etc|var)\//.test(prompt), false, "chemin POSIX detecte");
  });

  it("ne contient aucun statut ni priorite", () => {
    const prompt = renderClaudeExecutionPrompt(COMPLETE);

    for (const mutable of ["DRAFT", "READY", "RUNNING", "REVIEW", "COMPLETED", "CRITICAL", "HIGH"]) {
      assert.equal(prompt.includes(mutable), false, mutable);
    }
  });

  it("ne contient ni jeton ni variable d'environnement", () => {
    const prompt = renderClaudeExecutionPrompt(COMPLETE);

    assert.equal(prompt.includes("NOX_"), false);
    assert.equal(prompt.includes("ANTHROPIC"), false);
    assert.equal(prompt.includes(".env"), true, "l'interdiction de lire .env doit y figurer");
    assert.equal(prompt.includes("Bearer"), false);
  });
});

describe("renderClaudeExecutionPrompt - robustesse", () => {
  it("est deterministe", () => {
    assert.equal(renderClaudeExecutionPrompt(COMPLETE), renderClaudeExecutionPrompt(COMPLETE));
    assert.equal(renderClaudeExecutionPrompt(COMPLETE), renderClaudeExecutionPrompt({ ...COMPLETE }));
  });

  it("normalise ses propres fins de ligne", () => {
    const prompt = renderClaudeExecutionPrompt({
      ...MINIMAL,
      context: "Premiere ligne.\r\nSeconde ligne.",
    });

    assert.equal(prompt.includes("\r"), false);
  });

  it("ramene un titre multiligne a une seule ligne", () => {
    const prompt = renderClaudeExecutionPrompt({ ...MINIMAL, title: "Titre\nsur deux lignes" });
    assert.ok(prompt.includes("TASK-012 — Titre sur deux lignes"));
  });

  it("preserve le contenu Unicode", () => {
    const prompt = renderClaudeExecutionPrompt({
      ...MINIMAL,
      title: "Étude détaillée — 日本語",
      objective: "Gerer les emoji 🎯 et les accents.",
      acceptanceCriteria: ["Les caracteres « français » restent intacts."],
    });

    assert.ok(prompt.includes("Étude détaillée — 日本語"));
    assert.ok(prompt.includes("🎯"));
    assert.ok(prompt.includes("« français »"));
  });

  it("ignore les entrees vides des listes", () => {
    const prompt = renderClaudeExecutionPrompt({
      ...MINIMAL,
      documentReferences: ["", "   ", "docs/A.md"],
      validationCommands: ["  "],
    });

    assert.ok(prompt.includes("- docs/A.md"));
    assert.ok(prompt.includes("aucune commande de validation n'est enregistrée"));
  });

  it("termine par exactement un saut de ligne", () => {
    for (const task of [MINIMAL, COMPLETE]) {
      const prompt = renderClaudeExecutionPrompt(task);
      assert.ok(prompt.endsWith("\n"));
      assert.equal(prompt.endsWith("\n\n"), false);
    }
  });
});


/**
 * Tests de la frontiere entre setup et validation structuree.
 *
 * Le premier run reel de TASK-000 s'est arrete sur une phrase de ce prompt :
 * « aucune commande de validation n'est enregistrée pour cette tâche : n'en lance
 * aucune ». Elle etait juste pour ce qu'elle designait, et fausse pour ce qu'elle
 * laissait entendre — l'agent n'a installe ni verifie la fondation qu'il venait de
 * choisir.
 */
describe("renderClaudeExecutionPrompt — setup et validation structuree", () => {
  const BOOTSTRAP: PromptInput = {
    ...MINIMAL,
    code: "TASK-000",
    title: "Bootstrap project repository and foundational documentation",
    documentPath: "tasks/TASK-000.md",
    kind: TASK_KIND.BOOTSTRAP,
  };

  it("garde la consigne d'origine pour une tache ordinaire sans validation", () => {
    const prompt = renderClaudeExecutionPrompt(MINIMAL);

    assert.ok(
      prompt.includes(
        "aucune commande de validation n'est enregistrée pour cette tâche : n'en lance aucune",
      ),
    );
    assert.ok(!prompt.includes("installe les dépendances"));
  });

  it("n'interdit plus toute commande a une tache d'amorcage", () => {
    const prompt = renderClaudeExecutionPrompt(BOOTSTRAP);

    assert.ok(!prompt.includes("n'en lance aucune"));
    assert.ok(prompt.includes("aucune commande de validation structurée n'était connue"));
  });

  it("nomme ce que l'amorcage doit installer et verifier", () => {
    const prompt = renderClaudeExecutionPrompt(BOOTSTRAP);

    assert.ok(prompt.includes("installe les dépendances de la pile retenue"));
    assert.ok(prompt.includes("fichier de verrouillage"));
    assert.ok(prompt.includes("lance la build"));
    assert.ok(prompt.includes("lance les tests"));
    assert.ok(prompt.includes("sans laisser tourner un serveur permanent"));
  });

  it("interdit toujours d'inventer une validation etrangere a l'amorcage", () => {
    const prompt = renderClaudeExecutionPrompt(BOOTSTRAP);
    assert.ok(prompt.includes("n'invente aucune validation étrangère à l'amorçage"));
  });

  it("demande de signaler un refus plutot que de le contourner", () => {
    const prompt = renderClaudeExecutionPrompt(BOOTSTRAP);

    assert.ok(prompt.includes("ne cherche pas à la contourner"));
    assert.ok(prompt.includes("ce qui reste non vérifié"));
  });

  it("ne souffle aucun ecosysteme a l'agent", () => {
    const prompt = renderClaudeExecutionPrompt(BOOTSTRAP);

    // NOX ne choisit pas la pile : citer `npm` ici la choisirait a moitie.
    for (const forbidden of ["npm ", "pnpm", "yarn", "cargo", "pytest", "gradle", "composer"]) {
      assert.ok(!prompt.includes(forbidden), forbidden);
    }
  });

  it("separe ce qui etait configure de ce qui a reellement tourne", () => {
    const prompt = renderClaudeExecutionPrompt(BOOTSTRAP);

    assert.ok(prompt.includes("## Validations structurées configurées avant l'exécution"));
    assert.ok(
      prompt.includes("## Installation et vérification de la fondation réellement exécutées"),
    );
    // La section unique disparait : elle aurait affiche « aucune » juste apres une
    // build et une suite de tests.
    assert.ok(!prompt.includes("## Validations exécutées"));
  });

  it("garde une seule section de validations pour une tache ordinaire", () => {
    const prompt = renderClaudeExecutionPrompt(COMPLETE);

    assert.ok(prompt.includes("## Validations exécutées"));
    assert.ok(!prompt.includes("## Validations structurées configurées avant l'exécution"));
  });

  it("borne l'amorcage au repository, sans publication ni deploiement", () => {
    const prompt = renderClaudeExecutionPrompt(BOOTSTRAP);

    assert.ok(prompt.includes("n'installe et ne modifie rien en dehors du repository"));
    assert.ok(prompt.includes("ne publie, ne déploie et ne provisionne rien"));
    // Les regles d'origine restent, mot pour mot.
    assert.ok(prompt.includes("- ne crée aucun commit ;"));
    assert.ok(prompt.includes("- ne lance aucun push ;"));
    assert.ok(prompt.includes("- ne lis aucun secret ni fichier .env ;"));
  });

  it("n'ajoute ces deux regles qu'a l'amorcage", () => {
    const prompt = renderClaudeExecutionPrompt(COMPLETE);

    assert.ok(!prompt.includes("ne publie, ne déploie et ne provisionne rien"));
    assert.ok(!prompt.includes("n'installe et ne modifie rien en dehors du repository"));
  });

  it("ajoute les validations enregistrees sans remplacer le setup", () => {
    const prompt = renderClaudeExecutionPrompt({
      ...BOOTSTRAP,
      validationCommands: ["npm run test"],
    });

    assert.ok(prompt.includes("aucune commande de validation structurée n'était connue"));
    assert.ok(prompt.includes("Exécute également les commandes de validation enregistrées"));
    assert.ok(prompt.includes("- npm run test"));
  });

  it("reste deterministe", () => {
    assert.equal(
      renderClaudeExecutionPrompt(BOOTSTRAP),
      renderClaudeExecutionPrompt(BOOTSTRAP),
    );
    assert.notEqual(
      renderClaudeExecutionPrompt(BOOTSTRAP),
      renderClaudeExecutionPrompt({ ...BOOTSTRAP, kind: TASK_KIND.NORMAL }),
    );
  });
});
