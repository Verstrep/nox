/**
 * Acces aux evenements d'une execution.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne nettoie rien. Les evenements qu'il recoit ont deja traverse le
 * normaliseur et le nettoyeur du runner : chemins rendus relatifs, secrets
 * retires, raisonnement interne ecarte. Refaire ce travail ici donnerait
 * l'illusion d'une seconde barriere, et surtout deux endroits ou corriger un
 * defaut de nettoyage — dont un qu'on oublierait.
 *
 * Il **borne** en revanche les tailles, comme `runs.ts` le fait pour les
 * comptes rendus : c'est le dernier point de passage avant SQLite, et une borne
 * appliquee ailleurs peut avoir ete contournee par un chemin qu'on n'a pas
 * prevu.
 *
 * ## L'idempotence est garantie par la base, pas par l'appelant
 *
 * Le couple `runId + sequence` est unique en base : c'est la contrainte qui rend
 * l'insertion idempotente, et rien d'autre. Le flux SSE peut rejouer un lot
 * apres une reconnexion, deux onglets peuvent persister les memes evenements, un
 * rafraichissement peut tout redemander — aucun de ces cas ne cree de doublon.
 *
 * `createMany({ skipDuplicates })` aurait ete le moyen naturel, mais SQLite ne
 * le supporte pas sous Prisma. Le filtrage se fait donc en deux temps, dans une
 * transaction : les numeros deja connus sont ecartes, puis l'insertion groupee
 * est tentee. Si une ecriture concurrente s'est glissee entre les deux, la
 * contrainte d'unicite leve — et l'on repasse ligne par ligne, en ignorant
 * celles qui existent deja. Le chemin lent n'est emprunte que dans ce cas.
 */

import {
  RUN_EVENT_LIMITS,
  isClaudeRunEventKind,
  type ClaudeRunEvent,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";
import { isUniqueConstraintError } from "./projects.js";

/**
 * Levee lorsqu'une ligne stockee ne correspond plus au contrat metier.
 * Traduit une base modifiee hors de NOX, pas une erreur utilisateur.
 */
export class InvalidRunEventRecordError extends Error {
  constructor(id: string, field: string, value: string) {
    super(`Evenement ${id} : ${field} "${value}" inconnu.`);
    this.name = "InvalidRunEventRecordError";
  }
}

type EventRow = {
  id: string;
  sequence: number;
  kind: string;
  label: string;
  detail: string | null;
  toolName: string | null;
  isError: boolean;
  occurredAt: Date;
};

function toEvent(row: EventRow): ClaudeRunEvent {
  if (!isClaudeRunEventKind(row.kind)) {
    throw new InvalidRunEventRecordError(row.id, "type", row.kind);
  }
  if (!Number.isInteger(row.sequence) || row.sequence < 1) {
    throw new InvalidRunEventRecordError(row.id, "numero", String(row.sequence));
  }

  return {
    sequence: row.sequence,
    kind: row.kind,
    occurredAt: row.occurredAt.toISOString(),
    label: row.label,
    detail: row.detail,
    toolName: row.toolName,
    isError: row.isError,
  };
}

function bound(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

/**
 * Ajoute des evenements a une execution, sans jamais creer de doublon.
 *
 * Retourne le nombre de lignes reellement inserees — utile pour distinguer
 * « rien de nouveau » de « rien n'a fonctionne ».
 *
 * Les evenements dont le numero est absent ou invalide sont ecartes plutot que
 * corriges : un numero invente placerait l'evenement au mauvais endroit dans la
 * chronologie, ce qui est pire que de le perdre.
 */
export async function appendRunEvents(
  db: DatabaseClient,
  runId: string,
  events: readonly ClaudeRunEvent[],
): Promise<number> {
  const rows = events
    .filter((event) => Number.isInteger(event.sequence) && event.sequence >= 1)
    .map((event) => ({
      runId,
      sequence: event.sequence,
      kind: event.kind,
      label: bound(event.label, RUN_EVENT_LIMITS.label),
      detail: event.detail === null ? null : bound(event.detail, RUN_EVENT_LIMITS.detail),
      toolName:
        event.toolName === null ? null : bound(event.toolName, RUN_EVENT_LIMITS.toolName),
      isError: event.isError,
      occurredAt: readDate(event.occurredAt),
    }));

  if (rows.length === 0) {
    return 0;
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.runEvent.findMany({
      where: { runId, sequence: { in: rows.map((row) => row.sequence) } },
      select: { sequence: true },
    });
    const known = new Set(existing.map((row) => row.sequence));
    const fresh = rows.filter((row) => !known.has(row.sequence));

    if (fresh.length === 0) {
      return 0;
    }

    try {
      const result = await tx.runEvent.createMany({ data: fresh });
      return result.count;
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      // Une ecriture concurrente a devance celle-ci. On reprend ligne par
      // ligne : celles qui existent deja sont ignorees, les autres passent.
      let inserted = 0;
      for (const row of fresh) {
        try {
          await tx.runEvent.create({ data: row });
          inserted += 1;
        } catch (rowError) {
          if (!isUniqueConstraintError(rowError)) {
            throw rowError;
          }
        }
      }
      return inserted;
    }
  });
}

/**
 * Lit une date ISO, en retombant sur l'instant courant si elle est illisible.
 *
 * Une date invalide ferait echouer toute l'insertion, donc perdre le lot entier
 * pour un seul champ d'affichage. L'ordre, lui, ne depend pas de cette date : il
 * vient de `sequence`.
 */
function readDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Retourne les evenements d'une execution, dans l'ordre.
 *
 * `afterSequence` est un curseur, pas une pagination par decalage : c'est ce qui
 * rend une reconnexion exacte. Un decalage se decalerait justement des qu'un
 * evenement s'intercalerait.
 */
export async function listRunEvents(
  db: DatabaseClient,
  runId: string,
  afterSequence = 0,
  limit: number = RUN_EVENT_LIMITS.maxEvents + RUN_EVENT_LIMITS.reservedEvents,
): Promise<ClaudeRunEvent[]> {
  const rows = await db.runEvent.findMany({
    where: { runId, sequence: { gt: afterSequence } },
    orderBy: { sequence: "asc" },
    take: Math.max(1, limit),
    select: {
      id: true,
      sequence: true,
      kind: true,
      label: true,
      detail: true,
      toolName: true,
      isError: true,
      occurredAt: true,
    },
  });

  return rows.map(toEvent);
}

/**
 * Dernier numero d'evenement connu en base, ou `0` s'il n'y en a aucun.
 *
 * Calcule a partir des lignes elles-memes, jamais d'un compteur denormalise sur
 * `Run` : un compteur peut diverger des lignes qu'il pretend decrire, et c'est
 * exactement ce qu'on ne veut pas d'un curseur de reprise.
 */
export async function getLastRunEventSequence(
  db: DatabaseClient,
  runId: string,
): Promise<number> {
  const last = await db.runEvent.findFirst({
    where: { runId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  return last?.sequence ?? 0;
}

/** Nombre d'evenements conserves pour une execution. */
export async function countRunEvents(db: DatabaseClient, runId: string): Promise<number> {
  return db.runEvent.count({ where: { runId } });
}
