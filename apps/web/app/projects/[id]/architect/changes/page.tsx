import { REPLAN_PROPOSAL_STATUS } from "@nox/shared";
import { getDatabaseClient, listReplanProposals } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { architectUrl } from "@/lib/architect/display";
import { formatIsoDateTime } from "@/lib/format";
import { planUrl } from "@/lib/plan-display";
import { loadProject } from "@/lib/projects";
import { projectChangeUrl, replanStatusLabel } from "@/lib/replan/display";

/**
 * Historique des changements de projet.
 *
 * ## Compact, et deliberement
 *
 * Trois etats — en attente, applique, ecarte —, une date, un motif. Ce n'est pas
 * un tableau de bord d'audit : c'est la reponse a « qu'est-ce qui a ete decide,
 * et quand ». Le detail vit derriere chaque ligne, et le detail technique
 * derriere `Inspect`.
 *
 * ## Elle n'appelle personne
 *
 * Une lecture SQLite. Aucun fournisseur, aucun Claude Code, aucun runner, aucune
 * commande Git — la page fonctionne runner arrete et sans configuration OpenAI.
 */
export default async function ProjectChangesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const proposals = await listReplanProposals(getDatabaseClient(), project.id);
  const pending = proposals.filter(
    (proposal) => proposal.status === REPLAN_PROPOSAL_STATUS.PENDING,
  );
  const settled = proposals.filter(
    (proposal) => proposal.status !== REPLAN_PROPOSAL_STATUS.PENDING,
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href={architectUrl(project.id)}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            &larr; Back to Project Architect
          </Link>
          <Link href={planUrl(project.id)} className="text-xs text-zinc-500 hover:text-zinc-300">
            Project plan
          </Link>
        </div>
        <h1 className="text-2xl font-semibold text-zinc-50">Project changes</h1>
        <p className="truncate text-sm text-zinc-600">{project.name}</p>
        <p className="max-w-prose text-sm leading-relaxed text-zinc-400">
          Chaque changement propose par l&apos;Architecte, avec ce qu&apos;il en est advenu. Un
          changement ecarte reste consultable : ne pas l&apos;avoir retenu est aussi une
          information.
        </p>
      </header>

      <main className="flex flex-col gap-6">
        <SectionCard
          title="En attente"
          description="Au plus un changement a la fois. Tant qu'il attend, l'Architecte n'en proposera pas d'autre."
        >
          {pending.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucun changement en attente.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-800/80">
              {pending.map((proposal) => (
                <li key={proposal.id} className="flex flex-col gap-1.5 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge tone="muted">{replanStatusLabel(proposal.status)}</StatusBadge>
                    <span className="text-xs text-zinc-600">
                      {formatIsoDateTime(proposal.createdAt.toISOString())}
                    </span>
                    {proposal.projectUpdateId === null ? null : (
                      <span className="text-xs text-zinc-600">· Project Plan inclus</span>
                    )}
                    <Link
                      href={projectChangeUrl(project.id, proposal.id)}
                      className="text-xs text-zinc-300 underline hover:text-zinc-100"
                    >
                      Review
                    </Link>
                  </div>
                  <p className="line-clamp-2 text-sm leading-relaxed text-zinc-400">
                    {proposal.rationale}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Historique"
          description="Applique ou ecarte. La proposition d'origine est conservee telle que l'Architecte l'avait rendue."
        >
          {settled.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucun changement traite.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-800/80">
              {settled.map((proposal) => (
                <li key={proposal.id} className="flex flex-col gap-1.5 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge
                      tone={
                        proposal.status === REPLAN_PROPOSAL_STATUS.APPLIED ? "accent" : "neutral"
                      }
                    >
                      {replanStatusLabel(proposal.status)}
                    </StatusBadge>
                    <span className="text-xs text-zinc-600">
                      {formatIsoDateTime(
                        (proposal.appliedAt ?? proposal.dismissedAt ?? proposal.createdAt)
                          .toISOString(),
                      )}
                    </span>
                    <span className="text-xs text-zinc-600">
                      · {String(proposal.targetCount)} tache(s) cible, {String(proposal.newCount)}{" "}
                      nouvelle(s)
                    </span>
                    <Link
                      href={projectChangeUrl(project.id, proposal.id)}
                      className="text-xs text-zinc-300 underline hover:text-zinc-100"
                    >
                      View change
                    </Link>
                  </div>
                  <p className="line-clamp-2 text-sm leading-relaxed text-zinc-400">
                    {proposal.rationale}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </main>
    </div>
  );
}
