/**
 * Le plan de verification dans un formulaire HTML.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'un plan soumis se relit **par cles de ligne**, jamais par position : c'est
 * ce qui permet de supprimer la ligne du milieu sans deplacer une preuve, et de
 * distinguer deux commandes au texte identique.
 *
 * Qu'un formulaire forge — cles vides, cles en double, champs manquants — ne
 * produit jamais deux lignes qui partagent leurs champs.
 *
 * Et que ce module reste importable par un Client Component : c'est la seule
 * raison pour laquelle il existe a cote de `task-edit.ts`.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { COMMAND_EXECUTION_MODE, VERIFICATION_MODE } from "@nox/shared";

import {
  emptyCommandRow,
  emptyCriterionRow,
  planFieldNames,
  readPlanRows,
} from "./verification-fields.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Un formulaire tel que le composant partage le rendrait. */
function form(prefix: string, entries: readonly [string, string][]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) {
    data.append(`${prefix}${name}`, value);
  }
  return data;
}

describe("lecture d'un plan soumis", () => {
  it("rend les lignes dans l'ordre des cles", () => {
    const data = form("", [
      ["commandKey", "v1"],
      ["commandKey", "v2"],
      ["commandText.v1", "npm run test"],
      ["commandMode.v1", COMMAND_EXECUTION_MODE.AUTONOMOUS],
      ["commandText.v2", "npm run lint"],
      ["commandMode.v2", COMMAND_EXECUTION_MODE.AGENT_ONLY],
      ["criterionKey", "c1"],
      ["criterionText.c1", "La suite passe."],
      ["criterionMode.c1", VERIFICATION_MODE.AUTOMATED],
      ["criterionCommands.c1", "v1"],
    ]);

    const rows = readPlanRows(data, "");
    assert.deepEqual(
      rows.commands.map((row) => row.command),
      ["npm run test", "npm run lint"],
    );
    assert.equal(rows.criteria.length, 1);
    assert.deepEqual(rows.criteria[0]?.commandKeys, ["v1"]);
  });

  it("rattache une preuve a une ligne, pas a un texte", () => {
    // Deux commandes identiques restent deux lignes distinctes : la preuve
    // designe celle qui a ete cochee, et elle seule.
    const data = form("", [
      ["commandKey", "v1"],
      ["commandKey", "v2"],
      ["commandText.v1", "npm run test"],
      ["commandMode.v1", COMMAND_EXECUTION_MODE.AUTONOMOUS],
      ["commandText.v2", "npm run test"],
      ["commandMode.v2", COMMAND_EXECUTION_MODE.AUTONOMOUS],
      ["criterionKey", "c1"],
      ["criterionText.c1", "La suite passe."],
      ["criterionMode.c1", VERIFICATION_MODE.AUTOMATED],
      ["criterionCommands.c1", "v2"],
    ]);

    const rows = readPlanRows(data, "");
    assert.deepEqual(rows.criteria[0]?.commandKeys, ["v2"]);
  });

  it("ignore une cle vide ou repetee", () => {
    const data = form("", [
      ["criterionKey", "c1"],
      ["criterionKey", ""],
      ["criterionKey", "c1"],
      ["criterionText.c1", "Un critere."],
      ["criterionMode.c1", VERIFICATION_MODE.HUMAN],
    ]);

    const rows = readPlanRows(data, "");
    assert.equal(rows.criteria.length, 1, "deux lignes ne partagent jamais leurs champs");
  });

  it("rend une chaine vide pour un champ absent", () => {
    const data = form("", [["criterionKey", "c1"]]);
    const rows = readPlanRows(data, "");
    assert.equal(rows.criteria[0]?.text, "");
    assert.equal(rows.criteria[0]?.verificationMode, "");
    assert.deepEqual(rows.criteria[0]?.commandKeys, []);
  });

  it("isole deux plans par leur prefixe", () => {
    // La revue d'un backlog porte vingt plans dans un seul formulaire.
    const data = new FormData();
    data.append("items.0.criterionKey", "c1");
    data.append("items.0.criterionText.c1", "Premier plan.");
    data.append("items.1.criterionKey", "c1");
    data.append("items.1.criterionText.c1", "Second plan.");

    assert.equal(readPlanRows(data, "items.0.").criteria[0]?.text, "Premier plan.");
    assert.equal(readPlanRows(data, "items.1.").criteria[0]?.text, "Second plan.");
  });

  it("rend un plan vide pour un formulaire vide", () => {
    const rows = readPlanRows(new FormData(), "");
    assert.deepEqual(rows.criteria, []);
    assert.deepEqual(rows.commands, []);
  });
});

describe("noms de champs", () => {
  it("porte le prefixe sur chaque nom", () => {
    const names = planFieldNames("items.3.");
    assert.equal(names.criterionKey, "items.3.criterionKey");
    assert.equal(names.criterionText("c1"), "items.3.criterionText.c1");
    assert.equal(names.commandMode("v2"), "items.3.commandMode.v2");
  });
});

describe("lignes neuves", () => {
  it("naissent avec les valeurs qui n'autorisent rien", () => {
    // Une ligne qui naitrait automatisee, ou autonome, ouvrirait une porte que
    // personne n'a demandee.
    assert.equal(emptyCriterionRow("c1").verificationMode, VERIFICATION_MODE.HUMAN);
    assert.equal(emptyCommandRow("v1").executionMode, COMMAND_EXECUTION_MODE.AGENT_ONLY);
    assert.deepEqual(emptyCriterionRow("c1").commandKeys, []);
  });
});

describe("frontiere du navigateur", () => {
  it("n'entraine ni Node, ni la couche donnees", async () => {
    // Ce module est importe par un Client Component : une dependance vers
    // `@nox/database` ou `node:crypto` entrainerait le client Prisma dans le
    // bundle du navigateur.
    // Le controle porte sur les **imports**, pas sur la prose : l'entete de ce
    // module nomme justement ce qu'il refuse d'entrainer.
    const source = await readFile(path.join(HERE, "verification-fields.ts"), "utf8");
    const imports = [...source.matchAll(/^import[\s\S]*?from "([^"]+)";$/gmu)].map(
      (match) => match[1],
    );

    assert.deepEqual(imports, ["@nox/shared"]);
    for (const forbidden of ["@nox/database", "node:crypto", "node:fs", "next/"]) {
      assert.ok(!imports.includes(forbidden), forbidden);
    }
  });
});
