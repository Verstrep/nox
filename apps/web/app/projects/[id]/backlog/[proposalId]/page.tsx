import { ARCHITECT_BACKLOG_PROPOSAL_STATUS } from "@nox/shared";
import {
  getBacklogGeneration,
  getBacklogProposal,
  getDatabaseClient,
  listBacklogTasks,
} from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { loadBacklogInput } from "@/lib/backlog";
import {
  BACKLOG_STALE_MESSAGE,
  BACKLOG_UNKNOWN_FRESHNESS_MESSAGE,
  backlogProposalStatusLabel,
  backlogTaskCountLabel,
  backlogUrl,
} from "@/lib/backlog/display";
import {
  backlogProposalToFormValues,
  isBacklogProposalStale,
} from "@/lib/backlog/service";
import { formatIsoDateTime } from "@/lib/format";
import { loadProject } from "@/lib/projects";
import { taskUrl } from "@/lib/task-display";

import { DismissBacklogButton } from "../DismissBacklogButton";
import { BacklogReview } from "./BacklogReview";

/**
 * Revue d'un backlog propose.
 *
 * ## Elle n'appelle pas le fournisseur
 *
 * Ouvrir cette page, relire, editer, reordonner, retirer, appliquer ou
 * ecarter : aucun appel a OpenAI, aucune execution de Claude Code. La seule
 * requete sortante est la relecture du repository, qui sert a dire si le
 * backlog est encore fonde et a verifier les destinations avant application.
 *
 * ## Un backlog perime reste lisible
 *
 * Il n'est ni ecarte d'office, ni fusionne avec l'etat actuel. NOX dit ce qui
 * s'est passe et laisse l'utilisateur decider : il n'existe aucun bouton
 * « fusionner », et aucun chemin de code allant d'un conflit vers un nouvel
 * appel.
 */
export default async function BacklogReviewPage({
  params,
}: {
  params: Promise<{ id: string; proposalId: string }>;
}) {
  const { id, proposalId } = await params;

  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const db = getDatabaseClient();

  // L'appartenance au projet est verifiee ici : une proposition d'un autre
  // projet est introuvable, jamais « refusee » — distinguer les deux
  // confirmerait son existence.
  const proposal = await getBacklogProposal(db, project.id, proposalId);
  if (proposal === null) {
    notFound();
  }

  const generation = await getBacklogGeneration(db, proposal.generationId);
  const pending = proposal.status === ARCHITECT_BACKLOG_PROPOSAL_STATUS.PENDING;

  let stale: boolean | null = null;
  if (pending && generation !== null) {
    const input = await loadBacklogInput(db, project);
    stale = input.ok
      ? await isBacklogProposalStale({
          ...input.input,
          baseFingerprint: generation.base.planningFingerprint,
        })
      : null;
  }

  // Le formulaire part de ce que le fournisseur a propose ; `providerJson` n'est
  // jamais touche. Une proposition deja appliquee affiche, elle, ce que
  // l'humain avait retenu — les deux repondent a deux questions differentes.
  const source = proposal.applied ?? proposal.provided;
  const initialItems = backlogProposalToFormValues(proposal.provided);
  const createdTasks = pending ? [] : await listBacklogTasks(db, proposal.id);

  const backHref = backlogUrl(project.id);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 border-b border-zinc-800 pb-6">
        <Link href={backHref} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Back to V1 Backlog
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-zinc-50">V1 Backlog proposal</h1>
            <p className="mt-1 truncate text-sm text-zinc-600">
              {project.name}
              {generation === null ? "" : ` · ${generation.code}`}
            </p>
          </div>
          <StatusBadge
            tone={proposal.status === ARCHITECT_BACKLOG_PROPOSAL_STATUS.APPLIED ? "accent" : "muted"}
          >
            {backlogProposalStatusLabel(proposal.status)}
          </StatusBadge>
        </div>

        <div>
          <h2 className="text-xs uppercase tracking-wider text-zinc-600">
            Ce que ce decoupage couvre
          </h2>
          <p className="mt-1.5 max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
            {source.message}
          </p>
        </div>

        <p className="text-xs text-zinc-600">
          Proposee le {formatIsoDateTime(proposal.createdAt) ?? "-"} ·{" "}
          {backlogTaskCountLabel(proposal.provided.tasks.length)}
        </p>
      </header>

      <main className="flex flex-col gap-8">
        {pending && stale === true ? (
          <div
            role="alert"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
          >
            <p className="font-medium">{BACKLOG_STALE_MESSAGE}</p>
            <p className="mt-2">
              NOX ne fusionne jamais deux etats tout seul. Vous pouvez ecarter ce backlog, puis en
              generer un nouveau depuis l&apos;etat actuel du projet.
            </p>
          </div>
        ) : null}

        {pending && stale === null ? (
          <p className="rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm leading-relaxed text-zinc-500">
            {BACKLOG_UNKNOWN_FRESHNESS_MESSAGE}
          </p>
        ) : null}

        {proposal.status === ARCHITECT_BACKLOG_PROPOSAL_STATUS.APPLIED ? (
          <SectionCard
            title="Applied"
            description="Les taches creees, dans l'ordre que vous aviez valide."
          >
            <div className="flex flex-col gap-5">
              <p className="text-sm text-emerald-200">
                <span aria-hidden="true">✓ </span>
                {"V1 backlog applied"} · {formatIsoDateTime(proposal.appliedAt ?? "") ?? "-"}
              </p>
              <ol className="flex flex-col gap-2">
                {createdTasks.map((task, index) => (
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
            </div>
          </SectionCard>
        ) : null}

        {proposal.status === ARCHITECT_BACKLOG_PROPOSAL_STATUS.DISMISSED ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm leading-relaxed text-zinc-400">
            {"V1 backlog dismissed"} · {formatIsoDateTime(proposal.dismissedAt ?? "") ?? "-"}. Aucune tache
            n&apos;a ete creee.
          </div>
        ) : null}

        {pending ? (
          <>
            <SectionCard
              title="Proposed tasks"
              description="Modifiez, deplacez ou retirez avant d'appliquer. C'est votre version qui sera creee."
              action={<StatusBadge tone="muted">{backlogTaskCountLabel(initialItems.length)}</StatusBadge>}
            >
              <BacklogReview
                projectId={project.id}
                proposalId={proposal.id}
                initialItems={initialItems}
                cancelHref={backHref}
                blocked={stale !== false}
              />
            </SectionCard>

            <div className="border-t border-zinc-800 pt-6">
              <DismissBacklogButton projectId={project.id} proposalId={proposal.id} />
            </div>
          </>
        ) : (
          <SectionCard
            title="Ce que l'Architecte avait propose"
            description="Le payload d'origine, conserve tel quel."
          >
            <ol className="flex flex-col gap-3">
              {proposal.provided.tasks.map((task, index) => (
                <li key={`${String(index)}-${task.title}`} className="flex items-baseline gap-3">
                  <span className="w-6 shrink-0 text-right text-xs text-zinc-600">{index + 1}.</span>
                  <span className="min-w-0 flex-1 text-sm text-zinc-300">{task.title}</span>
                  <StatusBadge tone="muted">{task.priority}</StatusBadge>
                </li>
              ))}
            </ol>
          </SectionCard>
        )}
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        Un backlog propose ne cree jamais de tache tout seul. Appliquer les cree en{" "}
        <span className="font-mono">DRAFT</span> et ecrit leur document Markdown ; NOX ne lance ni
        Claude Code, ni <span className="font-mono">git add</span>, ni commit, ni push.
      </footer>
    </div>
  );
}
