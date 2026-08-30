/**
 * La cible relue par un humain.
 *
 * Ce que ce fichier protege est une **inclusion stricte** : la revue d'un
 * changement de projet n'accepte rien que l'editeur de tache future refuserait.
 * Si elle acceptait davantage, elle deviendrait le chemin par lequel on
 * contourne l'editeur — et le contournement serait invisible.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COMMAND_EXECUTION_MODE, TASK_PRIORITY, VERIFICATION_MODE } from "@nox/shared";
import type { TaskEditSnapshot } from "@nox/database";

import {
  proposalToReviewItems,
  readReplanTargetSubmission,
  replanAppliedJson,
  snapshotToFormValues,
  type ReplanReviewItem,
} from "./target.ts";

const KNOWN = new Set(["id-006", "id-007", "id-003"]);

function item(overrides: Partial<ReplanReviewItem> = {}): ReplanReviewItem {
  return {
    uid: "u1",
    existingTaskId: "id-006",
    tempId: null,
    code: "TASK-006",
    values: {
      title: "Partager une liste par lien",
      priority: TASK_PRIORITY.MEDIUM,
      objective: "Permettre le partage par lien.",
      context: "",
      outOfScope: "",
      documents: "",
      criteria: [
        {
          key: "c0",
          text: "Le lien ouvre la liste.",
          verificationMode: VERIFICATION_MODE.HUMAN,
          humanInstructions: "Ouvrir le lien.",
          commandKeys: [],
        },
      ],
      commands: [],
      dependsOnTaskIds: [],
    },
    dependsOn: [],
    ...overrides,
  };
}

describe("identite d'un element", () => {
  it("refuse un element qui se declare des deux facons", () => {
    const result = readReplanTargetSubmission([item({ tempId: "N1" })], KNOWN);
    assert.equal(result.ok, false);
  });

  it("refuse un element qui ne se declare d'aucune facon", () => {
    const result = readReplanTargetSubmission([item({ existingTaskId: null })], KNOWN);
    assert.equal(result.ok, false);
  });

  it("accepte une tache existante et une tache nouvelle", () => {
    const result = readReplanTargetSubmission(
      [item(), item({ uid: "u2", existingTaskId: null, tempId: "N1", code: null })],
      KNOWN,
    );
    assert.ok(result.ok);
    assert.deepEqual(
      result.items.map((entry) => entry.existingTaskId ?? entry.tempId),
      ["id-006", "N1"],
    );
  });
});

describe("contrat de chaque element", () => {
  it("passe exactement par le validateur de l'editeur de tache future", () => {
    const result = readReplanTargetSubmission(
      [item({ values: { ...item().values, title: "" } })],
      KNOWN,
    );
    assert.equal(result.ok, false);
  });

  it("refuse une commande que l'editeur normal refuserait", () => {
    // Une commande chainee n'est pas autorisable : la revue ne doit pas offrir
    // une porte que l'editeur ferme.
    const result = readReplanTargetSubmission(
      [
        item({
          values: {
            ...item().values,
            commands: [
              {
                key: "v0",
                command: "npm run test && rm -rf .",
                executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY,
              },
            ],
          },
        }),
      ],
      KNOWN,
    );
    assert.equal(result.ok, false);
  });

  it("conserve le mode d'execution choisi par l'humain", () => {
    const result = readReplanTargetSubmission(
      [
        item({
          values: {
            ...item().values,
            commands: [
              {
                key: "v0",
                command: "npm run test",
                executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS,
              },
            ],
            criteria: [
              {
                key: "c0",
                text: "Les tests passent.",
                verificationMode: VERIFICATION_MODE.AUTOMATED,
                humanInstructions: "",
                commandKeys: ["v0"],
              },
            ],
          },
        }),
      ],
      KNOWN,
    );

    assert.ok(result.ok);
    assert.equal(
      result.items[0]?.values.validationCommands[0]?.executionMode,
      COMMAND_EXECUTION_MODE.AUTONOMOUS,
    );
    assert.deepEqual(result.items[0]?.values.acceptanceCriteria[0]?.commandPositions, [0]);
  });
});

describe("dependances", () => {
  it("separe les taches existantes des taches nouvelles du meme lot", () => {
    const result = readReplanTargetSubmission(
      [
        item({ uid: "u1", existingTaskId: null, tempId: "N1", code: null }),
        item({ uid: "u2", dependsOn: ["id-003", "N1", "id-003"] }),
      ],
      KNOWN,
    );

    assert.ok(result.ok);
    assert.deepEqual(result.items[1]?.dependsOnTaskIds, ["id-003"]);
    assert.deepEqual(result.items[1]?.dependsOnTempIds, ["N1"]);
  });

  it("refuse une reference que le projet ne porte pas", () => {
    const result = readReplanTargetSubmission([item({ dependsOn: ["id-inconnue"] })], KNOWN);
    assert.equal(result.ok, false);
  });

  it("ignore une reference vide plutot que d'en faire une erreur", () => {
    const result = readReplanTargetSubmission([item({ dependsOn: ["", "   "] })], KNOWN);
    assert.ok(result.ok);
    assert.deepEqual(result.items[0]?.dependsOnTaskIds, []);
  });
});

describe("aller-retour d'un contrat", () => {
  it("rend un contrat enregistre puis le relit a l'identique", () => {
    const snapshot: TaskEditSnapshot = {
      title: "Partager une liste",
      objective: "Permettre le partage.",
      context: "Le contexte.",
      outOfScope: "Pas d'export.",
      priority: TASK_PRIORITY.HIGH,
      acceptanceCriteria: [
        {
          text: "Les tests passent.",
          verificationMode: VERIFICATION_MODE.AUTOMATED,
          humanInstructions: null,
          commandPositions: [0],
        },
      ],
      documentReferences: ["docs/ARCHITECTURE.md"],
      validationCommands: [
        { command: "npm run test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
      ],
      dependsOnTaskIds: [],
    };

    const values = snapshotToFormValues(snapshot, "t0");
    const result = readReplanTargetSubmission([item({ values })], KNOWN);

    assert.ok(result.ok);
    assert.deepEqual(result.items[0]?.values, snapshot);
  });
});

describe("proposition du fournisseur", () => {
  it("devient une liste d'elements editables, avec les codes connus", () => {
    const items = proposalToReviewItems(
      {
        schemaVersion: 1,
        mode: "PROPOSED",
        rationale: "Le perimetre change.",
        futureTasks: [
          {
            existingTaskId: "id-006",
            tempId: null,
            title: "Partager",
            priority: TASK_PRIORITY.MEDIUM,
            objective: "Permettre le partage.",
            context: null,
            acceptanceCriteria: [],
            outOfScope: ["Pas d'export"],
            documentReferences: [],
            validationCommands: [],
            dependsOnTaskIds: ["id-003"],
            dependsOnTempIds: [],
          },
        ],
      },
      new Map([["id-006", "TASK-006"]]),
    );

    assert.equal(items[0]?.code, "TASK-006");
    assert.equal(items[0]?.values.outOfScope, "Pas d'export");
    assert.deepEqual(items[0]?.dependsOn, ["id-003"]);
  });
});

describe("cible appliquee", () => {
  it("conserve les taches supprimees, avec leur contrat d'alors", () => {
    // Une tache disparue de la base doit rester racontable : sans cela, la
    // decision serait appliquee et introuvable.
    const result = readReplanTargetSubmission([item()], KNOWN);
    assert.ok(result.ok);

    const json: unknown = JSON.parse(
      replanAppliedJson({
        rationale: "Le perimetre change.",
        items: result.items,
        removed: [
          {
            taskId: "id-007",
            code: "TASK-007",
            title: "Export PDF",
            contract: snapshotToFormValues as unknown as TaskEditSnapshot,
          },
        ],
      }),
    );

    const record = json as { removedTasks: { code: string }[]; futureTasks: { planningOrder: number }[] };
    assert.deepEqual(
      record.removedTasks.map((task) => task.code),
      ["TASK-007"],
    );
    // L'ordre applique est celui de l'ecran, enregistre position par position.
    assert.equal(record.futureTasks[0]?.planningOrder, 0);
  });
});
