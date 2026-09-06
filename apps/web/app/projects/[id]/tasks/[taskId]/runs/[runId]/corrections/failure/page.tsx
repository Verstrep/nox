import { getDatabaseClient, getRunResumeContext, hasActiveRun, listRunEvents } from "@nox/database";
import {
  CORRECTION_SOURCE,
  checkResumeCandidate,
  describeActivityEvent,
  lastRecognizedActivity,
} from "@nox/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { WorkflowLink } from "@/components/WorkflowLink";
import { loadCorrectionContext } from "@/lib/correction-cycle";
import {
  allPreconditionsMet,
  buildPreconditions,
  correctionRefusalMessage,
  resumeRefusalMessage,
  type Precondition,
} from "@/lib/correction-display";
import { buildCorrectionContext } from "@/lib/correction-evidence";
import { loadProject } from "@/lib/projects";
import {
  NO_ENTRY_DIAGNOSTICS_NOTICE,
  PROTOCOL_LIMITS_NOTICE,
  STRANDED_RETRY_NOTICE,
  runFailureCategoryLabel,
  runFailureCategoryMeaning,
} from "@/lib/run-failure-display";
import { buildCorrectionPrompt } from "@/lib/run-prompt";
import { runUrl } from "@/lib/run-display";
import { claudeCorrectionPreflight } from "@/lib/runner/client";
import { describeInfrastructureFailure } from "@/lib/runner/errors";
import { loadRun } from "@/lib/runs";
import { loadTask } from "@/lib/tasks";

import { StartFailureCorrectionForm } from "./StartFailureCorrectionForm";

function PreconditionRow({ precondition }: { precondition: Precondition }) {
  const met = precondition.state === "met";
  return (
    <li className={`flex flex-col gap-1 text-sm ${met ? "text-zinc-400" : "text-amber-200"}`}>
      <span className="flex gap-2">
        <span aria-hidden="true">{met ? "✓" : "✗"}</span>
        <span>{precondition.label}</span>
        <span className="sr-only">{met ? " — OK" : " — Blocked"}</span>
      </span>
      {precondition.detail === null ? null : (
        <span className="pl-6 text-xs leading-relaxed text-amber-200/90">
          {precondition.detail}
        </span>
      )}
    </li>
  );
}

/**
 * Preparation d'une reprise apres l'echec d'une execution.
 *
 * ## Pourquoi une troisieme page de correction
 *
 * Parce que le point de depart n'est pas le meme. Les deux autres partent d'une
 * review : quelqu'un a lu le travail et demande autre chose. Celle-ci part d'un
 * processus qui s'est arrete avant d'avoir fini — personne n'a rien lu, rien
 * n'est reproche au travail, il est simplement inacheve.
 *
 * Afficher « voici ce que NOX a prouve » devant un travail que personne n'a
 * mesure aurait ete faux, et c'est ce qui justifie une page a part plutot qu'un
 * drapeau dans la precedente.
 *
 * ## Ce qu'elle ne fait pas
 *
 * Elle ne reserve rien, ne lance rien, n'ecrit rien, et n'appelle ni OpenAI ni
 * Claude Code. Le preflight du runner est une lecture. Tout est refait au
 * lancement, et l'empreinte du dossier de travail est recalculee une derniere
 * fois juste avant le spawn.
 */
export default async function PrepareFailureCorrectionPage({
  params,
}: {
  params: Promise<{ id: string; taskId: string; runId: string }>;
}) {
  const { id, taskId, runId } = await params;

  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const task = await loadTask(taskId);
  if (task === null || task.projectId !== project.id) {
    notFound();
  }

  const run = await loadRun(runId);
  if (run === null || run.taskId !== task.id) {
    notFound();
  }

  const db = getDatabaseClient();
  const context = await getRunResumeContext(db, runId);
  if (context === null || context.taskId !== taskId) {
    notFound();
  }

  const cycle = await loadCorrectionContext(db, { runId: run.id, taskId: task.id });
  if (cycle === null) {
    notFound();
  }

  const refusal = checkResumeCandidate({
    runStatus: context.status,
    taskStatus: task.status,
    errorCode: context.errorCode,
    exitCode: context.exitCode,
    claudeSessionId: context.claudeSessionId,
    hasReview: context.hasReview,
    hasFingerprint: context.workspaceFingerprint !== null,
    hasActiveRun: await hasActiveRun(db, taskId),
    hasCorrection: context.hasCorrection,
  });

  const back = runUrl(project.id, task.id, run.id);

  // Le meme diagnostic que celui qui partira dans le prompt, lu au meme endroit.
  // Deux lectures differentes finiraient par afficher autre chose que ce qui est
  // envoye, et c'est exactement ce que la preparation existe pour eviter.
  const events = await listRunEvents(db, run.id);
  const activity = lastRecognizedActivity(events).map(describeActivityEvent);

  const built = buildCorrectionContext({
    task,
    review: cycle.review,
    source: CORRECTION_SOURCE.PROCESS_FAILURE,
    automatedAttempt: 0,
    humanCriterionIds: [],
    humanFeedback: null,
    processFailure: {
      category: cycle.failureCategory,
      detail: run.failureDetail,
      exitCode: run.claude.exitCode,
      stderrTail: run.stderrTail,
      lastActivity: activity,
    },
  });

  // Le prompt affiche est produit par la meme fonction que la Server Action :
  // ce qui est montre est exactement ce qui sera envoye.
  const { prompt, sha256 } = buildCorrectionPrompt({
    task,
    sourceRunCode: context.runCode,
    feedback: null,
    contract: built.contract,
    evidence: built.evidence,
  });

  const canAsk =
    refusal === null &&
    cycle.processFailure.eligible &&
    context.workspaceFingerprint !== null &&
    context.gitBranch !== null &&
    context.gitHeadAfter !== null;

  const preflight = canAsk
    ? await claudeCorrectionPreflight({
        repositoryPath: project.repositoryPath,
        expectedGitHead: context.gitHeadAfter ?? "",
        expectedBranch: context.gitBranch ?? "",
        expectedWorkspaceFingerprint: context.workspaceFingerprint ?? "",
        expectedWorkspaceEntries: context.workspaceEntries,
      })
    : null;

  const preconditions = buildPreconditions({
    fromFailedRun: true,
    taskInReview: refusal !== "TASK_NOT_IN_REVIEW",
    runCompleted: refusal !== "RUN_NOT_COMPLETED" && refusal !== "NO_PARTIAL_WORK",
    sessionAvailable: context.claudeSessionId !== null,
    reviewAvailable: context.hasReview,
    workspaceMatches: preflight?.ok === true,
    gitUnchanged: preflight?.ok === true,
    claudeAvailable: preflight?.ok === true,
    // Le detail du runner est conserve : c'est lui qui nomme les chemins ayant
    // diverge. Un refus qu'on ne peut pas diagnostiquer finit par etre
    // contourne, et le contournement detruit le travail qu'il protegeait.
    workspaceDetail:
      preflight === null || preflight.ok
        ? null
        : describeInfrastructureFailure(preflight.failure).message,
  });

  const ready =
    refusal === null && cycle.processFailure.eligible && allPreconditionsMet(preconditions);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-6">
        <div className="flex flex-wrap items-center gap-4">
          <Link href={back} className="text-xs text-zinc-500 hover:text-zinc-300">
            &larr; Retour a l&apos;execution
          </Link>
          <WorkflowLink projectId={project.id} taskId={task.id} />
        </div>
        <div>
          <p className="font-mono text-xs text-zinc-500">
            {task.code} · {run.code}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-50">Correct failed run</h1>
          {cycle.strandedRetry ? (
            <p className="mt-2 max-w-prose rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
              {STRANDED_RETRY_NOTICE}
            </p>
          ) : null}
          <p className="mt-1 truncate text-sm text-zinc-600">
            {task.title} · {project.name}
          </p>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        <SectionCard
          title="Why the run failed"
          description="Ce que NOX a observe, et rien de plus."
        >
          <dl className="flex flex-col gap-3 text-sm leading-relaxed">
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-600">Cause</dt>
              <dd className="text-zinc-200">{runFailureCategoryLabel(cycle.failureCategory)}</dd>
              <dd className="mt-1 text-xs leading-relaxed text-zinc-500">
                {runFailureCategoryMeaning(cycle.failureCategory)}
              </dd>
            </div>
            {run.failureDetail === null ? null : (
              <div>
                <dt className="text-xs uppercase tracking-wide text-zinc-600">Constat</dt>
                <dd className="text-zinc-300">{run.failureDetail}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-600">Code de sortie</dt>
              <dd className="font-mono text-zinc-300">
                {run.claude.exitCode === null
                  ? "aucun — processus termine par un signal"
                  : String(run.claude.exitCode)}
              </dd>
            </div>
          </dl>

          {activity.length === 0 ? (
            <p className="mt-4 text-sm leading-relaxed text-zinc-500">
              Aucune action n&apos;a ete reconnue avant l&apos;arret.
            </p>
          ) : (
            <div className="mt-4">
              <p className="text-xs uppercase tracking-wide text-zinc-600">
                Dernieres actions reconnues
              </p>
              <ol className="mt-2 flex flex-col gap-1 text-xs leading-relaxed text-zinc-400">
                {activity.map((entry, index) => (
                  <li key={`${String(index)}-${entry}`}>{entry}</li>
                ))}
              </ol>
            </div>
          )}

          <p className="mt-4 text-xs leading-relaxed text-zinc-600">{PROTOCOL_LIMITS_NOTICE}</p>
        </SectionCard>

        <SectionCard
          title="Preconditions"
          description="Verifiees maintenant, et refaites au lancement."
        >
          <ul className="flex flex-col gap-2">
            {preconditions.map((precondition) => (
              <PreconditionRow key={precondition.label} precondition={precondition} />
            ))}
          </ul>
          {cycle.processFailure.eligible ? null : (
            <p role="alert" className="mt-4 text-sm leading-relaxed text-amber-200">
              {correctionRefusalMessage(cycle.processFailure.code)}
            </p>
          )}
          {refusal === null ? null : (
            <p role="alert" className="mt-4 text-sm leading-relaxed text-amber-200">
              {resumeRefusalMessage(refusal)}
            </p>
          )}
          <p className="mt-4 text-xs leading-relaxed text-zinc-600">
            Le dossier de travail n&apos;a pas besoin d&apos;etre propre — c&apos;est meme
            l&apos;inverse : il doit etre <strong>exactement</strong> celui que l&apos;execution a
            laisse. Un fichier modifie depuis, meme d&apos;un caractere, fait refuser la reprise.
          </p>
          {context.workspaceEntries === null ? (
            <p className="mt-2 text-xs leading-relaxed text-zinc-600">
              {NO_ENTRY_DIAGNOSTICS_NOTICE}
            </p>
          ) : null}
        </SectionCard>

        <SectionCard
          title="Prompt"
          description="Exactement ce qui sera envoye a la session reprise."
        >
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
            {prompt}
          </pre>
          <p className="mt-3 font-mono text-xs text-zinc-600">sha256 · {sha256}</p>
          {built.truncated ? (
            <p className="mt-3 text-xs leading-relaxed text-amber-200/80">
              Le contexte transmis a ete tronque par NOX : le diagnostic le plus long n&apos;a pas
              tenu dans le budget. Le contrat de la tache, lui, part entier.
            </p>
          ) : null}
        </SectionCard>

        <SectionCard
          title="Lancer la reprise"
          description="Une action humaine, et un seul processus Claude Code."
        >
          <StartFailureCorrectionForm
            projectId={project.id}
            taskId={task.id}
            runId={run.id}
            cancelHref={back}
            canLaunch={ready}
          />
        </SectionCard>
      </main>
    </div>
  );
}
