import Link from "next/link";
import { notFound } from "next/navigation";

import { DocumentList } from "@/components/DocumentList";
import { DocumentViewer } from "@/components/DocumentViewer";
import { EmptyState } from "@/components/EmptyState";
import { RunnerStatusBadge } from "@/components/RunnerStatusBadge";
import { documentUrl } from "@/lib/document-edit";
import { loadProjectDocument, loadProjectDocuments } from "@/lib/documents";
import { loadProject } from "@/lib/projects";

import { DocumentEditor } from "./DocumentEditor";

/**
 * Bandeau d'erreur.
 *
 * Les messages proviennent de `describeRunnerFailure` : ils ne contiennent ni
 * chemin absolu, ni jeton, ni detail technique.
 */
function ErrorNotice({ title, message }: { title: string; message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-amber-200/80">{message}</p>
    </div>
  );
}

/** Lit un parametre d'URL binaire, tolerant aux valeurs repetees. */
function isFlagSet(value: string | string[] | undefined): boolean {
  return value === "1" || (Array.isArray(value) && value.includes("1"));
}

export default async function ProjectDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const project = await loadProject(id);

  if (project === null) {
    notFound();
  }

  const query = await searchParams;
  const rawPath = query["path"];
  const selectedPath = typeof rawPath === "string" && rawPath !== "" ? rawPath : null;
  const wantsEditing = isFlagSet(query["edit"]);
  const justSaved = isFlagSet(query["saved"]);

  const inventory = await loadProjectDocuments(project.repositoryPath);

  // Le document n'est demande que si un chemin est present dans l'URL. Le runner
  // reste seul juge de sa validite : le web ne pre-filtre pas.
  const opened =
    selectedPath === null ? null : await loadProjectDocument(project.repositoryPath, selectedPath);

  // Le mode edition n'est atteint que sur un document reellement lu : sinon il
  // n'y a ni contenu a modifier, ni revision a comparer.
  const isEditing = wantsEditing && opened !== null && opened.ok;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6">
        <Link href={`/projects/${project.id}`} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour au projet
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-zinc-50">Documents</h1>
            <p className="mt-1 truncate text-sm text-zinc-500">{project.name}</p>
          </div>
          <RunnerStatusBadge />
        </div>

        <p className="max-w-prose text-xs leading-relaxed text-zinc-600">
          NOX inspecte <code className="font-mono text-zinc-500">README.md</code>,{" "}
          <code className="font-mono text-zinc-500">CLAUDE.md</code>,{" "}
          <code className="font-mono text-zinc-500">AGENTS.md</code> a la racine, puis les dossiers{" "}
          <code className="font-mono text-zinc-500">docs/</code>,{" "}
          <code className="font-mono text-zinc-500">decisions/</code>,{" "}
          <code className="font-mono text-zinc-500">plans/</code> et{" "}
          <code className="font-mono text-zinc-500">tasks/</code>. Les documents existants sont
          modifiables ; NOX n&apos;en cree et n&apos;en supprime aucun.
        </p>
      </header>

      <main className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-wider text-zinc-600">
            {inventory.ok ? `${String(inventory.documents.length)} document(s)` : "Inventaire"}
          </h2>

          {inventory.ok ? (
            inventory.documents.length === 0 ? (
              <EmptyState
                title="Aucun document Markdown"
                hint="Ce repository ne contient aucun fichier .md dans les emplacements inspectes par NOX."
              />
            ) : (
              <DocumentList
                projectId={project.id}
                documents={inventory.documents}
                selectedPath={selectedPath}
              />
            )
          ) : (
            <ErrorNotice title="Inventaire indisponible" message={inventory.message} />
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-4">
          {justSaved && !isEditing ? (
            <p
              role="status"
              className="rounded-lg border border-teal-400/30 bg-teal-400/10 px-4 py-2 text-xs text-teal-200"
            >
              Document enregistre dans le repository.
            </p>
          ) : null}

          {opened === null ? (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/30 px-5 py-16 text-center">
              <p className="text-sm text-zinc-400">Aucun document ouvert</p>
              <p className="mx-auto mt-2 max-w-sm text-xs text-zinc-600">
                Selectionnez un document dans la liste pour afficher son contenu brut.
              </p>
            </div>
          ) : !opened.ok ? (
            <ErrorNotice title="Document illisible" message={opened.message} />
          ) : isEditing ? (
            <DocumentEditor projectId={project.id} document={opened.document} />
          ) : (
            <DocumentViewer
              document={opened.document}
              editHref={documentUrl(project.id, opened.document.path, { edit: true })}
            />
          )}
        </section>
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs text-zinc-600">
        NOX affiche et enregistre le contenu brut des fichiers. Aucun document n&apos;est cree,
        supprime ni renomme, et aucune sauvegarde automatique n&apos;a lieu.
      </footer>
    </div>
  );
}
