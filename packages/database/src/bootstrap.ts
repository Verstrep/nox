/**
 * Persistance de la tache d'amorcage.
 *
 * ## Pourquoi ce module est si court
 *
 * Parce qu'il n'introduit presque rien. `TASK-000` est une tache : meme table,
 * meme statut initial, meme document, meme pipeline d'execution. Ce qui la
 * distingue tient en deux valeurs — un numero reserve et une nature declaree —
 * et tout le reste est deja ecrit depuis TASK-004.
 *
 * ## Ou vit l'unicite
 *
 * Dans `@@unique([projectId, sequence])`, qui existait avant cette tache. Le
 * numero d'amorcage est `0`, `Project.nextTaskSequence` demarre a `1` et ne
 * recule jamais : aucune attribution ordinaire ne peut produire `0`, et un
 * projet ne peut porter qu'une ligne de numero `0`.
 *
 * Deux creations concurrentes n'en produisent donc qu'une, et la perdante
 * echoue sur la contrainte plutot que sur une verification applicative. C'est
 * la meme raison qu'ailleurs dans NOX : une garantie qui vit dans le schema ne
 * peut pas etre contournee par un chemin de code oublie.
 *
 * ## Ce qui n'est pas touche
 *
 * `nextTaskSequence` n'est ni lu, ni incremente. Aucune tache existante n'est
 * modifiee, renumerotee ou relue. La provenance de backlog reste `null` : une
 * tache d'amorcage ne vient d'aucune proposition.
 */

import {
  ARCHITECT_BACKLOG_PROPOSAL_STATUS,
  BOOTSTRAP_TASK_SEQUENCE,
  TASK_KIND,
  type DevelopmentTaskDetail,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";
import { getTaskById, writeTaskRow, type CreateTaskInput } from "./tasks.js";

/** Code d'erreur de Prisma pour une violation de contrainte d'unicite. */
const UNIQUE_CONSTRAINT_CODE = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === UNIQUE_CONSTRAINT_CODE
  );
}

export type CreateBootstrapTaskResult =
  | { ok: true; task: DevelopmentTaskDetail }
  | { ok: false; reason: "unknown_project" | "already_exists" };

/**
 * Cree la tache d'amorcage d'un projet.
 *
 * Une seule ecriture, dans une transaction courte. Elle ne reserve aucun
 * numero : `BOOTSTRAP_TASK_SEQUENCE` est constant, et c'est la contrainte
 * d'unicite qui arbitre en cas de concurrence.
 *
 * Le document Markdown n'est pas ecrit ici. Comme partout dans NOX, la
 * specification vit en base et son artefact est produit ensuite : une panne du
 * runner coute un document a recreer, jamais une tache perdue.
 */
export async function createBootstrapTask(
  db: DatabaseClient,
  input: CreateTaskInput,
): Promise<CreateBootstrapTaskResult> {
  const project = await db.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (project === null) {
    return { ok: false, reason: "unknown_project" };
  }

  try {
    const task = await writeTaskRow(db, {
      ...input,
      sequence: BOOTSTRAP_TASK_SEQUENCE,
      kind: TASK_KIND.BOOTSTRAP,
      // Une tache d'amorcage ne vient d'aucun backlog, et ne doit jamais
      // apparaitre dans la provenance d'une proposition.
      backlogProposalId: null,
      backlogItemPosition: null,
    });
    return { ok: true, task };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Une autre creation a gagne la course, ou la tache existait deja.
      return { ok: false, reason: "already_exists" };
    }
    throw error;
  }
}

/**
 * La tache d'amorcage d'un projet, si elle existe.
 *
 * Interrogee par son **numero** : la requete emprunte l'index unique qui porte
 * deja la garantie, plutot qu'un second chemin par `kind` qui pourrait un jour
 * repondre autre chose.
 */
export async function getBootstrapTask(
  db: DatabaseClient,
  projectId: string,
): Promise<DevelopmentTaskDetail | null> {
  const row = await db.task.findUnique({
    where: { projectId_sequence: { projectId, sequence: BOOTSTRAP_TASK_SEQUENCE } },
    select: { id: true },
  });
  return row === null ? null : getTaskById(db, row.id);
}

/** Nombre de propositions de backlog appliquees, et donc amorcables. */
export async function countAppliedBacklogProposals(
  db: DatabaseClient,
  projectId: string,
): Promise<number> {
  return db.architectBacklogProposal.count({
    where: { projectId, status: ARCHITECT_BACKLOG_PROPOSAL_STATUS.APPLIED },
  });
}
