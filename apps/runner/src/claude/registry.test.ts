import { CLAUDE_RUN_EVENT_KIND, RUN_EVENT_LIMITS } from "@nox/shared";
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

/**
 * Evenements : numerotation, curseur, bornes.
 *
 * Le registre est la seule autorite sur les numeros d'evenements. Ces tests
 * verifient qu'aucun numero ne vient d'ailleurs, qu'aucun n'est reutilise, et
 * qu'une execution bavarde ne peut pas remplir la memoire du runner.
 */

const DRAFT = {
  kind: CLAUDE_RUN_EVENT_KIND.TOOL_STARTED,
  label: "Reading README.md",
  detail: null,
  toolName: "Read",
  isError: false,
} as const;

function withRun(): ClaudeRunRegistry {
  const registry = new ClaudeRunRegistry();
  registry.register(ID_A);
  registry.start(ID_A, new Date());
  return registry;
}

describe("registre - evenements", () => {
  it("attribue des numeros strictement croissants", () => {
    const registry = withRun();
    registry.appendEvents(ID_A, [DRAFT, DRAFT, DRAFT]);

    const page = registry.getEvents(ID_A, 0, 100);
    assert.deepEqual(page?.events.map((event) => event.sequence), [1, 2, 3]);
  });

  it("ignore un numero fourni par l'appelant", () => {
    const registry = withRun();
    // Le brouillon n'a pas de champ `sequence` : le type l'interdit, et cette
    // valeur parasite doit rester sans effet.
    registry.appendEvents(ID_A, [{ ...DRAFT, sequence: 999 } as never]);

    assert.equal(registry.getEvents(ID_A, 0, 10)?.events[0]?.sequence, 1);
  });

  it("produit une date cote runner", () => {
    const registry = withRun();
    registry.appendEvents(ID_A, [{ ...DRAFT, occurredAt: "date-inventee" }]);

    const event = registry.getEvents(ID_A, 0, 10)?.events[0];
    assert.equal(Number.isNaN(new Date(event?.occurredAt ?? "").getTime()), false);
  });

  it("ne rend que les evenements posterieurs au curseur", () => {
    const registry = withRun();
    registry.appendEvents(ID_A, [DRAFT, DRAFT, DRAFT]);

    const page = registry.getEvents(ID_A, 2, 100);
    assert.deepEqual(page?.events.map((event) => event.sequence), [3]);
  });

  it("borne la taille d'un lot", () => {
    const registry = withRun();
    registry.appendEvents(ID_A, Array.from({ length: 50 }, () => DRAFT));

    assert.equal(registry.getEvents(ID_A, 0, 5)?.events.length, 5);
  });

  it("laisse le curseur inchange pour un lot vide", () => {
    const registry = withRun();
    registry.appendEvents(ID_A, [DRAFT]);

    assert.equal(registry.getEvents(ID_A, 1, 10)?.nextSequence, 1);
  });

  it("ne produit jamais deux fois le meme evenement", () => {
    const registry = withRun();
    registry.appendEvents(ID_A, [DRAFT, DRAFT]);

    const first = registry.getEvents(ID_A, 0, 10);
    const second = registry.getEvents(ID_A, first?.nextSequence ?? 0, 10);
    assert.deepEqual(second?.events, []);
  });

  it("conserve les evenements apres la fin de l'execution", () => {
    const registry = withRun();
    registry.appendEvents(ID_A, [DRAFT]);
    registry.finish(ID_A, "COMPLETED");

    const page = registry.getEvents(ID_A, 0, 10);
    assert.equal(page?.events.length, 1);
    assert.equal(page?.isFinal, true);
  });

  it("retourne null pour une execution inconnue", () => {
    assert.equal(new ClaudeRunRegistry().getEvents(ID_A, 0, 10), null);
  });

  it("expose le dernier numero attribue dans l'instantane", () => {
    const registry = withRun();
    registry.appendEvents(ID_A, [DRAFT, DRAFT]);

    assert.equal(registry.snapshot(ID_A)?.lastEventSequence, 2);
  });

  it("perd les evenements d'une execution purgee par le TTL", () => {
    let now = new Date("2026-08-07T10:00:00.000Z");
    const registry = new ClaudeRunRegistry(20, 1_000, () => now);
    registry.register(ID_A);
    registry.appendEvents(ID_A, [DRAFT]);
    registry.finish(ID_A, "COMPLETED");

    now = new Date("2026-08-07T12:00:00.000Z");
    registry.prune();

    // Le registre est la memoire courte : c'est SQLite qui garde la longue.
    assert.equal(registry.getEvents(ID_A, 0, 10), null);
  });

  it("ne purge jamais une execution active, meme au-dela du maximum", () => {
    let now = new Date("2026-08-07T10:00:00.000Z");
    const registry = new ClaudeRunRegistry(1, 1_000, () => now);

    registry.register(ID_A);
    registry.finish(ID_A, "COMPLETED");
    registry.register(ID_B);
    registry.appendEvents(ID_B, [DRAFT]);

    now = new Date("2026-08-07T12:00:00.000Z");
    registry.prune();

    assert.equal(registry.getEvents(ID_B, 0, 10)?.events.length, 1);
  });
});

describe("registre - troncature", () => {
  function fill(registry: ClaudeRunRegistry, count: number): void {
    for (let index = 0; index < count; index += 1) {
      registry.appendEvents(ID_A, [{ ...DRAFT, label: `Reading page-${String(index)}.md` }]);
    }
  }

  it("signale la troncature", () => {
    const registry = withRun();
    fill(registry, RUN_EVENT_LIMITS.maxEvents + 200);

    assert.equal(registry.getEvents(ID_A, 0, RUN_EVENT_LIMITS.maxBatch)?.truncated, true);
    assert.equal(registry.snapshot(ID_A)?.eventsTruncated, true);
  });

  it("ajoute exactement un evenement TRUNCATED", () => {
    const registry = withRun();
    fill(registry, RUN_EVENT_LIMITS.maxEvents + 500);

    let truncations = 0;
    let cursor = 0;
    for (;;) {
      const page = registry.getEvents(ID_A, cursor, RUN_EVENT_LIMITS.maxBatch);
      if (page === null || page.events.length === 0) {
        break;
      }
      truncations += page.events.filter(
        (event) => event.kind === CLAUDE_RUN_EVENT_KIND.TRUNCATED,
      ).length;
      cursor = page.nextSequence;
    }

    assert.equal(truncations, 1);
  });

  it("cesse d'ajouter les evenements ordinaires apres la troncature", () => {
    const registry = withRun();
    fill(registry, RUN_EVENT_LIMITS.maxEvents + 1_000);

    // Le total reste borne, malgre mille evenements de plus.
    const last = registry.snapshot(ID_A)?.lastEventSequence ?? 0;
    assert.equal(last <= RUN_EVENT_LIMITS.maxEvents + RUN_EVENT_LIMITS.reservedEvents, true);
  });

  it("conserve le resultat final malgre la troncature", () => {
    const registry = withRun();
    fill(registry, RUN_EVENT_LIMITS.maxEvents + 100);

    registry.appendEvents(ID_A, [
      {
        kind: CLAUDE_RUN_EVENT_KIND.RESULT,
        label: "Completed",
        detail: null,
        toolName: null,
        isError: false,
      },
    ]);

    const last = registry.snapshot(ID_A)?.lastEventSequence ?? 0;
    const page = registry.getEvents(ID_A, last - 1, 10);
    assert.equal(page?.events[0]?.kind, CLAUDE_RUN_EVENT_KIND.RESULT);
  });

  it("conserve les changements de statut malgre la troncature", () => {
    const registry = withRun();
    fill(registry, RUN_EVENT_LIMITS.maxEvents + 100);

    registry.appendEvents(ID_A, [
      {
        kind: CLAUDE_RUN_EVENT_KIND.STATUS,
        label: "Cancelled",
        detail: null,
        toolName: null,
        isError: false,
      },
    ]);

    const last = registry.snapshot(ID_A)?.lastEventSequence ?? 0;
    assert.equal(registry.getEvents(ID_A, last - 1, 10)?.events[0]?.label, "Cancelled");
  });

  it("conserve les erreurs malgre la troncature", () => {
    const registry = withRun();
    fill(registry, RUN_EVENT_LIMITS.maxEvents + 100);

    registry.appendEvents(ID_A, [
      {
        kind: CLAUDE_RUN_EVENT_KIND.ERROR,
        label: "Edit failed",
        detail: null,
        toolName: "Edit",
        isError: true,
      },
    ]);

    const last = registry.snapshot(ID_A)?.lastEventSequence ?? 0;
    assert.equal(registry.getEvents(ID_A, last - 1, 10)?.events[0]?.label, "Edit failed");
  });

  it("tronque aussi sur le volume total, pas seulement sur le nombre", () => {
    const registry = withRun();
    const gros = { ...DRAFT, detail: "x".repeat(4_000) };

    for (let index = 0; index < 800; index += 1) {
      registry.appendEvents(ID_A, [{ ...gros, label: `Reading p-${String(index)}.md` }]);
    }

    assert.equal(registry.snapshot(ID_A)?.eventsTruncated, true);
  });
});

describe("registre - annulation", () => {
  it("passe une execution en cours a CANCELLING", () => {
    const registry = withRun();
    const result = registry.requestCancellation(ID_A);

    assert.equal(result.ok, true);
    assert.equal(registry.snapshot(ID_A)?.status, "CANCELLING");
  });

  it("refuse une execution inconnue", () => {
    assert.deepEqual(new ClaudeRunRegistry().requestCancellation(ID_A), {
      ok: false,
      reason: "not_found",
    });
  });

  it("refuse une execution deja finale", () => {
    const registry = withRun();
    registry.finish(ID_A, "COMPLETED");

    assert.deepEqual(registry.requestCancellation(ID_A), {
      ok: false,
      reason: "already_final",
    });
  });

  it("refuse une seconde demande concurrente", () => {
    const registry = withRun();
    registry.requestCancellation(ID_A);

    assert.deepEqual(registry.requestCancellation(ID_A), {
      ok: false,
      reason: "already_cancelling",
    });
  });

  it("ne ramene pas un CANCELLING a RUNNING", () => {
    const registry = new ClaudeRunRegistry();
    registry.register(ID_A);
    registry.requestCancellation(ID_A);

    // Le demarrage arrive apres la demande : il ne doit pas l'effacer.
    registry.start(ID_A, new Date());
    assert.equal(registry.snapshot(ID_A)?.status, "CANCELLING");
  });

  it("laisse le premier etat final gagner", () => {
    const registry = withRun();
    registry.requestCancellation(ID_A);
    registry.finish(ID_A, "COMPLETED");
    registry.finish(ID_A, "CANCELLED");

    assert.equal(registry.snapshot(ID_A)?.status, "COMPLETED");
  });

  it("garde CANCELLING hors des etats finaux", () => {
    const registry = withRun();
    registry.requestCancellation(ID_A);

    assert.equal(registry.getEvents(ID_A, 0, 10)?.isFinal, false);
    // L'execution reste active : aucune autre ne peut demarrer.
    assert.deepEqual(registry.register(ID_C), { ok: false, reason: "already_active" });
  });

  it("expose la demande d'annulation", () => {
    const registry = withRun();
    assert.equal(registry.isCancellationRequested(ID_A), false);

    registry.requestCancellation(ID_A);
    assert.equal(registry.isCancellationRequested(ID_A), true);
  });
});
