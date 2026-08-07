/**
 * Tests du contrat des evenements publics.
 *
 * Le package compile est importe volontairement : c'est l'artefact que le web,
 * le runner et la base consomment reellement.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLAUDE_RUN_EVENT_KIND,
  CLAUDE_RUN_EVENT_KINDS,
  RUN_EVENT_LIMITS,
  isClaudeRunCancelSuccess,
  isClaudeRunEvent,
  isClaudeRunEventKind,
  isClaudeRunEventsSuccess,
  isEssentialEventKind,
  parseClaudeRunCancelRequest,
  parseClaudeRunEventsRequest,
} from "../dist/index.js";

const EVENT = {
  sequence: 1,
  kind: "STATUS",
  occurredAt: "2026-08-07T10:00:00.000Z",
  label: "Started",
  detail: null,
  toolName: null,
  isError: false,
};

describe("isClaudeRunEvent", () => {
  it("accepte un evenement complet", () => {
    assert.equal(isClaudeRunEvent(EVENT), true);
  });

  it("accepte un detail et un outil renseignes", () => {
    assert.equal(
      isClaudeRunEvent({ ...EVENT, detail: "Un detail.", toolName: "Read" }),
      true,
    );
  });

  it("refuse un type inconnu", () => {
    assert.equal(isClaudeRunEvent({ ...EVENT, kind: "THINKING" }), false);
  });

  it("refuse un numero nul ou negatif", () => {
    assert.equal(isClaudeRunEvent({ ...EVENT, sequence: 0 }), false);
    assert.equal(isClaudeRunEvent({ ...EVENT, sequence: -3 }), false);
  });

  it("refuse un numero fractionnaire", () => {
    assert.equal(isClaudeRunEvent({ ...EVENT, sequence: 1.5 }), false);
  });

  it("refuse un champ manquant", () => {
    const { label: _label, ...sansLabel } = EVENT;
    assert.equal(isClaudeRunEvent(sansLabel), false);
  });

  it("refuse un tableau", () => {
    assert.equal(isClaudeRunEvent([EVENT]), false);
  });

  it("refuse null et les primitives", () => {
    assert.equal(isClaudeRunEvent(null), false);
    assert.equal(isClaudeRunEvent("STATUS"), false);
  });
});

describe("types d'evenements", () => {
  it("expose exactement les neuf types du contrat", () => {
    assert.deepEqual([...CLAUDE_RUN_EVENT_KINDS], [
      "STATUS",
      "ASSISTANT_MESSAGE",
      "TOOL_STARTED",
      "TOOL_COMPLETED",
      "VALIDATION",
      "WARNING",
      "ERROR",
      "RESULT",
      "TRUNCATED",
    ]);
  });

  it("ne comporte aucun type de raisonnement", () => {
    // La liste est fermee : il n'existe aucune forme sous laquelle un bloc de
    // raisonnement pourrait etre represente.
    for (const interdit of ["THINKING", "REDACTED_THINKING", "REASONING", "ANALYSIS"]) {
      assert.equal(isClaudeRunEventKind(interdit), false);
    }
  });

  it("designe les types qui survivent a une troncature", () => {
    assert.equal(isEssentialEventKind(CLAUDE_RUN_EVENT_KIND.STATUS), true);
    assert.equal(isEssentialEventKind(CLAUDE_RUN_EVENT_KIND.ERROR), true);
    assert.equal(isEssentialEventKind(CLAUDE_RUN_EVENT_KIND.RESULT), true);
    assert.equal(isEssentialEventKind(CLAUDE_RUN_EVENT_KIND.TOOL_STARTED), false);
  });
});

describe("parseClaudeRunEventsRequest", () => {
  const RUN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("accepte un corps complet", () => {
    assert.deepEqual(parseClaudeRunEventsRequest({ runId: RUN_ID, afterSequence: 12, limit: 50 }), {
      runId: RUN_ID,
      afterSequence: 12,
      limit: 50,
    });
  });

  it("accepte un curseur a zero", () => {
    const parsed = parseClaudeRunEventsRequest({ runId: RUN_ID, afterSequence: 0, limit: 10 });
    assert.equal(parsed?.afterSequence, 0);
  });

  it("applique des valeurs par defaut", () => {
    const parsed = parseClaudeRunEventsRequest({ runId: RUN_ID });
    assert.equal(parsed?.afterSequence, 0);
    assert.equal(parsed?.limit, RUN_EVENT_LIMITS.maxBatch);
  });

  it("ramene une limite excessive dans le domaine autorise", () => {
    const parsed = parseClaudeRunEventsRequest({ runId: RUN_ID, limit: 100_000 });
    assert.equal(parsed?.limit, RUN_EVENT_LIMITS.maxBatch);
  });

  it("refuse un curseur negatif", () => {
    assert.equal(parseClaudeRunEventsRequest({ runId: RUN_ID, afterSequence: -1 }), null);
  });

  it("refuse un curseur fractionnaire", () => {
    assert.equal(parseClaudeRunEventsRequest({ runId: RUN_ID, afterSequence: 1.5 }), null);
  });

  it("refuse une limite nulle", () => {
    assert.equal(parseClaudeRunEventsRequest({ runId: RUN_ID, limit: 0 }), null);
  });

  it("refuse un corps sans identifiant", () => {
    assert.equal(parseClaudeRunEventsRequest({ afterSequence: 0 }), null);
  });

  it("ignore un champ superflu", () => {
    const parsed = parseClaudeRunEventsRequest({
      runId: RUN_ID,
      repositoryPath: "D:\\secret",
      token: "fuite",
    });

    assert.deepEqual(Object.keys(parsed ?? {}).sort(), ["afterSequence", "limit", "runId"]);
  });
});

describe("parseClaudeRunCancelRequest", () => {
  const RUN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("accepte un corps minimal", () => {
    assert.deepEqual(parseClaudeRunCancelRequest({ runId: RUN_ID }), { runId: RUN_ID });
  });

  it("refuse un corps sans identifiant", () => {
    assert.equal(parseClaudeRunCancelRequest({}), null);
  });

  it("ignore tout ce qui n'est pas l'identifiant", () => {
    // Aucun PID, aucun signal, aucun delai, aucune option de forcage ne peut
    // entrer : le type de retour n'a qu'un seul champ.
    const parsed = parseClaudeRunCancelRequest({
      runId: RUN_ID,
      pid: 4242,
      signal: "SIGKILL",
      force: true,
      graceMs: 0,
    });

    assert.deepEqual(parsed, { runId: RUN_ID });
  });
});

describe("gardes de reponse", () => {
  const RUN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("accepte un lot d'evenements valide", () => {
    assert.equal(
      isClaudeRunEventsSuccess({
        ok: true,
        events: [EVENT],
        nextSequence: 1,
        status: "RUNNING",
        isFinal: false,
        truncated: false,
      }),
      true,
    );
  });

  it("accepte un lot vide", () => {
    assert.equal(
      isClaudeRunEventsSuccess({
        ok: true,
        events: [],
        nextSequence: 0,
        status: "COMPLETED",
        isFinal: true,
        truncated: false,
      }),
      true,
    );
  });

  it("rejette le lot entier si un seul evenement est hors contrat", () => {
    assert.equal(
      isClaudeRunEventsSuccess({
        ok: true,
        events: [EVENT, { ...EVENT, sequence: 2, kind: "THINKING" }],
        nextSequence: 2,
        status: "RUNNING",
        isFinal: false,
        truncated: false,
      }),
      false,
    );
  });

  it("refuse un statut inconnu", () => {
    assert.equal(
      isClaudeRunEventsSuccess({
        ok: true,
        events: [],
        nextSequence: 0,
        status: "PARTI_EN_VACANCES",
        isFinal: false,
        truncated: false,
      }),
      false,
    );
  });

  it("accepte une annulation acceptee", () => {
    assert.equal(
      isClaudeRunCancelSuccess({
        ok: true,
        run: {
          runId: RUN_ID,
          status: "CANCELLING",
          cancellationRequestedAt: "2026-08-07T10:00:00.000Z",
        },
      }),
      true,
    );
  });

  it("refuse une annulation annoncant un autre statut", () => {
    assert.equal(
      isClaudeRunCancelSuccess({
        ok: true,
        run: {
          runId: RUN_ID,
          status: "CANCELLED",
          cancellationRequestedAt: "2026-08-07T10:00:00.000Z",
        },
      }),
      false,
    );
  });

  it("refuse un identifiant d'execution mal forme", () => {
    assert.equal(
      isClaudeRunCancelSuccess({
        ok: true,
        run: { runId: "pas-un-uuid", status: "CANCELLING", cancellationRequestedAt: "x" },
      }),
      false,
    );
  });
});
