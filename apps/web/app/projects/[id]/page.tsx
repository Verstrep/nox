import { ARCHITECT_SESSION_KIND, TASK_STATUS } from "@nox/shared";
import { findProjectArchitectSession, getDatabaseClient, listArchitectSessions } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { architectHistoryUrl, architectUrl } from "@/lib/architect/display";
import { loadProjectBacklogView } from "@/lib/backlog";
import { loadProjectBootstrapTask } from "@/lib/bootstrap";
import { bootstrapUrl } from "@/lib/bootstrap/display";
import {
  backlogStateLabel,
  backlogTaskCountLabel,
  backlogUrl,
  type BacklogSurfaceState,
} from "@/lib/backlog/display";
import { loadProjectDocuments } from "@/lib/documents";
import { formatDateTime, formatIsoDateTime } from "@/lib/format";
import { taskStatusLabel } from "@/lib/labels";
import {
  briefSectionState,
  planSectionState,
  planSectionStateLabel,
  planUrl,
} from "@/lib/plan-display";
import { loadStructuredState } from "@/lib/project-plan";
import { loadProject } from "@/lib/projects";
import { countTasksByStatus } from "@/lib/task-display";
import { loadProjectTasks } from "@/lib/tasks";

/**
 * Sections encore vides. Elles annoncent ce qui viendra sans simuler de donnees :
 * afficher de faux messages rendrait le tableau de bord illisible et ferait
 * croire a des fonctionnalites inexistantes.
 */
const PLANNED_SECTIONS = [
  {
    id: "runs",
    title: "Executions",
    description: "Suivre les executions de Claude Code, leurs logs et leurs resultats.",
  },
] as const;

function TaskCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-zinc-600">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-zinc-200">{value}</dd>
    </div>
  );
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);

  if (project === null) {
    notFound();
  }

  // L'inventaire est indicatif : son echec n'empeche jamais l'affichage des
  // donnees SQLite du projet, qui ne dependent pas du runner.
  const documents = await loadProjectDocuments(project.repositoryPath);

  // Les taches, elles, viennent de SQLite : leurs compteurs restent affiches
  // meme runner arrete.
  const tasks = await loadProjectTasks(project.id);
  const taskCounts = countTasksByStatus(tasks);

  // La conversation principale est **lue**, jamais creee ici : ouvrir la page
  // d'un projet ne doit rien ecrire. Elle apparait au premier passage sur sa
  // propre page, et `null` veut simplement dire « pas encore ouverte ».
  const db = getDatabaseClient();
  const architect = await findProjectArchitectSession(db, project.id);

  // L'etat structure vient de SQLite : la carte reste exacte runner arrete, et
  // l'afficher ne coute aucun appel au fournisseur.
  const structured = await loadStructuredState(db, project);
  const briefState = briefSectionState(structured.brief.present, structured.brief.stored);
  const v1PlanState = planSectionState(structured.plan.present, structured.plan.stored);
  const legacyArchitectSessions = (await listArchitectSessions(db, project.id)).filter(
    (session) => session.kind !== ARCHITECT_SESSION_KIND.PROJECT,
  ).length;

  // Le backlog vient lui aussi de SQLite. La peremption d'une proposition n'est
  // **pas** calculee ici : elle demanderait de relire le repository, et cette
  // page n'a pas besoin de la reponse — la carte renvoie vers le backlog, qui
  // la calcule quand elle sert.
  // L'amorcage vient de SQLite : `null` signifie « pas encore preparee », et la
  // page ne sonde pas le repository pour le savoir.
  const bootstrapTask = await loadProjectBootstrapTask(project.id);

  const backlog = await loadProjectBacklogView(project.id);
  const backlogState: BacklogSurfaceState =
    backlog.running !== null
      ? "generating"
      : backlog.pending !== null
        ? "proposal_ready"
        : backlog.lastApplied !== null
          ? "applied"
          : "not_generated";

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

        <SectionCard
          title="Project plan"
          description="Project Brief et Living V1 Plan : l'intention produit actuelle de ce projet."
          action={
            <Link
              href={planUrl(project.id)}
              className="inline-block rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50"
            >
              Open plan
            </Link>
          }
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Brief</dt>
              <dd className="mt-1 text-sm text-zinc-300">{planSectionStateLabel(briefState)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">V1 plan</dt>
              <dd className="mt-1 text-sm text-zinc-300">{planSectionStateLabel(v1PlanState)}</dd>
            </div>
          </dl>

          <p className="mt-5 max-w-prose text-sm leading-relaxed text-zinc-400">
            Cet etat accompagne chaque conversation Architecte, et prime sur la documentation du
            repository pour l&apos;intention produit. NOX ne le modifie jamais seul : une
            proposition de l&apos;Architecte attend toujours votre validation.
          </p>
        </SectionCard>

        {/*
          Une indication concise, et rien de plus : le tableau de bord complet
          viendra en TASK-025. Elle vient entierement de SQLite — ouvrir cette
          page ne relit pas le repository et n'appelle jamais le fournisseur.
        */}
        <SectionCard
          title="V1 Backlog"
          description="Le travail d'implementation restant pour atteindre le Living V1 Plan."
          action={
            <Link
              href={backlogUrl(project.id)}
              className="inline-block rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50"
            >
              Open backlog
            </Link>
          }
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Backlog</dt>
              <dd className="mt-1 text-sm text-zinc-300">{backlogStateLabel(backlogState)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Taches creees</dt>
              <dd className="mt-1 text-sm text-zinc-300">
                {backlogTaskCountLabel(backlog.lastAppliedTasks.length)}
              </dd>
            </div>
          </dl>

          <p className="mt-5 max-w-prose text-sm leading-relaxed text-zinc-400">
            Generer un backlog est une action explicite, qui engage un appel au fournisseur. Aucune
            tache n&apos;est creee tant que vous n&apos;avez pas applique un backlog vous-meme.
          </p>
        </SectionCard>

        {/*
          Amorcage : une carte compacte, et un lien. L'etat affiche est derive de
          la tache elle-meme — NOX ne tient aucun second cycle de vie.
        */}
        <SectionCard
          title="Bootstrap"
          description="TASK-000 prepare le repository avant les taches produit."
          action={
            <Link
              href={bootstrapUrl(project.id)}
              className="inline-block rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50"
            >
              Open bootstrap
            </Link>
          }
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Etat</dt>
              <dd className="mt-1 text-sm text-zinc-300">
                {bootstrapTask === null
                  ? "Not prepared"
                  : `${bootstrapTask.code} · ${taskStatusLabel(bootstrapTask.status)}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Execution</dt>
              <dd className="mt-1 text-sm text-zinc-300">
                Toujours explicite : creer TASK-000 ne lance rien.
              </dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard
          title="Memoire"
          description="Ce que NOX retient de ce projet : decisions, contraintes, conventions, connaissances durables."
          action={
            <Link
              href={`/projects/${project.id}/memory`}
              className="inline-block rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50"
            >
              Memory
            </Link>
          }
        >
          <p className="max-w-prose text-sm leading-relaxed text-zinc-400">
            Les entrees actives accompagnent chaque conversation Architecte de ce projet, sans avoir
            a etre reexpliquees. Rien n&apos;y entre automatiquement : ni depuis une conversation, ni
            depuis une proposition, ni depuis une execution de Claude Code.
          </p>
        </SectionCard>

        <SectionCard
          title="Architecte"
          description="La conversation durable de ce projet : concevoir, decider, preparer la suite."
          action={
            <Link
              href={architectUrl(project.id)}
              className="inline-block rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50"
            >
              {architect === null ? "Open conversation" : "Continue conversation"}
            </Link>
          }
        >
          <p className="max-w-prose text-sm leading-relaxed text-zinc-400">
            L&apos;architecte lit les documents du projet, sa memoire et ses taches recentes. Il
            repond, compare des options, et propose une tache quand un prochain increment est
            clair — vous la relisez avant de la creer. Creer une tache ne ferme pas la
            conversation : vous y revenez pour la suite.
          </p>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-zinc-500">
            Il ne lance rien, ne modifie aucun fichier, et ne voit ni le code, ni les diffs, ni les
            sorties de Claude Code. Ouvrir la conversation ne coute aucun appel.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-800 pt-4 text-xs text-zinc-600">
            {architect === null ? (
              <span>Aucun tour echange pour le moment.</span>
            ) : (
              <span>
                {architect.generationCount === 0
                  ? "Aucun tour echange"
                  : architect.generationCount === 1
                    ? "1 tour echange"
                    : `${String(architect.generationCount)} tours echanges`}{" "}
                · derniere activite {formatIsoDateTime(architect.updatedAt)}
              </span>
            )}
            {legacyArchitectSessions === 0 ? null : (
              <Link
                href={architectHistoryUrl(project.id)}
                className="underline hover:text-zinc-400"
              >
                {legacyArchitectSessions === 1
                  ? "1 conversation historique"
                  : `${String(legacyArchitectSessions)} conversations historiques`}
              </Link>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Taches"
          description="Unites de travail structurees, enregistrees dans la base locale de NOX."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/projects/${project.id}/tasks`}
                className="inline-block rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50"
              >
                Voir les taches
              </Link>
              <Link
                href={`/projects/${project.id}/tasks/new`}
                className="inline-block rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300"
              >
                Nouvelle tache
              </Link>
            </div>
          }
        >
          <dl className="grid grid-cols-3 gap-4">
            <TaskCount label="Total" value={tasks.length} />
            <TaskCount label={taskStatusLabel(TASK_STATUS.READY)} value={taskCounts[TASK_STATUS.READY]} />
            <TaskCount
              label={taskStatusLabel(TASK_STATUS.BLOCKED)}
              value={taskCounts[TASK_STATUS.BLOCKED]}
            />
          </dl>
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
