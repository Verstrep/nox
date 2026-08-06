import {
  TASK_DOCUMENT_SYNC_STATUS,
  TASK_STATUS,
  allowedTaskStatusTransitions,
  type DevelopmentRunSummary,
  type DevelopmentTaskDetail,
} from "@nox/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { documentUrl } from "@/lib/document-edit";
import { formatIsoDateTime } from "@/lib/format";
import { loadProject } from "@/lib/projects";
import {
  describeRunStatus,
  formatDuration,
  newRunUrl,
  runStatusTone,
  runUrl,
} from "@/lib/run-display";
import { loadTaskRuns } from "@/lib/runs";
import {
  describeTaskPriority,
  describeTaskStatus,
  describeTaskSync,
  taskStatusTone,
} from "@/lib/task-display";
import { loadTask } from "@/lib/tasks";

import { retryTaskDocumentAction } from "./actions";
import { TaskStatusForm } from "./TaskStatusForm";

/** Bloc de texte libre, affiche brut : NOX ne rend pas le Markdown. */
function TextBlock({ children }: { children: string }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{children}</p>
  );
}

function OrderedList({ entries, mono = false }: { entries: readonly string[]; mono?: boolean }) {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-zinc-300 marker:text-zinc-600">
      {entries.map((entry, index) => (
        <li key={`${String(index)}-${entry}`} className={mono ? "font-mono text-xs" : undefined}>
          {entry}
        </li>
      ))}
    </ol>
  );
}

/**
 * Etat du document Markdown associe.
 *
 * L'echec n'escamote jamais le reste de la tache : la specification est
 * complete en base, et c'est elle qui compte. Le document est un artefact a
 * reproduire, pas une condition d'existence.
 */
function DocumentSection({
  projectId,
  task,
}: {
  projectId: string;
  task: DevelopmentTaskDetail;
}) {
  const isSynced = task.documentSyncStatus === TASK_DOCUMENT_SYNC_STATUS.SYNCED;
  const isConflict = task.documentSyncStatus === TASK_DOCUMENT_SYNC_STATUS.CONFLICT;

  return (
    <SectionCard
      title="Document de tache"
      description="Artefact versionne avec le repository, destine aux agents de developpement."
      action={<StatusBadge tone={isSynced ? "accent" : "neutral"}>{describeTaskSync(task.documentSyncStatus)}</StatusBadge>}
    >
      <p className="break-all font-mono text-sm text-zinc-300">{task.documentPath}</p>

      {task.documentSyncError === null ? null : (
        <p
          role="alert"
          className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          {task.documentSyncError}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {isSynced || isConflict ? (
          <Link
            href={documentUrl(projectId, task.documentPath)}
            className="rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50"
          >
            {isConflict ? "Ouvrir le fichier existant" : "Ouvrir le document"}
          </Link>
        ) : null}

        {isSynced ? null : (
          <form action={retryTaskDocumentAction}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="taskId" value={task.id} />
            <button
              type="submit"
              className="rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300"
            >
              Reessayer la creation du document
            </button>
          </form>
        )}
      </div>

      {isConflict ? (
        <p className="mt-4 text-xs text-zinc-600">
          Un fichier different occupe ce chemin. NOX ne l&apos;ecrase pas : ouvrez-le, puis
          renommez-le ou supprimez-le vous-meme avant de reessayer.
        </p>
      ) : null}

    </SectionCard>
  );
}

/**
 * Historique des executions.
 *
 * Le bouton de lancement n'apparait que sur une tache `READY` : une tache en
 * cours ne peut pas etre relancee, et une tache en relecture doit d'abord etre
 * tranchee par l'utilisateur.
 */
function RunsSection({
  projectId,
  task,
  runs,
}: {
  projectId: string;
  task: DevelopmentTaskDetail;
  runs: readonly DevelopmentRunSummary[];
}) {
  const canLaunch = task.status === TASK_STATUS.READY;

  return (
    <SectionCard
      title="Executions"
      description="Passages de Claude Code sur cette tache, du plus recent au plus ancien."
      action={
        canLaunch ? (
          <Link
            href={newRunUrl(projectId, task.id)}
            className="inline-block rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300"
          >
            Preparer une execution
          </Link>
        ) : null
      }
    >
      {runs.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Aucune execution.{" "}
          {canLaunch
            ? "Preparez-en une pour envoyer cette tache a Claude Code."
            : "Seule une tache « Prete » peut etre lancee."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {runs.map((run) => {
            const startedAt = formatIsoDateTime(run.startedAt ?? run.createdAt);
            const duration = formatDuration(run.durationMs);

            return (
              <li key={run.id}>
                <Link
                  href={runUrl(projectId, task.id, run.id)}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3 transition-colors hover:border-zinc-700"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-zinc-500">{run.code}</p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {startedAt ?? "-"}
                      {duration === null ? null : ` · ${duration}`}
                    </p>
                  </div>
                  <StatusBadge tone={runStatusTone(run.status)}>
                    {describeRunStatus(run.status)}
                  </StatusBadge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {task.status === TASK_STATUS.RUNNING ? (
        <p className="mt-5 text-xs text-zinc-600">
          Une execution est en cours : elle doit se terminer avant qu&apos;une autre soit possible.
        </p>
      ) : null}
    </SectionCard>
  );
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string; taskId: string }>;
}) {
  const { id, taskId } = await params;
  const project = await loadProject(id);

  if (project === null) {
    notFound();
  }

  const task = await loadTask(taskId);

  // Une tache d'un autre projet est traitee comme inexistante : l'URL ne doit
  // pas permettre de constater qu'un identifiant existe ailleurs.
  if (task === null || task.projectId !== project.id) {
    notFound();
  }

  const runs = await loadTaskRuns(task.id);
  const createdAt = formatIsoDateTime(task.createdAt);
  const updatedAt = formatIsoDateTime(task.updatedAt);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 border-b border-zinc-800 pb-6">
        <Link
          href={`/projects/${project.id}/tasks`}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          &larr; Retour aux taches
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-xs text-zinc-500">{task.code}</p>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-50">{task.title}</h1>
            <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <StatusBadge tone={taskStatusTone(task.status)}>
              {describeTaskStatus(task.status)}
            </StatusBadge>
            <StatusBadge tone="muted">
              Priorite {describeTaskPriority(task.priority)}
            </StatusBadge>
          </div>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        <p className="rounded-lg border-l-2 border-zinc-700 bg-zinc-950/40 py-3 pl-4 pr-4 text-xs leading-relaxed text-zinc-500">
          Les informations structurees de cette page sont actuellement la source de verite. La
          modification directe du fichier Markdown ne met pas encore a jour la tache NOX.
        </p>

        <SectionCard title="Objectif">
          <TextBlock>{task.objective}</TextBlock>
        </SectionCard>

        {task.context === null ? null : (
          <SectionCard title="Contexte">
            <TextBlock>{task.context}</TextBlock>
          </SectionCard>
        )}

        <SectionCard
          title="Criteres d'acceptation"
          description="Ce qui devra etre vrai pour considerer la tache terminee."
        >
          <OrderedList entries={task.acceptanceCriteria} />
        </SectionCard>

        {task.documentReferences.length === 0 ? null : (
          <SectionCard
            title="Documents a lire"
            description="Chemins relatifs au repository, tels que saisis. Leur existence n'est pas verifiee."
          >
            <OrderedList entries={task.documentReferences} mono />
          </SectionCard>
        )}

        {task.validationCommands.length === 0 ? null : (
          <SectionCard
            title="Commandes de validation"
            description="Enregistrees avec la tache. NOX ne les execute pas."
          >
            <OrderedList entries={task.validationCommands} mono />
          </SectionCard>
        )}

        {task.outOfScope === null ? null : (
          <SectionCard title="Hors perimetre">
            <TextBlock>{task.outOfScope}</TextBlock>
          </SectionCard>
        )}

        <DocumentSection projectId={project.id} task={task} />

        <RunsSection projectId={project.id} task={task} runs={runs} />

        <SectionCard
          title="Statut"
          description="Les transitions proposees sont les seules autorisees depuis l'etat actuel."
        >
          <TaskStatusForm
            projectId={project.id}
            taskId={task.id}
            transitions={allowedTaskStatusTransitions(task.status)}
          />
          <p className="mt-4 text-xs text-zinc-600">
            Les statuts « En cours », « Echouee » et « A relire » sont poses par une execution de
            Claude Code, jamais choisis a la main. Accepter un travail relu — « A relire » vers
            « Terminee » — ne cree aucun commit.
          </p>
        </SectionCard>

        <SectionCard title="Dates">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Creee le</dt>
              <dd className="mt-1 text-sm text-zinc-300">{createdAt ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Modifiee le</dt>
              <dd className="mt-1 text-sm text-zinc-300">{updatedAt ?? "-"}</dd>
            </div>
          </dl>
        </SectionCard>
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        NOX n&apos;execute aucune de ces commandes et ne lance pas Claude Code. Cette page decrit un
        travail a faire, pas un travail en cours.
      </footer>
    </div>
  );
}
