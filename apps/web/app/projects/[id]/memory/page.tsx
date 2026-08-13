import { PROJECT_MEMORY_STATUS, type ProjectMemoryEntry } from "@nox/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { formatIsoDateTime } from "@/lib/format";
import { projectMemoryCategoryLabel, projectMemoryStatusLabel } from "@/lib/labels";
import { loadProjectMemory } from "@/lib/memory";
import {
  MEMORY_PRIVACY_NOTICE,
  filterMemories,
  formatMemorySize,
  isMemoryBudgetTight,
  memoryEntryUrl,
  memoryUrl,
  newMemoryUrl,
  readMemoryFilter,
  type MemoryFilter,
} from "@/lib/memory-display";
import { loadProject } from "@/lib/projects";

import { MemoryEntryActions } from "./MemoryEntryActions";

const FILTERS: readonly { value: MemoryFilter; label: string }[] = [
  { value: "ACTIVE", label: "Active" },
  { value: "ARCHIVED", label: "Archived" },
  { value: "ALL", label: "All" },
];

/**
 * Une entree, telle que la liste l'affiche.
 *
 * Le contenu est du **texte**, jamais du HTML ni du Markdown rendu : il vient
 * d'un champ libre, et NOX n'interprete pas ce que l'utilisateur y ecrit.
 */
function MemoryCard({
  projectId,
  entry,
}: {
  projectId: string;
  entry: ProjectMemoryEntry;
}) {
  const active = entry.status === PROJECT_MEMORY_STATUS.ACTIVE;

  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-zinc-500">{entry.code}</p>
          <h3 className="mt-1 text-base font-medium text-zinc-100">{entry.title}</h3>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <StatusBadge tone="muted">{projectMemoryCategoryLabel(entry.category)}</StatusBadge>
          <StatusBadge tone={active ? "accent" : "neutral"}>
            {projectMemoryStatusLabel(entry.status)}
          </StatusBadge>
        </div>
      </div>

      <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
        {entry.content}
      </p>

      {entry.rationale === null ? null : (
        <>
          <p className="mt-4 text-xs uppercase tracking-wider text-zinc-600">Justification</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
            {entry.rationale}
          </p>
        </>
      )}

      <p className="mt-4 text-xs text-zinc-600">
        Creee le {formatIsoDateTime(entry.createdAt) ?? "-"} · Modifiee le{" "}
        {formatIsoDateTime(entry.updatedAt) ?? "-"}
      </p>

      <div className="mt-4 border-t border-zinc-800/60 pt-4">
        <MemoryEntryActions
          projectId={projectId}
          memoryId={entry.id}
          code={entry.code}
          status={entry.status}
          editHref={memoryEntryUrl(projectId, entry.id)}
        />
      </div>
    </li>
  );
}

/**
 * Memoire d'un projet.
 *
 * ## Cette page ne depend ni du runner, ni d'OpenAI
 *
 * Tout ce qu'elle affiche vient de SQLite. Elle fonctionne runner arrete, et
 * sans aucune configuration OpenAI : gerer la memoire d'un projet ne doit
 * dependre d'aucun service exterieur.
 *
 * ## Rien n'y est envoye
 *
 * Ouvrir cette page, creer, modifier, archiver ou supprimer une entree ne
 * declenche aucun appel au fournisseur. Les entrees actives partent uniquement
 * quand l'utilisateur declenche explicitement un tour Architecte, et la preview
 * de ce tour les montre alors une par une.
 */
export default async function ProjectMemoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const filter = readMemoryFilter(query["filter"]);

  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const { entries, stats } = await loadProjectMemory(project);
  const visible = filterMemories(entries, filter);
  const tight = isMemoryBudgetTight(stats.activeChars, stats.activeCharsLimit);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 border-b border-zinc-800 pb-6">
        <Link
          href={`/projects/${project.id}`}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          &larr; Retour au projet
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-zinc-50">Project memory</h1>
            <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
          </div>
          <Link
            href={newMemoryUrl(project.id)}
            className="shrink-0 rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300"
          >
            Add memory
          </Link>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        <SectionCard
          title="Active memory"
          description="Ce que NOX retient de ce projet, et ce qui part avec un appel Architecte."
        >
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <p className={`text-2xl font-semibold ${tight ? "text-amber-200" : "text-zinc-100"}`}>
              {formatMemorySize(stats.activeChars)}
              <span className="text-base font-normal text-zinc-500">
                {" "}
                / {formatMemorySize(stats.activeCharsLimit)}
              </span>
            </p>
            <p className="text-sm text-zinc-400">
              {stats.active} Active · {stats.archived} Archived · {stats.total} Total
              <span className="text-zinc-600"> (max {stats.entriesLimit})</span>
            </p>
          </div>

          {tight ? (
            <p
              role="alert"
              className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
            >
              La memoire active approche de sa limite. NOX n&apos;en enverra jamais une partie
              seulement : au-dela, une activation sera refusee plutot que tronquee. Archivez ce qui
              ne sert plus, ou raccourcissez une entree.
            </p>
          ) : null}

          <p className="mt-5 text-xs leading-relaxed text-zinc-600">{MEMORY_PRIVACY_NOTICE}</p>

          <p className="mt-3 text-xs leading-relaxed text-zinc-600">
            Cette memoire appartient a NOX : elle vit dans sa base locale, pas dans le repository.
            Aucune entree n&apos;est ecrite dans un fichier, et aucune n&apos;est commitee. Une
            decision qui doit aussi vivre dans le repository se recopie a la main dans{" "}
            <code className="font-mono">docs/DECISIONS.md</code>.
          </p>
        </SectionCard>

        <SectionCard
          title="Entrees"
          description="Ordre des codes. Seules les entrees actives sont envoyees a l'Architecte."
          action={
            <nav aria-label="Filtrer la memoire" className="flex flex-wrap items-center gap-2">
              {FILTERS.map((entry) => (
                <Link
                  key={entry.value}
                  href={memoryUrl(project.id, entry.value)}
                  aria-current={filter === entry.value ? "true" : undefined}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    filter === entry.value
                      ? "border-zinc-600 bg-zinc-800 text-zinc-100"
                      : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                  }`}
                >
                  {entry.label}
                </Link>
              ))}
            </nav>
          }
        >
          {visible.length === 0 ? (
            <p className="text-sm leading-relaxed text-zinc-500">
              {entries.length === 0
                ? "Aucune entree de memoire. Enregistrez une decision, une contrainte, une convention ou une connaissance durable : elle accompagnera ensuite chaque conversation Architecte de ce projet."
                : "Aucune entree ne correspond a ce filtre."}
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {visible.map((entry) => (
                <MemoryCard key={entry.id} projectId={project.id} entry={entry} />
              ))}
            </ul>
          )}
        </SectionCard>
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        NOX n&apos;ajoute jamais une entree tout seul. Ni depuis une conversation, ni depuis une
        proposition de l&apos;architecte, ni depuis un compte rendu de Claude Code : une hesitation
        exprimee dans une discussion n&apos;est pas une decision.
      </footer>
    </div>
  );
}
