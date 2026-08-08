"use client";

import { useActionState, useId } from "react";

import { decideReviewAction } from "./actions";
import { INITIAL_REVIEW_DECISION_STATE } from "./form-state";

type ReviewDecisionFormProps = {
  projectId: string;
  taskId: string;
};

/**
 * Acceptation ou renvoi en file du travail d'une execution.
 *
 * Deux boutons, une seule difference : le champ cache `decision`. Le navigateur
 * ne choisit pas un statut — il choisit entre deux intentions, que la Server
 * Action traduit. Un formulaire altere ne peut donc pas poser un statut
 * arbitraire sur la tache.
 *
 * Aucun des deux boutons ne touche a Git. C'est dit sous les boutons, pas
 * seulement dans la documentation : c'est exactement le moment ou l'utilisateur
 * se demande si NOX vient de commiter a sa place.
 */
export function ReviewDecisionForm({ projectId, taskId }: ReviewDecisionFormProps) {
  const [state, formAction, pending] = useActionState(
    decideReviewAction,
    INITIAL_REVIEW_DECISION_STATE,
  );
  const noticeId = useId();

  if (state.decided === "approve") {
    return (
      <p role="status" className="text-sm leading-relaxed text-teal-200/90">
        Tache acceptee. Aucun commit n&apos;a ete cree : les modifications sont toujours dans
        votre dossier de travail, et c&apos;est a vous de les commiter.
      </p>
    );
  }

  if (state.decided === "reopen") {
    return (
      <p role="status" className="text-sm leading-relaxed text-amber-200/90">
        Tache remise en <span className="font-mono">Ready</span>. Avant un nouveau lancement, le
        repository devra redevenir propre et synchronise : les changements de cette execution sont
        encore la, et la verification prealable les refusera.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />

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
          name="decision"
          value="approve"
          disabled={pending}
          aria-describedby={noticeId}
          className="rounded-md border border-teal-400/40 bg-teal-400/10 px-4 py-2 text-sm font-medium text-teal-100 transition-colors hover:border-teal-300/60 hover:bg-teal-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Approve
        </button>

        <button
          type="submit"
          name="decision"
          value="reopen"
          disabled={pending}
          aria-describedby={noticeId}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reopen
        </button>
      </div>

      <p id={noticeId} className="text-xs leading-relaxed text-zinc-600">
        <span className="font-mono">Approve</span> passe la tache a{" "}
        <span className="font-mono">Done</span>, <span className="font-mono">Reopen</span> la
        remet a <span className="font-mono">Ready</span>. Ni l&apos;un ni l&apos;autre ne cree de
        commit, ne fait de <code className="font-mono">git add</code> et ne pousse quoi que ce
        soit : le commit reste votre geste.
      </p>
    </form>
  );
}
