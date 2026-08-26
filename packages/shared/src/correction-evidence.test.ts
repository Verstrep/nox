/**
 * Les preuves transmises a une correction.
 *
 * ## Ce que ce fichier prouve
 *
 * Que ce que l'utilisateur allait recopier a la main y figure deja : le critere
 * qui a echoue, la commande qui le prouvait, son code de sortie, ses sorties.
 *
 * Que toute coupe est **annoncee**. Une sortie tronquee sans le dire ferait
 * chercher a Claude Code une erreur qui n'y est plus.
 *
 * Et qu'aucun secret, aucun chemin absolu et aucun diff n'entre dans ce texte —
 * non pas parce qu'ils sont filtres, mais parce qu'ils n'y arrivent jamais.
 *
 * Pur : aucune base, aucun disque, aucun processus.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CORRECTION_EVIDENCE_LIMITS,
  CORRECTION_SOURCE,
  CORRECTION_TRUNCATION_NOTICE,
  MAX_AUTOMATED_CORRECTION_ATTEMPTS,
  AUTONOMOUS_VALIDATION_STATUS,
  VERIFICATION_MODE,
  renderCorrectionEvidence,
  renderFrozenContract,
  type CorrectionEvidence,
} from "../dist/index.js";

function evidence(overrides: Partial<CorrectionEvidence> = {}): CorrectionEvidence {
  return {
    source: CORRECTION_SOURCE.AUTOMATED_VALIDATION,
    automatedAttempt: 1,
    maxAutomatedAttempts: MAX_AUTOMATED_CORRECTION_ATTEMPTS,
    failedCriteria: [
      {
        text: "La suite de tests passe.",
        verificationMode: VERIFICATION_MODE.AUTOMATED,
        commands: [
          {
            command: "npm run test",
            status: AUTONOMOUS_VALIDATION_STATUS.FAILED,
            exitCode: 1,
            durationMs: 4_000,
            stdout: "3 tests, 1 echec",
            stdoutTruncated: false,
            stderr: "AssertionError: attendu 2, obtenu 3",
            stderrTruncated: false,
          },
        ],
      },
    ],
    humanCriteria: [],
    repositoryMutated: false,
    mutatedFiles: [],
    humanFeedback: null,
    ...overrides,
  };
}

describe("preuves d'une correction automatique", () => {
  it("nomme la source, le rang et la borne", () => {
    const text = renderCorrectionEvidence(evidence());
    assert.match(text, /validation autonome de NOX/u);
    assert.match(text, /tentative 1 sur 2/u);
  });

  it("dit que personne n'a relu", () => {
    const text = renderCorrectionEvidence(evidence());
    assert.match(text, /Personne n'a relu/u);
  });

  it("porte le critere, la commande, le code de sortie et les deux flux", () => {
    const text = renderCorrectionEvidence(evidence());
    assert.match(text, /La suite de tests passe\./u);
    assert.match(text, /npm run test/u);
    assert.match(text, /code de sortie : 1/u);
    assert.match(text, /3 tests, 1 echec/u);
    assert.match(text, /AssertionError: attendu 2, obtenu 3/u);
  });

  it("distingue un echec d'un depassement de delai et d'une commande non lancee", () => {
    const failed = renderCorrectionEvidence(evidence());
    assert.match(failed, /resultat : en echec/u);

    const timedOut = renderCorrectionEvidence(
      evidence({
        failedCriteria: [
          {
            text: "Critere",
            verificationMode: VERIFICATION_MODE.AUTOMATED,
            commands: [
              {
                command: "npm run test",
                status: AUTONOMOUS_VALIDATION_STATUS.TIMED_OUT,
                exitCode: null,
                durationMs: null,
                stdout: null,
                stdoutTruncated: false,
                stderr: null,
                stderrTruncated: false,
              },
            ],
          },
        ],
      }),
    );
    assert.match(timedOut, /arretee par le delai/u);

    const errored = renderCorrectionEvidence(
      evidence({
        failedCriteria: [
          {
            text: "Critere",
            verificationMode: VERIFICATION_MODE.AUTOMATED,
            commands: [
              {
                command: "npm run test",
                status: AUTONOMOUS_VALIDATION_STATUS.ERROR,
                exitCode: null,
                durationMs: null,
                stdout: null,
                stdoutTruncated: false,
                stderr: null,
                stderrTruncated: false,
              },
            ],
          },
        ],
      }),
    );
    assert.match(errored, /non executee/u);
  });

  it("dit « (vide) » plutot que de laisser un blanc", () => {
    const text = renderCorrectionEvidence(
      evidence({
        failedCriteria: [
          {
            text: "Critere",
            verificationMode: VERIFICATION_MODE.AUTOMATED,
            commands: [
              {
                command: "npm run build",
                status: AUTONOMOUS_VALIDATION_STATUS.FAILED,
                exitCode: 2,
                durationMs: null,
                stdout: null,
                stdoutTruncated: false,
                stderr: "",
                stderrTruncated: false,
              },
            ],
          },
        ],
      }),
    );
    assert.match(text, /stdout : \(vide\)/u);
    assert.match(text, /stderr : \(vide\)/u);
  });
});

describe("bornes et troncature", () => {
  it("annonce une coupe faite ici", () => {
    const long = "x".repeat(CORRECTION_EVIDENCE_LIMITS.perStream + 500);
    const text = renderCorrectionEvidence(
      evidence({
        failedCriteria: [
          {
            text: "Critere",
            verificationMode: VERIFICATION_MODE.AUTOMATED,
            commands: [
              {
                command: "npm run test",
                status: AUTONOMOUS_VALIDATION_STATUS.FAILED,
                exitCode: 1,
                durationMs: null,
                stdout: long,
                stdoutTruncated: false,
                stderr: null,
                stderrTruncated: false,
              },
            ],
          },
        ],
      }),
    );
    assert.ok(text.includes(CORRECTION_TRUNCATION_NOTICE));
    assert.equal(text.includes("x".repeat(CORRECTION_EVIDENCE_LIMITS.perStream + 1)), false);
  });

  it("annonce aussi une coupe deja subie a la capture", () => {
    const text = renderCorrectionEvidence(
      evidence({
        failedCriteria: [
          {
            text: "Critere",
            verificationMode: VERIFICATION_MODE.AUTOMATED,
            commands: [
              {
                command: "npm run test",
                status: AUTONOMOUS_VALIDATION_STATUS.FAILED,
                exitCode: 1,
                durationMs: null,
                stdout: "court",
                stdoutTruncated: true,
                stderr: null,
                stderrTruncated: false,
              },
            ],
          },
        ],
      }),
    );
    assert.match(text, /deja tronquee a la capture/u);
  });
});

describe("mutation du repository", () => {
  it("nomme la mutation, les fichiers, et interdit de restaurer", () => {
    const text = renderCorrectionEvidence(
      evidence({ repositoryMutated: true, mutatedFiles: ["README.md", "src/app.ts"] }),
    );
    assert.match(text, /modifie des fichiers suivis par Git/u);
    assert.match(text, /README\.md/u);
    assert.match(text, /src\/app\.ts/u);
    assert.match(text, /Ne restaure rien toi-meme/u);
  });

  it("borne la liste et annonce le reste", () => {
    const files = Array.from({ length: CORRECTION_EVIDENCE_LIMITS.mutatedFiles + 5 }, (_, index) =>
      `fichier-${String(index)}.ts`,
    );
    const text = renderCorrectionEvidence(evidence({ repositoryMutated: true, mutatedFiles: files }));
    assert.match(text, /5 autre\(s\) fichier\(s\) non listes/u);
  });

  it("ne dit rien quand rien n'a bouge", () => {
    const text = renderCorrectionEvidence(evidence());
    assert.equal(text.includes("modifie des fichiers suivis"), false);
  });

  it("annonce la mutation meme sans savoir quels fichiers", () => {
    const text = renderCorrectionEvidence(evidence({ repositoryMutated: true, mutatedFiles: [] }));
    assert.match(text, /modifie des fichiers suivis par Git/u);
    assert.equal(text.includes("fichiers suivis concernes"), false);
  });
});

describe("correction demandee par un humain", () => {
  it("annonce l'origine humaine, sans numero de tentative", () => {
    const text = renderCorrectionEvidence(
      evidence({ source: CORRECTION_SOURCE.HUMAN_FEEDBACK, automatedAttempt: 0 }),
    );
    assert.match(text, /demande humaine apres relecture/u);
    assert.equal(text.includes("tentative 0"), false);
  });

  it("mentionne les preuves automatisees quand il y en a", () => {
    const text = renderCorrectionEvidence(
      evidence({ source: CORRECTION_SOURCE.HUMAN_FEEDBACK, automatedAttempt: 0 }),
    );
    assert.match(text, /preuves automatisees ci-dessous ont egalement echoue/u);
  });

  it("porte les criteres humains signales et leur instruction", () => {
    const text = renderCorrectionEvidence(
      evidence({
        source: CORRECTION_SOURCE.HUMAN_FEEDBACK,
        automatedAttempt: 0,
        failedCriteria: [],
        humanCriteria: [
          { text: "Navigation clavier claire.", instructions: "Tabuler du champ au bouton Save." },
        ],
      }),
    );
    assert.match(text, /Navigation clavier claire\./u);
    assert.match(text, /Tabuler du champ au bouton Save\./u);
  });
});

describe("contrat gele", () => {
  it("recopie chaque critere avec son mode", () => {
    const text = renderFrozenContract(
      [
        { text: "Les tests passent.", verificationMode: VERIFICATION_MODE.AUTOMATED },
        { text: "L'ecran est lisible.", verificationMode: VERIFICATION_MODE.HUMAN },
      ],
      ["npm run test"],
    );
    assert.match(text, /Les tests passent\. \(verifie par commande\)/u);
    assert.match(text, /L'ecran est lisible\. \(verifie par un humain\)/u);
    assert.match(text, /npm run test/u);
  });

  it("omet la liste des commandes quand il n'y en a aucune", () => {
    const text = renderFrozenContract(
      [{ text: "L'ecran est lisible.", verificationMode: VERIFICATION_MODE.HUMAN }],
      [],
    );
    assert.equal(text.includes("Commandes de validation enregistrees"), false);
  });
});
