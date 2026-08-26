"use client";

import { TASK_PRIORITIES, type TaskDependencyRef } from "@nox/shared";
import { useActionState, useRef, useState } from "react";

import { useUnsavedChanges } from "@/components/useUnsavedChanges";
import { VerificationPlanFields } from "@/components/VerificationPlanFields";
import { taskPriorityLabel, taskStatusLabel } from "@/lib/labels";
import { readLines, TASK_LIMITS } from "@/lib/task-input";
import {
  emptyCommandRow,
  emptyCriterionRow,
  type TaskEditCommandRow,
  type TaskEditCriterionRow,
  type TaskEditFormValues,
} from "@/lib/verification-fields";

import { editTaskAction } from "./actions";
import { INITIAL_EDIT_TASK_STATE } from "./form-state";

const FIELD_CLASSES =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 " +
  "placeholder:text-zinc-600 focus:border-teal-400/60 focus:outline-none focus:ring-1 focus:ring-teal-400/40 " +
  "disabled:opacity-60 read-only:opacity-70";

type TextAreaFieldProps = {
  id: string;
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
 * Declare **hors** du composant de formulaire, comme dans le formulaire de
 * creation : une fonction definie dans le corps du rendu produit un nouveau type
 * de composant a chaque frappe, ce qui demonte le champ et lui fait perdre le
 * focus. C'est exactement le defaut corrige dans TASK-022, sous une autre forme.
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
 * Formulaire d'edition d'une tache future.
 *
 * ## Les identites de liste
 *
 * Chaque critere et chaque commande porte une **cle d'interface** stable, qui ne
 * vient ni du texte, ni de la position, ni de la base. Supprimer la premiere
 * ligne ne doit pas faire glisser le contenu des suivantes dans les mauvais
 * champs, et taper dans un critere ne doit pas remonter le champ.
 *
 * Ce n'est pas une precaution abstraite : une cle derivee d'un texte modifiable
 * a deja fait perdre le focus a chaque frappe dans le formulaire de backlog. Un
 * test structurel verifie qu'aucune cle de ce fichier ne vient d'un titre.
 *
 * ## Les liens critere-commande sont des cles, pas des textes
 *
 * Cocher « npm test » comme preuve enregistre la **ligne**, pas la chaine. Une
 * faute de frappe corrigee ensuite ne casse aucun lien, et deux commandes
 * identiques restent deux lignes distinctes.
 *
 * ## Ce formulaire ne juge pas la coherence du plan
 *
 * Un critere automatise sans preuve est enregistrable : un brouillon a le droit
 * d'etre incomplet. C'est `Mark ready` qui refuse — une fois, au seul endroit
 * qui fasse autorite.
 */
export function EditTaskForm({
  projectId,
  taskId,
  taskCode,
  initialValues,
  revision,
  candidates,
  cancelHref,
}: {
  projectId: string;
  taskId: string;
  taskCode: string;
  initialValues: TaskEditFormValues;
  revision: string;
  candidates: readonly TaskDependencyRef[];
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(editTaskAction, INITIAL_EDIT_TASK_STATE);

  // Un refus rend les valeurs saisies : le contenu du formulaire ne se perd pas
  // parce qu'une dependance formait un cycle.
  const [values, setValues] = useState<TaskEditFormValues>(state.values ?? initialValues);

  // Un compteur, pas la longueur de la liste : supprimer puis ajouter ne doit
  // jamais reattribuer une cle deja vue, sous peine de melanger deux lignes.
  const nextKey = useRef(0);
  const makeKey = (prefix: string): string => {
    nextKey.current += 1;
    return `${prefix}n${String(nextKey.current)}`;
  };

  const update = (field: "title" | "priority" | "objective" | "context" | "outOfScope" | "documents", value: string): void => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const updateCriterion = (key: string, patch: Partial<TaskEditCriterionRow>): void => {
    setValues((current) => ({
      ...current,
      criteria: current.criteria.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }));
  };

  const updateCommand = (key: string, patch: Partial<TaskEditCommandRow>): void => {
    setValues((current) => ({
      ...current,
      commands: current.commands.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }));
  };

  const toggleProof = (criterionKey: string, commandKey: string): void => {
    setValues((current) => ({
      ...current,
      criteria: current.criteria.map((row) =>
        row.key === criterionKey
          ? {
              ...row,
              commandKeys: row.commandKeys.includes(commandKey)
                ? row.commandKeys.filter((entry) => entry !== commandKey)
                : [...row.commandKeys, commandKey],
            }
          : row,
      ),
    }));
  };

  const addCriterion = (): void => {
    setValues((current) => ({
      ...current,
      criteria: [...current.criteria, emptyCriterionRow(makeKey("c"))],
    }));
  };

  const removeCriterion = (key: string): void => {
    setValues((current) => ({
      ...current,
      criteria: current.criteria.filter((row) => row.key !== key),
    }));
  };

  const addCommand = (): void => {
    setValues((current) => ({
      ...current,
      commands: [...current.commands, emptyCommandRow(makeKey("v"))],
    }));
  };

  // Retirer une commande retire aussi les preuves qui la designaient : un lien
  // vers une ligne disparue ne veut plus rien dire, et le laisser produirait un
  // critere automatise silencieusement sans preuve.
  const removeCommand = (key: string): void => {
    setValues((current) => ({
      ...current,
      commands: current.commands.filter((row) => row.key !== key),
      criteria: current.criteria.map((row) => ({
        ...row,
        commandKeys: row.commandKeys.filter((entry) => entry !== key),
      })),
    }));
  };

  const toggleDependency = (id: string): void => {
    setValues((current) => ({
      ...current,
      dependsOnTaskIds: current.dependsOnTaskIds.includes(id)
        ? current.dependsOnTaskIds.filter((entry) => entry !== id)
        : [...current.dependsOnTaskIds, id],
    }));
  };

  const leaveEdition = useUnsavedChanges(true);

  const documentCount = readLines(values.documents).length;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="expectedRevision" value={revision} />

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
      />

      <TextAreaField
        id="outOfScope"
        label="Hors perimetre"
        value={values.outOfScope}
        onChange={(value) => { update("outOfScope", value); }}
        readOnly={pending}
        optional
      />

      <TextAreaField
        id="documents"
        label="Documents a lire"
        value={values.documents}
        onChange={(value) => { update("documents", value); }}
        readOnly={pending}
        optional
        hint={`Un chemin relatif par ligne. ${String(documentCount)} document(s).`}
      />

      <VerificationPlanFields
        prefix=""
        rows={{ criteria: values.criteria, commands: values.commands }}
        handlers={{
          updateCriterion,
          updateCommand,
          toggleProof,
          addCriterion,
          removeCriterion,
          addCommand,
          removeCommand,
        }}
        disabled={pending}
      />

      <fieldset className="rounded-md border border-zinc-800 px-4 py-4">
        <legend className="px-2 text-sm font-medium text-zinc-200">Dependencies</legend>

        {candidates.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Ce projet ne contient aucune autre tache.
          </p>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-zinc-600">
              {taskCode} ne pourra pas demarrer tant que les taches cochees ne seront pas
              terminees. L&apos;ordre des numeros ne cree aucune dependance : seules celles
              cochees ici en sont.
            </p>
            <ul className="mt-4 flex flex-col gap-2">
              {candidates.map((candidate) => (
                <li key={candidate.id} className="flex items-center gap-3">
                  <input
                    id={`dependency-${candidate.id}`}
                    type="checkbox"
                    name="dependsOnTaskIds"
                    value={candidate.id}
                    checked={values.dependsOnTaskIds.includes(candidate.id)}
                    onChange={() => { toggleDependency(candidate.id); }}
                    disabled={pending}
                    className="h-4 w-4 shrink-0 accent-teal-400"
                  />
                  <label
                    htmlFor={`dependency-${candidate.id}`}
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm text-zinc-300"
                  >
                    <span className="font-mono text-xs text-zinc-500">{candidate.code}</span>
                    <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                    <span className="text-xs text-zinc-600">
                      {taskStatusLabel(candidate.status)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </fieldset>

      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200/90">
        Enregistrer ne lance rien : ni Claude Code, ni l&apos;Architecte, ni commit. Le document{" "}
        <code className="font-mono">tasks/{taskCode}.md</code> est reecrit uniquement si le
        contrat change. Une tache en file redevient un brouillon des lors que sa specification
        est modifiee — le plan de verification en fait partie.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {pending ? "Enregistrement…" : "Save"}
        </button>

        <button
          type="button"
          onClick={() => { leaveEdition(cancelHref); }}
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
