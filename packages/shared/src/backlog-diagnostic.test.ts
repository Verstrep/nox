/**
 * Diagnostic sur d'un echec de planification.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'un refus de validation garde ce qui le rend actionnable — quelle tache,
 * quel champ, pourquoi — et perd tout le reste. Le JSON brut du fournisseur, le
 * prompt et les traces n'entrent pas dans ce module : il n'y a donc rien a
 * filtrer, et ces tests verifient que rien n'y a ete rajoute par la bande.
 *
 * Et qu'une panne du fournisseur n'emprunte jamais le vocabulaire d'un critere
 * invalide : « je n'ai pas pu regarder » n'est pas « j'ai regarde et c'est
 * faux ».
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARCHITECT_BACKLOG_DIAGNOSTIC_LIMITS,
  ARCHITECT_BACKLOG_FAILURE,
  ARCHITECT_ERROR,
  architectBacklogFailureCategory,
  describeBacklogDiagnosticField,
  sanitizeBacklogDiagnosticText,
} from "../dist/index.js";

describe("architectBacklogFailureCategory", () => {
  it("distingue une reponse refusee d'une panne du fournisseur", () => {
    assert.equal(
      architectBacklogFailureCategory(ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID),
      ARCHITECT_BACKLOG_FAILURE.OUTPUT_INVALID,
    );

    for (const code of [
      ARCHITECT_ERROR.ARCHITECT_TIMEOUT,
      ARCHITECT_ERROR.ARCHITECT_RATE_LIMITED,
      ARCHITECT_ERROR.ARCHITECT_AUTH_FAILED,
      ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR,
      ARCHITECT_ERROR.ARCHITECT_CONTEXT_TOO_LARGE,
      ARCHITECT_ERROR.ARCHITECT_REFUSED,
    ]) {
      assert.equal(
        architectBacklogFailureCategory(code),
        ARCHITECT_BACKLOG_FAILURE.PROVIDER_ERROR,
        `${code} n'est pas une sortie invalide`,
      );
    }
  });

  it("traite un code absent comme une panne, jamais comme un champ refuse", () => {
    // Une generation ancienne sans code n'a pas de champ fautif a montrer.
    assert.equal(
      architectBacklogFailureCategory(null),
      ARCHITECT_BACKLOG_FAILURE.PROVIDER_ERROR,
    );
  });
});

describe("describeBacklogDiagnosticField", () => {
  it("nomme la tache et le champ, en comptant a partir de un", () => {
    assert.equal(
      describeBacklogDiagnosticField("tasks.0.acceptanceCriteria"),
      "Tache 1 · Criteres d'acceptation",
    );
    assert.equal(
      describeBacklogDiagnosticField("tasks.7.validationCommands"),
      "Tache 8 · Commandes de validation",
    );
    assert.equal(describeBacklogDiagnosticField("tasks.2"), "Tache 3");
  });

  it("nomme les champs de premier niveau", () => {
    assert.equal(describeBacklogDiagnosticField("tasks"), "Liste des taches");
    assert.equal(describeBacklogDiagnosticField("message"), "Resume de la proposition");
    assert.equal(describeBacklogDiagnosticField("backlog"), "Reponse de planification");
  });

  it("rend null plutot qu'une traduction approximative", () => {
    // L'appelant affiche alors le chemin technique, qui reste exact.
    assert.equal(describeBacklogDiagnosticField("tasks.0.inconnu"), null);
    assert.equal(describeBacklogDiagnosticField("n'importe quoi"), null);
    assert.equal(describeBacklogDiagnosticField(""), null);
  });

  it("ne se laisse pas allonger indefiniment par un index", () => {
    assert.equal(describeBacklogDiagnosticField("tasks.99999.title"), null);
  });
});

describe("sanitizeBacklogDiagnosticText", () => {
  it("retire les caracteres de controle", () => {
    // Construits par leur code : un caractere de controle recopie dans un
    // fichier source ne survit pas a un editeur, et le test cesserait de
    // prouver quoi que ce soit sans que personne ne le voie.
    const nul = String.fromCharCode(0);
    const bell = String.fromCharCode(7);
    const unitSeparator = String.fromCharCode(31);

    const cleaned = sanitizeBacklogDiagnosticText(
      `Un${nul} critere${bell} vide${unitSeparator}`,
      100,
    );

    assert.equal(cleaned, "Un critere vide");
  });

  it("ecrase les blancs et les retours a la ligne", () => {
    assert.equal(sanitizeBacklogDiagnosticText("  Un\n\ncritere   vide  ", 100), "Un critere vide");
  });

  it("annonce une troncature plutot que de couper en silence", () => {
    const cleaned = sanitizeBacklogDiagnosticText("a".repeat(200), 40);
    assert.ok(cleaned !== null);
    assert.ok(cleaned.length <= 40);
    assert.ok(cleaned.endsWith("[…]"));
  });

  it("rend null pour un texte vide apres nettoyage", () => {
    // Mieux vaut « cause non enregistree » qu'une ligne vide qui ressemble a une
    // information.
    assert.equal(sanitizeBacklogDiagnosticText("     ", 100), null);
    assert.equal(sanitizeBacklogDiagnosticText("", 100), null);
  });

  it("borne le champ plus court que la phrase", () => {
    assert.ok(
      ARCHITECT_BACKLOG_DIAGNOSTIC_LIMITS.field < ARCHITECT_BACKLOG_DIAGNOSTIC_LIMITS.message,
    );
  });
});
