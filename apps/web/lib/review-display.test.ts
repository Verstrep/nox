import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RUN_STATUS,
  RUN_VALIDATION_STATUS,
  RUN_VALIDATION_SUMMARY,
  type RunFileChange,
} from "@nox/shared";

import {
  hasPartialChanges,
  isUnknownReviewFile,
  missingPatchMessage,
  missingPatchReason,
  reviewAvailability,
  reviewOutcomeNotice,
  reviewUnavailableMessage,
  reviewUrl,
  reviewValidationSummary,
  selectReviewFile,
  toPatchLines,
  validationSummaryTone,
} from "./review-display.ts";

function file(overrides: Partial<RunFileChange> = {}): RunFileChange {
  return {
    position: 0,
    path: "apps/web/lib/runs.ts",
    previousPath: null,
    changeType: "MODIFIED",
    additions: 2,
    deletions: 1,
    isBinary: false,
    isSensitive: false,
    isTruncated: false,
    patch: "@@ -1 +1 @@\n-a\n+b\n",
    ...overrides,
  };
}

describe("reviewUrl", () => {
  it("construit l'adresse de la review", () => {
    assert.equal(reviewUrl("p1", "t1", "r1"), "/projects/p1/tasks/t1/runs/r1/review");
  });

  it("encode le chemin du fichier selectionne", () => {
    assert.equal(
      reviewUrl("p1", "t1", "r1", "notes de version.md"),
      "/projects/p1/tasks/t1/runs/r1/review?file=notes%20de%20version.md",
    );
  });

  it("encode aussi les separateurs et les caracteres speciaux", () => {
    const url = reviewUrl("p1", "t1", "r1", "apps/web/lib/a&b.ts");
    assert.ok(url.endsWith("?file=apps%2Fweb%2Flib%2Fa%26b.ts"), url);
  });
});

describe("selectReviewFile", () => {
  const files = [file(), file({ position: 1, path: "README.md" })];

  it("selectionne le premier fichier par defaut", () => {
    assert.equal(selectReviewFile(files, undefined)?.path, "apps/web/lib/runs.ts");
    assert.equal(selectReviewFile(files, "")?.path, "apps/web/lib/runs.ts");
  });

  it("selectionne le fichier demande", () => {
    assert.equal(selectReviewFile(files, "README.md")?.path, "README.md");
  });

  it("ne selectionne rien pour un chemin absent de la review", () => {
    assert.equal(selectReviewFile(files, "inconnu.md"), null);
  });

  it("ne selectionne rien pour une valeur falsifiee", () => {
    // Aucune de ces valeurs ne doit ni etre corrigee, ni etre approchee, ni
    // atteindre un systeme de fichiers : elles ne correspondent a aucune ligne
    // enregistree, donc elles ne selectionnent rien.
    for (const forged of [
      "../../../etc/passwd",
      "C:/Windows/System32/config/SAM",
      "/etc/shadow",
      "apps/web/lib/runs.ts\0",
      "..%2f..%2fREADME.md",
      "apps/web/lib/",
    ]) {
      assert.equal(selectReviewFile(files, forged), null, forged);
    }
  });

  it("rend null quand la review est vide", () => {
    assert.equal(selectReviewFile([], undefined), null);
    assert.equal(selectReviewFile([], "README.md"), null);
  });
});

describe("isUnknownReviewFile", () => {
  const files = [file()];

  it("signale un chemin demande qui n'existe pas", () => {
    assert.equal(isUnknownReviewFile(files, "inconnu.md"), true);
    assert.equal(isUnknownReviewFile(files, "../../etc/passwd"), true);
  });

  it("ne signale rien quand aucun fichier n'est demande", () => {
    assert.equal(isUnknownReviewFile(files, undefined), false);
    assert.equal(isUnknownReviewFile(files, ""), false);
  });

  it("ne signale rien pour un chemin connu", () => {
    assert.equal(isUnknownReviewFile(files, "apps/web/lib/runs.ts"), false);
  });
});

describe("toPatchLines", () => {
  it("classe ajouts, suppressions et contexte", () => {
    const lines = toPatchLines("@@ -1,2 +1,2 @@\n contexte\n-avant\n+apres\n");

    assert.deepEqual(
      lines.map((line) => line.kind),
      ["hunk", "context", "deletion", "addition"],
    );
  });

  it("conserve le signe dans le texte", () => {
    const lines = toPatchLines("-avant\n+apres\n");

    // La couleur ne se prononce pas et disparait a l'impression : le signe reste.
    assert.equal(lines[0]?.text, "-avant");
    assert.equal(lines[1]?.text, "+apres");
  });

  it("ne confond pas les en-tetes avec des lignes ajoutees", () => {
    const lines = toPatchLines("--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+vrai ajout\n");

    assert.deepEqual(
      lines.map((line) => line.kind),
      ["meta", "meta", "hunk", "addition"],
    );
  });

  it("reconnait les autres lignes techniques", () => {
    const lines = toPatchLines("diff --git a/x b/x\nindex 111..222 100644\n\\ No newline\n");

    assert.ok(lines.every((line) => line.kind === "meta"));
  });

  it("ne fabrique pas de ligne vide finale", () => {
    assert.equal(toPatchLines("+une\n").length, 1);
    assert.equal(toPatchLines("").length, 0);
  });

  it("laisse le contenu hostile litteral", () => {
    const lines = toPatchLines("+<script>alert(1)</script>\n");

    // Le contenu n'est ni echappe ni transforme ici : c'est React qui echappe a
    // l'affichage. Ce qui compte est qu'aucune interpretation n'ait lieu.
    assert.equal(lines[0]?.text, "+<script>alert(1)</script>");
    assert.equal(lines[0]?.kind, "addition");
  });

  it("numerote les lignes de facon stable", () => {
    const lines = toPatchLines("+a\n+a\n+a\n");

    // Deux lignes identiques doivent rester deux cles React distinctes.
    assert.deepEqual(
      lines.map((line) => line.index),
      [0, 1, 2],
    );
  });
});

describe("missingPatchReason", () => {
  it("nomme d'abord le masquage volontaire", () => {
    // Un `.env` binaire reste avant tout un fichier masque : c'est une decision
    // de NOX, pas une impossibilite technique.
    assert.equal(
      missingPatchReason(file({ isSensitive: true, isBinary: true, patch: null })),
      "sensitive",
    );
  });

  it("reconnait un binaire", () => {
    assert.equal(missingPatchReason(file({ isBinary: true, patch: null })), "binary");
  });

  it("distingue un patch tronque d'un patch indisponible", () => {
    assert.equal(missingPatchReason(file({ patch: null, isTruncated: true })), "truncated");
    assert.equal(missingPatchReason(file({ patch: null })), "unavailable");
  });

  it("rend null quand le patch est la", () => {
    assert.equal(missingPatchReason(file()), null);
  });

  it("associe un message a chaque raison", () => {
    assert.equal(missingPatchMessage("sensitive"), "Sensitive file — content hidden");
    assert.equal(missingPatchMessage("binary"), "Binary file changed");
    assert.equal(missingPatchMessage("truncated"), "Diff truncated");
  });
});

describe("reviewAvailability", () => {
  it("reconnait une review disponible", () => {
    assert.equal(
      reviewAvailability(RUN_STATUS.COMPLETED, "2026-08-07T10:00:00.000Z", null),
      "available",
    );
  });

  it("reconnait une execution encore active", () => {
    assert.equal(reviewAvailability(RUN_STATUS.RUNNING, null, null), "active");
    assert.equal(reviewAvailability(RUN_STATUS.QUEUED, null, null), "active");
    assert.equal(reviewAvailability(RUN_STATUS.CANCELLING, null, null), "active");
  });

  it("reconnait une execution anterieure a la review integree", () => {
    assert.equal(reviewAvailability(RUN_STATUS.COMPLETED, null, null), "legacy");
    assert.equal(reviewAvailability(RUN_STATUS.CANCELLED, null, null), "legacy");
  });

  it("reconnait une capture ratee", () => {
    assert.equal(
      reviewAvailability(RUN_STATUS.COMPLETED, null, "CLAUDE_REVIEW_FAILED"),
      "failed",
    );
  });

  it("traite une execution inconnue du runner comme un ancien run", () => {
    // Le runner ne l'a jamais eue, ou a redemarre depuis : il n'y aura jamais
    // de review. Ce n'est pas une panne reparable, c'est une absence definitive.
    assert.equal(
      reviewAvailability(RUN_STATUS.COMPLETED, null, "CLAUDE_RUN_NOT_FOUND"),
      "legacy",
    );
  });

  it("fait primer une review capturee sur un echec anterieur", () => {
    assert.equal(
      reviewAvailability(RUN_STATUS.COMPLETED, "2026-08-07T10:00:00.000Z", "CLAUDE_REVIEW_FAILED"),
      "available",
    );
  });

  it("ne promet aucune review pour un ancien run", () => {
    const message = reviewUnavailableMessage("legacy");
    assert.equal(message, "Detailed review unavailable for this legacy run.");
  });

  it("explique une capture ratee sans accuser l'execution", () => {
    const message = reviewUnavailableMessage("failed");
    assert.ok(message.includes("restent valides"));
    assert.ok(message.includes("git diff"));
  });
});

describe("reviewOutcomeNotice", () => {
  it("ne dit rien pour une reussite", () => {
    assert.equal(reviewOutcomeNotice(RUN_STATUS.COMPLETED, false), null);
  });

  it("previent qu'une annulation laisse des changements partiels", () => {
    const notice = reviewOutcomeNotice(RUN_STATUS.CANCELLED, false);
    assert.ok(notice?.includes("interrompue"));
    assert.ok(notice?.includes("partiels"));
    assert.ok(notice?.includes("restaure aucun fichier"));
  });

  it("previent pour un echec et pour un blocage", () => {
    assert.ok(reviewOutcomeNotice(RUN_STATUS.FAILED, false)?.includes("partiels"));
    assert.ok(reviewOutcomeNotice(RUN_STATUS.BLOCKED, false)?.includes("partiels"));
  });

  it("fait primer la violation Git sur tout le reste", () => {
    const notice = reviewOutcomeNotice(RUN_STATUS.COMPLETED, true);
    assert.ok(notice?.includes("interdite"));
    assert.ok(notice?.includes("manuellement"));

    // Meme apres une annulation : le commit interdit est ce qu'il faut lire
    // d'abord.
    assert.equal(reviewOutcomeNotice(RUN_STATUS.CANCELLED, true), notice);
  });
});

describe("hasPartialChanges", () => {
  it("ne considere completes que les executions reussies", () => {
    assert.equal(hasPartialChanges(RUN_STATUS.COMPLETED), false);
    assert.equal(hasPartialChanges(RUN_STATUS.CANCELLED), true);
    assert.equal(hasPartialChanges(RUN_STATUS.FAILED), true);
    assert.equal(hasPartialChanges(RUN_STATUS.BLOCKED), true);
  });
});

describe("reviewValidationSummary", () => {
  it("derive l'etat global sans le stocker", () => {
    assert.equal(reviewValidationSummary([]), RUN_VALIDATION_SUMMARY.NONE);
    assert.equal(
      reviewValidationSummary([
        {
          position: 0,
          command: "npm run test",
          status: RUN_VALIDATION_STATUS.PASSED,
          exitCode: 0,
          summary: null,
          startedAt: null,
          finishedAt: null,
        },
        {
          position: 1,
          command: "npm run build",
          status: RUN_VALIDATION_STATUS.NOT_RUN,
          exitCode: null,
          summary: null,
          startedAt: null,
          finishedAt: null,
        },
      ]),
      RUN_VALIDATION_SUMMARY.INCOMPLETE,
    );
  });
});

describe("validationSummaryTone", () => {
  it("ne colore en vert que la reussite complete", () => {
    assert.equal(validationSummaryTone(RUN_VALIDATION_SUMMARY.PASSED), "positive");
    assert.equal(validationSummaryTone(RUN_VALIDATION_SUMMARY.FAILED), "negative");
    assert.equal(validationSummaryTone(RUN_VALIDATION_SUMMARY.INCOMPLETE), "neutral");
    assert.equal(validationSummaryTone(RUN_VALIDATION_SUMMARY.UNKNOWN), "neutral");
    assert.equal(validationSummaryTone(RUN_VALIDATION_SUMMARY.NONE), "neutral");
  });
});
