import Link from "next/link";

import {
  CORRECTION_STAGE,
  CORRECTION_SOURCE,
  RUN_PROVENANCE,
  runProvenance,
  type CorrectionAttemptFacts,
} from "@nox/shared";

import { StatusBadge } from "@/components/StatusBadge";
import {
  automatedAttemptLabel,
  correctionFailureUrl,
  correctionSourceLabel,
  correctionStageDetail,
  correctionStageLabel,
  requestChangesUrl,
  runProvenanceLabel,
} from "@/lib/correction-display";
import { STRANDED_RETRY_NOTICE } from "@/lib/run-failure-display";
import type { CorrectionContext } from "@/lib/correction-cycle";

/**
 * Ce que la review dit du cycle de correction.
 *
 * ## Le resultat courant d'abord
 *
 * L'utilisateur doit tester **le dernier** etat, pas relire trois executions.
 * Les tentatives precedentes sont donc une liste compacte, en dessous, et rien
 * de plus : un systeme graphique d'historique ferait payer a chaque lecture le
 * prix d'un cas rare.
 *
 * ## Ce composant n'autorise rien
 *
 * Il affiche ce que le serveur a deja decide. Un bouton visible ne prouve rien :
 * chaque action revalide tout au moment d'agir, et le fait dans le moteur de
 * correction — jamais ici.
 */

function stageTone(stage: CorrectionContext["cycle"]["stage"]) {
  switch (stage) {
    case CORRECTION_STAGE.RUNNING:
    case CORRECTION_STAGE.RESERVED:
      return "neutral" as const;
    case CORRECTION_STAGE.LIMIT_REACHED:
      return "warn" as const;
    case CORRECTION_STAGE.READY:
      return "accent" as const;
    case CORRECTION_STAGE.NONE:
      return "muted" as const;
  }
}

/** Une ligne de l'historique du cycle. */
function AttemptRow({ attempt, index }: { attempt: CorrectionAttemptFacts; index: number }) {
  const rank = automatedAttemptLabel(attempt.source, attempt.automatedAttempt);
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-zinc-900 py-2 first:border-t-0">
      <span className="font-mono text-xs text-zinc-600">#{index + 1}</span>
      <span className="text-sm text-zinc-300">{correctionSourceLabel(attempt.source)}</span>
      {rank === null ? null : <span className="text-xs text-zinc-500">{rank}</span>}
      <span className="text-xs text-zinc-600">{attemptStatusLabel(attempt.status)}</span>
    </li>
  );
}

function attemptStatusLabel(status: CorrectionAttemptFacts["status"]): string {
  switch (status) {
    case "LAUNCHED":
      return "correction lancee";
    case "RESERVED":
      return "reservee, pas encore lancee";
    case "ABANDONED":
      return "abandonnee sans rien lancer";
  }
}

export function CorrectionPanel({
  context,
  projectId,
  resumeForm,
}: {
  context: CorrectionContext;
  projectId: string;
  /** Formulaire de reprise, uniquement pour une reservation restee en plan. */
  resumeForm: React.ReactNode;
}) {
  const { cycle, run, attempts } = context;
  const provenance = runProvenance(
    run.kind,
    attempts.find((attempt) => attempt.correctionRunId === run.id)?.source ?? null,
  );
  const detail = correctionStageDetail(cycle);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={stageTone(cycle.stage)}>{correctionStageLabel(cycle)}</StatusBadge>
        <span className="rounded-full border border-zinc-800 px-2.5 py-0.5 text-xs text-zinc-400">
          {runProvenanceLabel(provenance)}
        </span>
        {cycle.stage === CORRECTION_STAGE.NONE ? null : (
          <span className="text-xs text-zinc-600">
            {cycle.automatedAttempts} / {cycle.maxAutomatedAttempts} corrections automatiques
          </span>
        )}
      </div>

      {detail === null ? null : (
        <p className="text-sm leading-relaxed text-zinc-400">{detail}</p>
      )}

      {provenance === RUN_PROVENANCE.AUTOMATIC_CORRECTION ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs leading-relaxed text-zinc-400">
          Correction source : Automatic validation. Personne n&apos;a relu l&apos;execution
          precedente — ce sont les commandes que NOX a executees lui-meme qui avaient echoue.
        </p>
      ) : null}

      {cycle.stage === CORRECTION_STAGE.LIMIT_REACHED ? (
        <p
          role="status"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm leading-relaxed text-amber-200"
        >
          Automatic correction limit reached. Human review required.
        </p>
      ) : null}

      {resumeForm}

      {context.human.eligible ? (
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={requestChangesUrl(projectId, context.task.id, run.id)}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition-colors hover:border-zinc-500 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
          >
            Run correction
          </Link>
          <span className="text-xs text-zinc-600">
            NOX found these failures — vous n&apos;avez rien a recopier.
          </span>
        </div>
      ) : null}

      {/*
        La reprise apres echec. Elle et la correction humaine ne peuvent jamais
        etre offertes ensemble : la premiere exige une tache en echec — ou le
        `READY` d'un `Retry` avorte —, la seconde une tache en review.
      */}
      {context.processFailure.eligible ? (
        <div className="flex flex-col gap-2">
          {context.strandedRetry ? (
            <p className="max-w-prose rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
              {STRANDED_RETRY_NOTICE}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={correctionFailureUrl(projectId, context.task.id, run.id)}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition-colors hover:border-zinc-500 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
            >
              Correct failed run
            </Link>
            <span className="text-xs text-zinc-600">
              Continue le travail partiel, dans la meme session — sans repartir de zero.
            </span>
          </div>
        </div>
      ) : null}

      {attempts.length === 0 ? null : (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Attempt history
          </h3>
          <ul className="mt-2">
            {attempts.map((attempt, index) => (
              <AttemptRow
                key={attempt.id}
                index={index}
                attempt={{
                  id: attempt.id,
                  source: attempt.source,
                  status: attempt.status,
                  automatedAttempt: attempt.automatedAttempt ?? 0,
                  correctionRunId: attempt.correctionRunId,
                }}
              />
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-zinc-600">
            Les tentatives precedentes sont historiques. Le resultat qui compte est celui de
            l&apos;execution courante, affiche plus haut.
          </p>
        </div>
      )}

      <p className="text-xs leading-relaxed text-zinc-600">
        Une correction ne modifie jamais le contrat de cette tache : ni ses criteres, ni leur mode
        de verification, ni ses commandes. Elle essaie de le satisfaire.
        {cycle.lastSource === CORRECTION_SOURCE.AUTOMATED_VALIDATION
          ? " Chaque correction reussie reouvre une validation autonome complete : aucune preuve n'est reprise d'une tentative precedente."
          : ""}
      </p>
    </div>
  );
}
