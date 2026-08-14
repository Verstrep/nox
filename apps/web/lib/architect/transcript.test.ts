/**
 * Tests du transcript local.
 *
 * La garantie centrale : **rien n'est ecarte**. Aucune fenetre glissante, aucun
 * resume, aucun message silencieusement laisse de cote. Quand la borne est
 * atteinte, c'est le service qui refuse — jamais ce module qui oublie.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  ArchitectGenerationView,
  ArchitectMessageView,
  ArchitectSessionView,
} from "@nox/database";
import type { ArchitectTaskProposal } from "@nox/shared";

import { architectTranscript } from "./transcript.ts";

const PROPOSAL: ArchitectTaskProposal = {
  schemaVersion: 1,
  status: "PROPOSAL_READY",
  title: "Exporter les taches",
  priority: "MEDIUM",
  objective: "Un objectif.",
  context: null,
  acceptanceCriteria: ["Un critere."],
  outOfScope: [],
  documentReferences: [],
  validationCommands: [],
  assumptions: [],
  questions: [],
};

function message(overrides: Partial<ArchitectMessageView> = {}): ArchitectMessageView {
  return {
    id: "m1",
    sequence: 1,
    role: "USER",
    content: "Un message.",
    generationId: null,
    createdAt: "2026-08-10T09:00:00.000Z",
    ...overrides,
  };
}

function generation(overrides: Partial<ArchitectGenerationView> = {}): ArchitectGenerationView {
  return {
    id: "g1",
    sessionId: "s1",
    sequence: 1,
    model: "modele",
    promptVersion: "architect/2",
    inputHash: "a".repeat(64),
    status: "PROPOSAL_READY",
    turnState: "PROPOSAL_READY",
    contextFingerprint: "f".repeat(64),
    manifest: null,
    proposal: PROPOSAL,
    questions: [],
    providerResponseId: null,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null },
    errorCode: null,
    appliedTaskId: null,
    createdAt: "2026-08-10T09:00:00.000Z",
    ...overrides,
  };
}

function session(
  messages: ArchitectMessageView[],
  generations: ArchitectGenerationView[] = [],
): ArchitectSessionView {
  return {
    id: "s1",
    projectId: "p1",
    code: "ARCH-001",
    requestText: "Une demande.",
    clarificationText: null,
    status: "CONTINUE",
    kind: "TASK_DESIGN_LEGACY",
    conversationVersion: 2,
    conversational: true,
    appliedTaskId: null,
    generationCount: generations.length,
    generationsLeft: 20 - generations.length,
    pendingTurn: null,
    createdAt: "2026-08-10T09:00:00.000Z",
    updatedAt: "2026-08-10T09:00:00.000Z",
    generations,
    messages,
  };
}

describe("architectTranscript", () => {
  it("rend les messages du plus ancien au plus recent", () => {
    const transcript = architectTranscript(
      session([
        message({ id: "m1", sequence: 1, content: "Premier." }),
        message({ id: "m2", sequence: 2, role: "ARCHITECT", content: "Deuxieme." }),
        message({ id: "m3", sequence: 3, content: "Troisieme." }),
      ]),
    );

    assert.deepEqual(
      transcript.map((entry) => [entry.role, entry.content]),
      [
        ["USER", "Premier."],
        ["ARCHITECT", "Deuxieme."],
        ["USER", "Troisieme."],
      ],
    );
  });

  it("n'ecarte aucun message, quelle que soit leur nombre", () => {
    // Une decision prise au deuxieme message peut etre essentielle au
    // quinzieme : une fenetre glissante invisible fabriquerait une memoire
    // fictive.
    const messages = Array.from({ length: 40 }, (_unused, index) =>
      message({ id: `m${String(index)}`, sequence: index + 1, content: `Message ${String(index)}.` }),
    );
    assert.equal(architectTranscript(session(messages)).length, 40);
  });

  it("attache la proposition du tour a la reponse qui la portait", () => {
    const transcript = architectTranscript(
      session(
        [
          message({ id: "m1", sequence: 1, generationId: "g1" }),
          message({ id: "m2", sequence: 2, role: "ARCHITECT", generationId: "g1" }),
        ],
        [generation()],
      ),
    );

    assert.equal(transcript[0]?.proposal, null);
    assert.equal(transcript[1]?.proposal?.title, "Exporter les taches");
  });

  it("laisse une reponse sans proposition telle quelle", () => {
    const transcript = architectTranscript(
      session(
        [message({ id: "m1", sequence: 1, role: "ARCHITECT", generationId: "g1" })],
        [generation({ status: "CONTINUE", turnState: "CONTINUE", proposal: null })],
      ),
    );
    assert.equal(transcript[0]?.proposal, null);
  });

  it("reste vide sur une conversation sans tour", () => {
    assert.deepEqual(architectTranscript(session([])), []);
  });
});
