import { getDatabaseClient, listDependencyIds } from "@nox/database";
import { checkTaskEditable } from "@nox/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { taskStatusLabel } from "@/lib/labels";
import { loadProject } from "@/lib/projects";
import { loadTaskRuns } from "@/lib/runs";
import { taskStatusTone, taskUrl } from "@/lib/task-display";
import { taskEditFormValues, taskEditRefusalMessage, taskRevisionOf } from "@/lib/task-edit";
import { loadDependencyCandidates, loadTask } from "@/lib/tasks";

import { EditTaskForm } from "./EditTaskForm";

/**
 * Edition d'une tache future.
 *
 * ## Ce que cette page verifie, et ce qu'elle ne decide pas
 *
 * Elle refuse d'afficher le formulaire pour une tache figee ou dans un statut
 * qui ne s'edite pas. Ce refus est un **confort** : la Server Action le refait,
 * dans la transaction, sur l'etat du moment. Un formulaire affiche ne donne
 * aucun droit.
 *
 * ## Aucun appel, aucun effet
 *
 * L'ouvrir ne coute rien : ni OpenAI, ni Claude Code, ni runner. Ce sont trois
 * lectures SQLite, et la page fonctionne runner arrete.
 */
export default async function EditTaskPage({
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
  // Une tache d'un autre projet est traitee comme inexistante : l'URL ne doit pas
  // permettre de constater qu'un identifiant existe ailleurs.
  if (task === null || task.projectId !== project.id) {
    notFound();
  }

  const runs = await loadTaskRuns(task.id);
  const gate = checkTaskEditable({ status: task.status, runCount: runs.length });

  const backHref = taskUrl(project.id, task.id);

  if (!gate.ok) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
        <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6">
          <Link href={backHref} className="text-xs text-zinc-500 hover:text-zinc-300">
            &larr; Retour a la tache
          </Link>
          <h1 className="text-xl font-semibold text-zinc-50">
            {task.code} n&apos;est plus modifiable
          </h1>
        </header>

        <main>
          <SectionCard title="Specification figee">
            <p className="text-sm leading-relaxed text-zinc-400">
              {taskEditRefusalMessage(gate.code)}
            </p>
            <Link
              href={backHref}
              className="mt-5 inline-block rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
            >
              Retour a la tache
            </Link>
          </SectionCard>
        </main>
      </div>
    );
  }

  const db = getDatabaseClient();
  const dependsOnTaskIds = await listDependencyIds(db, task.id);
  const candidates = (await loadDependencyCandidates(project.id)).filter(
    (candidate) => candidate.id !== task.id,
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6">
        <Link href={backHref} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour a la tache
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-zinc-500">{task.code}</p>
            <h1 className="mt-1 text-xl font-semibold text-zinc-50">Edit task</h1>
            <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
          </div>
          <StatusBadge tone={taskStatusTone(task.status)}>
            {taskStatusLabel(task.status)}
          </StatusBadge>
        </div>

        <p className="max-w-prose text-xs leading-relaxed text-zinc-600">
          Cette tache n&apos;a jamais ete executee : sa specification est encore un projet,
          pas un fait. Son code, sa nature et sa provenance, eux, ne changent pas.
        </p>
      </header>

      <main>
        <EditTaskForm
          projectId={project.id}
          taskId={task.id}
          taskCode={task.code}
          initialValues={taskEditFormValues(task, dependsOnTaskIds)}
          revision={taskRevisionOf(task, dependsOnTaskIds)}
          candidates={candidates}
          cancelHref={backHref}
        />
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        Modifier une tache n&apos;appelle aucune IA et ne touche pas a Git. Seul le document{" "}
        <code className="font-mono">{task.documentPath}</code> est reecrit, et uniquement si le
        contrat change.
      </footer>
    </div>
  );
}
