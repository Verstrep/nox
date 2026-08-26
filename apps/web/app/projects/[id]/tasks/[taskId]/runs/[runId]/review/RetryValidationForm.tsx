"use client";

import { useActionState } from "react";

import { RETRY_VALIDATION_NOTICE } from "@/lib/verification-display";

import { retryValidationAction } from "./actions";
import { INITIAL_RETRY_VALIDATION_STATE } from "./form-state";

/**
 * Reprise d'un lot de validations tombe en panne.
 *
 * ## Ce que ce bouton n'est pas
 *
 * Un « reessayer » universel. Il n'apparait que lorsque NOX n'a **pas pu**
 * obtenir de preuve — runner injoignable, processus impossible a demarrer. Une
 * commande qui a reellement echoue ne changera pas d'avis : le code n'a pas
 * bouge, et proposer de la relancer inviterait a jouer aux des jusqu'a obtenir
 * le resultat voulu.
 *
 * ## Ce qu'il ne declenche pas
 *
 * Ni Claude Code, ni l'Architecte, ni un commit. NOX rejoue les memes commandes,
 * dans le meme repository, et enregistre une **nouvelle** tentative : la
 * precedente reste lisible.
 */
export function RetryValidationForm({
  projectId,
  taskId,
  runId,
}: {
  projectId: string;
  taskId: string;
  runId: string;
}) {
  const [state, formAction, pending] = useActionState(
    retryValidationAction,
    INITIAL_RETRY_VALIDATION_STATE,
  );

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="runId" value={runId} />

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
          disabled={pending}
          className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Relance…" : "Retry automated validation"}
        </button>
        <span className="text-xs leading-relaxed text-zinc-600">{RETRY_VALIDATION_NOTICE}</span>
      </div>
    </form>
  );
}
