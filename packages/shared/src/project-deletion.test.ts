/**
 * Semantique de la suppression d'un projet.
 *
 * ## Ce que ce fichier protege
 *
 * La confirmation par recopie du nom : ni casse, ni accents, ni « a peu pres ».
 * Recopier exactement est ce qui distingue un geste delibere d'un clic, et une
 * comparaison indulgente reduirait cette protection a une decoration.
 *
 * Et le classement des issues : « retire », « retire alors qu'il avait
 * diverge », « deja absent » et « refuse » sont quatre faits distincts. Les
 * confondre ferait annoncer une suppression complete apres un nettoyage
 * partiel — precisement l'etat que TASK-025 existe pour rendre impossible.
 *
 * Pur : ni base, ni disque, ni reseau.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TASK_ARTIFACT_OUTCOME,
  countModifiedArtifacts,
  countRemovedArtifacts,
  hasRefusedArtifact,
  projectDeletionConfirmed,
  type TaskArtifactReport,
} from "../dist/index.js";

function report(
  taskCode: string,
  outcome: TaskArtifactReport["outcome"],
): TaskArtifactReport {
  return { taskCode, path: `tasks/${taskCode}.md`, outcome };
}

describe("projectDeletionConfirmed", () => {
  it("accepte le nom exact", () => {
    assert.equal(projectDeletionConfirmed("Meal Planner", "Meal Planner"), true);
  });

  it("tolere les espaces autour, et rien d'autre", () => {
    assert.equal(projectDeletionConfirmed("Meal Planner", "  Meal Planner  "), true);
    assert.equal(projectDeletionConfirmed("Meal Planner", "Meal  Planner"), false);
  });

  it("refuse une casse differente", () => {
    // Une comparaison insensible a la casse rendrait la recopie machinale : le
    // but est de faire lire ce qu'on supprime.
    assert.equal(projectDeletionConfirmed("Meal Planner", "meal planner"), false);
  });

  it("refuse une variante d'accents", () => {
    assert.equal(projectDeletionConfirmed("Recettes d'été", "Recettes d'ete"), false);
  });

  it("refuse une chaine vide, meme face a un nom vide", () => {
    assert.equal(projectDeletionConfirmed("Meal Planner", ""), false);
    // Un projet sans nom ne doit pas devenir supprimable d'un champ laisse vide.
    assert.equal(projectDeletionConfirmed("   ", ""), false);
  });

  it("refuse un prefixe ou un suffixe", () => {
    assert.equal(projectDeletionConfirmed("Meal Planner", "Meal"), false);
    assert.equal(projectDeletionConfirmed("Meal Planner", "Meal Planner 2"), false);
  });
});

describe("classement des artefacts", () => {
  const reports: TaskArtifactReport[] = [
    report("TASK-000", TASK_ARTIFACT_OUTCOME.REMOVED),
    report("TASK-001", TASK_ARTIFACT_OUTCOME.REMOVED_MODIFIED),
    report("TASK-002", TASK_ARTIFACT_OUTCOME.ABSENT),
  ];

  it("compte comme retires les documents divergents", () => {
    // Un document modifie a la main **a** ete retire : le compter a part sert a
    // le dire, pas a l'exclure du total.
    assert.equal(countRemovedArtifacts(reports), 2);
    assert.equal(countModifiedArtifacts(reports), 1);
  });

  it("ne compte pas un document deja absent", () => {
    assert.equal(countRemovedArtifacts([report("TASK-003", TASK_ARTIFACT_OUTCOME.ABSENT)]), 0);
  });

  it("ne voit aucun refus quand tout s'est bien passe", () => {
    assert.equal(hasRefusedArtifact(reports), false);
  });

  it("voit un refus des qu'un seul document a resiste", () => {
    assert.equal(
      hasRefusedArtifact([...reports, report("TASK-004", TASK_ARTIFACT_OUTCOME.REFUSED)]),
      true,
    );
  });

  it("ne voit aucun refus dans une liste vide", () => {
    // Un projet sans artefact n'est pas un projet dont le nettoyage a echoue.
    assert.equal(hasRefusedArtifact([]), false);
    assert.equal(countRemovedArtifacts([]), 0);
  });
});
