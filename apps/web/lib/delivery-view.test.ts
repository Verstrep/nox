/**
 * Tests des actions derivees de la surface de livraison.
 *
 * ## Ce que ces tests protegent
 *
 * Qu'un bouton `Commit` ne soit jamais propose sur un travail deja commite —
 * cliquer creerait un second commit —, et qu'un `Retry push` reste disponible
 * exactement la ou il a un sens.
 *
 * ## Ce qu'ils ne protegent pas, et c'est voulu
 *
 * Rien pour la securite. Un bouton cache est une commodite d'affichage ; la
 * Server Action revalide toutes les conditions, et le runner les revalide encore
 * avant d'appeler Git. Ce calcul sert a ne pas afficher une action qui ne
 * pourrait rien faire.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DELIVERY_POLICY, DELIVERY_STATUS, DELIVERY_TRIGGER } from "@nox/shared";
import type { GitDeliveryRow } from "@nox/database";

import { deriveDeliveryActions } from "./delivery-view.ts";

function delivery(overrides: Partial<GitDeliveryRow> = {}): GitDeliveryRow {
  return {
    id: "d1",
    projectId: "p1",
    taskId: "t1",
    sourceRunId: "r1",
    sourceDecisionId: null,
    policy: DELIVERY_POLICY.AUTO_COMMIT,
    trigger: DELIVERY_TRIGGER.AUTOMATIC,
    status: DELIVERY_STATUS.PENDING,
    attempt: 0,
    expectedHead: "a".repeat(40),
    expectedBranch: "main",
    candidateFingerprint: "b".repeat(64),
    candidate: [{ code: " M", path: "src/app.ts" }],
    upstreamRemote: "origin",
    upstreamRef: "refs/heads/main",
    commitMessage: "TASK-001: titre\n\nNOX-Delivery: d1\n",
    commitSha: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    committedAt: null,
    pushedAt: null,
    ...overrides,
  };
}

describe("actions proposees", () => {
  it("propose de commiter un candidat en attente", () => {
    assert.deepEqual(
      deriveDeliveryActions({
        delivery: delivery(),
        eligible: true,
        deliveredExternally: false,
        hasUpstream: true,
      }),
      { commit: true, commitAndPush: true, retryPush: false, refresh: false },
    );
  });

  it("ne propose pas de pousser sans upstream", () => {
    // NOX ne configure jamais un upstream : proposer le bouton laisserait croire
    // qu'il pourrait le faire.
    const actions = deriveDeliveryActions({
      delivery: delivery(),
      eligible: true,
      deliveredExternally: false,
      hasUpstream: false,
    });
    assert.equal(actions.commit, true);
    assert.equal(actions.commitAndPush, false);
  });

  it("ne propose jamais un second commit", () => {
    for (const status of [DELIVERY_STATUS.COMMITTED, DELIVERY_STATUS.PUSHING]) {
      const actions = deriveDeliveryActions({
        delivery: delivery({ status, commitSha: "c".repeat(40) }),
        eligible: true,
        deliveredExternally: false,
        hasUpstream: true,
      });
      assert.equal(actions.commit, false, status);
      assert.equal(actions.commitAndPush, false, status);
      assert.equal(actions.retryPush, true, status);
    }
  });

  it("ne propose plus rien une fois la livraison poussee", () => {
    assert.deepEqual(
      deriveDeliveryActions({
        delivery: delivery({ status: DELIVERY_STATUS.DELIVERED, commitSha: "c".repeat(40) }),
        eligible: true,
        deliveredExternally: false,
        hasUpstream: true,
      }),
      { commit: false, commitAndPush: false, retryPush: false, refresh: false },
    );
  });

  it("propose la reprise de push d'une politique qui l'exige, meme sans upstream lu", () => {
    // Le runner relira l'upstream lui-meme et refusera proprement s'il manque :
    // cacher le bouton laisserait un travail commite sans aucun geste propose.
    const actions = deriveDeliveryActions({
      delivery: delivery({
        policy: DELIVERY_POLICY.AUTO_COMMIT_PUSH,
        status: DELIVERY_STATUS.COMMITTED,
        commitSha: "c".repeat(40),
      }),
      eligible: true,
      deliveredExternally: false,
      hasUpstream: false,
    });
    assert.equal(actions.retryPush, true);
  });

  it("ne propose rien quand le travail a ete livre ailleurs", () => {
    // Le candidat ne correspond plus a ce que Git contient : proposer un commit
    // ne creerait rien de bon.
    assert.deepEqual(
      deriveDeliveryActions({
        delivery: delivery(),
        eligible: true,
        deliveredExternally: true,
        hasUpstream: true,
      }),
      { commit: false, commitAndPush: false, retryPush: false, refresh: false },
    );
  });

  it("ne propose la relecture que si un travail valide existe", () => {
    assert.deepEqual(
      deriveDeliveryActions({
        delivery: null,
        eligible: true,
        deliveredExternally: false,
        hasUpstream: true,
      }),
      { commit: false, commitAndPush: false, retryPush: false, refresh: true },
    );
    assert.deepEqual(
      deriveDeliveryActions({
        delivery: null,
        eligible: false,
        deliveredExternally: false,
        hasUpstream: true,
      }),
      { commit: false, commitAndPush: false, retryPush: false, refresh: false },
    );
  });

  it("propose de reprendre une livraison bloquee", () => {
    // Un refus n'est pas un etat final : le repository peut avoir ete remis en
    // etat, et la reprise reste un geste humain.
    const actions = deriveDeliveryActions({
      delivery: delivery({
        status: DELIVERY_STATUS.BLOCKED,
        errorCode: "DELIVERY_REPOSITORY_CHANGED",
      }),
      eligible: true,
      deliveredExternally: false,
      hasUpstream: true,
    });
    assert.equal(actions.commit, true);
  });
});
