import { TASK_STATUS, type TaskStatus } from "@nox/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/EmptyState";
import { RunnerStatusBadge } from "@/components/RunnerStatusBadge";
import { TaskRow } from "@/components/TaskRow";
import { taskStatusLabel } from "@/lib/labels";
import { loadProject } from "@/lib/projects";
import { backlogUrl, countTasksByStatus, readStatusFilter } from "@/lib/task-display";
import { loadProjectDependencyCounts, loadProjectTasks } from "@/lib/tasks";

/**
 * Statuts proposes comme filtres.
 *
 * `RUNNING`, `FAILED` et `REVIEW` en sont absents : aucune tache ne peut les
 * porter tant que NOX ne lance pas Claude Code, et offrir un filtre qui ne
 * renvoie jamais rien laisse croire a une fonctionnalite qui n'existe pas.
 */
const FILTERABLE_STATUSES: readonly TaskStatus[] = [
  TASK_STATUS.DRAFT,
  TASK_STATUS.READY,
  TASK_STATUS.BLOCKED,
  TASK_STATUS.COMPLETED,
];

function FilterLink({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-teal-400/40 bg-teal-400/10 text-teal-200"
          : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
      }`}
    >
      {label} <span className="text-zinc-600">{count}</span>
    </Link>
  );
}

export default async function ProjectTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const project = await loadProject(id);

  if (project === null) {
    notFound();
  }

  const query = await searchParams;
  // Une valeur de filtre inconnue est ignoree : le backlog s'affiche entier
  // plutot que de produire une erreur pour un lien mal recopie.
  const statusFilter = readStatusFilter(query["status"]);

  // Les taches viennent de SQLite : cette page reste consultable runner arrete.
  const tasks = await loadProjectTasks(project.id);
  // Une requete pour toute la liste, jamais une par ligne. Rien n'est persiste :
  // ces compteurs se recalculent a chaque rendu, a partir des statuts courants.
  const dependencyCounts = await loadProjectDependencyCounts(project.id);
  const counts = countTasksByStatus(tasks);
  const visible = statusFilter === null ? tasks : tasks.filter((task) => task.status === statusFilter);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 border-b border-zinc-800 pb-6">
        <Link href={`/projects/${project.id}`} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour au projet
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-zinc-50">Taches</h1>
            <p className="mt-1 truncate text-sm text-zinc-500">{project.name}</p>
          </div>
          <div className="flex items-center gap-3">
            <RunnerStatusBadge />
            <Link
              href={`/projects/${project.id}/tasks/new`}
              className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300"
            >
              Nouvelle tache
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterLink
            href={backlogUrl(project.id)}
            active={statusFilter === null}
            label="Toutes"
            count={tasks.length}
          />
          {FILTERABLE_STATUSES.map((status) => (
            <FilterLink
              key={status}
              href={backlogUrl(project.id, status)}
              active={statusFilter === status}
              label={taskStatusLabel(status)}
              count={counts[status]}
            />
          ))}
        </div>
      </header>

      <main>
        {tasks.length === 0 ? (
          <EmptyState
            title="Aucune tache"
            hint="Une tache NOX porte un objectif, un perimetre et des criteres d'acceptation. Creez la premiere pour commencer a decouper le projet."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="Aucune tache pour ce filtre"
            hint="Aucune tache de ce projet ne porte ce statut. Revenez a la vue complete pour toutes les voir."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((task) => (
              <li key={task.id}>
                <TaskRow
                  projectId={project.id}
                  task={task}
                  dependencies={dependencyCounts.get(task.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs text-zinc-600">
        Les taches sont enregistrees dans la base locale de NOX ; leur document Markdown est ecrit
        dans le repository. Aucune tache n&apos;est executee : NOX ne lance pas encore Claude Code.
      </footer>
    </div>
  );
}
