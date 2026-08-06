import { TASK_DOCUMENT_SYNC_STATUS, type DevelopmentTaskSummary } from "@nox/shared";
import Link from "next/link";

import { formatIsoDateTime } from "@/lib/format";
import { documentSyncStatusLabel, taskPriorityLabel, taskStatusLabel } from "@/lib/labels";
import { taskStatusTone, taskUrl } from "@/lib/task-display";

import { StatusBadge } from "./StatusBadge";

type TaskRowProps = {
  projectId: string;
  task: DevelopmentTaskSummary;
};

/**
 * Ligne du backlog.
 *
 * L'etat de synchronisation n'est signale que lorsqu'il demande quelque chose :
 * un document en ordre ne merite pas une pastille de plus dans une liste deja
 * dense.
 */
export function TaskRow({ projectId, task }: TaskRowProps) {
  const updatedAt = formatIsoDateTime(task.updatedAt);
  const needsAttention = task.documentSyncStatus !== TASK_DOCUMENT_SYNC_STATUS.SYNCED;

  return (
    <Link
      href={taskUrl(projectId, task.id)}
      className="block rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3 transition-colors hover:border-zinc-700"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-zinc-500">{task.code}</p>
          <p className="mt-1 truncate text-sm font-medium text-zinc-200">{task.title}</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <StatusBadge tone={taskStatusTone(task.status)}>
            {taskStatusLabel(task.status)}
          </StatusBadge>
          <StatusBadge tone="muted">{taskPriorityLabel(task.priority)}</StatusBadge>
        </div>
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
        {updatedAt === null ? null : <span>Modifiee le {updatedAt}</span>}
        {needsAttention ? (
          <span className="text-amber-200/80">
            {/* Le mot « Document » reste francais : c'est lui qui dit de quoi
                parle la pastille, la ou l'etat lui-meme est une etiquette. */}
            · Document : {documentSyncStatusLabel(task.documentSyncStatus)}
          </span>
        ) : null}
      </p>
    </Link>
  );
}
