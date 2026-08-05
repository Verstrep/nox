import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { loadProjectDocuments } from "@/lib/documents";
import { formatDateTime } from "@/lib/format";
import { loadProject } from "@/lib/projects";

/**
 * Sections encore vides. Elles annoncent ce qui viendra sans simuler de donnees :
 * afficher de fausses taches ou de faux messages rendrait le tableau de bord
 * illisible et ferait croire a des fonctionnalites inexistantes.
 */
const PLANNED_SECTIONS = [
  {
    id: "conversation",
    title: "Conversation",
    description: "Echanger avec l'orchestrateur pour clarifier le besoin de ce projet.",
  },
  {
    id: "tasks",
    title: "Taches",
    description: "Decouper le projet en taches structurees et suivre leur statut.",
  },
  {
    id: "runs",
    title: "Executions",
    description: "Suivre les executions de Claude Code, leurs logs et leurs resultats.",
  },
] as const;

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);

  if (project === null) {
    notFound();
  }

  // L'inventaire est indicatif : son echec n'empeche jamais l'affichage des
  // donnees SQLite du projet, qui ne dependent pas du runner.
  const documents = await loadProjectDocuments(project.repositoryPath);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 border-b border-zinc-800 pb-6">
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour au tableau de bord
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-zinc-50">{project.name}</h1>
            {project.description === null ? (
              <p className="mt-2 text-sm italic text-zinc-600">Aucune description.</p>
            ) : (
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-400">
                {project.description}
              </p>
            )}
          </div>
          <StatusBadge tone="neutral">{project.status}</StatusBadge>
        </div>
      </header>

      <main className="flex flex-col gap-8">
        <SectionCard
          title="Repository"
          description="Chemin canonique retourne par Git lors de l'enregistrement du projet."
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Chemin local</dt>
              <dd className="mt-1 break-all font-mono text-sm text-zinc-300">
                {project.repositoryPath}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Cree le</dt>
              <dd className="mt-1 text-sm text-zinc-300">{formatDateTime(project.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Modifie le</dt>
              <dd className="mt-1 text-sm text-zinc-300">{formatDateTime(project.updatedAt)}</dd>
            </div>
          </dl>

          <p className="mt-5 flex items-center gap-2 rounded-md border border-teal-400/20 bg-teal-400/5 px-3 py-2 text-xs text-teal-200/90">
            <span aria-hidden="true">&#10003;</span>
            Repository Git valide lors de la creation : le chemin ci-dessus est la racine retournee
            par Git.
          </p>
        </SectionCard>

        <SectionCard
          title="Documents"
          description="Documents Markdown de reference presents dans le repository."
          action={
            <Link
              href={`/projects/${project.id}/documents`}
              className="inline-block rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50"
            >
              Voir les documents
            </Link>
          }
        >
          {documents.ok ? (
            <p className="text-sm text-zinc-400">
              {documents.documents.length === 0
                ? "Aucun document Markdown trouve dans les emplacements inspectes."
                : `${String(documents.documents.length)} document(s) Markdown detecte(s).`}
            </p>
          ) : (
            <p className="text-sm text-amber-200/90">{documents.message}</p>
          )}
        </SectionCard>

        <div className="grid gap-4 sm:grid-cols-2">
          {PLANNED_SECTIONS.map((section) => (
            <section
              key={section.id}
              className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/30 p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-zinc-300">{section.title}</h2>
                <StatusBadge tone="muted">A venir</StatusBadge>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-zinc-600">{section.description}</p>
            </section>
          ))}
        </div>
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs text-zinc-600">
        Les sections marquees « A venir » seront ajoutees dans les prochaines etapes. Aucune donnee
        n&apos;y est simulee.
      </footer>
    </div>
  );
}
