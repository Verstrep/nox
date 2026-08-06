import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ClaudeRunRegistry } from "./registry.ts";

const ID_A = "3f2504e0-4f89-41d3-9a0c-000000000001";
const ID_B = "3f2504e0-4f89-41d3-9a0c-000000000002";
const ID_C = "3f2504e0-4f89-41d3-9a0c-000000000003";

describe("registre - une seule execution active", () => {
  it("accepte une premiere execution", () => {
    const registry = new ClaudeRunRegistry();
    assert.deepEqual(registry.register(ID_A), { ok: true });
    assert.equal(registry.activeRunId(), ID_A);
  });

  it("refuse une seconde execution tant que la premiere tourne", () => {
    const registry = new ClaudeRunRegistry();
    registry.register(ID_A);

    assert.deepEqual(registry.register(ID_B), { ok: false, reason: "already_active" });
  });

  it("accepte une nouvelle execution une fois la precedente terminee", () => {
    const registry = new ClaudeRunRegistry();
    registry.register(ID_A);
    registry.finish(ID_A, "COMPLETED");

    assert.deepEqual(registry.register(ID_B), { ok: true });
    assert.equal(registry.activeRunId(), ID_B);
  });

  it("refuse un identifiant deja connu, meme termine", () => {
    const registry = new ClaudeRunRegistry();
    registry.register(ID_A);
    registry.finish(ID_A, "COMPLETED");

    assert.deepEqual(registry.register(ID_A), { ok: false, reason: "duplicate_id" });
  });
});

describe("registre - cycle de vie", () => {
  it("part de QUEUED puis passe a RUNNING", () => {
    const registry = new ClaudeRunRegistry();
    registry.register(ID_A);

    assert.equal(registry.snapshot(ID_A)?.status, "QUEUED");

    registry.start(ID_A, new Date("2026-08-06T10:00:00.000Z"));
    assert.equal(registry.snapshot(ID_A)?.status, "RUNNING");
    assert.equal(registry.snapshot(ID_A)?.startedAt, "2026-08-06T10:00:00.000Z");
  });

  it("conserve le premier etat final", () => {
    const registry = new ClaudeRunRegistry();
    registry.register(ID_A);

    registry.finish(ID_A, "BLOCKED", { errorCode: "CLAUDE_TIMEOUT" });
    // Une fin de processus arrivant apres le depassement de delai ne doit pas
    // effacer la raison de l'arret.
    registry.finish(ID_A, "COMPLETED", { errorCode: null, resultText: "trop tard" });

    const snapshot = registry.snapshot(ID_A);
    assert.equal(snapshot?.status, "BLOCKED");
    assert.equal(snapshot?.errorCode, "CLAUDE_TIMEOUT");
    assert.equal(snapshot?.resultText, null);
  });

  it("refuse toute mise a jour apres un etat final", () => {
    const registry = new ClaudeRunRegistry();
    registry.register(ID_A);
    registry.finish(ID_A, "COMPLETED", { resultText: "definitif" });

    registry.update(ID_A, { resultText: "autre chose" });
    registry.start(ID_A, new Date());

    assert.equal(registry.snapshot(ID_A)?.status, "COMPLETED");
    assert.equal(registry.snapshot(ID_A)?.resultText, "definitif");
  });

  it("retourne null pour une execution inconnue", () => {
    const registry = new ClaudeRunRegistry();
    assert.equal(registry.snapshot(ID_A), null);
    assert.equal(registry.has(ID_A), false);
  });

  it("borne le contenu conserve a la fin", () => {
    const registry = new ClaudeRunRegistry();
    registry.register(ID_A);

    registry.finish(ID_A, "COMPLETED", {
      resultText: "a".repeat(500_000),
      stderrTail: `${"b".repeat(50_000)}CAUSE`,
      git: {
        branch: "main",
        upstream: "origin/main",
        headBefore: "abc",
        headAfter: "abc",
        diffStat: "c".repeat(50_000),
        changedFiles: Array.from({ length: 900 }, (_, index) => `f${String(index)}.ts`),
      },
    });

    const snapshot = registry.snapshot(ID_A);
    assert.ok((snapshot?.resultText ?? "").length <= 200_000);
    assert.ok((snapshot?.stderrTail ?? "").length <= 8_000);
    assert.ok((snapshot?.stderrTail ?? "").includes("CAUSE"));
    assert.ok((snapshot?.git.diffStat ?? "").length <= 20_000);
    assert.equal(snapshot?.git.changedFiles.length, 500);
  });
});

describe("registre - arret d'un processus", () => {
  it("ne termine que le processus du run demande", () => {
    const registry = new ClaudeRunRegistry();
    registry.register(ID_A);

    let killed = false;
    registry.attachKill(ID_A, () => {
      killed = true;
    });

    assert.equal(registry.kill(ID_B), false, "un identifiant inconnu ne doit rien terminer");
    assert.equal(killed, false);

    assert.equal(registry.kill(ID_A), true);
    assert.equal(killed, true);
  });

  it("oublie la fonction d'arret une fois l'execution terminee", () => {
    const registry = new ClaudeRunRegistry();
    registry.register(ID_A);
    registry.attachKill(ID_A, () => undefined);
    registry.finish(ID_A, "COMPLETED");

    assert.equal(registry.kill(ID_A), false);
  });
});

describe("registre - retention", () => {
  it("supprime les executions terminees au-dela du maximum", () => {
    const registry = new ClaudeRunRegistry(2, 24 * 60 * 60 * 1000);

    for (let index = 1; index <= 4; index += 1) {
      const id = `3f2504e0-4f89-41d3-9a0c-00000000000${String(index)}`;
      registry.register(id);
      registry.finish(id, "COMPLETED");
    }

    assert.equal(registry.size(), 2);
    // Les plus anciennes partent en premier.
    assert.equal(registry.has("3f2504e0-4f89-41d3-9a0c-000000000001"), false);
    assert.equal(registry.has("3f2504e0-4f89-41d3-9a0c-000000000004"), true);
  });

  it("supprime les executions terminees trop anciennes", () => {
    let now = new Date("2026-08-06T10:00:00.000Z");
    const registry = new ClaudeRunRegistry(20, 60_000, () => now);

    registry.register(ID_A);
    registry.finish(ID_A, "COMPLETED");

    now = new Date("2026-08-06T10:02:00.000Z");
    registry.prune();

    assert.equal(registry.has(ID_A), false);
  });

  it("ne supprime jamais une execution active", () => {
    let now = new Date("2026-08-06T10:00:00.000Z");
    // Un maximum de zero entree conservee : meme la, l'active reste.
    const registry = new ClaudeRunRegistry(0, 1, () => now);

    registry.register(ID_A);
    registry.start(ID_A, now);

    now = new Date("2026-08-07T10:00:00.000Z");
    registry.prune();

    assert.equal(registry.has(ID_A), true);
    assert.equal(registry.activeRunId(), ID_A);
  });

  it("conserve le resultat final apres la fin du processus", () => {
    const registry = new ClaudeRunRegistry();
    registry.register(ID_C);
    registry.finish(ID_C, "COMPLETED", { resultText: "Compte rendu.", exitCode: 0 });

    const snapshot = registry.snapshot(ID_C);
    assert.equal(snapshot?.resultText, "Compte rendu.");
    assert.equal(snapshot?.exitCode, 0);
    assert.ok(snapshot?.finishedAt !== null);
  });
});
