"use client";

import { useActionState } from "react";

import { BOOTSTRAP_FREE_NOTICE, BOOTSTRAP_STALE_MESSAGE } from "@/lib/bootstrap/display";

import { createBootstrapTaskAction } from "./actions";
import { INITIAL_CREATE_STATE, type BootstrapCreateState } from "./form-state";

/**
 * Creation de `TASK-000`.
 *
 * ## Elle annonce ce qu'elle ne coute pas
 *
 * La regle de NOX depuis TASK-013 est qu'une action engageant une IA se
 * declare. Sa reciproque est utile aussi : cette action n'en engage aucune, et
 * le dire evite l'hesitation devant un bouton qu'on croit facturé.
 *
 * ## Elle porte l'empreinte de l'apercu
 *
 * Le champ cache transporte l'empreinte du contexte qui vient d'etre affiche.
 * Il n'accorde aucun droit : il ne peut qu'obtenir un refus si l'etat a change
 * entre la lecture et le clic.
 *
 * Le bouton se desactive pendant l'envoi, mais ce n'est pas la que se joue
 * l'unicite : elle vit dans la contrainte `projectId + sequence`, et
 * resisterait a deux onglets.
 */
export function CreateBootstrapButton({
  projectId,
  fingerprint,
}: {
  projectId: string;
  fingerprint: string;
}) {
  const [state, formAction, pending] = useActionState<BootstrapCreateState, FormData>(
    createBootstrapTaskAction,
    INITIAL_CREATE_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="fingerprint" value={fingerprint} />

      {state.stale ? (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {BOOTSTRAP_STALE_MESSAGE}
        </p>
      ) : null}

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
          className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Creating TASK-000…" : "Create TASK-000"}
        </button>
        <p className="text-xs text-zinc-500">{BOOTSTRAP_FREE_NOTICE}</p>
      </div>
    </form>
  );
}
