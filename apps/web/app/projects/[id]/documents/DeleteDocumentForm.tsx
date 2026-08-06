"use client";

import Link from "next/link";
import { useActionState, useId } from "react";

import { deleteDocumentAction } from "./actions";
import { INITIAL_DELETE_DOCUMENT_STATE } from "./form-state";

type DeleteDocumentFormProps = {
  projectId: string;
  /** Nom du fichier, tel qu'affiche dans l'en-tete du lecteur. */
  name: string;
  /** Chemin relatif au repository. */
  documentPath: string;
  /** Revision affichee ; le runner refuse la suppression si le disque a change. */
  expectedRevision: string;
  /** Vrai lorsque l'URL demande la confirmation. */
  confirming: boolean;
  /** URL qui ouvre la confirmation. */
  confirmHref: string;
  /** URL qui la referme, sans rien supprimer. */
  cancelHref: string;
};

/**
 * Suppression d'un document, en deux temps.
 *
 * L'etape de confirmation est portee par l'**URL**, pas par un etat de
 * composant. Le formulaire est donc rendu par le serveur : il fonctionne sans
 * JavaScript, et « revenir en arriere » depuis la confirmation est une
 * navigation ordinaire.
 *
 * Aucun bouton de forcage n'est propose en cas de conflit, et ce n'est pas un
 * oubli : personne ne peut decider de supprimer une version qu'il n'a pas vue.
 * La seule issue offerte est de recharger.
 */
export function DeleteDocumentForm({
  projectId,
  name,
  documentPath,
  expectedRevision,
  confirming,
  confirmHref,
  cancelHref,
}: DeleteDocumentFormProps) {
  const [state, formAction, pending] = useActionState(
    deleteDocumentAction,
    INITIAL_DELETE_DOCUMENT_STATE,
  );

  const warningId = useId();

  if (!confirming) {
    return (
      <Link
        href={confirmHref}
        className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:border-red-400/60 hover:bg-red-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
      >
        Delete
      </Link>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="documentPath" value={documentPath} />
      <input type="hidden" name="expectedRevision" value={expectedRevision} />

      <div
        id={warningId}
        className="flex flex-col gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs leading-relaxed text-red-200"
      >
        <p>
          Supprimer <span className="font-medium">{name}</span> ?
        </p>
        <p className="break-all font-mono text-red-200/80">{documentPath}</p>
        <p className="text-red-200/80">
          Cette action supprimera directement ce fichier du repository. Elle ne cree aucun commit,
          et NOX n&apos;en conserve aucune copie. Si le fichier etait deja versionne, Git pourra
          eventuellement le restaurer ; sinon, il sera definitivement perdu. Verifie le changement
          avec Git avant de valider definitivement ton travail.
        </p>
      </div>

      {state.error === null ? null : (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200"
        >
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          // Le conflit desactive le bouton : reessayer echouerait a l'identique,
          // et la seule suite utile est de recharger la page.
          disabled={pending || state.conflict}
          aria-describedby={warningId}
          className="rounded-md border border-red-500/50 bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-100 transition-colors hover:bg-red-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Suppression…" : "Delete"}
        </button>

        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
