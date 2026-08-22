import type { TaskDependencyLink, TaskDependencySummary } from "@nox/shared";
import Link from "next/link";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { taskStatusLabel } from "@/lib/labels";
import { taskStatusTone, taskUrl } from "@/lib/task-display";

/**
 * Une ligne de dependance : le code, le titre, le statut.
 *
 * Le statut est ce qui rend la ligne utile. « TASK-001 » seul oblige a aller
 * voir ; « TASK-001 · Brouillon » dit deja pourquoi on attend.
 */
function DependencyRow({
  projectId,
  entry,
  showSatisfaction,
}: {
  projectId: string;
  entry: TaskDependencyLink;
  showSatisfaction: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      {showSatisfaction ? (
        <span
          aria-hidden="true"
          className={entry.satisfied ? "text-teal-300" : "text-amber-300"}
        >
          {entry.satisfied ? "✓" : "…"}
        </span>
      ) : null}
      <Link
        href={taskUrl(projectId, entry.id)}
        className="font-mono text-xs text-zinc-400 hover:text-zinc-200"
      >
        {entry.code}
      </Link>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{entry.title}</span>
      <StatusBadge tone={taskStatusTone(entry.status)}>
        {taskStatusLabel(entry.status)}
      </StatusBadge>
    </li>
  );
}

/**
 * Les deux sens du graphe, sur la page d'une tache.
 *
 * `Depends on` porte une contrainte : tant qu'une de ces taches n'est pas
 * terminee, aucune execution ne demarre. `Used by` n'en porte aucune — c'est une
 * information de planification, et la marque de satisfaction y serait trompeuse.
 *
 * La section n'apparait pas quand le graphe est vide autour de cette tache : une
 * carte « Aucune dependance » sur la quasi-totalite des taches ferait defiler
 * pour rien.
 */
export function TaskDependencies({
  projectId,
  dependencies,
  editHref,
}: {
  projectId: string;
  dependencies: TaskDependencySummary;
  /** Lien vers l'editeur, lorsque la tache est encore modifiable. */
  editHref: string | null;
}) {
  if (dependencies.dependsOn.length === 0 && dependencies.dependents.length === 0) {
    return null;
  }

  return (
    <SectionCard
      title="Dependencies"
      description="Une dependance est satisfaite lorsque la tache attendue est terminee."
      action={
        editHref === null ? null : (
          <Link
            href={editHref}
            className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          >
            Modifier
          </Link>
        )
      }
    >
      <div className="flex flex-col gap-6">
        {dependencies.dependsOn.length === 0 ? null : (
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Depends on</p>
            <ul className="mt-3 flex flex-col gap-2">
              {dependencies.dependsOn.map((entry) => (
                <DependencyRow
                  key={entry.id}
                  projectId={projectId}
                  entry={entry}
                  showSatisfaction
                />
              ))}
            </ul>
            <p
              className={`mt-3 text-xs ${
                dependencies.allSatisfied ? "text-zinc-500" : "text-amber-200/90"
              }`}
            >
              {dependencies.allSatisfied
                ? `${String(dependencies.total)} dependance(s), toutes terminees.`
                : `Waiting on ${String(dependencies.unresolved)} task(s) sur ${String(dependencies.total)}.`}
            </p>
          </div>
        )}

        {dependencies.dependents.length === 0 ? null : (
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Used by</p>
            <ul className="mt-3 flex flex-col gap-2">
              {dependencies.dependents.map((entry) => (
                <DependencyRow
                  key={entry.id}
                  projectId={projectId}
                  entry={entry}
                  showSatisfaction={false}
                />
              ))}
            </ul>
            <p className="mt-3 text-xs text-zinc-600">
              Ces taches attendent celle-ci. Tant qu&apos;elles la designent, elle ne peut pas
              etre supprimee.
            </p>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
