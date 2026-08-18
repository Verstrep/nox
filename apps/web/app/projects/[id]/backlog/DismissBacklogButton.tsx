"use client";

import { useActionState } from "react";

import { dismissBacklogAction } from "./actions";
import { INITIAL_DISMISS_STATE, type BacklogDismissState } from "./form-state";

/**
 * Abandon d'une proposition de backlog.
 *
 * Action secondaire, et rendue comme telle : un bouton discret, dans son propre
 * formulaire, separe du bouton principal. Pas de fenetre de confirmation —
 * l'abandon n'efface rien, la proposition reste lisible, et une modale pour un
 * geste sans perte ne protege de rien.
 *
 * Reste offert quand la proposition est perimee : c'est meme sa sortie normale.
 */
export function DismissBacklogButton({
  projectId,
  proposalId,
}: {
  projectId: string;
  proposalId: string;
}) {
  const [state, formAction, pending] = useActionState<BacklogDismissState, FormData>(
    dismissBacklogAction,
    INITIAL_DISMISS_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="proposalId" value={proposalId} />

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
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Abandon…" : "Dismiss"}
        </button>
        <p className="max-w-prose text-xs leading-relaxed text-zinc-600">
          Ecarter ce backlog ne cree aucune tache et ne modifie pas le projet. La proposition reste
          lisible dans l&apos;historique.
        </p>
      </div>
    </form>
  );
}
