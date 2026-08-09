"use client";

import { useActionState, useId } from "react";

import { generateProposalAction } from "./actions";
import { INITIAL_GENERATE_PROPOSAL_STATE } from "./form-state";

type GenerateProposalFormProps = {
  projectId: string;
  sessionId: string;
  /** Questions posees a la generation precedente, s'il y en a. */
  questions: readonly string[];
  /** Precisions deja enregistrees, reaffichees telles quelles. */
  clarification: string;
  maxLength: number;
  /** Generations restantes avant la borne de la session. */
  generationsLeft: number;
  /** Faux lorsque la configuration du fournisseur est incomplete. */
  configured: boolean;
  /** Libelle du bouton : premiere generation ou nouvelle tentative. */
  label: string;
};

/**
 * Declenchement d'une generation.
 *
 * Le seul endroit d'ou un appel au fournisseur peut partir. Il n'y a ni appel au
 * chargement, ni au changement d'un champ, ni reessai automatique : chaque appel
 * est un clic, et chaque clic est facture.
 *
 * Le champ de precisions n'apparait que lorsque l'architecte a pose des
 * questions — ailleurs, il n'aurait rien a preciser.
 */
export function GenerateProposalForm({
  projectId,
  sessionId,
  questions,
  clarification,
  maxLength,
  generationsLeft,
  configured,
  label,
}: GenerateProposalFormProps) {
  const [state, formAction, pending] = useActionState(
    generateProposalAction,
    INITIAL_GENERATE_PROPOSAL_STATE,
  );
  const fieldId = useId();
  const helpId = useId();
  const errorId = useId();

  const exhausted = generationsLeft <= 0;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="sessionId" value={sessionId} />

      {state.error === null ? null : (
        <p
          id={errorId}
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {state.error}
        </p>
      )}

      {questions.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="text-sm font-medium text-zinc-200">
            Reponses / precisions
          </label>
          <p id={helpId} className="text-xs leading-relaxed text-zinc-500">
            Repondez aux questions ci-dessus. Votre texte sera transmis comme du contenu, entre des
            marqueurs explicites — il ne modifie aucune regle.{" "}
            {maxLength.toLocaleString("fr-FR")} caracteres maximum.
          </p>
          <textarea
            id={fieldId}
            name="clarification"
            rows={6}
            maxLength={maxLength}
            defaultValue={state.clarification === "" ? clarification : state.clarification}
            aria-describedby={state.error === null ? helpId : `${errorId} ${helpId}`}
            placeholder="1. Oui, pour tous les projets. 2. Le comportement existant doit rester compatible."
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-700 focus-visible:border-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || exhausted || !configured}
          className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Generation…" : label}
        </button>

        <span className="text-xs text-zinc-600">
          {exhausted
            ? "Generation limit reached"
            : generationsLeft === 1
              ? "1 generation restante"
              : `${String(generationsLeft)} generations restantes`}
        </span>
      </div>
    </form>
  );
}
