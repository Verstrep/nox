"use client";

import Link from "next/link";
import { useActionState, useId } from "react";

import { analyzeReviewAction } from "./actions";
import { INITIAL_ANALYZE_REVIEW_STATE } from "./form-state";

type AnalyzeReviewFormProps = {
  projectId: string;
  taskId: string;
  runId: string;
  /** Empreinte du bundle affiche juste au-dessus. */
  inputHash: string;
  /** Retour vers la review, pour le bouton `Cancel`. */
  cancelHref: string;
  /** Faux lorsque la configuration du fournisseur est incomplete. */
  configured: boolean;
  /** Vrai lorsque l'execution a epuise son nombre d'analyses. */
  exhausted: boolean;
};

/**
 * Lancement d'une analyse de review.
 *
 * Le seul endroit d'ou un appel de review peut partir, et il faut cliquer.
 * Aucun contenu n'y figure : ni patch, ni specification, ni modele, ni prompt.
 * Le bundle est reconstruit cote serveur, et l'empreinte transmise ne peut
 * qu'**empecher** l'envoi — si elle ne correspond plus a ce qui vient d'etre
 * assemble, rien ne part.
 */
export function AnalyzeReviewForm({
  projectId,
  taskId,
  runId,
  inputHash,
  cancelHref,
  configured,
  exhausted,
}: AnalyzeReviewFormProps) {
  const [state, formAction, pending] = useActionState(
    analyzeReviewAction,
    INITIAL_ANALYZE_REVIEW_STATE,
  );
  const errorId = useId();

  return (
    <div className="flex flex-col gap-4">
      {state.error === null ? null : (
        <p
          id={errorId}
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <form action={formAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="inputHash" value={inputHash} />
          <button
            type="submit"
            disabled={pending || !configured || exhausted}
            aria-describedby={state.error === null ? undefined : errorId}
            className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Analyse…" : "Analyze review"}
          </button>
        </form>

        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
        >
          Cancel
        </Link>
      </div>

      <p className="text-xs leading-relaxed text-zinc-600">
        Un clic, un appel. NOX ne relance jamais de lui-meme, et l&apos;architecte ne change aucun
        statut : sa reponse est un avis que vous relirez.
      </p>
    </div>
  );
}
