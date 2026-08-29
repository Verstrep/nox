import Link from "next/link";

import { formatDateTime } from "@/lib/format";
import {
  breakdownLabel,
  executionBadgeLabel,
  executionTone,
  taskTotalLabel,
  waitingLabel,
  type ProjectCard as Card,
} from "@/lib/project-dashboard";
import { queuedCountLabel } from "@/lib/queue-display";
import { taskStatusTone } from "@/lib/task-display";

import { StatusBadge } from "./StatusBadge";

/**
 * Carte d'un projet sur le tableau de bord.
 *
 * Elle repond a cinq questions et s'arrete la : de quel projet s'agit-il, a
 * quoi sert-il, que fait-il en ce moment, ou en est son travail, comment
 * l'ouvrir. Le chemin du repository y figure en second plan — utile pour
 * reconnaitre un projet parmi plusieurs, jamais assez pour dominer la carte.
 *
 * Depuis TASK-031, plusieurs cartes peuvent afficher « Claude running » au meme
 * instant : chaque projet decrit **son** travail, et aucune carte ne pretend
 * decrire ce que fait NOX dans son ensemble.
 *
 * Tout ce qu'elle affiche est derive : aucun compteur, aucun etat d'avancement
 * et aucune « progression » n'est stocke en base.
 */
export function ProjectCard({ card }: { card: Card }) {
  const waiting = waitingLabel(card.waitingOnDependencies);
  // Une ligne « 0 queued » sur chaque carte serait du bruit : la file ne se
  // signale que lorsqu'elle contient quelque chose.
  const queued = queuedCountLabel(card.queuedCount);

  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-950/40 transition-colors hover:border-zinc-700">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-medium text-zinc-100">
              <Link
                href={`/projects/${card.id}`}
                className="rounded-sm hover:text-teal-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
              >
                {card.name}
              </Link>
            </h3>
            {card.summary === null ? (
              <p className="mt-1 text-sm italic text-zinc-600">Brief not defined yet</p>
            ) : (
              <p className="mt-1 max-w-prose text-sm leading-relaxed text-zinc-400">
                {card.summary}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <StatusBadge
              tone={executionTone(card.execution.state)}
              withDot={
                card.execution.state === "RUNNING" ||
                card.execution.state === "CORRECTING" ||
                card.execution.state === "VALIDATING"
              }
            >
              {executionBadgeLabel(card.execution)}
            </StatusBadge>
            <StatusBadge tone="muted">{card.status}</StatusBadge>
          </div>
        </div>

        <dl className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <div className="flex items-center gap-2">
            <dt className="text-xs uppercase tracking-wider text-zinc-600">Tasks</dt>
            <dd className="text-zinc-300">{taskTotalLabel(card.taskTotal)}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-xs uppercase tracking-wider text-zinc-600">Bootstrap</dt>
            <dd className="text-zinc-300">{card.bootstrapLabel}</dd>
          </div>
          {queued === null ? null : (
            <div className="flex items-center gap-2">
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Queue</dt>
              <dd className="text-zinc-300">
                {queued} · {card.queueActive ? "Active" : "Paused"}
              </dd>
            </div>
          )}
          <div className="flex items-center gap-2">
            <dt className="text-xs uppercase tracking-wider text-zinc-600">Git</dt>
            <dd className="text-zinc-300">{card.deliveryLabel}</dd>
          </div>
        </dl>

        {card.breakdown.length === 0 ? null : (
          <ul className="flex flex-wrap items-center gap-2">
            {card.breakdown.map((entry) => (
              <li key={entry.status}>
                <StatusBadge tone={taskStatusTone(entry.status)}>
                  {breakdownLabel(entry)}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}

        {waiting === null ? null : <p className="text-xs text-amber-200/80">{waiting}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/70 px-5 py-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-zinc-600" title={card.repositoryPath}>
            {card.repositoryPath}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Dernière activité le {formatDateTime(card.lastActivityAt)}
          </p>
        </div>
        <Link
          href={`/projects/${card.id}`}
          className="shrink-0 rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
        >
          Open project
        </Link>
      </div>
    </li>
  );
}
