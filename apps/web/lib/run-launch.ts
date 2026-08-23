/**
 * Lancement d'une execution Claude Code.
 *
 * ## Un seul moteur
 *
 * Ce module est le **seul** chemin vers le demarrage initial d'une execution.
 * Le lancement manuel depuis la page d'une tache et l'avancement de la file
 * d'execution l'appellent tous les deux : il n'existe pas de second moteur
 * Claude pour la file, et il ne doit pas en exister. La file **choisit** ; ce
 * qui suit le choix est identique dans les deux cas — memes preconditions,
 * memes permissions, meme prompt, meme run, meme streaming, meme annulation,
 * meme review.
 *
 * ## Ce qui n'est jamais recu de l'appelant
 *
 * Ni prompt, ni liste d'outils, ni commande, ni chemin de repository. Tout est
 * relu en base ici. L'appelant fournit des identifiants et le `HEAD` attendu ;
 * ce dernier est de toute facon revalide par le runner.
 *
 * ## L'ordre des ecritures
 *
 * Le run est cree avant l'appel au runner, et la tache ne passe en `RUNNING`
 * qu'apres acceptation. Un refus laisse donc une trace consultable — le run
 * porte son echec — sans jamais afficher un travail en cours qui n'existe pas.
 */

import {
  cancelTaskExecution,
  createRun,
  failRun,
  getProjectById,
  getTaskById,
  listTaskDependencies,
  markRunRunning,
  seedRunValidations,
  startTaskExecution,
  type DatabaseClient,
} from "@nox/database";
import {
  RUNNER_ERROR,
  TASK_DOCUMENT_SYNC_STATUS,
  LAUNCH_REFUSAL,
  TASK_STATUS,
  buildClaudeToolPolicy,
  summarizeTaskDependencies,
} from "@nox/shared";
import { randomUUID } from "node:crypto";

import { buildExecutionPrompt } from "./run-prompt.ts";
import { startClaudeRun } from "./runner/client.ts";
import { describeRunnerFailure } from "./runner/errors.ts";
import { unresolvedDependenciesMessage } from "./task-dependencies.ts";

export type { LaunchOutcome, LaunchRefusalCode } from "@nox/shared";
import type { LaunchOutcome } from "@nox/shared";

export const UNKNOWN_TASK_MESSAGE =
  "Cette tache n'existe pas dans ce projet. Revenez au backlog et rouvrez-la.";

export const NOT_READY_MESSAGE =
  "Seule une tache au statut « Prete » peut etre lancee. Rechargez la page pour voir son statut actuel.";

export const NOT_SYNCED_MESSAGE =
  "Le document Markdown de cette tache n'est pas synchronise. Claude Code doit pouvoir le lire : creez-le avant de lancer.";

export const NO_CRITERIA_MESSAGE =
  "Cette tache n'a aucun critere d'acceptation. Sans critere, personne ne pourra dire si l'execution a reussi.";

export const ACTIVE_RUN_MESSAGE =
  "Une execution est deja en cours sur ce repository. NOX n'en lance qu'une a la fois : " +
  "attendez sa fin, puis reessayez.";

/** Acces au runner ; remplaces par des doublures dans les tests. */
export type RunLaunchPorts = {
  start: typeof startClaudeRun;
};

const RUNNER_PORTS: RunLaunchPorts = { start: startClaudeRun };

/**
 * Demarre une execution sur une tache, apres avoir tout revalide.
 *
 * Aucun instantane de l'appelant ne fait autorite : le statut, la
 * synchronisation, les criteres, les dependances, les permissions et l'unicite
 * de l'execution active sont relus ici, au moment d'agir.
 */
export async function launchTaskRun(
  db: DatabaseClient,
  input: { projectId: string; taskId: string; expectedGitHead: string },
  ports: RunLaunchPorts = RUNNER_PORTS,
): Promise<LaunchOutcome> {
  const task = await getTaskById(db, input.taskId);
  // Le projet fait partie du filtre, pas d'une verification apres coup : une
  // tache d'un autre projet est introuvable, exactement comme une tache
  // inexistante.
  if (task === null || task.projectId !== input.projectId) {
    return { ok: false, code: LAUNCH_REFUSAL.UNKNOWN_TASK, message: UNKNOWN_TASK_MESSAGE };
  }

  if (task.status !== TASK_STATUS.READY) {
    return { ok: false, code: LAUNCH_REFUSAL.NOT_READY, message: NOT_READY_MESSAGE };
  }

  if (task.documentSyncStatus !== TASK_DOCUMENT_SYNC_STATUS.SYNCED) {
    return { ok: false, code: LAUNCH_REFUSAL.NOT_SYNCED, message: NOT_SYNCED_MESSAGE };
  }

  if (task.acceptanceCriteria.length === 0) {
    return { ok: false, code: LAUNCH_REFUSAL.NO_CRITERIA, message: NO_CRITERIA_MESSAGE };
  }

  // Les dependances sont revalidees **ici**, avant la politique d'outils, avant
  // le prompt, avant la creation du run et avant tout appel au runner. Une tache
  // qui attend ne doit consommer ni inspection, ni ligne en base : le refus est
  // gratuit, et il le reste.
  const dependencies = summarizeTaskDependencies(await listTaskDependencies(db, input.taskId));
  if (!dependencies.allSatisfied) {
    return {
      ok: false,
      code: LAUNCH_REFUSAL.DEPENDENCIES,
      message: unresolvedDependenciesMessage(dependencies.waiting),
    };
  }

  // Les commandes sont verifiees ici pour produire un message precis ; le runner
  // les revalidera de toute facon avant d'en faire des permissions.
  const policy = buildClaudeToolPolicy(task.validationCommands, task.kind);
  if (!policy.ok) {
    return {
      ok: false,
      code: LAUNCH_REFUSAL.POLICY,
      message: `La commande « ${policy.refusal.command} » ne peut pas etre autorisee : ${policy.refusal.reason}`,
    };
  }

  const project = await getProjectById(db, input.projectId);
  if (project === null) {
    return { ok: false, code: LAUNCH_REFUSAL.UNKNOWN_TASK, message: UNKNOWN_TASK_MESSAGE };
  }

  // Le prompt est regenere maintenant, a partir de la base : ce n'est pas celui
  // qu'affichait la page qui est envoye, meme s'il lui est identique.
  const { prompt, sha256 } = buildExecutionPrompt(task, dependencies.dependsOn);

  const runnerRunId = randomUUID();
  // La creation refuse s'il existe deja une execution active dans ce repository,
  // dans la meme transaction que l'ecriture : c'est elle qui rend deux
  // lancements simultanes incapables de produire deux executions.
  const created = await createRun(db, {
    projectId: input.projectId,
    taskId: input.taskId,
    prompt,
    promptSha256: sha256,
    runnerRunId,
  });

  if (!created.ok) {
    switch (created.reason) {
      case "active_run":
        return { ok: false, code: LAUNCH_REFUSAL.ACTIVE_RUN, message: ACTIVE_RUN_MESSAGE };
      case "not_found":
        return { ok: false, code: LAUNCH_REFUSAL.UNKNOWN_TASK, message: UNKNOWN_TASK_MESSAGE };
    }
  }

  const run = created.run;

  // Les commandes attendues sont recopiees maintenant, avec le prompt : la
  // review de cette execution doit rester lisible meme si la specification de la
  // tache change ensuite.
  // `seedRunValidations` plutot que le service d'affichage : ce module tourne
  // toujours dans une Server Action, jamais au rendu — il n'a donc rien a faire
  // de `connection()`, et n'a pas a en dependre.
  await seedRunValidations(db, run.id, task.validationCommands);

  const started = await ports.start({
    runId: runnerRunId,
    repositoryPath: project.repositoryPath,
    prompt,
    expectedGitHead: input.expectedGitHead,
    validationCommands: [...task.validationCommands],
    // La nature vient de la base, jamais du formulaire : c'est elle qui decide
    // si l'execution recoit les programmes d'amorcage.
    taskKind: task.kind,
  });

  if (!started.ok) {
    // L'execution n'a jamais demarre : le run garde la trace de l'echec, et la
    // tache reste disponible pour un nouvel essai.
    await failRun(db, run.id, {
      errorCode:
        started.failure.kind === "runner_error"
          ? started.failure.code
          : RUNNER_ERROR.CLAUDE_START_FAILED,
      errorMessage: describeRunnerFailure(started.failure),
      finishedAt: new Date(),
    });
    await cancelTaskExecution(db, input.taskId);

    return {
      ok: false,
      code: LAUNCH_REFUSAL.RUNNER,
      message: describeRunnerFailure(started.failure),
    };
  }

  await markRunRunning(db, run.id, new Date(started.value.startedAt));
  await startTaskExecution(db, input.taskId);

  return { ok: true, runId: run.id };
}
