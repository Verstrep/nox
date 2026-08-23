/**
 * Affichage de la file d'execution.
 *
 * ## Ce que ce fichier protege
 *
 * Que chaque etat de file et chaque issue d'avancement possede un texte — les
 * deux tables sont des `Record` complets, donc un etat ajoute plus tard ne peut
 * pas passer inapercu, mais rien ne garantirait qu'il **dise** quelque chose
 * d'utile sans ces tests.
 *
 * Et que les phrases qui engagent une autorisation la nomment : « une fois
 * active, NOX peut lancer » doit se lire avant le clic, pas apres.
 *
 * Pur : ni base, ni disque, ni reseau.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EXECUTION_QUEUE_ERROR, QUEUE_DISPATCH, QUEUE_STATE, QUEUE_STATES } from "@nox/shared";

import {
  QUEUE_ENQUEUE_ACTIVE_NOTICE,
  QUEUE_ENQUEUE_NOTICE,
  QUEUE_ORDER_NOTICE,
  QUEUE_PENDING_MESSAGE,
  QUEUE_STANDING_AUTHORIZATION,
  TASK_QUEUED_MESSAGE,
  dispatchMessage,
  dispatchStarted,
  queueErrorMessage,
  queueStateExplanation,
  queueStateLabel,
  queuedCountLabel,
  queueUrl,
} from "./queue-display.ts";

describe("queueUrl", () => {
  it("mene a la file du projet", () => {
    assert.equal(queueUrl("projet-1"), "/projects/projet-1/queue");
  });
});

describe("etats de la file", () => {
  it("nomme chaque etat", () => {
    for (const state of QUEUE_STATES) {
      assert.ok(queueStateLabel(state).length > 0, state);
    }
  });

  it("explique chaque etat, et dit ce qu'il reste a faire", () => {
    for (const state of QUEUE_STATES) {
      const explanation = queueStateExplanation(state);
      assert.ok(explanation.length > 40, `${state} : explication trop courte`);
    }
  });

  it("distingue une file vide d'une file en pause", () => {
    // « Active · 0 queued » n'a aucun sens : une file vide se dit vide.
    assert.notEqual(queueStateLabel(QUEUE_STATE.EMPTY), queueStateLabel(QUEUE_STATE.PAUSED));
    assert.ok(queueStateLabel(QUEUE_STATE.EMPTY).includes("empty"));
  });

  it("dit qu'une review n'est pas une acceptation", () => {
    assert.ok(queueStateExplanation(QUEUE_STATE.WAITING_REVIEW).includes("Approve"));
  });

  it("dit quoi faire quand le repository bloque", () => {
    const explanation = queueStateExplanation(QUEUE_STATE.WAITING_REPOSITORY);
    assert.ok(explanation.includes("Try next"));
    assert.ok(explanation.includes("commit"));
  });

  it("dit que la file ne saute jamais une tache en echec", () => {
    assert.ok(queueStateExplanation(QUEUE_STATE.FAILED_CURRENT).includes("jamais"));
  });
});

describe("issues d'avancement", () => {
  it("nomme chaque issue", () => {
    for (const outcome of Object.values(QUEUE_DISPATCH)) {
      assert.ok(dispatchMessage(outcome).length > 0, outcome);
    }
  });

  it("ne reconnait qu'un demarrage", () => {
    assert.equal(dispatchStarted(QUEUE_DISPATCH.STARTED), true);
    for (const outcome of Object.values(QUEUE_DISPATCH)) {
      if (outcome !== QUEUE_DISPATCH.STARTED) {
        assert.equal(dispatchStarted(outcome), false, outcome);
      }
    }
  });
});

describe("refus", () => {
  it("traduit chaque code d'erreur", () => {
    for (const code of Object.values(EXECUTION_QUEUE_ERROR)) {
      assert.ok(queueErrorMessage(code).length > 0, code);
    }
  });

  it("explique pourquoi l'amorcage n'entre pas dans la file", () => {
    const message = queueErrorMessage(EXECUTION_QUEUE_ERROR.BOOTSTRAP_NOT_QUEUEABLE);
    assert.ok(message.includes("TASK-000"));
    assert.ok(message.includes("permissions"));
  });

  it("propose les deux issues d'un lancement direct refuse", () => {
    assert.ok(QUEUE_PENDING_MESSAGE.includes("Démarrez"));
    assert.ok(QUEUE_PENDING_MESSAGE.includes("retirez"));
  });

  it("dit pourquoi une tache inscrite est gelée", () => {
    assert.ok(TASK_QUEUED_MESSAGE.includes("Retirez"));
    assert.ok(TASK_QUEUED_MESSAGE.includes("contrat actuel"));
  });
});

describe("textes d'autorisation", () => {
  it("annonce ce que démarrer la file engage", () => {
    assert.ok(QUEUE_STANDING_AUTHORIZATION.includes("automatiquement"));
    // Et ce qui l'interrompt : une autorisation sans limite se lirait comme une
    // autonomie.
    assert.ok(QUEUE_STANDING_AUTHORIZATION.includes("reviews"));
    assert.ok(QUEUE_STANDING_AUTHORIZATION.includes("déjà inscrite"));
  });

  it("distingue une inscription en pause d'une inscription active", () => {
    assert.ok(QUEUE_ENQUEUE_NOTICE.includes("ne lance rien"));
    assert.ok(QUEUE_ENQUEUE_ACTIVE_NOTICE.includes("immédiatement"));
  });

  it("explique que l'ordre n'est pas une contrainte", () => {
    assert.ok(QUEUE_ORDER_NOTICE.includes("sautées"));
    assert.ok(QUEUE_ORDER_NOTICE.includes("place"));
  });
});

describe("queuedCountLabel", () => {
  it("ne dit rien pour une file vide", () => {
    assert.equal(queuedCountLabel(0), null);
  });

  it("compte les inscriptions", () => {
    assert.equal(queuedCountLabel(1), "1 queued");
    assert.equal(queuedCountLabel(3), "3 queued");
  });
});

describe("attente de la tache courante", () => {
  it("nomme un etat distinct de l'echec", () => {
    // Rien n'a echoue : une relecture a demande des changements. Dire « echec »
    // ici enverrait chercher une panne qui n'existe pas.
    assert.notEqual(
      queueStateLabel(QUEUE_STATE.WAITING_CURRENT_TASK),
      queueStateLabel(QUEUE_STATE.FAILED_CURRENT),
    );
    assert.match(queueStateLabel(QUEUE_STATE.WAITING_CURRENT_TASK), /current task/iu);
  });

  it("dit ou reprendre, et que la file ne le fera pas", () => {
    const text = queueStateExplanation(QUEUE_STATE.WAITING_CURRENT_TASK);
    assert.match(text, /rouvert/iu);
    assert.match(text, /Try next/u);
  });

  it("traduit l'issue du dispatcher sans la confondre avec un demarrage", () => {
    assert.equal(dispatchStarted(QUEUE_DISPATCH.WAITING_CURRENT_TASK), false);
    assert.match(dispatchMessage(QUEUE_DISPATCH.WAITING_CURRENT_TASK), /rouvert/iu);
  });
});
