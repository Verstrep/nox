import { getDatabaseClient, listOwnedTaskArtifacts, projectHasActiveRun } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { formatDateTime } from "@/lib/format";
import { PROJECT_ACTIVE_RUN_MESSAGE, projectSettingsUrl } from "@/lib/project-delete";
import { loadProject } from "@/lib/projects";

import { DeleteProjectForm } from "./DeleteProjectForm";
import { RenameProjectForm } from "./RenameProjectForm";

/**
 * Reglages d'un projet, et sa zone dangereuse.
 *
 * ## Pourquoi une page separee
 *
 * Renommer et supprimer sont des gestes de cycle de vie, pas des etapes du
 * travail. Les poser au milieu du brief, du backlog et des taches les mettrait a
 * portee d'un clic distrait — et surtout, cela melangerait « ce que je fais
 * aujourd'hui » avec « ce que je fais de ce projet ».
 *
 * ## Ce que cette page coute
 *
 * Trois lectures SQLite. Aucun appel au fournisseur, aucun Claude Code, aucune
 * commande Git, et le runner n'est pas interroge : la page s'affiche runner
 * arrete. Il n'est sollicite qu'au moment de la suppression, et seulement pour
 * retirer les documents de taches.
 */
export default async function ProjectSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ confirmDelete?: string }>;
}) {
  const { id } = await params;
  const { confirmDelete } = await searchParams;
  const project = await loadProject(id);

  if (project === null) {
    notFound();
  }

  const db = getDatabaseClient();
  // Le nombre d'artefacts est annonce avant le clic : « ce que je vais retirer »
  // doit etre lisible au moment de decider, pas decouvert dans le message final.
  const owned = await listOwnedTaskArtifacts(db, project.id);
  const activeRun = await projectHasActiveRun(db, project.id);

  const settings = projectSettingsUrl(project.id);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6">
        <Link href={`/projects/${project.id}`} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour au projet
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Project settings</h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-400">
            Ce que NOX sait de ce projet, et ce qu&apos;il en fait. Ces réglages sont locaux : ils
            ne modifient ni le repository, ni Git.
          </p>
        </div>
      </header>

      <main className="flex flex-col gap-8">
        <SectionCard
          title="Project info"
          description="Le nom NOX est une métadonnée locale. Le chemin du repository, lui, est fixé à l'enregistrement."
        >
          <RenameProjectForm projectId={project.id} currentName={project.name} />

          <dl className="mt-6 grid gap-4 border-t border-zinc-800/70 pt-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Repository</dt>
              <dd className="mt-1 break-all font-mono text-sm text-zinc-300">
                {project.repositoryPath}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Créé le</dt>
              <dd className="mt-1 text-sm text-zinc-300">{formatDateTime(project.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Modifié le</dt>
              <dd className="mt-1 text-sm text-zinc-300">{formatDateTime(project.updatedAt)}</dd>
            </div>
          </dl>
        </SectionCard>

        <section className="rounded-xl border border-red-500/30 bg-red-500/[0.03] p-5 sm:p-6">
          <header className="mb-5">
            <h2 className="text-base font-semibold text-red-200">Danger Zone</h2>
            <p className="mt-1 max-w-prose text-sm text-zinc-500">
              Actions irréversibles. NOX supprime sa connaissance du projet ; il ne supprime jamais
              le logiciel.
            </p>
          </header>

          {activeRun ? (
            <p
              role="alert"
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
            >
              {PROJECT_ACTIVE_RUN_MESSAGE}
            </p>
          ) : (
            <DeleteProjectForm
              projectId={project.id}
              projectName={project.name}
              repositoryPath={project.repositoryPath}
              ownedArtifacts={owned.length}
              confirming={confirmDelete === "1"}
              confirmHref={`${settings}?confirmDelete=1`}
              cancelHref={settings}
            />
          )}
        </section>
      </main>
    </div>
  );
}
