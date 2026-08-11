import { REVIEW_FEEDBACK_LIMITS, checkResumeCandidate } from "@nox/shared";
import {
  getArchitectRunReview,
  getDatabaseClient,
  getRunResumeContext,
  hasActiveRun,
} from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { resumeRefusalMessage } from "@/lib/correction-display";
import { loadProject } from "@/lib/projects";
import { reviewUrl } from "@/lib/review-display";
import { loadRun } from "@/lib/runs";
import { loadTask } from "@/lib/tasks";

import { RequestChangesForm } from "./RequestChangesForm";

/**
 * Demande de corrections sur une execution relue.
 *
 * La page n'affiche le formulaire que si la reprise est reellement possible. Un
 * refus est explique plutot que masque : « le bouton a disparu » n'apprend rien,
 * « ta branche a change » se corrige en dix secondes.
 */
export default async function RequestChangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; taskId: string; runId: string }>;
  searchParams: Promise<{ analysis?: string }>;
}) {
  const { id, taskId, runId } = await params;
  const { analysis: analysisId } = await searchParams;

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
  if (context === null) {
    notFound();
  }

  const refusal = checkResumeCandidate({
    runStatus: context.status,
    taskStatus: task.status,
    errorCode: context.errorCode,
    claudeSessionId: context.claudeSessionId,
    hasReview: context.hasReview,
    // L'empreinte n'est jamais rendue : seule son existence l'est.
    hasFingerprint: context.workspaceFingerprint !== null,
    hasActiveRun: await hasActiveRun(db, taskId),
    hasCorrection: context.hasCorrection,
  });

  // Feedback suggere par une analyse Architecte, lorsque l'utilisateur arrive
  // depuis « Use as feedback ». Le texte est relu **en base** a partir d'un
  // identifiant : le navigateur ne transporte jamais le feedback lui-meme, et
  // une analyse d'une autre execution ne prefixe rien du tout.
  const suggested =
    analysisId === undefined || analysisId === ""
      ? null
      : await getArchitectRunReview(db, analysisId);
  const suggestedFeedback =
    suggested !== null && suggested.runId === run.id ? suggested.feedback : null;

  const back = reviewUrl(project.id, task.id, run.id);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-6">
        <Link href={back} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour a la review
        </Link>
        <div>
          <p className="font-mono text-xs text-zinc-500">
            {task.code} · {run.code}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-50">Demander des corrections</h1>
          <p className="mt-1 truncate text-sm text-zinc-600">
            {task.title} · {project.name}
          </p>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        {suggestedFeedback === null ? null : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm leading-relaxed text-zinc-400">
            <p className="font-medium text-zinc-200">Feedback propose par l&apos;Architecte</p>
            <p className="mt-1">
              Le champ ci-dessous est prerempli avec le texte de{" "}
              <span className="font-mono text-zinc-300">{suggested?.code}</span>. Relisez-le,
              modifiez-le ou effacez-le : c&apos;est votre texte qui sera transmis, et rien
              n&apos;est encore lance.
            </p>
          </div>
        )}

        <SectionCard
          title="Ce qui va se passer"
          description="Claude Code reprendra la session de cette execution, pas une conversation neuve."
        >
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-zinc-400">
            <li>Le travail deja produit reste en place : rien n&apos;est restaure ni annule.</li>
            <li>
              Le repository devra etre <strong className="text-zinc-300">exactement</strong> dans
              l&apos;etat que vous venez de relire. Si vous avez modifie un fichier depuis, NOX
              refusera de reprendre.
            </li>
            <li>Une nouvelle execution sera creee ; celle-ci restera consultable telle quelle.</li>
            <li>Aucun commit, aucun push, aucun `git add`.</li>
          </ul>
        </SectionCard>

        {refusal === null ? (
          <SectionCard
            title="Feedback"
            description="Ce texte sera transmis a la session, entre des marqueurs explicites."
          >
            <RequestChangesForm
              projectId={project.id}
              taskId={task.id}
              runId={run.id}
              cancelHref={back}
              maxLength={REVIEW_FEEDBACK_LIMITS.maxLength}
              suggestedFeedback={suggestedFeedback}
            />
          </SectionCard>
        ) : (
          <SectionCard title="Reprise indisponible">
            <p role="alert" className="text-sm leading-relaxed text-amber-200">
              {resumeRefusalMessage(refusal)}
            </p>
            <p className="mt-4 text-xs leading-relaxed text-zinc-600">
              <Link href={back} className="text-zinc-400 underline hover:text-zinc-200">
                Revenir a la review
              </Link>{" "}
              pour accepter le travail ou remettre la tache en file.
            </p>
          </SectionCard>
        )}
      </main>
    </div>
  );
}
