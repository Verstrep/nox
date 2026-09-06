import { getDatabaseClient, getRunResumeContext, hasActiveRun } from "@nox/database";
import { CORRECTION_SOURCE, checkResumeCandidate } from "@nox/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { WorkflowLink } from "@/components/WorkflowLink";
import { loadCorrectionContext } from "@/lib/correction-cycle";
import {
  allPreconditionsMet,
  buildPreconditions,
  preconditionMark,
  preconditionStatusLabel,
  correctionRefusalMessage,
  resumeRefusalMessage,
  type Precondition,
} from "@/lib/correction-display";
import { buildCorrectionContext } from "@/lib/correction-evidence";
import { loadProject } from "@/lib/projects";
import { reviewUrl } from "@/lib/review-display";
import { buildCorrectionPrompt } from "@/lib/run-prompt";
import { claudeCorrectionPreflight } from "@/lib/runner/client";
import { describeInfrastructureFailure } from "@/lib/runner/errors";
import { loadRun } from "@/lib/runs";
import { loadTask } from "@/lib/tasks";

import { StartEvidenceCorrectionForm } from "./StartEvidenceCorrectionForm";

function PreconditionRow({ precondition }: { precondition: Precondition }) {
  // Trois etats, trois rendus. « Non verifie » se lit en gris : ce n'est ni une
  // reussite, ni un refus — c'est une question qui n'a pas ete posee.
  const tone =
    precondition.state === "met"
      ? "text-zinc-400"
      : precondition.state === "unknown"
        ? "text-zinc-500"
        : "text-amber-200";
  return (
    <li className={`flex flex-col gap-1 text-sm ${tone}`}>
      <span className="flex gap-2">
        <span aria-hidden="true">{preconditionMark(precondition.state)}</span>
        <span>{precondition.label}</span>
        <span className="sr-only">{` — ${preconditionStatusLabel(precondition.state)}`}</span>
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
 * Preparation d'une correction fondee sur les preuves de NOX.
 *
 * ## Pourquoi cette page existe a cote de la precedente
 *
 * Parce qu'une correction humaine peut n'avoir aucun texte. Quand les commandes
 * qui ont echoue disent deja tout, il n'y a rien a recopier — donc rien a
 * enregistrer comme feedback, et donc aucun identifiant de feedback dans l'URL.
 *
 * ## Ce qu'elle ne fait pas
 *
 * Elle ne reserve rien, ne lance rien, n'execute aucune commande et n'appelle ni
 * OpenAI, ni Claude Code. Le preflight du runner est une lecture, comme sur la
 * page jumelle. Tout est refait au lancement.
 */
export default async function PrepareEvidenceCorrectionPage({
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
    claudeSessionId: context.claudeSessionId,
    hasReview: context.hasReview,
    hasFingerprint: context.workspaceFingerprint !== null,
    hasActiveRun: await hasActiveRun(db, taskId),
    hasCorrection: context.hasCorrection,
  });

  const back = reviewUrl(project.id, task.id, run.id);

  const built = buildCorrectionContext({
    task,
    review: cycle.review,
    source: CORRECTION_SOURCE.HUMAN_FEEDBACK,
    automatedAttempt: 0,
    humanCriterionIds: [],
    humanFeedback: null,
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
    cycle.human.eligible &&
    context.workspaceFingerprint !== null &&
    context.gitBranch !== null &&
    context.gitHeadAfter !== null;

  const preflight = canAsk
    ? await claudeCorrectionPreflight({
        repositoryPath: project.repositoryPath,
        expectedGitHead: context.gitHeadAfter ?? "",
        expectedBranch: context.gitBranch ?? "",
        expectedWorkspaceFingerprint: context.workspaceFingerprint ?? "",
      })
    : null;

  const preconditions = buildPreconditions({
    // Les trois lignes du repository n'ont de sens que si le runner a repondu.
    // Sans cela, une precondition anterieure non tenue les afficherait « Blocked »
    // sans que rien n'ait ete verifie.
    repositoryProbed: preflight !== null,
    taskInReview: refusal !== "TASK_NOT_IN_REVIEW",
    runCompleted: refusal !== "RUN_NOT_COMPLETED",
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

  const ready = refusal === null && cycle.human.eligible && allPreconditionsMet(preconditions);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-6">
        <div className="flex flex-wrap items-center gap-4">
          <Link href={back} className="text-xs text-zinc-500 hover:text-zinc-300">
            &larr; Retour a la review
          </Link>
          <WorkflowLink projectId={project.id} taskId={task.id} />
        </div>
        <div>
          <p className="font-mono text-xs text-zinc-500">
            {task.code} · {run.code}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-50">Run correction</h1>
          <p className="mt-1 truncate text-sm text-zinc-600">
            {task.title} · {project.name}
          </p>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        <SectionCard
          title="NOX found these failures"
          description="Ce que NOX a execute lui-meme, apres l'execution. Vous n'avez rien a recopier."
        >
          {built.failedCriteria.length === 0 ? (
            <p className="text-sm leading-relaxed text-zinc-400">
              Aucune preuve automatisee n&apos;a echoue sur cette execution.
            </p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm leading-relaxed text-zinc-300">
              {built.failedCriteria.map((criterion) => (
                <li key={criterion.text}>
                  <p>{criterion.text}</p>
                  <ul className="mt-1 flex flex-col gap-1 pl-4 text-xs text-zinc-500">
                    {criterion.commands.map((command) => (
                      <li key={command.command} className="font-mono">
                        {command.command}
                        {command.exitCode === null
                          ? " · non executee"
                          : ` · exit ${String(command.exitCode)}`}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {built.truncated ? (
            <p className="mt-4 text-xs leading-relaxed text-amber-200/80">
              Le contexte transmis a ete tronque par NOX : les preuves les plus longues n&apos;ont
              pas tenu dans le budget. Le contrat de la tache, lui, part entier.
            </p>
          ) : null}
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
          {cycle.human.eligible ? null : (
            <p role="alert" className="mt-4 text-sm leading-relaxed text-amber-200">
              {correctionRefusalMessage(cycle.human.code)}
            </p>
          )}
          {refusal === null ? null : (
            <p role="alert" className="mt-4 text-sm leading-relaxed text-amber-200">
              {resumeRefusalMessage(refusal)}
            </p>
          )}
        </SectionCard>

        <SectionCard
          title="Prompt"
          description="Exactement ce qui sera envoye a la session reprise."
        >
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
            {prompt}
          </pre>
          <p className="mt-3 font-mono text-xs text-zinc-600">sha256 · {sha256}</p>
        </SectionCard>

        <SectionCard title="Lancer">
          <StartEvidenceCorrectionForm
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
