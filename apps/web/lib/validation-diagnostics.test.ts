/**
 * Ce que NOX conserve d'une panne de validation.
 *
 * ## Ce que ce fichier prouve
 *
 * Que « je n'ai pas pu regarder » dit desormais **pourquoi**, et que ce
 * pourquoi reste sur. Le premier pilote reel a lu :
 *
 * ```text
 * Infrastructure error
 * VALIDATION_SPAWN_FAILED
 * ```
 *
 * et rien d'autre — ni le programme en cause, ni le code systeme. Il n'y avait
 * aucun moyen de distinguer « npm est introuvable » de « le systeme a refuse de
 * demarrer le processus », alors que le premier se corrige en installant un
 * outil et le second pas.
 *
 * Et surtout : qu'une panne d'infrastructure ne devient jamais un echec de code.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { RUNNER_ERROR, boundErrorDetail } from "@nox/shared";

import { describeInfrastructureFailure } from "./runner/errors.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("describeInfrastructureFailure", () => {
  it("conserve le code reel du runner, jamais un code generique", () => {
    const described = describeInfrastructureFailure({
      kind: "runner_error",
      code: RUNNER_ERROR.VALIDATION_SPAWN_FAILED,
    });

    assert.equal(described.code, "VALIDATION_SPAWN_FAILED");
    assert.ok(described.message.length > 0);
  });

  it("ajoute le detail du runner quand il y en a un", () => {
    const described = describeInfrastructureFailure({
      kind: "runner_error",
      code: RUNNER_ERROR.VALIDATION_SPAWN_FAILED,
      detail: "Le systeme a refuse de demarrer la commande de validation. Code systeme : ENOENT.",
    });

    assert.match(described.message, /ENOENT/u);
  });

  it("reste lisible sans detail", () => {
    // Un echec sans detail est un echec normal : la phrase du code reste exacte,
    // et rien n'est invente pour combler le vide.
    const described = describeInfrastructureFailure({
      kind: "runner_error",
      code: RUNNER_ERROR.VALIDATION_SPAWN_FAILED,
    });

    assert.ok(described.message.trim().length > 0);
    assert.equal(described.message.includes("undefined"), false);
    assert.equal(described.message.includes("null"), false);
  });

  it("nomme aussi une panne de transport", () => {
    for (const kind of ["unreachable", "timeout", "not_configured", "invalid_response"] as const) {
      const described = describeInfrastructureFailure({ kind });

      assert.ok(described.code.length > 0, kind);
      assert.ok(described.message.length > 0, kind);
    }
  });

  it("ne parle jamais de la qualite du code", () => {
    // « Je n'ai pas pu regarder » n'est pas « j'ai regarde et c'est faux ».
    const described = describeInfrastructureFailure({
      kind: "runner_error",
      code: RUNNER_ERROR.VALIDATION_SPAWN_FAILED,
      detail: "Le systeme a refuse de demarrer la commande de validation. Code systeme : EINVAL.",
    });

    for (const forbidden of ["test", "echoue", "failed", "assertion"]) {
      assert.equal(described.message.toLowerCase().includes(forbidden), false, forbidden);
    }
  });
});

describe("boundErrorDetail", () => {
  it("retire les caracteres de controle", () => {
    const cleaned = boundErrorDetail(
      `Code${String.fromCharCode(0)} systeme${String.fromCharCode(7)} : ENOENT.`,
    );

    assert.equal(cleaned, "Code systeme : ENOENT.");
  });

  it("borne et annonce la troncature", () => {
    const cleaned = boundErrorDetail("a".repeat(1_000));

    assert.ok(cleaned !== null);
    assert.ok(cleaned.length <= 300);
    assert.ok(cleaned.endsWith("…"));
  });

  it("rend null pour un detail vide apres nettoyage", () => {
    assert.equal(boundErrorDetail("   "), null);
    assert.equal(boundErrorDetail(""), null);
  });
});

describe("ce que le diagnostic ne peut pas contenir", () => {
  it("n'est jamais construit a partir d'un message du systeme", async () => {
    // La surete ne vient pas d'un filtre : le module d'execution ecrit ses
    // phrases lui-meme, a partir du seul code errno. Le message d'origine de
    // Node — qui porte le chemin absolu de l'executable — n'est jamais recopie.
    const source = (
      await readFile(
        path.join(HERE, "..", "..", "runner", "src", "repositories", "run-validation.ts"),
        "utf8",
      )
    )
      .replace(/\/\*[\s\S]*?\*\//gu, " ")
      .replace(/\/\/.*$/gmu, " ");

    assert.equal(source.includes("error.message"), false);
    assert.equal(source.includes("detail: error"), false);
    assert.ok(source.includes("describeSpawnError"));
  });

  it("ne transmet jamais l'environnement au diagnostic", async () => {
    const source = (
      await readFile(path.join(HERE, "autonomous-validation.ts"), "utf8")
    )
      .replace(/\/\*[\s\S]*?\*\//gu, " ")
      .replace(/\/\/.*$/gmu, " ");

    for (const forbidden of ["process.env", "NOX_RUNNER_TOKEN", "sanitizeEnvironment"]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });
});
