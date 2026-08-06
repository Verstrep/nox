"use client";

import type { TaskStatus } from "@nox/shared";
import { useActionState } from "react";

import { describeTaskStatus } from "@/lib/task-display";

import { updateTaskStatusAction } from "./actions";
import { INITIAL_TASK_STATUS_STATE } from "./form-state";

type TaskStatusFormProps = {
  projectId: string;
  taskId: string;
  /** Transitions autorisees depuis le statut actuel ; peut etre vide. */
  transitions: readonly TaskStatus[];
};

/**
 * Boutons de transition.
 *
 * Un bouton par transition autorisee, plutot qu'une liste deroulante de tous
 * les statuts : ce que l'interface propose correspond exactement a ce que le
 * serveur accepte, et un statut impossible n'est jamais affiche puis refuse.
 *
 * La verification serveur reste entiere pour autant — ces boutons sont une
 * commodite, pas une securite.
 */
export function TaskStatusForm({ projectId, taskId, transitions }: TaskStatusFormProps) {
  const [state, formAction, pending] = useActionState(
    updateTaskStatusAction,
    INITIAL_TASK_STATUS_STATE,
  );

  if (transitions.length === 0) {
    return (
      <p className="text-xs text-zinc-600">
        Aucune transition manuelle n&apos;est possible depuis ce statut.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />

      <div className="flex flex-wrap items-center gap-2">
        {transitions.map((status) => (
          <button
            key={status}
            type="submit"
            name="status"
            value={status}
            disabled={pending}
            className="rounded-md border border-zinc-700 bg-zinc-800/70 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50 disabled:opacity-60"
          >
            Passer a « {describeTaskStatus(status)} »
          </button>
        ))}
      </div>

      {state.error === null ? null : (
        <p role="alert" className="text-xs text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}
