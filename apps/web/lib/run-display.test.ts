import { RUN_STATUSES } from "@nox/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeRunStatus,
  formatDuration,
  formatReportedCost,
  isRunActive,
  newRunUrl,
  runStatusEndpoint,
  runUrl,
  shortSha,
} from "./run-display.ts";

describe("libelles d'execution", () => {
  it("nomme chaque statut", () => {
    for (const status of RUN_STATUSES) {
      assert.ok(describeRunStatus(status).length > 0, status);
    }
  });

  it("distingue actif et termine", () => {
    assert.equal(isRunActive("QUEUED"), true);
    assert.equal(isRunActive("RUNNING"), true);
    assert.equal(isRunActive("COMPLETED"), false);
    assert.equal(isRunActive("FAILED"), false);
    assert.equal(isRunActive("BLOCKED"), false);
    assert.equal(isRunActive("CANCELLED"), false);
  });
});

describe("URL", () => {
  it("construit les URL de preparation et de resultat", () => {
    assert.equal(newRunUrl("p1", "t1"), "/projects/p1/tasks/t1/runs/new");
    assert.equal(runUrl("p1", "t1", "r1"), "/projects/p1/tasks/t1/runs/r1");
  });

  it("pointe l'interrogation vers un Route Handler de Next, jamais vers le runner", () => {
    const endpoint = runStatusEndpoint("p1", "t1", "r1");

    assert.equal(endpoint, "/api/projects/p1/tasks/t1/runs/r1/status");
    // Une URL relative : le navigateur ne peut pas joindre le runner.
    assert.equal(endpoint.startsWith("/"), true);
    assert.equal(endpoint.includes("4310"), false);
    assert.equal(endpoint.includes("http"), false);
  });
});

describe("formatDuration", () => {
  it("affiche les secondes sous une minute", () => {
    assert.equal(formatDuration(0), "0 s");
    assert.equal(formatDuration(4200), "4 s");
    assert.equal(formatDuration(59_000), "59 s");
  });

  it("affiche minutes et secondes au-dela", () => {
    assert.equal(formatDuration(60_000), "1 min 00 s");
    assert.equal(formatDuration(125_000), "2 min 05 s");
  });

  it("retourne null pour une valeur absente ou aberrante", () => {
    assert.equal(formatDuration(null), null);
    assert.equal(formatDuration(-1), null);
    assert.equal(formatDuration(Number.NaN), null);
  });
});

describe("formatReportedCost", () => {
  it("affiche un cout rapporte", () => {
    assert.equal(formatReportedCost(0.0421), "0.0421 $");
  });

  it("ne fabrique aucun cout quand l'outil n'en fournit pas", () => {
    assert.equal(formatReportedCost(null), null);
    assert.equal(formatReportedCost(Number.NaN), null);
    assert.equal(formatReportedCost(-1), null);
  });
});

describe("shortSha", () => {
  it("raccourcit un SHA complet", () => {
    assert.equal(shortSha("a".repeat(40)), "a".repeat(12));
  });

  it("laisse intacte une valeur deja courte ou absente", () => {
    assert.equal(shortSha("abc"), "abc");
    assert.equal(shortSha(null), null);
  });
});
