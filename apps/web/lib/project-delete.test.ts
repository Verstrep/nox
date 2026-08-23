/**
 * Logique de la suppression d'un projet.
 *
 * ## Ce que ce fichier protege
 *
 * L'ordre des refus : la confirmation d'abord, l'execution active ensuite. Un
 * utilisateur qui a mal recopie le nom ne doit pas apprendre qu'une execution
 * tourne — il corrigerait la mauvaise chose, et croirait le nom bon.
 *
 * Le fait qu'un artefact refuse **annule** la suppression : l'issue dangereuse
 * serait un projet efface de la base et des documents laisses derriere lui, que
 * plus rien ne rattacherait a quoi que ce soit.
 *
 * Et le contenu des textes affiches : ce que NOX retire et ce qu'il preserve
 * doivent etre lisibles avant le clic, pas apres.
 *
 * Pur : ni base, ni disque, ni reseau.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TASK_ARTIFACT_OUTCOME, type TaskArtifactReport } from "@nox/shared";

import {
  PROJECT_ACTIVE_RUN_MESSAGE,
  PROJECT_CONFIRMATION_MISMATCH_MESSAGE,
  PROJECT_DELETE_IRREVERSIBLE_NOTICE,
  PROJECT_DELETE_NO_GIT_NOTICE,
  PROJECT_DELETE_PRESERVES,
  PROJECT_DELETE_REMOVES,
  artifactCleanupRefusedMessage,
  checkProjectDeletion,
  projectDeletedNotice,
  projectSettingsUrl,
  readDeletedCount,
} from "./project-delete.ts";

function report(
  taskCode: string,
  outcome: TaskArtifactReport["outcome"],
): TaskArtifactReport {
  return { taskCode, path: `tasks/${taskCode}.md`, outcome };
}

describe("checkProjectDeletion", () => {
  it("accepte un nom exact sans execution active", () => {
    const check = checkProjectDeletion(
      { projectName: "Meal Planner", hasActiveRun: false },
      "Meal Planner",
    );
    assert.deepEqual(check, { ok: true });
  });

  it("refuse un nom qui ne correspond pas", () => {
    const check = checkProjectDeletion(
      { projectName: "Meal Planner", hasActiveRun: false },
      "meal planner",
    );
    assert.equal(check.ok, false);
    assert.equal(check.ok === false && check.message, PROJECT_CONFIRMATION_MISMATCH_MESSAGE);
  });

  it("refuse une execution active, une fois le nom confirme", () => {
    const check = checkProjectDeletion(
      { projectName: "Meal Planner", hasActiveRun: true },
      "Meal Planner",
    );
    assert.equal(check.ok, false);
    assert.equal(check.ok === false && check.message, PROJECT_ACTIVE_RUN_MESSAGE);
  });

  it("parle du nom avant de parler de l'execution", () => {
    // Les deux problemes coexistent : c'est celui que l'utilisateur peut
    // corriger tout de suite qui doit etre nomme en premier.
    const check = checkProjectDeletion(
      { projectName: "Meal Planner", hasActiveRun: true },
      "autre chose",
    );
    assert.equal(check.ok === false && check.message, PROJECT_CONFIRMATION_MISMATCH_MESSAGE);
  });
});

describe("artifactCleanupRefusedMessage", () => {
  it("nomme les documents qui ont resiste", () => {
    const message = artifactCleanupRefusedMessage([
      report("TASK-000", TASK_ARTIFACT_OUTCOME.REMOVED),
      report("TASK-001", TASK_ARTIFACT_OUTCOME.REFUSED),
    ]);

    assert.ok(message.includes("tasks/TASK-001.md"));
    // Le document retire n'apparait pas : le message parle de ce qui bloque.
    assert.ok(!message.includes("tasks/TASK-000.md"));
    assert.ok(message.includes("n'a donc pas été supprimé"));
  });

  it("accorde le pluriel", () => {
    const message = artifactCleanupRefusedMessage([
      report("TASK-001", TASK_ARTIFACT_OUTCOME.REFUSED),
      report("TASK-002", TASK_ARTIFACT_OUTCOME.REFUSED),
    ]);
    assert.ok(message.includes("les documents"));
  });
});

describe("projectDeletedNotice", () => {
  it("dit la preservation du repository, meme sans artefact retire", () => {
    const notice = projectDeletedNotice(0, 0);
    assert.ok(notice.includes("Project deleted from NOX"));
    assert.ok(notice.includes("préservés"));
    // Annoncer « 0 document nettoyé » ferait douter de la preservation.
    assert.ok(!notice.includes("0 document"));
  });

  it("compte les documents retires", () => {
    assert.ok(projectDeletedNotice(1, 0).includes("1 document de tâche"));
    assert.ok(projectDeletedNotice(3, 0).includes("3 documents de tâche"));
  });

  it("signale les documents qui avaient divergé", () => {
    const notice = projectDeletedNotice(3, 2);
    assert.ok(notice.includes("modifiés à la main"));
    assert.ok(notice.includes("explicitement confirmée"));
  });

  it("n'evoque pas de divergence quand il n'y en a pas", () => {
    assert.ok(!projectDeletedNotice(2, 0).includes("à la main"));
  });
});

describe("readDeletedCount", () => {
  it("lit un entier positif", () => {
    assert.equal(readDeletedCount("3"), 3);
  });

  it("rend zero pour tout le reste", () => {
    // Un lien errone ou forge ne doit produire ni page d'erreur, ni chiffre
    // invente.
    for (const value of [undefined, "", "0", "-2", "1.5", "beaucoup", "99999", ["2"]]) {
      assert.equal(readDeletedCount(value as string | string[] | undefined), 0, String(value));
    }
  });
});

describe("textes de la Danger Zone", () => {
  it("annonce ce que NOX retire", () => {
    const text = PROJECT_DELETE_REMOVES.join(" ");
    assert.ok(text.includes("conversation Architecte"));
    assert.ok(text.includes("tasks/TASK-xxx.md"));
  });

  it("annonce ce que NOX ne touche pas, avec la meme insistance", () => {
    const text = PROJECT_DELETE_PRESERVES.join(" ");
    assert.ok(text.includes("code source"));
    assert.ok(text.includes(".git"));
    assert.ok(text.includes("docs/"));
  });

  it("dit qu'aucune operation Git n'a lieu", () => {
    assert.ok(PROJECT_DELETE_NO_GIT_NOTICE.includes("Aucun commit"));
    assert.ok(PROJECT_DELETE_NO_GIT_NOTICE.includes("push"));
    assert.ok(PROJECT_DELETE_NO_GIT_NOTICE.includes("restore"));
  });

  it("dit que rien n'est reconstruit apres un reenregistrement", () => {
    assert.ok(PROJECT_DELETE_IRREVERSIBLE_NOTICE.includes("irréversible"));
    assert.ok(PROJECT_DELETE_IRREVERSIBLE_NOTICE.includes("ne seront pas reconstruits"));
  });
});

describe("projectSettingsUrl", () => {
  it("mene aux reglages du projet", () => {
    assert.equal(projectSettingsUrl("projet-1"), "/projects/projet-1/settings");
  });
});
