/**
 * Tests du contrat de l'etat structure.
 *
 * Ce fichier garde deux promesses. La premiere : une valeur logique identique
 * produit toujours la meme forme normalisee, donc la meme revision — sans quoi
 * une reecriture a l'identique se signalerait comme un changement de contexte.
 * La seconde : les bornes sont refusees a l'ecriture, jamais rattrapees par une
 * troncature.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PROJECT_PLAN_LIMITS,
  checkProjectBriefInput,
  checkProjectV1PlanInput,
  isProjectBriefEmpty,
  isProjectV1PlanEmpty,
  normalizeProjectPlanList,
  normalizeProjectPlanText,
  projectBriefChars,
  projectV1PlanChars,
  type ProjectBriefInput,
  type ProjectV1PlanInput,
} from "../dist/index.js";

const BRIEF: ProjectBriefInput = {
  summary: "Un suivi de lectures personnel.",
  problem: "Rien ne centralise ce que je lis.",
  targetUsers: "Moi seul.",
  desiredOutcome: "Savoir ce que j'ai lu cette annee.",
  goals: ["Enregistrer un livre", "Retrouver une lecture"],
  nonGoals: ["Reseau social"],
};

const PLAN: ProjectV1PlanInput = {
  goal: "Suivre une annee de lectures.",
  inScope: ["Liste des livres", "Ajout manuel"],
  outOfScope: ["Application mobile"],
  technicalDirection: "Application web simple, stockage local.",
  milestones: ["La liste est utilisable", "Un livre s'ajoute en trois clics"],
};

function brief(overrides: Partial<ProjectBriefInput> = {}): ProjectBriefInput {
  return { ...BRIEF, ...overrides };
}

function plan(overrides: Partial<ProjectV1PlanInput> = {}): ProjectV1PlanInput {
  return { ...PLAN, ...overrides };
}

describe("normalisation", () => {
  it("ramene les fins de ligne et retire les marges", () => {
    assert.equal(normalizeProjectPlanText("  Un texte.\r\nSuite.\r\n  "), "Un texte.\nSuite.");
  });

  it("traite une chaine d'espaces comme une chaine vide", () => {
    // Un champ rempli de blancs et un champ vide sont la meme chose. Les
    // distinguer produirait deux revisions pour un seul contenu.
    assert.equal(normalizeProjectPlanText("   \n  "), "");
  });

  it("retire les elements vides d'une liste", () => {
    // Une ligne vide dans un formulaire est une ligne qu'on n'a pas remplie.
    assert.deepEqual(normalizeProjectPlanList(["A", "  ", "", "B"]), ["A", "B"]);
  });

  it("conserve l'ordre des elements", () => {
    assert.deepEqual(normalizeProjectPlanList(["B", "A"]), ["B", "A"]);
  });

  it("s'applique de la meme facon au brief et au plan", () => {
    const checkedBrief = checkProjectBriefInput(brief({ summary: "  Espaces.  " }));
    const checkedPlan = checkProjectV1PlanInput(plan({ goal: "  Espaces.  " }));

    assert.ok(checkedBrief.ok && checkedPlan.ok);
    assert.equal(checkedBrief.values.summary, "Espaces.");
    assert.equal(checkedPlan.values.goal, "Espaces.");
  });
});

describe("etat vide", () => {
  it("accepte un brief entierement vide", () => {
    const checked = checkProjectBriefInput({
      summary: "",
      problem: "",
      targetUsers: "",
      desiredOutcome: "",
      goals: [],
      nonGoals: [],
    });
    assert.ok(checked.ok);
    assert.equal(isProjectBriefEmpty(checked.values), true);
  });

  it("accepte un plan entierement vide", () => {
    const checked = checkProjectV1PlanInput({
      goal: "",
      inScope: [],
      outOfScope: [],
      technicalDirection: "",
      milestones: [],
    });
    assert.ok(checked.ok);
    assert.equal(isProjectV1PlanEmpty(checked.values), true);
  });

  it("ne confond pas vide et rempli", () => {
    const checked = checkProjectBriefInput(brief());
    assert.ok(checked.ok);
    assert.equal(isProjectBriefEmpty(checked.values), false);
  });
});

describe("bornes du brief", () => {
  it("refuse un resume trop long", () => {
    const checked = checkProjectBriefInput(
      brief({ summary: "a".repeat(PROJECT_PLAN_LIMITS.summary + 1) }),
    );
    assert.equal(checked.ok, false);
    assert.deepEqual(checked.ok ? null : checked.refusal, {
      field: "summary",
      reason: "too_long",
    });
  });

  it("accepte un resume exactement a la borne", () => {
    const checked = checkProjectBriefInput(
      brief({ summary: "a".repeat(PROJECT_PLAN_LIMITS.summary) }),
    );
    assert.equal(checked.ok, true);
  });

  it("refuse trop d'objectifs", () => {
    const goals = Array.from({ length: PROJECT_PLAN_LIMITS.items + 1 }, (_, index) =>
      `Objectif ${String(index)}`,
    );
    const checked = checkProjectBriefInput(brief({ goals }));
    assert.deepEqual(checked.ok ? null : checked.refusal, { field: "goals", reason: "too_many" });
  });

  it("refuse un objectif trop long", () => {
    const checked = checkProjectBriefInput(
      brief({ goals: ["a".repeat(PROJECT_PLAN_LIMITS.item + 1)] }),
    );
    assert.deepEqual(checked.ok ? null : checked.refusal, {
      field: "goals",
      reason: "item_too_long",
    });
  });

  it("refuse un caractere de controle", () => {
    const checked = checkProjectBriefInput(brief({ problem: `Avant${String.fromCharCode(7)}apres` }));
    assert.deepEqual(checked.ok ? null : checked.refusal, {
      field: "problem",
      reason: "control_character",
    });
  });

  it("conserve tabulations et sauts de ligne", () => {
    const checked = checkProjectBriefInput(brief({ problem: "Ligne un.\n\tLigne deux." }));
    assert.ok(checked.ok);
    assert.equal(checked.values.problem, "Ligne un.\n\tLigne deux.");
  });
});

describe("bornes du plan", () => {
  it("refuse une direction technique trop longue", () => {
    const checked = checkProjectV1PlanInput(
      plan({ technicalDirection: "a".repeat(PROJECT_PLAN_LIMITS.technicalDirection + 1) }),
    );
    assert.deepEqual(checked.ok ? null : checked.refusal, {
      field: "technicalDirection",
      reason: "too_long",
    });
  });

  it("refuse trop d'etapes", () => {
    const milestones = Array.from({ length: PROJECT_PLAN_LIMITS.items + 1 }, (_, index) =>
      `Etape ${String(index)}`,
    );
    assert.deepEqual(checkProjectV1PlanInput(plan({ milestones })).ok, false);
  });

  it("refuse un element de perimetre trop long", () => {
    const checked = checkProjectV1PlanInput(
      plan({ inScope: ["a".repeat(PROJECT_PLAN_LIMITS.item + 1)] }),
    );
    assert.deepEqual(checked.ok ? null : checked.refusal, {
      field: "inScope",
      reason: "item_too_long",
    });
  });
});

describe("Unicode", () => {
  it("mesure les caracteres, accents et emoji compris", () => {
    const checked = checkProjectBriefInput(brief({ summary: "Idée 🎉 japonais 日本語" }));
    assert.ok(checked.ok);
    assert.equal(checked.values.summary, "Idée 🎉 japonais 日本語");
  });

  it("ne casse pas une liste contenant de l'Unicode", () => {
    const checked = checkProjectV1PlanInput(plan({ milestones: ["Étape « une »", "日本語の段階"] }));
    assert.ok(checked.ok);
    assert.deepEqual(checked.values.milestones, ["Étape « une »", "日本語の段階"]);
  });
});

describe("mesure du cout", () => {
  it("compte tous les champs du brief", () => {
    const expected =
      BRIEF.summary.length +
      BRIEF.problem.length +
      BRIEF.targetUsers.length +
      BRIEF.desiredOutcome.length +
      BRIEF.goals.join("").length +
      BRIEF.nonGoals.join("").length;
    assert.equal(projectBriefChars(BRIEF), expected);
  });

  it("compte tous les champs du plan", () => {
    const expected =
      PLAN.goal.length +
      PLAN.technicalDirection.length +
      PLAN.inScope.join("").length +
      PLAN.outOfScope.join("").length +
      PLAN.milestones.join("").length;
    assert.equal(projectV1PlanChars(PLAN), expected);
  });

  it("compte zero pour un objet vide", () => {
    assert.equal(
      projectBriefChars({
        summary: "",
        problem: "",
        targetUsers: "",
        desiredOutcome: "",
        goals: [],
        nonGoals: [],
      }),
      0,
    );
  });
});

describe("le budget est commun", () => {
  it("un brief et un plan valides isolement peuvent depasser ensemble", () => {
    // La demonstration du budget partage, en une assertion : chacun tient dans
    // seize Kio, leur somme non. C'est pour cela que la mesure est faite sur les
    // deux a la fois, a l'ecriture.
    const large = "a".repeat(PROJECT_PLAN_LIMITS.summary);
    const heavyBrief = brief({
      summary: large,
      problem: "b".repeat(PROJECT_PLAN_LIMITS.problem),
      targetUsers: "c".repeat(PROJECT_PLAN_LIMITS.targetUsers),
      desiredOutcome: "d".repeat(PROJECT_PLAN_LIMITS.desiredOutcome),
      // Douze objectifs pleins amenent le brief exactement a la borne.
      goals: Array.from({ length: 12 }, () => "g".repeat(PROJECT_PLAN_LIMITS.item)),
      nonGoals: [],
    });
    const heavyPlan = plan({
      goal: "e".repeat(PROJECT_PLAN_LIMITS.goal),
      technicalDirection: "f".repeat(PROJECT_PLAN_LIMITS.technicalDirection),
      inScope: [],
      outOfScope: [],
      milestones: Array.from({ length: PROJECT_PLAN_LIMITS.items }, () =>
        "m".repeat(PROJECT_PLAN_LIMITS.item),
      ),
    });

    assert.ok(checkProjectBriefInput(heavyBrief).ok, "le brief passe la validation de champ");
    assert.ok(checkProjectV1PlanInput(heavyPlan).ok, "le plan aussi");
    assert.ok(projectBriefChars(heavyBrief) <= PROJECT_PLAN_LIMITS.structuredChars);
    assert.ok(projectV1PlanChars(heavyPlan) <= PROJECT_PLAN_LIMITS.structuredChars);
    assert.ok(
      projectBriefChars(heavyBrief) + projectV1PlanChars(heavyPlan) >
        PROJECT_PLAN_LIMITS.structuredChars,
      "mais leur somme depasse le budget commun",
    );
  });

  it("le budget structure tient dans le contexte global", () => {
    // 16 (etat structure) + 64 (conventions) + 48 (memoire) = 128 Kio.
    // Les trois categories qui ne doivent jamais etre tronquees tiennent
    // exactement dans le budget global du contexte.
    assert.equal(PROJECT_PLAN_LIMITS.structuredChars, 16 * 1024);
    assert.equal(PROJECT_PLAN_LIMITS.structuredChars + 64 * 1024 + 48 * 1024, 128 * 1024);
  });
});
