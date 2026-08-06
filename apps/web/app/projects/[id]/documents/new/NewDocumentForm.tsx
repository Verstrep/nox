"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { useUnsavedChanges } from "@/components/useUnsavedChanges";
import {
  DOCUMENT_DESTINATIONS,
  ROOT_DOCUMENT_CHOICES,
  buildDocumentPath,
  findDestination,
} from "@/lib/document-create";

import { createDocumentAction } from "./actions";
import { INITIAL_CREATE_DOCUMENT_STATE } from "./form-state";

const FIELD_CLASSES =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 " +
  "placeholder:text-zinc-600 focus:border-teal-400/60 focus:outline-none focus:ring-1 focus:ring-teal-400/40 " +
  "disabled:opacity-60";

type NewDocumentFormProps = {
  projectId: string;
  /** Documents racine encore absents ; vide si tous existent deja. */
  availableRootDocuments: readonly string[];
  /** Faux lorsque l'inventaire n'a pas pu etre lu — runner arrete, par exemple. */
  inventoryKnown: boolean;
};

/**
 * Formulaire de creation d'un document.
 *
 * L'utilisateur choisit une destination et saisit un nom relatif. Il ne saisit
 * **jamais** un chemin complet : le prefixe est affiche a cote du champ, il
 * n'est pas modifiable, et il n'est de toute facon pas transmis — le serveur le
 * retrouve a partir de la destination.
 *
 * La previsualisation ci-dessous est purement informative. Elle utilise la meme
 * fonction que la Server Action, mais le serveur la recalcule sans jamais lire
 * ce qui est affiche ici.
 */
export function NewDocumentForm({
  projectId,
  availableRootDocuments,
  inventoryKnown,
}: NewDocumentFormProps) {
  const [state, formAction, pending] = useActionState(
    createDocumentAction,
    INITIAL_CREATE_DOCUMENT_STATE,
  );

  const [destination, setDestination] = useState(state.values.destination);
  const [name, setName] = useState(state.values.name);
  const [content, setContent] = useState(state.values.content);

  const isDirty = name.trim() !== "" || content !== "";
  const leaveCreation = useUnsavedChanges(isDirty);

  const documentsUrl = `/projects/${projectId}/documents`;
  const selected = findDestination(destination);
  const isRoot = selected?.kind === "root";
  const preview = buildDocumentPath(destination, name);

  const rootChoices = inventoryKnown ? availableRootDocuments : ROOT_DOCUMENT_CHOICES;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="projectId" value={projectId} />

      {state.error === null ? null : (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          <p>{state.error}</p>
          {state.existingPath === null ? null : (
            <Link
              href={`${documentsUrl}?path=${encodeURIComponent(state.existingPath)}`}
              className="mt-3 inline-block rounded-md border border-red-400/40 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/10"
            >
              Ouvrir le document existant
            </Link>
          )}
        </div>
      )}

      <div>
        <label htmlFor="destination" className="block text-sm font-medium text-zinc-200">
          Destination
        </label>
        <select
          id="destination"
          name="destination"
          value={destination}
          onChange={(event) => {
            setDestination(event.target.value);
            // Un nom valide pour une destination ne l'est pas pour une autre :
            // conserver la saisie ici produirait un chemin incoherent.
            setName("");
          }}
          disabled={pending}
          className={`mt-2 ${FIELD_CLASSES}`}
        >
          {DOCUMENT_DESTINATIONS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        {selected === null ? null : (
          <p className="mt-2 text-xs text-zinc-600">{selected.hint}</p>
        )}
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-zinc-200">
          {isRoot ? "Document" : "Nom du fichier"}
        </label>

        {isRoot ? (
          rootChoices.length === 0 ? (
            <p className="mt-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-500">
              Les trois documents racine reconnus par NOX existent deja dans ce repository.
            </p>
          ) : (
            <select
              id="name"
              name="name"
              value={name}
              onChange={(event) => { setName(event.target.value); }}
              disabled={pending}
              className={`mt-2 ${FIELD_CLASSES}`}
            >
              <option value="">Choisir…</option>
              {rootChoices.map((fileName) => (
                <option key={fileName} value={fileName}>
                  {fileName}
                </option>
              ))}
            </select>
          )
        ) : (
          <div className="mt-2 flex items-stretch gap-0">
            <span className="flex items-center rounded-l-md border border-r-0 border-zinc-700 bg-zinc-900 px-3 font-mono text-sm text-zinc-500">
              {selected?.directory}/
            </span>
            <input
              id="name"
              name="name"
              type="text"
              value={name}
              onChange={(event) => { setName(event.target.value); }}
              disabled={pending}
              autoComplete="off"
              spellCheck={false}
              placeholder="PRODUCT_VISION.md"
              className={`rounded-l-none rounded-r-md font-mono ${FIELD_CLASSES}`}
            />
          </div>
        )}

        <p className="mt-2 text-xs text-zinc-600">
          Le nom doit se terminer par <code className="font-mono">.md</code>. Les sous-dossiers
          sont acceptes s&apos;ils existent deja — NOX n&apos;en cree aucun.
        </p>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-zinc-600">Chemin final</p>
        <p className="mt-1 break-all font-mono text-sm text-zinc-300">
          {preview.ok ? preview.path : <span className="text-zinc-600">—</span>}
        </p>
        {preview.ok || name.trim() === "" ? null : (
          <p className="mt-1 text-xs text-amber-200/80">{preview.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="content" className="block text-sm font-medium text-zinc-200">
          Contenu initial <span className="font-normal text-zinc-500">(facultatif)</span>
        </label>
        <textarea
          id="content"
          name="content"
          value={content}
          onChange={(event) => { setContent(event.target.value); }}
          readOnly={pending}
          spellCheck={false}
          rows={16}
          placeholder="# Titre du document"
          className="mt-2 h-[40vh] w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-200 focus:border-teal-400/60 focus:outline-none focus:ring-1 focus:ring-teal-400/40 read-only:opacity-70"
        />
        <p className="mt-2 text-xs text-zinc-600">
          Un document vide est accepte : vous pourrez le remplir juste apres.
        </p>
      </div>

      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200/90">
        Le fichier sera ajoute directement au repository. NOX ne remplace jamais un document
        existant et ne cree aucun dossier.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {pending ? "Creation en cours…" : "Creer le document"}
        </button>

        <button
          type="button"
          onClick={() => { leaveCreation(documentsUrl); }}
          disabled={pending}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-60"
        >
          Annuler
        </button>

        <span className="text-xs text-zinc-600">Annuler n&apos;ecrit rien sur le disque.</span>
      </div>
    </form>
  );
}
