import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { loadProjectMemory } from "@/lib/memory";
import { MEMORY_PRIVACY_NOTICE, formatMemorySize, memoryUrl } from "@/lib/memory-display";
import { loadProject } from "@/lib/projects";

import { EMPTY_MEMORY_FORM_VALUES } from "../form-state";
import { MemoryForm } from "../MemoryForm";

/**
 * Creation d'une entree de memoire.
 *
 * Le budget restant est affiche **avant** la saisie : decouvrir au moment
 * d'enregistrer qu'il ne reste que trois cents caracteres serait decouvrir trop
 * tard. Il n'est pas pour autant transmis par le formulaire — le serveur le
 * recalcule dans la transaction d'ecriture, et lui seul decide.
 */
export default async function NewProjectMemoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await loadProject(id);

  if (project === null) {
    notFound();
  }

  const { stats } = await loadProjectMemory(project);
  const remaining = Math.max(0, stats.activeCharsLimit - stats.activeChars);
  const back = memoryUrl(project.id);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-6">
        <Link href={back} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour a la memoire
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-zinc-50">Nouvelle entree de memoire</h1>
          <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        <SectionCard
          title="Ce que vous enregistrez"
          description="Une information durable, que NOX rappellera a l'Architecte a chaque conversation."
        >
          <p className="max-w-prose text-sm leading-relaxed text-zinc-400">
            Une memoire n&apos;est pas une note ni une idee : c&apos;est quelque chose de deja
            tranche, qu&apos;on ne veut plus avoir a re-expliquer. Une decision, une contrainte, une
            convention, un fait du projet.
          </p>
          <p className="mt-4 text-xs leading-relaxed text-zinc-600">{MEMORY_PRIVACY_NOTICE}</p>
          <p className="mt-3 text-xs text-zinc-600">
            Budget actif restant : {formatMemorySize(remaining)} sur{" "}
            {formatMemorySize(stats.activeCharsLimit)}. Une entree qui ne tient pas peut etre
            enregistree en <strong>Archived</strong> : elle sera conservee sans quitter la machine.
          </p>
        </SectionCard>

        <SectionCard title="Entree">
          <MemoryForm
            projectId={project.id}
            initialValues={EMPTY_MEMORY_FORM_VALUES}
            cancelHref={back}
          />
        </SectionCard>
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        Enregistrer une memoire n&apos;ecrit aucun fichier, ne cree aucun commit et n&apos;appelle
        aucune IA.
      </footer>
    </div>
  );
}
