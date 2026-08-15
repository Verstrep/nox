"use client";

import { useActionState } from "react";

import { dismissProjectUpdateAction } from "./actions";
import { INITIAL_DISMISS_STATE, type ProjectUpdateDismissState } from "./form-state";

/**
 * Abandon d'une proposition.
 *
 * Action secondaire, et rendue comme telle : un bouton discret, dans son propre
 * formulaire, separe du bouton principal par une bordure et par du texte. Pas de
 * fenetre de confirmation — l'abandon n'efface rien, la proposition reste
 * lisible, et une modale pour un geste reversible ne protege de rien.
 *
 * Aucun appel : ni fournisseur, ni Claude Code, ni Git. Aucune ecriture du brief
 * ni du plan.
 */
export function DismissButton({
  projectId,
  updateId,
}: {
  projectId: string;
  updateId: string;
}) {
  const [state, formAction, pending] = useActionState<ProjectUpdateDismissState, FormData>(
    dismissProjectUpdateAction,
    INITIAL_DISMISS_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="updateId" value={updateId} />

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
          Ecarter cette proposition n&apos;efface rien : elle reste lisible dans la conversation, et
          le projet n&apos;est pas modifie.
        </p>
      </div>
    </form>
  );
}
