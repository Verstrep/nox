/**
 * Le cycle de correction : sources, borne, eligibilite.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'une correction automatique exige **quatre** choses independantes : un
 * echec de validation constate par NOX, une file active, une tache qui en est
 * la barriere courante, et une borne pas encore atteinte. Retirer n'importe
 * laquelle refuse, et le refus dit laquelle.
 *
 * Qu'une panne d'infrastructure n'est jamais un echec de code — c'est la
 * distinction que TASK-027 a etablie, et TASK-028 ne la contourne pas.
 *
 * Et qu'un amorcage ne se corrige jamais tout seul, quoi qu'il arrive ensuite.
 *
 * Pur : aucune base, aucun disque, aucun processus.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CORRECTION_ATTEMPT_STATUS,
  CORRECTION_REFUSAL,
  CORRECTION_SOURCE,
  CORRECTION_STAGE,
  MAX_AUTOMATED_CORRECTION_ATTEMPTS,
  RUN_PROVENANCE,
  attemptHoldsPlace,
  checkAutomaticCorrection,
  checkHumanCorrection,
  deriveCorrectionCycle,
  isCorrectionAttemptStatus,
  isCorrectionSource,
  queueBlockedByCorrection,
  runProvenance,
  type AutomaticCorrectionFacts,
  type CorrectionAttemptFacts,
  QUEUE_STATE,
  RUN_KIND,
  RUN_STATUS,
  TASK_KIND,
  TASK_STATUS,
  TASK_VERIFICATION_OUTCOME,
  VALIDATION_BATCH_STATUS,
} from "../dist/index.js";

/** Le cas ou tout est reuni : c'est celui qu'on abime, condition par condition. */
const ELIGIBLE: AutomaticCorrectionFacts = {
  taskKind: TASK_KIND.NORMAL,
  taskStatus: TASK_STATUS.REVIEW,
  runStatus: RUN_STATUS.COMPLETED,
  decided: false,
  planValid: true,
  batchStatus: VALIDATION_BATCH_STATUS.FAILED,
  outcome: TASK_VERIFICATION_OUTCOME.AUTO_FAILED,
  queueCurrent: true,
  queueActive: true,
  automatedAttempts: 0,
  attemptReserved: false,
  repositoryMutated: false,
};

function refusal(overrides: Partial<AutomaticCorrectionFacts>): string | null {
  const decision = checkAutomaticCorrection({ ...ELIGIBLE, ...overrides });
  return decision.eligible ? null : decision.code;
}

describe("vocabulaire", () => {
  it("ferme les deux sources", () => {
    assert.equal(isCorrectionSource(CORRECTION_SOURCE.HUMAN_FEEDBACK), true);
    assert.equal(isCorrectionSource(CORRECTION_SOURCE.AUTOMATED_VALIDATION), true);
    assert.equal(isCorrectionSource("MIXED"), false);
    assert.equal(isCorrectionSource(""), false);
    assert.equal(isCorrectionSource(null), false);
  });

  it("ferme les trois etats de reservation", () => {
    assert.equal(isCorrectionAttemptStatus(CORRECTION_ATTEMPT_STATUS.RESERVED), true);
    assert.equal(isCorrectionAttemptStatus(CORRECTION_ATTEMPT_STATUS.LAUNCHED), true);
    assert.equal(isCorrectionAttemptStatus(CORRECTION_ATTEMPT_STATUS.ABANDONED), true);
    assert.equal(isCorrectionAttemptStatus("PENDING"), false);
  });

  it("ne laisse la place qu'une reservation abandonnee", () => {
    assert.equal(attemptHoldsPlace(CORRECTION_ATTEMPT_STATUS.RESERVED), true);
    assert.equal(attemptHoldsPlace(CORRECTION_ATTEMPT_STATUS.LAUNCHED), true);
    assert.equal(attemptHoldsPlace(CORRECTION_ATTEMPT_STATUS.ABANDONED), false);
  });

  it("borne l'automatisme a deux tentatives", () => {
    assert.equal(MAX_AUTOMATED_CORRECTION_ATTEMPTS, 2);
  });
});

describe("eligibilite d'une correction automatique", () => {
  it("accepte le cas complet, et nomme la tentative suivante", () => {
    const decision = checkAutomaticCorrection(ELIGIBLE);
    assert.ok(decision.eligible);
    assert.equal(decision.attempt, 1);
  });

  it("refuse un amorcage avant toute autre condition", () => {
    // Verifie en premier : aucune suite de conditions ne doit pouvoir y mener.
    assert.equal(
      refusal({ taskKind: TASK_KIND.BOOTSTRAP, runStatus: RUN_STATUS.FAILED, queueActive: false }),
      CORRECTION_REFUSAL.BOOTSTRAP,
    );
  });

  it("refuse une execution qui ne s'est pas terminee normalement", () => {
    assert.equal(
      refusal({ runStatus: RUN_STATUS.FAILED }),
      CORRECTION_REFUSAL.RUN_NOT_COMPLETED,
    );
    assert.equal(
      refusal({ runStatus: RUN_STATUS.CANCELLED }),
      CORRECTION_REFUSAL.RUN_NOT_COMPLETED,
    );
  });

  it("refuse une tache qui n'attend plus de decision", () => {
    assert.equal(
      refusal({ taskStatus: TASK_STATUS.COMPLETED }),
      CORRECTION_REFUSAL.TASK_NOT_IN_REVIEW,
    );
    assert.equal(refusal({ taskStatus: TASK_STATUS.READY }), CORRECTION_REFUSAL.TASK_NOT_IN_REVIEW);
  });

  it("refuse une review deja conclue", () => {
    assert.equal(refusal({ decided: true }), CORRECTION_REFUSAL.ALREADY_DECIDED);
  });

  it("refuse un plan de verification inexploitable", () => {
    assert.equal(refusal({ planValid: false }), CORRECTION_REFUSAL.PLAN_INVALID);
  });

  it("refuse tant que le lot n'est pas conclu", () => {
    assert.equal(
      refusal({ batchStatus: VALIDATION_BATCH_STATUS.RUNNING }),
      CORRECTION_REFUSAL.BATCH_NOT_FINAL,
    );
    assert.equal(
      refusal({ batchStatus: VALIDATION_BATCH_STATUS.PENDING }),
      CORRECTION_REFUSAL.BATCH_NOT_FINAL,
    );
  });

  it("refuse une panne d'infrastructure, meme quand une commande a echoue a cote", () => {
    // La preuve est incomplete : corriger reviendrait a reparer ce qu'on n'a
    // pas fini de regarder. Le geste qui s'applique est la reprise du lot.
    assert.equal(
      refusal({ batchStatus: VALIDATION_BATCH_STATUS.ERROR }),
      CORRECTION_REFUSAL.VALIDATION_ERROR,
    );
    assert.equal(
      refusal({
        batchStatus: VALIDATION_BATCH_STATUS.ERROR,
        outcome: TASK_VERIFICATION_OUTCOME.AUTO_FAILED,
      }),
      CORRECTION_REFUSAL.VALIDATION_ERROR,
    );
    assert.equal(
      refusal({ outcome: TASK_VERIFICATION_OUTCOME.AUTO_ERROR }),
      CORRECTION_REFUSAL.VALIDATION_ERROR,
    );
  });

  it("nomme la mutation du depot au lieu de la confondre avec « rien n'a echoue »", () => {
    // La tache aurait pu se terminer seule : ce qui l'en empeche est un defaut
    // reel du travail. NOX ne le corrige pourtant pas de lui-meme — le dossier
    // de travail n'est plus celui qui a ete relu — mais il le dit.
    assert.equal(
      refusal({
        batchStatus: VALIDATION_BATCH_STATUS.PASSED,
        outcome: TASK_VERIFICATION_OUTCOME.AUTO_PASSED,
        repositoryMutated: true,
      }),
      CORRECTION_REFUSAL.REPOSITORY_MUTATED,
    );
  });

  it("ne confond pas une mutation constatee avec une ignorance", () => {
    // « Je n'ai pas pu regarder » refuse une completion automatique, mais ne
    // decrit aucun defaut : le refus reste « rien n'a echoue ».
    assert.equal(
      refusal({
        batchStatus: VALIDATION_BATCH_STATUS.PASSED,
        outcome: TASK_VERIFICATION_OUTCOME.AUTO_PASSED,
        repositoryMutated: false,
      }),
      CORRECTION_REFUSAL.NO_VALIDATION_FAILURE,
    );
  });

  it("ne signale pas une mutation sur une tache qui attend deja un humain", () => {
    // Une tache mixte revient a l'humain de toute facon : la mutation lui sera
    // montree dans la review, et c'est lui qui decide.
    assert.equal(
      refusal({
        batchStatus: VALIDATION_BATCH_STATUS.PASSED,
        outcome: TASK_VERIFICATION_OUTCOME.HUMAN_REQUIRED,
        repositoryMutated: true,
      }),
      CORRECTION_REFUSAL.NO_VALIDATION_FAILURE,
    );
  });

  it("refuse quand rien n'a echoue", () => {
    assert.equal(
      refusal({
        batchStatus: VALIDATION_BATCH_STATUS.PASSED,
        outcome: TASK_VERIFICATION_OUTCOME.AUTO_PASSED,
      }),
      CORRECTION_REFUSAL.NO_VALIDATION_FAILURE,
    );
    assert.equal(refusal({ batchStatus: null }), CORRECTION_REFUSAL.NO_VALIDATION_FAILURE);
  });

  it("refuse quand seul un critere humain reste", () => {
    // Un critere humain non confirme n'est pas un echec de code : NOX n'en a
    // aucune preuve, et relancer Claude Code a l'aveugle ne prouverait rien.
    assert.equal(
      refusal({
        batchStatus: VALIDATION_BATCH_STATUS.PASSED,
        outcome: TASK_VERIFICATION_OUTCOME.HUMAN_REQUIRED,
      }),
      CORRECTION_REFUSAL.NO_VALIDATION_FAILURE,
    );
  });

  it("refuse une tache lancee a la main", () => {
    assert.equal(refusal({ queueCurrent: false }), CORRECTION_REFUSAL.NOT_QUEUED);
  });

  it("refuse une file en pause", () => {
    assert.equal(refusal({ queueActive: false }), CORRECTION_REFUSAL.QUEUE_PAUSED);
  });

  it("refuse au-dela de la borne, et pas avant", () => {
    assert.equal(refusal({ automatedAttempts: 0 }), null);
    assert.equal(refusal({ automatedAttempts: 1 }), null);
    assert.equal(refusal({ automatedAttempts: 2 }), CORRECTION_REFUSAL.LIMIT_REACHED);
    assert.equal(refusal({ automatedAttempts: 7 }), CORRECTION_REFUSAL.LIMIT_REACHED);
  });

  it("numerote la tentative a partir du compte deja engage", () => {
    const decision = checkAutomaticCorrection({ ...ELIGIBLE, automatedAttempts: 1 });
    assert.ok(decision.eligible);
    assert.equal(decision.attempt, 2);
  });

  it("refuse quand une reservation occupe deja l'execution", () => {
    assert.equal(refusal({ attemptReserved: true }), CORRECTION_REFUSAL.ALREADY_RESERVED);
  });

  it("annonce la reservation avant la file : c'est elle qui a gagne la course", () => {
    // Deux constatations simultanees : celle qui perd doit lire « une correction
    // est deja engagee », pas « la file est en pause ».
    assert.equal(
      refusal({ attemptReserved: true, queueActive: false }),
      CORRECTION_REFUSAL.ALREADY_RESERVED,
    );
  });
});

describe("correction demandee par un humain", () => {
  it("ne demande ni file, ni autorisation, ni echec de validation", () => {
    const decision = checkHumanCorrection({
      taskStatus: TASK_STATUS.REVIEW,
      runStatus: RUN_STATUS.COMPLETED,
      decided: false,
      batchStatus: VALIDATION_BATCH_STATUS.PASSED,
      attemptReserved: false,
    });
    assert.ok(decision.eligible);
  });

  it("reste possible apres la borne automatique", () => {
    // La borne borne l'automatisme, pas les gestes humains : elle n'entre meme
    // pas dans les faits que cette fonction recoit.
    const decision = checkHumanCorrection({
      taskStatus: TASK_STATUS.REVIEW,
      runStatus: RUN_STATUS.COMPLETED,
      decided: false,
      batchStatus: VALIDATION_BATCH_STATUS.FAILED,
      attemptReserved: false,
    });
    assert.ok(decision.eligible);
  });

  it("refuse pendant un lot en cours", () => {
    const decision = checkHumanCorrection({
      taskStatus: TASK_STATUS.REVIEW,
      runStatus: RUN_STATUS.COMPLETED,
      decided: false,
      batchStatus: VALIDATION_BATCH_STATUS.RUNNING,
      attemptReserved: false,
    });
    assert.equal(decision.eligible, false);
    assert.equal(decision.eligible ? null : decision.code, CORRECTION_REFUSAL.BATCH_NOT_FINAL);
  });

  it("refuse une review deja conclue", () => {
    const decision = checkHumanCorrection({
      taskStatus: TASK_STATUS.REVIEW,
      runStatus: RUN_STATUS.COMPLETED,
      decided: true,
      batchStatus: VALIDATION_BATCH_STATUS.FAILED,
      attemptReserved: false,
    });
    assert.equal(decision.eligible ? null : decision.code, CORRECTION_REFUSAL.ALREADY_DECIDED);
  });

  it("refuse quand une correction est deja engagee", () => {
    const decision = checkHumanCorrection({
      taskStatus: TASK_STATUS.REVIEW,
      runStatus: RUN_STATUS.COMPLETED,
      decided: false,
      batchStatus: VALIDATION_BATCH_STATUS.FAILED,
      attemptReserved: true,
    });
    assert.equal(decision.eligible ? null : decision.code, CORRECTION_REFUSAL.ALREADY_RESERVED);
  });
});

function attempt(overrides: Partial<CorrectionAttemptFacts> = {}): CorrectionAttemptFacts {
  return {
    id: "attempt-1",
    source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
    status: CORRECTION_ATTEMPT_STATUS.LAUNCHED,
    automatedAttempt: 1,
    correctionRunId: "run-2",
    ...overrides,
  };
}

describe("etat affiche du cycle", () => {
  it("ne montre rien quand rien n'est en jeu", () => {
    const state = deriveCorrectionCycle({
      attempts: [],
      running: false,
      correctionAvailable: false,
      automatic: { eligible: false, code: CORRECTION_REFUSAL.NO_VALIDATION_FAILURE },
    });
    assert.equal(state.stage, CORRECTION_STAGE.NONE);
    assert.equal(state.automatedAttempts, 0);
    assert.equal(state.lastSource, null);
  });

  it("annonce une correction en cours avant tout le reste", () => {
    const state = deriveCorrectionCycle({
      attempts: [attempt()],
      running: true,
      correctionAvailable: false,
      automatic: { eligible: false, code: CORRECTION_REFUSAL.RUN_NOT_COMPLETED },
    });
    assert.equal(state.stage, CORRECTION_STAGE.RUNNING);
    assert.equal(state.automatedAttempts, 1);
  });

  it("annonce une reservation restee en plan", () => {
    const state = deriveCorrectionCycle({
      attempts: [attempt({ status: CORRECTION_ATTEMPT_STATUS.RESERVED, correctionRunId: null })],
      running: false,
      correctionAvailable: false,
      automatic: { eligible: false, code: CORRECTION_REFUSAL.ALREADY_RESERVED },
    });
    assert.equal(state.stage, CORRECTION_STAGE.RESERVED);
  });

  it("ne compte pas une reservation abandonnee", () => {
    const state = deriveCorrectionCycle({
      attempts: [attempt({ status: CORRECTION_ATTEMPT_STATUS.ABANDONED, correctionRunId: null })],
      running: false,
      correctionAvailable: true,
      automatic: { eligible: true, attempt: 1 },
    });
    assert.equal(state.automatedAttempts, 0);
    assert.equal(state.stage, CORRECTION_STAGE.READY);
  });

  it("ne compte pas une correction humaine dans la borne", () => {
    const state = deriveCorrectionCycle({
      attempts: [attempt({ source: CORRECTION_SOURCE.HUMAN_FEEDBACK, automatedAttempt: 0 })],
      running: false,
      correctionAvailable: true,
      automatic: { eligible: true, attempt: 1 },
    });
    assert.equal(state.automatedAttempts, 0);
    assert.equal(state.lastSource, CORRECTION_SOURCE.HUMAN_FEEDBACK);
  });

  it("annonce la borne uniquement quand elle est ce qui bloque", () => {
    const reached = deriveCorrectionCycle({
      attempts: [attempt(), attempt({ id: "attempt-2", automatedAttempt: 2 })],
      running: false,
      correctionAvailable: true,
      automatic: { eligible: false, code: CORRECTION_REFUSAL.LIMIT_REACHED },
    });
    assert.equal(reached.stage, CORRECTION_STAGE.LIMIT_REACHED);
    assert.equal(reached.automatedAttempts, 2);

    // Meme historique, mais c'est le lot en cours qui bloque : dire « limite
    // atteinte » enverrait chercher un probleme qui n'existe pas.
    const running = deriveCorrectionCycle({
      attempts: [attempt(), attempt({ id: "attempt-2", automatedAttempt: 2 })],
      running: false,
      correctionAvailable: false,
      automatic: { eligible: false, code: CORRECTION_REFUSAL.BATCH_NOT_FINAL },
    });
    assert.equal(running.stage, CORRECTION_STAGE.NONE);
  });

  it("propose une correction quand un humain peut la demander", () => {
    const state = deriveCorrectionCycle({
      attempts: [],
      running: false,
      correctionAvailable: true,
      automatic: { eligible: false, code: CORRECTION_REFUSAL.NOT_QUEUED },
    });
    assert.equal(state.stage, CORRECTION_STAGE.READY);
    assert.equal(state.refusal, CORRECTION_REFUSAL.NOT_QUEUED);
  });

  it("recopie la borne pour que l'affichage n'ait pas a la connaitre", () => {
    const state = deriveCorrectionCycle({
      attempts: [],
      running: false,
      correctionAvailable: false,
      automatic: { eligible: true, attempt: 1 },
    });
    assert.equal(state.maxAutomatedAttempts, MAX_AUTOMATED_CORRECTION_ATTEMPTS);
    assert.equal(state.refusal, null);
  });
});

describe("file bloquee par une borne atteinte", () => {
  it("ne vaut que pour une file en attente de review", () => {
    assert.equal(
      queueBlockedByCorrection(QUEUE_STATE.WAITING_REVIEW, CORRECTION_STAGE.LIMIT_REACHED),
      true,
    );
    assert.equal(
      queueBlockedByCorrection(QUEUE_STATE.PAUSED, CORRECTION_STAGE.LIMIT_REACHED),
      false,
    );
    assert.equal(
      queueBlockedByCorrection(QUEUE_STATE.WAITING_REVIEW, CORRECTION_STAGE.RUNNING),
      false,
    );
  });
});

describe("provenance d'une execution", () => {
  it("distingue les trois provenances connues", () => {
    assert.equal(runProvenance(RUN_KIND.INITIAL, null), RUN_PROVENANCE.INITIAL);
    assert.equal(
      runProvenance(RUN_KIND.CORRECTION, CORRECTION_SOURCE.HUMAN_FEEDBACK),
      RUN_PROVENANCE.HUMAN_CORRECTION,
    );
    assert.equal(
      runProvenance(RUN_KIND.CORRECTION, CORRECTION_SOURCE.AUTOMATED_VALIDATION),
      RUN_PROVENANCE.AUTOMATIC_CORRECTION,
    );
  });

  it("n'invente aucune source pour une correction historique", () => {
    // Toutes les corrections d'avant TASK-028 partaient d'un feedback, mais
    // l'affirmer reviendrait a ecrire dans l'histoire ce qu'on n'a pas releve.
    assert.equal(runProvenance(RUN_KIND.CORRECTION, null), RUN_PROVENANCE.LEGACY_CORRECTION);
  });

  it("traite une nature illisible comme initiale", () => {
    assert.equal(runProvenance("RETRY", CORRECTION_SOURCE.AUTOMATED_VALIDATION), RUN_PROVENANCE.INITIAL);
    assert.equal(runProvenance("", null), RUN_PROVENANCE.INITIAL);
  });
});

describe("le module n'ouvre aucun echappatoire", () => {
  it("n'accepte ni force, ni override, ni ignoreFailure", () => {
    // Meme regle que `checkAutoCompletion` : un chemin automatique qui pourrait
    // etre force n'est plus un chemin automatique, c'est une porte.
    const source = checkAutomaticCorrection.toString();
    for (const forbidden of ["force", "override", "ignoreFailure", "skip"]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });
});
