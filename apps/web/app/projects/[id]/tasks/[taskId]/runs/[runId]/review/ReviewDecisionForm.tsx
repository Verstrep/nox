"use client";

import Link from "next/link";
import { useActionState, useId } from "react";

import { decideReviewAction } from "./actions";
import { INITIAL_REVIEW_DECISION_STATE } from "./form-state";

type ReviewDecisionFormProps = {
  projectId: string;
  taskId: string;
  /**
   * Lien vers la demande de corrections, ou `null` si elle est indisponible.
   *
   * `null` n'est pas un detail d'affichage : il signifie qu'une precondition
   * manque — pas de session, review absente, empreinte absente. La raison est
   * expliquee a cote plutot que d'etre devinee depuis un bouton disparu.
   */
  requestChangesHref: string | null;
  /** Pourquoi la reprise est indisponible, lorsqu'elle l'est. */
  requestChangesReason: string | null;
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
export function ReviewDecisionForm({
  projectId,
  taskId,
  requestChangesHref,
  requestChangesReason,
}: ReviewDecisionFormProps) {
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

        {requestChangesHref === null ? null : (
          <Link
            href={requestChangesHref}
            className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
          >
            Request changes
          </Link>
        )}

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

      <div id={noticeId} className="flex flex-col gap-2 text-xs leading-relaxed text-zinc-600">
        <p>
          <span className="font-mono">Approve</span> passe la tache a{" "}
          <span className="font-mono">Done</span>. Aucun commit, aucun{" "}
          <code className="font-mono">git add</code>, aucun push : le commit reste votre geste.
        </p>
        {/* La difference entre les deux boutons de rejet est la question la plus
            frequente de cette page : elle est repondue ici, pas dans un
            document que personne n'ouvrira au moment du clic. */}
        <p>
          <span className="font-mono">Request changes</span> demande a{" "}
          <strong className="text-zinc-500">la meme session Claude</strong> de corriger ce travail,
          a partir de votre feedback et sans repartir de zero.{" "}
          <span className="font-mono">Reopen</span> remet simplement la tache a{" "}
          <span className="font-mono">Ready</span> : c&apos;est vous qui reprendrez la main sur le
          repository avant un futur lancement.
        </p>
        {requestChangesReason === null ? null : (
          <p className="text-amber-200/80">
            <span className="font-mono">Request changes</span> est indisponible :{" "}
            {requestChangesReason}
          </p>
        )}
      </div>
    </form>
  );
}
