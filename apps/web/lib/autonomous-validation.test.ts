/**
 * Ce que l'orchestrateur des validations autonomes ne fait pas.
 *
 * ## Pourquoi ce fichier lit une source
 *
 * Parce que les garanties de TASK-027 sont des **absences**, et qu'une absence
 * ne s'observe pas en lancant le code une fois : un appel a un fournisseur
 * ajoute par megarde ne se verrait qu'au moment de la facture. Le controle porte
 * donc sur ce que le module importe et sur ce qu'il ecrit.
 *
 * Le parcours complet — un lot qui part, ses resultats, la completion
 * automatique — est verifie par le test fonctionnel, avec un vrai runner et un
 * vrai repository. Ici, on protege ce qui ne doit jamais apparaitre.
 *
 * ## Ce que TASK-028 a ajoute, et ce qu'elle n'a pas ajoute
 *
 * Un lot en echec peut desormais ouvrir une correction. Ce module **decide** de
 * la demander ; il ne la lance pas lui-meme. Aucun second moteur Claude n'est
 * apparu ici : ni prompt, ni spawn, ni appel direct au runner. La demande passe
 * par le moteur de correction existant, et l'autorisation vient de la file.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { VALIDATION_SKIP } from "./autonomous-validation.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function source(): Promise<string> {
  return readFile(path.join(HERE, "autonomous-validation.ts"), "utf8");
}

/** Le code seul : l'entete nomme ce qu'il refuse, et c'est une bonne chose. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/.*$/gmu, " ");
}

describe("aucune IA dans la validation autonome", () => {
  it("n'appelle aucun fournisseur", async () => {
    const text = code(await source());
    for (const forbidden of [
      "OpenAI",
      "openai",
      "architect",
      "generateTurn",
      "generateBacklog",
      "NOX_OPENAI_API_KEY",
    ]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });

  it("ne demande jamais son avis a Claude Code", async () => {
    // « Est-ce que c'est bon ? » n'est pas une preuve : NOX execute des
    // commandes et lit des codes de sortie, il ne consulte personne.
    const text = code(await source());
    for (const forbidden of ["startClaudeRun", "claude/runs", "spawn(", "prompt"]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });
});

describe("aucune ecriture Git", () => {
  it("ne commite rien, ne restaure rien", async () => {
    const text = code(await source());
    for (const forbidden of [
      "git add",
      "git commit",
      "git push",
      "git reset",
      "git restore",
      "git checkout",
      "git clean",
    ]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });
});

describe("aucun interprete de commandes", () => {
  it("ne lance rien lui-meme", async () => {
    // L'execution appartient au runner, seule frontiere avec la machine. Ce
    // module orchestre ; il ne spawn pas.
    const text = code(await source());
    for (const forbidden of ["child_process", "shell: true", "execFile", "exec("]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });
});

describe("raisons de ne pas lancer un lot", () => {
  it("distingue chaque cause, sans fourre-tout", async () => {
    // Chaque valeur repond a une question differente, et l'ecran n'affiche pas
    // la meme phrase pour « rien a valider » et « le plan est invalide ».
    const values = Object.values(VALIDATION_SKIP);
    assert.equal(new Set(values).size, values.length);
    assert.ok(values.includes("NO_AUTOMATED_VALIDATION"));
    assert.ok(values.includes("PLAN_INVALID"));
    assert.ok(values.includes("RUN_NOT_COMPLETED"));
    assert.ok(values.includes("ALREADY_RESERVED"));
  });

  it("ne cree aucun lot artificiel quand rien n'est a valider", async () => {
    // Une tache entierement humaine n'a pas de lot vide a afficher : l'ecran
    // dira « aucune validation autonome configuree », ce qui est different.
    const text = code(await source());
    const skipIndex = text.indexOf("VALIDATION_SKIP.NO_AUTOMATED_VALIDATION");
    const reserveIndex = text.indexOf("await reserveValidationBatch");
    assert.ok(skipIndex > 0 && reserveIndex > 0);
    assert.ok(
      skipIndex < reserveIndex,
      "la sortie precede la reservation : aucun lot n'est ouvert pour rien",
    );
  });
});

describe("la completion automatique ne se force pas", () => {
  it("n'expose aucun contournement", async () => {
    const text = code(await source());
    // `overrideReason` est une donnee ecrite avec une decision humaine : ce qui
    // est interdit, c'est un **parametre** qui contournerait la verification.
    for (const forbidden of ["force:", "override:", "ignoreFailure", "skipValidation", "forceComplete"]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });
});

describe("la correction automatique n'est pas un second moteur", () => {
  it("delegue au moteur de correction existant", async () => {
    // Le dispatcher choisit, le moteur execute. Un prompt construit ici, ou un
    // appel direct au runner, signifierait qu'un second chemin vers Claude Code
    // vient d'apparaitre — exactement ce que la file avait deja evite.
    const text = code(await source());
    assert.ok(text.includes("launchCorrection"), "le moteur existant est appele");
    for (const forbidden of [
      "renderClaudeCorrectionPrompt",
      "buildCorrectionPrompt",
      "startClaudeRun",
      "claudeCorrectionPreflight",
      "buildClaudeToolPolicy",
    ]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });

  it("ne corrige jamais sans avoir relu la file et la borne", async () => {
    // La garantie de TASK-028 : il ne doit exister aucun chemin « validation
    // echouee -> correction » qui ne passe pas par la decision serveur. Celle-ci
    // relit l'appartenance a la file, la barriere courante, l'autorisation et le
    // compte de tentatives.
    const text = code(await source());
    const contextIndex = text.indexOf("loadCorrectionContext");
    const decisionIndex = text.indexOf("context.automatic.eligible");
    const reserveIndex = text.indexOf("await reserveCorrection");
    assert.ok(contextIndex > 0, "le contexte est relu");
    assert.ok(decisionIndex > 0, "la decision est consultee");
    assert.ok(reserveIndex > 0, "la reservation existe");
    assert.ok(
      contextIndex < decisionIndex && decisionIndex < reserveIndex,
      "relire, puis decider, puis reserver — jamais l'inverse",
    );
  });

  it("ne recoit aucun etat du navigateur", async () => {
    const text = code(await source());
    for (const forbidden of ["formData", "FormData", "searchParams", "request."]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });
});
