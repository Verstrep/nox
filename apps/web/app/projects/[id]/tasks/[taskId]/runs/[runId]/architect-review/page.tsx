import { ARCHITECT_REVIEW_LIMITS, RUN_VALIDATION_STATUS } from "@nox/shared";
import { getArchitectReviewSummary, getDatabaseClient, listArchitectRunReviews } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";
import process from "node:process";

import { SectionCard } from "@/components/SectionCard";
import { WorkflowLink } from "@/components/WorkflowLink";
import { ARCHITECT_ENVIRONMENT_VARIABLES, loadArchitectConfig } from "@/lib/architect/config";
import { formatChars } from "@/lib/architect/display";
import {
  ARCHITECT_REVIEW_PRIVACY_NOTICE,
  architectAnalysisUrl,
  architectReviewEligibility,
  architectReviewIneligibleMessage,
} from "@/lib/architect/review-display";
import { loadArchitectReviewContext } from "@/lib/architect/review-load";
import { prepareArchitectReview } from "@/lib/architect/review-prepare";
import { formatIsoDateTime } from "@/lib/format";
import {
  architectReviewStatusLabel,
  architectReviewVerdictLabel,
  runValidationStatusLabel,
  reviewPatchStateLabel,
} from "@/lib/labels";
import { reviewUrl } from "@/lib/review-display";

import { AnalyzeReviewForm } from "./AnalyzeReviewForm";

/**
 * Preparation d'une analyse de review.
 *
 * **Aucun appel au fournisseur n'est declenche par l'ouverture de cette page.**
 * Elle assemble le bundle, affiche exactement ce qu'il contient, et attend un
 * clic. C'est la meme fonction de preparation que celle qu'utilisera l'envoi :
 * ce qui est lu ici est ce qui partira.
 */
export default async function ArchitectReviewPage({
  params,
}: {
  params: Promise<{ id: string; taskId: string; runId: string }>;
}) {
  const { id, taskId, runId } = await params;

  const context = await loadArchitectReviewContext(id, taskId, runId);
  if (context === null) {
    notFound();
  }

  const back = reviewUrl(id, taskId, runId);
  const eligibility = architectReviewEligibility(context.run.status, context.review.capturedAt);

  if (eligibility !== "eligible") {
    return (
      <Shell projectName={context.project.name} taskCode={context.task.code} runCode={context.run.code} title={context.task.title} back={back} projectId={context.project.id} taskId={context.task.id}>
        <SectionCard title="Analyse indisponible">
          <p role="alert" className="text-sm leading-relaxed text-amber-200">
            {architectReviewIneligibleMessage(eligibility)}
          </p>
          <p className="mt-4 text-xs leading-relaxed text-zinc-600">
            <Link href={back} className="text-zinc-400 underline hover:text-zinc-200">
              Revenir a la review
            </Link>
          </p>
        </SectionCard>
      </Shell>
    );
  }

  const config = loadArchitectConfig(process.env);
  const prepared = prepareArchitectReview({
    runId: context.runId,
    task: context.task,
    run: context.run,
    review: context.review,
    repositoryPath: context.project.repositoryPath,
    // Le modele n'entre que dans l'empreinte d'entree : une configuration
    // incomplete n'empeche ni de preparer, ni de relire ce qui partirait.
    model: config.ok ? config.config.model : "",
    environment: process.env,
  });

  const db = getDatabaseClient();
  const [summary, analyses] = await Promise.all([
    getArchitectReviewSummary(db, context.runId),
    listArchitectRunReviews(db, context.runId),
  ]);

  const bundle = prepared.bundle;

  return (
    <Shell projectName={context.project.name} taskCode={context.task.code} runCode={context.run.code} title={context.task.title} back={back} projectId={context.project.id} taskId={context.task.id}>
      <SectionCard
        title="Review sent to Architect"
        description="Ce que NOX enverra, exactement. Aucun appel n'a encore ete fait."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-zinc-600">Task</h3>
            <p className="mt-2 font-mono text-sm text-zinc-200">
              {bundle.task.code} — {bundle.task.title}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {bundle.task.acceptanceCriteria.length}{" "}
              {bundle.task.acceptanceCriteria.length === 1
                ? "acceptance criterion"
                : "acceptance criteria"}
              {" · "}
              {bundle.task.validationCommands.length === 0
                ? "aucune commande de validation declaree"
                : `${bundle.task.validationCommands.length} commandes declarees`}
            </p>
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-wider text-zinc-600">Run</h3>
            <p className="mt-2 font-mono text-sm text-zinc-200">
              {bundle.run.code} · {bundle.run.status}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {bundle.run.parentRunCode === null
                ? "Initial"
                : `Correction de ${bundle.run.parentRunCode}`}
              {bundle.run.partial ? " · Partial run" : ""}
              {bundle.run.unreliable ? " · Review non fiable" : ""}
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Files" description="Dans l'ordre de la review. Aucune heuristique de tri.">
        {bundle.files.length === 0 ? (
          <p className="text-sm text-zinc-500">Cette execution n&apos;a modifie aucun fichier.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-800/60">
            {bundle.files.map((file) => (
              <li key={file.path} className="flex flex-wrap items-baseline gap-3 py-2">
                <code className="min-w-0 flex-1 break-all font-mono text-sm text-zinc-200">
                  {file.path}
                </code>
                <span className="shrink-0 font-mono text-xs text-zinc-500">{file.changeType}</span>
                <span className="w-28 shrink-0 text-right text-xs text-zinc-400">
                  {reviewPatchStateLabel(file.patchState)}
                </span>
                <span className="w-20 shrink-0 text-right font-mono text-xs text-zinc-600">
                  {file.patch === null ? "—" : formatChars(file.patch.length)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Validations"
        description="Ce que Claude Code a reellement execute. NOX n'en relance aucune."
      >
        {bundle.validations.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Cette tache ne declarait aucune commande de validation. L&apos;architecte en sera
            informe : une absence volontaire de test n&apos;est pas un echec.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-800/60">
            {bundle.validations.map((validation) => (
              <li key={validation.command} className="flex flex-wrap items-baseline gap-3 py-2">
                <code className="min-w-0 flex-1 break-all font-mono text-sm text-zinc-200">
                  {validation.command}
                </code>
                <span
                  className={`shrink-0 text-xs ${
                    validation.status === RUN_VALIDATION_STATUS.PASSED
                      ? "text-teal-200"
                      : validation.status === RUN_VALIDATION_STATUS.FAILED
                        ? "text-red-300"
                        : "text-zinc-400"
                  }`}
                >
                  {runValidationStatusLabel(validation.status)}
                </span>
                <span className="w-16 shrink-0 text-right font-mono text-xs text-zinc-600">
                  {validation.summary === null ? "—" : formatChars(validation.summary.length)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Limits" description="Ce que NOX a envoye, et ce qu'il a laisse de cote.">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wider text-zinc-600">Fichiers</dt>
            <dd className="mt-1 font-mono text-zinc-300">
              {bundle.files.length} / {bundle.fileCountAvailable}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-zinc-600">Diff transmis</dt>
            <dd className="mt-1 font-mono text-zinc-300">
              {formatChars(prepared.manifest.patchCharsIncluded)} /{" "}
              {formatChars(ARCHITECT_REVIEW_LIMITS.patchTotal)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-zinc-600">Analyses restantes</dt>
            <dd className="mt-1 font-mono text-zinc-300">
              {summary.analysesLeft} / {ARCHITECT_REVIEW_LIMITS.analyses}
            </dd>
          </div>
        </dl>

        <p
          className={`mt-5 rounded-md border px-3 py-2 text-xs leading-relaxed ${
            bundle.truncated
              ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
              : "border-teal-400/20 bg-teal-400/5 text-teal-200/90"
          }`}
        >
          {bundle.truncated
            ? "Cette review contient plus d'informations que le bundle n'en transmet. L'architecte ne pourra pas recommander une approbation."
            : "No Architect truncation : tout ce que la review enregistre est transmis."}
        </p>

        {bundle.omittedFiles === 0 ? null : (
          <p className="mt-3 text-xs leading-relaxed text-amber-200">
            {bundle.omittedFiles} fichiers changes ne figurent pas dans la review enregistree.
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Exact payload preview"
        description="Le texte reel, produit par le meme pipeline que l'envoi."
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          {ARCHITECT_REVIEW_PRIVACY_NOTICE}
        </p>

        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wider text-zinc-600">Modele</dt>
            <dd className="mt-1 font-mono text-zinc-300">
              {config.ok ? config.config.model : "non configure"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-zinc-600">Prompt</dt>
            <dd className="mt-1 font-mono text-zinc-300">{prepared.prompt.version}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-zinc-600">Taille envoyee</dt>
            <dd className="mt-1 font-mono text-zinc-300">
              {formatChars(prepared.prompt.instructions.length + prepared.prompt.input.length)}
            </dd>
          </div>
        </dl>

        <details className="mt-5 rounded-md border border-zinc-800 bg-zinc-950">
          <summary className="cursor-pointer px-4 py-3 text-sm text-zinc-300">
            Voir le texte exact envoye
          </summary>
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words border-t border-zinc-800 px-4 py-3 font-mono text-xs leading-relaxed text-zinc-400">
            {`${prepared.prompt.instructions}\n\n---\n\n${prepared.prompt.input}`}
          </pre>
        </details>
      </SectionCard>

      <SectionCard title="Analyze" description="Un clic, un appel, une facture.">
        {config.ok ? null : (
          <p
            role="alert"
            className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
          >
            L&apos;architecte n&apos;est pas configure. Renseignez{" "}
            {ARCHITECT_ENVIRONMENT_VARIABLES.join(" et ")} dans le fichier .env a la racine, puis
            redemarrez l&apos;application web.
          </p>
        )}

        {summary.analysesLeft > 0 ? null : (
          <p
            role="alert"
            className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
          >
            Cette execution a atteint son nombre maximal d&apos;analyses. Les analyses existantes
            restent consultables ci-dessous.
          </p>
        )}

        <AnalyzeReviewForm
          projectId={id}
          taskId={taskId}
          runId={runId}
          inputHash={prepared.inputHash}
          cancelHref={back}
          configured={config.ok}
          exhausted={summary.analysesLeft === 0}
        />
      </SectionCard>

      {analyses.length === 0 ? null : (
        <SectionCard title="Historique" description="Chaque analyse reste consultable.">
          <ul className="flex flex-col divide-y divide-zinc-800/60">
            {analyses.map((analysis) => (
              <li key={analysis.id} className="flex flex-wrap items-baseline gap-3 py-3">
                <Link
                  href={architectAnalysisUrl(id, taskId, runId, analysis.id)}
                  className="font-mono text-sm text-zinc-300 underline hover:text-zinc-100"
                >
                  {analysis.code}
                </Link>
                <span className="min-w-0 flex-1 text-sm text-zinc-400">
                  {analysis.finalVerdict === null
                    ? architectReviewStatusLabel(analysis.status)
                    : architectReviewVerdictLabel(analysis.finalVerdict)}
                </span>
                <span className="shrink-0 font-mono text-xs text-zinc-600">{analysis.model}</span>
                <span className="shrink-0 text-xs text-zinc-600">
                  {formatIsoDateTime(analysis.createdAt) ?? "-"}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </Shell>
  );
}

/** En-tete commun aux deux etats de la page. */
function Shell({
  projectName,
  taskCode,
  runCode,
  title,
  back,
  projectId,
  taskId,
  children,
}: {
  projectName: string;
  taskCode: string;
  runCode: string;
  title: string;
  back: string;
  projectId: string;
  taskId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-6">
        <div className="flex flex-wrap items-center gap-4">
          <Link href={back} className="text-xs text-zinc-500 hover:text-zinc-300">
            &larr; Retour a la review
          </Link>
          <WorkflowLink projectId={projectId} taskId={taskId} />
        </div>
        <div>
          <p className="font-mono text-xs text-zinc-500">
            {taskCode} · {runCode}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-50">Analyser avec l&apos;Architecte</h1>
          <p className="mt-1 truncate text-sm text-zinc-600">
            {title} · {projectName}
          </p>
        </div>
      </header>

      <main className="flex flex-col gap-6">{children}</main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        L&apos;architecte analyse la review enregistree, jamais votre dossier de travail actuel. Il
        recommande ; la decision reste la votre.
      </footer>
    </div>
  );
}
