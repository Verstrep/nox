import {
  TASK_DOCUMENT_SYNC_STATUS,
  TASK_STATUS,
  buildClaudeToolPolicy,
} from "@nox/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { RunnerStatusBadge } from "@/components/RunnerStatusBadge";
import { documentSyncStatusLabel, taskStatusLabel } from "@/lib/labels";
import { loadProject } from "@/lib/projects";
import { shortSha } from "@/lib/run-display";
import { buildExecutionPrompt } from "@/lib/run-prompt";
import { loadPreflight } from "@/lib/runs";
import { taskStatusTone } from "@/lib/task-display";
import { loadTask } from "@/lib/tasks";

import { StartRunForm } from "./StartRunForm";

/** Ligne d'une liste de preconditions : verte si remplie, ambre sinon. */
function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex gap-2 text-sm ${met ? "text-zinc-400" : "text-amber-200"}`}>
      <span aria-hidden="true">{met ? "✓" : "✗"}</span>
      <span>{children}</span>
    </li>
  );
}

export default async function NewRunPage({
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
  if (task === null || task.projectId !== project.id) {
    notFound();
  }

  // Le prompt affiche est produit par la meme fonction que celle de la Server
  // Action : ce qui est montre est exactement ce qui sera envoye.
  const { prompt, sha256 } = buildExecutionPrompt(task);
  const policy = buildClaudeToolPolicy(task.validationCommands, task.kind);
  const preflight = await loadPreflight(project.repositoryPath);

  const isReady = task.status === TASK_STATUS.READY;
  const isSynced = task.documentSyncStatus === TASK_DOCUMENT_SYNC_STATUS.SYNCED;
  const hasCriteria = task.acceptanceCriteria.length > 0;
  const canLaunch = isReady && isSynced && hasCriteria && policy.ok && preflight.ok;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6">
        <Link
          href={`/projects/${project.id}/tasks/${task.id}`}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          &larr; Retour a la tache
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-zinc-500">{task.code}</p>
            <h1 className="mt-1 text-xl font-semibold text-zinc-50">{task.title}</h1>
            <p className="mt-1 truncate text-sm text-zinc-600">{project.name}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <RunnerStatusBadge />
            <StatusBadge tone={taskStatusTone(task.status)}>
              {taskStatusLabel(task.status)}
            </StatusBadge>
          </div>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        <p
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          Claude Code modifiera directement le repository local. Aucun commit ni push ne sera cree.
          Verifiez que votre etat actuel est bien commit et push avant de lancer.
        </p>

        <SectionCard
          title="Preconditions"
          description="Toutes doivent etre remplies pour que le lancement soit possible."
        >
          <ul className="flex flex-col gap-2">
            <Requirement met={isReady}>
              La tache est au statut « Ready » (actuellement : {taskStatusLabel(task.status)}).
            </Requirement>
            <Requirement met={isSynced}>
              Son document Markdown est synchronise (actuellement :{" "}
              {documentSyncStatusLabel(task.documentSyncStatus)}).
            </Requirement>
            <Requirement met={hasCriteria}>
              Elle possede au moins un critere d&apos;acceptation.
            </Requirement>
            <Requirement met={policy.ok}>
              {policy.ok
                ? "Toutes les commandes de validation peuvent etre autorisees."
                : `La commande « ${policy.refusal.command} » ne peut pas etre autorisee : ${policy.refusal.reason}`}
            </Requirement>
            <Requirement met={preflight.ok}>
              {preflight.ok
                ? "Le repository et Claude Code sont prets."
                : preflight.message}
            </Requirement>
          </ul>
        </SectionCard>

        <SectionCard
          title="Etat du repository"
          description="Verifie par le runner, en lecture seule, sans acces reseau."
        >
          {preflight.ok ? (
            <>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">Claude Code</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-300">
                    {preflight.preflight.claude.version}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">Branche</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-300">
                    {preflight.preflight.git.branch}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">Upstream</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-300">
                    {preflight.preflight.git.upstream}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">HEAD</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-300">
                    {shortSha(preflight.preflight.git.head)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">
                    Etat de travail
                  </dt>
                  <dd className="mt-1 text-sm text-zinc-300">
                    {preflight.preflight.git.clean ? "Propre" : "Modifications non commitees"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">
                    Avance / retard
                  </dt>
                  <dd className="mt-1 text-sm text-zinc-300">
                    {preflight.preflight.git.ahead} en avance ·{" "}
                    {preflight.preflight.git.behind} en retard
                  </dd>
                </div>
              </dl>

              <p className="mt-5 text-xs leading-relaxed text-zinc-600">
                L&apos;avance et le retard sont mesures contre la reference distante{" "}
                <strong>telle que cette machine la connait</strong>, c&apos;est-a-dire depuis votre
                dernier <code className="font-mono">git fetch</code>. NOX ne contacte pas le serveur
                distant et ne peut donc pas garantir que la branche est a jour vis-a-vis de lui.
              </p>
            </>
          ) : (
            <p className="text-sm text-amber-200">{preflight.message}</p>
          )}
        </SectionCard>

        <SectionCard
          title="Commandes autorisees"
          description="Les seules commandes applicatives que Claude Code pourra executer."
        >
          {policy.ok ? (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  Validations enregistrees avec la tache
                </p>
                {policy.policy.authorizedCommands.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">
                    Aucune commande de validation n&apos;est enregistree.
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {policy.policy.authorizedCommands.map((command) => (
                      <li key={command} className="font-mono text-sm text-zinc-300">
                        {command}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/*
                Ce bloc n'existe que pour une tache d'amorcage. Le montrer partout
                laisserait croire qu'une tache ordinaire dispose des memes
                programmes — elle n'en dispose d'aucun.
              */}
              {policy.policy.setupPrograms.length > 0 ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">
                    Programmes d&apos;amorcage autorises
                  </p>
                  <p className="mt-2 text-sm text-zinc-400">
                    Cette tache choisit sa pile technique pendant son execution : ses commandes
                    d&apos;installation ne pouvaient pas etre enregistrees avant. Elle peut lancer
                    ces programmes, et eux seuls, dans le repository du projet.
                  </p>
                  <p className="mt-3 font-mono text-sm leading-relaxed text-zinc-300">
                    {policy.policy.setupPrograms.join("  ·  ")}
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-amber-200">
              {`« ${policy.refusal.command} » : ${policy.refusal.reason}`}
            </p>
          )}

          <p className="mt-5 text-xs leading-relaxed text-zinc-600">
            S&apos;y ajoutent la lecture et la modification de fichiers, la recherche dans le code,
            et Git en <strong>lecture seule</strong>. Le commit, le push, la suppression de fichiers
            et les commandes reseau sont explicitement refuses
            {policy.ok && policy.policy.setupPrograms.length > 0
              ? ", comme la publication, le deploiement, l'acces a une machine distante et l'elevation de privileges"
              : ""}
            .
          </p>
        </SectionCard>

        <SectionCard
          title="Prompt envoye"
          description="Genere a partir de la tache. Non modifiable : une execution doit rester reproductible."
        >
          <pre className="max-h-[40vh] overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
            {prompt}
          </pre>
          <p className="mt-3 break-all font-mono text-xs text-zinc-600">SHA-256 : {sha256}</p>
        </SectionCard>

        <SectionCard title="Lancement">
          <StartRunForm
            projectId={project.id}
            taskId={task.id}
            expectedGitHead={preflight.ok ? preflight.preflight.git.head : ""}
            canLaunch={canLaunch}
          />
        </SectionCard>
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-600">
        Une seule execution peut etre active a la fois, tous projets confondus. Fermer cette page
        n&apos;interrompt pas l&apos;execution ; redemarrer le runner, si.
      </footer>
    </div>
  );
}
