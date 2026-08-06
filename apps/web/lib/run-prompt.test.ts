import type { DevelopmentTaskDetail } from "@nox/shared";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { buildExecutionPrompt, fingerprintPrompt } from "./run-prompt.ts";

const TASK: DevelopmentTaskDetail = {
  id: "t1",
  projectId: "p1",
  code: "TASK-012",
  title: "Ajouter la gestion des projets",
  status: "READY",
  priority: "HIGH",
  documentSyncStatus: "SYNCED",
  createdAt: "2026-08-06T10:00:00.000Z",
  updatedAt: "2026-08-06T10:00:00.000Z",
  objective: "Permettre d'enregistrer un repository local.",
  context: "NOX possede un tableau de bord statique.",
  outOfScope: "- Suppression de projet.",
  acceptanceCriteria: ["Un projet peut etre cree."],
  documentReferences: ["docs/ARCHITECTURE.md"],
  validationCommands: ["npm run test"],
  documentPath: "tasks/TASK-012.md",
  documentRevision: "a".repeat(64),
  documentSyncError: null,
};

describe("fingerprintPrompt", () => {
  it("calcule un SHA-256 hexadecimal minuscule", () => {
    const fingerprint = fingerprintPrompt("bonjour");

    assert.match(fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(fingerprint, createHash("sha256").update("bonjour", "utf8").digest("hex"));
  });

  it("distingue deux prompts differents", () => {
    assert.notEqual(fingerprintPrompt("a"), fingerprintPrompt("b"));
  });

  it("porte sur les octets UTF-8", () => {
    assert.equal(
      fingerprintPrompt("é"),
      createHash("sha256").update(Buffer.from("é", "utf8")).digest("hex"),
    );
  });
});

describe("buildExecutionPrompt", () => {
  it("produit un prompt et son empreinte coherents", () => {
    const built = buildExecutionPrompt(TASK);

    assert.ok(built.prompt.includes("TASK-012"));
    assert.equal(built.sha256, fingerprintPrompt(built.prompt));
  });

  it("est deterministe", () => {
    const first = buildExecutionPrompt(TASK);
    const second = buildExecutionPrompt({ ...TASK });

    assert.equal(first.prompt, second.prompt);
    assert.equal(first.sha256, second.sha256);
  });

  it("ne depend pas des champs mutables de la tache", () => {
    // Le statut et la priorite changent sans que la specification change : le
    // prompt doit rester identique, sans quoi une execution ne serait pas
    // reproductible.
    const other = buildExecutionPrompt({ ...TASK, status: "RUNNING", priority: "LOW" });

    assert.equal(other.sha256, buildExecutionPrompt(TASK).sha256);
  });

  it("change des que la specification change", () => {
    const other = buildExecutionPrompt({ ...TASK, objective: "Un autre objectif." });

    assert.notEqual(other.sha256, buildExecutionPrompt(TASK).sha256);
  });

  it("reference le document de la tache", () => {
    assert.ok(buildExecutionPrompt(TASK).prompt.includes("tasks/TASK-012.md"));
  });
});
