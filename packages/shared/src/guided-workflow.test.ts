/**
 * Tests de la projection guidee.
 *
 * Deux choses sont verifiees ici, et elles ne sont pas du meme ordre.
 *
 * La premiere est banale : chaque situation produit le bon stage, la bonne
 * recommandation, les bonnes alternatives et les bons blocages. C'est une table.
 *
 * La seconde l'est moins : la fonction doit etre **pure**. Elle ne lit rien,
 * n'ecrit rien, n'appelle personne. Un test le verifie en la sollicitant cent
 * fois et en constatant que ses entrees n'ont pas bouge et que ses sorties sont
 * identiques — parce que le jour ou quelqu'un y glissera un `await`, c'est le
 * rendu d'une page qui lancera Claude Code.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARCHITECT_REVIEW_BLOCKER,
  ARCHITECT_REVIEW_VERDICT,
  GUIDED_ACTION,
  GUIDED_BLOCKER,
  GUIDED_PROGRESS_STEP,
  GUIDED_STAGE,
  RUN_KIND,
  RUN_STATUS,
  TASK_DOCUMENT_SYNC_STATUS,
  TASK_STATUS,
  deriveGuidedWorkflowState,
  guidedActionCallsOpenAI,
  guidedActionStartsClaude,
  isGuidedWorkflowStage,
  type ArchitectReviewVerdict,
  type GuidedActionKind,
  type GuidedAnalysisFact,
  type GuidedRunFact,
  type GuidedWorkflowFacts,
  type GuidedWorkflowState,
} from "../dist/index.js";

// --- Fixtures ---------------------------------------------------------------

const RUN: GuidedRunFact = {
  id: "run-1",
  code: "RUN-001",
  kind: RUN_KIND.INITIAL,
  status: RUN_STATUS.COMPLETED,
  hasReview: true,
  canRequestChanges: true,
  requestChangesDetail: null,
};

function facts(overrides: Partial<GuidedWorkflowFacts> = {}): GuidedWorkflowFacts {
  return {
    taskStatus: TASK_STATUS.DRAFT,
    documentSyncStatus: TASK_DOCUMENT_SYNC_STATUS.SYNCED,
    hasAcceptanceCriteria: true,
    designedWithArchitect: false,
    runs: [],
    launch: { state: "unknown" },
    architect: {
      configured: true,
      latestCompleted: null,
      lastAttemptFailed: false,
      active: false,
      analysesLeft: 5,
    },
    correction: null,
    ...overrides,
  };
}

function run(overrides: Partial<GuidedRunFact> = {}): GuidedRunFact {
  return { ...RUN, ...overrides };
}

function analysis(verdict: ArchitectReviewVerdict): GuidedAnalysisFact {
  return {
    id: "analysis-1",
    code: "ANALYSIS-1",
    verdict,
    blockers: [],
    hasFeedback: verdict === ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED,
  };
}

/** Nature de l'action recommandee, ou `null`. */
function recommended(state: GuidedWorkflowState): GuidedActionKind | null {
  return state.recommendedAction?.kind ?? null;
}

function alternatives(state: GuidedWorkflowState): GuidedActionKind[] {
  return state.alternativeActions.map((entry) => entry.kind);
}

function blockerCodes(state: GuidedWorkflowState): string[] {
  return state.blockers.map((entry) => entry.code);
}

// --- Table principale -------------------------------------------------------

type Scenario = {
  label: string;
  facts: GuidedWorkflowFacts;
  stage: string;
  recommended: GuidedActionKind | null;
  /** Alternatives attendues, verifiees par inclusion. */
  includes?: GuidedActionKind[];
  excludes?: GuidedActionKind[];
  blockers?: string[];
  currentRun?: string | null;
};

const SCENARIOS: Scenario[] = [
  {
    label: "Draft synchronise",
    facts: facts(),
    stage: GUIDED_STAGE.DRAFTING,
    recommended: GUIDED_ACTION.MARK_READY,
    includes: [GUIDED_ACTION.OPEN_DOCUMENT, GUIDED_ACTION.DELETE_TASK],
    blockers: [],
    currentRun: null,
  },
  {
    label: "Draft non synchronise",
    facts: facts({ documentSyncStatus: TASK_DOCUMENT_SYNC_STATUS.ERROR }),
    stage: GUIDED_STAGE.DRAFTING,
    recommended: GUIDED_ACTION.RESOLVE_DOCUMENT_SYNC,
    includes: [GUIDED_ACTION.MARK_READY],
    blockers: [GUIDED_BLOCKER.DOCUMENT_NOT_SYNCED],
  },
  {
    label: "Draft en conflit documentaire",
    facts: facts({ documentSyncStatus: TASK_DOCUMENT_SYNC_STATUS.CONFLICT }),
    stage: GUIDED_STAGE.DRAFTING,
    recommended: GUIDED_ACTION.RESOLVE_DOCUMENT_SYNC,
    includes: [GUIDED_ACTION.OPEN_DOCUMENT],
    blockers: [GUIDED_BLOCKER.DOCUMENT_NOT_SYNCED],
  },
  {
    label: "Draft sans critere d'acceptation",
    facts: facts({ hasAcceptanceCriteria: false }),
    stage: GUIDED_STAGE.DRAFTING,
    recommended: null,
    blockers: [GUIDED_BLOCKER.ACCEPTANCE_CRITERIA_MISSING],
  },
  {
    label: "Ready, runner interroge et pret",
    facts: facts({ taskStatus: TASK_STATUS.READY, launch: { state: "ready" } }),
    stage: GUIDED_STAGE.READY_TO_RUN,
    recommended: GUIDED_ACTION.RUN_CLAUDE,
    includes: [GUIDED_ACTION.BACK_TO_DRAFT],
    blockers: [],
  },
  {
    label: "Ready, runner arrete",
    facts: facts({
      taskStatus: TASK_STATUS.READY,
      launch: { state: "runner_unavailable", detail: "Le runner local ne repond pas." },
    }),
    stage: GUIDED_STAGE.READY_TO_RUN,
    recommended: null,
    excludes: [GUIDED_ACTION.RUN_CLAUDE],
    blockers: [GUIDED_BLOCKER.RUNNER_UNAVAILABLE],
  },
  {
    label: "Ready, Claude Code introuvable",
    facts: facts({
      taskStatus: TASK_STATUS.READY,
      launch: { state: "claude_unavailable", detail: "Claude Code est introuvable." },
    }),
    stage: GUIDED_STAGE.READY_TO_RUN,
    recommended: null,
    blockers: [GUIDED_BLOCKER.CLAUDE_UNAVAILABLE],
  },
  {
    label: "Ready, repository non propre",
    facts: facts({
      taskStatus: TASK_STATUS.READY,
      launch: { state: "repository_unavailable", detail: "Le repository n'est pas propre." },
    }),
    stage: GUIDED_STAGE.READY_TO_RUN,
    recommended: null,
    blockers: [GUIDED_BLOCKER.REPOSITORY_NOT_READY],
  },
  {
    label: "Ready, document desynchronise",
    facts: facts({
      taskStatus: TASK_STATUS.READY,
      documentSyncStatus: TASK_DOCUMENT_SYNC_STATUS.PENDING,
      launch: { state: "ready" },
    }),
    stage: GUIDED_STAGE.READY_TO_RUN,
    recommended: null,
    blockers: [GUIDED_BLOCKER.DOCUMENT_NOT_SYNCED],
  },
  {
    label: "Execution initiale en cours",
    facts: facts({
      taskStatus: TASK_STATUS.RUNNING,
      runs: [run({ status: RUN_STATUS.RUNNING, hasReview: false })],
    }),
    stage: GUIDED_STAGE.RUNNING,
    recommended: GUIDED_ACTION.OPEN_RUN,
    excludes: [GUIDED_ACTION.RUN_CLAUDE],
    blockers: [GUIDED_BLOCKER.RUN_ACTIVE],
    currentRun: "run-1",
  },
  {
    label: "Correction en cours",
    facts: facts({
      taskStatus: TASK_STATUS.RUNNING,
      runs: [
        run({ id: "run-2", code: "RUN-002", kind: RUN_KIND.CORRECTION, status: RUN_STATUS.RUNNING, hasReview: false }),
        run(),
      ],
    }),
    stage: GUIDED_STAGE.RUNNING,
    recommended: GUIDED_ACTION.OPEN_RUN,
    currentRun: "run-2",
  },
  {
    label: "Review disponible, aucune analyse Architecte",
    facts: facts({ taskStatus: TASK_STATUS.REVIEW, runs: [run()] }),
    stage: GUIDED_STAGE.REVIEWING,
    recommended: GUIDED_ACTION.ANALYZE_WITH_ARCHITECT,
    includes: [GUIDED_ACTION.OPEN_REVIEW, GUIDED_ACTION.REQUEST_CHANGES, GUIDED_ACTION.APPROVE],
    blockers: [],
  },
  {
    label: "Review disponible, OpenAI non configure",
    facts: facts({
      taskStatus: TASK_STATUS.REVIEW,
      runs: [run()],
      architect: {
        configured: false,
        latestCompleted: null,
        lastAttemptFailed: false,
        active: false,
        analysesLeft: 5,
      },
    }),
    stage: GUIDED_STAGE.REVIEWING,
    recommended: GUIDED_ACTION.REVIEW_MANUALLY,
    includes: [GUIDED_ACTION.REQUEST_CHANGES, GUIDED_ACTION.APPROVE],
    blockers: [GUIDED_BLOCKER.OPENAI_UNAVAILABLE],
  },
  {
    label: "Review disponible, quota d'analyses epuise",
    facts: facts({
      taskStatus: TASK_STATUS.REVIEW,
      runs: [run()],
      architect: {
        configured: true,
        latestCompleted: null,
        lastAttemptFailed: false,
        active: false,
        analysesLeft: 0,
      },
    }),
    stage: GUIDED_STAGE.REVIEWING,
    recommended: GUIDED_ACTION.REVIEW_MANUALLY,
    blockers: [GUIDED_BLOCKER.ARCHITECT_LIMIT_REACHED],
  },
  {
    label: "Analyse Architecte en cours",
    facts: facts({
      taskStatus: TASK_STATUS.REVIEW,
      runs: [run()],
      architect: {
        configured: true,
        latestCompleted: null,
        lastAttemptFailed: false,
        active: true,
        analysesLeft: 4,
      },
    }),
    stage: GUIDED_STAGE.REVIEWING,
    recommended: GUIDED_ACTION.REVIEW_MANUALLY,
    blockers: [GUIDED_BLOCKER.ARCHITECT_ANALYSIS_ACTIVE],
  },
  {
    label: "Analyse Architecte echouee, aucune analyse exploitable",
    facts: facts({
      taskStatus: TASK_STATUS.REVIEW,
      runs: [run()],
      architect: {
        configured: true,
        latestCompleted: null,
        lastAttemptFailed: true,
        active: false,
        analysesLeft: 4,
      },
    }),
    stage: GUIDED_STAGE.REVIEWING,
    recommended: GUIDED_ACTION.ANALYZE_WITH_ARCHITECT,
    blockers: [],
  },
  {
    label: "Run final sans instantane de review",
    facts: facts({ taskStatus: TASK_STATUS.REVIEW, runs: [run({ hasReview: false })] }),
    stage: GUIDED_STAGE.REVIEWING,
    recommended: GUIDED_ACTION.OPEN_REVIEW,
    blockers: [GUIDED_BLOCKER.REVIEW_UNAVAILABLE],
  },
  {
    label: "Architecte : approbation recommandee",
    facts: facts({
      taskStatus: TASK_STATUS.REVIEW,
      runs: [run()],
      architect: {
        configured: true,
        latestCompleted: analysis(ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED),
        lastAttemptFailed: false,
        active: false,
        analysesLeft: 4,
      },
    }),
    stage: GUIDED_STAGE.ARCHITECT_REVIEW,
    recommended: GUIDED_ACTION.REVIEW_AND_APPROVE,
    includes: [GUIDED_ACTION.OPEN_ARCHITECT_ANALYSIS, GUIDED_ACTION.REQUEST_CHANGES],
    blockers: [],
  },
  {
    label: "Architecte : corrections recommandees",
    facts: facts({
      taskStatus: TASK_STATUS.REVIEW,
      runs: [run()],
      architect: {
        configured: true,
        latestCompleted: analysis(ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED),
        lastAttemptFailed: false,
        active: false,
        analysesLeft: 4,
      },
    }),
    stage: GUIDED_STAGE.ARCHITECT_REVIEW,
    recommended: GUIDED_ACTION.USE_AS_FEEDBACK,
    includes: [GUIDED_ACTION.REQUEST_CHANGES, GUIDED_ACTION.APPROVE],
    blockers: [],
  },
  {
    label: "Architecte : relecture humaine exigee",
    facts: facts({
      taskStatus: TASK_STATUS.REVIEW,
      runs: [run()],
      architect: {
        configured: true,
        latestCompleted: {
          ...analysis(ARCHITECT_REVIEW_VERDICT.HUMAN_REVIEW_REQUIRED),
          blockers: [ARCHITECT_REVIEW_BLOCKER.SENSITIVE_FILE, ARCHITECT_REVIEW_BLOCKER.BINARY_FILE],
        },
        lastAttemptFailed: false,
        active: false,
        analysesLeft: 4,
      },
    }),
    stage: GUIDED_STAGE.ARCHITECT_REVIEW,
    recommended: GUIDED_ACTION.REVIEW_MANUALLY,
    excludes: [GUIDED_ACTION.REVIEW_AND_APPROVE],
    blockers: [],
  },
  {
    label: "Feedback enregistre, preconditions non verifiees",
    facts: facts({
      taskStatus: TASK_STATUS.REVIEW,
      runs: [run()],
      correction: {
        feedbackId: "fb-1",
        sourceRunId: "run-1",
        sourceRunCode: "RUN-001",
        excerpt: "Raccourcis l'introduction.",
        refusalDetail: null,
        readiness: { state: "unknown" },
      },
    }),
    stage: GUIDED_STAGE.CHANGES_REQUESTED,
    recommended: GUIDED_ACTION.PREPARE_CORRECTION,
    includes: [GUIDED_ACTION.OPEN_REVIEW, GUIDED_ACTION.APPROVE],
    blockers: [],
  },
  {
    label: "Feedback enregistre, preconditions tenues",
    facts: facts({
      taskStatus: TASK_STATUS.REVIEW,
      runs: [run()],
      correction: {
        feedbackId: "fb-1",
        sourceRunId: "run-1",
        sourceRunCode: "RUN-001",
        excerpt: "Raccourcis l'introduction.",
        refusalDetail: null,
        readiness: { state: "ready" },
      },
    }),
    stage: GUIDED_STAGE.CORRECTION_READY,
    recommended: GUIDED_ACTION.RESUME_CLAUDE,
    blockers: [],
  },
  {
    label: "Feedback enregistre, dossier de travail modifie",
    facts: facts({
      taskStatus: TASK_STATUS.REVIEW,
      runs: [run()],
      correction: {
        feedbackId: "fb-1",
        sourceRunId: "run-1",
        sourceRunCode: "RUN-001",
        excerpt: "Raccourcis l'introduction.",
        refusalDetail: null,
        readiness: { state: "blocked", detail: "Le dossier de travail a change." },
      },
    }),
    stage: GUIDED_STAGE.BLOCKED,
    recommended: GUIDED_ACTION.PREPARE_CORRECTION,
    blockers: [GUIDED_BLOCKER.CORRECTION_PRECONDITION_FAILED],
  },
  {
    label: "Feedback enregistre, session Claude perdue",
    facts: facts({
      taskStatus: TASK_STATUS.REVIEW,
      runs: [run({ canRequestChanges: false, requestChangesDetail: "Aucune session." })],
      correction: {
        feedbackId: "fb-1",
        sourceRunId: "run-1",
        sourceRunCode: "RUN-001",
        excerpt: "Raccourcis l'introduction.",
        refusalDetail: "Claude Code n'a rapporte aucun identifiant de session.",
        readiness: { state: "unknown" },
      },
    }),
    stage: GUIDED_STAGE.BLOCKED,
    recommended: GUIDED_ACTION.REVIEW_MANUALLY,
    blockers: [GUIDED_BLOCKER.CORRECTION_PRECONDITION_FAILED],
  },
  {
    label: "Correction terminee : retour en review, sans analyse heritee",
    facts: facts({
      taskStatus: TASK_STATUS.REVIEW,
      runs: [
        run({ id: "run-2", code: "RUN-002", kind: RUN_KIND.CORRECTION }),
        run(),
      ],
    }),
    stage: GUIDED_STAGE.REVIEWING,
    recommended: GUIDED_ACTION.ANALYZE_WITH_ARCHITECT,
    currentRun: "run-2",
  },
  {
    label: "Tache terminee",
    facts: facts({ taskStatus: TASK_STATUS.COMPLETED, runs: [run()] }),
    stage: GUIDED_STAGE.DONE,
    recommended: null,
    includes: [GUIDED_ACTION.REOPEN, GUIDED_ACTION.OPEN_REVIEW, GUIDED_ACTION.OPEN_RUN_HISTORY],
    blockers: [],
  },
  {
    label: "Tache rouverte : elle repart de Ready",
    facts: facts({ taskStatus: TASK_STATUS.READY, runs: [run()], launch: { state: "ready" } }),
    stage: GUIDED_STAGE.READY_TO_RUN,
    recommended: GUIDED_ACTION.RUN_CLAUDE,
  },
  {
    label: "Execution annulee : tache bloquee, review disponible",
    facts: facts({
      taskStatus: TASK_STATUS.BLOCKED,
      runs: [run({ status: RUN_STATUS.CANCELLED })],
    }),
    stage: GUIDED_STAGE.BLOCKED,
    recommended: GUIDED_ACTION.OPEN_REVIEW,
    includes: [GUIDED_ACTION.MARK_READY],
    blockers: [GUIDED_BLOCKER.TASK_BLOCKED],
  },
  {
    label: "Execution annulee avant toute capture de review",
    facts: facts({
      taskStatus: TASK_STATUS.BLOCKED,
      runs: [run({ status: RUN_STATUS.CANCELLED, hasReview: false })],
    }),
    stage: GUIDED_STAGE.BLOCKED,
    recommended: GUIDED_ACTION.OPEN_RUN,
    blockers: [GUIDED_BLOCKER.TASK_BLOCKED],
  },
  {
    label: "Execution ancienne sans review, tache echouee",
    facts: facts({
      taskStatus: TASK_STATUS.FAILED,
      runs: [run({ status: RUN_STATUS.FAILED, hasReview: false })],
    }),
    stage: GUIDED_STAGE.RUN_FAILED,
    recommended: GUIDED_ACTION.OPEN_RUN,
    includes: [GUIDED_ACTION.RETRY],
  },
  {
    label: "Tache bloquee a la main, sans execution",
    facts: facts({ taskStatus: TASK_STATUS.BLOCKED }),
    stage: GUIDED_STAGE.BLOCKED,
    recommended: null,
    includes: [GUIDED_ACTION.MARK_READY],
  },
];

describe("deriveGuidedWorkflowState", () => {
  for (const scenario of SCENARIOS) {
    it(scenario.label, () => {
      const state = deriveGuidedWorkflowState(scenario.facts);

      assert.equal(state.stage, scenario.stage, "stage");
      assert.equal(recommended(state), scenario.recommended, "action recommandee");

      for (const kind of scenario.includes ?? []) {
        assert.ok(alternatives(state).includes(kind), `alternative attendue : ${kind}`);
      }
      for (const kind of scenario.excludes ?? []) {
        assert.ok(!alternatives(state).includes(kind), `alternative interdite : ${kind}`);
        assert.notEqual(recommended(state), kind, `recommandation interdite : ${kind}`);
      }
      if (scenario.blockers !== undefined) {
        assert.deepEqual(blockerCodes(state).sort(), [...scenario.blockers].sort(), "blockers");
      }
      if (scenario.currentRun !== undefined) {
        assert.equal(state.currentRunId, scenario.currentRun, "execution courante");
      }

      // Chaque etat porte une raison : une recommandation opaque n'en est pas une.
      assert.ok(state.reason.length > 0, "raison presente");
      assert.ok(state.summary.length > 0, "resume present");
      assert.ok(isGuidedWorkflowStage(state.stage));
      assert.equal(state.progress.length, 5, "cinq etapes de progression");
    });
  }
});

describe("selection de l'execution courante", () => {
  it("prefere l'execution active a la plus recente", () => {
    const state = deriveGuidedWorkflowState(
      facts({
        taskStatus: TASK_STATUS.RUNNING,
        runs: [
          run({ id: "run-3", code: "RUN-003", status: RUN_STATUS.COMPLETED }),
          run({ id: "run-2", code: "RUN-002", status: RUN_STATUS.RUNNING }),
          run(),
        ],
      }),
    );
    assert.equal(state.currentRunId, "run-2");
  });

  it("prend la plus recente lorsque aucune n'est active", () => {
    const state = deriveGuidedWorkflowState(
      facts({
        taskStatus: TASK_STATUS.REVIEW,
        runs: [run({ id: "run-3", code: "RUN-003" }), run({ id: "run-2", code: "RUN-002" }), run()],
      }),
    );
    assert.equal(state.currentRunId, "run-3");
  });

  it("ne prend jamais RUN-001 quand RUN-003 existe", () => {
    const state = deriveGuidedWorkflowState(
      facts({ taskStatus: TASK_STATUS.REVIEW, runs: [run({ id: "run-3" }), run()] }),
    );
    assert.notEqual(state.currentRunId, "run-1");
  });
});

describe("analyses Architecte", () => {
  it("une tentative echouee n'efface pas la derniere analyse exploitable", () => {
    const state = deriveGuidedWorkflowState(
      facts({
        taskStatus: TASK_STATUS.REVIEW,
        runs: [run()],
        architect: {
          configured: true,
          latestCompleted: {
            id: "analysis-2",
            code: "ANALYSIS-2",
            verdict: ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED,
            blockers: [],
            hasFeedback: false,
          },
          lastAttemptFailed: true,
          active: false,
          analysesLeft: 2,
        },
      }),
    );

    assert.equal(state.stage, GUIDED_STAGE.ARCHITECT_REVIEW);
    assert.equal(recommended(state), GUIDED_ACTION.REVIEW_AND_APPROVE);
    assert.ok(state.reason.includes("ANALYSIS-2"), "l'analyse exploitable est nommee");
    assert.ok(state.reason.includes("echoue"), "l'echec de la derniere tentative est dit");
  });

  it("reprend les faits bloquants persistes de la garde de TASK-015", () => {
    const state = deriveGuidedWorkflowState(
      facts({
        taskStatus: TASK_STATUS.REVIEW,
        runs: [run()],
        architect: {
          configured: true,
          latestCompleted: {
            id: "analysis-1",
            code: "ANALYSIS-1",
            verdict: ARCHITECT_REVIEW_VERDICT.HUMAN_REVIEW_REQUIRED,
            blockers: [ARCHITECT_REVIEW_BLOCKER.TRUNCATED_PATCH],
            hasFeedback: false,
          },
          lastAttemptFailed: false,
          active: false,
          analysesLeft: 4,
        },
      }),
    );

    assert.deepEqual(state.architectBlockers, [ARCHITECT_REVIEW_BLOCKER.TRUNCATED_PATCH]);
  });

  it("n'attribue jamais l'analyse du parent a une correction", () => {
    // Les faits d'analyse portent sur l'execution courante : une correction
    // sans analyse propre repart de zero, quoi qu'ait dit le parent.
    const state = deriveGuidedWorkflowState(
      facts({
        taskStatus: TASK_STATUS.REVIEW,
        runs: [run({ id: "run-2", code: "RUN-002", kind: RUN_KIND.CORRECTION }), run()],
      }),
    );
    assert.equal(recommended(state), GUIDED_ACTION.ANALYZE_WITH_ARCHITECT);
    assert.equal(state.recommendedAction?.runId, "run-2");
  });
});

describe("checkpoints IA", () => {
  it("signale les actions qui appellent OpenAI", () => {
    assert.equal(guidedActionCallsOpenAI(GUIDED_ACTION.ANALYZE_WITH_ARCHITECT), true);
    assert.equal(guidedActionCallsOpenAI(GUIDED_ACTION.APPROVE), false);
    assert.equal(guidedActionCallsOpenAI(GUIDED_ACTION.MARK_READY), false);
    assert.equal(guidedActionCallsOpenAI(GUIDED_ACTION.REOPEN), false);
    assert.equal(guidedActionCallsOpenAI(GUIDED_ACTION.USE_AS_FEEDBACK), false);
  });

  it("signale les actions qui demarrent Claude Code", () => {
    assert.equal(guidedActionStartsClaude(GUIDED_ACTION.RUN_CLAUDE), true);
    assert.equal(guidedActionStartsClaude(GUIDED_ACTION.RESUME_CLAUDE), true);
    // La preparation d'une correction n'en fait pas partie : le lancement y
    // reste un second clic.
    assert.equal(guidedActionStartsClaude(GUIDED_ACTION.PREPARE_CORRECTION), false);
    assert.equal(guidedActionStartsClaude(GUIDED_ACTION.APPROVE), false);
    assert.equal(guidedActionStartsClaude(GUIDED_ACTION.OPEN_RUN), false);
  });
});

describe("progression", () => {
  it("marque la specification en cours sur un brouillon", () => {
    const progress = deriveGuidedWorkflowState(facts()).progress;
    assert.equal(progress[0]?.step, GUIDED_PROGRESS_STEP.SPECIFICATION);
    assert.equal(progress[0]?.state, "current");
    assert.equal(progress[4]?.state, "pending");
  });

  it("place la review en cours lorsque la tache attend une decision", () => {
    const progress = deriveGuidedWorkflowState(
      facts({ taskStatus: TASK_STATUS.REVIEW, runs: [run()] }),
    ).progress;
    assert.equal(progress[1]?.state, "done");
    assert.equal(progress[2]?.state, "current");
  });

  it("n'ajoute pas une etape par execution", () => {
    // Trois executions, cinq etapes : la progression repond « ou en sommes-nous »,
    // pas « qu'a-t-on fait ».
    const progress = deriveGuidedWorkflowState(
      facts({
        taskStatus: TASK_STATUS.REVIEW,
        runs: [
          run({ id: "run-3", code: "RUN-003", kind: RUN_KIND.CORRECTION }),
          run({ id: "run-2", code: "RUN-002", kind: RUN_KIND.CORRECTION }),
          run(),
        ],
      }),
    ).progress;
    assert.equal(progress.length, 5);
  });

  it("conserve la correction comme etape franchie sur une tache terminee", () => {
    const progress = deriveGuidedWorkflowState(
      facts({
        taskStatus: TASK_STATUS.COMPLETED,
        runs: [run({ id: "run-2", code: "RUN-002", kind: RUN_KIND.CORRECTION }), run()],
      }),
    ).progress;
    assert.equal(progress[3]?.state, "done");
    assert.equal(progress[4]?.state, "current");
  });
});

describe("purete", () => {
  it("cent appels ne modifient ni les entrees ni la sortie", () => {
    const input = facts({
      taskStatus: TASK_STATUS.REVIEW,
      runs: [run()],
      correction: {
        feedbackId: "fb-1",
        sourceRunId: "run-1",
        sourceRunCode: "RUN-001",
        excerpt: "Raccourcis l'introduction.",
        refusalDetail: null,
        readiness: { state: "ready" },
      },
    });
    const snapshot = JSON.stringify(input);
    const first = JSON.stringify(deriveGuidedWorkflowState(input));

    for (let index = 0; index < 100; index += 1) {
      assert.equal(JSON.stringify(deriveGuidedWorkflowState(input)), first);
    }

    assert.equal(JSON.stringify(input), snapshot, "les faits d'entree n'ont pas bouge");
  });

  it("ne depend d'aucune fonction globale asynchrone", () => {
    // Une derivation qui deviendrait asynchrone ne pourrait plus etre appelee
    // depuis un rendu sans effet de bord : le type de retour est la garantie.
    const result: GuidedWorkflowState = deriveGuidedWorkflowState(facts());
    assert.equal(typeof (result as unknown as { then?: unknown }).then, "undefined");
  });
});
