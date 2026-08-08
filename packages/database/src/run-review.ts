/**
 * Acces aux donnees de review d'une execution.
 *
 * ## L'immuabilite est une regle d'ecriture, pas une convention d'appel
 *
 * `saveRunReview` refuse d'ecrire si `reviewCapturedAt` est deja renseigne. Ce
 * n'est pas une optimisation : c'est ce qui garantit qu'une review reste ce
 * qu'elle etait le jour de l'execution. Sans ce refus, il suffirait d'un
 * rafraichissement de page mal place, ou d'un second onglet, pour qu'un diff
 * recalcule remplace le diff d'origine — et personne ne le remarquerait.
 *
 * La consequence pratique compte autant : une fois la review enregistree, le
 * runner n'est **plus jamais** interroge pour cette execution. La base fait foi.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne nettoie rien, comme `run-events.ts` : patches et resumes ont deja
 * traverse le nettoyeur du runner. Il **borne** en revanche, parce qu'il est le
 * dernier point de passage avant SQLite.
 */

import {
  REVIEW_LIMITS,
  RUN_CHANGE_TYPES,
  RUN_VALIDATION_STATUS,
  RUN_VALIDATION_STATUSES,
  type RunChangeType,
  type RunFileChange,
  type RunReviewSnapshot,
  type RunValidationResultView,
  type RunValidationStatus,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/**
 * Levee lorsqu'une ligne stockee ne correspond plus au contrat metier.
 * Traduit une base modifiee hors de NOX, pas une erreur utilisateur.
 */
export class InvalidRunReviewRecordError extends Error {
  constructor(id: string, field: string, value: string) {
    super(`Review ${id} : ${field} "${value}" inconnu.`);
    this.name = "InvalidRunReviewRecordError";
  }
}

/** Review complete d'une execution, telle que la page la lit. */
export type RunReview = {
  /** Date ISO de la capture, ou `null` : aucune review n'a jamais ete prise. */
  capturedAt: string | null;
  /** Code d'erreur de la capture, lorsqu'elle a ete tentee et a echoue. */
  errorCode: string | null;
  omittedFiles: number;
  files: RunFileChange[];
  validations: RunValidationResultView[];
};

type FileChangeRow = {
  id: string;
  position: number;
  path: string;
  previousPath: string | null;
  changeType: string;
  additions: number | null;
  deletions: number | null;
  isBinary: boolean;
  isSensitive: boolean;
  isTruncated: boolean;
  patch: string | null;
};

type ValidationRow = {
  id: string;
  position: number;
  command: string;
  status: string;
  exitCode: number | null;
  summary: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

const FILE_CHANGE_SELECT = {
  id: true,
  position: true,
  path: true,
  previousPath: true,
  changeType: true,
  additions: true,
  deletions: true,
  isBinary: true,
  isSensitive: true,
  isTruncated: true,
  patch: true,
} as const;

const VALIDATION_SELECT = {
  id: true,
  position: true,
  command: true,
  status: true,
  exitCode: true,
  summary: true,
  startedAt: true,
  finishedAt: true,
} as const;

function isChangeType(value: string): value is RunChangeType {
  return (RUN_CHANGE_TYPES as readonly string[]).includes(value);
}

function isValidationStatus(value: string): value is RunValidationStatus {
  return (RUN_VALIDATION_STATUSES as readonly string[]).includes(value);
}

function toFileChange(row: FileChangeRow): RunFileChange {
  if (!isChangeType(row.changeType)) {
    throw new InvalidRunReviewRecordError(row.id, "type de changement", row.changeType);
  }

  return {
    position: row.position,
    path: row.path,
    previousPath: row.previousPath,
    changeType: row.changeType,
    additions: row.additions,
    deletions: row.deletions,
    isBinary: row.isBinary,
    isSensitive: row.isSensitive,
    isTruncated: row.isTruncated,
    patch: row.patch,
  };
}

function toValidation(row: ValidationRow): RunValidationResultView {
  if (!isValidationStatus(row.status)) {
    throw new InvalidRunReviewRecordError(row.id, "statut", row.status);
  }

  return {
    position: row.position,
    command: row.command,
    status: row.status,
    exitCode: row.exitCode,
    summary: row.summary,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function bound(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function readDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Recopie les commandes de validation attendues, a la creation de l'execution.
 *
 * Une **copie**, pas une reference vers `TaskValidationCommand`. C'est ce qui
 * rend la review d'un run stable : la specification de la tache evoluera, et
 * l'execution du 7 aout doit continuer de dire quelles commandes elle attendait
 * ce jour-la.
 *
 * Sans effet si des commandes sont deja enregistrees : la copie n'a lieu qu'une
 * fois, au lancement.
 */
export async function seedRunValidations(
  db: DatabaseClient,
  runId: string,
  commands: readonly string[],
): Promise<number> {
  if (commands.length === 0) {
    return 0;
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.runValidationResult.count({ where: { runId } });
    if (existing > 0) {
      return 0;
    }

    const result = await tx.runValidationResult.createMany({
      data: commands.map((command, position) => ({
        runId,
        position,
        command: bound(command, REVIEW_LIMITS.command),
        status: RUN_VALIDATION_STATUS.NOT_RUN,
      })),
    });
    return result.count;
  });
}

/**
 * Enregistre l'instantane de review d'une execution.
 *
 * Ecrit **une seule fois**. Un second appel — deux onglets, un rafraichissement,
 * un flux SSE et un rendu de page simultanes — ne fait rien et le dit en
 * retournant `false`. C'est la base qui porte cette garantie, pas la prudence de
 * l'appelant.
 *
 * Les validations sont mises a jour plutot que recreees : leurs lignes existent
 * depuis le lancement, et leur `position` est la reference stable de la review.
 */
export async function saveRunReview(
  db: DatabaseClient,
  runId: string,
  snapshot: RunReviewSnapshot,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const run = await tx.run.findUnique({
      where: { id: runId },
      select: { id: true, reviewCapturedAt: true },
    });
    if (run === null || run.reviewCapturedAt !== null) {
      return false;
    }

    const files = snapshot.files.slice(0, REVIEW_LIMITS.maxFiles);
    if (files.length > 0) {
      await tx.runFileChange.createMany({
        data: files.map((file, position) => ({
          runId,
          // La position est reattribuee ici : elle doit etre dense et
          // strictement croissante meme si la capture a laisse un trou.
          position,
          path: bound(file.path, REVIEW_LIMITS.path),
          previousPath:
            file.previousPath === null ? null : bound(file.previousPath, REVIEW_LIMITS.path),
          changeType: file.changeType,
          additions: file.additions,
          deletions: file.deletions,
          isBinary: file.isBinary,
          isSensitive: file.isSensitive,
          isTruncated: file.isTruncated,
          // Un fichier sensible n'a pas de patch, quoi qu'en dise l'appelant :
          // la derniere barriere est ici, juste avant l'ecriture.
          patch:
            file.isSensitive || file.patch === null
              ? null
              : bound(file.patch, REVIEW_LIMITS.patchPerFile),
        })),
      });
    }

    for (const validation of snapshot.validations) {
      await tx.runValidationResult.updateMany({
        where: { runId, position: validation.position },
        data: {
          status: validation.status,
          exitCode: validation.exitCode,
          summary:
            validation.summary === null
              ? null
              : bound(validation.summary, REVIEW_LIMITS.validationSummary),
          startedAt: readDate(validation.startedAt),
          finishedAt: readDate(validation.finishedAt),
        },
      });
    }

    await tx.run.update({
      where: { id: runId },
      data: {
        reviewCapturedAt: readDate(snapshot.capturedAt) ?? new Date(),
        reviewOmittedFiles: Math.max(0, snapshot.omittedFiles),
        // La capture a reussi : un eventuel echec precedent n'a plus lieu
        // d'etre affiche.
        reviewErrorCode: null,
      },
    });

    return true;
  });
}

/**
 * Enregistre qu'une capture de review a ete tentee et a echoue.
 *
 * Ne touche ni au statut de l'execution, ni a son resultat Claude : un diff que
 * NOX n'a pas su lire n'est pas un travail rate. Sans effet si une review a deja
 * ete capturee — un echec tardif ne doit pas effacer un succes.
 */
export async function markRunReviewFailed(
  db: DatabaseClient,
  runId: string,
  code: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const run = await tx.run.findUnique({
      where: { id: runId },
      select: { id: true, reviewCapturedAt: true },
    });
    if (run === null || run.reviewCapturedAt !== null) {
      return false;
    }

    await tx.run.update({ where: { id: runId }, data: { reviewErrorCode: code } });
    return true;
  });
}

/**
 * Lit la review d'une execution.
 *
 * `capturedAt` a `null` signifie qu'aucune review n'existe : execution anterieure
 * a TASK-011, ou capture jamais tentee. Une review **vide** — capture reussie,
 * zero fichier — a bien une date, et dit quelque chose de tres different :
 * l'agent n'a rien modifie.
 */
export async function getRunReview(db: DatabaseClient, runId: string): Promise<RunReview | null> {
  const run = await db.run.findUnique({
    where: { id: runId },
    select: { reviewCapturedAt: true, reviewErrorCode: true, reviewOmittedFiles: true },
  });
  if (run === null) {
    return null;
  }

  const [files, validations] = await Promise.all([
    db.runFileChange.findMany({
      where: { runId },
      orderBy: { position: "asc" },
      select: FILE_CHANGE_SELECT,
    }),
    db.runValidationResult.findMany({
      where: { runId },
      orderBy: { position: "asc" },
      select: VALIDATION_SELECT,
    }),
  ]);

  return {
    capturedAt: run.reviewCapturedAt?.toISOString() ?? null,
    errorCode: run.reviewErrorCode,
    omittedFiles: run.reviewOmittedFiles,
    files: files.map(toFileChange),
    validations: validations.map(toValidation),
  };
}

/** Vrai lorsqu'une review a deja ete capturee pour cette execution. */
export async function hasRunReview(db: DatabaseClient, runId: string): Promise<boolean> {
  const run = await db.run.findUnique({
    where: { id: runId },
    select: { reviewCapturedAt: true },
  });
  return run?.reviewCapturedAt != null;
}
