/**
 * Le contrat de verification d'une tache.
 *
 * ## Ce que ce fichier prouve
 *
 * Que la classification est **fermee** : un critere est automatise ou humain, et
 * rien d'autre ne se glisse entre les deux. Qu'un critere automatise ne peut pas
 * s'appuyer sur une commande que NOX n'executera jamais. Qu'une commande qui ne
 * se termine pas, qui installe, qui publie ou qui touche a Git n'est jamais
 * autonome.
 *
 * Et surtout : qu'aucun chemin ne mene d'une preuve manquante a une completion
 * automatique.
 *
 * Pur : aucune base, aucun disque, aucun processus.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RUN_STATUS,
  TASK_KIND,
  TASK_STATUS,
  AUTONOMOUS_VALIDATION_STATUS,
  AUTO_COMPLETION_REFUSAL,
  COMMAND_EXECUTION_MODE,
  CRITERION_VERIFICATION_RESULT,
  TASK_VERIFICATION_OUTCOME,
  VALIDATION_BATCH_STATUS,
  VERIFICATION_MODE,
  VERIFICATION_PLAN_ERROR,
  autonomousCommandsFor,
  checkAutoCompletion,
  checkAutonomousCommand,
  checkVerificationPlan,
  deriveCriterionResult,
  deriveCriterionResults,
  deriveTaskVerificationOutcome,
  humanCriteriaOf,
  isValidationFailure,
  parseValidationCommand,
  planAllowsAutoCompletion,
  planRequiresHuman,
  type AutoCompletionFacts,
  type VerificationPlan,
  type VerificationPlanCommand,
  type VerificationPlanCriterion,
} from "../dist/index.js";

// --- Fabriques ---------------------------------------------------------------

function command(overrides: Partial<VerificationPlanCommand> = {}): VerificationPlanCommand {
  return {
    id: "cmd-1",
    position: 0,
    command: "npm test",
    executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS,
    ...overrides,
  };
}

function criterion(overrides: Partial<VerificationPlanCriterion> = {}): VerificationPlanCriterion {
  return {
    id: "crit-1",
    position: 0,
    text: "La persistance survit au rechargement",
    verificationMode: VERIFICATION_MODE.AUTOMATED,
    humanInstructions: null,
    commandIds: ["cmd-1"],
    ...overrides,
  };
}

function humanCriterion(overrides: Partial<VerificationPlanCriterion> = {}) {
  return criterion({
    id: "crit-h",
    verificationMode: VERIFICATION_MODE.HUMAN,
    humanInstructions: "Verifier au clavier que le focus suit l'ordre visuel.",
    commandIds: [],
    ...overrides,
  });
}

function plan(overrides: Partial<VerificationPlan> = {}): VerificationPlan {
  return { criteria: [criterion()], commands: [command()], ...overrides };
}

function codesOf(check: ReturnType<typeof checkVerificationPlan>): string[] {
  return check.ok ? [] : check.issues.map((issue) => issue.code);
}

// --- Politique des commandes autonomes ---------------------------------------

describe("checkAutonomousCommand", () => {
  for (const accepted of [
    "npm test",
    "npm run build",
    "npm run typecheck",
    "npx tsc --noEmit",
    "python -m pytest",
    "pytest",
    "cargo test",
    "go test ./...",
    "dotnet test",
    "make check",
  ]) {
    it(`accepte « ${accepted} »`, () => {
      assert.equal(checkAutonomousCommand(accepted), null);
    });
  }

  // Un serveur ou un mode surveillance ne se termine pas de lui-meme : le
  // lancer sans surveillance immobiliserait la validation jusqu'au delai.
  for (const endless of [
    "npm run dev",
    "npm run start",
    "npm run serve",
    "npm run preview",
    "npm run watch",
    "vitest --watch",
  ]) {
    it(`refuse « ${endless} » comme autonome`, () => {
      assert.notEqual(checkAutonomousCommand(endless), null);
    });
  }

  it("ne refuse pas sur une simple sous-chaine", () => {
    // Le controle porte sur le jeton entier : « test-server » n'est pas
    // « server », et refuser dessus produirait un faux positif absurde.
    assert.equal(checkAutonomousCommand("npm run test-server"), null);
    assert.equal(checkAutonomousCommand("npm run build-preview-report"), null);
  });

  for (const install of ["npm install", "npm ci", "pip install pytest", "cargo install cargo-nextest"]) {
    it(`refuse l'installation « ${install} »`, () => {
      assert.notEqual(checkAutonomousCommand(install), null);
    });
  }

  for (const forbidden of [
    "git commit -m x",
    "git push",
    "npm publish",
    "docker build .",
    "kubectl apply",
    "ssh serveur",
    "sudo make",
    "rm -rf dist",
  ]) {
    it(`refuse « ${forbidden} »`, () => {
      assert.notEqual(checkAutonomousCommand(forbidden), null);
    });
  }

  it("refuse un programme hors de la liste fermee", () => {
    assert.notEqual(checkAutonomousCommand("mon-script-maison verifie"), null);
  });

  it("refuse tout ce que la politique generale refusait deja", () => {
    // La premiere barriere est celle qui existait avant TASK-027 : chainage,
    // redirection, guillemets, substitution.
    assert.notEqual(checkAutonomousCommand("npm test && npm run build"), null);
    assert.notEqual(checkAutonomousCommand("npm test > out.txt"), null);
    assert.notEqual(checkAutonomousCommand("npm test; echo ok"), null);
  });
});

describe("parseValidationCommand", () => {
  it("decoupe en programme et arguments", () => {
    assert.deepEqual(parseValidationCommand("npm run typecheck"), {
      program: "npm",
      args: ["run", "typecheck"],
    });
  });

  it("conserve les options telles quelles", () => {
    assert.deepEqual(parseValidationCommand("go test ./..."), {
      program: "go",
      args: ["test", "./..."],
    });
  });

  it("refuse ce que la politique generale refuse", () => {
    // Le decoupage n'existe que parce qu'il n'y a rien a interpreter : une
    // commande porteuse de syntaxe n'a pas de decoupage sur.
    assert.equal(parseValidationCommand("npm test && rm -rf ."), null);
    assert.equal(parseValidationCommand(""), null);
  });
});

// --- Validite du plan --------------------------------------------------------

describe("checkVerificationPlan", () => {
  it("accepte un plan automatise complet", () => {
    assert.equal(checkVerificationPlan(plan()).ok, true);
  });

  it("accepte un plan humain complet", () => {
    const check = checkVerificationPlan({ criteria: [humanCriterion()], commands: [] });
    assert.equal(check.ok, true);
  });

  it("refuse une tache sans aucun critere", () => {
    assert.deepEqual(codesOf(checkVerificationPlan({ criteria: [], commands: [] })), [
      VERIFICATION_PLAN_ERROR.NO_CRITERIA,
    ]);
  });

  it("refuse un critere automatise sans commande", () => {
    const check = checkVerificationPlan(plan({ criteria: [criterion({ commandIds: [] })] }));
    assert.ok(codesOf(check).includes(VERIFICATION_PLAN_ERROR.AUTOMATED_WITHOUT_COMMAND));
  });

  it("refuse un critere automatise prouve par une commande inconnue", () => {
    const check = checkVerificationPlan(plan({ criteria: [criterion({ commandIds: ["absente"] })] }));
    assert.ok(codesOf(check).includes(VERIFICATION_PLAN_ERROR.AUTOMATED_COMMAND_UNKNOWN));
  });

  it("refuse un critere automatise prouve par une commande AGENT_ONLY", () => {
    // C'est le coeur de la distinction : NOX n'executera jamais cette commande,
    // donc elle ne peut rien prouver.
    const check = checkVerificationPlan(
      plan({ commands: [command({ executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY })] }),
    );
    assert.ok(codesOf(check).includes(VERIFICATION_PLAN_ERROR.AUTOMATED_COMMAND_NOT_AUTONOMOUS));
  });

  it("refuse un critere humain sans instruction", () => {
    const check = checkVerificationPlan({
      criteria: [humanCriterion({ humanInstructions: null })],
      commands: [],
    });
    assert.ok(codesOf(check).includes(VERIFICATION_PLAN_ERROR.HUMAN_WITHOUT_INSTRUCTIONS));
  });

  it("refuse une instruction vide ou blanche", () => {
    const check = checkVerificationPlan({
      criteria: [humanCriterion({ humanInstructions: "   " })],
      commands: [],
    });
    assert.ok(codesOf(check).includes(VERIFICATION_PLAN_ERROR.HUMAN_WITHOUT_INSTRUCTIONS));
  });

  it("refuse une instruction demesuree", () => {
    const check = checkVerificationPlan({
      criteria: [humanCriterion({ humanInstructions: "a".repeat(5_000) })],
      commands: [],
    });
    assert.ok(codesOf(check).includes(VERIFICATION_PLAN_ERROR.HUMAN_INSTRUCTIONS_TOO_LONG));
  });

  it("refuse un critere humain qui pretend s'appuyer sur une commande", () => {
    const check = checkVerificationPlan(
      plan({ criteria: [humanCriterion({ commandIds: ["cmd-1"] })] }),
    );
    assert.ok(codesOf(check).includes(VERIFICATION_PLAN_ERROR.HUMAN_WITH_COMMANDS));
  });

  it("refuse une commande declaree autonome que la politique interdit", () => {
    const check = checkVerificationPlan(
      plan({ commands: [command({ command: "npm run dev" })] }),
    );
    assert.ok(codesOf(check).includes(VERIFICATION_PLAN_ERROR.COMMAND_NOT_AUTONOMOUS));
  });

  it("rend tous les defauts d'un coup", () => {
    // Corriger un critere pour en decouvrir un autre au clic suivant serait une
    // facon lente de dire la meme chose.
    const check = checkVerificationPlan({
      criteria: [
        criterion({ id: "a", commandIds: [] }),
        humanCriterion({ id: "b", humanInstructions: null }),
      ],
      commands: [],
    });
    assert.equal(check.ok, false);
    assert.ok(check.ok === false && check.issues.length >= 2);
  });

  it("rattache chaque defaut a ce qui le porte", () => {
    const check = checkVerificationPlan(plan({ criteria: [criterion({ commandIds: [] })] }));
    assert.equal(check.ok, false);
    assert.equal(check.ok === false && check.issues[0]?.criterionId, "crit-1");
  });
});

// --- Selection des commandes -------------------------------------------------

describe("autonomousCommandsFor", () => {
  it("n'execute une commande qu'une fois, meme partagee", () => {
    // Dix criteres qui s'appuient sur `npm run build` ne produisent pas dix
    // builds : la preuve est la meme, et deux executions pourraient differer.
    const commands = autonomousCommandsFor({
      commands: [command()],
      criteria: [
        criterion({ id: "a", position: 0, commandIds: ["cmd-1"] }),
        criterion({ id: "b", position: 1, commandIds: ["cmd-1"] }),
        criterion({ id: "c", position: 2, commandIds: ["cmd-1"] }),
      ],
    });
    assert.equal(commands.length, 1);
  });

  it("suit l'ordre de la tache", () => {
    const commands = autonomousCommandsFor({
      commands: [
        command({ id: "b", position: 1, command: "npm run build" }),
        command({ id: "a", position: 0, command: "npm test" }),
      ],
      criteria: [criterion({ commandIds: ["a", "b"] })],
    });
    assert.deepEqual(
      commands.map((entry) => entry.command),
      ["npm test", "npm run build"],
    );
  });

  it("ignore une commande autonome qu'aucun critere ne reclame", () => {
    // Une commande enregistree mais non liee n'est la preuve de rien : la
    // lancer couterait du temps sans rien conclure.
    const commands = autonomousCommandsFor({
      commands: [command({ id: "cmd-1" }), command({ id: "orpheline", position: 1 })],
      criteria: [criterion({ commandIds: ["cmd-1"] })],
    });
    assert.deepEqual(
      commands.map((entry) => entry.id),
      ["cmd-1"],
    );
  });

  it("ne rend rien pour une tache entierement humaine", () => {
    // Zero commande veut dire zero appel au runner : pas de lot artificiel.
    assert.deepEqual(autonomousCommandsFor({ criteria: [humanCriterion()], commands: [] }), []);
  });
});

// --- Resultat par critere ----------------------------------------------------

describe("deriveCriterionResult", () => {
  const passed = { commandId: "cmd-1", status: AUTONOMOUS_VALIDATION_STATUS.PASSED } as const;
  const failed = { commandId: "cmd-1", status: AUTONOMOUS_VALIDATION_STATUS.FAILED } as const;

  it("conclut a une reussite quand toutes les preuves passent", () => {
    const result = deriveCriterionResult(criterion({ commandIds: ["cmd-1", "cmd-2"] }), [
      passed,
      { commandId: "cmd-2", status: AUTONOMOUS_VALIDATION_STATUS.PASSED },
    ]);
    assert.equal(result, CRITERION_VERIFICATION_RESULT.PASSED);
  });

  it("conclut a un echec des qu'une preuve echoue", () => {
    const result = deriveCriterionResult(criterion({ commandIds: ["cmd-1", "cmd-2"] }), [
      failed,
      { commandId: "cmd-2", status: AUTONOMOUS_VALIDATION_STATUS.PASSED },
    ]);
    assert.equal(result, CRITERION_VERIFICATION_RESULT.FAILED);
  });

  it("traite un depassement de delai comme un echec", () => {
    assert.equal(isValidationFailure(AUTONOMOUS_VALIDATION_STATUS.TIMED_OUT), true);
    const result = deriveCriterionResult(criterion(), [
      { commandId: "cmd-1", status: AUTONOMOUS_VALIDATION_STATUS.TIMED_OUT },
    ]);
    assert.equal(result, CRITERION_VERIFICATION_RESULT.FAILED);
  });

  it("distingue une panne d'un echec", () => {
    // « Je n'ai pas pu regarder » n'est pas « j'ai regarde et c'est faux ».
    const result = deriveCriterionResult(criterion(), [
      { commandId: "cmd-1", status: AUTONOMOUS_VALIDATION_STATUS.ERROR },
    ]);
    assert.equal(result, CRITERION_VERIFICATION_RESULT.NOT_VERIFIED);
  });

  it("fait primer l'echec sur la panne", () => {
    const result = deriveCriterionResult(criterion({ commandIds: ["cmd-1", "cmd-2"] }), [
      failed,
      { commandId: "cmd-2", status: AUTONOMOUS_VALIDATION_STATUS.ERROR },
    ]);
    assert.equal(result, CRITERION_VERIFICATION_RESULT.FAILED);
  });

  it("ne conclut rien sans resultat", () => {
    assert.equal(deriveCriterionResult(criterion(), []), CRITERION_VERIFICATION_RESULT.NOT_VERIFIED);
  });

  it("laisse un critere humain a l'humain", () => {
    assert.equal(
      deriveCriterionResult(humanCriterion(), [passed]),
      CRITERION_VERIFICATION_RESULT.HUMAN,
    );
  });

  it("refuse de conclure sur un critere automatise sans lien", () => {
    // Un plan valide l'interdit. Si on y arrive quand meme, l'absence de preuve
    // est la seule reponse honnete — surtout pas une reussite.
    assert.equal(
      deriveCriterionResult(criterion({ commandIds: [] }), [passed]),
      CRITERION_VERIFICATION_RESULT.NOT_VERIFIED,
    );
  });
});

// --- Issue de la tache -------------------------------------------------------

describe("deriveTaskVerificationOutcome", () => {
  const results = (...values: string[]) =>
    values.map((result) => ({
      criterion: criterion(),
      result: result as (typeof CRITERION_VERIFICATION_RESULT)[keyof typeof CRITERION_VERIFICATION_RESULT],
    }));

  it("conclut a une reussite quand tout est automatise et prouve", () => {
    assert.equal(
      deriveTaskVerificationOutcome(results("PASSED", "PASSED")),
      TASK_VERIFICATION_OUTCOME.AUTO_PASSED,
    );
  });

  it("fait primer un echec sur une attente humaine", () => {
    // Corriger le build passe avant : afficher « en attente de relecture »
    // ferait perdre du temps.
    assert.equal(
      deriveTaskVerificationOutcome(results("FAILED", "HUMAN")),
      TASK_VERIFICATION_OUTCOME.AUTO_FAILED,
    );
  });

  it("fait primer une panne sur une attente humaine", () => {
    assert.equal(
      deriveTaskVerificationOutcome(results("NOT_VERIFIED", "HUMAN")),
      TASK_VERIFICATION_OUTCOME.AUTO_ERROR,
    );
  });

  it("fait primer un echec sur une panne", () => {
    assert.equal(
      deriveTaskVerificationOutcome(results("NOT_VERIFIED", "FAILED")),
      TASK_VERIFICATION_OUTCOME.AUTO_FAILED,
    );
  });

  it("demande un humain des qu'un critere le demande", () => {
    assert.equal(
      deriveTaskVerificationOutcome(results("PASSED", "HUMAN")),
      TASK_VERIFICATION_OUTCOME.HUMAN_REQUIRED,
    );
  });

  it("ne conclut jamais a une reussite faute de criteres", () => {
    // Rien a verifier n'est pas une preuve.
    assert.equal(deriveTaskVerificationOutcome([]), TASK_VERIFICATION_OUTCOME.HUMAN_REQUIRED);
  });

  it("suit l'ordre de la tache", () => {
    const views = deriveCriterionResults(
      {
        commands: [command()],
        criteria: [
          criterion({ id: "b", position: 1 }),
          criterion({ id: "a", position: 0 }),
        ],
      },
      [{ commandId: "cmd-1", status: AUTONOMOUS_VALIDATION_STATUS.PASSED }],
    );
    assert.deepEqual(
      views.map((view) => view.criterion.id),
      ["a", "b"],
    );
  });
});

// --- Auto-completion ---------------------------------------------------------

describe("checkAutoCompletion", () => {
  function facts(overrides: Partial<AutoCompletionFacts> = {}): AutoCompletionFacts {
    return {
      taskKind: TASK_KIND.NORMAL,
      taskStatus: TASK_STATUS.REVIEW,
      runStatus: RUN_STATUS.COMPLETED,
      planValid: true,
      outcome: TASK_VERIFICATION_OUTCOME.AUTO_PASSED,
      batchStatus: VALIDATION_BATCH_STATUS.PASSED,
      trackedFilesMutated: false,
      ...overrides,
    };
  }

  it("autorise une tache entierement automatisee et entierement prouvee", () => {
    assert.equal(checkAutoCompletion(facts()).eligible, true);
  });

  it("refuse toujours un amorcage", () => {
    // Verifie en premier : aucune suite de conditions ne doit pouvoir l'y amener.
    const decision = checkAutoCompletion(facts({ taskKind: TASK_KIND.BOOTSTRAP }));
    assert.equal(decision.eligible, false);
    assert.equal(decision.eligible === false && decision.code, AUTO_COMPLETION_REFUSAL.BOOTSTRAP);
  });

  it("refuse un amorcage meme entierement prouve", () => {
    const decision = checkAutoCompletion(
      facts({ taskKind: TASK_KIND.BOOTSTRAP, outcome: TASK_VERIFICATION_OUTCOME.AUTO_PASSED }),
    );
    assert.equal(decision.eligible, false);
  });

  it("refuse quand un critere humain existe", () => {
    const decision = checkAutoCompletion(
      facts({ outcome: TASK_VERIFICATION_OUTCOME.HUMAN_REQUIRED }),
    );
    assert.equal(
      decision.eligible === false && decision.code,
      AUTO_COMPLETION_REFUSAL.HUMAN_REQUIRED,
    );
  });

  it("refuse quand une preuve a echoue", () => {
    const decision = checkAutoCompletion(
      facts({ outcome: TASK_VERIFICATION_OUTCOME.AUTO_FAILED, batchStatus: VALIDATION_BATCH_STATUS.FAILED }),
    );
    assert.equal(
      decision.eligible === false && decision.code,
      AUTO_COMPLETION_REFUSAL.VALIDATION_FAILED,
    );
  });

  it("refuse quand une preuve manque", () => {
    const decision = checkAutoCompletion(
      facts({ outcome: TASK_VERIFICATION_OUTCOME.AUTO_ERROR, batchStatus: VALIDATION_BATCH_STATUS.ERROR }),
    );
    assert.equal(
      decision.eligible === false && decision.code,
      AUTO_COMPLETION_REFUSAL.VALIDATION_INCOMPLETE,
    );
  });

  it("refuse tant que le lot n'est pas termine", () => {
    for (const batchStatus of [VALIDATION_BATCH_STATUS.PENDING, VALIDATION_BATCH_STATUS.RUNNING]) {
      const decision = checkAutoCompletion(facts({ batchStatus }));
      assert.equal(
        decision.eligible === false && decision.code,
        AUTO_COMPLETION_REFUSAL.BATCH_NOT_FINAL,
      );
    }
  });

  it("refuse en l'absence de tout lot", () => {
    const decision = checkAutoCompletion(facts({ batchStatus: null }));
    assert.equal(
      decision.eligible === false && decision.code,
      AUTO_COMPLETION_REFUSAL.BATCH_NOT_FINAL,
    );
  });

  it("refuse quand la validation a modifie des fichiers suivis", () => {
    // La preuve a change le travail qu'elle evaluait : ce qui a ete valide n'est
    // plus tout a fait ce qui sera livre.
    const decision = checkAutoCompletion(facts({ trackedFilesMutated: true }));
    assert.equal(
      decision.eligible === false && decision.code,
      AUTO_COMPLETION_REFUSAL.REPOSITORY_MUTATED,
    );
  });

  it("refuse si l'execution ne s'est pas terminee normalement", () => {
    for (const runStatus of [RUN_STATUS.FAILED, RUN_STATUS.CANCELLED, RUN_STATUS.BLOCKED]) {
      assert.equal(checkAutoCompletion(facts({ runStatus })).eligible, false);
    }
  });

  it("refuse si la tache a quitte la review entre-temps", () => {
    // Un humain a decide pendant que le lot tournait : sa decision gagne.
    const decision = checkAutoCompletion(facts({ taskStatus: TASK_STATUS.COMPLETED }));
    assert.equal(
      decision.eligible === false && decision.code,
      AUTO_COMPLETION_REFUSAL.TASK_NOT_IN_REVIEW,
    );
  });

  it("refuse si le plan n'etait pas valide", () => {
    const decision = checkAutoCompletion(facts({ planValid: false }));
    assert.equal(decision.eligible === false && decision.code, AUTO_COMPLETION_REFUSAL.PLAN_INVALID);
  });
});

// --- Annonce avant execution -------------------------------------------------

describe("planAllowsAutoCompletion", () => {
  it("annonce une tache entierement automatisee", () => {
    assert.equal(planAllowsAutoCompletion(plan(), TASK_KIND.NORMAL), true);
  });

  it("ne l'annonce jamais pour un amorcage", () => {
    assert.equal(planAllowsAutoCompletion(plan(), TASK_KIND.BOOTSTRAP), false);
  });

  it("ne l'annonce pas des qu'un critere est humain", () => {
    assert.equal(
      planAllowsAutoCompletion(
        { criteria: [criterion(), humanCriterion()], commands: [command()] },
        TASK_KIND.NORMAL,
      ),
      false,
    );
  });

  it("ne l'annonce pas sans critere", () => {
    assert.equal(planAllowsAutoCompletion({ criteria: [], commands: [] }, TASK_KIND.NORMAL), false);
  });

  it("ne l'annonce pas sur un plan invalide", () => {
    assert.equal(
      planAllowsAutoCompletion(plan({ criteria: [criterion({ commandIds: [] })] }), TASK_KIND.NORMAL),
      false,
    );
  });
});

describe("lecture du plan", () => {
  it("reconnait un plan qui demande un humain", () => {
    assert.equal(planRequiresHuman(plan()), false);
    assert.equal(planRequiresHuman({ criteria: [humanCriterion()], commands: [] }), true);
  });

  it("rend les criteres humains dans l'ordre", () => {
    const criteria = humanCriteriaOf({
      commands: [],
      criteria: [
        humanCriterion({ id: "b", position: 1 }),
        criterion({ id: "auto", position: 2 }),
        humanCriterion({ id: "a", position: 0 }),
      ],
    });
    assert.deepEqual(
      criteria.map((entry) => entry.id),
      ["a", "b"],
    );
  });
});
