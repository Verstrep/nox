/**
 * Lecture et reconciliation des executions.
 *
 * Le web possede les donnees metier, le runner possede le processus. Ces deux
 * moities ne se parlent que par interrogation, et c'est ce module qui les
 * remet d'accord.
 *
 * ## Ce que le polling doit garantir
 *
 * - **Idempotence.** Deux interrogations rapprochees, ou deux onglets ouverts,
 *   ne doivent pas produire deux resultats differents. Toute ecriture passe par
 *   `updateRunFromRunner`, ou le premier etat final gagne.
 * - **Ne rien conclure d'une panne.** Un runner injoignable n'est pas une
 *   execution echouee : c'est une execution dont on ignore l'etat. Dans ce cas
 *   la base reste inchangee et l'interface le dit.
 * - **Conclure d'un suivi perdu.** Un runner qui repond mais ne connait plus
 *   l'execution est un cas different : le processus a ete interrompu par un
 *   redemarrage, et NOX ne saura jamais ce qu'il a fait. L'execution est alors
 *   bloquee, avec un message qui ne pretend rien.
 */

import {
  blockRun,
  getDatabaseClient,
  getRunById,
  listRunsByTask,
  updateRunFromRunner,
} from "@nox/database";
import {
  RUNNER_ERROR,
  RUN_STATUS,
  isFinalRunStatus,
  type ClaudePreflightSuccess,
  type DevelopmentRunDetail,
  type DevelopmentRunSummary,
} from "@nox/shared";
import { connection } from "next/server";

import { runAutonomousValidation } from "./autonomous-validation.ts";
import { toRunnerReport } from "./run-report.ts";
import { syncRunReview } from "./run-review.ts";
import { claudePreflight, fetchClaudeRunStatus } from "./runner/client.ts";
import { describeRunnerFailure, type RunnerFailure } from "./runner/errors.ts";

const LOST_TRACKING_MESSAGE =
  "Le runner ne suit plus cette execution : un redemarrage a interrompu le suivi. " +
  "NOX ne peut pas dire ce que le processus a fait — verifiez l'etat du repository vous-meme.";

/** Retourne l'historique des executions d'une tache. */
export async function loadTaskRuns(taskId: string): Promise<DevelopmentRunSummary[]> {
  await connection();
  return listRunsByTask(getDatabaseClient(), taskId);
}

/** Retourne une execution complete, ou `null` si elle n'existe pas. */
export async function loadRun(runId: string): Promise<DevelopmentRunDetail | null> {
  await connection();
  return getRunById(getDatabaseClient(), runId);
}

export type PreflightView =
  | { ok: true; preflight: ClaudePreflightSuccess }
  | { ok: false; message: string; failure: RunnerFailure };

/** Interroge le preflight du runner, sans jamais lever d'exception. */
export async function loadPreflight(repositoryPath: string): Promise<PreflightView> {
  await connection();

  const result = await claudePreflight(repositoryPath);
  if (result.ok) {
    return { ok: true, preflight: result.value };
  }

  return { ok: false, message: describeRunnerFailure(result.failure), failure: result.failure };
}

/**
 * Remet une execution d'accord avec ce que le runner en dit.
 *
 * Sans effet sur une execution deja terminee : la base fait alors autorite, et
 * il n'y a plus rien a demander.
 */
export async function reconcileRun(run: DevelopmentRunDetail): Promise<DevelopmentRunDetail> {
  if (isFinalRunStatus(run.status)) {
    return run;
  }

  const db = getDatabaseClient();
  const status = await fetchClaudeRunStatus(run.runnerRunId);

  if (status.ok) {
    const updated = await updateRunFromRunner(db, run.id, toRunnerReport(status.value));
    if (updated === null) {
      return run;
    }

    // L'evenement de finalisation, et lui seul. `run` etait non final en entrant
    // — la garde du haut le garantit —, donc arriver ici avec une execution
    // terminee normalement signifie qu'elle vient de le devenir a l'instant.
    //
    // Ce n'est pas « un rendu declenche des commandes » : la reservation
    // persistante refuse tout lot au-dela du premier, donc vingt
    // rafraichissements ne produisent aucun processus supplementaire. Le
    // declencheur est la transition, pas la consultation.
    if (isFinalRunStatus(updated.status)) {
      // L'instantane de review est transfere **ici**, dans l'evenement de
      // finalisation, et non au rendu de la page qui l'affiche.
      //
      // Ce n'est pas un detail d'ordonnancement : une correction — humaine ou
      // automatique — exige que la review existe, parce que c'est elle qui
      // prouve que le dossier de travail est encore celui qui a ete relu. La
      // capturer au rendu marchait tant que seul un humain corrigeait ; depuis
      // TASK-028, la decision peut suivre la finalisation de quelques
      // millisecondes.
      //
      // L'appel reste idempotent : une review deja enregistree n'est jamais
      // redemandee, et les pages continuent d'appeler `syncRunReview` sans que
      // cela change quoi que ce soit.
      await syncRunReview(updated.id, updated.runnerRunId, updated.status).catch(
        (error: unknown) => {
          console.error("[nox] Echec du transfert de la review :", error);
        },
      );
    }

    if (updated.status === RUN_STATUS.COMPLETED) {
      await runAutonomousValidation(db, updated.id).catch((error: unknown) => {
        // Une validation qui echoue a demarrer ne doit pas faire tomber la page
        // d'une execution : le lot enregistrera son propre etat, et la review le
        // dira. C'est la meme regle que pour la capture de review.
        console.error("[nox] Echec du lot de validation autonome :", error);
      });
      return (await getRunById(db, updated.id)) ?? updated;
    }

    return updated;
  }

  // Le runner repond mais ne connait plus l'execution : le suivi est perdu, et
  // il le restera. Conclure est ici la seule reponse honnete.
  if (
    status.failure.kind === "runner_error" &&
    status.failure.code === RUNNER_ERROR.CLAUDE_RUN_NOT_FOUND
  ) {
    const blocked = await blockRun(db, run.id, {
      errorCode: RUNNER_ERROR.CLAUDE_RUN_NOT_FOUND,
      errorMessage: LOST_TRACKING_MESSAGE,
    });
    return blocked ?? run;
  }

  // Runner arrete, delai depasse, reponse illisible : l'execution continue
  // peut-etre. On ne touche a rien.
  return run;
}
