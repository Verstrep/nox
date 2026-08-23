"use client";

import { useActionState, type ReactNode } from "react";

import {
  INITIAL_QUEUE_ACTION_STATE,
  type QueueActionState,
} from "@/app/projects/[id]/queue/form-state";

type QueueAction = (
  previousState: QueueActionState,
  formData: FormData,
) => Promise<QueueActionState>;

type QueueActionButtonProps = {
  action: QueueAction;
  projectId: string;
  /** Tache concernee, pour les actions qui en visent une. */
  taskId?: string;
  /** Sens d'un deplacement, pour les actions qui en demandent un. */
  direction?: "up" | "down";
  children: ReactNode;
  /** Libelle pendant l'envoi. */
  pendingLabel: string;
  tone?: "primary" | "neutral" | "danger";
  disabled?: boolean;
  /** Description lue par un lecteur d'ecran, quand le libelle est un symbole. */
  ariaLabel?: string;
};

const TONE_CLASSES: Record<"primary" | "neutral" | "danger", string> = {
  primary:
    "bg-teal-400/90 text-zinc-950 hover:bg-teal-300 focus-visible:outline-teal-200",
  neutral:
    "border border-zinc-700 bg-zinc-800/70 text-zinc-200 hover:border-zinc-600 hover:text-zinc-50 focus-visible:outline-zinc-400",
  danger:
    "border border-red-500/40 bg-red-500/10 text-red-200 hover:border-red-400/60 hover:bg-red-500/20 focus-visible:outline-red-400",
};

/**
 * Un bouton, une Server Action, aucun etat cache.
 *
 * Les actions de file portent toutes la meme forme — un projet, parfois une
 * tache, parfois une direction — et rendent toutes le meme etat. Un composant
 * unique evite six formulaires identiques a un mot pres, et surtout evite que
 * l'un d'eux oublie d'afficher son refus.
 *
 * Le message est affiche **sous** le bouton par le parent : ce composant ne
 * connait que son propre resultat.
 */
export function QueueActionButton({
  action,
  projectId,
  taskId,
  direction,
  children,
  pendingLabel,
  tone = "neutral",
  disabled = false,
  ariaLabel,
}: QueueActionButtonProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_QUEUE_ACTION_STATE);

  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="projectId" value={projectId} />
      {taskId === undefined ? null : <input type="hidden" name="taskId" value={taskId} />}
      {direction === undefined ? null : (
        <input type="hidden" name="direction" value={direction} />
      )}

      <button
        type="submit"
        disabled={disabled || pending}
        aria-label={ariaLabel}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${TONE_CLASSES[tone]}`}
      >
        {pending ? pendingLabel : children}
      </button>

      {state.error === null ? null : (
        <p
          role="alert"
          className="basis-full rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200"
        >
          {state.error}
        </p>
      )}
      {state.notice === null ? null : (
        <p
          aria-live="polite"
          className="basis-full rounded-md border border-teal-400/30 bg-teal-400/5 px-3 py-2 text-xs leading-relaxed text-teal-200/90"
        >
          {state.notice}
        </p>
      )}
    </form>
  );
}
