/**
 * Validation autonome apres une execution, et completion automatique.
 *
 * ## Ce que NOX prouve, et ce qu'il ne fait que lire
 *
 * Claude Code rapporte les commandes qu'il dit avoir lancees. C'est une
 * information, et elle reste affichee. Ce n'est pas une preuve : elle vient de
 * celui dont on evalue le travail. Ce module execute les commandes **lui-meme**,
 * apres coup, et ce sont ces resultats-la — et eux seuls — qui peuvent conclure
 * une tache sans humain.
 *
 * ## Le declenchement
 *
 * L'evenement de finalisation d'une execution, jamais un rendu de page. Rouvrir
 * une review vingt fois ne lance aucun processus : la reservation persistante
 * refuse tout lot au-dela du premier. C'est la reservation qui porte cette
 * garantie, pas la discipline de l'appelant.
 *
 * ## Ce module n'a aucun echappatoire
 *
 * Aucun parametre `force`, `override` ou `ignoreFailure`. Le chemin automatique
 * a une seule issue favorable : toutes les preuves pre-approuvees sont passees.
 * Toute autre situation mene a une relecture humaine, ou c'est un humain qui
 * decide — avec son nom sur la decision.
 */

import {
  completeValidationBatch,
  getLatestValidationBatch,
  getProjectById,
  getRunById,
  getTaskById,
  readVerificationPlan,
  recordValidationResult,
  reserveValidationBatch,
  startValidationBatch,
  summarizeBatchStatus,
  type DatabaseClient,
} from "@nox/database";
import {
  AUTONOMOUS_VALIDATION_STATUS,
  REVIEW_DECISION_SOURCE,
  RUN_STATUS,
  TASK_KIND,
  TASK_STATUS,
  autonomousCommandsFor,
  checkAutoCompletion,
  checkVerificationPlan,
  deriveCriterionResults,
  deriveTaskVerificationOutcome,
  type AutonomousCommandOutcome,
  type AutonomousValidationStatus,
  type ValidationBatchStatus,
} from "@nox/shared";

import { readRepositoryTrackedState, runValidationCommand } from "./runner/client.ts";
import type { AdvanceQueueResult } from "./queue.ts";

/** Acces au runner ; remplaces par des doublures dans les tests. */
export type AutonomousValidationPorts = {
  run: typeof runValidationCommand;
  trackedState: typeof readRepositoryTrackedState;
};

const RUNNER_PORTS: AutonomousValidationPorts = {
  run: runValidationCommand,
  trackedState: readRepositoryTrackedState,
};

/** Pourquoi aucun lot n'a ete lance. */
export const VALIDATION_SKIP = {
  /** L'execution n'existe pas, ou son projet non plus. */
  UNKNOWN: "UNKNOWN",
  /** L'execution ne s'est pas terminee normalement : rien a valider. */
  RUN_NOT_COMPLETED: "RUN_NOT_COMPLETED",
  /** Le plan ne comporte aucune commande autonome liee a un critere. */
  NO_AUTOMATED_VALIDATION: "NO_AUTOMATED_VALIDATION",
  /** Un lot existe deja pour cette execution. */
  ALREADY_RESERVED: "ALREADY_RESERVED",
  /** Le plan enregistre n'est pas valide : rien ne peut en etre prouve. */
  PLAN_INVALID: "PLAN_INVALID",
} as const;

export type ValidationSkipReason = (typeof VALIDATION_SKIP)[keyof typeof VALIDATION_SKIP];

export type AutonomousValidationOutcome =
  | { ran: false; reason: ValidationSkipReason; autoCompleted: false }
  | {
      ran: true;
      batchId: string;
      batchStatus: ValidationBatchStatus;
      autoCompleted: boolean;
      /** Avancement tente apres une completion automatique, sinon `null`. */
      dispatch: AdvanceQueueResult | null;
    };

function skip(reason: ValidationSkipReason): AutonomousValidationOutcome {
  return { ran: false, reason, autoCompleted: false };
}

/**
 * Traduit ce que le runner a rendu en issue de validation.
 *
 * Un depassement de delai est un **echec de validation**, pas une panne : la
 * commande a bien demarre, elle n'a simplement pas prouve ce qu'elle devait
 * prouver dans le temps imparti. Convention unique, appliquee ici.
 */
function toStatus(result: {
  exitCode: number | null;
  timedOut: boolean;
}): AutonomousValidationStatus {
  if (result.timedOut) {
    return AUTONOMOUS_VALIDATION_STATUS.TIMED_OUT;
  }
  return result.exitCode === 0
    ? AUTONOMOUS_VALIDATION_STATUS.PASSED
    : AUTONOMOUS_VALIDATION_STATUS.FAILED;
}

/**
 * Execute les validations autonomes d'une execution, puis decide.
 *
 * Appele depuis la finalisation d'une execution et depuis le bouton de reprise
 * apres panne. Jamais depuis un rendu.
 *
 * `retry` n'ouvre une nouvelle tentative que sur un lot `ERROR` — une commande
 * qui a reellement echoue n'a pas de seconde chance : le code n'a pas change, et
 * relancer donnerait le meme resultat.
 */
export async function runAutonomousValidation(
  db: DatabaseClient,
  runId: string,
  options: { retry?: boolean } = {},
  ports: AutonomousValidationPorts = RUNNER_PORTS,
): Promise<AutonomousValidationOutcome> {
  const run = await getRunById(db, runId);
  if (run === null) {
    return skip(VALIDATION_SKIP.UNKNOWN);
  }

  // Une execution qui a echoue, ete bloquee ou annulee n'a rien a valider : le
  // probleme n'est pas encore la qualite du resultat.
  if (run.status !== RUN_STATUS.COMPLETED) {
    return skip(VALIDATION_SKIP.RUN_NOT_COMPLETED);
  }

  const task = await getTaskById(db, run.taskId);
  if (task === null) {
    return skip(VALIDATION_SKIP.UNKNOWN);
  }
  const project = await getProjectById(db, task.projectId);
  if (project === null) {
    return skip(VALIDATION_SKIP.UNKNOWN);
  }

  const plan = await readVerificationPlan(db, task.id);
  if (!checkVerificationPlan(plan).ok) {
    // Un plan invalide ne prouve rien. Ne pas lancer est plus honnete que de
    // produire des resultats qu'aucun critere ne saurait interpreter.
    return skip(VALIDATION_SKIP.PLAN_INVALID);
  }

  const commands = autonomousCommandsFor(plan);
  if (commands.length === 0) {
    // Aucun lot artificiel : une tache entierement humaine n'a pas de lot vide a
    // afficher, et l'ecran dira « aucune validation autonome configuree ».
    return skip(VALIDATION_SKIP.NO_AUTOMATED_VALIDATION);
  }

  const reserved = await reserveValidationBatch(db, runId, { retry: options.retry ?? false });
  if (!reserved.ok) {
    return skip(
      reserved.reason === "run_not_found" ? VALIDATION_SKIP.UNKNOWN : VALIDATION_SKIP.ALREADY_RESERVED,
    );
  }

  // L'etat suivi **avant** : c'est la moitie de la question posee par la
  // decision de TASK-027 sur l'ordre de capture. La review Git du runner, elle,
  // reste l'instantane du travail de Claude et n'est pas retouchee.
  const before = await ports.trackedState(project.repositoryPath);
  await startValidationBatch(db, reserved.batchId, before.ok ? before.value.digest : null);

  const outcomes: AutonomousCommandOutcome[] = [];
  const statuses: AutonomousValidationStatus[] = [];
  let infrastructureError: { code: string; message: string } | null = null;

  // Sequentiel et deterministe, dans l'ordre de la tache. Chaque commande est
  // tentee : une review qui dit « build echoue, tests passent, typecheck
  // echoue » est plus utile qu'un seul premier echec.
  for (const [position, command] of commands.entries()) {
    const executed = await ports.run({
      repositoryPath: project.repositoryPath,
      command: command.command,
    });

    if (!executed.ok) {
      const status = AUTONOMOUS_VALIDATION_STATUS.ERROR;
      const message =
        executed.failure.kind === "runner_error"
          ? executed.failure.code
          : "Le runner n'a pas repondu.";
      infrastructureError ??= { code: "VALIDATION_UNAVAILABLE", message };

      await recordValidationResult(db, reserved.batchId, {
        position,
        commandId: command.id,
        command: command.command,
        status,
        exitCode: null,
        durationMs: null,
        stdout: null,
        stdoutTruncated: false,
        stderr: message,
        stderrTruncated: false,
      });
      outcomes.push({ commandId: command.id, status });
      statuses.push(status);
      continue;
    }

    const result = executed.value;
    const status = toStatus(result);
    await recordValidationResult(db, reserved.batchId, {
      position,
      commandId: command.id,
      command: command.command,
      status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stdoutTruncated: result.stdoutTruncated,
      stderr: result.stderr,
      stderrTruncated: result.stderrTruncated,
    });
    outcomes.push({ commandId: command.id, status });
    statuses.push(status);
  }

  const after = await ports.trackedState(project.repositoryPath);
  const batchStatus = summarizeBatchStatus(statuses);

  await completeValidationBatch(db, reserved.batchId, {
    status: batchStatus,
    trackedStateAfter: after.ok ? after.value.digest : null,
    errorCode: infrastructureError?.code ?? null,
    errorMessage: infrastructureError?.message ?? null,
  });

  const results = deriveCriterionResults(plan, outcomes);
  const outcome = deriveTaskVerificationOutcome(results);

  // Deux empreintes connues et differentes : la preuve a modifie le travail
  // qu'elle evaluait. Deux empreintes inconnues ne prouvent rien non plus — ne
  // pas savoir n'est pas « rien n'a bouge ».
  const mutated =
    !before.ok || !after.ok ? true : before.value.digest !== after.value.digest;

  const decision = checkAutoCompletion({
    taskKind: task.kind,
    taskStatus: task.status,
    runStatus: run.status,
    planValid: true,
    outcome,
    batchStatus,
    trackedFilesMutated: mutated,
  });

  if (!decision.eligible) {
    return {
      ran: true,
      batchId: reserved.batchId,
      batchStatus,
      autoCompleted: false,
      dispatch: null,
    };
  }

  const completed = await completeTaskAutomatically(db, {
    projectId: task.projectId,
    taskId: task.id,
    runId,
  });

  return {
    ran: true,
    batchId: reserved.batchId,
    batchStatus,
    autoCompleted: completed.ok,
    dispatch: completed.ok ? completed.dispatch : null,
  };
}

/**
 * Termine une tache sans clic humain.
 *
 * La transition et la decision sont ecrites **dans la meme transaction** : une
 * acceptation humaine simultanee et une completion automatique visent la meme
 * ligne unique par execution, donc exactement une aboutit. La file n'avance donc
 * jamais deux fois.
 */
async function completeTaskAutomatically(
  db: DatabaseClient,
  input: { projectId: string; taskId: string; runId: string },
): Promise<{ ok: true; dispatch: AdvanceQueueResult } | { ok: false }> {
  const { applyTaskTransition } = await import("./task-lifecycle.ts");

  const transition = await applyTaskTransition(db, {
    projectId: input.projectId,
    taskId: input.taskId,
    status: TASK_STATUS.COMPLETED,
    decision: {
      runId: input.runId,
      // La source est enregistree : ecrire « approuve par l'utilisateur » quand
      // personne n'a clique serait un mensonge dans l'historique.
      source: REVIEW_DECISION_SOURCE.AUTOMATED,
      overrideReason: null,
      confirmations: [],
    },
  });

  if (!transition.ok) {
    return { ok: false };
  }
  return { ok: true, dispatch: transition.dispatch ?? { outcome: "EMPTY", taskId: null, runId: null, message: null } };
}

/**
 * L'amorcage ne se termine jamais seul.
 *
 * Verifie ici **en plus** de la regle centrale, parce que c'est la question la
 * plus facile a oublier le jour ou quelqu'un ajoutera un chemin de completion.
 */
export function isAutoCompletionCandidateKind(kind: string): boolean {
  return kind !== TASK_KIND.BOOTSTRAP;
}

/** Le dernier lot d'une execution, tel que les ecrans le lisent. */
export function loadLatestBatch(db: DatabaseClient, runId: string) {
  return getLatestValidationBatch(db, runId);
}
