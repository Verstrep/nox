/**
 * Affichage du backlog.
 *
 * ## Ce que ce fichier prouve
 *
 * Que chaque refus dit **quoi faire** : definir le plan, attendre, decider du
 * backlog en attente. Un message unique pour trois causes differentes
 * laisserait l'utilisateur sans geste a poser.
 *
 * Et que le reordonnancement est pur : il rend une nouvelle liste, ne modifie
 * jamais celle qu'on lui donne, et refuse silencieusement un deplacement hors
 * des bornes plutot que de reordonner de travers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ARCHITECT_BACKLOG_PROPOSAL_STATUS } from "@nox/shared";

import {
  BACKLOG_GENERATE_NOTICE,
  BACKLOG_STALE_MESSAGE,
  BACKLOG_UNKNOWN_FRESHNESS_MESSAGE,
  backlogContextUrl,
  backlogCreatedCountLabel,
  backlogProposalStatusLabel,
  backlogRefusalMessage,
  backlogReviewUrl,
  backlogStateLabel,
  backlogTaskCountLabel,
  backlogUrl,
  moveBacklogItem,
  removeBacklogItem,
  type BacklogSurfaceState,
} from "./display.ts";

describe("URL", () => {
  it("appartiennent toutes au projet", () => {
    assert.equal(backlogUrl("p1"), "/projects/p1/backlog");
    assert.equal(backlogReviewUrl("p1", "b1"), "/projects/p1/backlog/b1");
    assert.equal(backlogContextUrl("p1"), "/projects/p1/backlog/context");
  });

  it("ne melangent jamais deux projets", () => {
    assert.notEqual(backlogReviewUrl("A", "b1"), backlogReviewUrl("B", "b1"));
  });
});

describe("etats de la surface", () => {
  const states: BacklogSurfaceState[] = [
    "not_generated",
    "generating",
    "proposal_ready",
    "stale",
    "applied",
    "dismissed",
  ];

  it("porte six libelles distincts", () => {
    const labels = states.map(backlogStateLabel);
    assert.equal(new Set(labels).size, states.length, "six etats, six libelles");
  });

  it("nomme les etats attendus par l'ecran", () => {
    assert.equal(backlogStateLabel("not_generated"), "Not generated");
    assert.equal(backlogStateLabel("proposal_ready"), "Proposal ready");
    assert.equal(backlogStateLabel("stale"), "Stale");
    assert.equal(backlogStateLabel("applied"), "Applied");
    assert.equal(backlogStateLabel("dismissed"), "Dismissed");
  });
});

describe("statuts d'une proposition", () => {
  it("porte trois libelles distincts", () => {
    const labels = [
      ARCHITECT_BACKLOG_PROPOSAL_STATUS.PENDING,
      ARCHITECT_BACKLOG_PROPOSAL_STATUS.APPLIED,
      ARCHITECT_BACKLOG_PROPOSAL_STATUS.DISMISSED,
    ].map(backlogProposalStatusLabel);
    assert.equal(new Set(labels).size, 3);
  });
});

describe("decomptes", () => {
  it("accorde le nombre de taches proposees", () => {
    assert.equal(backlogTaskCountLabel(0), "No task");
    assert.equal(backlogTaskCountLabel(1), "1 task");
    assert.equal(backlogTaskCountLabel(8), "8 tasks");
  });

  it("accorde le nombre de taches creees", () => {
    assert.equal(backlogCreatedCountLabel(1), "1 Draft task created");
    assert.equal(backlogCreatedCountLabel(3), "3 Draft tasks created");
  });
});

describe("messages de refus", () => {
  it("dit de definir le plan quand il manque", () => {
    assert.ok(backlogRefusalMessage("no_plan").includes("Living V1 Plan"));
  });

  it("dit d'attendre quand un appel est en vol", () => {
    assert.ok(backlogRefusalMessage("active").includes("deja en cours"));
  });

  it("dit de decider du backlog en attente", () => {
    const message = backlogRefusalMessage("pending_proposal");
    assert.ok(message.includes("Appliquez-le ou ecartez-le"));
  });

  it("ne rend jamais la meme phrase pour deux causes differentes", () => {
    const messages = (["no_plan", "active", "pending_proposal", "not_found"] as const).map(
      backlogRefusalMessage,
    );
    assert.equal(new Set(messages).size, 4);
  });
});

describe("messages d'etat", () => {
  it("annonce le cout d'une generation", () => {
    assert.equal(BACKLOG_GENERATE_NOTICE, "This action calls OpenAI once.");
  });

  it("nomme les cinq sources possibles d'une peremption", () => {
    // NOX sait que l'empreinte a change, pas toujours laquelle de ses
    // composantes : affirmer « le plan a change » quand c'est une memoire
    // enverrait chercher au mauvais endroit.
    assert.ok(BACKLOG_STALE_MESSAGE.includes("Project Plan"));
    assert.ok(BACKLOG_STALE_MESSAGE.includes("memoire"));
    assert.ok(BACKLOG_STALE_MESSAGE.includes("taches existantes"));
    assert.ok(BACKLOG_STALE_MESSAGE.includes("documentation"));
    assert.ok(BACKLOG_STALE_MESSAGE.includes("Generez un nouveau backlog"));
  });

  it("distingue « perime » de « je ne sais pas »", () => {
    assert.notEqual(BACKLOG_STALE_MESSAGE, BACKLOG_UNKNOWN_FRESHNESS_MESSAGE);
    assert.ok(BACKLOG_UNKNOWN_FRESHNESS_MESSAGE.includes("runner"));
  });

  it("ne propose aucune fusion", () => {
    for (const message of [BACKLOG_STALE_MESSAGE, BACKLOG_UNKNOWN_FRESHNESS_MESSAGE]) {
      assert.equal(message.toLowerCase().includes("fusion"), false);
      assert.equal(message.toLowerCase().includes("merge"), false);
    }
  });
});

describe("reordonnancement", () => {
  const items = ["A", "B", "C", "D"];

  it("deplace un element vers le haut", () => {
    assert.deepEqual(moveBacklogItem(items, 2, 1), ["A", "C", "B", "D"]);
  });

  it("deplace un element vers le bas", () => {
    assert.deepEqual(moveBacklogItem(items, 0, 1), ["B", "A", "C", "D"]);
  });

  it("deplace du debut a la fin", () => {
    assert.deepEqual(moveBacklogItem(items, 0, 3), ["B", "C", "D", "A"]);
  });

  it("ne modifie jamais la liste d'origine", () => {
    const original = [...items];
    moveBacklogItem(items, 0, 3);
    assert.deepEqual(items, original);
  });

  it("laisse la liste inchangee hors des bornes", () => {
    assert.deepEqual(moveBacklogItem(items, 0, -1), items);
    assert.deepEqual(moveBacklogItem(items, 3, 4), items);
    assert.deepEqual(moveBacklogItem(items, 1, 1), items);
    assert.deepEqual(moveBacklogItem([], 0, 1), []);
  });
});

describe("retrait", () => {
  const items = ["A", "B", "C"];

  it("retire l'element demande", () => {
    assert.deepEqual(removeBacklogItem(items, 1), ["A", "C"]);
    assert.deepEqual(removeBacklogItem(items, 0), ["B", "C"]);
    assert.deepEqual(removeBacklogItem(items, 2), ["A", "B"]);
  });

  it("ne modifie jamais la liste d'origine", () => {
    const original = [...items];
    removeBacklogItem(items, 1);
    assert.deepEqual(items, original);
  });

  it("laisse la liste inchangee hors des bornes", () => {
    assert.deepEqual(removeBacklogItem(items, -1), items);
    assert.deepEqual(removeBacklogItem(items, 3), items);
  });

  it("peut vider entierement la liste", () => {
    assert.deepEqual(removeBacklogItem(["A"], 0), []);
  });
});
