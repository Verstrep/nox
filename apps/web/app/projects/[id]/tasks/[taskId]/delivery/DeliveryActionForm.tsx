"use client";

import { useActionState } from "react";

import { deliverAction, refreshDeliveryAction, retryPushAction } from "./actions";
import { INITIAL_DELIVERY_ACTION_STATE } from "./form-state";

/** Les trois gestes possibles depuis la surface de livraison. */
export type DeliveryActionKind = "commit" | "commit-push" | "retry-push" | "refresh";

const ACTIONS = {
  commit: deliverAction,
  "commit-push": deliverAction,
  "retry-push": retryPushAction,
  refresh: refreshDeliveryAction,
} as const;

/**
 * Un bouton de livraison, et l'etat qu'il rend.
 *
 * ## Ce que le formulaire transporte
 *
 * Des identifiants, et un drapeau qui dit si le commit doit etre pousse. Aucun
 * chemin de repository, aucune branche, aucun remote, aucune liste de fichiers,
 * aucun message de commit, aucune empreinte, aucun argument Git. Le serveur relit
 * tout a partir de la livraison enregistree.
 *
 * ## Ce que l'absence d'un bouton veut dire
 *
 * Rien pour la securite. Un bouton cache est une commodite d'affichage ; la
 * Server Action revalide toutes les conditions, et le runner les revalide encore
 * avant d'appeler Git.
 */
export function DeliveryActionForm({
  kind,
  projectId,
  taskId,
  deliveryId,
  label,
  pendingLabel,
  emphasis = false,
}: {
  kind: DeliveryActionKind;
  projectId: string;
  taskId: string;
  deliveryId: string | null;
  label: string;
  pendingLabel: string;
  emphasis?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    ACTIONS[kind],
    INITIAL_DELIVERY_ACTION_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      {deliveryId === null ? null : (
        <input type="hidden" name="deliveryId" value={deliveryId} />
      )}
      {kind === "commit-push" ? <input type="hidden" name="push" value="1" /> : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className={
            emphasis
              ? "rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
              : "rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {pending ? pendingLabel : label}
        </button>
      </div>

      {state.error === null ? null : (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {state.error}
        </p>
      )}

      {state.notice === null ? null : (
        <p
          aria-live="polite"
          className="rounded-md border border-teal-400/30 bg-teal-400/5 px-4 py-3 text-sm leading-relaxed text-teal-200/90"
        >
          {state.notice}
        </p>
      )}
    </form>
  );
}
