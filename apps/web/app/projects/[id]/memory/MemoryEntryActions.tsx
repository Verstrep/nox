"use client";

import { PROJECT_MEMORY_STATUS, type ProjectMemoryStatus } from "@nox/shared";
import Link from "next/link";
import { useActionState, useState } from "react";

import { MEMORY_ARCHIVE_NOTICE, memoryStatusToggle } from "@/lib/memory-display";

import { deleteMemoryAction, setMemoryStatusAction } from "./actions";
import { INITIAL_MEMORY_ACTION_STATE } from "./form-state";

const SECONDARY_CLASSES =
  "rounded-md border border-zinc-700 bg-zinc-800/70 px-3 py-1.5 text-xs font-medium text-zinc-200 " +
  "transition-colors hover:border-zinc-600 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-60";

const DANGER_CLASSES =
  "rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 " +
  "transition-colors hover:border-red-500/60 hover:text-red-100 focus-visible:outline focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-red-400 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Actions d'une entree : editer, archiver ou restaurer, supprimer.
 *
 * ## La confirmation est un etat, pas une alerte
 *
 * `window.confirm` bloque le rendu, ne se style pas, et se navigue mal au
 * clavier. La confirmation est donc un second bouton, qui remplace le premier :
 * elle se lit, se tabule et s'annule comme n'importe quel element de la page.
 *
 * ## Aucune de ces actions n'appelle une IA
 *
 * Archiver, restaurer ou supprimer une memoire sont des ecritures SQLite. Aucun
 * appel a OpenAI, aucun lancement de Claude Code, aucune requete au runner,
 * aucune ecriture dans le repository.
 */
export function MemoryEntryActions({
  projectId,
  memoryId,
  code,
  status,
  editHref,
}: {
  projectId: string;
  memoryId: string;
  code: string;
  status: ProjectMemoryStatus;
  editHref: string;
}) {
  const toggle = memoryStatusToggle(status);
  const [statusState, statusAction, statusPending] = useActionState(
    setMemoryStatusAction,
    INITIAL_MEMORY_ACTION_STATE,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteMemoryAction,
    INITIAL_MEMORY_ACTION_STATE,
  );
  const [confirming, setConfirming] = useState(false);

  const error = statusState.error ?? deleteState.error;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={editHref} className={SECONDARY_CLASSES}>
          Edit
        </Link>

        <form action={statusAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="memoryId" value={memoryId} />
          <input type="hidden" name="status" value={toggle.next} />
          <button type="submit" disabled={statusPending} className={SECONDARY_CLASSES}>
            {statusPending ? "…" : toggle.label}
          </button>
        </form>

        {confirming ? (
          <form action={deleteAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="memoryId" value={memoryId} />
            <button type="submit" disabled={deletePending} className={DANGER_CLASSES}>
              {deletePending ? "Suppression…" : `Confirmer la suppression de ${code}`}
            </button>
            <button
              type="button"
              onClick={() => { setConfirming(false); }}
              className={SECONDARY_CLASSES}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => { setConfirming(true); }}
            className={DANGER_CLASSES}
          >
            Delete
          </button>
        )}
      </div>

      {status === PROJECT_MEMORY_STATUS.ACTIVE ? (
        <p className="text-xs leading-relaxed text-zinc-600">{MEMORY_ARCHIVE_NOTICE}</p>
      ) : null}

      {error === null ? null : (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200"
        >
          {error}
        </p>
      )}
    </div>
  );
}
