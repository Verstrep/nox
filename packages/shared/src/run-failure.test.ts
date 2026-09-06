/**
 * Ce que NOX affirme, et ce qu'il refuse d'affirmer, d'une terminaison.
 *
 * Le second pilote reel n'avait qu'un `CLAUDE_PROCESS_FAILED` et un `exit 1`.
 * Ces tests protegent la distinction que ce code ne portait pas — un processus
 * jamais demarre, un processus sorti en erreur, un agent qui renonce, un
 * processus tue par un signal — et surtout la regle qui empeche cette
 * distinction de devenir une invention : quand aucun fait ne tranche, la
 * reponse est `UNKNOWN`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RUN_FAILURE_CATEGORY,
  RUN_FAILURE_LIMITS,
  boundFailureDetail,
  categoryMayLeavePartialWork,
  deriveRunFailureCategory,
  isRunFailureCategory,
  readRunFailureCategory,
} from "../dist/index.js";

describe("deriveRunFailureCategory", () => {
  it("separe une sortie non nulle d'un agent qui se declare en erreur", () => {
    // Le defaut exact du pilote reel : ces deux cas partageaient un code, et
    // n'appellent pourtant pas le meme geste.
    assert.equal(
      deriveRunFailureCategory({
        status: "FAILED",
        errorCode: "CLAUDE_PROCESS_FAILED",
        exitCode: 1,
      }),
      RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO,
    );
    assert.equal(
      deriveRunFailureCategory({
        status: "FAILED",
        errorCode: "CLAUDE_PROCESS_FAILED",
        exitCode: 0,
      }),
      RUN_FAILURE_CATEGORY.AGENT_REPORTED_ERROR,
    );
  });

  it("ne tranche pas un processus tue par un signal", () => {
    // Aucun code de sortie, aucun delai depasse, aucune annulation : NOX sait
    // qu'il est mort, pas pourquoi. `UNKNOWN` est la reponse honnete.
    assert.equal(
      deriveRunFailureCategory({
        status: "FAILED",
        errorCode: "CLAUDE_PROCESS_FAILED",
        exitCode: null,
      }),
      RUN_FAILURE_CATEGORY.UNKNOWN,
    );
  });

  it("reconnait les codes qui designent une cause a eux seuls", () => {
    const cases: readonly [string, string][] = [
      ["CLAUDE_START_FAILED", RUN_FAILURE_CATEGORY.SPAWN_FAILED],
      ["CLAUDE_TIMEOUT", RUN_FAILURE_CATEGORY.TIMEOUT],
      ["CLAUDE_OUTPUT_INVALID", RUN_FAILURE_CATEGORY.STREAM_UNREADABLE],
      ["CLAUDE_LIMIT_REACHED", RUN_FAILURE_CATEGORY.USAGE_LIMIT],
      ["GIT_POLICY_VIOLATION", RUN_FAILURE_CATEGORY.GIT_POLICY_VIOLATION],
      ["CLAUDE_RUN_NOT_FOUND", RUN_FAILURE_CATEGORY.TRANSPORT_FAILED],
    ];
    for (const [errorCode, expected] of cases) {
      assert.equal(
        deriveRunFailureCategory({ status: "FAILED", errorCode, exitCode: 1 }),
        expected,
        errorCode,
      );
    }
  });

  it("reconnait une annulation avant tout autre indice", () => {
    // Un processus tue rend presque toujours un code non nul. Sans cette
    // priorite, une annulation obtenue se lirait comme une panne.
    assert.equal(
      deriveRunFailureCategory({ status: "CANCELLED", errorCode: null, exitCode: 143 }),
      RUN_FAILURE_CATEGORY.CANCELLED,
    );
  });

  it("rend UNKNOWN pour un code que ce web ne connait pas", () => {
    // Un runner plus recent peut emettre un code inconnu. Le ranger dans une
    // categorie plausible serait une invention ; `UNKNOWN` ne l'est pas.
    assert.equal(
      deriveRunFailureCategory({ status: "FAILED", errorCode: "CODE_DU_FUTUR", exitCode: 3 }),
      RUN_FAILURE_CATEGORY.UNKNOWN,
    );
  });
});

describe("readRunFailureCategory", () => {
  it("prefere toujours la valeur enregistree a une derivation", () => {
    // L'inverse reecrirait l'histoire a chaque lecture : ce qui a ete observe le
    // jour de l'execution fait autorite sur ce qu'on en deduirait aujourd'hui.
    assert.equal(
      readRunFailureCategory(RUN_FAILURE_CATEGORY.TIMEOUT, {
        status: "FAILED",
        errorCode: "CLAUDE_PROCESS_FAILED",
        exitCode: 1,
      }),
      RUN_FAILURE_CATEGORY.TIMEOUT,
    );
  });

  it("derive pour une execution anterieure a HOTFIX-006", () => {
    assert.equal(
      readRunFailureCategory(null, {
        status: "FAILED",
        errorCode: "CLAUDE_PROCESS_FAILED",
        exitCode: 1,
      }),
      RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO,
    );
  });

  it("ignore une valeur stockee hors de la liste fermee", () => {
    assert.equal(
      readRunFailureCategory("QUELQUE_CHOSE", {
        status: "FAILED",
        errorCode: "CLAUDE_TIMEOUT",
        exitCode: null,
      }),
      RUN_FAILURE_CATEGORY.TIMEOUT,
    );
  });
});

describe("categoryMayLeavePartialWork", () => {
  it("exclut ce qui n'a rien pu produire", () => {
    assert.equal(categoryMayLeavePartialWork(RUN_FAILURE_CATEGORY.SPAWN_FAILED), false);
    assert.equal(categoryMayLeavePartialWork(RUN_FAILURE_CATEGORY.USAGE_LIMIT), false);
  });

  it("accepte le cas du pilote reel", () => {
    assert.equal(categoryMayLeavePartialWork(RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO), true);
  });

  it("accepte l'ignorance plutot que de la traiter comme un vide", () => {
    // « Je ne sais pas ce qui a tue le processus » n'est pas « il n'a rien
    // ecrit ». Refuser la reprise ici jetterait un travail bien reel.
    assert.equal(categoryMayLeavePartialWork(RUN_FAILURE_CATEGORY.UNKNOWN), true);
  });
});

describe("boundFailureDetail", () => {
  it("retire les caracteres de controle", () => {
    const cleaned = boundFailureDetail("avant\u0000\u001Bapres");
    assert.ok(cleaned !== null);
    assert.equal(cleaned.includes("\u0000"), false);
    assert.equal(cleaned.includes("\u001B"), false);
  });

  it("borne, et annonce la coupe", () => {
    const cleaned = boundFailureDetail("x".repeat(RUN_FAILURE_LIMITS.detail * 3));
    assert.ok(cleaned !== null);
    assert.ok(cleaned.length <= RUN_FAILURE_LIMITS.detail);
    assert.ok(cleaned.endsWith("…"));
  });

  it("rend null pour un texte vide", () => {
    assert.equal(boundFailureDetail("   \n  "), null);
  });

  it("reduit les espaces sans toucher au sens", () => {
    assert.equal(boundFailureDetail("  code   1  "), "code 1");
  });
});

describe("isRunFailureCategory", () => {
  it("reconnait la liste fermee, et rien d'autre", () => {
    assert.equal(isRunFailureCategory(RUN_FAILURE_CATEGORY.TIMEOUT), true);
    assert.equal(isRunFailureCategory("TIMED_OUT"), false);
    assert.equal(isRunFailureCategory(null), false);
    assert.equal(isRunFailureCategory(42), false);
  });
});
