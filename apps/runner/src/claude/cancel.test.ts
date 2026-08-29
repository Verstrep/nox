/**
 * Tests de l'annulation controlee.
 *
 * Aucun vrai processus n'est lance ici : la fonction d'arret est une doublure,
 * et c'est exactement ce qu'il faut pour verifier **quand** elle est appelee, et
 * combien de fois. L'arret reel de l'arbre de processus est celui du delai
 * maximal, deja couvert par `launcher.test.ts` — il n'existe qu'une seule
 * implementation, et ces tests verifient qu'elle est bien celle qui est
 * declenchee.
 */

import { RUNNER_ERROR, RUN_STATUS } from "@nox/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cancelClaudeRun } from "./cancel.ts";
import { ClaudeRunRegistry } from "./registry.ts";

const RUN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** Ordonnanceur manuel : les tests ne patientent jamais reellement. */
function manualScheduler() {
  const pending: (() => void)[] = [];
  return {
    schedule: (callback: () => void) => {
      pending.push(callback);
      return { unref: () => undefined };
    },
    fire: () => {
      for (const callback of pending.splice(0)) {
        callback();
      }
    },
    get count(): number {
      return pending.length;
    },
  };
}

function activeRegistry(kill: () => void = () => undefined): ClaudeRunRegistry {
  const registry = new ClaudeRunRegistry();
  registry.register(RUN_ID, "d:\\depots\\alpha");
  registry.start(RUN_ID, new Date());
  registry.attachKill(RUN_ID, kill);
  return registry;
}

describe("cancelClaudeRun", () => {
  it("accepte l'arret d'une execution en cours", () => {
    const registry = activeRegistry();
    const result = cancelClaudeRun(RUN_ID, registry, { setTimeoutFn: manualScheduler().schedule });

    assert.equal(result.ok, true);
    assert.equal(registry.snapshot(RUN_ID)?.status, RUN_STATUS.CANCELLING);
  });

  it("accepte l'arret d'une execution encore en file", () => {
    const registry = new ClaudeRunRegistry();
    registry.register(RUN_ID, "d:\\depots\\alpha");
    registry.attachKill(RUN_ID, () => undefined);

    const result = cancelClaudeRun(RUN_ID, registry, { setTimeoutFn: manualScheduler().schedule });

    assert.equal(result.ok, true);
    assert.equal(registry.snapshot(RUN_ID)?.status, RUN_STATUS.CANCELLING);
  });

  it("appelle la fonction d'arret du lanceur, une seule fois", () => {
    let calls = 0;
    const registry = activeRegistry(() => { calls += 1; });

    cancelClaudeRun(RUN_ID, registry, { setTimeoutFn: manualScheduler().schedule });
    assert.equal(calls, 1);
  });

  it("enregistre la date de la demande", () => {
    const registry = activeRegistry();
    const result = cancelClaudeRun(RUN_ID, registry, { setTimeoutFn: manualScheduler().schedule });

    assert.equal(result.ok, true);
    assert.equal(registry.snapshot(RUN_ID)?.cancellationRequestedAt !== null, true);
  });

  it("ajoute un evenement public d'annulation", () => {
    const registry = activeRegistry();
    cancelClaudeRun(RUN_ID, registry, { setTimeoutFn: manualScheduler().schedule });

    const page = registry.getEvents(RUN_ID, 0, 50);
    assert.equal(
      page?.events.some((event) => event.label === "Cancellation requested"),
      true,
    );
  });

  it("refuse une execution inconnue", () => {
    const result = cancelClaudeRun(RUN_ID, new ClaudeRunRegistry());

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, RUNNER_ERROR.CLAUDE_RUN_NOT_FOUND);
  });

  it("refuse une execution deja terminee", () => {
    const registry = activeRegistry();
    registry.finish(RUN_ID, RUN_STATUS.COMPLETED);

    const result = cancelClaudeRun(RUN_ID, registry);

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, RUNNER_ERROR.CLAUDE_RUN_ALREADY_FINISHED);
  });

  it("refuse un second clic pendant l'arret", () => {
    const scheduler = manualScheduler();
    const registry = activeRegistry();

    cancelClaudeRun(RUN_ID, registry, { setTimeoutFn: scheduler.schedule });
    const second = cancelClaudeRun(RUN_ID, registry, { setTimeoutFn: scheduler.schedule });

    assert.equal(second.ok, false);
    assert.equal(second.ok === false && second.code, RUNNER_ERROR.CLAUDE_RUN_CANCELLING);
  });

  it("ne renvoie pas de second signal au processus lors du second clic", () => {
    const scheduler = manualScheduler();
    let calls = 0;
    const registry = activeRegistry(() => { calls += 1; });

    cancelClaudeRun(RUN_ID, registry, { setTimeoutFn: scheduler.schedule });
    cancelClaudeRun(RUN_ID, registry, { setTimeoutFn: scheduler.schedule });

    assert.equal(calls, 1);
  });
});

describe("cancelClaudeRun — surveillance de l'arret", () => {
  it("bloque l'execution si le processus n'a pas ferme", async () => {
    const scheduler = manualScheduler();
    const registry = activeRegistry();

    cancelClaudeRun(RUN_ID, registry, { setTimeoutFn: scheduler.schedule });
    scheduler.fire();
    // La conclusion est asynchrone : elle capture Git avant de trancher.
    await new Promise((resolve) => setImmediate(resolve));

    const snapshot = registry.snapshot(RUN_ID);
    assert.equal(snapshot?.status, RUN_STATUS.BLOCKED);
    assert.equal(snapshot?.errorCode, RUNNER_ERROR.CLAUDE_CANCEL_FAILED);
  });

  it("ajoute un evenement d'erreur quand l'arret echoue", async () => {
    const scheduler = manualScheduler();
    const registry = activeRegistry();

    cancelClaudeRun(RUN_ID, registry, { setTimeoutFn: scheduler.schedule });
    scheduler.fire();
    await new Promise((resolve) => setImmediate(resolve));

    const page = registry.getEvents(RUN_ID, 0, 50);
    assert.equal(
      page?.events.some((event) => event.label === "Cancellation failed" && event.isError),
      true,
    );
  });

  it("ne touche a rien si le processus a fini entre-temps", async () => {
    const scheduler = manualScheduler();
    const registry = activeRegistry();

    cancelClaudeRun(RUN_ID, registry, { setTimeoutFn: scheduler.schedule });
    // Le processus ferme normalement avant l'echeance.
    registry.finish(RUN_ID, RUN_STATUS.CANCELLED);

    scheduler.fire();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(registry.snapshot(RUN_ID)?.status, RUN_STATUS.CANCELLED);
    assert.equal(registry.snapshot(RUN_ID)?.errorCode, null);
  });

  it("ne ressuscite pas une execution deja conclue en reussite", async () => {
    const scheduler = manualScheduler();
    const registry = activeRegistry();

    cancelClaudeRun(RUN_ID, registry, { setTimeoutFn: scheduler.schedule });
    registry.finish(RUN_ID, RUN_STATUS.COMPLETED);

    scheduler.fire();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(registry.snapshot(RUN_ID)?.status, RUN_STATUS.COMPLETED);
  });
});
