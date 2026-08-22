/**
 * Traduction des refus de dependance, et absence d'effet de bord.
 *
 * ## Ce que ce fichier prouve
 *
 * Que chaque refus produit une phrase qui **nomme ce qui manque** : « TASK-001,
 * Brouillon » dit ou aller, « dependance non satisfaite » oblige a chercher.
 *
 * Et qu'aucune operation de dependance n'appelle un fournisseur, ne lance Claude
 * Code ni ne touche a Git. Ce sont des lectures et des ecritures SQLite —
 * verifie sur la **source** des modules, parce qu'un compteur a zero ne prouve
 * que l'absence d'appel pendant un test, pas l'absence de chemin de code.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { TASK_DEPENDENCY_ERROR, TASK_KIND, TASK_STATUS } from "@nox/shared";
import type { TaskDependencyLink } from "@nox/shared";

import {
  dependencyRefusalMessage,
  describeWaitingDependencies,
  unresolvedDependenciesMessage,
} from "./task-dependencies.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function link(overrides: Partial<TaskDependencyLink> = {}): TaskDependencyLink {
  return {
    id: "task-1",
    code: "TASK-001",
    title: "Definir le modele de domaine",
    status: TASK_STATUS.DRAFT,
    kind: TASK_KIND.NORMAL,
    satisfied: false,
    ...overrides,
  };
}

describe("description des dependances en attente", () => {
  it("nomme le code, le titre et le statut", () => {
    const text = describeWaitingDependencies([link()]);

    assert.ok(text.includes("TASK-001"));
    assert.ok(text.includes("Definir le modele de domaine"));
    // Le statut compte autant que le code : il dit pourquoi on attend.
    assert.ok(text.includes("Draft"));
  });

  it("enumere plusieurs taches", () => {
    const text = describeWaitingDependencies([
      link(),
      link({ id: "task-2", code: "TASK-002", title: "Livrer le planning" }),
    ]);

    assert.ok(text.includes("TASK-001"));
    assert.ok(text.includes("TASK-002"));
  });

  it("rend une chaine vide quand rien n'attend", () => {
    assert.equal(describeWaitingDependencies([]), "");
  });
});

describe("message de refus au lancement", () => {
  it("nomme les taches qui manquent", () => {
    const message = unresolvedDependenciesMessage([link()]);

    assert.ok(message.includes("TASK-001"));
    assert.ok(message.includes("Definir le modele de domaine"));
  });

  it("rappelle ce qui satisfait une dependance", () => {
    const message = unresolvedDependenciesMessage([link()]);
    assert.ok(message.includes("terminee"));
  });

  it("ne contient aucun code technique", () => {
    const message = unresolvedDependenciesMessage([link()]);
    assert.ok(!message.includes("TASK_DEPENDENC"));
  });
});

describe("messages de refus d'une arete", () => {
  it("couvre chaque code sans en laisser un muet", () => {
    for (const code of Object.values(TASK_DEPENDENCY_ERROR)) {
      const message = dependencyRefusalMessage(code);
      assert.ok(message.length > 20, code);
      assert.ok(!message.includes("TASK_DEPENDENCY_"), code);
    }
  });

  it("explique un cycle sans jargon", () => {
    const message = dependencyRefusalMessage(TASK_DEPENDENCY_ERROR.CYCLE);

    assert.ok(message.includes("cycle"));
    assert.ok(message.includes("attend deja"));
    // Ni pile technique, ni nom de fonction.
    assert.ok(!message.includes("Error"));
    assert.ok(!message.includes("at "));
  });

  it("dit que l'inverse reste possible pour l'amorcage", () => {
    const message = dependencyRefusalMessage(TASK_DEPENDENCY_ERROR.BOOTSTRAP_SOURCE);
    assert.ok(message.includes("L'inverse reste possible"));
  });

  it("explique le gel par la lisibilite du contrat historique", () => {
    const message = dependencyRefusalMessage(TASK_DEPENDENCY_ERROR.FROZEN);
    assert.ok(message.includes("historique d'execution"));
  });
});

describe("aucun effet de bord", () => {
  it("le module de dependances n'appelle ni fournisseur, ni Claude Code, ni Git", async () => {
    const source = await readFile(path.join(HERE, "task-dependencies.ts"), "utf8");

    for (const forbidden of [
      "openai",
      "OpenAI",
      "ArchitectProvider",
      "startClaudeRun",
      "claudePreflight",
      "child_process",
      "simple-git",
      "git ",
    ]) {
      assert.ok(!source.includes(forbidden), forbidden);
    }
  });

  it("le module d'edition n'appelle ni fournisseur, ni Claude Code", async () => {
    const source = await readFile(path.join(HERE, "task-edit.ts"), "utf8");

    for (const forbidden of [
      "openai",
      "OpenAI",
      "ArchitectProvider",
      "startClaudeRun",
      "createRun",
      "child_process",
    ]) {
      assert.ok(!source.includes(forbidden), forbidden);
    }
  });

  it("la Server Action d'edition ne lance aucune execution", async () => {
    const source = await readFile(
      path.join(HERE, "..", "app", "projects", "[id]", "tasks", "[taskId]", "edit", "actions.ts"),
      "utf8",
    );

    // Enregistrer une tache est une ecriture SQLite suivie, au plus, d'une
    // reecriture de son document. Rien d'autre n'est atteignable depuis ce
    // fichier, et un ajout futur ferait echouer ce test.
    for (const forbidden of [
      "startClaudeRun",
      "createRun",
      "startTaskExecution",
      "generateBacklog",
      "OpenAIArchitectProvider",
      "openai",
    ]) {
      assert.ok(!source.includes(forbidden), forbidden);
    }
  });
});
