import { ARCHITECT_LIMITS } from "@nox/shared";
import { getDatabaseClient, listArchitectSessions } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/EmptyState";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { architectExcerpt, architectSessionUrl } from "@/lib/architect/display";
import { formatIsoDateTime } from "@/lib/format";
import { architectSessionStatusLabel } from "@/lib/labels";
import { loadProject } from "@/lib/projects";

import { NewArchitectRequestForm } from "./NewArchitectRequestForm";

/**
 * Demandes Architecte d'un projet.
 *
 * Deux choses seulement : ouvrir une demande, et relire les precedentes. Le
 * travail — contexte, generation, proposition, creation — a lieu sur la page
 * d'une session.
 */
export default async function ArchitectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const sessions = await listArchitectSessions(getDatabaseClient(), project.id);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-6">
        <Link href={`/projects/${project.id}`} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour au projet
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-zinc-50">Architecte</h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-400">
            Decris ce que tu veux construire. L&apos;architecte te repond, pose des questions si
            besoin, et propose une tache que tu pourras relire et modifier avant de la creer.
          </p>
          <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        <SectionCard
          title="Nouvelle conversation"
          description="L'architecte propose ; vous decidez. Rien n'est cree sans votre clic."
        >
          <NewArchitectRequestForm
            projectId={project.id}
            cancelHref={`/projects/${project.id}`}
            maxLength={ARCHITECT_LIMITS.request}
          />
        </SectionCard>

        <SectionCard
          title="Conversations precedentes"
          description="Chaque conversation garde ses messages, ses tours et la tache qu'elle a produite."
        >
          {sessions.length === 0 ? (
            <EmptyState
              title="Aucune conversation"
              hint="Les conversations que vous ouvrirez apparaitront ici, avec leur historique complet."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-800/80">
              {sessions.map((session) => (
                <li key={session.id}>
                  <Link
                    href={architectSessionUrl(project.id, session.id)}
                    className="flex flex-col gap-1.5 py-3 transition-colors hover:bg-zinc-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono text-xs text-zinc-500">{session.code}</span>
                      <StatusBadge>{architectSessionStatusLabel(session.status)}</StatusBadge>
                      <span className="text-xs text-zinc-600">
                        {formatIsoDateTime(session.createdAt)} ·{" "}
                        {session.generationCount === 1
                          ? "1 tour"
                          : `${String(session.generationCount)} tours`}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-300">{architectExcerpt(session.requestText)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </main>
    </div>
  );
}
