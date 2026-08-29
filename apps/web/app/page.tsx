import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import { ProjectCard } from "@/components/ProjectCard";
import { RunnerStatusBadge } from "@/components/RunnerStatusBadge";
import { projectDeletedNotice, readDeletedCount } from "@/lib/project-delete";
import { executionSummary, executionSummaryLabel } from "@/lib/project-dashboard";
import { loadProjectCards } from "@/lib/projects";

/**
 * Tableau de bord des projets.
 *
 * ## Ce que cette page repond
 *
 * Quels projets existent, ou en est chacun, lequel ouvrir, comment en creer un
 * nouveau. C'est tout, et c'est delibere : le premier ecran doit mener au
 * travail, pas decrire l'outil.
 *
 * ## Ce qu'elle ne raconte plus
 *
 * Jusqu'a TASK-025, elle affichait la version de NOX, une « phase courante »
 * pointant vers une tache interne, un inventaire du socle technique et une liste
 * de « prochaines grandes etapes ». Chacune de ces sections etait juste le jour
 * ou elle a ete ecrite, et fausse quelques taches plus tard — la roadmap statique
 * annoncait comme a venir des capacites livrees depuis. Une page d'accueil qui
 * decrit l'avancement de son propre developpement se perime par construction ;
 * celle-ci ne montre que des donnees.
 *
 * L'etat du runner reste, mais comme un indicateur discret : il explique
 * pourquoi une action echouerait, et rien de plus.
 *
 * ## Plusieurs projets a la fois
 *
 * Depuis TASK-031, plusieurs projets peuvent travailler en meme temps. La page
 * les montre donc cote a cote, chacun avec ce qu'il fait — et **aucune**
 * « execution courante » globale : il n'en existe plus, et en afficher une
 * designerait arbitrairement l'un des travaux en cours.
 *
 * Le resume en tete est entierement derive des cartes deja construites : trois
 * comptages, zero requete de plus, zero etat nouveau.
 *
 * Aucun appel au fournisseur, aucun Claude Code, aucune ecriture : ce rendu ne
 * fait que lire SQLite.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; removed?: string; modified?: string }>;
}) {
  const { deleted, removed, modified } = await searchParams;
  const cards = await loadProjectCards();
  const summary = executionSummaryLabel(executionSummary(cards));

  // La confirmation d'une suppression est **reconstruite** a partir de deux
  // compteurs bornes : rien de ce que l'URL porte n'est affiche tel quel.
  const deletedNotice =
    deleted === "1" ? projectDeletedNotice(readDeletedCount(removed), readDeletedCount(modified)) : null;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 border-b border-zinc-800 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-[0.2em] text-zinc-50">NOX</h1>
          <RunnerStatusBadge />
        </div>

        <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
          NOX orchestre le développement assisté par IA : formaliser un besoin, le découper en
          petites tâches, les envoyer à Claude Code, exécuter les validations et relire le résultat
          &mdash; sans copier-coller manuel entre la conception et l&apos;implémentation.
        </p>
      </header>

      <main className="flex flex-col gap-6">
        {deletedNotice === null ? null : (
          <p
            aria-live="polite"
            className="rounded-lg border border-teal-400/30 bg-teal-400/5 px-4 py-3 text-sm leading-relaxed text-teal-200/90"
          >
            {deletedNotice}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Projects</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Chaque projet NOX pointe vers un repository Git local de cette machine. Deux projets
              peuvent travailler en même temps ; un même repository, jamais.
            </p>
            {summary === null ? null : (
              <p className="mt-1 text-sm text-zinc-400">{summary}</p>
            )}
          </div>
          <Link
            href="/projects/new"
            className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-200"
          >
            Create project
          </Link>
        </div>

        {cards.length === 0 ? (
          <EmptyState
            title="No projects yet."
            hint="Créez un projet pour définir son brief, son plan de V1 et ses tâches d'implémentation."
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {cards.map((card) => (
              <ProjectCard key={card.id} card={card} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
