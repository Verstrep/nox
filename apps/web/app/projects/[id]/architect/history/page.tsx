import { ARCHITECT_SESSION_KIND } from "@nox/shared";
import { getDatabaseClient, listArchitectSessions } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { EmptyState } from "@/components/EmptyState";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { architectExcerpt, architectSessionUrl, architectUrl } from "@/lib/architect/display";
import { formatIsoDateTime } from "@/lib/format";
import { architectSessionStatusLabel } from "@/lib/labels";
import { loadProject } from "@/lib/projects";

/**
 * Conversations Architecte historiques d'un projet.
 *
 * Elles ont ete ouvertes avant TASK-020, quand une conversation servait a
 * concevoir une tache puis se fermait. NOX les conserve telles quelles : elles
 * se relisent, ne se poursuivent pas, et ne sont ni fusionnees ni converties en
 * conversation principale.
 *
 * La conversation principale n'apparait pas dans cette liste. Elle n'est pas un
 * element d'historique : c'est une surface du projet, et elle a son adresse.
 */
export default async function ArchitectHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  await connection();
  const sessions = (await listArchitectSessions(getDatabaseClient(), project.id)).filter(
    (session) => session.kind !== ARCHITECT_SESSION_KIND.PROJECT,
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-6">
        <Link
          href={architectUrl(project.id)}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          &larr; Retour a la conversation du projet
        </Link>
        <h1 className="text-xl font-semibold text-zinc-50">
          Historical Architect conversations
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-zinc-400">
          Ces conversations ont ete ouvertes pour concevoir une tache, selon le modele en vigueur
          avant la conversation de projet. Elles restent lisibles telles quelles ; NOX ne les
          poursuit pas et n&apos;en reconstruit aucune.
        </p>
        <p className="truncate text-sm text-zinc-600">{project.name}</p>
      </header>

      <main className="flex flex-col gap-6">
        <SectionCard
          title="Conversations"
          description="Read-only. Leur tache, leur contexte et leur consommation sont conserves."
        >
          {sessions.length === 0 ? (
            <EmptyState
              title="Aucune conversation historique"
              hint="Ce projet n'a jamais utilise le modele de conception par session. Tout se passe dans sa conversation principale."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {sessions.map((session) => (
                <li key={session.id}>
                  <Link
                    href={architectSessionUrl(project.id, session.id)}
                    className="flex flex-col gap-2 rounded-md border border-zinc-800 px-4 py-3 transition-colors hover:border-zinc-700 hover:bg-zinc-900/40"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono text-xs text-zinc-500">{session.code}</span>
                      <StatusBadge>{architectSessionStatusLabel(session.status)}</StatusBadge>
                      <span className="text-xs text-zinc-600">
                        {formatIsoDateTime(session.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-zinc-400">
                      {architectExcerpt(session.requestText)}
                    </p>
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
