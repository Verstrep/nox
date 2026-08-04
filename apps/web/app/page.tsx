import { NOX_VERSION, PROJECT_STATUS, PROJECT_STATUSES, type ProjectStatus } from "@nox/shared";
import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import { ProjectCard } from "@/components/ProjectCard";
import { RunnerStatusBadge } from "@/components/RunnerStatusBadge";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { loadProjects } from "@/lib/projects";

/**
 * Seule la liste des projets provient de la base. Les sections « Socle » et
 * « Prochaines grandes etapes » restent des reperes statiques : elles decrivent
 * l'avancement du produit, pas des donnees utilisateur.
 */
const CURRENT_PHASE_STATUS: ProjectStatus = PROJECT_STATUS.DRAFT;

const NEXT_STEPS = [
  {
    id: "documents",
    title: "Documents Markdown",
    description: "Maintenir le brief, le perimetre et les decisions directement depuis NOX.",
  },
  {
    id: "tasks",
    title: "Backlog de taches",
    description: "Decouper un projet en petites taches structurees et suivre leur statut.",
  },
  {
    id: "runner",
    title: "Runner controle",
    description: "Piloter le runner local depuis l'interface et suivre ses logs.",
  },
  {
    id: "claude",
    title: "Integration Claude Code",
    description: "Envoyer une tache au CLI et recuperer le compte rendu d'execution.",
  },
  {
    id: "git",
    title: "Git et validations",
    description: "Afficher le statut Git et le resultat du lint, du typecheck et du build.",
  },
] as const;

const FOUNDATION_ITEMS = [
  { id: "web", label: "Application web", detail: "Next.js App Router, TypeScript strict, Tailwind" },
  {
    id: "runner",
    label: "Runner local",
    detail: "API HTTP authentifiee, resolution des repositories Git",
  },
  { id: "shared", label: "Package partage", detail: "@nox/shared, statuts et contrat runner" },
  { id: "database", label: "Persistance locale", detail: "Prisma + SQLite, modele Project" },
] as const;

export default async function DashboardPage() {
  const projects = await loadProjects();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-10 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-6 border-b border-zinc-800 pb-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-3xl font-semibold tracking-[0.2em] text-zinc-50">NOX</h1>
            <span className="font-mono text-xs text-zinc-600">v{NOX_VERSION}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RunnerStatusBadge />
            <StatusBadge tone="accent" withDot>
              Systeme en phase d&apos;initialisation
            </StatusBadge>
          </div>
        </div>

        <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
          NOX orchestre le developpement assiste par IA : formaliser un besoin, le decouper en
          petites taches, les envoyer a Claude Code, executer les validations et relire le resultat
          &mdash; sans copier-coller manuel entre la conception et l&apos;implementation.
        </p>

        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
          <span>Phase courante</span>
          <StatusBadge tone="neutral">{CURRENT_PHASE_STATUS}</StatusBadge>
          <span aria-hidden="true">&middot;</span>
          <span>TASK-002 &mdash; gestion locale des projets</span>
        </div>
      </header>

      <main className="flex flex-col gap-8">
        <SectionCard
          title="Projets"
          description="Chaque projet NOX pointe vers un repository Git local de cette machine."
          action={
            <Link
              href="/projects/new"
              className="inline-block rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300"
            >
              Nouveau projet
            </Link>
          }
        >
          {projects.length === 0 ? (
            <EmptyState
              title="Aucun projet pour le moment"
              hint="Creez un projet et associez-le a un repository Git local pour commencer."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </ul>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-zinc-600">
              Cycle de vie prevu
            </span>
            {PROJECT_STATUSES.map((status) => (
              <StatusBadge key={status} tone="muted">
                {status}
              </StatusBadge>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Socle en place"
          description="Ce qui existe reellement dans le repository a ce stade."
        >
          <ul className="grid gap-3 sm:grid-cols-2">
            {FOUNDATION_ITEMS.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3"
              >
                <p className="text-sm font-medium text-zinc-200">{item.label}</p>
                <p className="mt-1 text-xs text-zinc-500">{item.detail}</p>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="Prochaines grandes etapes"
          description="Trajectoire prevue vers la V1. Aucune de ces etapes n'est encore implementee."
        >
          <ol className="flex flex-col gap-3">
            {NEXT_STEPS.map((step, index) => (
              <li
                key={step.id}
                className="flex gap-4 rounded-lg border border-zinc-800/70 bg-zinc-950/30 px-4 py-3"
              >
                <span className="mt-0.5 font-mono text-xs text-zinc-600">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="text-sm font-medium text-zinc-200">{step.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </SectionCard>
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs text-zinc-600">
        NOX est en cours de developpement. Seule la liste des projets provient de la base locale.
      </footer>
    </div>
  );
}
