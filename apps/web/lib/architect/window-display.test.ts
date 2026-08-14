/**
 * Tests de la description de la fenetre dans l'apercu.
 *
 * L'enjeu tient en une phrase : ce qui part et ce qui reste doivent se lire
 * separement. Une conversation dont on dirait « 18 tours sur 54 » laisserait
 * croire qu'un morceau a disparu, alors qu'il est intact en base et affiche
 * quelques centimetres plus haut.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeStoredTurns, describeTranscriptWindow } from "./window-display.ts";
import type { TranscriptWindow } from "./window.ts";

function window(overrides: Partial<TranscriptWindow> = {}): TranscriptWindow {
  return {
    messages: [],
    includedTurns: 0,
    omittedTurns: 0,
    omittedMessages: 0,
    chars: 0,
    ...overrides,
  };
}

describe("describeTranscriptWindow", () => {
  it("dit qu'aucun tour ne precede", () => {
    assert.equal(describeTranscriptWindow(window()), "aucun tour precedent");
  });

  it("dit que toute la conversation part quand rien n'est ecarte", () => {
    assert.equal(
      describeTranscriptWindow(window({ includedTurns: 4 })),
      "4 tours, soit toute la conversation",
    );
    assert.equal(
      describeTranscriptWindow(window({ includedTurns: 1 })),
      "1 tour, soit toute la conversation",
    );
  });

  it("dit que seuls les plus recents partent quand des tours sont ecartes", () => {
    assert.equal(
      describeTranscriptWindow(window({ includedTurns: 18, omittedTurns: 36 })),
      "18 tours les plus recents",
    );
    assert.equal(
      describeTranscriptWindow(window({ includedTurns: 1, omittedTurns: 3 })),
      "1 tour, le plus recent",
    );
  });
});

describe("describeStoredTurns", () => {
  it("compte les tours et les messages conserves", () => {
    assert.equal(
      describeStoredTurns(window({ omittedTurns: 36, omittedMessages: 72 })),
      "36 tours plus anciens (72 messages)",
    );
  });

  it("accorde le singulier", () => {
    assert.equal(
      describeStoredTurns(window({ omittedTurns: 1, omittedMessages: 1 })),
      "1 tour plus ancien (1 message)",
    );
  });
});
