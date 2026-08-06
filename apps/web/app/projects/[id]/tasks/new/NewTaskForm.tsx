"use client";

import { TASK_PRIORITIES } from "@nox/shared";
import { useActionState, useState } from "react";

import { useUnsavedChanges } from "@/components/useUnsavedChanges";
import { taskPriorityLabel } from "@/lib/labels";
import { readLines, TASK_LIMITS, type TaskFormValues } from "@/lib/task-input";

import { createTaskAction } from "./actions";
import { INITIAL_CREATE_TASK_STATE } from "./form-state";

const FIELD_CLASSES =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 " +
  "placeholder:text-zinc-600 focus:border-teal-400/60 focus:outline-none focus:ring-1 focus:ring-teal-400/40 " +
  "disabled:opacity-60 read-only:opacity-70";

type TextAreaFieldProps = {
  id: keyof TaskFormValues;
  label: string;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  hint?: string;
  optional?: boolean;
};

/**
 * Champ de texte multiligne.
 *
 * Declare **hors** du composant de formulaire : une fonction definie dans le
 * corps du rendu produit un nouveau type de composant a chaque frappe, ce qui
 * demonte le champ et lui fait perdre le focus.
 */
function TextAreaField({
  id,
  label,
  value,
  onChange,
  readOnly,
  hint,
  optional = false,
}: TextAreaFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-zinc-200">
        {label}
        {optional ? <span className="font-normal text-zinc-500"> (facultatif)</span> : null}
      </label>
      <textarea
        id={id}
        name={id}
        value={value}
        onChange={(event) => { onChange(event.target.value); }}
        readOnly={readOnly}
        rows={4}
        className={`mt-2 resize-y ${FIELD_CLASSES}`}
      />
      {hint === undefined ? null : <p className="mt-2 text-xs text-zinc-600">{hint}</p>}
    </div>
  );
}

/**
 * Formulaire de creation d'une tache.
 *
 * Les trois listes sont saisies en texte libre, une entree par ligne. Un
 * editeur de lignes avec boutons « ajouter » et « supprimer » serait plus
 * elabore sans etre plus rapide : coller trois criteres depuis une conversation
 * doit rester un simple collage.
 */
export function NewTaskForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(
    createTaskAction,
    INITIAL_CREATE_TASK_STATE,
  );

  const [values, setValues] = useState<TaskFormValues>(state.values);

  const update = (field: keyof TaskFormValues, value: string): void => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const isDirty = values.title.trim() !== "" || values.objective.trim() !== "";
  const leaveCreation = useUnsavedChanges(isDirty);

  const criteriaCount = readLines(values.criteria).length;
  const documentCount = readLines(values.documents).length;
  const commandCount = readLines(values.commands).length;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="projectId" value={projectId} />

      {state.error === null ? null : (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {state.error}
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-zinc-200">
            Titre
          </label>
          <input
            id="title"
            name="title"
            type="text"
            value={values.title}
            onChange={(event) => { update("title", event.target.value); }}
            disabled={pending}
            maxLength={TASK_LIMITS.title}
            autoComplete="off"
            placeholder="Ajouter la gestion des projets"
            className={`mt-2 ${FIELD_CLASSES}`}
          />
        </div>

        <div>
          <label htmlFor="priority" className="block text-sm font-medium text-zinc-200">
            Priorite
          </label>
          <select
            id="priority"
            name="priority"
            value={values.priority}
            onChange={(event) => { update("priority", event.target.value); }}
            disabled={pending}
            className={`mt-2 ${FIELD_CLASSES}`}
          >
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {taskPriorityLabel(priority)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <TextAreaField
        id="objective"
        label="Objectif"
        value={values.objective}
        onChange={(value) => { update("objective", value); }}
        readOnly={pending}
        hint="Ce que la tache doit rendre possible, en une ou deux phrases verifiables."
      />

      <TextAreaField
        id="context"
        label="Contexte"
        value={values.context}
        onChange={(value) => { update("context", value); }}
        readOnly={pending}
        optional
        hint="Ce qu'un agent doit savoir de l'etat actuel du projet pour comprendre la demande."
      />

      <TextAreaField
        id="outOfScope"
        label="Hors perimetre"
        value={values.outOfScope}
        onChange={(value) => { update("outOfScope", value); }}
        readOnly={pending}
        optional
        hint="Ce qui ne doit surtout pas etre fait pendant cette tache."
      />

      <TextAreaField
        id="documents"
        label="Documents a lire"
        value={values.documents}
        onChange={(value) => { update("documents", value); }}
        readOnly={pending}
        optional
        hint={`Un chemin relatif par ligne, par exemple docs/ARCHITECTURE.md. Les doublons sont retires. ${String(documentCount)} document(s).`}
      />

      <TextAreaField
        id="criteria"
        label="Criteres d'acceptation"
        value={values.criteria}
        onChange={(value) => { update("criteria", value); }}
        readOnly={pending}
        hint={`Un critere par ligne. Au moins un est obligatoire. ${String(criteriaCount)} critere(s).`}
      />

      <TextAreaField
        id="commands"
        label="Commandes de validation"
        value={values.commands}
        onChange={(value) => { update("commands", value); }}
        readOnly={pending}
        optional
        hint={`Une commande par ligne, par exemple npm run test. ${String(commandCount)} commande(s).`}
      />

      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200/90">
        Les commandes sont enregistrees avec la tache mais ne sont <strong>jamais</strong>{" "}
        executees. NOX ecrira le document{" "}
        <code className="font-mono">tasks/TASK-xxx.md</code> dans le repository, en creant le
        dossier <code className="font-mono">tasks/</code> s&apos;il manque.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {pending ? "Creation en cours…" : "Creer la tache"}
        </button>

        <button
          type="button"
          onClick={() => { leaveCreation(`/projects/${projectId}/tasks`); }}
          disabled={pending}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-60"
        >
          Cancel
        </button>

        <span className="text-xs text-zinc-600">Annuler n&apos;enregistre rien.</span>
      </div>
    </form>
  );
}
