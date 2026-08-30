/**
 * Ce que la carte et la revue annoncent.
 *
 * Le resume est la seule chose que beaucoup d'utilisateurs liront avant de
 * cliquer. Il doit donc etre exact sur un point precis : ses axes sont
 * **independants**, jamais additionnes. Une tache peut etre modifiee et
 * deplacee ; la compter deux fois dans un total unique donnerait un nombre que
 * rien ne verifie, et qu'aucun ecran ne pourrait justifier.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REPLAN_CHANGE,
  REPLAN_FIELD,
  REPLAN_LOCK_REASONS,
  REPLAN_PROPOSAL_STATUSES,
} from "@nox/shared";
import {
  projectChangeInspectUrl,
  projectChangeUrl,
  projectChangesUrl,
  replanChangeLabel,
  replanCountLabel,
  replanFieldLabel,
  replanLockLabel,
  replanStatusLabel,
  replanSummaryLines,
} from "./display.ts";

describe("resume d'un changement", () => {
  it("n'annonce que les axes qui ont bouge", () => {
    assert.deepEqual(
      replanSummaryLines({
        added: 1,
        updated: 2,
        removed: 0,
        dependencyChanged: 0,
        orderChanged: false,
      }),
      ["1 added", "2 updated"],
    );
  });

  it("distingue le reordonnancement d'une modification", () => {
    assert.deepEqual(
      replanSummaryLines({
        added: 0,
        updated: 0,
        removed: 0,
        dependencyChanged: 0,
        orderChanged: true,
      }),
      ["order changed"],
    );
  });

  it("annonce les dependances comme un axe a part", () => {
    assert.deepEqual(
      replanSummaryLines({
        added: 0,
        updated: 1,
        removed: 0,
        dependencyChanged: 1,
        orderChanged: false,
      }),
      ["1 updated", "1 dependency change"],
    );
  });

  it("ne dit rien quand rien ne change", () => {
    assert.deepEqual(
      replanSummaryLines({
        added: 0,
        updated: 0,
        removed: 0,
        dependencyChanged: 0,
        orderChanged: false,
      }),
      [],
    );
  });
});

describe("libelles", () => {
  it("nomme chaque sort possible d'un element", () => {
    for (const change of Object.values(REPLAN_CHANGE)) {
      assert.notEqual(replanChangeLabel(change), "");
    }
  });

  it("nomme chaque champ du contrat", () => {
    for (const field of Object.values(REPLAN_FIELD)) {
      assert.notEqual(replanFieldLabel(field), "");
    }
  });

  it("nomme chaque raison de verrouillage", () => {
    // Nommee, jamais reduite a « verrouillee » : deux raisons differentes
    // demandent deux gestes differents de la part de l'utilisateur.
    const labels = REPLAN_LOCK_REASONS.map(replanLockLabel);
    assert.equal(new Set(labels).size, labels.length);
  });

  it("nomme chaque statut de proposition", () => {
    for (const status of REPLAN_PROPOSAL_STATUSES) {
      assert.notEqual(replanStatusLabel(status), "");
    }
    // Un statut illisible retombe sur le seul defaut qui n'autorise rien a
    // l'ecran : la proposition se lit comme en attente d'une decision.
    assert.equal(replanStatusLabel("QUELQUE_CHOSE"), "Pending");
  });

  it("n'ecrit jamais un pluriel au singulier", () => {
    assert.equal(replanCountLabel(0, "change", "changes"), "No change");
    assert.equal(replanCountLabel(1, "change", "changes"), "1 change");
    assert.equal(replanCountLabel(4, "change", "changes"), "4 changes");
  });
});

describe("urls", () => {
  it("sont construites ici, jamais recopiees a la main", () => {
    assert.equal(projectChangesUrl("p1"), "/projects/p1/architect/changes");
    assert.equal(projectChangeUrl("p1", "c1"), "/projects/p1/architect/changes/c1");
    assert.equal(
      projectChangeInspectUrl("p1", "c1"),
      "/projects/p1/architect/changes/c1/inspect",
    );
  });
});
