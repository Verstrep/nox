"use client";

import Link from "next/link";
import { useActionState, useId } from "react";

import { startCorrectionAction } from "./actions";
import { INITIAL_START_CORRECTION_STATE } from "./form-state";

type StartCorrectionFormProps = {
  projectId: string;
  taskId: string;
  runId: string;
  feedbackId: string;
  cancelHref: string;
  /** Faux lorsqu'une precondition n'est pas tenue : le bouton reste inactif. */
  canLaunch: boolean;
  /** Criteres humains signales, deja relus en base par la page. */
  humanCriterionIds?: readonly string[];
};

/**
 * Lancement d'une correction ciblee.
 *
 * Le bouton est desactive tant qu'une precondition manque, mais ce n'est jamais
 * la seule barriere : la Server Action revalide tout, et le runner recalcule
 * l'empreinte juste avant de lancer le processus. Un formulaire soumis a la main
 * ne gagne rien.
 */
export function StartCorrectionForm({
  projectId,
  taskId,
  runId,
  feedbackId,
  cancelHref,
  canLaunch,
  humanCriterionIds = [],
}: StartCorrectionFormProps) {
  const [state, formAction, pending] = useActionState(
    startCorrectionAction,
    INITIAL_START_CORRECTION_STATE,
  );
  const noticeId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="feedbackId" value={feedbackId} />
      {humanCriterionIds.map((criterionId) => (
        <input key={criterionId} type="hidden" name="humanCriterion" value={criterionId} />
      ))}

      {state.error === null ? null : (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !canLaunch}
          aria-describedby={noticeId}
          className="rounded-md border border-teal-400/40 bg-teal-400/10 px-4 py-2 text-sm font-medium text-teal-100 transition-colors hover:border-teal-300/60 hover:bg-teal-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Lancement…" : "Resume Claude Code"}
        </button>

        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
        >
          Cancel
        </Link>
      </div>

      <p id={noticeId} className="text-xs leading-relaxed text-zinc-600">
        Claude Code reprendra la session de cette execution avec le feedback ci-dessus. Le travail
        deja produit reste en place. Aucun commit, aucun push, aucun{" "}
        <code className="font-mono">git add</code> : le commit reste votre geste.
      </p>
    </form>
  );
}
