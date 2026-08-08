import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RUN_VALIDATION_STATUS } from "@nox/shared";

import { ValidationTracker } from "./validations.ts";

/** Horloge deterministe : les dates comparees doivent etre reproductibles. */
function clock(start = 1_000): () => Date {
  let current = start;
  return () => {
    current += 1_000;
    return new Date(current);
  };
}

describe("ValidationTracker", () => {
  it("part de zero commande sans rien inventer", () => {
    const tracker = new ValidationTracker([]);

    assert.equal(tracker.size, 0);
    assert.deepEqual(tracker.snapshot(), []);
  });

  it("recopie les commandes attendues, en attente", () => {
    const tracker = new ValidationTracker(["npm run test", "npm run lint"]);
    const snapshot = tracker.snapshot();

    assert.equal(snapshot.length, 2);
    assert.deepEqual(
      snapshot.map((entry) => entry.command),
      ["npm run test", "npm run lint"],
    );
    assert.deepEqual(
      snapshot.map((entry) => entry.position),
      [0, 1],
    );
    assert.ok(snapshot.every((entry) => entry.status === RUN_VALIDATION_STATUS.NOT_RUN));
    assert.ok(snapshot.every((entry) => entry.exitCode === null && entry.summary === null));
  });

  it("laisse NOT_RUN une commande que l'agent n'a jamais lancee", () => {
    const tracker = new ValidationTracker(["npm run test", "npm run build"]);

    tracker.apply({ kind: "started", command: "npm run test" });
    tracker.apply({
      kind: "finished",
      command: "npm run test",
      outcome: "passed",
      exitCode: 0,
      summary: null,
    });
    tracker.seal();

    const snapshot = tracker.snapshot();
    assert.equal(snapshot[0]?.status, RUN_VALIDATION_STATUS.PASSED);
    assert.equal(snapshot[1]?.status, RUN_VALIDATION_STATUS.NOT_RUN);
  });

  it("passe a RUNNING au lancement", () => {
    const tracker = new ValidationTracker(["npm run test"], clock());

    tracker.apply({ kind: "started", command: "npm run test" });

    const entry = tracker.snapshot()[0];
    assert.equal(entry?.status, RUN_VALIDATION_STATUS.RUNNING);
    assert.notEqual(entry?.startedAt, null);
    assert.equal(entry?.finishedAt, null);
  });

  it("enregistre une reussite", () => {
    const tracker = new ValidationTracker(["npm run test"], clock());

    tracker.apply({ kind: "started", command: "npm run test" });
    tracker.apply({
      kind: "finished",
      command: "npm run test",
      outcome: "passed",
      exitCode: 0,
      summary: "1370 tests, 0 echec",
    });

    const entry = tracker.snapshot()[0];
    assert.equal(entry?.status, RUN_VALIDATION_STATUS.PASSED);
    assert.equal(entry?.exitCode, 0);
    assert.equal(entry?.summary, "1370 tests, 0 echec");
    assert.notEqual(entry?.finishedAt, null);
  });

  it("enregistre un echec", () => {
    const tracker = new ValidationTracker(["npm run lint"]);

    tracker.apply({ kind: "started", command: "npm run lint" });
    tracker.apply({
      kind: "finished",
      command: "npm run lint",
      outcome: "failed",
      exitCode: 1,
      summary: "2 problemes",
    });

    assert.equal(tracker.snapshot()[0]?.status, RUN_VALIDATION_STATUS.FAILED);
    assert.equal(tracker.snapshot()[0]?.exitCode, 1);
  });

  it("conserve un code de sortie absent plutot que d'en deduire un", () => {
    const tracker = new ValidationTracker(["npm run test"]);

    tracker.apply({ kind: "started", command: "npm run test" });
    tracker.apply({
      kind: "finished",
      command: "npm run test",
      outcome: "failed",
      exitCode: null,
      summary: null,
    });

    const entry = tracker.snapshot()[0];
    // « Echoue » ne veut pas dire « code 1 » : NOX n'invente pas la valeur.
    assert.equal(entry?.status, RUN_VALIDATION_STATUS.FAILED);
    assert.equal(entry?.exitCode, null);
  });

  it("laisse UNKNOWN une commande lancee dont le resultat n'arrive jamais", () => {
    const tracker = new ValidationTracker(["npm run test"]);

    tracker.apply({ kind: "started", command: "npm run test" });
    tracker.seal();

    assert.equal(tracker.snapshot()[0]?.status, RUN_VALIDATION_STATUS.UNKNOWN);
  });

  it("ne transforme pas une commande jamais lancee en UNKNOWN", () => {
    const tracker = new ValidationTracker(["npm run test"]);

    tracker.seal();

    assert.equal(tracker.snapshot()[0]?.status, RUN_VALIDATION_STATUS.NOT_RUN);
  });

  it("accepte un resultat sans lancement correspondant", () => {
    const tracker = new ValidationTracker(["npm run test"], clock());

    tracker.apply({
      kind: "finished",
      command: "npm run test",
      outcome: "passed",
      exitCode: 0,
      summary: null,
    });

    const entry = tracker.snapshot()[0];
    assert.equal(entry?.status, RUN_VALIDATION_STATUS.PASSED);
    // Une date de debut est deduite de la fin plutot que laissee vide : la
    // commande a bien tourne, meme si son debut n'a pas ete observe.
    assert.equal(entry?.startedAt, entry?.finishedAt);
  });

  it("ignore une commande qui n'etait pas attendue", () => {
    const tracker = new ValidationTracker(["npm run test"]);

    tracker.apply({ kind: "started", command: "npm run build" });
    tracker.apply({
      kind: "finished",
      command: "npm run build",
      outcome: "failed",
      exitCode: 1,
      summary: null,
    });

    // La table decrit ce que la tache demandait, pas tout ce que l'agent a lance.
    assert.equal(tracker.size, 1);
    assert.equal(tracker.snapshot()[0]?.status, RUN_VALIDATION_STATUS.NOT_RUN);
  });

  it("conserve l'ordre de la tache, quel que soit l'ordre d'execution", () => {
    const tracker = new ValidationTracker(["npm run test", "npm run lint", "npm run build"]);

    tracker.apply({ kind: "started", command: "npm run build" });
    tracker.apply({
      kind: "finished",
      command: "npm run build",
      outcome: "passed",
      exitCode: 0,
      summary: null,
    });
    tracker.apply({ kind: "started", command: "npm run test" });
    tracker.apply({
      kind: "finished",
      command: "npm run test",
      outcome: "passed",
      exitCode: 0,
      summary: null,
    });
    tracker.seal();

    assert.deepEqual(
      tracker.snapshot().map((entry) => [entry.position, entry.command, entry.status]),
      [
        [0, "npm run test", RUN_VALIDATION_STATUS.PASSED],
        [1, "npm run lint", RUN_VALIDATION_STATUS.NOT_RUN],
        [2, "npm run build", RUN_VALIDATION_STATUS.PASSED],
      ],
    );
  });

  it("distingue deux positions portant la meme commande", () => {
    const tracker = new ValidationTracker(["npm run test", "npm run test"]);

    tracker.apply({ kind: "started", command: "npm run test" });
    tracker.apply({
      kind: "finished",
      command: "npm run test",
      outcome: "passed",
      exitCode: 0,
      summary: null,
    });

    const first = tracker.snapshot();
    // Le premier passage remplit la premiere position, pas les deux.
    assert.equal(first[0]?.status, RUN_VALIDATION_STATUS.PASSED);
    assert.equal(first[1]?.status, RUN_VALIDATION_STATUS.NOT_RUN);

    tracker.apply({ kind: "started", command: "npm run test" });
    tracker.apply({
      kind: "finished",
      command: "npm run test",
      outcome: "failed",
      exitCode: 1,
      summary: null,
    });

    const second = tracker.snapshot();
    // Le second passage remplit la seconde, sans ecraser la premiere.
    assert.equal(second[0]?.status, RUN_VALIDATION_STATUS.PASSED);
    assert.equal(second[1]?.status, RUN_VALIDATION_STATUS.FAILED);
  });

  it("borne le texte d'une commande demesuree", () => {
    const tracker = new ValidationTracker(["x".repeat(5_000)]);

    assert.ok((tracker.snapshot()[0]?.command.length ?? 0) <= 500);
  });

  it("enregistre une issue inconnue sans la confondre avec un echec", () => {
    const tracker = new ValidationTracker(["npm run test"]);

    tracker.apply({ kind: "started", command: "npm run test" });
    tracker.apply({
      kind: "finished",
      command: "npm run test",
      outcome: "unknown",
      exitCode: null,
      summary: "au moins une commande a echoue",
    });

    const entry = tracker.snapshot()[0];
    // Elle a bel et bien tourne : elle ne redevient jamais « Not run ».
    assert.equal(entry?.status, RUN_VALIDATION_STATUS.UNKNOWN);
    assert.notEqual(entry?.startedAt, null);
  });

  it("represente le dernier resultat d'une commande relancee", () => {
    const tracker = new ValidationTracker(["npm run test"], clock());

    tracker.apply({ kind: "started", command: "npm run test" });
    tracker.apply({
      kind: "finished",
      command: "npm run test",
      outcome: "failed",
      exitCode: 1,
      summary: "3 echecs",
    });

    // L'agent corrige, puis relance la meme commande.
    tracker.apply({ kind: "started", command: "npm run test" });
    tracker.apply({
      kind: "finished",
      command: "npm run test",
      outcome: "passed",
      exitCode: 0,
      summary: "0 echec",
    });

    const entry = tracker.snapshot()[0];
    assert.equal(entry?.status, RUN_VALIDATION_STATUS.PASSED);
    assert.equal(entry?.exitCode, 0);
    assert.equal(entry?.summary, "0 echec");
  });

  it("efface le resultat precedent quand une commande est relancee sans conclure", () => {
    const tracker = new ValidationTracker(["npm run test"], clock());

    tracker.apply({ kind: "started", command: "npm run test" });
    tracker.apply({
      kind: "finished",
      command: "npm run test",
      outcome: "failed",
      exitCode: 1,
      summary: "3 echecs",
    });
    tracker.apply({ kind: "started", command: "npm run test" });
    tracker.seal();

    const entry = tracker.snapshot()[0];
    // Afficher « 3 echecs » a cote d'un statut inconnu raconterait deux
    // executions differentes comme si elles n'en formaient qu'une.
    assert.equal(entry?.status, RUN_VALIDATION_STATUS.UNKNOWN);
    assert.equal(entry?.summary, null);
    assert.equal(entry?.exitCode, null);
  });
});
