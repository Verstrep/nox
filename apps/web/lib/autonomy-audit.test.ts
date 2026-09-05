/**
 * Ce que l'historique permet de distinguer, apres TASK-033.
 *
 * ## La question a laquelle ce fichier repond
 *
 * Une seule : dans six mois, en relisant la base, saura-t-on **qui** a decide
 * quoi ? Un workflow qui gagne en autonomie perd sa valeur si ses decisions
 * deviennent indiscernables les unes des autres — « la tache est terminee » ne
 * dit rien si personne ne peut savoir si un humain l'a acceptee, si NOX l'a
 * conclue sur preuves, ou si quelqu'un est passe en force.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il n'ajoute aucune table de journal. Chaque distinction ci-dessous existait
 * deja, sauf une — le rafraichissement de verification, qui est un evenement
 * nouveau et n'avait donc nulle part ou s'ecrire. Une migration purement
 * additive pour une information reellement necessaire, et rien de decoratif.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DELIVERY_STATUS,
  DELIVERY_TRIGGER,
  REVIEW_DECISION_SOURCE,
  REVIEW_DECISION_SOURCES,
  VERIFICATION_REFRESH_STATUS,
  VERIFICATION_REFRESH_STATUSES,
} from "@nox/shared";

describe("chaque decision automatique reste distinguable", () => {
  it("separe l'acceptation humaine de la completion automatique", () => {
    // Ecrire « approuve par l'utilisateur » quand personne n'a clique serait un
    // mensonge dans l'historique. Ces trois valeurs repondent a trois questions
    // differentes, et aucune n'est un fourre-tout.
    assert.deepEqual([...REVIEW_DECISION_SOURCES].sort(), [
      REVIEW_DECISION_SOURCE.AUTOMATED,
      REVIEW_DECISION_SOURCE.HUMAN,
      REVIEW_DECISION_SOURCE.HUMAN_OVERRIDE,
    ]);
    assert.equal(new Set(REVIEW_DECISION_SOURCES).size, REVIEW_DECISION_SOURCES.length);
  });

  it("separe une livraison decidee par la politique d'une livraison decidee a la main", () => {
    assert.notEqual(DELIVERY_TRIGGER.AUTOMATIC, DELIVERY_TRIGGER.MANUAL);
  });

  it("separe un commit local d'une livraison poussee, et d'un echec", () => {
    // `AUTO_COMMIT` s'arrete a `COMMITTED` ; `AUTO_COMMIT_PUSH` va jusqu'a
    // `DELIVERED`. Les confondre ferait croire qu'un travail est parti alors
    // qu'il n'a jamais quitte la machine.
    const distinct = new Set([
      DELIVERY_STATUS.COMMITTED,
      DELIVERY_STATUS.DELIVERED,
      DELIVERY_STATUS.FAILED,
      DELIVERY_STATUS.BLOCKED,
      DELIVERY_STATUS.PENDING,
    ]);
    assert.equal(distinct.size, 5);
  });

  it("separe les quatre issues d'un rafraichissement de verification", () => {
    // « applique », « rien a changer », « refuse » et « n'a pas abouti » sont
    // quatre faits differents, et le seul qui ait ecrit quelque chose est le
    // premier. `STALE` en est un cinquieme : l'appel a eu lieu, il a coute, et
    // le plan avait bouge entre-temps.
    assert.deepEqual([...VERIFICATION_REFRESH_STATUSES].sort(), [
      VERIFICATION_REFRESH_STATUS.APPLIED,
      VERIFICATION_REFRESH_STATUS.FAILED,
      VERIFICATION_REFRESH_STATUS.NO_CHANGE,
      VERIFICATION_REFRESH_STATUS.REFUSED,
      VERIFICATION_REFRESH_STATUS.RUNNING,
      VERIFICATION_REFRESH_STATUS.STALE,
    ]);
    assert.equal(
      new Set(VERIFICATION_REFRESH_STATUSES).size,
      VERIFICATION_REFRESH_STATUSES.length,
    );
  });
});
