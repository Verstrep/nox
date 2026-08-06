"use client";

import Link from "next/link";
import { useActionState } from "react";

import { startRunAction } from "./actions";
import { INITIAL_START_RUN_STATE } from "./form-state";

type StartRunFormProps = {
  projectId: string;
  taskId: string;
  /** `HEAD` constate par le preflight ; vide si le preflight a echoue. */
  expectedGitHead: string;
  /** Faux tant qu'une precondition n'est pas remplie. */
  canLaunch: boolean;
};

/**
 * Bouton de lancement.
 *
 * Le prompt n'est pas modifiable pendant TASK-008 — il n'est meme pas un champ
 * du formulaire. Trois valeurs seulement sont transmises, et le serveur
 * regenere tout le reste : c'est ce qui rend une execution reproductible et
 * empeche un formulaire altere d'elargir les permissions de l'agent.
 */
export function StartRunForm({
  projectId,
  taskId,
  expectedGitHead,
  canLaunch,
}: StartRunFormProps) {
  const [state, formAction, pending] = useActionState(startRunAction, INITIAL_START_RUN_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="expectedGitHead" value={expectedGitHead} />

      {state.error === null ? null : (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {state.error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canLaunch || pending}
          className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Lancement en cours…" : "Lancer Claude Code"}
        </button>

        <Link
          href={`/projects/${projectId}/tasks/${taskId}`}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
        >
          Annuler
        </Link>

        {canLaunch ? null : (
          <span className="text-xs text-zinc-600">
            Une precondition n&apos;est pas remplie : voir ci-dessus.
          </span>
        )}
      </div>
    </form>
  );
}
