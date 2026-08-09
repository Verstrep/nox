"use client";

import Link from "next/link";
import { useActionState, useId } from "react";

import { requestChangesAction } from "./actions";
import { INITIAL_REQUEST_CHANGES_STATE } from "./form-state";

type RequestChangesFormProps = {
  projectId: string;
  taskId: string;
  runId: string;
  /** Retour vers la review, pour le bouton `Cancel`. */
  cancelHref: string;
  maxLength: number;
};

/**
 * Saisie du feedback de review.
 *
 * Un seul champ, et deux issues : revenir a la review, ou preparer la
 * correction. Preparer n'est pas lancer — la page suivante montre le prompt
 * exact et l'etat du repository avant qu'un processus ne demarre.
 *
 * Le texte saisi survit a un refus : il est renvoye par la Server Action et
 * reaffiche. Perdre plusieurs paragraphes parce qu'une precondition a change
 * entre l'affichage et l'envoi serait la pire facon de refuser.
 */
export function RequestChangesForm({
  projectId,
  taskId,
  runId,
  cancelHref,
  maxLength,
}: RequestChangesFormProps) {
  const [state, formAction, pending] = useActionState(
    requestChangesAction,
    INITIAL_REQUEST_CHANGES_STATE,
  );
  const fieldId = useId();
  const helpId = useId();
  const errorId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="runId" value={runId} />

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
          Feedback
        </label>
        <p id={helpId} className="text-xs leading-relaxed text-zinc-500">
          Decrivez precisement ce qui doit etre corrige. Claude Code reprendra la session de cette
          execution : il connait deja la tache, les fichiers et ce qu&apos;il a produit. Inutile de
          tout reexpliquer — dites ce qui ne va pas. {maxLength.toLocaleString("fr-FR")} caracteres
          maximum.
        </p>
        <textarea
          id={fieldId}
          name="feedback"
          rows={10}
          required
          maxLength={maxLength}
          defaultValue={state.text}
          aria-describedby={state.error === null ? helpId : `${errorId} ${helpId}`}
          placeholder="Explique precisement ce qui doit etre corrige dans cette review…"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-700 focus-visible:border-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Enregistrement…" : "Prepare correction"}
        </button>

        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
        >
          Cancel
        </Link>
      </div>

      <p className="text-xs leading-relaxed text-zinc-600">
        Ce bouton ne lance rien. Il enregistre votre texte et ouvre une page de preparation, ou
        vous verrez le prompt exact et l&apos;etat du repository avant de decider.
      </p>
    </form>
  );
}
