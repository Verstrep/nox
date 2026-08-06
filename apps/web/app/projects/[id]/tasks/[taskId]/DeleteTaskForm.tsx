"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";

import { documentUrl } from "@/lib/document-edit";

import { deleteTaskAction } from "./actions";
import { INITIAL_DELETE_TASK_STATE } from "./form-state";

type DeleteTaskFormProps = {
  projectId: string;
  taskId: string;
  taskCode: string;
  title: string;
  documentPath: string;
  /** Vrai lorsque l'URL demande la confirmation. */
  confirming: boolean;
  /** URL qui ouvre la confirmation. */
  confirmHref: string;
  /** URL qui la referme, sans rien supprimer. */
  cancelHref: string;
};

/**
 * Suppression d'une tache, en deux temps.
 *
 * Le premier lien n'agit pas : il ouvre la confirmation, portee par l'**URL**
 * plutot que par un etat de composant. Le formulaire est donc rendu par le
 * serveur, et fonctionne sans JavaScript.
 *
 * Le bouton final n'est actif que si l'utilisateur a recopie le code exact de
 * la tache. Recopier demande de lire ce qu'on supprime, ce qu'un « Etes-vous
 * sur ? » n'obtient de personne. Ce verrou est une **commodite** : la Server
 * Action verifie le code de son cote, et c'est elle qui fait autorite — sans
 * JavaScript, le bouton reste actif et le serveur refuse tout de meme.
 *
 * Le formulaire ne transporte que trois valeurs — projet, tache, code saisi. Ni
 * chemin, ni revision, ni option de forcage : la Server Action relit tout le
 * reste en base, ce qui rend un champ cache altere sans effet.
 */
export function DeleteTaskForm({
  projectId,
  taskId,
  taskCode,
  title,
  documentPath,
  confirming,
  confirmHref,
  cancelHref,
}: DeleteTaskFormProps) {
  const [state, formAction, pending] = useActionState(
    deleteTaskAction,
    INITIAL_DELETE_TASK_STATE,
  );

  const [typed, setTyped] = useState("");

  const inputId = useId();
  const warningId = useId();

  const matches = typed.trim() === taskCode;

  if (!confirming) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={confirmHref}
          className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-200 transition-colors hover:border-red-400/60 hover:bg-red-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
        >
          Delete task
        </Link>
        <span className="text-xs text-zinc-600">
          La tache et son document Markdown seront supprimes. Aucun commit n&apos;est cree.
        </span>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />

      <div
        id={warningId}
        className="flex flex-col gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm leading-relaxed text-red-200"
      >
        <p>
          Cette action supprimera definitivement la tache{" "}
          <span className="font-mono">{taskCode}</span> — « {title} » — ainsi que son document{" "}
          <span className="font-mono">{documentPath}</span> du repository.
        </p>
        <p className="text-red-200/80">
          Elle ne cree aucun commit. Verifiez le changement avec Git avant de valider
          definitivement votre travail. Le numero {taskCode} restera reserve : il ne sera jamais
          attribue a une autre tache.
        </p>
        <p className="text-red-200/80">
          Le document sera supprime en premier, puis la tache. Si le runner est arrete, rien ne
          sera supprime.
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

      <div>
        <label htmlFor={inputId} className="block text-sm font-medium text-zinc-200">
          Pour confirmer, recopiez le code de la tache : {" "}
          <span className="font-mono text-zinc-100">{taskCode}</span>
        </label>
        <input
          id={inputId}
          name="confirmationCode"
          type="text"
          value={typed}
          onChange={(event) => { setTyped(event.target.value); }}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={warningId}
          // `aria-invalid` n'est pose qu'une fois la saisie commencee : un champ
          // vide n'est pas une erreur, c'est un champ vide.
          aria-invalid={typed !== "" && !matches}
          disabled={pending}
          className="mt-2 w-full max-w-xs rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-200 focus:border-red-400/60 focus:outline-none focus:ring-1 focus:ring-red-400/40 disabled:opacity-60"
        />
        <p aria-live="polite" className="mt-2 text-xs text-zinc-600">
          {typed === ""
            ? "Le bouton reste inactif tant que le code n'est pas recopie."
            : matches
              ? "Code correct."
              : "Le code saisi ne correspond pas encore."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!matches || pending}
          className="rounded-md border border-red-500/50 bg-red-500/20 px-4 py-2 text-sm font-medium text-red-100 transition-colors hover:bg-red-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Suppression en cours…" : "Delete task"}
        </button>

        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
        >
          Cancel
        </Link>

        <Link
          href={documentUrl(projectId, documentPath)}
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
        >
          Relire le document avant de supprimer
        </Link>
      </div>
    </form>
  );
}
