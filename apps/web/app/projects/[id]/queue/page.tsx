import {
  QUEUE_STATE,
  TASK_STATUS,
  isQueueEntryEligible,
  type QueueEntryFacts,
} from "@nox/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProjectNav } from "@/components/ProjectNav";
import { QueueActionButton } from "@/components/QueueActionButton";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { taskStatusLabel } from "@/lib/labels";
import { getDatabaseClient } from "@nox/database";

import { loadProject, loadQueueWithRepository } from "@/lib/projects";

import {
  QUEUE_ENQUEUE_NOTICE,
  QUEUE_ORDER_NOTICE,
  QUEUE_STANDING_AUTHORIZATION,
  queueReviewExplanation,
  queueReviewLabel,
  queueStateExplanation,
  queueStateLabel,
} from "@/lib/queue-display";
import { describeWaitingDependencies } from "@/lib/task-dependencies";
import { taskStatusTone, taskUrl } from "@/lib/task-display";
import { loadTaskCorrectionCycle } from "@/lib/correction-cycle";
import { loadReviewWait } from "@/lib/verification-review";

import {
  dequeueTaskAction,
  moveQueueEntryAction,
  pauseQueueAction,
  startQueueAction,
  tryNextQueueAction,
} from "./actions";


/**
 * File d'execution d'un projet.
 *
 * ## Ce que cette page fait, et ne fait pas
 *
 * Elle montre l'etat de la file et propose les gestes qui la modifient. Elle
 * **ne lance rien au rendu** : `advanceQueue` n'est appele que depuis une Server
 * Action, c'est-a-dire apres un clic. C'est ce qui garantit qu'un redemarrage du
 * serveur, ou un simple rafraichissement, ne produit aucune execution surprise.
 *
 * ## La seule sonde
 *
 * L'etat du repository n'est demande au runner que lorsque la reponse sert :
 * file active, aucune barriere, une tache eligible. Afficher « repository
 * occupe » a cote de « attend une dependance » melangerait deux problemes dont
 * un seul compte.
 */
export default async function QueuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);

  if (project === null) {
    notFound();
  }

  const queue = await loadQueueWithRepository(project.id);
  const last = queue.entries.at(-1)?.taskId ?? null;
  const first = queue.entries.at(0)?.taskId ?? null;

  // « Waiting for review » couvrait quatre situations qui n'appellent pas le
  // meme geste. La precision vient d'une **lecture** de la review courante :
  // ouvrir cette page n'execute rien, et n'interroge ni runner, ni fournisseur.
  const reviewWait =
    queue.state === QUEUE_STATE.WAITING_REVIEW && queue.current !== null
      ? await loadReviewWait(getDatabaseClient(), queue.current.taskId)
      : null;

  // Le cycle de correction, quand il y en a un. Lecture seule egalement : rien
  // ici ne reserve, ne lance et ne corrige — ouvrir la file n'a jamais rien
  // demarre, et TASK-028 ne change pas cette regle.
  const correctionCycle =
    reviewWait === null || queue.current === null
      ? null
      : (await loadTaskCorrectionCycle(getDatabaseClient(), queue.current.taskId))?.cycle ?? null;

  const stateLabel =
    reviewWait === null
      ? queueStateLabel(queue.state)
      : queueReviewLabel(reviewWait, correctionCycle);
  const stateExplanation =
    reviewWait === null
      ? queueStateExplanation(queue.state)
      : queueReviewExplanation(reviewWait, correctionCycle);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 border-b border-zinc-800 pb-6">
        <Link href={`/projects/${project.id}`} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour au projet
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-zinc-50">Execution queue</h1>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-400">
              Les tâches que vous avez inscrites, et l&apos;ordre dans lequel NOX les prendra.
              Inscrire ne lance rien ; démarrer la file ouvre une autorisation, et cette
              autorisation reste soumise aux dépendances, à la review et au repository.
            </p>
            <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <StatusBadge tone={queue.active ? "accent" : "muted"} withDot>
              {queue.active ? "Active" : "Paused"}
            </StatusBadge>
            <StatusBadge tone="neutral">{stateLabel}</StatusBadge>
          </div>
        </div>

        <ProjectNav projectId={project.id} />
      </header>

      <main className="flex flex-col gap-6">
        <SectionCard title="État" description={stateLabel}>
          <p className="max-w-prose text-sm leading-relaxed text-zinc-400">
            {stateExplanation}
          </p>

          <dl className="mt-5 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Queued</dt>
              <dd className="mt-1 text-2xl font-semibold text-zinc-200">{queue.queuedCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Éligibles</dt>
              <dd className="mt-1 text-2xl font-semibold text-zinc-200">{queue.eligibleCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">En attente</dt>
              <dd className="mt-1 text-2xl font-semibold text-zinc-200">
                {queue.waitingDependencyCount}
              </dd>
            </div>
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-5">
            {queue.active ? (
              <QueueActionButton
                action={pauseQueueAction}
                projectId={project.id}
                pendingLabel="Mise en pause…"
              >
                Pause queue
              </QueueActionButton>
            ) : (
              <QueueActionButton
                action={startQueueAction}
                projectId={project.id}
                tone="primary"
                pendingLabel="Démarrage…"
                disabled={queue.queuedCount === 0}
              >
                Start queue
              </QueueActionButton>
            )}

            <QueueActionButton
              action={tryNextQueueAction}
              projectId={project.id}
              pendingLabel="Tentative…"
              disabled={queue.queuedCount === 0}
            >
              Try next
            </QueueActionButton>
          </div>

          <p className="mt-4 max-w-prose text-xs leading-relaxed text-zinc-600">
            {QUEUE_STANDING_AUTHORIZATION}
          </p>
        </SectionCard>

        {queue.current === null ? null : (
          <SectionCard
            title="Current"
            description="La tâche commencée depuis cette file, et pas encore acceptée."
          >
            <QueueRow
              projectId={project.id}
              entry={queue.current}
              position={queue.entries.indexOf(queue.current) + 1}
              current
              first={false}
              last={false}
            />
            <p className="mt-4 max-w-prose text-xs leading-relaxed text-zinc-600">
              La file ne passe à la suivante que lorsque cette tâche est acceptée. Une exécution
              terminée mène à une review ; une review n&apos;est pas une acceptation.
            </p>
            {/*
              Rouverte : elle est « Ready », et pourtant la file l'attend. C'est le
              seul état où la barrière ne se lit pas sur le statut, donc le seul où
              l'écran doit dire explicitement par où repartir.
            */}
            {queue.current.status === TASK_STATUS.READY ? (
              <p className="mt-2 max-w-prose text-xs leading-relaxed text-zinc-600">
                Elle a été rouverte : son travail a commencé et n&apos;a pas été accepté. Relancez-la
                depuis sa page, ou retirez-la de la file — ni la file, ni Try next ne la relanceront
                à votre place.
              </p>
            ) : null}
          </SectionCard>
        )}

        <SectionCard
          title="Pending tasks"
          description="Inscrites, en attente de leur tour. L'ordre est une préférence, pas une contrainte."
        >
          {queue.entries.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Aucune tâche inscrite. {QUEUE_ENQUEUE_NOTICE}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {queue.entries.map((entry, index) => (
                <li key={entry.taskId}>
                  <QueueRow
                    projectId={project.id}
                    entry={entry}
                    position={index + 1}
                    current={queue.current?.taskId === entry.taskId}
                    first={entry.taskId === first}
                    last={entry.taskId === last}
                  />
                </li>
              ))}
            </ul>
          )}

          <p className="mt-5 max-w-prose text-xs leading-relaxed text-zinc-600">
            {QUEUE_ORDER_NOTICE}
          </p>
        </SectionCard>

        <SectionCard
          title="Ce que la file ne fait pas"
          description="Les garanties qu'elle n'affaiblit pas."
        >
          <ul className="ml-5 flex list-disc flex-col gap-2 text-sm leading-relaxed text-zinc-400">
            <li>
              Elle ne contourne pas le préflight Git. Un repository qui porte des modifications non
              commitées arrête la progression ; NOX ne commite rien à votre place.
            </li>
            <li>
              Elle ne contourne pas la review. Une exécution terminée attend votre décision.
            </li>
            <li>
              Elle ne lance jamais plus d&apos;une exécution à la fois, tous projets confondus.
            </li>
            <li>
              Elle ne démarre rien au lancement du serveur : une file active attend un événement,
              pas un redémarrage.
            </li>
            <li>Elle n&apos;inscrit jamais TASK-000 : l&apos;amorçage se lance depuis sa page.</li>
          </ul>
        </SectionCard>
      </main>
    </div>
  );
}

/** Une ligne de la file : sa position, son état, et ce qu'on peut en faire. */
function QueueRow({
  projectId,
  entry,
  position,
  current,
  first,
  last,
}: {
  projectId: string;
  entry: QueueEntryFacts;
  position: number;
  current: boolean;
  first: boolean;
  last: boolean;
}) {
  const eligible = isQueueEntryEligible(entry);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-zinc-500">
            #{position} · {entry.code}
          </p>
          <h3 className="mt-1 truncate text-sm font-medium text-zinc-100">
            <Link
              href={taskUrl(projectId, entry.taskId)}
              className="rounded-sm hover:text-teal-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
            >
              {entry.title}
            </Link>
          </h3>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {current ? <StatusBadge tone="accent">Current</StatusBadge> : null}
          <StatusBadge tone={taskStatusTone(entry.status)}>
            {taskStatusLabel(entry.status)}
          </StatusBadge>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-zinc-500">
        {entry.waiting.length === 0
          ? eligible
            ? "Éligible : aucune dépendance ne l'attend."
            : "Son travail est commencé : la file attend qu'il soit accepté."
          : `Attend : ${describeWaitingDependencies(entry.waiting)}.`}
      </p>

      {/*
        Le retrait reste possible sur l'element courant tant qu'aucune execution
        ne travaille dessus : c'est ce qui permet de debloquer une file arretee
        par une tache en echec. Le deplacement, lui, n'a pas de sens sur une
        barriere — la deplacer ne changerait rien a ce qui se passe.
      */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-800/70 pt-3">
        {current ? null : (
          <>
            <QueueActionButton
              action={moveQueueEntryAction}
              projectId={projectId}
              taskId={entry.taskId}
              direction="up"
              pendingLabel="…"
              disabled={first}
              ariaLabel={`Monter ${entry.code}`}
            >
              Move up
            </QueueActionButton>
            <QueueActionButton
              action={moveQueueEntryAction}
              projectId={projectId}
              taskId={entry.taskId}
              direction="down"
              pendingLabel="…"
              disabled={last}
              ariaLabel={`Descendre ${entry.code}`}
            >
              Move down
            </QueueActionButton>
          </>
        )}
        <QueueActionButton
          action={dequeueTaskAction}
          projectId={projectId}
          taskId={entry.taskId}
          tone="danger"
          pendingLabel="Retrait…"
          disabled={entry.status === TASK_STATUS.RUNNING}
          ariaLabel={`Retirer ${entry.code} de la file`}
        >
          Remove
        </QueueActionButton>
      </div>
    </div>
  );
}
