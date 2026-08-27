import { getDatabaseClient } from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/SectionCard";
import {
  DELIVERY_COMMIT_ACTION,
  DELIVERY_COMMIT_PUSH_ACTION,
  DELIVERY_REFRESH_ACTION,
  DELIVERY_RETRY_PUSH_ACTION,
  DELIVERY_RETRY_PUSH_NOTICE,
  DELIVERY_SAFETY_NOTICE,
  deliveryPolicyExplanation,
  deliveryPolicyLabel,
  deliveryRefusalLabel,
  deliveryRefusalMessage,
  deliverySettingsUrl,
  deliveryStateLabel,
  deliveryTriggerLabel,
  upstreamLabel,
} from "@/lib/delivery-display";
import { loadDeliveryView, pushUnavailableReason } from "@/lib/delivery-view";
import { formatDateTime } from "@/lib/format";
import { loadProject } from "@/lib/projects";
import { loadTask } from "@/lib/tasks";

import { DeliveryActionForm } from "./DeliveryActionForm";

/**
 * Surface de livraison Git d'une tache.
 *
 * ## Ce que cette page coute
 *
 * Quelques lectures SQLite et **une** inspection Git en lecture seule — trois
 * commandes `git` qui ne creent, ne modifient, ne suppriment et ne poussent
 * rien. Rafraichir vingt fois produit vingt inspections et zero ecriture. La
 * livraison, elle, est declenchee par la transition d'une tache vers `COMPLETED`
 * ou par un clic sur cette page, jamais par un rendu.
 *
 * ## Ce qu'elle montre
 *
 * La politique du projet, l'etat de la livraison, le candidat exact — branche,
 * `HEAD` attendu, fichiers — le message de commit, l'empreinte du commit cree
 * s'il existe, l'upstream si la politique le concerne, et l'action qui reste a
 * faire. Pas un client Git : de quoi decider, et rien de plus.
 *
 * L'URL du remote n'est jamais affichee — elle peut porter des identifiants, et
 * `origin/main` dit tout ce qu'un lecteur a besoin de savoir.
 */
export default async function TaskDeliveryPage({
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

  const view = await loadDeliveryView(getDatabaseClient(), {
    projectId: project.id,
    taskId: task.id,
  });
  if (view === null) {
    notFound();
  }

  const delivery = view.delivery;
  const pushRefusal = pushUnavailableReason(view);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6">
        <Link
          href={`/projects/${project.id}/tasks/${task.id}`}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          &larr; Retour à {task.code}
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Git delivery</h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-400">
            Ce que NOX livrerait pour {task.code}, et ce qu&apos;il en a fait. Ouvrir cette page
            n&apos;écrit rien dans Git.
          </p>
        </div>
      </header>

      <main className="flex flex-col gap-8">
        <SectionCard
          title="Policy"
          description="Ce que ce projet autorise NOX à écrire dans Git."
          action={
            <Link
              href={deliverySettingsUrl(project.id)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Changer dans les réglages
            </Link>
          }
        >
          <p className="text-sm font-medium text-zinc-100">{deliveryPolicyLabel(view.policy)}</p>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-500">
            {deliveryPolicyExplanation(view.policy)}
          </p>
        </SectionCard>

        {delivery === null ? (
          <SectionCard
            title="Delivery"
            description="Aucun candidat de livraison n'est enregistré pour cette tâche."
          >
            <p className="max-w-prose text-sm leading-relaxed text-zinc-400">
              {view.unavailable === null
                ? "NOX n'a pas pu relire l'état du repository au moment où la tâche a été validée — " +
                  "le runner était sans doute arrêté. Aucune écriture Git n'a eu lieu."
                : deliveryRefusalMessage(view.unavailable)}
            </p>

            {view.actions.refresh ? (
              <div className="mt-5">
                <DeliveryActionForm
                  kind="refresh"
                  projectId={project.id}
                  taskId={task.id}
                  deliveryId={null}
                  label={DELIVERY_REFRESH_ACTION}
                  pendingLabel="Relecture…"
                />
              </div>
            ) : null}
          </SectionCard>
        ) : (
          <>
            <SectionCard
              title="Status"
              description="Où en est la livraison de ce travail validé."
            >
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">État</dt>
                  <dd className="mt-1 text-sm text-zinc-200">
                    {deliveryStateLabel(delivery.status, delivery.errorCode)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">Origine</dt>
                  <dd className="mt-1 text-sm text-zinc-200">
                    {deliveryTriggerLabel(delivery.trigger)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">Branche</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-300">
                    {delivery.expectedBranch}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">Upstream</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-300">
                    {upstreamLabel(
                      delivery.expectedBranch,
                      delivery.upstreamRemote,
                      delivery.upstreamRef,
                    ) ?? "Aucun upstream configuré"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">
                    HEAD avant livraison
                  </dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-300">
                    {delivery.expectedHead.slice(0, 12)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-zinc-600">Commit</dt>
                  <dd className="mt-1 font-mono text-sm text-zinc-300">
                    {delivery.commitSha === null
                      ? "Aucun commit créé"
                      : delivery.commitSha.slice(0, 12)}
                  </dd>
                </div>
                {delivery.committedAt === null ? null : (
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-zinc-600">Commité le</dt>
                    <dd className="mt-1 text-sm text-zinc-300">
                      {formatDateTime(delivery.committedAt)}
                    </dd>
                  </div>
                )}
                {delivery.pushedAt === null ? null : (
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-zinc-600">Poussé le</dt>
                    <dd className="mt-1 text-sm text-zinc-300">
                      {formatDateTime(delivery.pushedAt)}
                    </dd>
                  </div>
                )}
              </dl>

              {delivery.errorCode === null ? null : (
                <div className="mt-5 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3">
                  <p className="text-sm font-medium text-amber-200">
                    {deliveryRefusalLabel(delivery.errorCode)}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-amber-200/80">
                    {delivery.errorMessage ?? deliveryRefusalMessage(delivery.errorCode)}
                  </p>
                </div>
              )}

              {view.matchesCandidate === false && !view.deliveredExternally ? (
                <p className="mt-5 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200">
                  Repository changed after validation. NOX will not commit unvalidated changes.
                </p>
              ) : null}

              {view.deliveredExternally ? (
                <p className="mt-5 rounded-md border border-zinc-700 bg-zinc-900/40 px-4 py-3 text-sm leading-relaxed text-zinc-300">
                  Delivered externally — le dossier de travail est propre et HEAD a avancé depuis
                  l&apos;état validé. NOX n&apos;a rien écrit, et n&apos;essaie pas de deviner quel
                  commit correspondait à ce travail.
                </p>
              ) : null}

              {view.repository === null ? (
                <p className="mt-5 text-sm leading-relaxed text-zinc-500">
                  L&apos;état actuel du repository n&apos;a pas pu être lu : le runner est
                  peut-être arrêté. Cette page reste lisible, et rien n&apos;a été écrit.
                </p>
              ) : null}
            </SectionCard>

            <SectionCard
              title="Candidate"
              description="Les chemins exacts qui seraient préparés. NOX n'utilise jamais un git add sans liste fermée."
            >
              <p className="text-xs uppercase tracking-wider text-zinc-600">Message de commit</p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950/60 px-4 py-3 font-mono text-xs leading-relaxed text-zinc-300">
                {delivery.commitMessage}
              </pre>

              <p className="mt-5 text-xs uppercase tracking-wider text-zinc-600">
                Fichiers ({delivery.candidate.length})
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {delivery.candidate.map((entry) => (
                  <li key={entry.path} className="flex gap-3 font-mono text-xs text-zinc-400">
                    <span className="w-6 shrink-0 text-zinc-600">{entry.code.trim() || "??"}</span>
                    <span className="break-all">{entry.path}</span>
                  </li>
                ))}
              </ul>

              {view.sensitivePaths.length === 0 ? null : (
                <p className="mt-5 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200">
                  Un fichier manifestement sensible apparaîtrait pour la première fois :{" "}
                  {view.sensitivePaths.join(", ")}. NOX ne le livre pas.
                </p>
              )}
            </SectionCard>

            <SectionCard
              title="Actions"
              description="Les mêmes gardes que la livraison automatique. Manuel ne veut jamais dire « sans vérification »."
            >
              <div className="flex flex-col gap-6">
                {view.actions.commit ? (
                  <DeliveryActionForm
                    kind="commit"
                    projectId={project.id}
                    taskId={task.id}
                    deliveryId={delivery.id}
                    label={DELIVERY_COMMIT_ACTION}
                    pendingLabel="Commit…"
                    emphasis
                  />
                ) : null}

                {view.actions.commitAndPush ? (
                  <DeliveryActionForm
                    kind="commit-push"
                    projectId={project.id}
                    taskId={task.id}
                    deliveryId={delivery.id}
                    label={DELIVERY_COMMIT_PUSH_ACTION}
                    pendingLabel="Commit et push…"
                  />
                ) : null}

                {view.actions.retryPush ? (
                  <div className="flex flex-col gap-3">
                    <DeliveryActionForm
                      kind="retry-push"
                      projectId={project.id}
                      taskId={task.id}
                      deliveryId={delivery.id}
                      label={DELIVERY_RETRY_PUSH_ACTION}
                      pendingLabel="Push…"
                      emphasis
                    />
                    <p className="max-w-prose text-xs leading-relaxed text-zinc-600">
                      {DELIVERY_RETRY_PUSH_NOTICE}
                    </p>
                  </div>
                ) : null}

                {pushRefusal === null ? null : (
                  <p className="max-w-prose text-sm leading-relaxed text-zinc-500">
                    {deliveryRefusalMessage(pushRefusal)}
                  </p>
                )}

                {view.satisfied ? (
                  <p className="max-w-prose text-sm leading-relaxed text-zinc-400">
                    La politique de livraison de ce projet est satisfaite : la file peut continuer.
                  </p>
                ) : null}
              </div>

              <p className="mt-6 max-w-prose border-t border-zinc-800/70 pt-5 text-xs leading-relaxed text-zinc-600">
                {DELIVERY_SAFETY_NOTICE}
              </p>
            </SectionCard>
          </>
        )}
      </main>
    </div>
  );
}
