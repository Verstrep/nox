/**
 * Persistance d'une proposition de replanification.
 *
 * ## Une proposition en attente par projet, et pas une de plus
 *
 * Un projet ne peut pas porter deux plans cibles concurrents : l'utilisateur ne
 * saurait pas lequel il relit, et appliquer le second effacerait des decisions
 * prises dans le premier. La regle est donc simple et verifiee ici : tant qu'une
 * proposition est `PENDING`, aucune autre n'est ecrite.
 *
 * Le tour, lui, aboutit quand meme. La conversation continue, la reponse de
 * l'architecte est enregistree, et seule la **proposition structuree** est
 * refusee — avec sa raison. Faire echouer le tour entier priverait l'utilisateur
 * d'une reponse qu'il a payee.
 *
 * ## Un changement, deux propositions liees
 *
 * Quand un meme tour propose une mise a jour du projet **et** une
 * replanification, les deux forment un seul changement logique. Le lien est
 * porte par `projectUpdateId`, avec un index unique de chaque cote : elles
 * s'appliquent ensemble et s'ecartent ensemble.
 *
 * ## Ce module n'appelle personne
 *
 * Ni OpenAI, ni Claude Code, ni le runner, ni Git. Ce sont des ecritures SQLite,
 * et rien d'autre.
 */

import {
  REPLAN_PROPOSAL_STATUS,
  isReplanProposalStatus,
  type ReplanProposal,
  type ReplanProposalStatus,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Une proposition relue en base, sans sa cible deserialisee. */
export type ReplanProposalRecord = {
  id: string;
  projectId: string;
  generationId: string;
  projectUpdateId: string | null;
  status: ReplanProposalStatus;
  rationale: string;
  targetCount: number;
  newCount: number;
  providerJson: string;
  appliedJson: string | null;
  baseBriefRevision: string | null;
  basePlanRevision: string | null;
  planningFingerprint: string;
  createdAt: Date;
  appliedAt: Date | null;
  dismissedAt: Date | null;
};

type Row = {
  id: string;
  projectId: string;
  generationId: string;
  projectUpdateId: string | null;
  status: string;
  rationale: string;
  targetCount: number;
  newCount: number;
  providerJson: string;
  appliedJson: string | null;
  baseBriefRevision: string | null;
  basePlanRevision: string | null;
  planningFingerprint: string;
  createdAt: Date;
  appliedAt: Date | null;
  dismissedAt: Date | null;
};

/**
 * Traduit une ligne.
 *
 * Un statut illisible devient `DISMISSED` : c'est le seul defaut qui n'autorise
 * rien — ni a appliquer, ni a bloquer une proposition suivante.
 */
function toRecord(row: Row): ReplanProposalRecord {
  return {
    ...row,
    status: isReplanProposalStatus(row.status)
      ? row.status
      : REPLAN_PROPOSAL_STATUS.DISMISSED,
  };
}

const SELECT = {
  id: true,
  projectId: true,
  generationId: true,
  projectUpdateId: true,
  status: true,
  rationale: true,
  targetCount: true,
  newCount: true,
  providerJson: true,
  appliedJson: true,
  baseBriefRevision: true,
  basePlanRevision: true,
  planningFingerprint: true,
  createdAt: true,
  appliedAt: true,
  dismissedAt: true,
} as const;

export type WriteReplanProposalInput = {
  projectId: string;
  generationId: string;
  /** Mise a jour du projet du meme tour, quand il y en a une. */
  projectUpdateId: string | null;
  proposal: ReplanProposal;
  baseBriefRevision: string | null;
  basePlanRevision: string | null;
  planningFingerprint: string;
};

export type WriteReplanProposalResult =
  | { ok: true; proposal: ReplanProposalRecord }
  | { ok: false; reason: "pending_exists" };

/**
 * Ecrit une proposition, ou refuse parce qu'une autre attend deja.
 *
 * La verification et l'ecriture vivent dans **une** transaction : deux tours
 * conclus au meme instant ne peuvent pas produire deux propositions en attente.
 */
export async function writeReplanProposal(
  db: DatabaseClient,
  input: WriteReplanProposalInput,
): Promise<WriteReplanProposalResult> {
  return db.$transaction(async (tx) => {
    const pending = await tx.architectReplanProposal.count({
      where: { projectId: input.projectId, status: REPLAN_PROPOSAL_STATUS.PENDING },
    });
    if (pending > 0) {
      return { ok: false as const, reason: "pending_exists" as const };
    }

    const row = await tx.architectReplanProposal.create({
      data: {
        projectId: input.projectId,
        generationId: input.generationId,
        projectUpdateId: input.projectUpdateId,
        status: REPLAN_PROPOSAL_STATUS.PENDING,
        rationale: input.proposal.rationale,
        targetCount: input.proposal.futureTasks.length,
        newCount: input.proposal.futureTasks.filter((task) => task.tempId !== null).length,
        providerJson: JSON.stringify(input.proposal),
        baseBriefRevision: input.baseBriefRevision,
        basePlanRevision: input.basePlanRevision,
        planningFingerprint: input.planningFingerprint,
      },
      select: SELECT,
    });

    return { ok: true as const, proposal: toRecord(row) };
  });
}

/** La proposition en attente d'un projet, s'il y en a une. */
export async function getPendingReplanProposal(
  db: DatabaseClient,
  projectId: string,
): Promise<ReplanProposalRecord | null> {
  const row = await db.architectReplanProposal.findFirst({
    where: { projectId, status: REPLAN_PROPOSAL_STATUS.PENDING },
    orderBy: { createdAt: "desc" },
    select: SELECT,
  });
  return row === null ? null : toRecord(row);
}

/** Une proposition par identifiant, bornee a son projet. */
export async function getReplanProposal(
  db: DatabaseClient,
  projectId: string,
  proposalId: string,
): Promise<ReplanProposalRecord | null> {
  const row = await db.architectReplanProposal.findFirst({
    where: { id: proposalId, projectId },
    select: SELECT,
  });
  return row === null ? null : toRecord(row);
}

/** La proposition attachee a un tour, s'il en a produit une. */
export async function getReplanProposalForGeneration(
  db: DatabaseClient,
  generationId: string,
): Promise<ReplanProposalRecord | null> {
  const row = await db.architectReplanProposal.findUnique({
    where: { generationId },
    select: SELECT,
  });
  return row === null ? null : toRecord(row);
}

/**
 * Les propositions nees d'une conversation, dans l'ordre des tours.
 *
 * C'est l'ordre dans lequel le fil se lit : une carte de changement se place
 * apres la reponse qui l'a produite, jamais en fin de page.
 */
export async function listReplanProposalsForSession(
  db: DatabaseClient,
  sessionId: string,
): Promise<ReplanProposalRecord[]> {
  const rows = await db.architectReplanProposal.findMany({
    where: { generation: { sessionId } },
    orderBy: { generation: { sequence: "asc" } },
    select: SELECT,
  });
  return rows.map(toRecord);
}

/** L'historique des propositions d'un projet, de la plus recente a la plus ancienne. */
export async function listReplanProposals(
  db: DatabaseClient,
  projectId: string,
): Promise<ReplanProposalRecord[]> {
  const rows = await db.architectReplanProposal.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: SELECT,
  });
  return rows.map(toRecord);
}
