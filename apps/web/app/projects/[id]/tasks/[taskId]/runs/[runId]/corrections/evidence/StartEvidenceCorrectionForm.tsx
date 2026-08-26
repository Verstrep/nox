"use client";

import Link from "next/link";
import { useActionState } from "react";

import { startEvidenceCorrectionAction } from "./actions";
import { INITIAL_START_EVIDENCE_CORRECTION_STATE } from "./form-state";

/**
 * Lancement d'une correction fondee sur les preuves de NOX.
 *
 * Le bouton est desactive tant qu'une precondition manque, mais ce n'est jamais
 * la seule barriere : la Server Action revalide tout, et le runner recalcule
 * l'empreinte juste avant de lancer le processus.
 */
export function StartEvidenceCorrectionForm({
  projectId,
  taskId,
  runId,
  cancelHref,
  canLaunch,
}: {
  projectId: string;
  taskId: string;
  runId: string;
  cancelHref: string;
  canLaunch: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    startEvidenceCorrectionAction,
    INITIAL_START_EVIDENCE_CORRECTION_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
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
          disabled={pending || !canLaunch}
          className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Lancement…" : "Run correction"}
        </button>

        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
        >
          Cancel
        </Link>
      </div>

      <p className="text-xs leading-relaxed text-zinc-600">
        Aucun feedback n&apos;est enregistre : vous n&apos;en avez pas ecrit. Ce sont les commandes
        que NOX a executees lui-meme, avec leurs codes de sortie et leurs sorties, qui partent avec
        la correction.
      </p>
    </form>
  );
}
