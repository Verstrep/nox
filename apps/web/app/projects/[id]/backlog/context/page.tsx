import { getDatabaseClient } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { loadBacklogInput } from "@/lib/backlog";
import { backlogUrl } from "@/lib/backlog/display";
import { prepareProjectBacklog } from "@/lib/backlog/service";
import { formatPlanSize } from "@/lib/plan-display";
import { loadProject } from "@/lib/projects";

/**
 * Inspection du contexte de planification.
 *
 * ## Elle coute zero appel, et n'autorise rien
 *
 * Elle montre le texte **exact** qui partirait — pas un resume, pas une
 * approximation — parce qu'elle appelle la meme fonction que la generation.
 * Afficher un contexte construit autrement reviendrait a mentir sur la seule
 * page dont le role est de dire la verite.
 *
 * Elle n'est pas un passage oblige : le parcours normal est un clic sur
 * `Generate`. Une inspection perimee ne bloque donc rien — la generation part
 * avec le contexte du jour, jamais avec celui d'alors.
 */
export default async function BacklogContextPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const input = await loadBacklogInput(getDatabaseClient(), project);
  const prepared = input.ok ? await prepareProjectBacklog(input.input) : null;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 border-b border-zinc-800 pb-6">
        <Link href={backlogUrl(project.id)} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Back to V1 Backlog
        </Link>

        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-50">Planning context</h1>
          <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
        </div>

        <p className="max-w-prose text-sm leading-relaxed text-zinc-500">
          Ce que l&apos;Architecte recevrait si vous generiez un backlog maintenant. Ouvrir cette
          page ne consomme aucun appel.
        </p>
      </header>

      <main className="flex flex-col gap-8">
        {input.ok ? null : (
          <p
            role="alert"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
          >
            L&apos;Architecte n&apos;est pas configure : {input.missing.join(", ")} manque.
          </p>
        )}

        {input.ok && prepared !== null && !prepared.ok ? (
          <p
            role="alert"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
          >
            Le repository n&apos;a pas pu etre relu. Verifiez que le runner tourne.
          </p>
        ) : null}

        {prepared !== null && prepared.ok ? (
          <>
            <SectionCard
              title="Sources"
              description="Ce qui part, avec sa revision et sa taille. Rien d'autre n'est candidat."
              action={<StatusBadge tone="muted">{formatPlanSize(prepared.prepared.manifest.totalChars)}</StatusBadge>}
            >
              <dl className="flex flex-col gap-2">
                {prepared.prepared.manifest.sources.map((source) => (
                  <div
                    key={`${source.kind}-${source.identifier}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-zinc-800/60 pb-2 text-sm last:border-0 last:pb-0"
                  >
                    <dt className="min-w-0 flex-1 truncate text-zinc-300">
                      <span className="mr-2 text-xs uppercase tracking-wider text-zinc-600">
                        {source.kind}
                      </span>
                      {source.identifier}
                    </dt>
                    <dd className="text-xs text-zinc-600">
                      {formatPlanSize(source.includedChars)}
                      {source.truncated ? " · Truncated" : ""}
                      {source.revision === null ? "" : ` · ${source.revision.slice(0, 12)}`}
                    </dd>
                  </div>
                ))}
              </dl>

              {prepared.prepared.manifest.missing.length === 0 ? null : (
                <p className="mt-4 text-xs leading-relaxed text-zinc-600">
                  Absents du repository : {prepared.prepared.manifest.missing.join(", ")}.
                </p>
              )}
            </SectionCard>

            <SectionCard title="Appel" description="Le modele et la version de prompt utilises.">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">Model</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-300">{input.ok ? input.input.model : "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">Prompt version</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-300">
                    {prepared.prepared.prompt.version}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">
                    Task inventory revision
                  </dt>
                  <dd className="mt-1 font-mono text-xs text-zinc-500">
                    {prepared.prepared.base.taskInventoryRevision.slice(0, 16)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">
                    Planning fingerprint
                  </dt>
                  <dd className="mt-1 font-mono text-xs text-zinc-500">
                    {prepared.prepared.base.planningFingerprint.slice(0, 16)}
                  </dd>
                </div>
              </dl>
            </SectionCard>

            <SectionCard
              title="Texte exact"
              description="Les instructions, puis le contexte. C'est ce qui partirait, mot pour mot."
            >
              <div className="flex flex-col gap-4">
                <details className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
                  <summary className="cursor-pointer text-sm text-zinc-300">Instructions</summary>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-zinc-400">
                    {prepared.prepared.prompt.instructions}
                  </pre>
                </details>
                <details className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
                  <summary className="cursor-pointer text-sm text-zinc-300">Contexte</summary>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-zinc-400">
                    {prepared.prepared.prompt.input}
                  </pre>
                </details>
              </div>
            </SectionCard>
          </>
        ) : null}
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        Cette page ne consomme aucun appel et n&apos;autorise rien. Elle ne conditionne pas la
        generation : un contexte modifie apres son affichage ne bloque pas — c&apos;est le contexte
        du jour qui partira.
      </footer>
    </div>
  );
}
