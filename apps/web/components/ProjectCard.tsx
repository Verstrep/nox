import type { Project } from "@nox/database";
import Link from "next/link";

import { formatDateTime } from "@/lib/format";

import { StatusBadge } from "./StatusBadge";

export function ProjectCard({ project }: { project: Project }) {
  const updated = project.updatedAt.getTime() !== project.createdAt.getTime();

  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 transition-colors hover:border-zinc-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-zinc-100">{project.name}</h3>
          {project.description === null ? null : (
            <p className="mt-1 max-w-prose text-sm text-zinc-500">{project.description}</p>
          )}
        </div>
        <StatusBadge tone="neutral">{project.status}</StatusBadge>
      </div>

      <p className="mt-3 truncate font-mono text-xs text-zinc-500" title={project.repositoryPath}>
        {project.repositoryPath}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/70 pt-3">
        <span className="text-xs text-zinc-600">
          {updated
            ? `Modifie le ${formatDateTime(project.updatedAt)}`
            : `Cree le ${formatDateTime(project.createdAt)}`}
        </span>
        <Link
          href={`/projects/${project.id}`}
          className="text-xs font-medium text-teal-300 hover:text-teal-200"
        >
          Ouvrir le projet &rarr;
        </Link>
      </div>
    </li>
  );
}
