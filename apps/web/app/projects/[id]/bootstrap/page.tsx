import { getDatabaseClient } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { backlogUrl } from "@/lib/backlog/display";
import { loadBootstrapInput } from "@/lib/bootstrap";
import {
  BOOTSTRAP_FREE_NOTICE,
  BOOTSTRAP_INTRODUCTION,
  bootstrapBlockerMessage,
  bootstrapStateLabel,
} from "@/lib/bootstrap/display";
import { bootstrapBlockers } from "@/lib/bootstrap/service";
import { formatIsoDateTime } from "@/lib/format";
import { taskStatusLabel } from "@/lib/labels";
import { planUrl } from "@/lib/plan-display";
import { loadProject } from "@/lib/projects";
import { taskUrl } from "@/lib/task-display";

/**
 * Amorcage d'un projet.
 *
 * ## Ouvrir cette page ne coute rien, et ne sonde rien
 *
 * Zero appel a OpenAI, zero execution de Claude Code, zero lecture du
 * repository. Tout ce qui est affiche ici vient de SQLite : la page fonctionne
 * runner arrete, et dit alors ce qu'elle sait plutot que d'echouer.
 *
 * L'inspection du repository — la seule lecture necessaire — vit sur la page
 * d'apercu, ou elle sert directement a ce qui est montre.
 *
 * ## Aucun second cycle de vie
 *
 * Des que `TASK-000` existe, c'est **son** statut qui est affiche. NOX ne tient
 * aucune machine a etats d'amorcage en parallele de celle des taches : deux
 * verites finiraient par se contredire.
 */
export default async function ProjectBootstrapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const input = await loadBootstrapInput(getDatabaseClient(), project);
  const task = input.existingTask;
  const blockers = bootstrapBlockers(input);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <Link href={`/projects/${project.id}`} className="text-xs text-zinc-500 hover:text-zinc-300">
          ← {project.name}
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-100">Project Bootstrap</h1>
        <p className="max-w-prose text-sm leading-relaxed text-zinc-500">
          {BOOTSTRAP_INTRODUCTION}
        </p>
      </header>

      {task === null ? (
        <SectionCard
          title="TASK-000"
          description="La tache d'amorcage n'existe pas encore."
          action={
            <StatusBadge tone={blockers.length === 0 ? "accent" : "neutral"}>
              {bootstrapStateLabel(blockers.length === 0 ? "available" : "blocked")}
            </StatusBadge>
          }
        >
          {blockers.length > 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-zinc-400">
                L&apos;amorcage prepare le repository pour des taches produit deja validees. Il
                attend donc que le projet soit decrit et son backlog applique.
              </p>
              <ul className="flex flex-col gap-2">
                {blockers.map((blocker) => (
                  <li
                    key={blocker}
                    className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
                  >
                    {bootstrapBlockerMessage(blocker)}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link
                  href={planUrl(project.id)}
                  className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
                >
                  Project plan
                </Link>
                <Link
                  href={backlogUrl(project.id)}
                  className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
                >
                  V1 Backlog
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-zinc-400">
                Tout est reuni. L&apos;apercu montre exactement la tache qui sera creee, construite
                a partir du brief, du plan de V1, de la memoire active, des taches deja
                enregistrees et de l&apos;etat du repository.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/projects/${project.id}/bootstrap/preview`}
                  className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300"
                >
                  Preview TASK-000
                </Link>
                <p className="text-xs text-zinc-500">{BOOTSTRAP_FREE_NOTICE}</p>
              </div>
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard
          title={task.code}
          description={task.title}
          action={<StatusBadge tone="accent">{bootstrapStateLabel("prepared")}</StatusBadge>}
        >
          <div className="flex flex-col gap-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wider text-zinc-500">Statut</dt>
                <dd className="mt-1 text-zinc-200">{taskStatusLabel(task.status)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-zinc-500">Type</dt>
                <dd className="mt-1 text-zinc-200">Bootstrap</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-zinc-500">Document</dt>
                <dd className="mt-1 font-mono text-xs text-zinc-400">{task.documentPath}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-zinc-500">Creee le</dt>
                <dd className="mt-1 text-zinc-400">{formatIsoDateTime(task.createdAt)}</dd>
              </div>
            </dl>

            <p className="text-sm leading-relaxed text-zinc-500">
              Un projet ne possede qu&apos;une tache d&apos;amorcage. Elle suit le cycle de vie
              habituel : relecture, <span className="font-mono">Mark ready</span>, puis execution
              explicite.
            </p>

            <div>
              <Link
                href={taskUrl(project.id, task.id)}
                className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300"
              >
                Open task
              </Link>
            </div>
          </div>
        </SectionCard>
      )}
    </main>
  );
}
