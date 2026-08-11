import {
  RESUME_REFUSAL,
  RUN_VALIDATION_STATUS,
  TASK_STATUS,
  checkResumeCandidate,
  totalRunReview,
  type RunFileChange,
  type RunValidationResultView,
} from "@nox/shared";
import {
  getArchitectReviewSummary,
  getDatabaseClient,
  getFeedbackForCorrectionRun,
  getRunResumeContext,
  hasActiveRun,
  listFeedbacksForSourceRun,
} from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { formatIsoDateTime } from "@/lib/format";
import {
  architectReviewStatusLabel,
  architectReviewVerdictLabel,
  runChangeTypeLabel,
  runChangeTypeMark,
  runStatusLabel,
  runValidationStatusLabel,
  runValidationSummaryLabel,
  taskStatusLabel,
} from "@/lib/labels";
import {
  architectAnalysisUrl,
  architectReviewEligibility,
  architectReviewIneligibleMessage,
  architectReviewUrl,
} from "@/lib/architect/review-display";
import { requestChangesUrl, resumeRefusalMessage } from "@/lib/correction-display";
import { loadProject } from "@/lib/projects";
import { formatDuration, runStatusTone, runUrl, shortSha } from "@/lib/run-display";
import {
  hasPartialChanges,
  isUnknownReviewFile,
  reviewAvailability,
  reviewUnavailableMessage,
  reviewOutcomeNotice,
  reviewUrl,
  reviewValidationSummary,
  selectReviewFile,
  validationSummaryTone,
} from "@/lib/review-display";
import { loadRunReview, syncRunReview } from "@/lib/run-review";
import { loadRun, reconcileRun } from "@/lib/runs";
import { loadTask } from "@/lib/tasks";

import { PatchView } from "./PatchView";
import { ReviewDecisionForm } from "./ReviewDecisionForm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-zinc-600">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm text-zinc-300">{children}</dd>
    </div>
  );
}

const VALIDATION_CLASSES: Record<string, string> = {
  [RUN_VALIDATION_STATUS.PASSED]: "text-teal-200",
  [RUN_VALIDATION_STATUS.FAILED]: "text-red-300",
  [RUN_VALIDATION_STATUS.RUNNING]: "text-amber-200",
  [RUN_VALIDATION_STATUS.NOT_RUN]: "text-zinc-500",
  [RUN_VALIDATION_STATUS.UNKNOWN]: "text-amber-200/80",
};

const SUMMARY_CLASSES: Record<string, string> = {
  positive: "border-teal-400/30 bg-teal-400/5 text-teal-200",
  negative: "border-red-500/30 bg-red-500/10 text-red-300",
  neutral: "border-zinc-800 bg-zinc-900/40 text-zinc-300",
};

/** Une ligne du tableau des validations. */
function ValidationRow({ result }: { result: RunValidationResultView }) {
  const duration =
    result.startedAt !== null && result.finishedAt !== null
      ? new Date(result.finishedAt).getTime() - new Date(result.startedAt).getTime()
      : null;

  return (
    <li className="flex flex-col gap-1 border-b border-zinc-800/60 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-3">
        <span
          className={`w-20 shrink-0 text-xs font-medium ${
            VALIDATION_CLASSES[result.status] ?? "text-zinc-400"
          }`}
        >
          {runValidationStatusLabel(result.status)}
        </span>
        <code className="min-w-0 break-all font-mono text-sm text-zinc-200">{result.command}</code>
      </div>

      <div className="flex flex-wrap gap-4 pl-0 text-xs text-zinc-600 sm:pl-[5.75rem]">
        {result.exitCode === null ? null : <span>exit {result.exitCode}</span>}
        {duration === null || duration < 0 ? null : <span>{formatDuration(duration)}</span>}
        {result.status === RUN_VALIDATION_STATUS.NOT_RUN ? (
          <span>Claude Code n&apos;a jamais lance cette commande.</span>
        ) : null}
        {result.status === RUN_VALIDATION_STATUS.UNKNOWN ? (
          <span>Lancee, mais aucun resultat exploitable n&apos;est arrive.</span>
        ) : null}
      </div>

      {result.summary === null ? null : (
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-400 sm:ml-[5.75rem]">
          {result.summary}
        </pre>
      )}
    </li>
  );
}

/** Une entree de la liste laterale des fichiers. */
function FileEntry({
  file,
  selected,
  href,
}: {
  file: RunFileChange;
  selected: boolean;
  href: string;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={selected ? "true" : undefined}
        className={`flex items-baseline gap-2 rounded-md px-2 py-1.5 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 ${
          selected ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        }`}
      >
        {/* La lettre reprend le vocabulaire de `git status` ; le libelle complet
            la double pour les lecteurs d'ecran, ou « M » ne se prononce pas. */}
        <span aria-hidden="true" className="w-3 shrink-0 font-mono text-zinc-500">
          {runChangeTypeMark(file.changeType)}
        </span>
        <span className="sr-only">{runChangeTypeLabel(file.changeType)}: </span>
        <span className="min-w-0 flex-1 break-all font-mono">{file.path}</span>
        {file.isSensitive ? (
          <span className="shrink-0 text-[0.65rem] uppercase text-amber-300/80">masque</span>
        ) : null}
      </Link>
    </li>
  );
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; taskId: string; runId: string }>;
  searchParams: Promise<{ file?: string }>;
}) {
  const { id, taskId, runId } = await params;
  const { file: requestedFile } = await searchParams;

  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const task = await loadTask(taskId);
  if (task === null || task.projectId !== project.id) {
    notFound();
  }

  const stored = await loadRun(runId);
  if (stored === null || stored.taskId !== task.id) {
    notFound();
  }

  // La chaine projet → tache → execution est verifiee entierement : une
  // execution d'un autre projet est introuvable, pas « refusee ».
  const run = await reconcileRun(stored);

  // Transfert du runner vers la base, s'il n'a pas deja eu lieu. Une review deja
  // enregistree n'est jamais redemandee : c'est ce qui la rend immuable.
  await syncRunReview(run.id, run.runnerRunId, run.status);

  const review = await loadRunReview(run.id);
  const availability = reviewAvailability(
    run.status,
    review?.capturedAt ?? null,
    review?.errorCode ?? null,
  );

  const files = review?.files ?? [];
  const validations = review?.validations ?? [];
  const totals = totalRunReview(files);
  const summary = reviewValidationSummary(validations);

  // Le fichier affiche est **choisi parmi les lignes enregistrees**. Une valeur
  // `?file=` inconnue ne selectionne rien et ne declenche aucune lecture disque.
  const selected = selectReviewFile(files, requestedFile);
  const unknownFile = isUnknownReviewFile(files, requestedFile);

  const headUnchanged =
    run.git.headBefore !== null && run.git.headAfter !== null
      ? run.git.headBefore === run.git.headAfter
      : null;

  const outcomeNotice = reviewOutcomeNotice(run.status, run.errorCode === "GIT_POLICY_VIOLATION");
  const page = runUrl(project.id, task.id, run.id);

  // Correction ciblee : ce qui a ete demande depuis cette review, et — si cette
  // execution est elle-meme une correction — le feedback qui l'a declenchee.
  const db = getDatabaseClient();
  const requestedChanges = await listFeedbacksForSourceRun(db, run.id);
  const correctionOf =
    run.parentRunId === null ? null : await getFeedbackForCorrectionRun(db, run.id);

  // Analyses Architecte de cette execution. Une lecture, jamais un appel : ouvrir
  // cette page ne declenche rien chez le fournisseur.
  const architect = await getArchitectReviewSummary(db, run.id);
  const architectEligibility = architectReviewEligibility(run.status, review?.capturedAt ?? null);

  const resumeContext = await getRunResumeContext(db, run.id);
  const resumeRefusal =
    resumeContext === null
      ? RESUME_REFUSAL.RUN_NOT_COMPLETED
      : checkResumeCandidate({
          runStatus: resumeContext.status,
          taskStatus: task.status,
          errorCode: resumeContext.errorCode,
          claudeSessionId: resumeContext.claudeSessionId,
          hasReview: resumeContext.hasReview,
          // Seule l'existence de l'empreinte compte ici : sa valeur ne descend
          // jamais jusqu'a la page.
          hasFingerprint: resumeContext.workspaceFingerprint !== null,
          hasActiveRun: await hasActiveRun(db, task.id),
          hasCorrection: resumeContext.hasCorrection,
        });

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6">
        <Link href={page} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour a l&apos;execution
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-zinc-500">
              {task.code} · {run.code}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-zinc-50">Review des changements</h1>
            <p className="mt-1 truncate text-sm text-zinc-600">
              {task.title} · {project.name}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</StatusBadge>
            <span className="rounded-full border border-zinc-800 px-2.5 py-0.5 text-xs text-zinc-400">
              {taskStatusLabel(task.status)}
            </span>
          </div>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        {outcomeNotice === null ? null : (
          <div
            role="alert"
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
          >
            <p className="font-medium">Partial changes</p>
            <p className="mt-1 text-amber-200/90">{outcomeNotice}</p>
          </div>
        )}

        <SectionCard title="Execution" description="Ce que NOX a constate autour de ce run.">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Field label="Duree">{formatDuration(run.claude.durationMs) ?? "-"}</Field>
            <Field label="Terminee le">{formatIsoDateTime(run.finishedAt ?? "") ?? "-"}</Field>
            <Field label="Branche">{run.git.branch ?? "-"}</Field>
            <Field label="HEAD avant">{shortSha(run.git.headBefore) ?? "-"}</Field>
            <Field label="HEAD apres">{shortSha(run.git.headAfter) ?? "-"}</Field>
            <Field label="Review capturee le">
              {formatIsoDateTime(review?.capturedAt ?? "") ?? "-"}
            </Field>
          </dl>

          {headUnchanged === null ? null : headUnchanged ? (
            <p className="mt-5 flex items-center gap-2 rounded-md border border-teal-400/20 bg-teal-400/5 px-3 py-2 text-xs text-teal-200/90">
              <span aria-hidden="true">&#10003;</span>
              HEAD est inchange : aucun commit n&apos;a ete cree.
            </p>
          ) : (
            <p className="mt-5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              HEAD a change pendant l&apos;execution, alors que c&apos;etait interdit.
            </p>
          )}
        </SectionCard>

        {availability === "available" ? null : (
          <SectionCard title="Changements">
            <p className="text-sm leading-relaxed text-zinc-400">
              {reviewUnavailableMessage(availability)}
            </p>
            {availability === "legacy" ? (
              <p className="mt-3 text-xs leading-relaxed text-zinc-600">
                Cette execution est anterieure a la review integree. NOX ne reconstruit pas son
                diff depuis le repository actuel : le resultat serait celui d&apos;aujourd&apos;hui,
                pas celui de l&apos;execution. Le compte rendu, les fichiers modifies et{" "}
                <code className="font-mono">git diff --stat</code> restent consultables sur{" "}
                <Link href={page} className="text-zinc-400 underline hover:text-zinc-200">
                  la page de l&apos;execution
                </Link>
                .
              </p>
            ) : null}
          </SectionCard>
        )}

        {availability === "available" ? (
          <>
            <SectionCard title="Resume" description="Des faits, pas une note de qualite.">
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-zinc-300">
                  {totals.files} {totals.files === 1 ? "file changed" : "files changed"}
                </span>
                <span className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 font-mono">
                  <span className="text-teal-200">+{totals.additions}</span>
                  <span className="text-zinc-600"> / </span>
                  <span className="text-red-300">-{totals.deletions}</span>
                </span>
                <span
                  className={`rounded-md border px-3 py-1.5 ${
                    SUMMARY_CLASSES[validationSummaryTone(summary)] ?? SUMMARY_CLASSES["neutral"]
                  }`}
                >
                  Validations: {runValidationSummaryLabel(summary)}
                </span>
              </div>

              {totals.sensitive === 0 &&
              totals.binary === 0 &&
              totals.truncated === 0 &&
              (review?.omittedFiles ?? 0) === 0 ? null : (
                <ul className="mt-4 flex flex-col gap-1 text-xs text-zinc-500">
                  {totals.sensitive === 0 ? null : (
                    <li>
                      {totals.sensitive} sensitive {totals.sensitive === 1 ? "file" : "files"} hidden
                    </li>
                  )}
                  {totals.binary === 0 ? null : (
                    <li>
                      {totals.binary} binary {totals.binary === 1 ? "file" : "files"}
                    </li>
                  )}
                  {totals.truncated === 0 ? null : (
                    <li>
                      {totals.truncated} truncated {totals.truncated === 1 ? "patch" : "patches"}
                    </li>
                  )}
                  {(review?.omittedFiles ?? 0) === 0 ? null : (
                    <li>
                      {review?.omittedFiles} fichiers changes ne sont pas listes : la limite de{" "}
                      NOX est atteinte. Utilisez <code className="font-mono">git status</code>.
                    </li>
                  )}
                </ul>
              )}

              {hasPartialChanges(run.status) ? null : (
                <p className="mt-4 text-xs leading-relaxed text-zinc-600">
                  Ces changements sont ceux constates a la fin de l&apos;execution. Ils ne bougent
                  plus : modifier un fichier maintenant ne modifie pas cette review.
                </p>
              )}
            </SectionCard>

            <SectionCard
              title="Validations"
              description="Uniquement ce que Claude Code a reellement execute. NOX ne relance rien."
            >
              {validations.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Cette tache ne declarait aucune commande de validation.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {validations.map((result) => (
                    <ValidationRow key={result.position} result={result} />
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="Fichiers" description="Selectionnez un fichier pour voir son diff.">
              {files.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Cette execution n&apos;a modifie aucun fichier.
                </p>
              ) : (
                <div className="flex flex-col gap-6 lg:flex-row">
                  <nav
                    aria-label="Fichiers changes"
                    className="w-full shrink-0 lg:max-h-[60vh] lg:w-72 lg:overflow-auto"
                  >
                    <ul className="flex flex-col gap-0.5">
                      {files.map((file) => (
                        <FileEntry
                          key={file.position}
                          file={file}
                          selected={selected?.path === file.path}
                          href={reviewUrl(project.id, task.id, run.id, file.path)}
                        />
                      ))}
                    </ul>
                  </nav>

                  <div className="min-w-0 flex-1">
                    {unknownFile ? (
                      <p
                        role="alert"
                        className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
                      >
                        Ce fichier ne fait pas partie de cette review. Choisissez-en un dans la
                        liste.
                      </p>
                    ) : null}

                    {selected === null ? (
                      <p className="text-sm text-zinc-500">Aucun fichier selectionne.</p>
                    ) : (
                      <>
                        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                          <div className="min-w-0">
                            <p className="break-all font-mono text-sm text-zinc-200">
                              {selected.path}
                            </p>
                            {selected.previousPath === null ? null : (
                              <p className="mt-0.5 break-all font-mono text-xs text-zinc-600">
                                anciennement {selected.previousPath}
                              </p>
                            )}
                          </div>
                          <p className="shrink-0 font-mono text-xs">
                            <span className="text-zinc-500">
                              {runChangeTypeLabel(selected.changeType)}
                            </span>
                            {selected.additions === null && selected.deletions === null ? null : (
                              <>
                                <span className="text-zinc-700"> · </span>
                                <span className="text-teal-200">+{selected.additions ?? 0}</span>
                                <span className="text-zinc-600"> / </span>
                                <span className="text-red-300">-{selected.deletions ?? 0}</span>
                              </>
                            )}
                          </p>
                        </div>

                        <PatchView file={selected} />
                      </>
                    )}
                  </div>
                </div>
              )}
            </SectionCard>
          </>
        ) : null}

        {correctionOf === null ? null : (
          <SectionCard
            title={`Correction de ${correctionOf.sourceRunCode}`}
            description="Cette execution a repris la session de la precedente."
          >
            <p className="text-sm leading-relaxed text-zinc-400">
              Le diff ci-dessus est l&apos;etat <strong className="text-zinc-300">complet</strong>{" "}
              du dossier de travail depuis le dernier commit — travail initial et correction
              confondus. C&apos;est voulu : rien n&apos;a ete commite entre les deux, et la
              question posee est « qu&apos;accepte-t-on maintenant ? ».
            </p>
            <p className="mt-4 text-xs uppercase tracking-wider text-zinc-600">
              Feedback qui a declenche cette correction
            </p>
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-sm leading-relaxed text-zinc-300">
              {correctionOf.text}
            </pre>
            <p className="mt-3 text-xs text-zinc-600">
              <Link
                href={reviewUrl(project.id, task.id, correctionOf.sourceRunId)}
                className="text-zinc-400 underline hover:text-zinc-200"
              >
                Relire la review de {correctionOf.sourceRunCode}
              </Link>{" "}
              — elle n&apos;a pas bouge.
            </p>
          </SectionCard>
        )}

        {requestedChanges.length === 0 ? null : (
          <SectionCard
            title="Requested changes"
            description="Ce qui a ete demande depuis cette review, et ce que cela a produit."
          >
            <ul className="flex flex-col gap-5">
              {requestedChanges.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-2">
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-sm leading-relaxed text-zinc-300">
                    {entry.text}
                  </pre>
                  <p className="text-xs text-zinc-600">
                    {formatIsoDateTime(entry.createdAt) ?? "-"} ·{" "}
                    {entry.correctionRunId === null ? (
                      <span>Aucune correction lancee depuis ce feedback.</span>
                    ) : (
                      <Link
                        href={runUrl(project.id, task.id, entry.correctionRunId)}
                        className="text-zinc-400 underline hover:text-zinc-200"
                      >
                        Correction run: {entry.correctionRunCode}
                      </Link>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        <SectionCard
          title="Architect review"
          description="Une seconde lecture, sur demande explicite. L'architecte recommande ; vous decidez."
        >
          {architectEligibility !== "eligible" ? (
            <p className="text-sm leading-relaxed text-zinc-400">
              {architectReviewIneligibleMessage(architectEligibility)}
            </p>
          ) : architect.latest === null ? (
            <>
              <p className="text-sm leading-relaxed text-zinc-400">
                Get a second opinion from the NOX Architect using the task specification, the stored
                Git review and structured validation results. Aucun appel n&apos;est fait avant que
                vous ne l&apos;ayez explicitement demande.
              </p>
              <Link
                href={architectReviewUrl(project.id, task.id, run.id)}
                className="mt-5 inline-block rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
              >
                Analyze with Architect
              </Link>
            </>
          ) : (
            <>
              <p className="text-base font-medium text-zinc-100">
                {architect.latest.finalVerdict === null
                  ? architectReviewStatusLabel(architect.latest.status)
                  : architectReviewVerdictLabel(architect.latest.finalVerdict)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {architect.latest.findings.length}{" "}
                {architect.latest.findings.length === 1 ? "finding" : "findings"} · Analyzed with{" "}
                <span className="font-mono">{architect.latest.model}</span> ·{" "}
                {architect.latest.usage.totalTokens === null
                  ? "consommation non fournie"
                  : `${architect.latest.usage.totalTokens.toLocaleString("fr-FR")} jetons`}
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link
                  href={architectAnalysisUrl(project.id, task.id, run.id, architect.latest.id)}
                  className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
                >
                  Open analysis
                </Link>
                <Link
                  href={architectReviewUrl(project.id, task.id, run.id)}
                  className="rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
                >
                  Analyze again
                </Link>
              </div>

              <p className="mt-4 text-xs leading-relaxed text-zinc-600">
                {architect.count} analyse{architect.count > 1 ? "s" : ""} sur cette execution ·{" "}
                {architect.analysesLeft} restante{architect.analysesLeft > 1 ? "s" : ""}. Aucune
                analyse ne change le statut de la tache.
              </p>
            </>
          )}
        </SectionCard>

        {task.status === TASK_STATUS.REVIEW ? (
          <SectionCard
            title="Decision"
            description="A vous de dire si ce travail est accepte. NOX ne le decide pas."
          >
            <ReviewDecisionForm
              projectId={project.id}
              taskId={task.id}
              requestChangesHref={
                resumeRefusal === null ? requestChangesUrl(project.id, task.id, run.id) : null
              }
              requestChangesReason={
                resumeRefusal === null ? null : resumeRefusalMessage(resumeRefusal)
              }
            />
          </SectionCard>
        ) : null}
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        Cette review est un instantane pris a la fin de l&apos;execution. Elle ne relit pas votre
        dossier de travail : ce que vous modifiez maintenant n&apos;y apparaitra pas.
      </footer>
    </div>
  );
}
