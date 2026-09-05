import {
  getDatabaseClient,
  getDeliveryForRun,
  listRunsByTask,
  readCorrectionChain,
  readProjectDeliveryPolicy,
} from "@nox/database";
import { isDeliveryStatus, isDeliveryTrigger } from "@nox/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import {
  deliveryPolicyLabel,
  deliveryStatusLabel,
  deliveryTriggerLabel,
} from "@/lib/delivery-display";
import { formatIsoDateTime } from "@/lib/format";
import { runStatusLabel, taskStatusLabel } from "@/lib/labels";
import { loadProject } from "@/lib/projects";
import {
  formatDuration,
  formatReportedCost,
  runStatusTone,
  runUrl,
  shortSha,
} from "@/lib/run-display";
import {
  CLAUDE_OBSERVATION_NOTICE,
  DELIVERY_INDEPENDENCE_NOTICE,
  UNRECORDED,
  chainEntryLabel,
  claudeObservationLabel,
  claudeObservations,
  deliveryFacts,
  executionFacts,
  inspectAttempts,
  inspectChain,
  type InspectFact,
} from "@/lib/run-inspect";
import { loadRunReview } from "@/lib/run-review";
import { loadRun } from "@/lib/runs";
import { loadTask } from "@/lib/tasks";
import { ValidationResult } from "@/components/VerificationPanels";
import { batchStatusLabel, batchStatusTone } from "@/lib/verification-display";
import { loadVerificationReview } from "@/lib/verification-review";

/**
 * Inspection technique d'une execution.
 *
 * ## Ce que cette page repond
 *
 * « Qu'est-ce que NOX a observe, techniquement ». Une seule question, et c'est
 * elle qui decide de tout le reste : ce n'est pas un vidage de la base, pas une
 * console d'administration, et pas un endroit d'ou on agit.
 *
 * ## D'ou vient sa forme actuelle
 *
 * Du premier pilote reel. `TASK-001` de TripKit s'est terminee sur
 * `VALIDATION_SPAWN_FAILED` ; cette page ne portait alors que le prompt et deux
 * empreintes, et comprendre l'echec a demande de reproduire `spawn("npm")` a la
 * main dans un terminal pour retrouver un `ENOENT` que NOX avait deja
 * enregistre. Tout ce qui a ete ajoute ici etait **deja en base**.
 *
 * ## Ce qu'elle ne fait pas
 *
 * Elle lit SQLite et rien d'autre : ni repository, ni runner, ni fournisseur,
 * et aucune commande n'est relancee. Elle ne porte aucune action — pas un
 * bouton, pas un formulaire. Le compte rendu final de Claude Code n'y est pas
 * charge : seules les metadonnees structurees servent ici, et le transcript se
 * lit sur la page de l'execution.
 *
 * ## Ce qui ne peut pas y apparaitre
 *
 * Aucune valeur d'environnement, aucune cle, aucun jeton, aucun en-tete, aucune
 * trace d'exception. Ce n'est pas un filtre applique en sortie : ces valeurs
 * n'entrent dans aucune des lectures ci-dessous. Les diagnostics de panne sont
 * ceux que le runner ecrit a partir du seul code systeme, jamais le message de
 * Node qui porterait le chemin absolu de l'executable.
 */
export default async function RunInspectPage({
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

  // Cinq lectures explicites, aucune par ligne affichee. Inspect a le droit de
  // charger davantage qu'une page ordinaire — c'est une surface de diagnostic —
  // mais « davantage » ne veut pas dire « une requete par tentative ».
  const [verification, review, delivery, policy, siblings, chainIds] = await Promise.all([
    loadVerificationReview(db, { runId: run.id, taskId: task.id }),
    loadRunReview(run.id),
    getDeliveryForRun(db, task.id, run.id),
    readProjectDeliveryPolicy(db, project.id),
    listRunsByTask(db, task.id),
    readCorrectionChain(db, run.id),
  ]);

  const facts = executionFacts(
    {
      runCode: run.code,
      taskCode: task.code,
      taskTitle: task.title,
      // Le nom du projet, jamais `repositoryPath` : un chemin absolu nomme un
      // disque et un utilisateur, et n'apprend rien de plus ici.
      projectName: project.name,
      status: runStatusLabel(run.status),
      kind: run.kind,
      branch: run.git.branch,
      headBefore: run.git.headBefore,
      headAfter: run.git.headAfter,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.claude.durationMs,
      durationApiMs: run.claude.durationApiMs,
      numTurns: run.claude.numTurns,
      exitCode: run.claude.exitCode,
      reportedCostUsd: run.claude.reportedCostUsd,
      sessionId: run.claude.sessionId,
      errorCode: run.errorCode,
    },
    {
      duration: formatDuration,
      cost: formatReportedCost,
      sha: shortSha,
      dateTime: formatIsoDateTime,
    },
  );

  const attempts = inspectAttempts(verification.batch, verification.previousBatches);
  const observations = claudeObservations(review?.validations ?? []);

  const byId = new Map(siblings.map((entry) => [entry.id, entry]));
  const chain = inspectChain(
    chainIds
      .map((entryId) => byId.get(entryId))
      .filter((entry) => entry !== undefined)
      .map((entry) => ({ id: entry.id, code: entry.code, status: entry.status })),
    run.id,
  );

  const deliveryRows = deliveryFacts({
    policyLabel: deliveryPolicyLabel(policy),
    delivery:
      delivery === null
        ? null
        : {
            statusLabel: isDeliveryStatus(delivery.status)
              ? deliveryStatusLabel(delivery.status)
              : delivery.status,
            triggerLabel: isDeliveryTrigger(delivery.trigger)
              ? deliveryTriggerLabel(delivery.trigger)
              : delivery.trigger,
            commitSha: shortSha(delivery.commitSha),
            pushedAt: delivery.pushedAt,
            attempt: delivery.attempt,
            errorCode: delivery.errorCode,
          },
  });

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6">
        <Link
          href={runUrl(project.id, task.id, run.id)}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          &larr; Retour à l&apos;exécution
        </Link>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-mono text-xs text-zinc-500">
              {task.code} · {run.code}
            </p>
            <StatusBadge tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</StatusBadge>
            <StatusBadge tone="muted">{taskStatusLabel(task.status)}</StatusBadge>
          </div>
          <h1 className="mt-2 text-xl font-semibold text-zinc-50">Inspect run</h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-400">
            Ce que NOX a observé de cette exécution, techniquement : ce qui a été transmis au
            processus, ce qu&apos;il a rapporté, et ce que NOX a lui-même exécuté ensuite. Tout est
            lu en base. Rien ici ne relance ni ne change quoi que ce soit.
          </p>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        <SectionCard
          title="Execution summary"
          description="Les faits rapportés par le processus, tels qu'ils ont été enregistrés."
        >
          <FactList facts={facts} />
        </SectionCard>

        <SectionCard
          title="Validation attempts"
          description="Les commandes que NOX a exécutées lui-même, tentative par tentative."
        >
          {attempts.length === 0 ? (
            <p className="text-sm leading-relaxed text-zinc-500">
              Aucun lot de validation autonome pour cette exécution. « Aucune validation
              configurée » et « aucune commande exécutée » restent deux faits distincts : cette
              page ne dit que le second.
            </p>
          ) : (
            <ol className="flex flex-col gap-5">
              {attempts.map((attempt) => (
                <li key={attempt.id} className="rounded-lg border border-zinc-800 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-sm font-medium text-zinc-200">
                      Attempt {attempt.attempt}
                    </h3>
                    <StatusBadge tone={batchStatusTone(attempt.status)}>
                      {batchStatusLabel(attempt.status)}
                    </StatusBadge>
                    <span className="text-xs text-zinc-600">
                      {formatIsoDateTime(attempt.startedAt?.toISOString() ?? "") ?? UNRECORDED}
                    </span>
                  </div>

                  {attempt.errorCode === null && attempt.errorMessage === null ? null : (
                    <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                      {attempt.errorCode === null ? null : (
                        <p className="font-mono text-xs text-amber-200">{attempt.errorCode}</p>
                      )}
                      {attempt.errorMessage === null ? null : (
                        // Écrit par NOX à partir du seul code système. Jamais le
                        // message de Node, qui porterait le chemin absolu de
                        // l'exécutable.
                        <p className="mt-1 text-xs leading-relaxed text-amber-200/90">
                          {attempt.errorMessage}
                        </p>
                      )}
                    </div>
                  )}

                  {attempt.results.length === 0 ? (
                    <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                      Aucune commande n&apos;a produit de résultat dans cette tentative.
                    </p>
                  ) : (
                    <ul className="mt-4 flex flex-col gap-3">
                      {attempt.results.map((result) => (
                        // Le meme composant que la review : une preuve ne se
                        // rend qu'a un seul endroit dans NOX.
                        <ValidationResult key={result.id} result={result} />
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </SectionCard>

        <SectionCard
          title="Claude Code command observation"
          description="Ce que l'agent a lancé, tel que NOX l'a reconnu dans sa sortie."
        >
          <p className="max-w-prose text-sm leading-relaxed text-amber-200/80">
            {CLAUDE_OBSERVATION_NOTICE}
          </p>

          {observations.length === 0 ? (
            <p className="mt-4 text-sm leading-relaxed text-zinc-500">
              Aucune commande de validation n&apos;était enregistrée sur cette tâche au lancement.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {observations.map((observation) => (
                <li
                  key={observation.command}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-800/70 bg-zinc-950/40 px-3 py-2"
                >
                  <code className="font-mono text-xs text-zinc-200">{observation.command}</code>
                  <StatusBadge tone={observation.observedExactly ? "neutral" : "muted"}>
                    {claudeObservationLabel(observation)}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Git delivery"
          description="Ce que NOX a écrit dans Git pour cette exécution, s'il a écrit quelque chose."
        >
          <FactList facts={deliveryRows} />
          <p className="mt-4 max-w-prose text-xs leading-relaxed text-zinc-500">
            {DELIVERY_INDEPENDENCE_NOTICE}
          </p>
        </SectionCard>

        {chain.length < 2 ? null : (
          <SectionCard
            title="Correction chain"
            description="Le cycle de travail courant, de l'exécution initiale à la plus récente."
          >
            <ol className="flex flex-col gap-2">
              {chain.map((entry) => (
                <li
                  key={entry.runId}
                  className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 ${
                    entry.current
                      ? "border-zinc-700 bg-zinc-900/60"
                      : "border-zinc-800/70 bg-zinc-950/40"
                  }`}
                >
                  <span className="text-xs text-zinc-500">{chainEntryLabel(entry)}</span>
                  <Link
                    href={runUrl(project.id, task.id, entry.runId)}
                    className="font-mono text-xs text-zinc-300 underline-offset-4 hover:underline"
                  >
                    {entry.code}
                  </Link>
                  <span className="text-xs text-zinc-600">{entry.status}</span>
                  {entry.current ? <StatusBadge tone="neutral">Inspected</StatusBadge> : null}
                </li>
              ))}
            </ol>
          </SectionCard>
        )}

        <SectionCard
          title="Prompt envoyé"
          description="Conservé exactement tel qu'il a été transmis au processus."
        >
          <pre className="max-h-[60vh] overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
            {run.prompt}
          </pre>
        </SectionCard>

        <SectionCard
          title="Empreintes"
          description="Ce qui identifie cette exécution de façon reproductible."
        >
          <dl className="grid gap-4">
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Prompt SHA-256</dt>
              <dd className="mt-1 break-all font-mono text-sm text-zinc-300">
                {run.promptSha256}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Session Claude</dt>
              <dd className="mt-1 break-all font-mono text-sm text-zinc-300">
                {run.claude.sessionId ?? "-"}
              </dd>
            </div>
          </dl>
        </SectionCard>
      </main>
    </div>
  );
}

/** Liste de faits, avec les absences dites plutot que laissees vides. */
function FactList({ facts }: { facts: readonly InspectFact[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {facts.map((entry) => (
        <div key={entry.label}>
          <dt className="text-xs uppercase tracking-wider text-zinc-600">{entry.label}</dt>
          <dd
            className={`mt-1 break-all text-sm ${
              entry.value === null
                ? "text-zinc-600"
                : entry.mono
                  ? "font-mono text-zinc-300"
                  : "text-zinc-300"
            }`}
          >
            {entry.value ?? UNRECORDED}
          </dd>
        </div>
      ))}
    </dl>
  );
}
