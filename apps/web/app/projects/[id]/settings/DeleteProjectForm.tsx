"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";

import {
  PROJECT_DELETE_IRREVERSIBLE_NOTICE,
  PROJECT_DELETE_NO_GIT_NOTICE,
  PROJECT_DELETE_PRESERVES,
  PROJECT_DELETE_REMOVES,
} from "@/lib/project-delete";

import { deleteProjectAction } from "./actions";
import { INITIAL_DELETE_PROJECT_STATE } from "./form-state";

type DeleteProjectFormProps = {
  projectId: string;
  projectName: string;
  repositoryPath: string;
  /** Nombre de documents de taches que NOX sait avoir ecrits. */
  ownedArtifacts: number;
  /** Vrai lorsque l'URL demande la confirmation. */
  confirming: boolean;
  confirmHref: string;
  cancelHref: string;
};

/**
 * Suppression d'un projet, en deux temps.
 *
 * Le premier lien n'agit pas : il ouvre la confirmation, portee par l'**URL**
 * plutot que par un etat de composant. Le formulaire est donc rendu par le
 * serveur, et fonctionne sans JavaScript.
 *
 * Le bouton final n'est actif qu'apres avoir recopie le nom exact du projet.
 * Recopier demande de lire ce qu'on supprime, ce qu'un « Etes-vous sur ? »
 * n'obtient de personne. Ce verrou est une **commodite** : la Server Action
 * revalide le nom de son cote, et c'est elle qui fait autorite.
 *
 * Le formulaire ne transporte que deux valeurs — projet, nom saisi. Aucun
 * chemin, aucune liste de fichiers, aucune revision : le serveur reconstruit
 * tout en base, ce qui rend un champ cache altere sans prise sur les fichiers
 * reellement supprimes.
 */
export function DeleteProjectForm({
  projectId,
  projectName,
  repositoryPath,
  ownedArtifacts,
  confirming,
  confirmHref,
  cancelHref,
}: DeleteProjectFormProps) {
  const [state, formAction, pending] = useActionState(
    deleteProjectAction,
    INITIAL_DELETE_PROJECT_STATE,
  );
  const [typed, setTyped] = useState("");

  const inputId = useId();
  const warningId = useId();

  const matches = typed.trim() === projectName.trim();

  if (!confirming) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={confirmHref}
          className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-200 transition-colors hover:border-red-400/60 hover:bg-red-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
        >
          Delete project from NOX
        </Link>
        <span className="text-xs text-zinc-600">
          Le repository et son code restent intacts. Aucun commit n&apos;est créé.
        </span>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />

      <div
        id={warningId}
        className="flex flex-col gap-3 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm leading-relaxed text-red-200"
      >
        <p>
          NOX supprimera définitivement tout ce qu&apos;il sait du projet «&nbsp;{projectName}
          &nbsp;» :
        </p>
        <ul className="ml-5 list-disc text-red-200/90">
          {PROJECT_DELETE_REMOVES.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>

        <p className="pt-1">Le repository reste intact. NOX ne touche pas à&nbsp;:</p>
        <ul className="ml-5 list-disc text-red-200/90">
          {PROJECT_DELETE_PRESERVES.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>

        <p className="text-red-200/80">
          {ownedArtifacts === 0
            ? "Aucun document de tâche n'est à retirer : NOX n'en a écrit aucun dans ce repository."
            : ownedArtifacts === 1
              ? "1 document de tâche écrit par NOX sera retiré du repository."
              : `${String(ownedArtifacts)} documents de tâche écrits par NOX seront retirés du repository.`}
        </p>

        <p className="text-red-200/80">{PROJECT_DELETE_NO_GIT_NOTICE}</p>
        <p className="text-red-200/80">{PROJECT_DELETE_IRREVERSIBLE_NOTICE}</p>

        <p className="font-mono text-xs text-red-200/70">{repositoryPath}</p>
      </div>

      {state.error === null ? null : (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor={inputId} className="block text-sm font-medium text-zinc-200">
          Pour confirmer, recopiez le nom du projet&nbsp;:{" "}
          <span className="text-zinc-100">{projectName}</span>
        </label>
        <input
          id={inputId}
          name="confirmationName"
          type="text"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
          }}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={warningId}
          aria-invalid={typed !== "" && !matches}
          disabled={pending}
          className="mt-2 w-full max-w-md rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-red-400/60 focus:outline-none focus:ring-1 focus:ring-red-400/40 disabled:opacity-60"
        />
        <p aria-live="polite" className="mt-2 text-xs text-zinc-600">
          {typed === ""
            ? "Le bouton reste inactif tant que le nom n'est pas recopié."
            : matches
              ? "Nom correct."
              : "Le nom saisi ne correspond pas encore."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!matches || pending}
          className="rounded-md border border-red-500/50 bg-red-500/20 px-4 py-2 text-sm font-medium text-red-100 transition-colors hover:bg-red-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Suppression en cours…" : "Delete project from NOX"}
        </button>

        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
