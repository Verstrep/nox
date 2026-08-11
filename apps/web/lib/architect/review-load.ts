/**
 * Chargement des sources d'une analyse de review, cote serveur.
 *
 * Un seul endroit relit projet, tache, execution et instantane, et il est
 * partage par la page de preparation et par l'action qui envoie. C'est ce qui
 * garantit que la preview decrit exactement ce qui partira : deux chargements
 * differents finiraient par ne pas lire les memes lignes.
 *
 * ## Rien ne vient du navigateur
 *
 * Trois identifiants entrent — projet, tache, execution — et la chaine est
 * verifiee entierement : une execution d'un autre projet est introuvable, pas
 * « refusee ». Le chemin du repository, la specification, les patches et les
 * validations sont relus en base. Aucun formulaire n'en porte.
 *
 * ## Le disque n'est jamais lu
 *
 * Ce module n'appelle pas le runner et n'ouvre aucun fichier. Une review se lit
 * entierement dans SQLite ; recalculer un diff a l'affichage raconterait le
 * present en le presentant comme le passe.
 */

import { getDatabaseClient, getRunById } from "@nox/database";
import { RUN_KIND, isRunKind, type DevelopmentTaskDetail } from "@nox/shared";
import { connection } from "next/server";

import { loadProject } from "../projects.ts";
import { loadRunReview } from "../run-review.ts";
import { loadRun } from "../runs.ts";
import { loadTask } from "../tasks.ts";
import type { ArchitectReviewRun, ArchitectReviewSnapshot } from "./review-bundle.ts";

export type ArchitectReviewContext = {
  project: { id: string; name: string; repositoryPath: string };
  task: DevelopmentTaskDetail;
  taskStatus: string;
  runId: string;
  run: ArchitectReviewRun;
  review: ArchitectReviewSnapshot;
};

/**
 * Relit tout ce qu'une analyse regarde.
 *
 * Retourne `null` des qu'un maillon manque ou qu'un rattachement ne tient pas :
 * l'appelant repond alors « introuvable », ce qui n'apprend rien a qui tenterait
 * de deviner l'existence d'une execution d'un autre projet.
 */
export async function loadArchitectReviewContext(
  projectId: string,
  taskId: string,
  runId: string,
): Promise<ArchitectReviewContext | null> {
  await connection();

  const project = await loadProject(projectId);
  if (project === null) {
    return null;
  }

  const task = await loadTask(taskId);
  if (task === null || task.projectId !== project.id) {
    return null;
  }

  const run = await loadRun(runId);
  if (run === null || run.taskId !== task.id) {
    return null;
  }

  const review = await loadRunReview(run.id);
  if (review === null) {
    return null;
  }

  // Le code du run parent, jamais son identifiant : le bundle decrit une
  // filiation lisible, pas une cle technique.
  const parent =
    run.parentRunId === null ? null : await getRunById(getDatabaseClient(), run.parentRunId);

  return {
    project: {
      id: project.id,
      name: project.name,
      repositoryPath: project.repositoryPath,
    },
    task,
    taskStatus: task.status,
    runId: run.id,
    run: {
      code: run.code,
      // `kind` est stocke en chaine, comme les autres enums de NOX. La garde le
      // ramene au contrat ; une valeur inconnue ne peut venir que d'une base
      // modifiee hors de NOX, et « initiale » est alors la lecture la plus
      // prudente — elle ne pretend pas qu'une correction a eu lieu.
      kind: isRunKind(run.kind) ? run.kind : RUN_KIND.INITIAL,
      parentRunCode: parent?.code ?? null,
      status: run.status,
      durationMs: run.claude.durationMs,
      headBefore: run.git.headBefore,
      headAfter: run.git.headAfter,
      errorCode: run.errorCode,
    },
    review: {
      capturedAt: review.capturedAt,
      errorCode: review.errorCode,
      omittedFiles: review.omittedFiles,
      files: review.files,
      validations: review.validations,
    },
  };
}
