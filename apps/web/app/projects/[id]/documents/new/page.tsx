import Link from "next/link";
import { notFound } from "next/navigation";

import { RunnerStatusBadge } from "@/components/RunnerStatusBadge";
import { ROOT_DOCUMENT_CHOICES } from "@/lib/document-create";
import { loadProjectDocuments } from "@/lib/documents";
import { loadProject } from "@/lib/projects";

import { NewDocumentForm } from "./NewDocumentForm";

/**
 * Retire de la liste les documents racine deja presents.
 *
 * Proposer `README.md` a la creation dans un repository qui en a deja un ne
 * pourrait mener qu'a un refus : autant ne pas l'offrir. La comparaison ignore
 * la casse, comme le systeme de fichiers de Windows.
 */
function availableRootDocuments(existingPaths: readonly string[]): string[] {
  const taken = new Set(existingPaths.map((documentPath) => documentPath.toLowerCase()));
  return ROOT_DOCUMENT_CHOICES.filter((fileName) => !taken.has(fileName.toLowerCase()));
}

export default async function NewDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);

  if (project === null) {
    notFound();
  }

  // L'inventaire sert uniquement a masquer les documents racine deja presents.
  // Son echec ne bloque pas la creation : le runner reste seul juge, et il
  // refusera un emplacement occupe.
  const inventory = await loadProjectDocuments(project.repositoryPath);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6">
        <Link
          href={`/projects/${project.id}/documents`}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          &larr; Retour aux documents
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-zinc-50">Nouveau document</h1>
            <p className="mt-1 truncate text-sm text-zinc-500">{project.name}</p>
          </div>
          <RunnerStatusBadge />
        </div>

        {inventory.ok ? null : (
          <p
            role="alert"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
          >
            {inventory.message}
          </p>
        )}
      </header>

      <main>
        <NewDocumentForm
          projectId={project.id}
          availableRootDocuments={
            inventory.ok
              ? availableRootDocuments(inventory.documents.map((document) => document.path))
              : []
          }
          inventoryKnown={inventory.ok}
        />
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs text-zinc-600">
        NOX ajoute le fichier au repository. Il ne cree aucun dossier, ne remplace aucun document
        existant, et ne cree aucun commit.
      </footer>
    </div>
  );
}
