"use client";

import { TASK_PRIORITIES } from "@nox/shared";
import Link from "next/link";
import { useActionState, useId } from "react";

import { taskPriorityLabel } from "@/lib/labels";
import type { TaskFormValues } from "@/lib/task-input";

import { createTaskFromProposalAction } from "./actions";
import { INITIAL_CREATE_FROM_PROPOSAL_STATE } from "./form-state";

type ProposalFormProps = {
  projectId: string;
  sessionId: string;
  /** Champs pre-remplis par la proposition de l'architecte. */
  proposed: TaskFormValues;
  cancelHref: string;
};

type FieldProps = {
  label: string;
  help: string;
  children: (ids: { fieldId: string; helpId: string }) => React.ReactNode;
};

/** Champ etiquette et decrit, pour que l'aide soit lue par un lecteur d'ecran. */
function Field({ label, help, children }: FieldProps) {
  const fieldId = useId();
  const helpId = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="text-sm font-medium text-zinc-200">
        {label}
      </label>
      <p id={helpId} className="text-xs leading-relaxed text-zinc-500">
        {help}
      </p>
      {children({ fieldId, helpId })}
    </div>
  );
}

const TEXT_CLASS =
  "w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-700 focus-visible:border-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400";

/**
 * Relecture et edition d'une proposition, avant creation.
 *
 * Chaque champ est modifiable. L'architecte propose un point de depart ; c'est
 * l'utilisateur qui decide de ce qui sera enregistre, et rien n'est cree tant
 * qu'il n'a pas clique.
 *
 * La tache creee sera un **brouillon** : la mettre en file reste une decision
 * separee, prise depuis sa page.
 */
export function ProposalForm({ projectId, sessionId, proposed, cancelHref }: ProposalFormProps) {
  const [state, formAction, pending] = useActionState(
    createTaskFromProposalAction,
    INITIAL_CREATE_FROM_PROPOSAL_STATE,
  );
  const errorId = useId();
  const values = state.values ?? proposed;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="sessionId" value={sessionId} />

      {state.error === null ? null : (
        <p
          id={errorId}
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {state.error}
        </p>
      )}

      <Field label="Title" help="Court, sans code de tache : NOX attribuera le numero.">
        {({ fieldId, helpId }) => (
          <input
            id={fieldId}
            name="title"
            type="text"
            required
            defaultValue={values.title}
            aria-describedby={helpId}
            className={TEXT_CLASS}
          />
        )}
      </Field>

      <Field label="Priority" help="L'urgence, jamais la qualite ni l'ambition de la tache.">
        {({ fieldId, helpId }) => (
          <select
            id={fieldId}
            name="priority"
            defaultValue={values.priority}
            aria-describedby={helpId}
            className={TEXT_CLASS}
          >
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {taskPriorityLabel(priority)}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field label="Objective" help="Le resultat attendu, pas les details d'implementation.">
        {({ fieldId, helpId }) => (
          <textarea
            id={fieldId}
            name="objective"
            rows={4}
            required
            defaultValue={values.objective}
            aria-describedby={helpId}
            className={TEXT_CLASS}
          />
        )}
      </Field>

      <Field label="Context" help="Pourquoi cette tache existe, et quelles contraintes comptent.">
        {({ fieldId, helpId }) => (
          <textarea
            id={fieldId}
            name="context"
            rows={5}
            defaultValue={values.context}
            aria-describedby={helpId}
            className={TEXT_CLASS}
          />
        )}
      </Field>

      <Field
        label="Acceptance criteria"
        help="Un critere par ligne. Chacun doit etre verifiable et observable."
      >
        {({ fieldId, helpId }) => (
          <textarea
            id={fieldId}
            name="criteria"
            rows={6}
            required
            defaultValue={values.criteria}
            aria-describedby={helpId}
            className={`${TEXT_CLASS} font-mono`}
          />
        )}
      </Field>

      <Field label="Out of scope" help="Ce que l'implementeur ne doit pas faire.">
        {({ fieldId, helpId }) => (
          <textarea
            id={fieldId}
            name="outOfScope"
            rows={4}
            defaultValue={values.outOfScope}
            aria-describedby={helpId}
            className={TEXT_CLASS}
          />
        )}
      </Field>

      <Field
        label="Documents"
        help="Un chemin relatif par ligne. Ils seront lus par l'implementeur avant de commencer."
      >
        {({ fieldId, helpId }) => (
          <textarea
            id={fieldId}
            name="documents"
            rows={4}
            defaultValue={values.documents}
            aria-describedby={helpId}
            className={`${TEXT_CLASS} font-mono`}
          />
        )}
      </Field>

      <Field
        label="Validation commands"
        help="Une commande par ligne. NOX ne les executera jamais lui-meme : elles seront autorisees a l'implementeur, telles quelles."
      >
        {({ fieldId, helpId }) => (
          <textarea
            id={fieldId}
            name="commands"
            rows={4}
            defaultValue={values.commands}
            aria-describedby={helpId}
            className={`${TEXT_CLASS} font-mono`}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Creation…" : "Create task"}
        </button>

        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
        >
          Cancel
        </Link>
      </div>

      <p className="text-xs leading-relaxed text-zinc-600">
        La tache sera creee en brouillon, avec son document Markdown. Aucune execution Claude Code
        ne demarre : la mettre en file reste une decision separee.
      </p>
    </form>
  );
}
