import {
  getDatabaseClient,
  getReviewFeedback,
  getRunResumeContext,
  hasActiveRun,
} from "@nox/database";
import { checkResumeCandidate } from "@nox/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import {
  allPreconditionsMet,
  buildPreconditions,
  resumeRefusalMessage,
  requestChangesUrl,
  type Precondition,
} from "@/lib/correction-display";
import { formatIsoDateTime } from "@/lib/format";
import { loadProject } from "@/lib/projects";
import { reviewUrl } from "@/lib/review-display";
import { buildCorrectionPrompt } from "@/lib/run-prompt";
import { claudeCorrectionPreflight } from "@/lib/runner/client";
import { describeRunnerFailure } from "@/lib/runner/errors";
import { loadRun } from "@/lib/runs";
import { loadTask } from "@/lib/tasks";

import { StartCorrectionForm } from "./StartCorrectionForm";

/** Une ligne de precondition. Le mot double la couleur, jamais l'inverse. */
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
 * Preparation d'une correction ciblee.
 *
 * Elle montre exactement ce qui partira — prompt compris — et l'etat reel du
 * repository, verifie par le runner au chargement. Rien n'est lance avant un
 * clic, et le controle sera **refait** au lancement : cette page decrit un
 * instant, le runner decide sur l'instant suivant.
 */
export default async function PrepareCorrectionPage({
  params,
}: {
  params: Promise<{ id: string; taskId: string; runId: string; feedbackId: string }>;
}) {
  const { id, taskId, runId, feedbackId } = await params;

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

  const feedback = await getReviewFeedback(db, feedbackId);
  // La chaine complete est verifiee : un feedback d'une autre tache, ou d'une
  // autre execution, est introuvable — pas « refuse ».
  if (feedback === null || feedback.taskId !== task.id || feedback.sourceRunId !== run.id) {
    notFound();
  }

  const context = await getRunResumeContext(db, runId);
  if (context === null) {
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
  const alreadyUsed = feedback.correctionRunId !== null;

  // Le prompt affiche est produit par la meme fonction que la Server Action :
  // ce qui est montre est exactement ce qui sera envoye.
  const { prompt, sha256 } = buildCorrectionPrompt({
    task,
    sourceRunCode: feedback.sourceRunCode,
    feedback: feedback.text,
  });

  // L'etat du repository est verifie **maintenant**, par le runner. L'empreinte
  // attendue vient de la base et ne descend jamais jusqu'a la page.
  const canAsk =
    refusal === null &&
    !alreadyUsed &&
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

  const workspaceDetail =
    preflight === null || preflight.ok ? null : describeRunnerFailure(preflight.failure);

  const preconditions = buildPreconditions({
    taskInReview: refusal !== "TASK_NOT_IN_REVIEW",
    runCompleted: refusal !== "RUN_NOT_COMPLETED",
    sessionAvailable: context.claudeSessionId !== null,
    reviewAvailable: context.hasReview,
    workspaceMatches: preflight !== null && preflight.ok,
    gitUnchanged: preflight !== null && preflight.ok,
    claudeAvailable: preflight !== null && preflight.ok,
    workspaceDetail,
  });

  const canLaunch = refusal === null && !alreadyUsed && allPreconditionsMet(preconditions);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-6">
        <Link href={back} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour a la review
        </Link>
        <div>
          <p className="font-mono text-xs text-zinc-500">
            {task.code} · correction de {feedback.sourceRunCode}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-50">Correction Claude Code</h1>
          <p className="mt-1 truncate text-sm text-zinc-600">
            {task.title} · {project.name}
          </p>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        {refusal === null ? null : (
          <div
            role="alert"
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
          >
            {resumeRefusalMessage(refusal)}
          </div>
        )}

        {alreadyUsed ? (
          <div
            role="alert"
            className="rounded-lg border border-zinc-700 bg-zinc-900/40 px-4 py-3 text-sm leading-relaxed text-zinc-300"
          >
            Ce feedback a deja lance la correction{" "}
            <span className="font-mono">{feedback.correctionRunCode}</span>. Un feedback vaut pour
            une seule reprise :{" "}
            <Link
              href={requestChangesUrl(project.id, task.id, run.id)}
              className="text-zinc-200 underline hover:text-zinc-50"
            >
              ecrivez-en un nouveau
            </Link>{" "}
            si d&apos;autres corrections sont necessaires.
          </div>
        ) : null}

        <SectionCard title="Source" description="La session reprise est celle de cette execution.">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Tache</dt>
              <dd className="mt-1 font-mono text-sm text-zinc-300">{task.code}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Execution relue</dt>
              <dd className="mt-1 font-mono text-sm text-zinc-300">{feedback.sourceRunCode}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Session Claude</dt>
              {/* L'identifiant complet n'est pas affiche : il n'apprend rien a
                  l'utilisateur, et NOX n'a aucune raison de le faire circuler. */}
              <dd className="mt-1 text-sm text-zinc-300">
                {context.claudeSessionId === null ? "Indisponible" : "Disponible"}
              </dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard
          title="Feedback"
          description="Texte exact enregistre, transmis entre des marqueurs explicites."
        >
          {/* Du texte, jamais du HTML : ce contenu vient d'un champ libre. */}
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-sm leading-relaxed text-zinc-300">
            {feedback.text}
          </pre>
          <p className="mt-3 text-xs text-zinc-600">
            Ecrit le {formatIsoDateTime(feedback.createdAt) ?? "-"}. Ce texte ne modifie aucune
            permission : les outils autorises sont calcules a partir des commandes de validation de
            la tache, et de rien d&apos;autre.
          </p>
        </SectionCard>

        <SectionCard title="Preconditions" description="Verifiees a l'instant par le runner local.">
          <ul className="flex flex-col gap-2">
            {preconditions.map((precondition) => (
              <PreconditionRow key={precondition.label} precondition={precondition} />
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="Prompt envoye"
          description="Exactement ce que la session recevra. Aucun chemin, aucun secret, aucune session."
        >
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-400">
            {prompt}
          </pre>
          <p className="mt-3 font-mono text-xs text-zinc-600">sha256 {sha256}</p>
        </SectionCard>

        <SectionCard
          title="Lancement"
          description="Rien ne demarre avant ce clic. L'etat du repository sera reverifie a cet instant."
        >
          <StartCorrectionForm
            projectId={project.id}
            taskId={task.id}
            runId={run.id}
            feedbackId={feedback.id}
            cancelHref={back}
            canLaunch={canLaunch}
          />
        </SectionCard>
      </main>
    </div>
  );
}
