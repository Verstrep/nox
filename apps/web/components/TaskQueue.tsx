import { TASK_STATUS, TASK_KIND, type TaskKind, type TaskStatus } from "@nox/shared";
import Link from "next/link";

import {
  dequeueTaskAction,
  enqueueTaskAction,
} from "@/app/projects/[id]/queue/actions";
import {
  QUEUE_ENQUEUE_ACTIVE_NOTICE,
  QUEUE_ENQUEUE_NOTICE,
  queueUrl,
} from "@/lib/queue-display";
import type { TaskQueueState } from "@/lib/tasks";

import { QueueActionButton } from "./QueueActionButton";
import { SectionCard } from "./SectionCard";
import { StatusBadge } from "./StatusBadge";

/**
 * Place d'une tache dans la file d'execution.
 *
 * ## Ce que cette carte dit avant le clic
 *
 * Qu'inscrire ne lance rien quand la file est en pause, et que cela **peut**
 * lancer quand elle est active. Les deux phrases sont differentes parce que les
 * deux situations le sont : une autorisation deja ouverte s'applique
 * immediatement, et le cacher serait un lancement surprise.
 *
 * ## Ce qu'elle n'affiche pas
 *
 * Aucune action de lancement direct. Une tache inscrite s'execute par la file :
 * proposer les deux cote a cote inviterait a contourner l'ordre qu'on vient de
 * preparer.
 *
 * Elle est absente pour une tache d'amorcage : `TASK-000` ne passe jamais par la
 * file, et une carte qui expliquerait pourquoi occuperait plus de place que le
 * silence.
 */
export function TaskQueue({
  projectId,
  taskId,
  taskKind,
  taskStatus,
  queue,
}: {
  projectId: string;
  taskId: string;
  taskKind: TaskKind;
  taskStatus: TaskStatus;
  queue: TaskQueueState;
}) {
  if (taskKind === TASK_KIND.BOOTSTRAP) {
    return null;
  }

  const queueable = taskStatus === TASK_STATUS.READY;

  if (!queue.queued && !queueable) {
    return null;
  }

  return (
    <SectionCard
      title="Execution queue"
      description="L'ordre dans lequel NOX prendra les tâches inscrites de ce projet."
      action={
        <Link
          href={queueUrl(projectId)}
          className="inline-block rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50"
        >
          Open queue
        </Link>
      }
    >
      {queue.queued ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="accent">Queued</StatusBadge>
            <StatusBadge tone="muted">Position {queue.position}</StatusBadge>
            {queue.isCurrent ? <StatusBadge tone="accent">Current</StatusBadge> : null}
            <StatusBadge tone={queue.active ? "accent" : "muted"}>
              {queue.active ? "Active" : "Paused"}
            </StatusBadge>
          </div>

          <p className="max-w-prose text-sm leading-relaxed text-zinc-400">
            Cette tâche est inscrite dans la file. Tant qu&apos;elle y figure, son contrat est
            gelé : la modifier, changer son statut à la main ou la supprimer demande de la retirer
            d&apos;abord.
          </p>

          {/*
            La barriere courante rouverte est le seul cas ou une tache inscrite se
            relance depuis sa propre page. Le dire ici evite d'envoyer l'utilisateur
            vers une file qui n'attend que lui.
          */}
          {queue.isCurrent && taskStatus === TASK_STATUS.READY ? (
            <p className="max-w-prose text-sm leading-relaxed text-zinc-400">
              C&apos;est la tâche courante de la file : son travail a commencé et n&apos;a pas été
              accepté. La file ne passera pas à la suivante, et ne la relancera pas d&apos;elle-même
              — le départ se décide sur cette page.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <QueueActionButton
              action={dequeueTaskAction}
              projectId={projectId}
              taskId={taskId}
              tone="danger"
              pendingLabel="Retrait…"
              disabled={taskStatus === TASK_STATUS.RUNNING}
            >
              Remove from queue
            </QueueActionButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="max-w-prose text-sm leading-relaxed text-zinc-400">
            {queue.active ? QUEUE_ENQUEUE_ACTIVE_NOTICE : QUEUE_ENQUEUE_NOTICE}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <QueueActionButton
              action={enqueueTaskAction}
              projectId={projectId}
              taskId={taskId}
              tone="primary"
              pendingLabel="Inscription…"
            >
              Queue task
            </QueueActionButton>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
