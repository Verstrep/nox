"use client";

import Link from "next/link";
import { useActionState, useId } from "react";

import { createArchitectSessionAction } from "./actions";
import { INITIAL_NEW_ARCHITECT_REQUEST_STATE } from "./form-state";

type NewArchitectRequestFormProps = {
  projectId: string;
  cancelHref: string;
  maxLength: number;
};

/**
 * Premier message d'une conversation Architecte.
 *
 * Un seul champ. Le bouton ne contacte aucun fournisseur : il ouvre la
 * conversation et sa page, ou le contexte exact s'affiche avant qu'un seul
 * caractere ne quitte la machine.
 *
 * Le texte survit a un refus : le perdre parce qu'une validation a echoue serait
 * la pire facon de refuser.
 */
export function NewArchitectRequestForm({
  projectId,
  cancelHref,
  maxLength,
}: NewArchitectRequestFormProps) {
  const [state, formAction, pending] = useActionState(
    createArchitectSessionAction,
    INITIAL_NEW_ARCHITECT_REQUEST_STATE,
  );
  const fieldId = useId();
  const helpId = useId();
  const errorId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="projectId" value={projectId} />

      {state.error === null ? null : (
        <p
          id={errorId}
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor={fieldId} className="text-sm font-medium text-zinc-200">
          Que veux-tu construire ou modifier ?
        </label>
        <p id={helpId} className="text-xs leading-relaxed text-zinc-500">
          Decrivez l&apos;intention, pas l&apos;implementation. Vous pourrez en discuter autant que
          necessaire ; la conversation aboutira a <strong className="text-zinc-400">une</strong>{" "}
          tache, la plus petite qui apporte quelque chose.{" "}
          {maxLength.toLocaleString("fr-FR")} caracteres maximum.
        </p>
        <textarea
          id={fieldId}
          name="request"
          rows={8}
          required
          maxLength={maxLength}
          defaultValue={state.text}
          aria-describedby={state.error === null ? helpId : `${errorId} ${helpId}`}
          placeholder="Je veux pouvoir exporter les taches d'un projet en JSON…"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-700 focus-visible:border-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Ouverture…" : "Start conversation"}
        </button>

        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
        >
          Cancel
        </Link>
      </div>

      <p className="text-xs leading-relaxed text-zinc-600">
        Ce bouton ne contacte aucun fournisseur. Il ouvre la conversation et vous montre le
        contexte ; ce sont deux clics de plus qui declencheront le premier appel.
      </p>
    </form>
  );
}
