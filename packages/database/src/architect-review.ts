/**
 * Acces aux analyses de review produites par l'Architecte.
 *
 * Deux garanties structurelles vivent ici, et nulle part ailleurs :
 *
 * 1. **Une seule analyse active par execution.** Le verrou n'est pas une lecture
 *    suivie d'une ecriture — un double clic passerait entre les deux. C'est un
 *    echange conditionnel sur `Run.nextArchitectReviewSequence`, dans la meme
 *    transaction que la creation de la ligne.
 * 2. **Une analyse terminee est immuable.** `finishArchitectRunReview` refuse
 *    d'ecrire sur une ligne qui n'est plus `RUNNING`.
 *
 * Une analyse ratee garde son numero : elle a consomme un appel facture, et le
 * reattribuer effacerait ce fait.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne relit aucun fichier, ne recalcule aucun diff et ne change aucun statut
 * de tache. Une analyse est une **lecture** de l'histoire deja enregistree ;
 * elle n'en produit pas de nouvelle.
 */

import {
  ARCHITECT_REVIEW_LIMITS,
  ARCHITECT_REVIEW_STATUS,
  isArchitectErrorCode,
  isArchitectReviewBlocker,
  isArchitectReviewManifest,
  isArchitectReviewStatus,
  isArchitectReviewVerdict,
  type ArchitectErrorCode,
  type ArchitectReviewBlocker,
  type ArchitectReviewFinding,
  type ArchitectReviewManifest,
  type ArchitectReviewStatus,
  type ArchitectReviewVerdict,
  type ArchitectUsage,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Levee lorsqu'une ligne stockee ne correspond plus au contrat metier. */
export class InvalidArchitectReviewRecordError extends Error {
  constructor(id: string, field: string, value: string) {
    super(`Analyse Architecte ${id} : ${field} "${value}" inconnu.`);
    this.name = "InvalidArchitectReviewRecordError";
  }
}

/** Une analyse, telle que l'interface la lit. */
export type ArchitectRunReviewView = {
  id: string;
  runId: string;
  sequence: number;
  /** Code affiche : `ANALYSIS-1`, derive du numero. */
  code: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  /** Manifest deserialise ; `null` si la ligne est illisible. */
  manifest: ArchitectReviewManifest | null;
  status: ArchitectReviewStatus;
  /** Verdict rendu par le modele, conserve tel quel. */
  providerVerdict: ArchitectReviewVerdict | null;
  /** Verdict retenu par NOX apres sa garde. C'est celui qui est affiche. */
  finalVerdict: ArchitectReviewVerdict | null;
  blockers: ArchitectReviewBlocker[];
  summary: string | null;
  findings: ArchitectReviewFinding[];
  feedback: string | null;
  providerResponseId: string | null;
  usage: ArchitectUsage;
  errorCode: ArchitectErrorCode | null;
  createdAt: string;
};

type ReviewRow = {
  id: string;
  runId: string;
  sequence: number;
  model: string;
  promptVersion: string;
  inputHash: string;
  manifestJson: string;
  status: string;
  providerVerdict: string | null;
  finalVerdict: string | null;
  blockersJson: string | null;
  summary: string | null;
  findingsJson: string | null;
  feedback: string | null;
  providerResponseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  errorCode: string | null;
  createdAt: Date;
};

/** Code affiche d'une analyse : `ANALYSIS-1`, derive de son numero. */
export function formatArchitectReviewCode(sequence: number): string {
  return `ANALYSIS-${String(sequence)}`;
}

/**
 * Deserialise une valeur JSON stockee, sans jamais lever.
 *
 * Une ligne illisible ne doit pas faire tomber une page d'historique : elle
 * devient `null`, et l'interface dira que cette analyse n'est plus lisible.
 */
function readJson<T>(raw: string | null): T | null {
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Relit les faits bloquants, en ecartant ceux que NOX ne connait plus. */
function readBlockers(raw: string | null): ArchitectReviewBlocker[] {
  const parsed = readJson<unknown[]>(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((entry): entry is ArchitectReviewBlocker => isArchitectReviewBlocker(entry));
}

function readVerdict(id: string, field: string, value: string | null): ArchitectReviewVerdict | null {
  if (value === null) {
    return null;
  }
  if (!isArchitectReviewVerdict(value)) {
    throw new InvalidArchitectReviewRecordError(id, field, value);
  }
  return value;
}

function toView(row: ReviewRow): ArchitectRunReviewView {
  if (!isArchitectReviewStatus(row.status)) {
    throw new InvalidArchitectReviewRecordError(row.id, "statut d'analyse", row.status);
  }
  const errorCode = row.errorCode;
  if (errorCode !== null && !isArchitectErrorCode(errorCode)) {
    throw new InvalidArchitectReviewRecordError(row.id, "code d'erreur", errorCode);
  }

  const manifest = readJson<unknown>(row.manifestJson);

  return {
    id: row.id,
    runId: row.runId,
    sequence: row.sequence,
    code: formatArchitectReviewCode(row.sequence),
    model: row.model,
    promptVersion: row.promptVersion,
    inputHash: row.inputHash,
    manifest: isArchitectReviewManifest(manifest) ? manifest : null,
    status: row.status,
    providerVerdict: readVerdict(row.id, "verdict du fournisseur", row.providerVerdict),
    finalVerdict: readVerdict(row.id, "verdict final", row.finalVerdict),
    blockers: readBlockers(row.blockersJson),
    summary: row.summary,
    findings: readJson<ArchitectReviewFinding[]>(row.findingsJson) ?? [],
    feedback: row.feedback,
    providerResponseId: row.providerResponseId,
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      cachedInputTokens: row.cachedInputTokens,
    },
    errorCode,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Les analyses se lisent de la plus recente a la plus ancienne. */
const REVIEW_ORDER = { sequence: "desc" } as const;

export type StartArchitectReviewInput = {
  runId: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  manifest: ArchitectReviewManifest;
};

export type StartArchitectReviewResult =
  | { ok: true; analysis: ArchitectRunReviewView }
  | { ok: false; reason: "not_found" | "active" | "limit" };

/**
 * Reserve une analyse, ou refuse.
 *
 * ## Le verrou
 *
 * Deux conditions, et les deux comptent. Une analyse deja `RUNNING` refuse la
 * suivante — c'est la regle metier. L'echange conditionnel sur le compteur
 * refuse deux reservations **simultanees** — c'est ce qu'un double clic
 * declenche, et une simple lecture prealable n'y suffirait pas.
 *
 * ## La borne
 *
 * Elle porte sur le compteur, pas sur un comptage de lignes reussies : une
 * analyse qui echoue a quand meme joint le fournisseur. Compter les seules
 * reussites autoriserait une boucle infinie d'echecs, chacune facturee.
 */
export async function startArchitectRunReview(
  db: DatabaseClient,
  input: StartArchitectReviewInput,
): Promise<StartArchitectReviewResult> {
  return db.$transaction(async (tx): Promise<StartArchitectReviewResult> => {
    const run = await tx.run.findUnique({
      where: { id: input.runId },
      select: { id: true, nextArchitectReviewSequence: true },
    });
    if (run === null) {
      return { ok: false, reason: "not_found" };
    }
    if (run.nextArchitectReviewSequence > ARCHITECT_REVIEW_LIMITS.analyses) {
      return { ok: false, reason: "limit" };
    }

    const active = await tx.architectRunReview.count({
      where: { runId: input.runId, status: ARCHITECT_REVIEW_STATUS.RUNNING },
    });
    if (active > 0) {
      return { ok: false, reason: "active" };
    }

    const claimed = await tx.run.updateMany({
      where: { id: input.runId, nextArchitectReviewSequence: run.nextArchitectReviewSequence },
      data: { nextArchitectReviewSequence: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      return { ok: false, reason: "active" };
    }

    const row = await tx.architectRunReview.create({
      data: {
        runId: input.runId,
        sequence: run.nextArchitectReviewSequence,
        model: input.model,
        promptVersion: input.promptVersion,
        inputHash: input.inputHash,
        manifestJson: JSON.stringify(input.manifest),
        status: ARCHITECT_REVIEW_STATUS.RUNNING,
      },
    });

    return { ok: true, analysis: toView(row) };
  });
}

export type FinishArchitectReviewInput = {
  analysisId: string;
  status: Exclude<ArchitectReviewStatus, "RUNNING">;
  providerVerdict?: ArchitectReviewVerdict | null;
  finalVerdict?: ArchitectReviewVerdict | null;
  blockers?: readonly ArchitectReviewBlocker[];
  summary?: string | null;
  findings?: readonly ArchitectReviewFinding[];
  feedback?: string | null;
  providerResponseId?: string | null;
  usage?: ArchitectUsage;
  errorCode?: ArchitectErrorCode | null;
};

/**
 * Conclut une analyse.
 *
 * Refuse si elle n'est plus `RUNNING` : une analyse terminee est un fait, et un
 * second appel — reprise, double reponse — ne doit pas le reecrire. La garantie
 * vit dans le `where`, pas dans la politesse de l'appelant.
 *
 * Retourne `null` lorsque rien n'a ete ecrit : l'appelant sait alors qu'il est
 * arrive second, et n'affiche pas un resultat qui n'a pas ete enregistre.
 */
export async function finishArchitectRunReview(
  db: DatabaseClient,
  input: FinishArchitectReviewInput,
): Promise<ArchitectRunReviewView | null> {
  return db.$transaction(async (tx) => {
    const claimed = await tx.architectRunReview.updateMany({
      where: { id: input.analysisId, status: ARCHITECT_REVIEW_STATUS.RUNNING },
      data: {
        status: input.status,
        providerVerdict: input.providerVerdict ?? null,
        finalVerdict: input.finalVerdict ?? null,
        blockersJson: input.blockers === undefined ? null : JSON.stringify([...input.blockers]),
        summary: input.summary ?? null,
        findingsJson: input.findings === undefined ? null : JSON.stringify([...input.findings]),
        feedback: input.feedback ?? null,
        providerResponseId: input.providerResponseId ?? null,
        inputTokens: input.usage?.inputTokens ?? null,
        outputTokens: input.usage?.outputTokens ?? null,
        totalTokens: input.usage?.totalTokens ?? null,
        cachedInputTokens: input.usage?.cachedInputTokens ?? null,
        errorCode: input.errorCode ?? null,
      },
    });
    if (claimed.count !== 1) {
      return null;
    }

    const row = await tx.architectRunReview.findUnique({ where: { id: input.analysisId } });
    return row === null ? null : toView(row);
  });
}

/** Analyses d'une execution, de la plus recente a la plus ancienne. */
export async function listArchitectRunReviews(
  db: DatabaseClient,
  runId: string,
): Promise<ArchitectRunReviewView[]> {
  const rows = await db.architectRunReview.findMany({
    where: { runId },
    orderBy: REVIEW_ORDER,
  });
  return rows.map(toView);
}

/** Retourne une analyse, ou `null` si elle n'existe pas. */
export async function getArchitectRunReview(
  db: DatabaseClient,
  analysisId: string,
): Promise<ArchitectRunReviewView | null> {
  const row = await db.architectRunReview.findUnique({ where: { id: analysisId } });
  return row === null ? null : toView(row);
}

/**
 * Etat des analyses d'une execution, pour la page de review.
 *
 * `analysesLeft` compte les appels restants, echecs compris : c'est ce que
 * l'utilisateur doit voir avant de cliquer, pas le nombre de reussites.
 */
export type ArchitectReviewSummary = {
  /** Analyse la plus recente, quelle que soit son issue. */
  latest: ArchitectRunReviewView | null;
  /**
   * Derniere analyse **terminee**, porteuse d'un verdict.
   *
   * Distincte de `latest`, et la distinction compte : une tentative ratee ne
   * doit pas effacer un verdict deja rendu. Une analyse qui echoue apprend
   * qu'un appel a echoue, pas que la precedente etait fausse.
   */
  latestCompleted: ArchitectRunReviewView | null;
  count: number;
  analysesLeft: number;
  /** Vrai lorsqu'une analyse est en cours pour cette execution. */
  active: boolean;
};

export async function getArchitectReviewSummary(
  db: DatabaseClient,
  runId: string,
): Promise<ArchitectReviewSummary> {
  const [run, rows] = await Promise.all([
    db.run.findUnique({ where: { id: runId }, select: { nextArchitectReviewSequence: true } }),
    // La borne d'analyses par execution est deja une constante : lire toutes
    // les lignes d'un run reste donc une lecture bornee, et c'est elle qui
    // permet de distinguer la derniere tentative de la derniere analyse
    // exploitable.
    db.architectRunReview.findMany({
      where: { runId },
      orderBy: REVIEW_ORDER,
      take: ARCHITECT_REVIEW_LIMITS.analyses,
    }),
  ]);

  const consumed = (run?.nextArchitectReviewSequence ?? 1) - 1;
  const views = rows.map(toView);
  const latest = views[0] ?? null;
  const latestCompleted =
    views.find(
      (view) => view.status === ARCHITECT_REVIEW_STATUS.COMPLETED && view.finalVerdict !== null,
    ) ?? null;

  return {
    latest,
    latestCompleted,
    count: consumed,
    analysesLeft: Math.max(0, ARCHITECT_REVIEW_LIMITS.analyses - consumed),
    active: latest !== null && latest.status === ARCHITECT_REVIEW_STATUS.RUNNING,
  };
}
