import { RUN_STATUS, RUN_STATUSES } from "@nox/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANCELLED_NOTICE,
  CANCEL_WARNING,
  checkRunCancellation,
  describeCancelRefusal,
} from "./run-cancel.ts";

describe("checkRunCancellation", () => {
  it("autorise l'arret d'une execution en file", () => {
    assert.deepEqual(checkRunCancellation(RUN_STATUS.QUEUED), { ok: true });
  });

  it("autorise l'arret d'une execution en cours", () => {
    assert.deepEqual(checkRunCancellation(RUN_STATUS.RUNNING), { ok: true });
  });

  it("distingue un arret deja engage d'une execution terminee", () => {
    assert.deepEqual(checkRunCancellation(RUN_STATUS.CANCELLING), {
      ok: false,
      reason: "already_cancelling",
    });
  });

  it("refuse toutes les executions terminees", () => {
    for (const status of [
      RUN_STATUS.COMPLETED,
      RUN_STATUS.FAILED,
      RUN_STATUS.BLOCKED,
      RUN_STATUS.CANCELLED,
    ]) {
      assert.deepEqual(checkRunCancellation(status), { ok: false, reason: "already_final" });
    }
  });

  it("traite tous les statuts du contrat", () => {
    // Un statut ajoute plus tard sans decision explicite tomberait ici.
    for (const status of RUN_STATUSES) {
      assert.doesNotThrow(() => checkRunCancellation(status));
    }
  });
});

describe("messages d'annulation", () => {
  it("explique un refus tardif", () => {
    const message = describeCancelRefusal("already_final");
    assert.equal(message.includes("deja terminee"), true);
  });

  it("explique un arret deja engage", () => {
    const message = describeCancelRefusal("already_cancelling");
    assert.equal(message.includes("deja engage"), true);
  });

  it("avertit que rien ne sera restaure", () => {
    assert.equal(CANCEL_WARNING.includes("restaurera aucun fichier"), true);
  });

  it("renvoie vers Git apres une annulation", () => {
    assert.equal(CANCELLED_NOTICE.includes("git status"), true);
    assert.equal(CANCELLED_NOTICE.includes("git diff"), true);
  });

  it("ne promet jamais une restauration", () => {
    for (const message of [CANCEL_WARNING, CANCELLED_NOTICE]) {
      assert.equal(/restaur\w+ automatiquement les fichiers/i.test(message), false);
      assert.equal(message.includes("git reset"), false);
      assert.equal(message.includes("git restore"), false);
    }
  });
});
