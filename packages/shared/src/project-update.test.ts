/**
 * Contrat d'une mise a jour de projet proposee par l'Architecte.
 *
 * Ce fichier garde trois promesses.
 *
 * La premiere : `state` et `projectUpdate` sont **independants**. Les quatre
 * combinaisons sont exercees, parce qu'une independance qu'on affirme sans la
 * verifier finit toujours par devenir une dependance accidentelle.
 *
 * La deuxieme : le Structured Output ne dispense d'aucune validation. Une
 * reponse conforme au schema et incoherente — `SET` sans valeur, `UNCHANGED`
 * avec — est refusee.
 *
 * La troisieme : la version 2 continue de se lire. Une session de conception de
 * tache n'a jamais parle de mise a jour de projet, et ne doit pas commencer.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARCHITECT_TURN_SCHEMA_VERSION,
  ARCHITECT_TURN_SCHEMA_VERSION_V3,
  ARCHITECT_SESSION_KIND,
  PROJECT_PLAN_LIMITS,
  PROJECT_UPDATE_ACTION,
  PROJECT_UPDATE_REASON_LIMIT,
  architectTurnSchemaVersion,
  buildArchitectProjectUpdateReview,
  buildArchitectTurnSchema,
  projectUpdateTarget,
  projectUpdateTouchesSomething,
  readArchitectProjectUpdate,
  readArchitectTurn,
  type ArchitectProjectUpdateProposal,
  type ProjectBriefInput,
  type ProjectV1PlanInput,
} from "../dist/index.js";

const DOCUMENTS = ["docs/ARCHITECTURE.md"];

const BRIEF: ProjectBriefInput = {
  summary: "Un suivi de lectures personnel.",
  problem: "Rien ne centralise ce que je lis.",
  targetUsers: "Moi seul.",
  desiredOutcome: "Savoir ce que j'ai lu cette annee.",
  goals: ["Enregistrer un livre"],
  nonGoals: ["Reseau social"],
};

const PLAN: ProjectV1PlanInput = {
  goal: "Suivre une annee de lectures.",
  inScope: ["Liste des livres"],
  outOfScope: ["Application mobile"],
  technicalDirection: "Application web simple.",
  milestones: ["La liste est utilisable"],
};

function section<TValue>(value: TValue | null): Record<string, unknown> {
  return value === null
    ? { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null }
    : { action: PROJECT_UPDATE_ACTION.SET, value };
}

function update(
  overrides: { reason?: string; brief?: ProjectBriefInput | null; plan?: ProjectV1PlanInput | null } = {},
): Record<string, unknown> {
  return {
    reason: overrides.reason ?? "L'utilisateur a decrit son produit.",
    brief: section(overrides.brief === undefined ? BRIEF : overrides.brief),
    plan: section(overrides.plan === undefined ? null : overrides.plan),
  };
}

const TASK_PROPOSAL = {
  title: "Exporter les livres",
  priority: "MEDIUM",
  objective: "Sortir la liste en JSON.",
  context: null,
  acceptanceCriteria: ["Un fichier JSON est produit."],
  outOfScope: [],
  documentReferences: ["docs/ARCHITECTURE.md"],
  validationCommands: ["npm run test"],
  assumptions: [],
};

function turn(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: ARCHITECT_TURN_SCHEMA_VERSION_V3,
    state: "CONTINUE",
    message: "Voici ce que je comprends.",
    questions: [],
    proposal: null,
    projectUpdate: null,
    ...overrides,
  };
}

describe("version de contrat selon le role de la session", () => {
  it("une conversation projet parle la version 3", () => {
    assert.equal(
      architectTurnSchemaVersion(ARCHITECT_SESSION_KIND.PROJECT),
      ARCHITECT_TURN_SCHEMA_VERSION_V3,
    );
  });

  it("une session de conception de tache reste en version 2", () => {
    // Son comportement est fige : changer sa version modifierait retroactivement
    // ce que ses generations passees signifiaient.
    assert.equal(
      architectTurnSchemaVersion(ARCHITECT_SESSION_KIND.TASK_DESIGN_LEGACY),
      ARCHITECT_TURN_SCHEMA_VERSION,
    );
  });
});

describe("les quatre combinaisons de state et projectUpdate", () => {
  it("A — CONTINUE, aucune tache, aucune mise a jour", () => {
    const read = readArchitectTurn(turn(), DOCUMENTS, ARCHITECT_TURN_SCHEMA_VERSION_V3);
    assert.ok(read.ok);
    assert.equal(read.turn.state, "CONTINUE");
    assert.equal(read.turn.proposal, null);
    assert.equal(read.turn.projectUpdate, null);
  });

  it("B — CONTINUE, aucune tache, une mise a jour", () => {
    // C'est le cas le plus courant au debut d'un projet : l'utilisateur colle une
    // description, l'architecte pose le brief, et aucune tache n'est encore utile.
    const read = readArchitectTurn(
      turn({ projectUpdate: update() }),
      DOCUMENTS,
      ARCHITECT_TURN_SCHEMA_VERSION_V3,
    );
    assert.ok(read.ok);
    assert.equal(read.turn.state, "CONTINUE");
    assert.equal(read.turn.proposal, null);
    assert.equal(read.turn.projectUpdate?.brief.action, PROJECT_UPDATE_ACTION.SET);
  });

  it("C — PROPOSAL_READY, une tache, aucune mise a jour", () => {
    const read = readArchitectTurn(
      turn({ state: "PROPOSAL_READY", proposal: TASK_PROPOSAL }),
      DOCUMENTS,
      ARCHITECT_TURN_SCHEMA_VERSION_V3,
    );
    assert.ok(read.ok);
    assert.equal(read.turn.proposal?.title, "Exporter les livres");
    assert.equal(read.turn.projectUpdate, null);
  });

  it("D — PROPOSAL_READY, une tache, une mise a jour", () => {
    const read = readArchitectTurn(
      turn({
        state: "PROPOSAL_READY",
        proposal: TASK_PROPOSAL,
        projectUpdate: update({ plan: PLAN }),
      }),
      DOCUMENTS,
      ARCHITECT_TURN_SCHEMA_VERSION_V3,
    );
    assert.ok(read.ok);
    assert.equal(read.turn.proposal?.title, "Exporter les livres");
    assert.equal(read.turn.projectUpdate?.plan.action, PROJECT_UPDATE_ACTION.SET);
    assert.equal(read.turn.projectUpdate?.brief.action, PROJECT_UPDATE_ACTION.SET);
  });

  it("une mise a jour ne rend jamais une proposition obligatoire", () => {
    // La garantie inverse de la precedente : proposer un brief ne fait pas
    // basculer l'etat du tour.
    const read = readArchitectTurn(
      turn({ projectUpdate: update() }),
      DOCUMENTS,
      ARCHITECT_TURN_SCHEMA_VERSION_V3,
    );
    assert.ok(read.ok);
    assert.equal(read.turn.state, "CONTINUE");
  });
});

describe("compatibilite avec la version 2", () => {
  it("lit un tour de version 2 sans mise a jour", () => {
    const read = readArchitectTurn(
      { schemaVersion: 2, state: "CONTINUE", message: "Bonjour.", questions: [], proposal: null },
      DOCUMENTS,
    );
    assert.ok(read.ok);
    assert.equal(read.turn.schemaVersion, ARCHITECT_TURN_SCHEMA_VERSION);
    assert.equal(read.turn.projectUpdate, null);
  });

  it("ignore une mise a jour rendue dans un tour de version 2", () => {
    // Une session de conception de tache n'a jamais eu le droit d'en proposer.
    // La reponse n'est pas refusee — elle est simplement sans effet.
    const read = readArchitectTurn(
      {
        schemaVersion: 2,
        state: "CONTINUE",
        message: "Bonjour.",
        questions: [],
        proposal: null,
        projectUpdate: update(),
      },
      DOCUMENTS,
    );
    assert.ok(read.ok);
    assert.equal(read.turn.projectUpdate, null);
  });

  it("refuse un tour de version 2 la ou la version 3 est attendue", () => {
    const read = readArchitectTurn(
      { schemaVersion: 2, state: "CONTINUE", message: "Bonjour.", questions: [], proposal: null },
      DOCUMENTS,
      ARCHITECT_TURN_SCHEMA_VERSION_V3,
    );
    assert.equal(read.ok, false);
    assert.equal(read.ok ? null : read.refusal.field, "schemaVersion");
  });

  it("refuse un tour de version 3 la ou la version 2 est attendue", () => {
    const read = readArchitectTurn(turn(), DOCUMENTS);
    assert.equal(read.ok, false);
  });
});

describe("invariants d'une section", () => {
  it("refuse SET sans valeur", () => {
    const read = readArchitectProjectUpdate({
      reason: "Parce que.",
      brief: { action: "SET", value: null },
      plan: section(null),
    });
    assert.equal(read.ok, false);
    assert.equal(read.ok ? null : read.refusal.field, "brief");
  });

  it("refuse UNCHANGED porteur d'une valeur", () => {
    // Deux affirmations contradictoires dans un seul objet : la seule reponse
    // honnete est de ne pas trancher a la place du modele.
    const read = readArchitectProjectUpdate({
      reason: "Parce que.",
      brief: { action: "UNCHANGED", value: BRIEF },
      plan: section(null),
    });
    assert.equal(read.ok, false);
    assert.equal(read.ok ? null : read.refusal.field, "brief");
  });

  it("refuse une action inconnue", () => {
    const read = readArchitectProjectUpdate({
      reason: "Parce que.",
      brief: { action: "DELETE", value: null },
      plan: section(null),
    });
    assert.equal(read.ok, false);
  });

  it("refuse une mise a jour dont les deux sections sont inchangees", () => {
    const read = readArchitectProjectUpdate({
      reason: "Parce que.",
      brief: section(null),
      plan: section(null),
    });
    assert.equal(read.ok, false);
    assert.equal(read.ok ? null : read.refusal.field, "projectUpdate");
  });

  it("refuse une mise a jour sans justification", () => {
    const read = readArchitectProjectUpdate(update({ reason: "   " }));
    assert.equal(read.ok, false);
    assert.equal(read.ok ? null : read.refusal.field, "reason");
  });

  it("refuse une justification trop longue", () => {
    const read = readArchitectProjectUpdate(
      update({ reason: "a".repeat(PROJECT_UPDATE_REASON_LIMIT + 1) }),
    );
    assert.equal(read.ok, false);
  });

  it("accepte une section vide proposee explicitement", () => {
    // Vider une section est une proposition legitime — visible dans la revue.
    // Ce n'est pas la meme chose qu'une suppression, qui n'existe pas.
    const read = readArchitectProjectUpdate(
      update({
        brief: {
          summary: "",
          problem: "",
          targetUsers: "",
          desiredOutcome: "",
          goals: [],
          nonGoals: [],
        },
      }),
    );
    assert.ok(read.ok);
    assert.equal(read.proposal.brief.action, PROJECT_UPDATE_ACTION.SET);
    assert.equal(read.proposal.brief.value?.summary, "");
  });
});

describe("la validation de champ n'est pas assouplie", () => {
  it("refuse un resume trop long, comme le formulaire manuel", () => {
    const read = readArchitectProjectUpdate(
      update({ brief: { ...BRIEF, summary: "a".repeat(PROJECT_PLAN_LIMITS.summary + 1) } }),
    );
    assert.equal(read.ok, false);
    assert.equal(read.ok ? null : read.refusal.field, "brief.summary");
  });

  it("refuse trop d'etapes", () => {
    const read = readArchitectProjectUpdate(
      update({
        plan: {
          ...PLAN,
          milestones: Array.from({ length: PROJECT_PLAN_LIMITS.items + 1 }, (_, index) =>
            `Etape ${String(index)}`,
          ),
        },
      }),
    );
    assert.equal(read.ok, false);
    assert.equal(read.ok ? null : read.refusal.field, "plan.milestones");
  });

  it("normalise comme le formulaire manuel", () => {
    const read = readArchitectProjectUpdate(
      update({ brief: { ...BRIEF, summary: "  Un resume.\r\n  ", goals: ["A", "  ", ""] } }),
    );
    assert.ok(read.ok);
    assert.equal(read.proposal.brief.value?.summary, "Un resume.");
    assert.deepEqual(read.proposal.brief.value?.goals, ["A"]);
  });

  it("refuse un caractere de controle", () => {
    const read = readArchitectProjectUpdate(
      update({ brief: { ...BRIEF, problem: `Avant${String.fromCharCode(7)}apres` } }),
    );
    assert.equal(read.ok, false);
  });
});

describe("etat cible", () => {
  it("ne retient que les sections SET", () => {
    const read = readArchitectProjectUpdate(update({ brief: BRIEF, plan: null }));
    assert.ok(read.ok);
    const target = projectUpdateTarget(read.proposal);
    assert.deepEqual(target.brief, read.proposal.brief.value);
    assert.equal(target.plan, null, "une section inchangee n'a rien a ecrire");
  });

  it("reconnait une proposition qui change quelque chose", () => {
    const read = readArchitectProjectUpdate(update());
    assert.ok(read.ok);
    assert.equal(projectUpdateTouchesSomething(read.proposal), true);
  });
});

describe("schema strict transmis au fournisseur", () => {
  it("la version 2 ne declare aucune mise a jour de projet", () => {
    const schema = buildArchitectTurnSchema(ARCHITECT_TURN_SCHEMA_VERSION);
    const properties = schema["properties"] as Record<string, unknown>;
    assert.equal("projectUpdate" in properties, false);
    assert.equal((schema["required"] as string[]).includes("projectUpdate"), false);
  });

  it("la version 3 la declare, et la rend obligatoire", () => {
    // Le mode strict impose que tous les champs soient requis : un champ
    // facultatif s'exprime par une union avec null, jamais par son absence.
    const schema = buildArchitectTurnSchema(ARCHITECT_TURN_SCHEMA_VERSION_V3);
    const properties = schema["properties"] as Record<string, unknown>;
    assert.ok("projectUpdate" in properties);
    assert.ok((schema["required"] as string[]).includes("projectUpdate"));

    const update3 = properties["projectUpdate"] as Record<string, unknown>;
    assert.deepEqual(update3["type"], ["object", "null"]);
    assert.equal(update3["additionalProperties"], false);
    assert.deepEqual(update3["required"], ["reason", "brief", "plan"]);
  });

  it("chaque section declare action et value, toutes deux obligatoires", () => {
    const schema = buildArchitectTurnSchema(ARCHITECT_TURN_SCHEMA_VERSION_V3);
    const properties = schema["properties"] as Record<string, unknown>;
    const update3 = properties["projectUpdate"] as Record<string, unknown>;
    const sections = update3["properties"] as Record<string, Record<string, unknown>>;

    for (const name of ["brief", "plan"]) {
      const entry = sections[name];
      assert.ok(entry !== undefined, name);
      assert.deepEqual(entry["required"], ["action", "value"]);
      assert.equal(entry["additionalProperties"], false);

      const fields = entry["properties"] as Record<string, Record<string, unknown>>;
      assert.deepEqual(fields["action"]?.["enum"], [
        PROJECT_UPDATE_ACTION.UNCHANGED,
        PROJECT_UPDATE_ACTION.SET,
      ]);
      assert.deepEqual(fields["value"]?.["type"], ["object", "null"]);
    }
  });

  it("ne declare aucune borne de taille", () => {
    // Le sous-ensemble accepte en mode strict les ignore, et les declarer ferait
    // echouer la requete entiere. Les bornes vivent dans le prompt et dans la
    // validation NOX.
    const serialized = JSON.stringify(buildArchitectTurnSchema(ARCHITECT_TURN_SCHEMA_VERSION_V3));
    for (const forbidden of ["maxLength", "minLength", "maxItems", "minItems", "pattern"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });

  it("ne declare aucun outil", () => {
    const serialized = JSON.stringify(buildArchitectTurnSchema(ARCHITECT_TURN_SCHEMA_VERSION_V3));
    for (const forbidden of ["tools", "tool_choice", "previous_response_id", "conversation"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });
});

describe("modele de revue", () => {
  function proposal(
    brief: ProjectBriefInput | null,
    plan: ProjectV1PlanInput | null,
  ): ArchitectProjectUpdateProposal {
    const read = readArchitectProjectUpdate(update({ brief, plan }));
    assert.ok(read.ok);
    return read.proposal;
  }

  it("rend chaque champ du brief et du plan, dans l'ordre", () => {
    const review = buildArchitectProjectUpdateReview(
      { brief: null, plan: null },
      proposal(BRIEF, PLAN),
    );
    assert.deepEqual(
      review.brief.fields.map((field) => field.field),
      ["summary", "problem", "targetUsers", "desiredOutcome", "goals", "nonGoals"],
    );
    assert.deepEqual(
      review.plan.fields.map((field) => field.field),
      ["goal", "inScope", "outOfScope", "technicalDirection", "milestones"],
    );
  });

  it("dit qu'une section n'existait pas encore", () => {
    const review = buildArchitectProjectUpdateReview({ brief: null, plan: null }, proposal(BRIEF, null));
    assert.equal(review.brief.present, false);
    assert.equal(review.brief.changed, true);
  });

  it("rend une section inchangee avec les memes valeurs des deux cotes", () => {
    const review = buildArchitectProjectUpdateReview(
      { brief: BRIEF, plan: PLAN },
      proposal(BRIEF, null),
    );
    assert.equal(review.plan.action, PROJECT_UPDATE_ACTION.UNCHANGED);
    assert.equal(review.plan.changed, false);
    for (const field of review.plan.fields) {
      assert.equal(field.changed, false);
      assert.equal(field.currentText, field.proposedText);
      assert.deepEqual(field.currentList, field.proposedList);
    }
  });

  it("signale exactement les champs qui changent", () => {
    const review = buildArchitectProjectUpdateReview(
      { brief: BRIEF, plan: null },
      proposal({ ...BRIEF, summary: "Un autre resume." }, null),
    );
    const changed = review.brief.fields.filter((field) => field.changed).map((field) => field.field);
    assert.deepEqual(changed, ["summary"]);
  });

  it("voit un reordonnancement de liste comme un changement", () => {
    // L'ordre porte du sens : les etapes decrivent une progression.
    const review = buildArchitectProjectUpdateReview(
      { brief: null, plan: { ...PLAN, milestones: ["A", "B"] } },
      proposal(null, { ...PLAN, milestones: ["B", "A"] }),
    );
    const milestones = review.plan.fields.find((field) => field.field === "milestones");
    assert.equal(milestones?.changed, true);
  });

  it("porte la justification, telle quelle", () => {
    const review = buildArchitectProjectUpdateReview(
      { brief: null, plan: null },
      proposal(BRIEF, null),
    );
    assert.equal(review.reason, "L'utilisateur a decrit son produit.");
  });
});
