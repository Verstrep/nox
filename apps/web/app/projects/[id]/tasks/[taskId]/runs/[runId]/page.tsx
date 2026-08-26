import {
  RUN_PROVENANCE,
  RUN_STATUS,
  isFinalRunStatus,
  runProvenance,
  type DevelopmentRunDetail,
} from "@nox/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { WorkflowLink } from "@/components/WorkflowLink";
import { StatusBadge } from "@/components/StatusBadge";
import { formatIsoDateTime } from "@/lib/format";
import { runStatusLabel } from "@/lib/labels";
import { loadProject } from "@/lib/projects";
import { CANCELLED_NOTICE } from "@/lib/run-cancel";
import {
  formatDuration,
  formatReportedCost,
  runEventsEndpoint,
  runInspectUrl,
  runStatusEndpoint,
  runStatusTone,
  runUrl,
  shortSha,
} from "@/lib/run-display";
import { catchUpRunEvents, loadPersistedRunEvents } from "@/lib/run-events";
import {
  reviewAvailability,
  reviewUnavailableMessage,
  reviewUrl,
} from "@/lib/review-display";
import { runProvenanceLabel } from "@/lib/correction-display";
import { loadRunReview, syncRunReview } from "@/lib/run-review";
import { loadRun, reconcileRun } from "@/lib/runs";
import { loadTask } from "@/lib/tasks";

import { CancelRunForm } from "./CancelRunForm";
import { RunPoller } from "./RunPoller";
import { getCorrectionAttemptForRun, getDatabaseClient } from "@nox/database";

import { AutomatedValidationSection } from "@/components/VerificationPanels";
import { loadVerificationReview } from "@/lib/verification-review";

import { RunTimeline } from "./RunTimeline";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-zinc-600">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm text-zinc-300">{children}</dd>
    </div>
  );
}

/**
 * Etat Git avant et apres.
 *
 * Le point le plus important n'est pas le diff mais l'egalite des deux `HEAD` :
 * c'est elle qui prouve qu'aucun commit n'a ete cree.
 */
function GitSection({ run }: { run: DevelopmentRunDetail }) {
  const headUnchanged =
    run.git.headBefore !== null && run.git.headAfter !== null
      ? run.git.headBefore === run.git.headAfter
      : null;

  return (
    <SectionCard
      title="Git"
      description="Etat constate avant et apres l'execution. NOX n'a rien restaure."
    >
      <dl className="grid gap-4 sm:grid-cols-2">
        <Field label="Branche">{run.git.branch ?? "-"}</Field>
        <Field label="Upstream">{run.git.upstream ?? "-"}</Field>
        <Field label="HEAD avant">{shortSha(run.git.headBefore) ?? "-"}</Field>
        <Field label="HEAD apres">{shortSha(run.git.headAfter) ?? "-"}</Field>
      </dl>

      {headUnchanged === null ? null : headUnchanged ? (
        <p className="mt-5 flex items-center gap-2 rounded-md border border-teal-400/20 bg-teal-400/5 px-3 py-2 text-xs text-teal-200/90">
          <span aria-hidden="true">&#10003;</span>
          HEAD est inchange : aucun commit n&apos;a ete cree.
        </p>
      ) : (
        <p className="mt-5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          HEAD a change pendant l&apos;execution, alors que c&apos;etait interdit. Verifiez
          l&apos;historique Git avant toute autre chose.
        </p>
      )}

      <div className="mt-6">
        <h3 className="text-xs uppercase tracking-wider text-zinc-600">
          Fichiers modifies ({run.git.changedFiles.length})
        </h3>
        {run.git.changedFiles.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Aucun fichier modifie.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {run.git.changedFiles.map((file) => (
              <li key={file} className="break-all font-mono text-xs text-zinc-300">
                {file}
              </li>
            ))}
          </ul>
        )}
      </div>

      {run.git.diffStat === null ? null : (
        <div className="mt-6">
          <h3 className="text-xs uppercase tracking-wider text-zinc-600">git diff --stat</h3>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
            {run.git.diffStat}
          </pre>
        </div>
      )}

      <p className="mt-6 text-xs text-zinc-600">
        Le diff complet n&apos;est pas affiche dans NOX : relisez-le dans votre editeur ou avec{" "}
        <code className="font-mono">git diff</code>.
      </p>
    </SectionCard>
  );
}

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; taskId: string; runId: string }>;
  searchParams: Promise<{ confirmCancel?: string }>;
}) {
  const { id, taskId, runId } = await params;
  const { confirmCancel } = await searchParams;
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

  // Une reconciliation au rendu : rouvrir la page apres avoir ferme le
  // navigateur suffit a recuperer un resultat produit entre-temps.
  const run = await reconcileRun(stored);

  // Provenance de l'execution. Une lecture, jamais un declenchement : ouvrir
  // cette page ne reserve aucune correction et ne relance rien.
  const sourceCorrection = await getCorrectionAttemptForRun(getDatabaseClient(), run.id);
  const provenance = runProvenance(run.kind, sourceCorrection?.source ?? null);
  const sourceAttempt = sourceCorrection?.automatedAttempt ?? null;

  // Lecture seule. Le lot autonome est declenche par la finalisation de
  // l'execution, jamais par l'ouverture d'une page : consulter ne demarre rien.
  const verification = await loadVerificationReview(getDatabaseClient(), {
    runId: run.id,
    taskId: task.id,
  });
  const active = !isFinalRunStatus(run.status);

  // Rattrapage avant l'affichage : tout ce que le runner sait et que la base
  // ignore est recupere maintenant. C'est ce qui rend la fermeture d'onglet sans
  // consequence — les evenements produits pendant l'absence sont retrouves a la
  // reouverture, y compris pour une execution deja terminee.
  await catchUpRunEvents(run.id, run.runnerRunId);

  // La review est transferee du runner vers la base a la premiere ouverture qui
  // suit la fin de l'execution, et une seule fois. Ensuite la base fait foi.
  await syncRunReview(run.id, run.runnerRunId, run.status);
  const review = await loadRunReview(run.id);
  const availability = reviewAvailability(
    run.status,
    review?.capturedAt ?? null,
    review?.errorCode ?? null,
  );

  // Les evenements persistes sont ensuite rendus cote serveur : la timeline est
  // complete des le premier octet de HTML, y compris sans JavaScript et y
  // compris pour une execution terminee depuis longtemps.
  const events = await loadPersistedRunEvents(run.id);
  const lastSequence = events.at(-1)?.sequence ?? 0;
  const page = runUrl(project.id, task.id, run.id);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6">
        <Link
          href={`/projects/${project.id}/tasks/${task.id}`}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          &larr; Retour a la tache
        </Link>
        <WorkflowLink projectId={project.id} taskId={task.id} />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-zinc-500">
              {task.code} · {run.code}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-zinc-50">{task.title}</h1>
            <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
            {/* La chaine des corrections est rappelee ici plutot que dessinee :
                un lien vers le parent suffit a la remonter, run par run. */}
            {/* D'ou vient cette execution. Une correction anterieure a
                TASK-028 n'a pas de source enregistree : elle est annoncee comme
                historique, jamais en erreur. */}
            <p className="mt-2 text-xs text-zinc-500">{runProvenanceLabel(provenance)}</p>
            {run.parentRunId === null ? null : (
              <p className="mt-1 text-xs text-zinc-500">
                Correction de{" "}
                <Link
                  href={runUrl(project.id, task.id, run.parentRunId)}
                  className="font-mono text-zinc-400 underline hover:text-zinc-200"
                >
                  l&apos;execution precedente
                </Link>{" "}
                — la session de celle-ci a ete reprise.
                {provenance === RUN_PROVENANCE.AUTOMATIC_CORRECTION && sourceAttempt !== null
                  ? ` Source : validation autonome de l'execution precedente, tentative ${String(sourceAttempt)}.`
                  : ""}
              </p>
            )}
          </div>
          <StatusBadge tone={runStatusTone(run.status)}>
            {runStatusLabel(run.status)}
          </StatusBadge>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        <RunPoller
          endpoint={runStatusEndpoint(project.id, task.id, run.id)}
          active={active}
        />

        {run.errorMessage === null ? null : (
          <div
            role="alert"
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
          >
            <p>{run.errorMessage}</p>
            {run.errorCode === null ? null : (
              <p className="mt-2 font-mono text-xs text-amber-200/70">{run.errorCode}</p>
            )}
          </div>
        )}

        {run.status === RUN_STATUS.CANCELLED ? (
          <div
            role="alert"
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
          >
            <p>{CANCELLED_NOTICE}</p>
            <p className="mt-2 text-amber-200/80">
              NOX n&apos;a execute ni <code className="font-mono">git reset</code>, ni{" "}
              <code className="font-mono">git restore</code>, et n&apos;a supprime aucun fichier.
            </p>
          </div>
        ) : null}

        {active ? null : (
          <SectionCard
            title="Review des changements"
            description="Ce que cette execution a laisse dans le repository, tel qu'il etait a sa fin."
          >
            {availability === "available" ? (
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={reviewUrl(project.id, task.id, run.id)}
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-600 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
                >
                  Review changes
                </Link>
                <span className="text-xs text-zinc-600">
                  {review?.files.length ?? 0} fichier(s) · diff detaille, validations, decision.
                </span>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-zinc-500">
                {reviewUnavailableMessage(availability)}
              </p>
            )}
          </SectionCard>
        )}

        <RunTimeline
          endpoint={runEventsEndpoint(project.id, task.id, run.id, lastSequence)}
          initialEvents={events}
          active={active}
        />

        {/*
          Une section a part, et pas une ligne de la timeline. Ce que Claude Code
          raconte avoir lance et ce que NOX a execute lui-meme ne sont pas la
          meme information : les melanger dans un seul fil rendrait impossible de
          savoir laquelle on lit. La timeline reste ce que le runner a produit,
          et rien d'autre — c'est ce que garantit `ClaudeRunEvent`.
        */}
        <SectionCard
          title="NOX validation"
          description="Ce que NOX a execute lui-meme, apres l'execution. Aucun evenement de Claude Code n'y figure."
        >
          <AutomatedValidationSection review={verification} retry={null} />
        </SectionCard>

        {active ? (
          <SectionCard
            title="Interrompre l'execution"
            description="Arrete Claude Code et ses processus descendants. NOX ne restaure rien."
          >
            <CancelRunForm
              projectId={project.id}
              taskId={task.id}
              runId={run.id}
              status={run.status}
              confirming={confirmCancel === "1"}
              confirmHref={`${page}?confirmCancel=1`}
              cancelHref={page}
            />
          </SectionCard>
        ) : null}

        <SectionCard title="Execution">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Demarree le">{formatIsoDateTime(run.startedAt ?? "") ?? "-"}</Field>
            <Field label="Terminee le">{formatIsoDateTime(run.finishedAt ?? "") ?? "-"}</Field>
            <Field label="Duree">{formatDuration(run.claude.durationMs) ?? "-"}</Field>
            <Field label="Duree API">{formatDuration(run.claude.durationApiMs) ?? "-"}</Field>
            <Field label="Tours">
              {run.claude.numTurns === null ? "-" : String(run.claude.numTurns)}
            </Field>
            <Field label="Code de sortie">
              {run.claude.exitCode === null ? "-" : String(run.claude.exitCode)}
            </Field>
            <Field label="Cout rapporte">
              {formatReportedCost(run.claude.reportedCostUsd) ?? "non fourni"}
            </Field>
          </dl>
          <p className="mt-5 text-xs text-zinc-600">
            Ces valeurs sont celles que Claude Code rapporte. NOX n&apos;en estime aucune : « non
            fourni » signifie que l&apos;outil ne l&apos;a pas communiquee.
          </p>
        </SectionCard>

        {run.claude.resultText === null ? null : (
          <SectionCard
            title="Compte rendu de Claude Code"
            description="Texte final rendu par l'agent, affiche brut."
          >
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-200">
              {run.claude.resultText}
            </pre>
          </SectionCard>
        )}

        <GitSection run={run} />

        {run.stderrTail === null || run.stderrTail.trim() === "" ? null : (
          <SectionCard
            title="Sortie d'erreur"
            description="Fin de la sortie d'erreur du processus, bornee."
          >
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-400">
              {run.stderrTail}
            </pre>
          </SectionCard>
        )}

        {/*
          Le prompt integral et son empreinte vivent desormais dans Inspect : ils
          servent au debug et a la reproductibilite, pas a decider quoi faire de
          cette execution. Rien n'a ete supprime, tout est a un clic.
        */}
        <SectionCard
          title="Inspect"
          description="Le prompt transmis au processus et ses empreintes, pour le debug et la reproductibilité."
        >
          <Link
            href={runInspectUrl(project.id, task.id, run.id)}
            className="inline-block rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
          >
            Inspect run
          </Link>
        </SectionCard>
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        Le resultat de Claude Code ne vaut pas validation : c&apos;est a vous de relire le travail
        et de decider si la tache est acceptee.
      </footer>
    </div>
  );
}
