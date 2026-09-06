import { getDatabaseClient, getRunResumeContext, listRunEvents } from "@nox/database";
import {
  CORRECTION_SOURCE,
  describeActivityEvent,
  lastRecognizedActivity,
} from "@nox/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { WorkflowLink } from "@/components/WorkflowLink";
import {
  preconditionMark,
  preconditionStatusLabel,
  type Precondition,
} from "@/lib/correction-display";
import { evaluateFailureCorrection } from "@/lib/failure-correction";
import { buildCorrectionContext } from "@/lib/correction-evidence";
import { loadProject } from "@/lib/projects";
import {
  NO_ENTRY_DIAGNOSTICS_NOTICE,
  PROTOCOL_LIMITS_NOTICE,
  STRANDED_RETRY_NOTICE,
  runFailureCategoryLabel,
  runFailureCategoryMeaning,
} from "@/lib/run-failure-display";
import { buildCorrectionPromptFor } from "@/lib/correction-prompt";
import { runUrl } from "@/lib/run-display";
import { loadRun } from "@/lib/runs";
import { loadTask } from "@/lib/tasks";

import { StartFailureCorrectionForm } from "./StartFailureCorrectionForm";

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

  // **Le** verdict. La page n'en calcule aucun autre : c'est exactement la
  // duplication qui a produit un ecran se contredisant lui-meme — le cycle
  // reconnaissait un `Retry` avorte pendant que la page, qui reassemblait le
  // candidat sans `isLatestRun`, affichait « Task is in Failed — Blocked ».
  const eligibility = await evaluateFailureCorrection(db, {
    project: { id: project.id, repositoryPath: project.repositoryPath },
    task: { id: task.id, status: task.status },
    runId: run.id,
  });
  if (eligibility === null) {
    notFound();
  }

  const { cycle, history, preconditions, ready } = eligibility;

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
  const promptBuild = await buildCorrectionPromptFor(db, {
    task,
    project,
    sourceRunCode: context.runCode,
    feedback: null,
    contract: built.contract,
    evidence: built.evidence,
    environment: process.env,
  });
  const { prompt, sha256 } = promptBuild;

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
          {eligibility.strandedRetry ? (
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

        {promptBuild.supplement.ok ? (
          <SectionCard
            title="Supplement de source d'amorcage"
            description="La source canonique que le contrat de cette tache n'avait pas transportee."
          >
            <p className="text-sm leading-relaxed text-zinc-400">
              Le contrat de cette tache a ete genere par une version de NOX qui tronquait le
              brief, le plan de V1 et la memoire du projet. La source complete est jointe au
              prompt ci-dessous. Elle ne modifie ni l&apos;objectif, ni les criteres
              d&apos;acceptation, ni le perimetre.
            </p>
            <p className="mt-3 text-xs text-zinc-500">
              Champs restitues :{" "}
              <span className="font-mono text-zinc-400">
                {promptBuild.supplement.missingFields.join(", ")}
              </span>
            </p>
          </SectionCard>
        ) : promptBuild.supplement.reason === "source_changed" ? (
          <SectionCard
            title="Supplement de source refuse"
            description="L'etat produit a change depuis la creation de cette tache."
          >
            <p className="text-sm leading-relaxed text-amber-200">
              Le brief, le plan de V1 ou la memoire du projet ne sont plus ceux a partir desquels
              cette tache a ete construite. NOX ne joint donc aucune source : lui substituer
              l&apos;etat d&apos;aujourd&apos;hui remplacerait son contrat par un contrat que
              personne n&apos;a valide.
            </p>
          </SectionCard>
        ) : null}

        <SectionCard
          title="Preconditions"
          description="Verifiees maintenant, et refaites au lancement."
        >
          <ul className="flex flex-col gap-2">
            {preconditions.map((precondition) => (
              <PreconditionRow key={precondition.label} precondition={precondition} />
            ))}
          </ul>
          {history.ok ? null : (
            <p role="alert" className="mt-4 text-sm leading-relaxed text-amber-200">
              {history.message}
            </p>
          )}
          <p className="mt-4 text-xs leading-relaxed text-zinc-600">
            Le dossier de travail n&apos;a pas besoin d&apos;etre propre — c&apos;est meme
            l&apos;inverse : il doit etre <strong>exactement</strong> celui que l&apos;execution a
            laisse. Un fichier modifie depuis, meme d&apos;un caractere, fait refuser la reprise.
          </p>
          {eligibility.entriesUnavailable ? (
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
