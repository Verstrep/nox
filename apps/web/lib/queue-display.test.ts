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

import {
  CORRECTION_SOURCE,
  CORRECTION_STAGE,
  EXECUTION_QUEUE_ERROR,
  MAX_AUTOMATED_CORRECTION_ATTEMPTS,
  QUEUE_DISPATCH,
  QUEUE_STATE,
  QUEUE_STATES,
  REVIEW_WAIT,
  type ReviewWait,
  type CorrectionCycleState,
} from "@nox/shared";

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
  queueReviewExplanation,
  queueReviewLabel,
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

describe("ce que la review fait attendre", () => {
  const wait = (kind: ReviewWait["kind"], humanCheckCount = 0): ReviewWait => ({
    kind,
    humanCheckCount,
  });

  it("distingue les quatre situations", () => {
    // « Waiting for review » couvrait quatre etats qui n'appellent pas le meme
    // geste : attendre, corriger, relancer, cocher. Les confondre laisse
    // l'utilisateur devant une file qui ne bouge pas sans lui dire pourquoi.
    const labels = new Set(
      [
        REVIEW_WAIT.VALIDATION_RUNNING,
        REVIEW_WAIT.VALIDATION_FAILED,
        REVIEW_WAIT.VALIDATION_ERROR,
        REVIEW_WAIT.HUMAN_CHECKS,
      ].map((kind) => queueReviewLabel(wait(kind, 2))),
    );
    assert.equal(labels.size, 4);
  });

  it("ne confond pas un echec et une panne", () => {
    assert.notEqual(
      queueReviewLabel(wait(REVIEW_WAIT.VALIDATION_FAILED)),
      queueReviewLabel(wait(REVIEW_WAIT.VALIDATION_ERROR)),
    );
  });

  it("compte les verifications humaines restantes", () => {
    assert.match(queueReviewLabel(wait(REVIEW_WAIT.HUMAN_CHECKS, 1)), /1 check$/u);
    assert.match(queueReviewLabel(wait(REVIEW_WAIT.HUMAN_CHECKS, 3)), /3 checks$/u);
  });

  it("retombe sur le libelle generique quand rien de particulier n'attend", () => {
    assert.equal(
      queueReviewLabel(wait(REVIEW_WAIT.REVIEW)),
      queueStateLabel(QUEUE_STATE.WAITING_REVIEW),
    );
    assert.equal(
      queueReviewExplanation(wait(REVIEW_WAIT.REVIEW)),
      queueStateExplanation(QUEUE_STATE.WAITING_REVIEW),
    );
  });

  it("explique chaque situation par un geste", () => {
    for (const kind of [
      REVIEW_WAIT.VALIDATION_RUNNING,
      REVIEW_WAIT.VALIDATION_FAILED,
      REVIEW_WAIT.VALIDATION_ERROR,
      REVIEW_WAIT.HUMAN_CHECKS,
    ]) {
      const text = queueReviewExplanation(wait(kind, 2));
      assert.ok(text.length > 60, kind);
      assert.ok(!text.includes("_"), kind);
    }
  });
});

describe("l'autorisation permanente couvre les corrections bornees", () => {
  it("annonce les corrections **avant** le clic, avec leur borne", () => {
    // Une autorisation qui s'elargit en silence n'est plus une autorisation :
    // ce que le clic engage doit se lire au moment ou on clique.
    assert.ok(QUEUE_STANDING_AUTHORIZATION.includes("corrections"));
    assert.ok(
      QUEUE_STANDING_AUTHORIZATION.includes(String(MAX_AUTOMATED_CORRECTION_ATTEMPTS)),
      "la borne est chiffree",
    );
    assert.ok(QUEUE_STANDING_AUTHORIZATION.includes("exécute lui-même"));
  });

  it("dit qu'aucune correction ne part sans un echec constate par NOX", () => {
    assert.ok(QUEUE_STANDING_AUTHORIZATION.includes("échec que NOX a constaté"));
  });
});

describe("element courant pendant un cycle de correction", () => {
  function cycle(overrides: Partial<CorrectionCycleState> = {}): CorrectionCycleState {
    return {
      stage: CORRECTION_STAGE.NONE,
      automatedAttempts: 0,
      maxAutomatedAttempts: MAX_AUTOMATED_CORRECTION_ATTEMPTS,
      lastSource: null,
      refusal: null,
      ...overrides,
    };
  }

  const failed = { kind: REVIEW_WAIT.VALIDATION_FAILED, humanCheckCount: 0 } as const;

  it("garde le libelle historique quand aucun cycle n'est charge", () => {
    assert.equal(queueReviewLabel(failed), "Automated validation failed");
    assert.equal(queueReviewLabel(failed, null), "Automated validation failed");
  });

  it("annonce la correction a venir plutot qu'un echec sec", () => {
    assert.equal(
      queueReviewLabel(failed, cycle({ automatedAttempts: 0 })),
      "Automated validation failed — automatic correction 1 of 2",
    );
    assert.equal(
      queueReviewLabel(failed, cycle({ automatedAttempts: 1 })),
      "Automated validation failed — automatic correction 2 of 2",
    );
  });

  it("annonce une correction en cours", () => {
    assert.equal(
      queueReviewLabel(
        failed,
        cycle({
          stage: CORRECTION_STAGE.RUNNING,
          automatedAttempts: 1,
          lastSource: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
        }),
      ),
      "Automatic correction 1 of 2 running",
    );
  });

  it("annonce la borne atteinte, et que la main revient a l'humain", () => {
    const reached = cycle({ stage: CORRECTION_STAGE.LIMIT_REACHED, automatedAttempts: 2 });
    assert.equal(
      queueReviewLabel(failed, reached),
      "Automatic correction limit reached — human action required",
    );
    assert.match(queueReviewExplanation(failed, reached), /Human review required/u);
  });

  it("ne masque pas une validation en cours par un etat de correction", () => {
    // Un lot qui tourne interdit toute decision : le dire est plus utile que
    // d'annoncer une correction qui n'a pas encore lieu d'etre.
    const running = { kind: REVIEW_WAIT.VALIDATION_RUNNING, humanCheckCount: 0 } as const;
    assert.equal(queueReviewLabel(running, cycle()), "Automated validation running");
  });

  it("ne transforme pas une attente humaine en correction", () => {
    const human = { kind: REVIEW_WAIT.HUMAN_CHECKS, humanCheckCount: 1 } as const;
    assert.equal(
      queueReviewLabel(human, cycle()),
      "Waiting for human validation · 1 check",
    );
  });
});
