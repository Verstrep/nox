/**
 * Tests de l'affichage de l'etat structure.
 *
 * Deux promesses tenues ici.
 *
 * La premiere : la distinction **absent / defini mais vide / defini** survit
 * jusqu'a l'ecran. Un objet cree puis vide ne doit pas s'annoncer « Not
 * defined » — le prochain enregistrement se croirait alors une creation, et
 * serait refuse comme perime sans que personne comprenne pourquoi.
 *
 * La seconde : un refus dit **quoi faire**. Un budget depasse se resout en
 * raccourcissant, une revision perimee en rechargeant ; les confondre sous un
 * message unique laisserait l'utilisateur sans geste a poser.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROJECT_PLAN_LIMITS } from "@nox/shared";

import {
  briefSectionState,
  countPlanChanges,
  editBriefUrl,
  editPlanUrl,
  formatPlanSize,
  planChangeCountLabel,
  planFieldLabel,
  planRefusalMessage,
  planSectionState,
  planSectionStateLabel,
  planUrl,
  planWriteRefusalMessage,
  projectUpdateUrl,
  readPlanList,
  writePlanList,
} from "./plan-display.ts";

const BRIEF = {
  summary: "Un suivi de lectures.",
  problem: "Rien ne centralise mes lectures.",
  targetUsers: "Moi seul.",
  desiredOutcome: "Savoir ce que j'ai lu.",
  goals: ["Enregistrer un livre"],
  nonGoals: [] as string[],
};

const EMPTY_BRIEF = {
  summary: "",
  problem: "",
  targetUsers: "",
  desiredOutcome: "",
  goals: [] as string[],
  nonGoals: [] as string[],
};

const PLAN = {
  goal: "Suivre une annee.",
  inScope: ["Liste"],
  outOfScope: [] as string[],
  technicalDirection: "Web simple.",
  milestones: ["Liste utilisable"],
};

const EMPTY_PLAN = {
  goal: "",
  inScope: [] as string[],
  outOfScope: [] as string[],
  technicalDirection: "",
  milestones: [] as string[],
};

describe("URL", () => {
  it("appartiennent toutes au projet", () => {
    assert.equal(planUrl("p1"), "/projects/p1/plan");
    assert.equal(editBriefUrl("p1"), "/projects/p1/plan/brief");
    assert.equal(editPlanUrl("p1"), "/projects/p1/plan/v1");
    assert.equal(projectUpdateUrl("p1", "u1"), "/projects/p1/architect/project-updates/u1");
  });

  it("ne melangent jamais deux projets", () => {
    // La route porte le projet : une proposition d'un autre projet ne peut pas
    // etre atteinte par une URL construite ici.
    assert.notEqual(projectUpdateUrl("A", "u1"), projectUpdateUrl("B", "u1"));
  });
});

describe("listes saisies ligne a ligne", () => {
  it("decoupe sur les sauts de ligne", () => {
    assert.deepEqual(readPlanList("Un\nDeux\nTrois"), ["Un", "Deux", "Trois"]);
  });

  it("ignore les lignes vides et les marges", () => {
    // Une ligne qu'on n'a pas remplie n'est pas un element vide.
    assert.deepEqual(readPlanList("  Un  \n\n   \nDeux\n"), ["Un", "Deux"]);
  });

  it("accepte les fins de ligne Windows", () => {
    assert.deepEqual(readPlanList("Un\r\nDeux"), ["Un", "Deux"]);
  });

  it("rend une liste vide pour un champ vide", () => {
    assert.deepEqual(readPlanList(""), []);
    assert.deepEqual(readPlanList("   \n  "), []);
  });

  it("conserve l'ordre", () => {
    assert.deepEqual(readPlanList("B\nA"), ["B", "A"]);
  });

  it("fait l'aller-retour sans rien perdre", () => {
    const values = ["Premier", "Deuxieme", "Troisieme"];
    assert.deepEqual(readPlanList(writePlanList(values)), values);
  });
});

describe("etat d'une section", () => {
  it("distingue absent de defini mais vide", () => {
    // La distinction la plus importante de cette page : les confondre ferait
    // afficher « Not defined » sur un objet qui existe.
    assert.equal(briefSectionState(false, null), "absent");
    assert.equal(briefSectionState(true, EMPTY_BRIEF), "empty");
    assert.equal(briefSectionState(true, BRIEF), "defined");
  });

  it("applique la meme regle au plan", () => {
    assert.equal(planSectionState(false, null), "absent");
    assert.equal(planSectionState(true, EMPTY_PLAN), "empty");
    assert.equal(planSectionState(true, PLAN), "defined");
  });

  it("considere un seul champ rempli comme defini", () => {
    assert.equal(briefSectionState(true, { ...EMPTY_BRIEF, summary: "Une phrase." }), "defined");
    assert.equal(planSectionState(true, { ...EMPTY_PLAN, milestones: ["Une etape"] }), "defined");
  });

  it("porte trois libelles distincts", () => {
    const labels = (["absent", "empty", "defined"] as const).map(planSectionStateLabel);
    assert.equal(new Set(labels).size, 3, "trois etats, trois libelles");
    assert.equal(planSectionStateLabel("absent"), "Not defined");
    assert.equal(planSectionStateLabel("defined"), "Defined");
  });
});

describe("messages de refus", () => {
  it("nomme le champ concerne", () => {
    const message = planRefusalMessage({ field: "summary", reason: "too_long" });
    assert.ok(message.includes("Resume"));
  });

  it("dit combien d'elements une liste accepte", () => {
    const message = planRefusalMessage({ field: "milestones", reason: "too_many" });
    assert.ok(message.includes(String(PROJECT_PLAN_LIMITS.items)));
  });

  it("explique que le budget est commun", () => {
    const message = planWriteRefusalMessage({
      reason: "budget",
      used: 20 * 1024,
      limit: PROJECT_PLAN_LIMITS.structuredChars,
    });
    assert.ok(message.includes("Living V1 Plan"), "les deux objets sont nommes");
    assert.ok(message.includes("un seul budget"), "et le budget est dit commun");
    assert.ok(message.includes("raccourcissez") || message.includes("Raccourcissez"));
  });

  it("dit de recharger devant une revision perimee", () => {
    const message = planWriteRefusalMessage({ reason: "stale", currentRevision: "abc" });
    assert.ok(message.includes("Rechargez"));
    assert.equal(message.includes("abc"), false, "la revision brute n'est pas affichee");
  });

  it("ne rend jamais la meme phrase pour deux refus differents", () => {
    const messages = [
      planWriteRefusalMessage({ reason: "not_found" }),
      planWriteRefusalMessage({ reason: "invalid", field: "goal" }),
      planWriteRefusalMessage({ reason: "budget", used: 1, limit: 2 }),
      planWriteRefusalMessage({ reason: "stale", currentRevision: null }),
    ];
    assert.equal(new Set(messages).size, 4);
  });

  it("traduit chaque champ borne", () => {
    for (const field of [
      "summary",
      "problem",
      "targetUsers",
      "desiredOutcome",
      "goals",
      "nonGoals",
      "goal",
      "inScope",
      "outOfScope",
      "technicalDirection",
      "milestones",
    ]) {
      assert.notEqual(planFieldLabel(field), field, field);
    }
  });
});

describe("tailles et compteurs", () => {
  it("compte en caracteres sous un Kio", () => {
    assert.equal(formatPlanSize(512), "512 caracteres");
  });

  it("compte en Kio au-dela", () => {
    assert.equal(formatPlanSize(2048), "2.0 Kio");
  });

  it("compte les champs modifies", () => {
    assert.equal(
      countPlanChanges([{ changed: true }, { changed: false }, { changed: true }]),
      2,
    );
  });

  it("accorde le libelle des changements", () => {
    assert.equal(planChangeCountLabel(0), "No proposed change");
    assert.equal(planChangeCountLabel(1), "1 change");
    assert.equal(planChangeCountLabel(3), "3 changes");
  });
});
