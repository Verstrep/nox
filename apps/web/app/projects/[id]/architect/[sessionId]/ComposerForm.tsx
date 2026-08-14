"use client";

import { useActionState, useId } from "react";

import { reviewTurnAction } from "./actions";
import { INITIAL_COMPOSER_STATE } from "./form-state";

type ComposerFormProps = {
  projectId: string;
  sessionId: string;
  /** Texte a reafficher : brouillon annule, ou message refuse. */
  draft: string;
  maxLength: number;
  /** Tours restants, ou `null` lorsque la conversation n'a pas de borne. */
  generationsLeft: number | null;
  /**
   * Message d'ouverture immuable, affiche en lecture seule au premier tour.
   *
   * **N'existe que dans une session de conception de tache** (`TASK_DESIGN_LEGACY`).
   * Il y a ete ecrit sur la page precedente et n'est plus modifiable : le serveur
   * le relit en base et ignore tout texte soumis. Sans cela, le texte affiche
   * dans la liste des conversations et le premier message du transcript
   * pourraient dire deux choses differentes.
   *
   * Une conversation projet vaut toujours `null` ici : elle n'a pas de message
   * d'ouverture, elle commence par un message comme tous les suivants. C'est au
   * rendu de le decider a partir du **role** de la session, jamais a partir du
   * texte : une chaine vide n'est pas l'absence d'ouverture, et l'avoir traitee
   * comme telle est precisement ce qui rendait la conversation projet muette.
   */
  openingMessage: string | null;
};

/**
 * Redaction du prochain message.
 *
 * Ce bouton ne contacte **aucun** fournisseur. Il prepare le tour et affiche ce
 * qui partira ; c'est un second clic qui declenchera l'appel facture. Presser
 * Entree n'envoie donc jamais rien — le raccourci d'un chat grand public
 * transformerait une frappe en depense.
 */
export function ComposerForm({
  projectId,
  sessionId,
  draft,
  maxLength,
  generationsLeft,
  openingMessage,
}: ComposerFormProps) {
  const [state, formAction, pending] = useActionState(reviewTurnAction, INITIAL_COMPOSER_STATE);
  const fieldId = useId();
  const helpId = useId();
  const errorId = useId();

  const exhausted = generationsLeft !== null && generationsLeft <= 0;

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

      {openingMessage === null ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="text-sm font-medium text-zinc-200">
            Message a l&apos;architecte
          </label>
          <p id={helpId} className="text-xs leading-relaxed text-zinc-500">
            Repondez, precisez, ou demandez une tache plus petite. Votre texte sera transmis comme
            du contenu, entre des marqueurs explicites — il ne modifie aucune regle.{" "}
            {maxLength.toLocaleString("fr-FR")} caracteres maximum.
          </p>
          <textarea
            id={fieldId}
            name="message"
            rows={6}
            required
            disabled={exhausted}
            maxLength={maxLength}
            defaultValue={state.message === "" ? draft : state.message}
            aria-describedby={state.error === null ? helpId : `${errorId} ${helpId}`}
            placeholder="Je prefere la seconde option, mais sans la partie backend."
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-700 focus-visible:border-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-zinc-200">Message d&apos;ouverture</h3>
          <p
            id={helpId}
            className="whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-relaxed text-zinc-300"
          >
            {openingMessage}
          </p>
          <p className="text-xs leading-relaxed text-zinc-500">
            Ce texte a ouvert la conversation et n&apos;est plus modifiable. Pour repartir
            d&apos;autre chose, ouvrez une nouvelle conversation — cela ne consomme rien.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || exhausted}
          className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Preparation…" : "Review context"}
        </button>

        <span className="text-xs text-zinc-600">
          {exhausted
            ? "Conversation limit reached"
            : generationsLeft === null
              ? "Conversation durable"
              : generationsLeft === 1
                ? "1 tour restant"
                : `${String(generationsLeft)} tours restants`}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-zinc-600">
        Ce bouton ne contacte aucun fournisseur. Il prepare le tour et vous montre ce qui partira ;
        c&apos;est un second clic qui declenchera l&apos;appel.
      </p>
    </form>
  );
}
