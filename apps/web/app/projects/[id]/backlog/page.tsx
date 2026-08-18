import { ARCHITECT_BACKLOG_GENERATION_STATUS } from "@nox/shared";
import { getDatabaseClient } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { architectUrl } from "@/lib/architect/display";
import { loadBacklogInput, loadProjectBacklogView } from "@/lib/backlog";
import {
  BACKLOG_STALE_MESSAGE,
  BACKLOG_UNKNOWN_FRESHNESS_MESSAGE,
  backlogContextUrl,
  backlogCreatedCountLabel,
  backlogReviewUrl,
  backlogStateLabel,
  backlogTaskCountLabel,
  type BacklogSurfaceState,
} from "@/lib/backlog/display";
import { isBacklogProposalStale } from "@/lib/backlog/service";
import { formatIsoDateTime } from "@/lib/format";
import { planUrl } from "@/lib/plan-display";
import { loadStructuredState } from "@/lib/project-plan";
import { loadProject } from "@/lib/projects";
import { taskUrl } from "@/lib/task-display";

import { DismissBacklogButton } from "./DismissBacklogButton";
import { GenerateBacklogButton } from "./GenerateBacklogButton";

function stateBadge(state: BacklogSurfaceState): ReactNode {
  if (state === "proposal_ready" || state === "applied") {
    return <StatusBadge tone="accent">{backlogStateLabel(state)}</StatusBadge>;
  }
  if (state === "not_generated" || state === "dismissed") {
    return <StatusBadge tone="neutral">{backlogStateLabel(state)}</StatusBadge>;
  }
  return <StatusBadge tone="muted">{backlogStateLabel(state)}</StatusBadge>;
}

/**
 * Le backlog de V1 d'un projet.
 *
 * ## Ouvrir cette page ne coute rien
 *
 * Zero appel a OpenAI, zero execution de Claude Code, zero ecriture. Tout
 * l'etat affiche vient de SQLite : la page fonctionne runner arrete, et son
 * bouton `Generate` y explique quand meme ce qu'il coute.
 *
 * ## La seule sonde autorisee
 *
 * Quand — et seulement quand — un backlog attend une decision, NOX relit le
 * repository pour dire s'il est encore fonde. C'est une lecture, elle sert
 * directement a ce qui est affiche, et son echec produit « je ne sais pas »
 * plutot qu'une fraicheur affirmee sans preuve.
 *
 * ## Elle ne fait rien toute seule
 *
 * Aucune generation n'est declenchee par un rendu, par un plan enregistre, par
 * une tache terminee ou par un retour sur le projet. Un backlog part d'un clic.
 */
export default async function ProjectBacklogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const db = getDatabaseClient();
  const [backlog, structured] = await Promise.all([
    loadProjectBacklogView(project.id),
    loadStructuredState(db, project),
  ]);

  const planDefined = structured.plan.present;

  // La fraicheur n'est calculee que si elle sert : une proposition en attente.
  // `null` veut dire « je ne sais pas », et la page le dit.
  let stale: boolean | null = null;
  if (backlog.pending !== null && backlog.pendingGeneration !== null) {
    const input = await loadBacklogInput(db, project);
    stale = input.ok
      ? await isBacklogProposalStale({
          ...input.input,
          baseFingerprint: backlog.pendingGeneration.base.planningFingerprint,
        })
      : null;
  }

  const state: BacklogSurfaceState =
    backlog.running !== null
      ? "generating"
      : backlog.pending !== null
        ? stale === true
          ? "stale"
          : "proposal_ready"
        : backlog.lastApplied !== null
          ? "applied"
          : backlog.history.some(
                (generation) =>
                  generation.status === ARCHITECT_BACKLOG_GENERATION_STATUS.READY,
              )
            ? "dismissed"
            : "not_generated";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 border-b border-zinc-800 pb-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href={`/projects/${project.id}`} className="text-xs text-zinc-500 hover:text-zinc-300">
            &larr; Retour au projet
          </Link>
          <Link href={planUrl(project.id)} className="text-xs text-zinc-500 hover:text-zinc-300">
            Project plan
          </Link>
          <Link href={architectUrl(project.id)} className="text-xs text-zinc-500 hover:text-zinc-300">
            Project Architect
          </Link>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-zinc-50">V1 Backlog</h1>
            <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
          </div>
          {stateBadge(state)}
        </div>

        <p className="max-w-prose text-sm leading-relaxed text-zinc-500">
          Le travail d&apos;implementation restant pour atteindre le Living V1 Plan valide. Le plan
          dit la cible ; le backlog dit les increments qui y menent. Aucune tache n&apos;est creee
          tant que vous n&apos;avez pas applique un backlog vous-meme.
        </p>
      </header>

      <main className="flex flex-col gap-8">
        {backlog.running === null ? null : (
          <div
            role="status"
            className="rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm leading-relaxed text-zinc-400"
          >
            <p className="font-medium text-zinc-200">Generating backlog…</p>
            <p className="mt-2">
              {backlog.running.code} est parti le{" "}
              {formatIsoDateTime(backlog.running.createdAt) ?? "-"}. Rechargez la page dans un
              instant : rafraichir ne relance aucun appel.
            </p>
          </div>
        )}

        {backlog.pending === null ? null : (
          <SectionCard
            title="Backlog proposal"
            description="Relisez chaque tache avant de l'appliquer. Vous pouvez en modifier, en deplacer et en retirer."
            action={
              <StatusBadge tone={stale === true ? "muted" : "accent"}>
                {backlogTaskCountLabel(backlog.pending.taskCount)}
              </StatusBadge>
            }
          >
            <div className="flex flex-col gap-5">
              {stale === true ? (
                <p
                  role="alert"
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
                >
                  {BACKLOG_STALE_MESSAGE}
                </p>
              ) : null}

              {stale === null ? (
                <p className="rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm leading-relaxed text-zinc-500">
                  {BACKLOG_UNKNOWN_FRESHNESS_MESSAGE}
                </p>
              ) : null}

              <p className="max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
                {backlog.pending.message}
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={backlogReviewUrl(project.id, backlog.pending.id)}
                  className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300"
                >
                  Review backlog
                </Link>
                <span className="text-xs text-zinc-600">
                  Proposee le {formatIsoDateTime(backlog.pending.createdAt) ?? "-"}
                  {backlog.pendingGeneration === null
                    ? ""
                    : ` · ${backlog.pendingGeneration.code}`}
                </span>
              </div>

              <div className="border-t border-zinc-800 pt-5">
                <DismissBacklogButton projectId={project.id} proposalId={backlog.pending.id} />
              </div>
            </div>
          </SectionCard>
        )}

        {backlog.pending === null && backlog.running === null ? (
          <SectionCard
            title="Generate a backlog"
            description="Une action explicite, qui engage un appel au fournisseur."
          >
            {planDefined ? (
              <div className="flex flex-col gap-4">
                <p className="max-w-prose text-sm leading-relaxed text-zinc-500">
                  L&apos;Architecte lira le Project Brief, le Living V1 Plan, la memoire du projet,
                  les taches deja enregistrees et la documentation du repository, puis proposera le
                  backlog des taches restantes.
                </p>
                <GenerateBacklogButton projectId={project.id} />
                <Link
                  href={backlogContextUrl(project.id)}
                  className="self-start text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
                >
                  Inspect planning context
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <p className="max-w-prose text-sm leading-relaxed text-zinc-500">
                  Ce projet n&apos;a pas encore de Living V1 Plan. Sans cible validee, un backlog
                  n&apos;aurait rien a atteindre : definissez le plan d&apos;abord.
                </p>
                <Link
                  href={planUrl(project.id)}
                  className="self-start rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition-colors hover:border-zinc-500 hover:text-zinc-50"
                >
                  Open Project Plan
                </Link>
              </div>
            )}
          </SectionCard>
        ) : null}

        {backlog.lastApplied === null ? null : (
          <SectionCard
            title="Applied backlog"
            description="Les taches creees, dans l'ordre que vous avez valide."
            action={
              <StatusBadge tone="accent">
                {backlogCreatedCountLabel(backlog.lastAppliedTasks.length)}
              </StatusBadge>
            }
          >
            <div className="flex flex-col gap-5">
              <p className="text-sm text-emerald-200">
                <span aria-hidden="true">✓ </span>
                {"V1 backlog applied"}
                {" · "}
                {formatIsoDateTime(backlog.lastApplied.appliedAt ?? "") ?? "-"}
              </p>

              {backlog.lastAppliedTasks.length === 0 ? (
                <p className="text-sm italic text-zinc-600">Aucune tache rattachee.</p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {backlog.lastAppliedTasks.map((task, index) => (
                    <li key={task.id} className="flex items-baseline gap-3 text-sm">
                      <span className="w-6 shrink-0 text-right text-xs text-zinc-600">
                        {index + 1}.
                      </span>
                      <Link
                        href={taskUrl(project.id, task.id)}
                        className="font-mono text-xs text-teal-300 hover:text-teal-200"
                      >
                        {task.code}
                      </Link>
                      <span className="min-w-0 flex-1 truncate text-zinc-300">{task.title}</span>
                      <StatusBadge tone="muted">{task.status}</StatusBadge>
                    </li>
                  ))}
                </ol>
              )}

              <Link
                href={`/projects/${project.id}`}
                className="self-start rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition-colors hover:border-zinc-500 hover:text-zinc-50"
              >
                Open tasks
              </Link>
            </div>
          </SectionCard>
        )}

        {backlog.history.length === 0 ? null : (
          <SectionCard
            title="Previous backlog proposals"
            description="Chaque planification, avec ce qu'elle a consomme."
          >
            <ul className="flex flex-col gap-3">
              {backlog.history.map((generation) => (
                <li
                  key={generation.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-zinc-800/60 pb-3 text-sm last:border-0 last:pb-0"
                >
                  <span className="font-mono text-xs text-zinc-400">{generation.code}</span>
                  <span className="text-xs text-zinc-500">{generation.status}</span>
                  <span className="text-xs text-zinc-600">{generation.model}</span>
                  <span className="text-xs text-zinc-600">
                    {generation.usage.totalTokens === null
                      ? "jetons non fournis"
                      : `${String(generation.usage.totalTokens)} jetons`}
                  </span>
                  <span className="text-xs text-zinc-600">
                    {formatIsoDateTime(generation.createdAt) ?? "-"}
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        Un backlog est une proposition. Seule une application explicite cree des taches, et elles
        sont toujours creees en <span className="font-mono">DRAFT</span> : NOX ne lance ni Claude
        Code, ni commit, ni push.
      </footer>
    </div>
  );
}
