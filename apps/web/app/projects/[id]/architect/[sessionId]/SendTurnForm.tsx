"use client";

import { useActionState, useId } from "react";

import { cancelTurnAction, sendTurnAction } from "./actions";
import { INITIAL_COMPOSER_STATE } from "./form-state";

type SendTurnFormProps = {
  projectId: string;
  sessionId: string;
  /** Faux lorsque la configuration du fournisseur est incomplete. */
  configured: boolean;
  /** Vrai lorsque le contexte a change depuis le dernier tour. */
  contextChanged: boolean;
};

/**
 * Envoi du tour prepare.
 *
 * Le seul endroit d'ou un appel au fournisseur peut partir. Aucun champ de
 * contenu n'y figure : le message part du brouillon relu en base, et le contexte
 * est reconstruit cote serveur juste avant l'appel.
 *
 * Deux boutons, deux actions distinctes. `Cancel` efface le brouillon et rend le
 * texte au composer ; il n'ecrit rien dans la conversation, parce qu'un tour
 * abandonne n'a pas eu lieu.
 */
export function SendTurnForm({
  projectId,
  sessionId,
  configured,
  contextChanged,
}: SendTurnFormProps) {
  const [sendState, sendAction, sending] = useActionState(sendTurnAction, INITIAL_COMPOSER_STATE);
  const [cancelState, cancelAction, cancelling] = useActionState(
    cancelTurnAction,
    INITIAL_COMPOSER_STATE,
  );
  const errorId = useId();

  const error = sendState.error ?? cancelState.error;

  return (
    <div className="flex flex-col gap-4">
      {error === null ? null : (
        <p
          id={errorId}
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <form action={sendAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <button
            type="submit"
            disabled={sending || cancelling || !configured}
            aria-describedby={error === null ? undefined : errorId}
            className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Envoi…" : "Send to Architect"}
          </button>
        </form>

        <form action={cancelAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <button
            type="submit"
            disabled={sending || cancelling}
            className="rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelling ? "Abandon…" : "Cancel"}
          </button>
        </form>
      </div>

      <p className="text-xs leading-relaxed text-zinc-600">
        {contextChanged
          ? "En envoyant, vous acceptez explicitement le nouveau contexte listé ci-dessus."
          : "Un clic, un appel. NOX ne relance jamais de lui-meme."}
      </p>
    </div>
  );
}
