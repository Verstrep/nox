import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { runUrl } from "@/lib/run-display";
import { loadProject } from "@/lib/projects";
import { loadRun } from "@/lib/runs";
import { loadTask } from "@/lib/tasks";

/**
 * Inspection technique d'une execution.
 *
 * ## Pourquoi cette page existe
 *
 * Le prompt integral et son empreinte SHA-256 sont indispensables au debug et a
 * la reproductibilite — et sans interet pour decider quoi faire d'une execution
 * terminee. Les laisser sur la page de l'execution y ajoutait un pave
 * deroulant et une chaine de soixante-quatre caracteres entre la timeline et
 * l'etat Git, sur une surface qui doit repondre a « qu'est-ce qui s'est passe,
 * et que dois-je faire maintenant ».
 *
 * Ils sont donc **deplaces**, jamais supprimes : rien de ce qui servait au debug
 * n'a disparu, tout est a un clic.
 *
 * ## Ce que cette page ne fait pas
 *
 * Elle lit la base et rien d'autre : ni repository, ni runner, ni fournisseur.
 * Le prompt affiche est celui qui a ete transmis au processus, conserve tel
 * quel, et il ne peut plus changer.
 */
export default async function RunInspectPage({
  params,
}: {
  params: Promise<{ id: string; taskId: string; runId: string }>;
}) {
  const { id, taskId, runId } = await params;

  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const task = await loadTask(taskId);
  if (task === null || task.projectId !== project.id) {
    notFound();
  }

  const run = await loadRun(runId);
  if (run === null || run.taskId !== task.id) {
    notFound();
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6">
        <Link
          href={runUrl(project.id, task.id, run.id)}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          &larr; Retour à l&apos;exécution
        </Link>
        <div>
          <p className="font-mono text-xs text-zinc-500">
            {task.code} · {run.code}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-50">Inspect run</h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-400">
            Les détails techniques de cette exécution : ce qui a réellement été transmis au
            processus, et l&apos;empreinte qui permet de le vérifier. Rien ici ne change quoi que
            ce soit.
          </p>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        <SectionCard
          title="Prompt envoyé"
          description="Conservé exactement tel qu'il a été transmis au processus."
        >
          <pre className="max-h-[60vh] overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
            {run.prompt}
          </pre>
        </SectionCard>

        <SectionCard
          title="Empreintes"
          description="Ce qui identifie cette exécution de façon reproductible."
        >
          <dl className="grid gap-4">
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Prompt SHA-256</dt>
              <dd className="mt-1 break-all font-mono text-sm text-zinc-300">
                {run.promptSha256}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Session Claude</dt>
              <dd className="mt-1 break-all font-mono text-sm text-zinc-300">
                {run.claude.sessionId ?? "-"}
              </dd>
            </div>
          </dl>
        </SectionCard>
      </main>
    </div>
  );
}
