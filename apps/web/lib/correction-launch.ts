/**
 * Lancement d'une correction Claude Code.
 *
 * ## Un seul moteur
 *
 * Ce module est le **seul** chemin vers le demarrage d'une correction. La
 * demande humaine depuis la review et la correction automatique decidee par
 * NOX l'appellent tous les deux : il n'existe pas de second moteur Claude pour
 * l'automatisme, et il ne doit pas en exister. Le dispatcher **choisit** ; ce
 * qui suit le choix est identique dans les deux cas — memes preconditions,
 * memes permissions, meme preflight, meme run, meme streaming, meme annulation,
 * meme review, meme validation autonome ensuite.
 *
 * ## Ce qui n'est jamais recu de l'appelant
 *
 * Ni prompt, ni preuve, ni commande, ni chemin de repository, ni numero de
 * tentative arbitraire. Tout est relu en base ici, a partir d'identifiants. Le
 * navigateur, lui, n'en transmet meme pas autant : il envoie des identifiants
 * de tache et d'execution, un texte libre, et des identifiants de criteres
 * humains — tous revalides.
 *
 * ## L'ordre des ecritures
 *
 * 1. **Tout est relu** — projet, tache, execution, statut, decision de review,
 *    lot, file, reservation. Aucun instantane calcule plus tot ne fait
 *    autorite : entre la decision et ce moment, un humain a pu accepter la
 *    tache dans un autre onglet.
 * 2. **Le preflight du repository**, avant toute ecriture. Un dossier de travail
 *    qui a change est une precondition, pas un echec d'execution : il ne doit
 *    laisser ni run fantome, ni reservation consommee.
 * 3. **Le run et la reservation** dans une seule transaction.
 * 4. **Le runner**, qui revalide l'empreinte juste avant de lancer le processus.
 *
 * Une reservation qui n'aboutit pas est **rendue** : elle repasse `ABANDONED`
 * avec la raison, et la place se libere pour un geste ulterieur.
 */

import {
  abandonCorrection,
  cancelTaskCorrection,
  failRun,
  getProjectById,
  getRunResumeContext,
  getCorrectionAttempt,
  hasActiveRun,
  isLatestRunForTask,
  listRunEvents,
  listTaskDependencies,
  markRunRunning,
  readProjectDeliveryPolicy,
  seedRunValidations,
  startCorrectionRun,
  startTaskCorrection,
  type DatabaseClient,
} from "@nox/database";
import {
  CORRECTION_REFUSAL,
  CORRECTION_SOURCE,
  RUNNER_ERROR,
  buildClaudeToolPolicy,
  checkResumeCandidate,
  describeActivityEvent,
  lastRecognizedActivity,
  readRunFailureCategory,
  summarizeTaskDependencies,
  type CorrectionRefusalCode,
  type ProcessFailureEvidence,
} from "@nox/shared";
import { randomUUID } from "node:crypto";

import { loadCorrectionContext } from "./correction-cycle.ts";
import { resumeCandidateFrom } from "./failure-correction.ts";
import { correctionRefusalMessage, resumeRefusalMessage } from "./correction-display.ts";
import { buildCorrectionContext } from "./correction-evidence.ts";
import { buildCorrectionPrompt } from "./run-prompt.ts";
import { claudeCorrectionPreflight, startClaudeRun } from "./runner/client.ts";
import { describeInfrastructureFailure, describeRunnerFailure } from "./runner/errors.ts";
import { unresolvedDependenciesMessage } from "./task-dependencies.ts";

const UNKNOWN_MESSAGE =
  "Cette correction ne designe rien de connu. Revenez a la review et recommencez.";

export type CorrectionLaunchOutcome =
  | { ok: true; runId: string }
  | { ok: false; code: CorrectionRefusalCode | "RUNNER" | "UNKNOWN"; message: string };

/** Acces au runner ; remplaces par des doublures dans les tests. */
export type CorrectionLaunchPorts = {
  preflight: typeof claudeCorrectionPreflight;
  start: typeof startClaudeRun;
};

const RUNNER_PORTS: CorrectionLaunchPorts = {
  preflight: claudeCorrectionPreflight,
  start: startClaudeRun,
};

function refuse(
  code: CorrectionRefusalCode | "RUNNER" | "UNKNOWN",
  message: string,
): CorrectionLaunchOutcome {
  return { ok: false, code, message };
}

/**
 * Lance la correction reservee par `attemptId`.
 *
 * La reservation est l'autorisation : elle a ete prise avant, par le chemin
 * humain ou par le chemin automatique, et elle a survecu a un eventuel arret du
 * serveur entre-temps. C'est ce qui permet a une reprise explicite de consommer
 * une reservation existante plutot que d'en creer une deuxieme.
 */
export async function launchCorrection(
  db: DatabaseClient,
  input: {
    projectId: string;
    taskId: string;
    /** Execution relue dont la correction repart. */
    sourceRunId: string;
    attemptId: string;
    /** Criteres humains signales, relus en base avant d'etre mis en forme. */
    humanCriterionIds?: readonly string[];
    /** Texte de l'utilisateur, ou `null` quand les preuves suffisent. */
    humanFeedback?: string | null;
  },
  ports: CorrectionLaunchPorts = RUNNER_PORTS,
): Promise<CorrectionLaunchOutcome> {
  const attempt = await getCorrectionAttempt(db, input.attemptId);
  if (
    attempt === null ||
    attempt.taskId !== input.taskId ||
    attempt.sourceRunId !== input.sourceRunId
  ) {
    return refuse("UNKNOWN", UNKNOWN_MESSAGE);
  }

  // Tout est relu maintenant. Le contexte calcule au moment de la reservation
  // decrivait le passe ; entre-temps, quelqu'un a pu accepter la tache, la
  // reouvrir, ou mettre la file en pause.
  const context = await loadCorrectionContext(db, {
    runId: input.sourceRunId,
    taskId: input.taskId,
  });
  if (context === null || context.task.projectId !== input.projectId) {
    return await release(db, input.attemptId, "UNKNOWN", UNKNOWN_MESSAGE);
  }

  // `attemptReserved` vaut ici `true` — c'est notre propre reservation. La
  // decision est donc rejouee en la retirant du calcul : elle ne peut pas se
  // bloquer elle-meme.
  const decision =
    attempt.source === CORRECTION_SOURCE.AUTOMATED_VALIDATION
      ? context.automatic
      : attempt.source === CORRECTION_SOURCE.PROCESS_FAILURE
        ? context.processFailure
        : context.human;
  if (
    !decision.eligible &&
    decision.code !== CORRECTION_REFUSAL.ALREADY_RESERVED
  ) {
    return await release(db, input.attemptId, decision.code, correctionRefusalMessage(decision.code));
  }

  const project = await getProjectById(db, input.projectId);
  if (project === null) {
    return await release(db, input.attemptId, "UNKNOWN", UNKNOWN_MESSAGE);
  }

  const resume = await getRunResumeContext(db, input.sourceRunId);
  if (resume === null || resume.taskId !== input.taskId) {
    return await release(db, input.attemptId, "UNKNOWN", UNKNOWN_MESSAGE);
  }

  // Le controle de reprise existant, tel quel. TASK-028 n'elargit pas ce
  // contrat : une correction travaille forcement sur un dossier de travail sale,
  // et c'est ce controle-la — branche, `HEAD`, empreinte — qui distingue « le
  // travail qu'on vient de relire » de « quelque chose d'autre ».
  // Le meme assemblage que celui de la page de preparation, par la meme
  // fonction. Les deux ont diverge une fois — sur `isLatestRun`, le champ qui
  // reconnait un `Retry` avorte — et l'ecran proposait alors une reprise que le
  // lancement aurait refusee, ou l'inverse.
  const refusal = checkResumeCandidate(
    resumeCandidateFrom(resume, {
      taskStatus: context.task.status,
      hasActiveRun: await hasActiveRun(db, input.taskId),
      isLatestRun: await isLatestRunForTask(db, input.taskId, input.sourceRunId),
    }),
  );
  if (refusal !== null) {
    return await release(
      db,
      input.attemptId,
      CORRECTION_REFUSAL.RUN_NOT_COMPLETED,
      resumeRefusalMessage(refusal),
    );
  }

  const sessionId = resume.claudeSessionId;
  const fingerprint = resume.workspaceFingerprint;
  const branch = resume.gitBranch;
  const head = resume.gitHeadAfter;
  if (sessionId === null || fingerprint === null || branch === null || head === null) {
    return await release(
      db,
      input.attemptId,
      CORRECTION_REFUSAL.RUN_NOT_COMPLETED,
      resumeRefusalMessage("FINGERPRINT_MISSING"),
    );
  }

  // Une correction est une **nouvelle execution** : la regle « B doit etre
  // terminee avant qu'une execution de A puisse demarrer » vaut donc ici aussi.
  const dependencies = summarizeTaskDependencies(await listTaskDependencies(db, input.taskId));
  if (!dependencies.allSatisfied) {
    return await release(
      db,
      input.attemptId,
      CORRECTION_REFUSAL.RUN_NOT_COMPLETED,
      unresolvedDependenciesMessage(dependencies.waiting),
    );
  }

  // Les commandes sont revalidees pour produire un message precis ; le runner
  // les revalidera de toute facon avant d'en faire des permissions. Une
  // correction `NORMAL` garde les permissions `NORMAL` : aucune politique
  // elargie n'existe pour TASK-028.
  const policy = buildClaudeToolPolicy(context.task.validationCommands, context.task.kind);
  if (!policy.ok) {
    return await release(
      db,
      input.attemptId,
      CORRECTION_REFUSAL.PLAN_INVALID,
      `La commande « ${policy.refusal.command} » ne peut pas etre autorisee : ${policy.refusal.reason}`,
    );
  }

  // Premier appel au runner : aucune ecriture tant qu'il n'est pas passe.
  const preflight = await ports.preflight({
    repositoryPath: project.repositoryPath,
    expectedGitHead: head,
    expectedBranch: branch,
    expectedWorkspaceFingerprint: fingerprint,
    // Elles n'accordent rien : le refus se decide sur l'empreinte seule. Elles
    // permettent au refus de **nommer** les chemins qui ont diverge, ce qui est
    // la difference entre « quelque chose a change » et « tu as touche a
    // README.md ».
    expectedWorkspaceEntries: resume.workspaceEntries,
  });
  if (!preflight.ok) {
    // `describeInfrastructureFailure` plutot que `describeRunnerFailure` : la
    // premiere **conserve** le detail du runner. C'est lui qui nomme les chemins
    // ayant diverge, et le perdre ici rendrait le refus aussi muet qu'avant —
    // « le repository a change », sans dire ou.
    return await release(
      db,
      input.attemptId,
      CORRECTION_REFUSAL.RUN_NOT_COMPLETED,
      describeInfrastructureFailure(preflight.failure).message,
    );
  }

  // Le contexte est construit maintenant, a partir de la base : ce n'est pas
  // celui qu'affichait la page qui part, meme s'il lui est identique.
  const built = buildCorrectionContext({
    task: context.task,
    review: context.review,
    source: attempt.source,
    automatedAttempt: attempt.automatedAttempt ?? 0,
    humanCriterionIds: readableHumanIds(context.review, input.humanCriterionIds ?? []),
    humanFeedback: input.humanFeedback ?? null,
    processFailure:
      attempt.source === CORRECTION_SOURCE.PROCESS_FAILURE
        ? await readProcessFailureEvidence(db, context.run)
        : null,
  });

  const { prompt, sha256 } = buildCorrectionPrompt({
    task: context.task,
    sourceRunCode: resume.runCode,
    feedback: input.humanFeedback ?? null,
    contract: built.contract,
    evidence: built.evidence,
  });

  const runnerRunId = randomUUID();
  const created = await startCorrectionRun(db, {
    attemptId: input.attemptId,
    taskId: input.taskId,
    parentRunId: input.sourceRunId,
    prompt,
    promptSha256: sha256,
    runnerRunId,
    resumedFromSessionId: sessionId,
  });
  if (!created.ok) {
    // Deux refus distincts, parce qu'ils n'appellent pas le meme geste. Un
    // repository occupe se libere : la reservation est rendue, et la correction
    // reste prete pour ce moment-la. Une reservation deja consommee, elle, ne se
    // rend pas — quelqu'un d'autre l'a prise, et l'abandonner effacerait sa
    // correction.
    if (created.reason === "active_run") {
      return await release(
        db,
        input.attemptId,
        CORRECTION_REFUSAL.REPOSITORY_RUN_ACTIVE,
        correctionRefusalMessage(CORRECTION_REFUSAL.REPOSITORY_RUN_ACTIVE),
      );
    }
    return refuse(
      CORRECTION_REFUSAL.ALREADY_RESERVED,
      correctionRefusalMessage(CORRECTION_REFUSAL.ALREADY_RESERVED),
    );
  }

  // Les commandes attendues sont recopiees depuis la **specification actuelle**
  // de la tache, comme pour un run initial : une correction doit satisfaire ce
  // que la tache exige aujourd'hui.
  // `seedRunValidations` plutot que le service d'affichage : ce module tourne
  // toujours dans une Server Action ou dans la finalisation d'une execution,
  // jamais au rendu — il n'a donc rien a faire de `connection()`, et n'a pas a
  // dependre de Next pour autant.
  await seedRunValidations(db, created.run.id, context.task.validationCommands);

  const started = await ports.start({
    runId: runnerRunId,
    repositoryPath: project.repositoryPath,
    prompt,
    expectedGitHead: head,
    validationCommands: [...context.task.validationCommands],
    // Une correction d'amorcage garde les permissions d'un amorcage : le
    // pipeline est le meme, sans branche selon `kind`.
    taskKind: context.task.kind,
    // Transmise pour que le contrat soit le meme des deux cotes. Une correction
    // ne passe pas par le preflight initial — elle exige un dossier de travail
    // **identique** a celui qui a ete relu, pas un depot synchronise — donc
    // cette valeur ne change rien ici. La taire ferait croire a une exception.
    deliveryPolicy: await readProjectDeliveryPolicy(db, project.id),
    correction: {
      sessionId,
      expectedBranch: branch,
      expectedWorkspaceFingerprint: fingerprint,
      expectedWorkspaceEntries: resume.workspaceEntries,
    },
  });

  if (!started.ok) {
    // La tache n'a jamais quitte `REVIEW` : rien a ramener en arriere de ce
    // cote. Le run, lui, garde la trace du refus — il existe deja, et sa
    // reservation reste consommee : une correction a bien ete tentee.
    await failRun(db, created.run.id, {
      errorCode:
        started.failure.kind === "runner_error"
          ? started.failure.code
          : RUNNER_ERROR.CLAUDE_START_FAILED,
      errorMessage: describeRunnerFailure(started.failure),
      finishedAt: new Date(),
    });
    // Le statut d'ou la correction serait partie, transmis plutot que suppose :
    // une reprise apres echec ramene la tache en `FAILED`, jamais en `REVIEW`.
    await cancelTaskCorrection(db, input.taskId, context.task.status);
    return refuse("RUNNER", describeRunnerFailure(started.failure));
  }

  await markRunRunning(db, created.run.id, new Date(started.value.startedAt));
  // `REVIEW → RUNNING` : une transition reservee aux corrections, et
  // atteignable par ce seul chemin.
  await startTaskCorrection(db, input.taskId, input.sourceRunId);

  return { ok: true, runId: created.run.id };
}

/**
 * Ce que NOX a observe de la terminaison, relu en base.
 *
 * Trois sources, toutes deja persistees : les colonnes de l'execution, et les
 * evenements de sa timeline. Rien n'est recalcule, rien n'est interprete — la
 * categorie est celle qu'a ecrite le runner, ou celle que la table derive pour
 * une execution anterieure a HOTFIX-006.
 *
 * Les dernieres actions sont **derivees** des evenements plutot que lues dans
 * une colonne : une « derniere action » stockee serait un compteur denormalise,
 * et finirait par ne plus decrire les lignes qu'elle resume.
 */
async function readProcessFailureEvidence(
  db: DatabaseClient,
  run: {
    id: string;
    status: string;
    errorCode: string | null;
    failureCategory: string | null;
    failureDetail: string | null;
    stderrTail: string | null;
    claude: { exitCode: number | null };
  },
): Promise<ProcessFailureEvidence> {
  const events = await listRunEvents(db, run.id);
  return {
    category: readRunFailureCategory(run.failureCategory, {
      status: run.status,
      errorCode: run.errorCode,
      exitCode: run.claude.exitCode,
    }),
    detail: run.failureDetail,
    exitCode: run.claude.exitCode,
    stderrTail: run.stderrTail,
    lastActivity: lastRecognizedActivity(events).map(describeActivityEvent),
  };
}

/**
 * Rend la reservation, puis refuse.
 *
 * Une reservation prise et non consommee bloquerait toute correction ulterieure
 * sur cette execution. La rendre est ce qui distingue « NOX a renonce » de
 * « NOX est en train de corriger » — deux etats qu'un utilisateur doit pouvoir
 * distinguer sans ouvrir la base.
 */
async function release(
  db: DatabaseClient,
  attemptId: string,
  code: CorrectionRefusalCode | "UNKNOWN",
  message: string,
): Promise<CorrectionLaunchOutcome> {
  await abandonCorrection(db, attemptId, code);
  return refuse(code, message);
}

/**
 * Ne garde que les identifiants de criteres humains qui en sont.
 *
 * Le formulaire designe des identifiants ; il ne definit pas la liste. Un
 * identifiant forge, ou celui d'un critere automatise, disparait ici plutot que
 * de se retrouver dans un prompt en pretendant qu'un humain l'a signale.
 */
function readableHumanIds(
  review: { humanCriteria: readonly { id: string }[] },
  ids: readonly string[],
): string[] {
  const known = new Set(review.humanCriteria.map((criterion) => criterion.id));
  return ids.filter((id) => known.has(id));
}
