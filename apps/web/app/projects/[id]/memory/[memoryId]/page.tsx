import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { formatIsoDateTime } from "@/lib/format";
import { loadMemoryEntry } from "@/lib/memory";
import { MEMORY_PRIVACY_NOTICE, memoryUrl } from "@/lib/memory-display";
import { loadProject } from "@/lib/projects";

import { MemoryForm } from "../MemoryForm";

/**
 * Modification d'une entree de memoire.
 *
 * Le code et le projet ne sont pas modifiables : `MEM-003` reste `MEM-003`, et
 * une entree ne change jamais de projet. Tout le reste l'est, statut compris —
 * repasser d'`Archived` a `Active` refait le controle du budget, parce que la
 * place peut avoir ete prise entre-temps.
 */
export default async function EditProjectMemoryPage({
  params,
}: {
  params: Promise<{ id: string; memoryId: string }>;
}) {
  const { id, memoryId } = await params;

  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const entry = await loadMemoryEntry(memoryId);
  // La chaine projet → memoire est verifiee entierement : une entree d'un autre
  // projet est introuvable, et l'URL ne permet pas de constater qu'un
  // identifiant existe ailleurs.
  if (entry === null || entry.projectId !== project.id) {
    notFound();
  }

  const back = memoryUrl(project.id);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-6">
        <Link href={back} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour a la memoire
        </Link>
        <div>
          <p className="font-mono text-xs text-zinc-500">{entry.code}</p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-50">Modifier une entree</h1>
          <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        <SectionCard title="Entree">
          <MemoryForm
            projectId={project.id}
            memoryId={entry.id}
            code={entry.code}
            initialValues={{
              category: entry.category,
              title: entry.title,
              content: entry.content,
              rationale: entry.rationale ?? "",
              status: entry.status,
            }}
            cancelHref={back}
          />
        </SectionCard>

        <SectionCard title="Dates">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Creee le</dt>
              <dd className="mt-1 text-sm text-zinc-300">
                {formatIsoDateTime(entry.createdAt) ?? "-"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Modifiee le</dt>
              <dd className="mt-1 text-sm text-zinc-300">
                {formatIsoDateTime(entry.updatedAt) ?? "-"}
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-xs leading-relaxed text-zinc-600">{MEMORY_PRIVACY_NOTICE}</p>
        </SectionCard>
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        Modifier une entree change ce que l&apos;Architecte lira au prochain tour. Le changement
        sera signale dans l&apos;apercu du contexte avant tout envoi.
      </footer>
    </div>
  );
}
