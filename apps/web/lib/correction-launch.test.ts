/**
 * Ce que le moteur de correction ne fait pas.
 *
 * ## Pourquoi ce fichier lit une source
 *
 * Parce que les garanties de TASK-028 sont pour l'essentiel des **absences** :
 * aucun appel a un fournisseur, aucune ecriture Git, aucun second moteur Claude,
 * aucun contournement de la file. Une absence ne s'observe pas en lancant le
 * code une fois — un appel ajoute par megarde ne se verrait qu'a la facture.
 *
 * Le parcours complet — une correction qui part, sa validation, sa review — est
 * verifie par le test fonctionnel, avec un vrai runner et un faux Claude. Ici,
 * on protege ce qui ne doit jamais apparaitre.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function source(file: string): Promise<string> {
  return readFile(path.join(HERE, file), "utf8");
}

/** Le code seul : l'entete nomme ce qu'il refuse, et c'est une bonne chose. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/.*$/gmu, " ");
}

describe("aucune IA ne decide d'une correction", () => {
  it("le moteur n'appelle aucun fournisseur", async () => {
    const text = code(await source("correction-launch.ts"));
    for (const forbidden of [
      "OpenAI",
      "openai",
      "generateTurn",
      "generateBacklog",
      "NOX_OPENAI_API_KEY",
      "architect",
    ]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });

  it("le contexte de correction est construit localement", async () => {
    const text = code(await source("correction-evidence.ts"));
    for (const forbidden of ["OpenAI", "openai", "fetch(", "architect", "generateTurn"]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });

  it("le modele de lecture n'appelle ni fournisseur, ni Claude Code", async () => {
    const text = code(await source("correction-cycle.ts"));
    for (const forbidden of [
      "OpenAI",
      "openai",
      "startClaudeRun",
      "launchCorrection",
      "reserveCorrection",
      "child_process",
    ]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });
});

describe("aucune ecriture Git", () => {
  it("ne commite rien, ne restaure rien, ne nettoie rien", async () => {
    for (const file of ["correction-launch.ts", "correction-evidence.ts", "correction-cycle.ts"]) {
      const text = code(await source(file));
      for (const forbidden of [
        "git add",
        "git commit",
        "git push",
        "git reset",
        "git restore",
        "git checkout",
        "git clean",
      ]) {
        assert.ok(!text.includes(forbidden), `${file} · ${forbidden}`);
      }
    }
  });
});

describe("aucun interprete de commandes", () => {
  it("le moteur ne lance rien lui-meme", async () => {
    // L'execution appartient au runner, seule frontiere avec la machine.
    const text = code(await source("correction-launch.ts"));
    for (const forbidden of ["child_process", "shell: true", "execFile", "spawn("]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });
});

describe("le moteur revalide tout au moment d'agir", () => {
  it("relit le contexte avant le preflight, et le preflight avant toute ecriture", async () => {
    const text = code(await source("correction-launch.ts"));
    const contextIndex = text.indexOf("loadCorrectionContext");
    const preflightIndex = text.indexOf("ports.preflight");
    const writeIndex = text.indexOf("startCorrectionRun(db");
    const startIndex = text.indexOf("ports.start");

    assert.ok(contextIndex > 0 && preflightIndex > 0 && writeIndex > 0 && startIndex > 0);
    assert.ok(contextIndex < preflightIndex, "relire avant de sonder");
    assert.ok(preflightIndex < writeIndex, "sonder avant d'ecrire");
    assert.ok(writeIndex < startIndex, "ecrire avant de lancer");
  });

  it("revalide les dependances, la politique d'outils et la reprise", async () => {
    const text = code(await source("correction-launch.ts"));
    for (const required of [
      "listTaskDependencies",
      "buildClaudeToolPolicy",
      "checkResumeCandidate",
      "hasActiveRun",
    ]) {
      assert.ok(text.includes(required), required);
    }
  });

  it("n'ouvre aucune politique d'outils elargie pour une correction", async () => {
    // Une correction `NORMAL` garde les permissions `NORMAL`. La nature vient de
    // la tache relue en base, jamais d'un parametre.
    const text = code(await source("correction-launch.ts"));
    assert.ok(text.includes("taskKind: context.task.kind"), "la nature vient de la base");
    for (const forbidden of ["dangerously", "TASK_KIND.BOOTSTRAP", "allowAll", "extraTools"]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });

  it("n'expose aucun contournement", async () => {
    const text = code(await source("correction-launch.ts"));
    for (const forbidden of ["force:", "override:", "ignoreFailure", "skipPreflight", "forceLaunch"]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });
});

describe("le navigateur ne porte aucune autorite", () => {
  it("le moteur ne recoit ni prompt, ni preuve, ni chemin, ni commande", async () => {
    const text = code(await source("correction-launch.ts"));
    // Le seul texte accepte de l'appelant est le feedback humain et des
    // identifiants ; tout le reste est relu.
    for (const forbidden of [
      "repositoryPath:string",
      "input.repositoryPath",
      "input.prompt",
      "input.command",
      "input.evidence",
      "input.attemptNumber",
    ]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
    assert.ok(text.includes("project.repositoryPath"), "le chemin est relu en base");
  });

  it("filtre les identifiants de criteres humains contre la base", async () => {
    const text = code(await source("correction-launch.ts"));
    assert.ok(text.includes("readableHumanIds"), "les identifiants sont filtres");
    assert.ok(text.includes("review.humanCriteria"), "la liste vient de la base");
  });
});

describe("une reservation non consommee est rendue", () => {
  it("abandonne explicitement plutot que de laisser la place bloquee", async () => {
    const text = code(await source("correction-launch.ts"));
    assert.ok(text.includes("abandonCorrection"), "la reservation est rendue");
    // Et le refus porte la raison : « NOX a renonce » et « NOX corrige » ne
    // doivent pas se lire pareil.
    assert.ok(text.includes("refusalCode") || text.includes("code)"), "la raison est enregistree");
  });
});
