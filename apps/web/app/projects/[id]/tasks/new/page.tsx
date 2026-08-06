import Link from "next/link";
import { notFound } from "next/navigation";

import { RunnerStatusBadge } from "@/components/RunnerStatusBadge";
import { loadProject } from "@/lib/projects";

import { NewTaskForm } from "./NewTaskForm";

export default async function NewTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);

  if (project === null) {
    notFound();
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6">
        <Link
          href={`/projects/${project.id}/tasks`}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          &larr; Retour aux taches
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-zinc-50">Nouvelle tache</h1>
            <p className="mt-1 truncate text-sm text-zinc-500">{project.name}</p>
          </div>
          <RunnerStatusBadge />
        </div>

        <p className="max-w-prose text-xs leading-relaxed text-zinc-600">
          Une tache NOX doit se suffire a elle-meme : un agent la lira sans avoir vu la
          conversation qui l&apos;a produite. Son numero est attribue automatiquement et ne change
          plus.
        </p>
      </header>

      <main>
        <NewTaskForm projectId={project.id} />
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs text-zinc-600">
        La tache est enregistree dans la base locale, meme si le runner est arrete : son document
        Markdown pourra etre cree plus tard.
      </footer>
    </div>
  );
}
