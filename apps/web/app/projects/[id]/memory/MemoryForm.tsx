"use client";

import {
  PROJECT_MEMORY_CATEGORIES,
  PROJECT_MEMORY_LIMITS,
  PROJECT_MEMORY_STATUS,
  PROJECT_MEMORY_STATUSES,
  isProjectMemoryCategory,
  isProjectMemoryStatus,
} from "@nox/shared";
import Link from "next/link";
import { useActionState, useState } from "react";

import { useUnsavedChanges } from "@/components/useUnsavedChanges";
import {
  projectMemoryCategoryHint,
  projectMemoryCategoryLabel,
  projectMemoryStatusLabel,
} from "@/lib/labels";

import { createMemoryAction, updateMemoryAction } from "./actions";
import {
  INITIAL_MEMORY_FORM_STATE,
  type MemoryFormState,
  type MemoryFormValues,
} from "./form-state";

const FIELD_CLASSES =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 " +
  "placeholder:text-zinc-600 focus:border-teal-400/60 focus:outline-none focus:ring-1 focus:ring-teal-400/40 " +
  "disabled:opacity-60";

/**
 * Compteur de caracteres d'un champ.
 *
 * Affiche en permanence plutot qu'a l'approche de la limite : une borne qui
 * n'apparait qu'une fois depassee se decouvre au moment ou il est trop tard pour
 * l'anticiper.
 */
function Counter({ value, limit }: { value: string; limit: number }) {
  const over = value.length > limit;
  return (
    <span className={`text-xs ${over ? "text-amber-300" : "text-zinc-600"}`}>
      {value.length} / {limit} caracteres
    </span>
  );
}

/**
 * Formulaire d'une entree de memoire.
 *
 * Le meme composant sert a la creation et a la modification : les deux
 * remplissent exactement les memes champs, et deux formulaires jumeaux
 * finiraient par diverger sur une validation ou un libelle.
 *
 * Le code `MEM-xxx` n'est pas un champ : il est attribue a la creation et ne
 * change jamais. L'afficher en lecture seule dit ce qu'il est — un fait, pas un
 * choix.
 */
export function MemoryForm({
  projectId,
  memoryId,
  code,
  initialValues,
  cancelHref,
}: {
  projectId: string;
  /** Absent a la creation : c'est ce qui distingue les deux modes. */
  memoryId?: string;
  code?: string;
  initialValues: MemoryFormValues;
  cancelHref: string;
}) {
  const editing = memoryId !== undefined;
  const [state, formAction, pending] = useActionState<MemoryFormState, FormData>(
    editing ? updateMemoryAction : createMemoryAction,
    { ...INITIAL_MEMORY_FORM_STATE, values: initialValues },
  );

  // Les valeurs renvoyees par la Server Action reprennent la main apres un
  // refus : le texte saisi n'est jamais perdu, meme quand le budget refuse
  // l'entree.
  const [values, setValues] = useState<MemoryFormValues>(state.values);
  const dirty =
    values.category !== initialValues.category ||
    values.title !== initialValues.title ||
    values.content !== initialValues.content ||
    values.rationale !== initialValues.rationale ||
    values.status !== initialValues.status;

  useUnsavedChanges(dirty && !pending);

  const set = (field: keyof MemoryFormValues) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const category = isProjectMemoryCategory(values.category)
    ? values.category
    : PROJECT_MEMORY_CATEGORIES[0];
  const status = isProjectMemoryStatus(values.status)
    ? values.status
    : PROJECT_MEMORY_STATUS.ACTIVE;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="projectId" value={projectId} />
      {editing ? <input type="hidden" name="memoryId" value={memoryId} /> : null}

      {state.error === null ? null : (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {state.error}
        </p>
      )}

      {code === undefined ? null : (
        <div>
          <span className="block text-sm font-medium text-zinc-200">Code</span>
          <p className="mt-2 font-mono text-sm text-zinc-400">{code}</p>
          <p className="mt-2 text-xs text-zinc-600">
            Attribue a la creation, et jamais modifie. Modifier cette entree ne lui donne pas un
            nouveau code.
          </p>
        </div>
      )}

      <fieldset>
        <legend className="text-sm font-medium text-zinc-200">Categorie</legend>
        <div className="mt-3 flex flex-col gap-2">
          {PROJECT_MEMORY_CATEGORIES.map((entry) => (
            <label key={entry} className="flex items-start gap-3 text-sm text-zinc-300">
              <input
                type="radio"
                name="category"
                value={entry}
                checked={category === entry}
                onChange={() => { set("category")(entry); }}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-zinc-200">
                  {projectMemoryCategoryLabel(entry)}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {projectMemoryCategoryHint(entry)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="title" className="block text-sm font-medium text-zinc-200">
          Titre
        </label>
        <input
          id="title"
          name="title"
          type="text"
          value={values.title}
          onChange={(event) => { set("title")(event.target.value); }}
          maxLength={PROJECT_MEMORY_LIMITS.title * 2}
          className={`mt-2 ${FIELD_CLASSES}`}
        />
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs text-zinc-600">
            Une ligne, lisible d&apos;un coup d&apos;oeil. C&apos;est ce titre qui identifie
            l&apos;entree dans la liste et dans le contexte envoye.
          </p>
          <Counter value={values.title} limit={PROJECT_MEMORY_LIMITS.title} />
        </div>
      </div>

      <div>
        <label htmlFor="content" className="block text-sm font-medium text-zinc-200">
          Contenu
        </label>
        <textarea
          id="content"
          name="content"
          value={values.content}
          onChange={(event) => { set("content")(event.target.value); }}
          rows={6}
          className={`mt-2 resize-y ${FIELD_CLASSES}`}
        />
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs text-zinc-600">
            Le texte durable a retenir. Ecrivez-le pour quelqu&apos;un qui arrive sur le projet.
          </p>
          <Counter value={values.content} limit={PROJECT_MEMORY_LIMITS.content} />
        </div>
      </div>

      <div>
        <label htmlFor="rationale" className="block text-sm font-medium text-zinc-200">
          Justification <span className="font-normal text-zinc-500">(facultatif)</span>
        </label>
        <textarea
          id="rationale"
          name="rationale"
          value={values.rationale}
          onChange={(event) => { set("rationale")(event.target.value); }}
          rows={4}
          className={`mt-2 resize-y ${FIELD_CLASSES}`}
        />
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs text-zinc-600">
            Pourquoi cette entree existe. Particulierement utile pour une decision : dans six mois,
            c&apos;est le « pourquoi » qui manque, jamais le « quoi ».
          </p>
          <Counter value={values.rationale} limit={PROJECT_MEMORY_LIMITS.rationale} />
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-zinc-200">Statut</legend>
        <div className="mt-3 flex flex-col gap-2">
          {PROJECT_MEMORY_STATUSES.map((entry) => (
            <label key={entry} className="flex items-start gap-3 text-sm text-zinc-300">
              <input
                type="radio"
                name="status"
                value={entry}
                checked={status === entry}
                onChange={() => { set("status")(entry); }}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-zinc-200">
                  {projectMemoryStatusLabel(entry)}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {entry === PROJECT_MEMORY_STATUS.ACTIVE
                    ? "Incluse dans le contexte envoye a l'Architecte lors d'un appel explicite."
                    : "Conservee et consultable, mais jamais envoyee a l'Architecte."}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Enregistrement…" : editing ? "Save memory" : "Add memory"}
        </button>
        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
