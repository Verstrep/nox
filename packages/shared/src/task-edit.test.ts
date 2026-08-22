/**
 * Qui peut etre edite, et ce que l'edition fait au statut.
 *
 * ## Ce que ce fichier prouve
 *
 * Que le critere du gel est le **passe** de la tache, pas son etat actuel : une
 * tache rouverte apres un echec ressemble a une tache neuve et n'en est pas une.
 *
 * Et qu'une sauvegarde sans modification ne degrade rien. Punir la relecture
 * aurait appris a ne plus relire.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EDITABLE_TASK_STATUSES,
  TASK_EDIT_ERROR,
  TASK_STATUS,
  checkTaskEditable,
  isEditableTaskStatus,
  taskStatusAfterEdit,
} from "../dist/index.js";

describe("eligibilite a l'editeur de tache future", () => {
  it("accepte un brouillon jamais execute", () => {
    assert.deepEqual(checkTaskEditable({ status: TASK_STATUS.DRAFT, runCount: 0 }), { ok: true });
  });

  it("accepte une tache en file jamais executee", () => {
    assert.deepEqual(checkTaskEditable({ status: TASK_STATUS.READY, runCount: 0 }), { ok: true });
  });

  it("gele des la premiere execution", () => {
    const gate = checkTaskEditable({ status: TASK_STATUS.DRAFT, runCount: 1 });
    assert.equal(gate.ok, false);
    assert.equal(gate.ok === false && gate.code, TASK_EDIT_ERROR.FROZEN);
  });

  it("gele une tache rouverte, malgre son statut de tache neuve", () => {
    // C'est le cas que le critere « statut » aurait laisse passer : `READY`
    // apres un `Reopen`, avec tout un historique derriere.
    const gate = checkTaskEditable({ status: TASK_STATUS.READY, runCount: 3 });
    assert.equal(gate.ok, false);
    assert.equal(gate.ok === false && gate.code, TASK_EDIT_ERROR.FROZEN);
  });

  it("verifie le gel avant le statut", () => {
    // Une tache terminee avec un historique : le refus utile est « figee », pas
    // « statut non editable ». Ce qui l'empeche est son passe.
    const gate = checkTaskEditable({ status: TASK_STATUS.COMPLETED, runCount: 2 });
    assert.equal(gate.ok === false && gate.code, TASK_EDIT_ERROR.FROZEN);
  });

  it("refuse les statuts d'apres-execution meme sans historique", () => {
    for (const status of [
      TASK_STATUS.RUNNING,
      TASK_STATUS.REVIEW,
      TASK_STATUS.FAILED,
      TASK_STATUS.COMPLETED,
      TASK_STATUS.BLOCKED,
    ]) {
      const gate = checkTaskEditable({ status, runCount: 0 });
      assert.equal(gate.ok, false, status);
      assert.equal(
        gate.ok === false && gate.code,
        TASK_EDIT_ERROR.STATUS_NOT_EDITABLE,
        status,
      );
    }
  });

  it("n'ouvre l'editeur qu'a deux statuts", () => {
    assert.deepEqual([...EDITABLE_TASK_STATUSES], [TASK_STATUS.DRAFT, TASK_STATUS.READY]);
    assert.equal(isEditableTaskStatus(TASK_STATUS.DRAFT), true);
    assert.equal(isEditableTaskStatus(TASK_STATUS.BLOCKED), false);
  });
});

describe("statut apres edition", () => {
  it("ramene une tache en file au brouillon quand le contrat change", () => {
    // `READY` est une validation humaine ; si le contenu bouge, elle ne porte
    // plus sur rien.
    assert.equal(taskStatusAfterEdit(TASK_STATUS.READY, true), TASK_STATUS.DRAFT);
  });

  it("laisse une tache en file intacte quand rien ne change", () => {
    assert.equal(taskStatusAfterEdit(TASK_STATUS.READY, false), TASK_STATUS.READY);
  });

  it("laisse un brouillon en brouillon dans les deux cas", () => {
    assert.equal(taskStatusAfterEdit(TASK_STATUS.DRAFT, true), TASK_STATUS.DRAFT);
    assert.equal(taskStatusAfterEdit(TASK_STATUS.DRAFT, false), TASK_STATUS.DRAFT);
  });
});
