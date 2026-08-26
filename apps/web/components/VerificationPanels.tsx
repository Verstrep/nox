import { AUTONOMOUS_VALIDATION_OUTPUT_LIMIT, VERIFICATION_MODE } from "@nox/shared";
import type { AutonomousValidationResultRow } from "@nox/database";

import { StatusBadge } from "@/components/StatusBadge";
import { formatIsoDateTime } from "@/lib/format";
import {
  HISTORICAL_RUN_MESSAGE,
  NO_AUTONOMOUS_VALIDATION_MESSAGE,
  TRACKED_FILES_MUTATED_MESSAGE,
  autonomousStatusLabel,
  autonomousStatusTone,
  batchStatusLabel,
  batchStatusTone,
  criterionMark,
  criterionResultLabel,
  criterionResultTone,
  formatDuration,
  formatExitCode,
  outputPlaceholder,
  truncationNotice,
  verificationModeLabel,
  verificationOutcomeMessage,
} from "@/lib/verification-display";
import type { VerificationReview } from "@/lib/verification-review";

const OUTPUT_CLASSES =
  "mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 " +
  "bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300";

/**
 * Un flux de sortie, replie par defaut.
 *
 * `<details>` plutot qu'un etat React : deplier une sortie n'est pas une
 * interaction qui demande du JavaScript, et un composant client de plus ici
 * n'apporterait qu'une dependance supplementaire.
 */
function OutputBlock({
  label,
  value,
  truncated,
}: {
  label: string;
  value: string | null;
  truncated: boolean;
}) {
  const placeholder = outputPlaceholder(value);
  const notice = truncationNotice(truncated, AUTONOMOUS_VALIDATION_OUTPUT_LIMIT);

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
        {label}
        {truncated ? " · tronquee" : ""}
      </summary>
      {placeholder === null ? (
        <pre className={OUTPUT_CLASSES}>{value}</pre>
      ) : (
        <p className="mt-2 text-xs text-zinc-600">{placeholder}</p>
      )}
      {notice === null ? null : <p className="mt-2 text-xs text-amber-200/70">{notice}</p>}
    </details>
  );
}

/** Une commande executee par NOX, avec tout ce qu'elle a produit. */
function ValidationResult({ result }: { result: AutonomousValidationResultRow }) {
  return (
    <li className="rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <code className="min-w-0 flex-1 break-all font-mono text-sm text-zinc-200">
          {result.command}
        </code>
        <StatusBadge tone={autonomousStatusTone(result.status)}>
          {autonomousStatusLabel(result.status)}
        </StatusBadge>
      </div>

      <p className="mt-1 text-xs text-zinc-600">
        {formatExitCode(result.exitCode)} · {formatDuration(result.durationMs)}
      </p>

      <OutputBlock label="stdout" value={result.stdout} truncated={result.stdoutTruncated} />
      <OutputBlock label="stderr" value={result.stderr} truncated={result.stderrTruncated} />
    </li>
  );
}

/**
 * Ce que NOX a execute lui-meme, et ce que cela a donne.
 *
 * ## Pourquoi cette section existe separement du compte rendu de Claude
 *
 * Parce que « j'ai lance `npm test` » et « NOX a lance `npm test` » ne sont pas
 * la meme information. La premiere est un recit ; la seconde est une preuve. Les
 * melanger dans une seule liste rendrait impossible de savoir laquelle on lit.
 *
 * ## Un lot absent n'est pas un echec
 *
 * Une tache entierement humaine n'a rien a valider automatiquement, et une
 * execution anterieure a TASK-027 n'a rien rate. Les deux le disent en toutes
 * lettres plutot que d'afficher une liste vide.
 */
export function AutomatedValidationSection({
  review,
  retry,
}: {
  review: VerificationReview;
  /** Formulaire de reprise, rendu par la page lorsqu'il est disponible. */
  retry: React.ReactNode;
}) {
  if (review.batch === null) {
    return (
      <p className="text-sm leading-relaxed text-zinc-400">
        {review.noAutomatedValidation ? NO_AUTONOMOUS_VALIDATION_MESSAGE : HISTORICAL_RUN_MESSAGE}
      </p>
    );
  }

  const { batch } = review;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-zinc-400">
          Tentative {batch.attempt} ·{" "}
          {batch.completedAt === null
            ? "en cours"
            : (formatIsoDateTime(batch.completedAt.toISOString()) ?? "-")}
        </p>
        <StatusBadge tone={batchStatusTone(batch.status)}>
          {batchStatusLabel(batch.status)}
        </StatusBadge>
      </div>

      {batch.errorMessage === null ? null : (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200">
          {batch.errorMessage}
        </p>
      )}

      {review.trackedFilesMutated && batch.completedAt !== null ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200">
          {TRACKED_FILES_MUTATED_MESSAGE}
        </p>
      ) : null}

      {batch.results.length === 0 ? (
        <p className="text-sm leading-relaxed text-zinc-500">
          Aucune commande n&apos;a encore rendu de resultat pour cette tentative.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {batch.results.map((result) => (
            <ValidationResult key={result.id} result={result} />
          ))}
        </ul>
      )}

      {review.previousBatches.length === 0 ? null : (
        <p className="text-xs text-zinc-600">
          {review.previousBatches.length === 1
            ? "1 tentative precedente conservee."
            : `${String(review.previousBatches.length)} tentatives precedentes conservees.`}{" "}
          Une reprise n&apos;efface jamais ce qui a ete constate avant elle.
        </p>
      )}

      {retry}
    </div>
  );
}

/**
 * Les criteres d'acceptation, et ou en est chacun.
 *
 * Chaque critere dit **comment** il se verifie, **ou il en est**, et — pour un
 * critere automatise — **par quoi** il est prouve. Un critere prouve sans dire
 * par quoi serait une affirmation, pas une preuve.
 */
export function AcceptanceCriteriaSection({ review }: { review: VerificationReview }) {
  if (review.criteria.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-zinc-400">
        Cette tache ne porte aucun critere d&apos;acceptation enregistre.
      </p>
    );
  }

  const commandById = new Map(review.plan.commands.map((command) => [command.id, command]));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-zinc-400">
        {verificationOutcomeMessage(review.outcome)}
      </p>

      <ul className="flex flex-col gap-3">
        {review.criteria.map((view) => {
          const proofs = view.criterion.commandIds
            .map((id) => commandById.get(id))
            .filter((command) => command !== undefined);

          return (
            <li
              key={view.criterion.id}
              className="rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <span
                  aria-hidden="true"
                  className="w-4 shrink-0 text-center text-sm text-zinc-500"
                >
                  {criterionMark(view.result)}
                </span>
                <span className="min-w-0 flex-1 text-sm text-zinc-200">
                  {view.criterion.text}
                </span>
                <StatusBadge tone="muted">
                  {verificationModeLabel(view.criterion.verificationMode)}
                </StatusBadge>
                <StatusBadge tone={criterionResultTone(view.result)}>
                  {criterionResultLabel(view.result)}
                </StatusBadge>
              </div>

              {view.criterion.verificationMode === VERIFICATION_MODE.AUTOMATED ? (
                <p className="mt-2 pl-7 text-xs leading-relaxed text-zinc-600">
                  {proofs.length === 0
                    ? "Aucune commande ne prouve ce critere."
                    : `Prouve par ${proofs.map((command) => command.command).join(" · ")}`}
                </p>
              ) : (
                <p className="mt-2 pl-7 text-xs leading-relaxed text-zinc-600">
                  {view.criterion.humanInstructions ??
                    "Aucune instruction n'accompagne ce critere humain."}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {review.decision === null ? null : (
        <p className="text-xs leading-relaxed text-zinc-600">
          Decision enregistree le{" "}
          {formatIsoDateTime(review.decision.decidedAt.toISOString()) ?? "-"}.
          {review.decision.overrideReason === null
            ? ""
            : ` Passage en force motive : « ${review.decision.overrideReason} »`}
        </p>
      )}
    </div>
  );
}
