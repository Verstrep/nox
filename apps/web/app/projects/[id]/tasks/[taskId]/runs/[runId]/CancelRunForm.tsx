"use client";

import { RUN_STATUS, type RunStatus } from "@nox/shared";
import Link from "next/link";
import { useActionState, useId } from "react";

import { CANCEL_WARNING, checkRunCancellation } from "@/lib/run-cancel";

import { cancelRunAction, type CancelRunState } from "./actions";

const INITIAL_STATE: CancelRunState = { error: null };

type CancelRunFormProps = {
  projectId: string;
  taskId: string;
  runId: string;
  status: RunStatus;
  /** Vrai lorsque l'URL demande la confirmation. */
  confirming: boolean;
  /** URL qui ouvre la confirmation. */
  confirmHref: string;
  /** URL qui la referme, sans rien interrompre. */
  cancelHref: string;
};

/**
 * Annulation d'une execution, en deux temps.
 *
 * Le premier lien n'agit pas : il ouvre la confirmation, portee par l'**URL**
 * plutot que par un etat de composant — comme les confirmations de TASK-009. Le
 * formulaire est donc rendu par le serveur, fonctionne sans JavaScript, et
 * « Keep running » reste une navigation ordinaire.
 *
 * Le formulaire ne transporte que trois identifiants. Aucun PID, aucun chemin,
 * aucun signal, aucune option de forcage : la Server Action relit tout le reste
 * en base, et c'est le runner qui decide comment arreter le processus.
 *
 * En `CANCELLING`, plus rien n'est propose — ni bouton grise, ni lien. Une
 * explication francaise prend la place : un bouton inactif sans raison visible
 * se lit comme une panne.
 */
export function CancelRunForm({
  projectId,
  taskId,
  runId,
  status,
  confirming,
  confirmHref,
  cancelHref,
}: CancelRunFormProps) {
  const [state, formAction, pending] = useActionState(cancelRunAction, INITIAL_STATE);
  const warningId = useId();

  if (status === RUN_STATUS.CANCELLING) {
    return (
      <p role="status" className="text-sm text-amber-200/90">
        Arret demande. NOX attend que le processus et ses descendants se terminent, puis
        constatera l&apos;etat du repository. Cette page se met a jour toute seule.
      </p>
    );
  }

  if (!checkRunCancellation(status).ok) {
    return null;
  }

  if (!confirming) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={confirmHref}
          className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-200 transition-colors hover:border-red-400/60 hover:bg-red-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
        >
          Cancel run
        </Link>
        <span className="text-xs text-zinc-600">
          Interrompt Claude Code. NOX ne restaure aucun fichier.
        </span>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="runId" value={runId} />

      <div
        id={warningId}
        className="flex flex-col gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm leading-relaxed text-red-200"
      >
        <p>{CANCEL_WARNING}</p>
        <p className="text-red-200/80">
          Le processus et ses descendants seront arretes. L&apos;execution passera a
          <span className="font-mono"> Cancelled</span> et la tache a
          <span className="font-mono"> Blocked</span> : vous devrez relire le repository avant de
          la remettre en <span className="font-mono">Ready</span>.
        </p>
      </div>

      {state.error === null ? null : (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          aria-describedby={warningId}
          className="rounded-md border border-red-500/50 bg-red-500/20 px-4 py-2 text-sm font-medium text-red-100 transition-colors hover:bg-red-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Cancelling…" : "Cancel run"}
        </button>

        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
        >
          Keep running
        </Link>
      </div>
    </form>
  );
}
