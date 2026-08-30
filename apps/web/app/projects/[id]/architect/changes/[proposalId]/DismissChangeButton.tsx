"use client";

import { useActionState } from "react";

import { dismissProjectChangeAction } from "./actions";
import type { ProjectChangeDismissState } from "./form-state";

/**
 * Ecarte un changement de projet, dans son entier.
 *
 * Quand une mise a jour du projet est liee, les deux sont ecartees ensemble :
 * l'etat « le plan a ete refuse, la replanification attend toujours » n'existe
 * pas, et n'a jamais eu de sens.
 *
 * Aucune tache modifiee, aucun brief ecrit, aucun document touche, aucun appel.
 * La proposition reste lisible : ne pas l'avoir retenue est aussi une
 * information.
 */
export function DismissChangeButton({
  projectId,
  proposalId,
}: {
  projectId: string;
  proposalId: string;
}) {
  const [state, formAction, pending] = useActionState<ProjectChangeDismissState, FormData>(
    dismissProjectChangeAction,
    { error: null },
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="proposalId" value={proposalId} />

      {state.error === null ? null : (
        <p role="alert" className="text-sm leading-relaxed text-amber-200">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Abandon…" : "Dismiss project change"}
        </button>
        <span className="text-xs text-zinc-600">
          Rien n&apos;est modifie. Le changement reste consultable.
        </span>
      </div>
    </form>
  );
}
