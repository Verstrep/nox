/**
 * L'echec d'une planification, tel que l'utilisateur le lit.
 *
 * ## Ce que ce fichier prouve
 *
 * Que le refus d'un backlog dit **quelle tache**, **quel champ** et **pourquoi**
 * — l'information que NOX possedait deja et qu'il gardait pour ses logs, laissant
 * a l'utilisateur un « format attendu » et un second appel a payer pour en
 * apprendre plus.
 *
 * Et qu'une panne du fournisseur garde son propre vocabulaire : « je n'ai pas pu
 * regarder » n'est jamais « j'ai regarde et c'est faux ».
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHITECT_BACKLOG_FAILURE,
  ARCHITECT_ERROR,
  type ArchitectBacklogDiagnostic,
} from "@nox/shared";

import { describeArchitectError } from "../architect/errors.ts";

import {
  BACKLOG_NO_DIAGNOSTIC_MESSAGE,
  backlogFailureMessage,
  describeBacklogFailure,
} from "./failure.ts";

describe("echec d'une planification, tel que l'utilisateur le lit", () => {
  const REFUSED: ArchitectBacklogDiagnostic = {
    category: ARCHITECT_BACKLOG_FAILURE.OUTPUT_INVALID,
    field: "tasks.0.acceptanceCriteria",
    message: "Un critere de Tache 1 est vide ou trop long.",
  };

  it("nomme la tache, le champ et la raison", () => {
    const failure = describeBacklogFailure(ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID, REFUSED);

    assert.equal(failure.field, "Tache 1 · Criteres d'acceptation");
    assert.equal(failure.path, "tasks.0.acceptanceCriteria");
    assert.equal(failure.detail, "Un critere de Tache 1 est vide ou trop long.");
    assert.match(failure.headline, /refusee par NOX/u);
  });

  it("dit qu'aucune tache n'a ete creee", () => {
    const message = backlogFailureMessage(ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID, REFUSED);

    assert.match(message, /Tache 1 · Criteres d'acceptation/u);
    assert.match(message, /vide ou trop long/u);
    assert.match(message, /Aucune tache n'a ete creee/u);
  });

  it("ne remplace jamais un message generique par une phrase vide", () => {
    // Le message d'un formulaire est la seule chose que l'utilisateur lit : il
    // ne doit jamais se reduire a un blanc.
    for (const diagnostic of [
      null,
      { category: ARCHITECT_BACKLOG_FAILURE.OUTPUT_INVALID, field: null, message: null },
      { category: ARCHITECT_BACKLOG_FAILURE.PROVIDER_ERROR, field: null, message: null },
    ] satisfies (ArchitectBacklogDiagnostic | null)[]) {
      const message = backlogFailureMessage(
        ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
        diagnostic,
      );
      assert.ok(message.trim().length > 0);
    }
  });

  it("affiche un repli propre pour une generation sans diagnostic enregistre", () => {
    // Exactement `BACKLOG-001` : echouee avant HOTFIX-001.
    const failure = describeBacklogFailure(ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID, {
      category: ARCHITECT_BACKLOG_FAILURE.OUTPUT_INVALID,
      field: null,
      message: null,
    });

    assert.equal(failure.field, null);
    assert.equal(failure.path, null);
    assert.equal(failure.detail, BACKLOG_NO_DIAGNOSTIC_MESSAGE);
  });

  it("garde a une panne du fournisseur son propre vocabulaire", () => {
    // Ne pretends jamais qu'une erreur reseau est un critere invalide.
    const failure = describeBacklogFailure(ARCHITECT_ERROR.ARCHITECT_TIMEOUT, {
      category: ARCHITECT_BACKLOG_FAILURE.PROVIDER_ERROR,
      field: null,
      message: null,
    });

    assert.equal(failure.headline, describeArchitectError(ARCHITECT_ERROR.ARCHITECT_TIMEOUT));
    assert.equal(failure.field, null);
    assert.equal(failure.detail, null);
    assert.doesNotMatch(failure.headline, /critere/iu);
  });

  it("affiche le chemin technique quand il ne sait pas le traduire", () => {
    const failure = describeBacklogFailure(ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID, {
      category: ARCHITECT_BACKLOG_FAILURE.OUTPUT_INVALID,
      field: "tasks.0.champInconnu",
      message: "Quelque chose ne va pas.",
    });

    assert.equal(failure.field, null);
    assert.equal(failure.path, "tasks.0.champInconnu");
    assert.match(
      backlogFailureMessage(ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID, {
        category: ARCHITECT_BACKLOG_FAILURE.OUTPUT_INVALID,
        field: "tasks.0.champInconnu",
        message: "Quelque chose ne va pas.",
      }),
      /tasks\.0\.champInconnu/u,
    );
  });

  it("survit a un code d'erreur inconnu", () => {
    const failure = describeBacklogFailure("CODE_QUI_N_EXISTE_PLUS", null);
    assert.ok(failure.headline.length > 0);
  });
});

describe("ce qui ne doit jamais atteindre l'ecran", () => {
  it("ne construit le message qu'a partir du diagnostic normalise", async () => {
    // La garantie ne repose pas sur un filtre : le module ne recoit ni la
    // reponse du fournisseur, ni le prompt, ni une exception. Il ne pourrait pas
    // les afficher meme s'il le voulait.
    const source = await readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "failure.ts"),
      "utf8",
    );
    // Les commentaires ont le droit de nommer ce que le module ne recoit pas :
    // c'est meme la qu'ils l'expliquent. Seul le code compte.
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");

    for (const forbidden of [
      "providerJson",
      "JSON.stringify",
      "instructions",
      "prompt",
      "apiKey",
      "process.env",
      "stack",
    ]) {
      assert.equal(
        code.includes(forbidden),
        false,
        `failure.ts ne doit pas manipuler ${forbidden}`,
      );
    }
  });

  it("ne laisse passer aucun caractere de controle depuis un diagnostic", () => {
    // Le nettoyage a lieu a l'ecriture ; ce test verifie que l'affichage n'en
    // reintroduit pas, en composant a partir de valeurs deja nettoyees.
    const message = backlogFailureMessage(ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID, {
      category: ARCHITECT_BACKLOG_FAILURE.OUTPUT_INVALID,
      field: "tasks.0.acceptanceCriteria",
      message: "Un critere est vide.",
    });

    const control = [...message].filter(
      (character) => character.charCodeAt(0) < 32 && character !== "\n",
    );
    assert.deepEqual(control, []);
  });
});
