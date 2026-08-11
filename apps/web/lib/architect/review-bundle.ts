/**
 * Construction du bundle de review envoye a l'Architecte.
 *
 * ## Uniquement de l'histoire enregistree
 *
 * Rien ici n'ouvre un fichier, ne lance `git diff` et n'interroge le runner. Les
 * sources sont la specification de la tache, les colonnes de l'execution et
 * l'instantane immuable de TASK-011 — tous deja en base. Une review raconte ce
 * que Claude Code avait produit a la fin de ce run ; une modification faite
 * depuis — ce que NOX encourage — ne doit jamais reecrire ce qui est envoye.
 *
 * ## Des bornes propres, plus serrees que celles du stockage
 *
 * `REVIEW_LIMITS` protege SQLite et la page : 200 fichiers, 4 Mio de patches.
 * `ARCHITECT_REVIEW_LIMITS` decide de ce qui **quitte la machine** et de ce qui
 * est facture : 100 fichiers, 512 Kio. Une review qui deborde de la seconde est
 * parfaitement lisible en local ; elle n'a simplement pas a partir entiere.
 *
 * ## Une selection tronquee se dit
 *
 * Des que le bundle contient moins que la review, `truncated` passe a vrai et la
 * garde interdit une recommandation d'approbation. L'ordre reste celui de la
 * capture — jamais « les fichiers les plus interessants » : une heuristique
 * produirait une review differente selon les gouts du code, et personne ne
 * saurait pourquoi.
 */

import {
  ARCHITECT_REVIEW_LIMITS,
  ARCHITECT_REVIEW_SCHEMA_VERSION,
  REVIEW_PATCH_STATE,
  RUN_STATUS,
  RUN_VALIDATION_STATUS,
  summarizeRunValidations,
  totalRunReview,
  type ArchitectReviewBundle,
  type ArchitectReviewFacts,
  type ArchitectReviewManifest,
  type ReviewPatchState,
  type ReviewPromptFile,
  type ReviewPromptValidation,
  type DevelopmentTaskDetail,
  type RunFileChange,
  type RunKind,
  type RunStatus,
  type RunValidationResultView,
} from "@nox/shared";

import { architectTaskRevision } from "./fingerprint.ts";
import type { ArchitectSanitizer } from "./sanitize.ts";

/** Code d'erreur pose par le runner quand l'etat Git a bouge pendant l'execution. */
export const GIT_POLICY_VIOLATION = "GIT_POLICY_VIOLATION";

/** L'execution relue, telle que le bundle en a besoin. */
export type ArchitectReviewRun = {
  code: string;
  kind: RunKind;
  /** Code de l'execution corrigee, ou `null` pour un run initial. */
  parentRunCode: string | null;
  status: RunStatus;
  durationMs: number | null;
  headBefore: string | null;
  headAfter: string | null;
  /** Code d'erreur de l'execution ; seul `GIT_POLICY_VIOLATION` est interprete. */
  errorCode: string | null;
};

/** L'instantane de review, tel que la base le rend. */
export type ArchitectReviewSnapshot = {
  capturedAt: string | null;
  errorCode: string | null;
  omittedFiles: number;
  files: readonly RunFileChange[];
  validations: readonly RunValidationResultView[];
};

export type BuildArchitectReviewInput = {
  runId: string;
  task: DevelopmentTaskDetail;
  run: ArchitectReviewRun;
  review: ArchitectReviewSnapshot;
  /** Nettoyeur de prose : chemins rendus relatifs, secrets masques. */
  sanitize: ArchitectSanitizer;
  /** Nettoyeur de patches : preserve la structure du diff. */
  sanitizePatch: ArchitectSanitizer;
};

export type BuiltArchitectReview = {
  bundle: ArchitectReviewBundle;
  manifest: ArchitectReviewManifest;
  facts: ArchitectReviewFacts;
  /**
   * Chemins contre lesquels les observations sont verifiees.
   *
   * Ce sont ceux de la review **enregistree**, pas seulement ceux transmis : un
   * fichier ecarte par la borne existe bel et bien, et le nommer n'est pas
   * l'inventer. Il reste que le modele ne peut citer que ce qu'il a vu — et
   * qu'une troncature interdit deja toute recommandation d'approbation.
   */
  filePaths: string[];
  criteriaCount: number;
};

/** Un fichier sans patch : la raison est dite, jamais un `null` muet. */
function unavailableState(file: RunFileChange): ReviewPatchState | null {
  if (file.isSensitive) {
    return REVIEW_PATCH_STATE.SENSITIVE_HIDDEN;
  }
  if (file.isBinary) {
    return REVIEW_PATCH_STATE.BINARY_UNAVAILABLE;
  }
  if (file.patch === null) {
    return file.isTruncated ? REVIEW_PATCH_STATE.TRUNCATED : REVIEW_PATCH_STATE.UNAVAILABLE;
  }
  return null;
}

type PatchBudget = { used: number; truncated: boolean };

/** Prepare le patch d'un fichier, dans la limite du budget restant. */
function takePatch(
  file: RunFileChange,
  sanitizePatch: ArchitectSanitizer,
  budget: PatchBudget,
): { state: ReviewPatchState; patch: string | null } {
  const missing = unavailableState(file);
  if (missing !== null || file.patch === null) {
    return { state: missing ?? REVIEW_PATCH_STATE.UNAVAILABLE, patch: null };
  }

  const sanitized = sanitizePatch(file.patch);
  const room = Math.min(
    ARCHITECT_REVIEW_LIMITS.patchPerFile,
    ARCHITECT_REVIEW_LIMITS.patchTotal - budget.used,
  );

  if (room <= 0) {
    budget.truncated = true;
    return { state: REVIEW_PATCH_STATE.OMITTED_BY_LIMIT, patch: null };
  }

  if (sanitized.length > room) {
    budget.used += room;
    budget.truncated = true;
    return { state: REVIEW_PATCH_STATE.TRUNCATED, patch: sanitized.slice(0, room) };
  }

  budget.used += sanitized.length;
  return {
    // Un patch complet pour NOX peut avoir ete coupe a la capture : la
    // troncature de TASK-011 reste vraie, et se dit ici aussi.
    state: file.isTruncated ? REVIEW_PATCH_STATE.TRUNCATED : REVIEW_PATCH_STATE.INCLUDED,
    patch: sanitized,
  };
}

/** Prepare les resumes de validation, dans la limite du budget commun. */
function takeValidations(
  validations: readonly RunValidationResultView[],
  sanitize: ArchitectSanitizer,
  budget: { used: number; truncated: boolean },
): ReviewPromptValidation[] {
  return validations.map((validation) => {
    let summary: string | null = null;

    if (validation.summary !== null && validation.summary.trim() !== "") {
      const cleaned = sanitize(validation.summary);
      const room = ARCHITECT_REVIEW_LIMITS.validationChars - budget.used;
      if (room <= 0) {
        budget.truncated = true;
      } else if (cleaned.length > room) {
        summary = cleaned.slice(0, room);
        budget.used += room;
        budget.truncated = true;
      } else {
        summary = cleaned;
        budget.used += cleaned.length;
      }
    }

    return {
      command: validation.command,
      status: validation.status,
      exitCode: validation.exitCode,
      summary,
    };
  });
}

/**
 * Assemble le bundle, son manifest et les faits qui gouvernent la garde.
 *
 * Deterministe : memes lignes en base, meme bundle et meme empreinte. C'est ce
 * qui permet a la preview d'afficher le texte reel plutot qu'une approximation,
 * et a l'envoi de verifier qu'il part bien avec ce qui a ete relu.
 */
export function buildArchitectReviewBundle(
  input: BuildArchitectReviewInput,
): BuiltArchitectReview {
  const totals = totalRunReview([...input.review.files]);

  const selected = input.review.files.slice(0, ARCHITECT_REVIEW_LIMITS.files);
  const patchBudget: PatchBudget = { used: 0, truncated: false };
  const validationBudget = { used: 0, truncated: false };

  const files: ReviewPromptFile[] = selected.map((file) => {
    const { state, patch } = takePatch(file, input.sanitizePatch, patchBudget);
    return {
      path: file.path,
      previousPath: file.previousPath,
      changeType: file.changeType,
      additions: file.additions,
      deletions: file.deletions,
      patchState: state,
      patch,
    };
  });

  const validations = takeValidations(input.review.validations, input.sanitize, validationBudget);

  const truncated =
    selected.length < input.review.files.length ||
    patchBudget.truncated ||
    validationBudget.truncated;

  const bundle: ArchitectReviewBundle = {
    task: {
      code: input.task.code,
      title: input.sanitize(input.task.title),
      priority: input.task.priority,
      objective: input.sanitize(input.task.objective),
      context: input.task.context === null ? null : input.sanitize(input.task.context),
      outOfScope: input.task.outOfScope === null ? null : input.sanitize(input.task.outOfScope),
      acceptanceCriteria: input.task.acceptanceCriteria.map((entry) => input.sanitize(entry)),
      documentReferences: [...input.task.documentReferences],
      validationCommands: [...input.task.validationCommands],
    },
    run: {
      code: input.run.code,
      kind: input.run.kind,
      parentRunCode: input.run.parentRunCode,
      status: input.run.status,
      durationMs: input.run.durationMs,
      // Les empreintes Git partent **courtes** : douze caracteres suffisent a
      // distinguer deux commits, et le reste n'apprend rien a un relecteur.
      headBefore: shortSha(input.run.headBefore),
      headAfter: shortSha(input.run.headAfter),
      unreliable: input.run.errorCode === GIT_POLICY_VIOLATION,
      partial: input.run.status !== RUN_STATUS.COMPLETED,
      reviewFailed: input.review.errorCode !== null,
    },
    validations,
    validationSummary: summarizeRunValidations([...input.review.validations]),
    files,
    fileCountAvailable: input.review.files.length,
    omittedFiles: input.review.omittedFiles,
    truncated,
  };

  const manifest: ArchitectReviewManifest = {
    schemaVersion: ARCHITECT_REVIEW_SCHEMA_VERSION,
    runId: input.runId,
    runCode: input.run.code,
    taskRevision: architectTaskRevision({
      code: input.task.code,
      title: input.task.title,
      status: input.task.status,
      objective: input.task.objective,
      outOfScope: input.task.outOfScope,
      acceptanceCriteria: input.task.acceptanceCriteria,
      documentReferences: input.task.documentReferences,
      validationCommands: input.task.validationCommands,
    }),
    reviewCapturedAt: input.review.capturedAt ?? "",
    fileCountAvailable: input.review.files.length,
    fileCountIncluded: files.length,
    patchCharsIncluded: patchBudget.used,
    truncated,
    validationCount: validations.length,
  };

  const facts: ArchitectReviewFacts = {
    runCompleted: input.run.status === RUN_STATUS.COMPLETED,
    unreliable: input.run.errorCode === GIT_POLICY_VIOLATION,
    reviewFailed: input.review.errorCode !== null,
    sensitiveFiles: totals.sensitive,
    binaryFiles: totals.binary,
    truncatedPatches: totals.truncated,
    omittedFiles: input.review.omittedFiles,
    architectTruncated: truncated,
    validationFailed: input.review.validations.some(
      (entry) => entry.status === RUN_VALIDATION_STATUS.FAILED,
    ),
    validationUnknown: input.review.validations.some(
      (entry) => entry.status === RUN_VALIDATION_STATUS.UNKNOWN,
    ),
    // « Jamais lancee » n'est jamais transforme en « echouee ». Une tache sans
    // aucune commande ne produit donc aucun de ces deux faits : ne pas declarer
    // de validation est un choix legitime, pas un echec fictif.
    validationNotRun: input.review.validations.some(
      (entry) =>
        entry.status === RUN_VALIDATION_STATUS.NOT_RUN ||
        entry.status === RUN_VALIDATION_STATUS.RUNNING,
    ),
  };

  return {
    bundle,
    manifest,
    facts,
    filePaths: input.review.files.map((file) => file.path),
    criteriaCount: input.task.acceptanceCriteria.length,
  };
}

/** Empreinte Git courte, ou `null`. */
function shortSha(value: string | null): string | null {
  return value === null || value === "" ? null : value.slice(0, 12);
}
