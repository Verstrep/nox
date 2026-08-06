"use client";

import type { ProjectDocumentContent } from "@nox/shared";
import { useActionState, useState } from "react";

import { StatusBadge } from "@/components/StatusBadge";
import { useUnsavedChanges } from "@/components/useUnsavedChanges";
import { documentUrl } from "@/lib/document-edit";
import { describeCategory } from "@/lib/documents";

import { updateDocumentAction } from "./actions";
import { initialEditDocumentState } from "./form-state";

type DocumentEditorProps = {
  projectId: string;
  document: ProjectDocumentContent;
};

/**
 * Editeur d'un document Markdown existant.
 *
 * Le texte est edite tel quel, sans coloration ni apercu : NOX affiche le
 * fichier, il ne le reinterprete pas.
 *
 * Trois choses ne figurent pas dans ce formulaire, et c'est delibere : le chemin
 * du repository, le jeton du runner, et toute information sur la machine. Le
 * formulaire ne transporte que l'identifiant du projet, le chemin relatif du
 * document et la revision attendue — le serveur retrouve le reste en base.
 *
 * Le composant est colocalise avec sa route, comme le formulaire de creation de
 * projet : il n'a aucun usage ailleurs.
 */
export function DocumentEditor({ projectId, document }: DocumentEditorProps) {
  const [state, formAction, pending] = useActionState(
    updateDocumentAction,
    initialEditDocumentState(document.path, document.content, document.revision),
  );

  const [content, setContent] = useState(document.content);
  const isDirty = content !== document.content;
  const leaveEditing = useUnsavedChanges(isDirty);

  const readUrl = documentUrl(projectId, document.path);

  return (
    <article className="flex min-h-0 flex-col rounded-xl border border-teal-400/30 bg-nox-surface/80">
      <header className="flex flex-col gap-3 border-b border-zinc-800 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-100">{document.name}</h2>
          <StatusBadge tone="accent">{describeCategory(document.category)}</StatusBadge>
        </div>

        <p className="break-all font-mono text-xs text-zinc-500">{document.path}</p>

        <p className="text-xs text-amber-200/80">
          L&apos;enregistrement modifie directement ce fichier dans le repository. NOX ne conserve
          aucune copie et ne cree aucun commit.
        </p>
      </header>

      <form action={formAction} className="flex flex-col gap-4 p-5">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="documentPath" value={document.path} />
        <input type="hidden" name="expectedRevision" value={document.revision} />

        {state.error === null ? null : (
          <div
            role="alert"
            className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            <p>{state.error}</p>
            {state.conflict ? (
              <button
                type="button"
                onClick={() => { leaveEditing(readUrl); }}
                className="mt-3 rounded-md border border-red-400/40 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/10"
              >
                Recharger la version actuelle du fichier
              </button>
            ) : null}
          </div>
        )}

        <div>
          <label htmlFor="content" className="block text-sm font-medium text-zinc-200">
            Contenu Markdown
          </label>
          <textarea
            id="content"
            name="content"
            value={content}
            onChange={(event) => { setContent(event.target.value); }}
            readOnly={pending}
            spellCheck={false}
            rows={24}
            className="mt-2 h-[60vh] w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-200 focus:border-teal-400/60 focus:outline-none focus:ring-1 focus:ring-teal-400/40 read-only:opacity-70"
          />
          <p className="mt-2 text-xs text-zinc-600">
            {isDirty ? "Modifications non enregistrees." : "Aucune modification."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 disabled:opacity-60"
          >
            {pending ? "Enregistrement en cours…" : "Enregistrer"}
          </button>

          <button
            type="button"
            onClick={() => { leaveEditing(readUrl); }}
            disabled={pending}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-60"
          >
            Annuler
          </button>

          <span className="text-xs text-zinc-600">Annuler n&apos;ecrit rien sur le disque.</span>
        </div>
      </form>
    </article>
  );
}
