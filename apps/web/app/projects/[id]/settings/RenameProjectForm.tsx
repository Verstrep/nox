"use client";

import { useActionState, useId, useState } from "react";

import { PROJECT_NAME_MAX_LENGTH } from "@/lib/project-input";

import { renameProjectAction } from "./actions";
import { INITIAL_RENAME_PROJECT_STATE } from "./form-state";

/**
 * Renommage d'un projet.
 *
 * Le nom NOX est de la metadata locale : le changer ne renomme aucun dossier,
 * ne touche pas a Git et ne reecrit ni le brief, ni le plan, ni la
 * documentation du repository. C'est une ecriture SQLite, et rien d'autre.
 *
 * Le formulaire ne transporte que l'identifiant du projet et le nom saisi. La
 * borne affichee ici est une commodite : le serveur revalide avec exactement le
 * meme validateur que la creation.
 */
export function RenameProjectForm({
  projectId,
  currentName,
}: {
  projectId: string;
  currentName: string;
}) {
  const [state, formAction, pending] = useActionState(
    renameProjectAction,
    INITIAL_RENAME_PROJECT_STATE,
  );
  const [name, setName] = useState(currentName);
  const inputId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />

      <div>
        <label htmlFor={inputId} className="block text-sm font-medium text-zinc-200">
          Nom du projet
        </label>
        <input
          id={inputId}
          name="name"
          type="text"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          maxLength={PROJECT_NAME_MAX_LENGTH}
          autoComplete="off"
          disabled={pending}
          className="mt-2 w-full max-w-md rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-teal-400/60 focus:outline-none focus:ring-1 focus:ring-teal-400/40 disabled:opacity-60"
        />
        <p className="mt-2 text-xs text-zinc-600">
          Le chemin du repository ne change pas : renommer un projet dans NOX ne renomme aucun
          dossier et ne modifie pas Git.
        </p>
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
