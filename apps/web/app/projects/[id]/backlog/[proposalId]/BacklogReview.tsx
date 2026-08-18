"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { TASK_PRIORITIES } from "@nox/shared";

import { useUnsavedChanges } from "@/components/useUnsavedChanges";
import {
  BACKLOG_STALE_MESSAGE,
  moveBacklogItem,
  removeBacklogItem,
} from "@/lib/backlog/display";
import {
  backlogReviewValues,
  createBacklogReviewItems,
  setBacklogItemField,
} from "@/lib/backlog/review-items";
import { taskPriorityLabel } from "@/lib/labels";

import { applyBacklogAction } from "../actions";
import type { BacklogApplyState, BacklogItemValues } from "../form-state";

const FIELD_CLASSES =
  "w-full rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-zinc-600";

const CONTROL_CLASSES =
  "rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40";

/** Un champ de texte libre, borne par le serveur et non par cette saisie. */
function Field({
  name,
  label,
  hint,
  rows,
  value,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  rows: number;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider text-zinc-500">{label}</span>
      {hint === undefined ? null : <span className="text-xs text-zinc-600">{hint}</span>}
      <textarea
        name={name}
        rows={rows}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={`${FIELD_CLASSES} resize-y font-sans leading-relaxed`}
      />
    </label>
  );
}

/**
 * Revue d'un backlog propose.
 *
 * ## Compact d'abord, detail a la demande
 *
 * Vingt taches et leurs criteres feraient une page que personne ne lirait. Les
 * cartes montrent donc le titre, la priorite et l'objectif ; le reste s'ouvre
 * tache par tache. Tout reste inspectable avant application — c'est le point de
 * la revue — mais rien n'est impose d'un bloc.
 *
 * ## L'ordre affiche est l'ordre applique
 *
 * Les champs sont nommes d'apres leur **position courante**. Deplacer une tache
 * renomme donc ses champs, et c'est exactement ce qu'on veut : le serveur lit
 * l'ordre de l'ecran, jamais celui du fournisseur.
 *
 * ## L'identite d'une carte ne depend d'aucune valeur editable
 *
 * La position nomme les champs ; elle ne peut pas servir de cle React, parce
 * qu'un deplacement melangerait alors les formulaires. Le titre non plus : une
 * cle qui change a chaque frappe demonte la carte et lui fait perdre le focus.
 * Chaque element porte donc un identifiant local, attribue une fois et
 * inchange ensuite — voir `lib/backlog/review-items.ts`.
 *
 * ## Aucun brouillon n'est persiste
 *
 * Une edition non appliquee vit dans ce formulaire, et nulle part ailleurs.
 * Un brouillon enregistre serait une fonctionnalite de plus, avec son cycle de
 * vie et ses conflits ; rien ne la demande aujourd'hui.
 *
 * ## Ajouter une tache n'est pas propose
 *
 * Editer, deplacer, retirer : trois gestes qui portent tous sur ce que le
 * modele a produit. Ajouter une tache vierge serait une quatrieme chose — une
 * creation manuelle — et NOX en possede deja une, complete et testee. La faire
 * exister ici en double n'apporterait rien qu'une seconde implementation.
 */
export function BacklogReview({
  projectId,
  proposalId,
  initialItems,
  cancelHref,
  blocked,
}: {
  projectId: string;
  proposalId: string;
  initialItems: BacklogItemValues[];
  cancelHref: string;
  /** Proposition perimee ou deja traitee : l'application est impossible. */
  blocked: boolean;
}) {
  const [state, formAction, pending] = useActionState<BacklogApplyState, FormData>(
    applyBacklogAction,
    { items: initialItems, error: null, stale: false },
  );

  // L'identite est attribuee une fois, au montage : la revue ne sait qu'editer,
  // deplacer et retirer, donc aucun element nouveau n'apparait ensuite.
  const [items, setItems] = useState(() => createBacklogReviewItems(state.items));

  // L'element deplie est designe par son identite, jamais par sa position :
  // sinon un deplacement ouvrirait la carte du voisin.
  const [expanded, setExpanded] = useState<string | null>(null);

  const dirty = JSON.stringify(backlogReviewValues(items)) !== JSON.stringify(initialItems);
  const stopped = blocked || state.stale;

  useUnsavedChanges(dirty && !pending && !stopped);

  const setField =
    (index: number, field: keyof BacklogItemValues) =>
    (next: string): void => {
      setItems((current) => setBacklogItemField(current, index, field, next));
    };

  const move = (from: number, to: number): void => {
    setItems((current) => moveBacklogItem(current, from, to));
  };

  const remove = (index: number): void => {
    setItems((current) => removeBacklogItem(current, index));
  };

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <input type="hidden" name="itemCount" value={String(items.length)} />

      {state.stale ? (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {BACKLOG_STALE_MESSAGE}
        </p>
      ) : null}

      {state.error === "" || state.error === null ? null : (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {state.error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm leading-relaxed text-zinc-500">
          Vous avez retire toutes les taches de ce backlog. Il n&apos;y a plus rien a appliquer :
          ecartez-le plutot.
        </p>
      ) : null}

      <ol className="flex flex-col gap-4">
        {items.map(({ uid, values: item }, index) => {
          const at = (field: string): string => `items.${String(index)}.${field}`;
          const open = expanded === uid;

          return (
            <li key={uid} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="flex flex-wrap items-start gap-3">
                <span className="mt-2 w-6 shrink-0 text-right text-xs text-zinc-600">
                  {index + 1}.
                </span>

                <div className="min-w-0 flex-1 flex-col gap-2">
                  <input
                    type="text"
                    name={at("title")}
                    value={item.title}
                    onChange={(event) => {
                      setField(index, "title")(event.target.value);
                    }}
                    disabled={stopped}
                    aria-label={`Titre de la tache ${String(index + 1)}`}
                    className={`${FIELD_CLASSES} font-medium`}
                  />
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                    {item.objective}
                  </p>
                </div>

                <select
                  name={at("priority")}
                  value={item.priority}
                  onChange={(event) => {
                    setField(index, "priority")(event.target.value);
                  }}
                  disabled={stopped}
                  aria-label={`Priorite de la tache ${String(index + 1)}`}
                  className={`${FIELD_CLASSES} w-auto`}
                >
                  {TASK_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {taskPriorityLabel(priority)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 pl-9">
                <button
                  type="button"
                  onClick={() => {
                    setExpanded(open ? null : uid);
                  }}
                  className={CONTROL_CLASSES}
                >
                  {open ? "Close" : "Edit"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    move(index, index - 1);
                  }}
                  disabled={stopped || index === 0}
                  className={CONTROL_CLASSES}
                >
                  Move up
                </button>
                <button
                  type="button"
                  onClick={() => {
                    move(index, index + 1);
                  }}
                  disabled={stopped || index === items.length - 1}
                  className={CONTROL_CLASSES}
                >
                  Move down
                </button>
                <button
                  type="button"
                  onClick={() => {
                    remove(index);
                  }}
                  disabled={stopped}
                  className={CONTROL_CLASSES}
                >
                  Remove
                </button>
              </div>

              {/*
                Les champs replies restent dans le formulaire, en `hidden` : un
                champ demonte perdrait sa valeur, et l'application enverrait une
                tache amputee de tout ce que l'utilisateur n'a pas deplie.
              */}
              {open ? (
                <div className="mt-4 flex flex-col gap-4 border-t border-zinc-800 pt-4 pl-9">
                  <Field
                    name={at("objective")}
                    label="Objectif"
                    hint="Le resultat observable attendu."
                    rows={3}
                    value={item.objective}
                    onChange={setField(index, "objective")}
                  />
                  <Field
                    name={at("context")}
                    label="Contexte"
                    hint="Pourquoi cette tache existe."
                    rows={3}
                    value={item.context}
                    onChange={setField(index, "context")}
                  />
                  <Field
                    name={at("criteria")}
                    label="Criteres d'acceptation"
                    hint="Un par ligne. Au moins un est obligatoire."
                    rows={4}
                    value={item.criteria}
                    onChange={setField(index, "criteria")}
                  />
                  <Field
                    name={at("outOfScope")}
                    label="Hors perimetre"
                    hint="Ce que l'implementeur ne doit pas faire."
                    rows={3}
                    value={item.outOfScope}
                    onChange={setField(index, "outOfScope")}
                  />
                  <Field
                    name={at("documents")}
                    label="Documents a lire"
                    hint="Un chemin par ligne, issu du repository."
                    rows={3}
                    value={item.documents}
                    onChange={setField(index, "documents")}
                  />
                  <Field
                    name={at("commands")}
                    label="Commandes de validation"
                    hint="Une par ligne, sans operateur shell."
                    rows={3}
                    value={item.commands}
                    onChange={setField(index, "commands")}
                  />
                </div>
              ) : (
                <>
                  <input type="hidden" name={at("objective")} value={item.objective} />
                  <input type="hidden" name={at("context")} value={item.context} />
                  <input type="hidden" name={at("criteria")} value={item.criteria} />
                  <input type="hidden" name={at("outOfScope")} value={item.outOfScope} />
                  <input type="hidden" name={at("documents")} value={item.documents} />
                  <input type="hidden" name={at("commands")} value={item.commands} />
                </>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-5">
        <button
          type="submit"
          disabled={pending || stopped || items.length === 0}
          className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Application…" : "Apply backlog"}
        </button>
        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
        >
          Cancel
        </Link>
      </div>

      <p className="text-xs leading-relaxed text-zinc-600">
        Appliquer ne rappelle pas l&apos;Architecte : aucun appel au fournisseur, aucune execution
        de Claude Code, aucun commit, aucun push. Les taches sont creees en{" "}
        <span className="font-mono">DRAFT</span>, dans l&apos;ordre affiche ci-dessus.
      </p>
    </form>
  );
}
