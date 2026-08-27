import {
  CORRECTION_STAGE,
  TASK_DOCUMENT_SYNC_STATUS,
  TASK_STATUS,
  allowedTaskStatusTransitions,
  checkTaskEditable,
  type DevelopmentRunSummary,
  type DevelopmentTaskDetail,
} from "@nox/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { GuidedWorkflow } from "@/components/GuidedWorkflow";
import { TaskDependencies } from "@/components/TaskDependencies";
import {
  getDatabaseClient,
  getLatestDeliveryForTask,
  readVerificationPlan,
} from "@nox/database";

import { TaskQueue } from "@/components/TaskQueue";
import { VerificationPlanSummary } from "@/components/VerificationPlanSummary";
import { loadTaskCorrectionCycle } from "@/lib/correction-cycle";
import {
  deliveryPolicyLabel,
  deliveryRefusalLabel,
  deliveryStateLabel,
  deliveryUrl,
} from "@/lib/delivery-display";
import { correctionStageDetail, correctionStageLabel } from "@/lib/correction-display";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { documentUrl } from "@/lib/document-edit";
import { formatIsoDateTime } from "@/lib/format";
import {
  documentSyncStatusLabel,
  runStatusLabel,
  taskPriorityLabel,
  taskStatusLabel,
} from "@/lib/labels";
import { loadGuidedWorkflow } from "@/lib/guided-workflow";
import { TASK_SECTION_ANCHOR } from "@/lib/guided-workflow-display";
import { loadProject } from "@/lib/projects";
import { formatDuration, newRunUrl, runStatusTone, runUrl } from "@/lib/run-display";
import { loadTaskRuns } from "@/lib/runs";
import { taskStatusTone, taskUrl } from "@/lib/task-display";
import { taskEditUrl } from "@/lib/task-display";
import { loadTask, loadTaskQueueState } from "@/lib/tasks";

import { retryTaskDocumentAction } from "./actions";
import { DeleteTaskForm } from "./DeleteTaskForm";
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
      action={
        <StatusBadge tone={isSynced ? "accent" : "neutral"}>
          {documentSyncStatusLabel(task.documentSyncStatus)}
        </StatusBadge>
      }
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
              Retry
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
            New run
          </Link>
        ) : null
      }
    >
      {runs.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Aucune execution.{" "}
          {canLaunch
            ? "Preparez-en une pour envoyer cette tache a Claude Code."
            : "Seule une tache « Ready » peut etre lancee."}
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
                    {runStatusLabel(run.status)}
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

/**
 * Suppression d'une tache.
 *
 * Le bouton disparait des qu'une execution existe, et l'explication prend sa
 * place : un bouton grise sans raison visible se lit comme une panne. Le refus
 * est aussi verifie par la Server Action et par la base — cette section decide
 * de ce qui est **propose**, pas de ce qui est permis.
 */
function DangerSection({
  projectId,
  task,
  runCount,
  confirming,
}: {
  projectId: string;
  task: DevelopmentTaskDetail;
  runCount: number;
  confirming: boolean;
}) {
  const isConflict = task.documentSyncStatus === TASK_DOCUMENT_SYNC_STATUS.CONFLICT;
  const isRunning = task.status === TASK_STATUS.RUNNING;

  return (
    <SectionCard
      title="Supprimer la tache"
      description="Retire la tache de NOX et son document du repository. Sans commit."
    >
      {runCount > 0 ? (
        <p className="text-sm leading-relaxed text-zinc-400">
          Cette tache possede un historique d&apos;execution. Elle ne peut pas etre supprimee. Une
          fonctionnalite d&apos;archivage sera ajoutee separement.
        </p>
      ) : isRunning ? (
        <p className="text-sm leading-relaxed text-zinc-400">
          Une execution est en cours sur cette tache. Attendez sa fin avant de la supprimer.
        </p>
      ) : isConflict ? (
        <p className="text-sm leading-relaxed text-zinc-400">
          Un fichier different occupe le chemin du document de cette tache. NOX ne peut pas
          affirmer qu&apos;il lui appartient, et ne le supprimera donc pas. Ouvrez-le, tranchez,
          puis revenez.
        </p>
      ) : (
        <DeleteTaskForm
          projectId={projectId}
          taskId={task.id}
          taskCode={task.code}
          title={task.title}
          documentPath={task.documentPath}
          confirming={confirming}
          confirmHref={`${taskUrl(projectId, task.id)}?confirmDelete=1`}
          cancelHref={taskUrl(projectId, task.id)}
        />
      )}
    </SectionCard>
  );
}

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; taskId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, taskId } = await params;
  const query = await searchParams;
  // Tolerant aux valeurs repetees : un lien mal recopie n'ouvre simplement pas
  // la confirmation, il ne produit pas d'erreur.
  const rawConfirm = query["confirmDelete"];
  const confirmingDelete = rawConfirm === "1" || (Array.isArray(rawConfirm) && rawConfirm.includes("1"));
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
  // Deux etats derives, jamais stockes : la tache est-elle encore modifiable, et
  // qu'attend-elle ? Le premier decide de ce qui est **propose** ; l'editeur et
  // la Server Action decident de ce qui est permis.
  // La file est lue en base, sans sonder le repository : savoir qu'une tache est
  // inscrite ne demande pas d'interroger Git.
  const queue = await loadTaskQueueState(project.id, task.id);
  // Lecture seule : afficher un contrat ne declenche aucune validation, et
  // n'interroge ni le runner, ni un fournisseur.
  const plan = await readVerificationPlan(getDatabaseClient(), task.id);

  // Cycle de correction en cours, s'il y en a un. Lecture seule : cette page ne
  // reserve rien, ne lance rien, et n'appelle ni Claude Code, ni OpenAI, ni le
  // runner. Une tache terminee de longue date n'affiche rien ici — son
  // historique vit sur ses executions.
  const correctionCycle = await loadTaskCorrectionCycle(getDatabaseClient(), task.id);
  // Livraison Git de cette tache, lue en base. Aucune inspection du repository
  // ici : la page d'une tache ne doit interroger ni Git, ni le runner. Le detail
  // — et la seule sonde en lecture — vit sur la surface de livraison.
  const delivery =
    task.status === TASK_STATUS.COMPLETED
      ? await getLatestDeliveryForTask(getDatabaseClient(), task.id)
      : null;
  // Une tache inscrite autorise l'execution de son contrat actuel : l'editeur
  // n'est donc pas propose tant qu'elle y figure. La Server Action refuse de
  // toute facon, et c'est elle qui fait autorite.
  const editable =
    !queue.queued && checkTaskEditable({ status: task.status, runCount: runs.length }).ok;
  // Une projection, pas une machine d'etat : elle se recalcule entierement a
  // chaque rendu, et ne declenche ni appel IA, ni execution, ni transition.
  const workflow = await loadGuidedWorkflow({ project, task });
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
              {taskStatusLabel(task.status)}
            </StatusBadge>
            <StatusBadge tone="muted">Priorite {taskPriorityLabel(task.priority)}</StatusBadge>
          </div>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        <GuidedWorkflow
          projectId={project.id}
          taskId={task.id}
          state={workflow.state}
          architectSession={workflow.architectSession}
          pendingFeedbackExcerpt={workflow.pendingFeedbackExcerpt}
          anchorId={TASK_SECTION_ANCHOR.workflow}
        />

        <p className="rounded-lg border-l-2 border-zinc-700 bg-zinc-950/40 py-3 pl-4 pr-4 text-xs leading-relaxed text-zinc-500">
          Les informations structurees de cette page sont la source de verite. La modification
          directe du fichier Markdown ne met pas a jour la tache NOX.
        </p>

        <TaskDependencies
          projectId={project.id}
          dependencies={workflow.dependencies}
          editHref={editable ? taskEditUrl(project.id, task.id) : null}
        />

        <TaskQueue
          projectId={project.id}
          taskId={task.id}
          taskKind={task.kind}
          taskStatus={task.status}
          queue={queue}
        />

        <SectionCard
          title="Objectif"
          action={
            editable ? (
              <Link
                href={taskEditUrl(project.id, task.id)}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
              >
                Edit task
              </Link>
            ) : null
          }
        >
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

        <VerificationPlanSummary plan={plan} taskKind={task.kind} />

        {correctionCycle === null ||
        correctionCycle.cycle.stage === CORRECTION_STAGE.NONE ? null : (
          <SectionCard
            title="Correction"
            description="Ou en est le cycle de travail de cette tache."
          >
            <p className="text-sm text-zinc-200">{correctionStageLabel(correctionCycle.cycle)}</p>
            {correctionCycle.cycle.automatedAttempts === 0 ? null : (
              <p className="mt-1 text-sm text-zinc-400">
                Correction attempt {correctionCycle.cycle.automatedAttempts} of{" "}
                {correctionCycle.cycle.maxAutomatedAttempts} · Triggered by automated validation.
              </p>
            )}
            {correctionStageDetail(correctionCycle.cycle) === null ? null : (
              <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                {correctionStageDetail(correctionCycle.cycle)}
              </p>
            )}
          </SectionCard>
        )}

        {delivery === null ? null : (
          <SectionCard
            title="Git delivery"
            description="Ce que NOX a écrit dans Git pour ce travail validé, ou ce qui l'en empêche."
            action={
              <Link
                href={deliveryUrl(project.id, task.id)}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Open delivery
              </Link>
            }
          >
            <p className="text-sm text-zinc-200">
              {deliveryStateLabel(delivery.status, delivery.errorCode)}
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              {deliveryPolicyLabel(delivery.policy)}
              {delivery.commitSha === null
                ? ""
                : ` · ${delivery.commitSha.slice(0, 12)}`}
            </p>
            {delivery.errorCode === null ? null : (
              <p className="mt-3 text-xs leading-relaxed text-amber-200/80">
                {deliveryRefusalLabel(delivery.errorCode)}
              </p>
            )}
          </SectionCard>
        )}

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
            description="Enregistrees avec la tache. NOX n'execute que celles declarees autonomes, et seulement apres l'execution."
          >
            <OrderedList entries={task.validationCommands} mono />
          </SectionCard>
        )}

        {task.outOfScope === null ? null : (
          <SectionCard title="Hors perimetre">
            <TextBlock>{task.outOfScope}</TextBlock>
          </SectionCard>
        )}

        <div id={TASK_SECTION_ANCHOR.document} className="scroll-mt-6">
          <DocumentSection projectId={project.id} task={task} />
        </div>

        <div id={TASK_SECTION_ANCHOR.runs} className="scroll-mt-6">
          <RunsSection projectId={project.id} task={task} runs={runs} />
        </div>

        <div id={TASK_SECTION_ANCHOR.status} className="scroll-mt-6">
        <SectionCard
          title="Statut"
          description="Les transitions proposees sont les seules autorisees depuis l'etat actuel."
        >
          <TaskStatusForm
            projectId={project.id}
            taskId={task.id}
            from={task.status}
            transitions={allowedTaskStatusTransitions(task.status)}
          />
          <p className="mt-4 text-xs text-zinc-600">
            Les statuts « Running », « Failed » et « Review » sont poses par une execution de
            Claude Code, jamais choisis a la main. Accepter un travail relu — « Approve » — ne
            cree aucun commit.
          </p>
        </SectionCard>
        </div>

        <div id={TASK_SECTION_ANCHOR.danger} className="scroll-mt-6">
          <DangerSection
            projectId={project.id}
            task={task}
            runCount={runs.length}
            confirming={confirmingDelete}
          />
        </div>

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
