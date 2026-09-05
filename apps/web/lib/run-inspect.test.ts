import type { AutonomousValidationBatchRow, AutonomousValidationResultRow } from "@nox/database";
import {
  AUTONOMOUS_VALIDATION_STATUS,
  RUN_VALIDATION_STATUS,
  VALIDATION_BATCH_STATUS,
  type RunValidationResultView,
} from "@nox/shared";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { formatDuration, formatReportedCost, shortSha } from "./run-display.ts";
import {
  CLAUDE_OBSERVATION_NOTICE,
  DELIVERY_INDEPENDENCE_NOTICE,
  UNRECORDED,
  attemptProducedEvidence,
  chainEntryLabel,
  claudeObservationLabel,
  claudeObservations,
  deliveryFacts,
  executionFacts,
  inspectAttempts,
  inspectChain,
} from "./run-inspect.ts";

const FORMAT = {
  duration: formatDuration,
  cost: formatReportedCost,
  sha: shortSha,
  dateTime: (value: string) => (value === "" ? null : value),
};

function facts(overrides: Record<string, unknown> = {}) {
  return executionFacts(
    {
      runCode: "RUN-001",
      taskCode: "TASK-002",
      taskTitle: "Gérer les notes de frais",
      projectName: "TripKit",
      status: "Completed",
      kind: "INITIAL",
      branch: "main",
      headBefore: "abcdef1234567890",
      headAfter: "abcdef1234567890",
      startedAt: "2026-09-01T10:00:00.000Z",
      finishedAt: "2026-09-01T10:12:00.000Z",
      durationMs: 720_000,
      durationApiMs: 610_000,
      numTurns: 42,
      exitCode: 0,
      reportedCostUsd: 1.234,
      sessionId: "session-abc",
      errorCode: null,
      ...overrides,
    } as Parameters<typeof executionFacts>[0],
    FORMAT,
  );
}

function valueOf(rows: readonly { label: string; value: string | null }[], label: string) {
  const found = rows.find((row) => row.label === label);
  assert.notEqual(found, undefined, `fait absent : ${label}`);
  return found?.value ?? null;
}

function result(
  overrides: Partial<AutonomousValidationResultRow> = {},
): AutonomousValidationResultRow {
  return {
    id: "r1",
    position: 0,
    commandId: "c1",
    command: "npm test",
    status: AUTONOMOUS_VALIDATION_STATUS.PASSED,
    exitCode: 0,
    durationMs: 4200,
    stdout: "ok",
    stdoutTruncated: false,
    stderr: null,
    stderrTruncated: false,
    ...overrides,
  };
}

function batch(overrides: Partial<AutonomousValidationBatchRow> = {}): AutonomousValidationBatchRow {
  return {
    id: "b1",
    runId: "run-1",
    attempt: 1,
    status: VALIDATION_BATCH_STATUS.PASSED,
    createdAt: new Date("2026-09-01T10:12:00.000Z"),
    startedAt: new Date("2026-09-01T10:12:01.000Z"),
    completedAt: new Date("2026-09-01T10:12:30.000Z"),
    errorCode: null,
    errorMessage: null,
    trackedStateBefore: "sha-a",
    trackedStateAfter: "sha-a",
    mutatedFiles: [],
    results: [result()],
    ...overrides,
  };
}

/**
 * ## Cas 1 — une execution ordinaire qui s'est bien passee
 */
describe("Inspect — resume d'execution", () => {
  it("expose les faits techniques que NOX a enregistres", () => {
    const rows = facts();

    assert.equal(valueOf(rows, "Run"), "RUN-001");
    assert.equal(valueOf(rows, "Repository"), "TripKit");
    assert.equal(valueOf(rows, "Branche"), "main");
    assert.equal(valueOf(rows, "Tours"), "42");
    assert.equal(valueOf(rows, "Code de sortie"), "0");
    assert.equal(valueOf(rows, "Session Claude"), "session-abc");
    assert.equal(valueOf(rows, "Durée"), "12 min 00 s");
    assert.equal(valueOf(rows, "Coût rapporté"), "1.2340 $");
  });

  it("n'affiche jamais le chemin absolu du repository", () => {
    // Un chemin absolu nomme un disque, un utilisateur et une organisation de
    // machine. Le nom du projet repond a la meme question sans rien reveler.
    const rows = facts();
    const serialized = JSON.stringify(rows);

    assert.equal(serialized.includes("D:"), false);
    assert.equal(serialized.includes("/home/"), false);
    assert.equal(serialized.includes("Projets"), false);
  });

  it("dit qu'une information manque plutot que de laisser une case vide", () => {
    const rows = facts({
      numTurns: null,
      reportedCostUsd: null,
      sessionId: null,
      branch: null,
    });

    // `null` traverse jusqu'au rendu, qui l'affiche « Non enregistré ». NOX
    // n'estime jamais un cout ni un nombre de tours.
    assert.equal(valueOf(rows, "Tours"), null);
    assert.equal(valueOf(rows, "Coût rapporté"), null);
    assert.equal(valueOf(rows, "Session Claude"), null);
    assert.equal(UNRECORDED.length > 0, true);
  });

  it("montre HEAD avant et apres separement", () => {
    // Claude Code ne commite pas : les deux doivent etre identiques. Les
    // afficher separement est ce qui rendrait une difference visible.
    const rows = facts({ headAfter: "0000111122223333" });

    assert.notEqual(valueOf(rows, "HEAD avant"), valueOf(rows, "HEAD après"));
    assert.equal(valueOf(rows, "HEAD avant"), "abcdef123456");
  });
});

/**
 * ## Cas 2 — le cas reel TripKit / HOTFIX-002
 *
 * Tentative 1 : `VALIDATION_SPAWN_FAILED`, diagnostic `ENOENT`.
 * Tentative 2 : `npm test`, exit 0, passee.
 */
describe("Inspect — tentatives de validation", () => {
  const spawnFailed = batch({
    id: "b1",
    attempt: 1,
    status: VALIDATION_BATCH_STATUS.ERROR,
    errorCode: "VALIDATION_SPAWN_FAILED",
    errorMessage:
      "Le systeme a refuse de demarrer la commande de validation. Code systeme : ENOENT.",
    results: [],
  });
  const retried = batch({ id: "b2", attempt: 2 });

  it("conserve la tentative en echec et montre la reprise", () => {
    const attempts = inspectAttempts(retried, [spawnFailed]);

    assert.equal(attempts.length, 2);
    assert.equal(attempts[0]?.attempt, 1);
    assert.equal(attempts[0]?.errorCode, "VALIDATION_SPAWN_FAILED");
    assert.equal(attempts[1]?.attempt, 2);
    assert.equal(attempts[1]?.status, VALIDATION_BATCH_STATUS.PASSED);
  });

  it("les ordonne de la premiere a la derniere, contrairement au reste de NOX", () => {
    // Ailleurs, la tentative courante prime parce qu'elle decide. Ici on
    // raconte : une panne se lit dans l'ordre ou elle s'est produite.
    const attempts = inspectAttempts(retried, [spawnFailed]);

    assert.deepEqual(
      attempts.map((entry) => entry.attempt),
      [1, 2],
    );
  });

  it("porte le diagnostic sûr, et rien du message de Node", () => {
    const attempts = inspectAttempts(retried, [spawnFailed]);
    const message = attempts[0]?.errorMessage ?? "";

    assert.equal(message.includes("ENOENT"), true);
    // Le message d'origine de Node porterait le chemin absolu de l'executable.
    // HOTFIX-002 l'a remplace par le seul code systeme, et Inspect affiche ce
    // champ-la — jamais une trace.
    assert.equal(message.includes("spawn "), false);
    assert.equal(message.includes("Program Files"), false);
    assert.equal(/[A-Za-z]:[/\\]/u.test(message), false);
  });

  it("distingue « je n'ai pas pu regarder » de « j'ai regarde »", () => {
    const attempts = inspectAttempts(retried, [spawnFailed]);

    assert.equal(attemptProducedEvidence(attempts[0] as never), false);
    assert.equal(attemptProducedEvidence(attempts[1] as never), true);
  });

  it("n'invente aucune tentative quand aucun lot n'a eu lieu", () => {
    assert.deepEqual(inspectAttempts(null, []), []);
  });

  it("affiche une tentative unique sans exiger d'historique", () => {
    assert.equal(inspectAttempts(retried, []).length, 1);
  });
});

/**
 * ## Cas 3 et 4 — ce que Claude Code a lance
 */
describe("Inspect — observation des commandes de Claude Code", () => {
  function view(overrides: Partial<RunValidationResultView> = {}): RunValidationResultView {
    return {
      position: 0,
      command: "npm test",
      status: RUN_VALIDATION_STATUS.NOT_RUN,
      exitCode: null,
      summary: null,
      startedAt: null,
      finishedAt: null,
      ...overrides,
    };
  }

  it("dit « aucune execution litterale observee », jamais « non lancee »", () => {
    // Le pilote a marque `npm test` non lancee alors que l'agent l'avait lancee
    // sous la forme `npm test 2>&1 | tail -60`. Le refus etait correct — dans
    // un tuyau, le code de sortie observable est celui de `tail` — mais la
    // phrase affirmait plus que ce que NOX savait.
    const [observation] = claudeObservations([view()]);

    assert.equal(observation?.observedExactly, false);
    assert.equal(claudeObservationLabel(observation as never), "Aucune exécution littérale observée");
    assert.equal(claudeObservationLabel(observation as never).includes("passed"), false);
  });

  it("reconnait une execution litterale, et reste informative", () => {
    const [observation] = claudeObservations([
      view({ status: RUN_VALIDATION_STATUS.PASSED, exitCode: 0 }),
    ]);

    assert.equal(observation?.observedExactly, true);
    assert.equal(claudeObservationLabel(observation as never), "Lancée · PASSED · exit 0");
  });

  it("ne tranche pas une issue ambigue", () => {
    const [observation] = claudeObservations([view({ status: RUN_VALIDATION_STATUS.UNKNOWN })]);

    assert.equal(claudeObservationLabel(observation as never), "Lancée, issue indéterminée");
  });

  it("conserve l'ordre d'enregistrement des commandes", () => {
    const observations = claudeObservations([
      view({ position: 2, command: "npm run build" }),
      view({ position: 0, command: "npm test" }),
      view({ position: 1, command: "npm run lint" }),
    ]);

    assert.deepEqual(
      observations.map((entry) => entry.command),
      ["npm test", "npm run lint", "npm run build"],
    );
  });

  it("porte toujours l'avertissement qui separe information et preuve", () => {
    assert.equal(CLAUDE_OBSERVATION_NOTICE.includes("Informatif"), true);
    assert.equal(CLAUDE_OBSERVATION_NOTICE.includes("NOX a exécutées lui-même"), true);
  });

  it("ne dit rien quand aucune commande n'etait enregistree", () => {
    assert.deepEqual(claudeObservations([]), []);
  });
});

/**
 * ## Cas 5 — la chaine de corrections
 */
describe("Inspect — chaine de corrections", () => {
  const chain = [
    { id: "run-1", code: "RUN-001", status: "COMPLETED" },
    { id: "run-2", code: "RUN-002", status: "COMPLETED" },
  ];

  it("nomme l'execution initiale et ses corrections", () => {
    const rows = inspectChain(chain, "run-2");

    assert.equal(chainEntryLabel(rows[0] as never), "Initial run");
    assert.equal(chainEntryLabel(rows[1] as never), "Correction 1");
  });

  it("marque l'execution inspectee", () => {
    const rows = inspectChain(chain, "run-2");

    assert.equal(rows[0]?.current, false);
    assert.equal(rows[1]?.current, true);
  });

  it("rend un seul maillon pour une execution jamais corrigee", () => {
    assert.equal(inspectChain([chain[0] as never], "run-1").length, 1);
  });
});

/**
 * ## Cas 6 — la livraison
 */
describe("Inspect — livraison Git", () => {
  it("dit la politique meme sans livraison enregistree", () => {
    // C'est la reponse a « pourquoi rien n'a ete commite ». Une carte absente
    // laisse chercher un bug ; une carte qui dit « Manual » repond.
    const rows = deliveryFacts({ policyLabel: "Manual", delivery: null });

    assert.equal(valueOf(rows, "Politique"), "Manual");
    assert.equal(valueOf(rows, "Livraison"), "Aucune");
  });

  it("expose un commit poussé", () => {
    const rows = deliveryFacts({
      policyLabel: "Auto commit & push",
      delivery: {
        statusLabel: "Pushed",
        triggerLabel: "Delivered by project policy",
        commitSha: "abcdef123456",
        pushedAt: new Date("2026-09-01T10:20:00.000Z"),
        attempt: 1,
        errorCode: null,
      },
    });

    assert.equal(valueOf(rows, "État"), "Pushed");
    assert.equal(valueOf(rows, "Commit"), "abcdef123456");
  });

  it("expose un push refusé sans effacer le commit local", () => {
    const rows = deliveryFacts({
      policyLabel: "Auto commit & push",
      delivery: {
        statusLabel: "Commit created, push failed",
        triggerLabel: "Delivered by project policy",
        commitSha: "abcdef123456",
        pushedAt: null,
        attempt: 2,
        errorCode: "DELIVERY_PUSH_REJECTED",
      },
    });

    assert.equal(valueOf(rows, "Commit"), "abcdef123456");
    assert.equal(valueOf(rows, "Poussé"), null);
    assert.equal(valueOf(rows, "Code d'erreur"), "DELIVERY_PUSH_REJECTED");
  });

  it("rappelle qu'un échec de livraison n'est pas un échec fonctionnel", () => {
    assert.equal(DELIVERY_INDEPENDENCE_NOTICE.includes("distinct"), true);
    assert.equal(DELIVERY_INDEPENDENCE_NOTICE.includes("jamais"), true);
  });
});

/**
 * ## Securite
 *
 * Ces tests lisent la **source** des deux modules d'inspection. Une garantie
 * qu'on verifie sur un rendu se contourne au prochain champ ajoute ; une
 * garantie qu'on verifie sur le texte du module tient tant que le module
 * existe.
 */
describe("Inspect — redaction", () => {
  // Resolus depuis ce fichier, jamais depuis le repertoire courant : le lanceur
  // de tests s'execute a la racine du monorepo, et un chemin relatif y
  // pointerait a cote — un test de securite qui ne trouve pas son fichier
  // echoue bruyamment, ce qui est le bon comportement, mais autant lui donner
  // le bon chemin.
  const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const modules = [
    path.join(WEB_ROOT, "lib", "run-inspect.ts"),
    path.join(
      WEB_ROOT,
      "app/projects/[id]/tasks/[taskId]/runs/[runId]/inspect/page.tsx",
    ),
  ];

  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
  }

  it("ne lit aucune variable d'environnement", () => {
    for (const path of modules) {
      const source = withoutComments(readFileSync(path, "utf8"));
      assert.equal(source.includes("process.env"), false, path);
      assert.equal(source.includes("NOX_RUNNER_TOKEN"), false, path);
      assert.equal(source.includes("NOX_OPENAI_API_KEY"), false, path);
      assert.equal(source.includes("Authorization"), false, path);
    }
  });

  it("n'affiche ni trace d'exception, ni charge brute du fournisseur", () => {
    for (const path of modules) {
      const source = withoutComments(readFileSync(path, "utf8"));
      assert.equal(source.includes(".stack"), false, path);
      assert.equal(source.includes("providerJson"), false, path);
      assert.equal(source.includes("apiKey"), false, path);
    }
  });

  it("n'affiche pas le chemin du repository", () => {
    for (const path of modules) {
      const source = withoutComments(readFileSync(path, "utf8"));
      assert.equal(source.includes("repositoryPath"), false, path);
    }
  });

  it("ne charge pas le compte rendu final de Claude Code", () => {
    // Une page de diagnostic n'a pas besoin du transcript : les metadonnees
    // structurees suffisent, et le rapport se lit sur la page de l'execution.
    for (const path of modules) {
      const source = withoutComments(readFileSync(path, "utf8"));
      assert.equal(source.includes("resultText"), false, path);
    }
  });

  it("n'ecrit rien : Inspect est en lecture seule", () => {
    for (const path of modules) {
      const source = withoutComments(readFileSync(path, "utf8"));
      for (const forbidden of ["<form", "runDelivery", "applyTaskTransition", "advanceQueue"]) {
        assert.equal(source.includes(forbidden), false, `${path} — ${forbidden}`);
      }
    }
  });
});
