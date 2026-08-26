"use client";

import { useActionState } from "react";

import { resumeCorrectionAction } from "./actions";
import { INITIAL_RESUME_CORRECTION_STATE } from "./form-state";

/**
 * Reprise d'une correction reservee qui n'a jamais demarre.
 *
 * ## Quand ce bouton apparait
 *
 * Uniquement lorsqu'une reservation existe sans execution — le cas d'un arret
 * du serveur web entre la decision et le lancement. Dans le cours normal des
 * choses, la reservation est consommee dans la seconde qui suit, et personne ne
 * voit jamais ce bouton.
 *
 * ## Pourquoi il faut cliquer
 *
 * Parce que NOX ne lance jamais rien parce qu'il redemarre. Une reservation dit
 * qu'une correction a ete decidee ; c'est un humain qui la fait partir.
 */
export function ResumeCorrectionForm({
  projectId,
  taskId,
  runId,
  attemptId,
}: {
  projectId: string;
  taskId: string;
  runId: string;
  attemptId: string;
}) {
  const [state, formAction, pending] = useActionState(
    resumeCorrectionAction,
    INITIAL_RESUME_CORRECTION_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="attemptId" value={attemptId} />

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
          {pending ? "Reprise…" : "Resume correction"}
        </button>
        <span className="text-xs leading-relaxed text-zinc-600">
          Cette correction a ete decidee mais n&apos;a jamais demarre. La reprise consomme la
          reservation existante : elle n&apos;en cree pas une seconde.
        </span>
      </div>
    </form>
  );
}
