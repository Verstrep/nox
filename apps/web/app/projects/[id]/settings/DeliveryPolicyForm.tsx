"use client";

import { useActionState, useId, useState } from "react";

import {
  DELIVERY_POLICIES,
  type DeliveryPolicy,
} from "@nox/shared";
import {
  DELIVERY_INDEPENDENT_NOTICE,
  DELIVERY_POLICY_NOTICE,
  deliveryPolicyExplanation,
  deliveryPolicyLabel,
} from "@/lib/delivery-display";

import { setDeliveryPolicyAction } from "./actions";
import { INITIAL_DELIVERY_POLICY_STATE } from "./form-state";

/**
 * Choix de la politique de livraison Git d'un projet.
 *
 * ## Ce que ce formulaire engage
 *
 * Sauvegarder un mode automatique **est** l'autorisation. NOX ne redemandera pas
 * confirmation tache par tache — une file qui s'arrete sur une modale n'avance
 * pas plus qu'une file arretee. La consequence est donc annoncee au-dessus du
 * bouton, et l'explication de chaque mode est visible avant le clic, pas
 * decouverte au premier commit.
 *
 * ## Ce qu'il n'ecrit pas
 *
 * Rien dans Git. Changer la politique est une ecriture SQLite : aucun commit,
 * aucun push, aucune livraison, aucun avancement de file. Passer d'un mode
 * automatique a `Manual` n'annule aucun commit deja cree et ne restaure rien —
 * la nouvelle politique ne gouverne que ce qui n'a pas encore eu lieu.
 */
export function DeliveryPolicyForm({
  projectId,
  currentPolicy,
}: {
  projectId: string;
  currentPolicy: DeliveryPolicy;
}) {
  const [state, formAction, pending] = useActionState(
    setDeliveryPolicyAction,
    INITIAL_DELIVERY_POLICY_STATE,
  );
  const [policy, setPolicy] = useState<DeliveryPolicy>(currentPolicy);
  const groupId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="projectId" value={projectId} />

      <fieldset className="flex flex-col gap-3" disabled={pending}>
        <legend className="sr-only">Politique de livraison Git</legend>

        {DELIVERY_POLICIES.map((option) => {
          const inputId = `${groupId}-${option}`;
          return (
            <label
              key={option}
              htmlFor={inputId}
              className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors ${
                policy === option
                  ? "border-teal-400/50 bg-teal-400/5"
                  : "border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <input
                id={inputId}
                type="radio"
                name="policy"
                value={option}
                checked={policy === option}
                onChange={() => {
                  setPolicy(option);
                }}
                className="mt-1 h-4 w-4 shrink-0 accent-teal-400"
              />
              <span className="flex flex-col gap-1">
                <span className="text-sm font-medium text-zinc-100">
                  {deliveryPolicyLabel(option)}
                </span>
                <span className="text-sm leading-relaxed text-zinc-500">
                  {deliveryPolicyExplanation(option)}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm leading-relaxed text-amber-200/90">
        {DELIVERY_POLICY_NOTICE}
      </p>

      <p className="text-xs leading-relaxed text-zinc-600">{DELIVERY_INDEPENDENT_NOTICE}</p>

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

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Enregistrement…" : "Save"}
        </button>
      </div>
    </form>
  );
}
