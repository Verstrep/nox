"use client";

import { useActionState } from "react";

import { ArchitectProgress } from "@/components/ArchitectProgress";
import { BACKLOG_GENERATE_NOTICE } from "@/lib/backlog/display";

import { generateBacklogAction } from "./actions";
import { INITIAL_GENERATE_STATE, type BacklogGenerateState } from "./form-state";

/**
 * Action de planification.
 *
 * ## Elle annonce ce qu'elle coute
 *
 * `This action calls OpenAI once.` est affiche a cote du bouton, pas cache dans
 * une infobulle. C'est la regle de NOX depuis TASK-013 : une action qui engage
 * une IA se declare, et l'utilisateur clique en sachant.
 *
 * ## Elle ne se declenche jamais toute seule
 *
 * Ni au chargement, ni apres un enregistrement de plan, ni apres une mise a
 * jour de projet appliquee, ni apres un echec. Un clic, un appel.
 *
 * Le bouton se desactive pendant l'envoi — ce qui evite un second clic — mais
 * ce n'est pas la que se joue la garantie : le verrou vit en base, et il
 * resisterait a deux onglets.
 *
 * ## Elle dit combien de temps elle travaille, et se laisse arreter
 *
 * C'est ici que le second pilote reel a perdu deux appels : deux depassements
 * de delai consecutifs, sans qu'aucun ecran ne dise depuis combien de temps la
 * planification tournait ni comment reprendre la main. Le plafond a change ;
 * l'attente, elle, avait aussi besoin d'etre visible et interruptible.
 */
export function GenerateBacklogButton({
  projectId,
  disabled = false,
  label = "Generate V1 backlog",
}: {
  projectId: string;
  /** Une precondition manque : le bouton est visible, et inoperant. */
  disabled?: boolean;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState<BacklogGenerateState, FormData>(
    generateBacklogAction,
    INITIAL_GENERATE_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />

      {state.error === null ? null : (
        <p
          role="alert"
          className="whitespace-pre-line rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {state.error}
        </p>
      )}

      {pending ? (
        <ArchitectProgress
          statusUrl={`/api/projects/${projectId}/backlog/generation`}
          stopUrl={`/api/projects/${projectId}/backlog/generation`}
          label="Génération du backlog…"
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || disabled}
          className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Generating backlog…" : label}
        </button>
        <p className="text-xs text-zinc-500">{BACKLOG_GENERATE_NOTICE}</p>
      </div>
    </form>
  );
}
