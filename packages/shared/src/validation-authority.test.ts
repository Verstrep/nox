/**
 * Qui a le droit de valider un critere automatise.
 *
 * ## Ce que ce fichier prouve
 *
 * Que **seule** une preuve produite par NOX peut valider un critere `AUTOMATED`,
 * et que ce n'est pas une regle de discipline mais une propriete du type :
 * `deriveCriterionResult` ne recoit que des `AutonomousCommandOutcome`, c'est-a-
 * dire des lots executes par NOX. Ce que Claude Code rapporte — un
 * `RunValidationResult`, avec son propre statut `PASSED` — n'a aucun chemin vers
 * cette fonction.
 *
 * ## Pourquoi ce fichier existe maintenant
 *
 * HOTFIX-002 corrige l'affichage des commandes que Claude a lancees. Le risque
 * qu'introduit cette correction est precisement celui-la : qu'un « Claude a
 * lance `npm test`, et c'est passe » finisse un jour par compter comme une
 * preuve. Il ne doit pas, et le contrat de TASK-027 reste entier.
 *
 * Le decoupage du pilote TripKit sert de scenario : huit criteres, six
 * automatises derriere une commande, deux humains.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTONOMOUS_VALIDATION_STATUS,
  CRITERION_VERIFICATION_RESULT,
  RUN_VALIDATION_STATUS,
  TASK_VERIFICATION_OUTCOME,
  VERIFICATION_MODE,
  deriveCriterionResults,
  deriveTaskVerificationOutcome,
  type VerificationPlan,
} from "../dist/index.js";

const TEST_COMMAND = "cmd-test";
const BUILD_COMMAND = "cmd-build";

/** Le plan de TripKit TASK-001 : six criteres automatises, deux humains. */
const PLAN: VerificationPlan = {
  commands: [
    { id: BUILD_COMMAND, position: 0, command: "npm run build", executionMode: "AUTONOMOUS" },
    { id: TEST_COMMAND, position: 1, command: "npm test", executionMode: "AUTONOMOUS" },
  ],
  criteria: [
    ...[0, 1, 4, 5, 6, 7].map((position) => ({
      id: `auto-${String(position)}`,
      position,
      text: `Critere automatise ${String(position)}`,
      verificationMode: VERIFICATION_MODE.AUTOMATED,
      humanInstructions: null,
      commandIds: [TEST_COMMAND],
    })),
    ...[2, 3].map((position) => ({
      id: `humain-${String(position)}`,
      position,
      text: `Critere humain ${String(position)}`,
      verificationMode: VERIFICATION_MODE.HUMAN,
      humanInstructions: "Verifier a la main.",
      commandIds: [],
    })),
  ],
};

function resultsFor(status: string) {
  return deriveCriterionResults(PLAN, [
    { commandId: TEST_COMMAND, status: status as never },
    { commandId: BUILD_COMMAND, status: status as never },
  ]);
}

describe("seule la validation autonome de NOX fait preuve", () => {
  it("valide les six criteres automatises quand NOX a obtenu zero", () => {
    const results = resultsFor(AUTONOMOUS_VALIDATION_STATUS.PASSED);

    const automated = results.filter(
      (entry) => entry.criterion.verificationMode === VERIFICATION_MODE.AUTOMATED,
    );
    assert.equal(automated.length, 6);
    assert.ok(
      automated.every((entry) => entry.result === CRITERION_VERIFICATION_RESULT.PASSED),
      "les six criteres automatises sont verifies",
    );
  });

  it("laisse les deux criteres humains a un humain", () => {
    const results = resultsFor(AUTONOMOUS_VALIDATION_STATUS.PASSED);

    const human = results.filter(
      (entry) => entry.criterion.verificationMode === VERIFICATION_MODE.HUMAN,
    );
    assert.equal(human.length, 2);
    assert.ok(human.every((entry) => entry.result === CRITERION_VERIFICATION_RESULT.HUMAN));

    // Une tache mixte revient donc a un humain, meme entierement prouvee du
    // cote automatise.
    assert.equal(
      deriveTaskVerificationOutcome(results),
      TASK_VERIFICATION_OUTCOME.HUMAN_REQUIRED,
    );
  });

  it("ne verifie rien quand le lot a subi une panne", () => {
    const results = resultsFor(AUTONOMOUS_VALIDATION_STATUS.ERROR);

    const automated = results.filter(
      (entry) => entry.criterion.verificationMode === VERIFICATION_MODE.AUTOMATED,
    );
    // C'est l'etat exact de la tentative 1 du pilote : `VALIDATION_SPAWN_FAILED`
    // laisse les criteres non verifies. « Pas observe » n'est pas « faux ».
    assert.ok(
      automated.every((entry) => entry.result === CRITERION_VERIFICATION_RESULT.NOT_VERIFIED),
    );
    assert.notEqual(deriveTaskVerificationOutcome(results), TASK_VERIFICATION_OUTCOME.AUTO_FAILED);
  });

  it("distingue un echec constate d'une panne", () => {
    const results = resultsFor(AUTONOMOUS_VALIDATION_STATUS.FAILED);

    assert.equal(deriveTaskVerificationOutcome(results), TASK_VERIFICATION_OUTCOME.AUTO_FAILED);
  });

  it("n'accepte structurellement aucun resultat rapporte par Claude Code", () => {
    // La garantie n'est pas une regle a respecter : un `RunValidationResult`
    // n'a pas de `commandId`, donc il ne peut pas se faire passer pour une
    // preuve. Meme construit a la main, il ne verifie rien.
    const usurpateur = [
      { commandId: "", status: RUN_VALIDATION_STATUS.PASSED as never },
    ];

    const results = deriveCriterionResults(PLAN, usurpateur);
    const automated = results.filter(
      (entry) => entry.criterion.verificationMode === VERIFICATION_MODE.AUTOMATED,
    );

    assert.ok(
      automated.every((entry) => entry.result === CRITERION_VERIFICATION_RESULT.NOT_VERIFIED),
      "un statut venu de Claude Code ne verifie aucun critere",
    );
  });

  it("ne verifie rien avec un statut inconnu, quelle qu'en soit la source", () => {
    const results = deriveCriterionResults(PLAN, [
      { commandId: TEST_COMMAND, status: "RAN" as never },
      { commandId: BUILD_COMMAND, status: "RAN" as never },
    ]);

    const automated = results.filter(
      (entry) => entry.criterion.verificationMode === VERIFICATION_MODE.AUTOMATED,
    );
    assert.ok(
      automated.every((entry) => entry.result !== CRITERION_VERIFICATION_RESULT.PASSED),
    );
  });
});
