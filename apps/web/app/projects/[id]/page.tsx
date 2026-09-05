import { ARCHITECT_SESSION_KIND, TASK_STATUS } from "@nox/shared";
import {
  collectProjectMetrics,
  findProjectArchitectSession,
  getBlockingDelivery,
  getDatabaseClient,
  listArchitectSessions,
  readProjectDeliveryPolicy,
} from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProjectNav } from "@/components/ProjectNav";
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
import { formatIsoDateTime } from "@/lib/format";
import { taskStatusLabel } from "@/lib/labels";
import {
  briefSectionState,
  planSectionState,
  planSectionStateLabel,
  planUrl,
} from "@/lib/plan-display";
import { loadStructuredState } from "@/lib/project-plan";
import {
  METRICS_NOTICE,
  costRows,
  humanDecisionRows,
  verificationRows,
  workRows,
  type MetricRow,
} from "@/lib/project-metrics-display";
import { loadProject, loadQueue } from "@/lib/projects";
import { formatReportedCost } from "@/lib/run-display";
import { breakdownLabel, countTasksByStatus, taskBreakdown, taskStatusTone } from "@/lib/task-display";

import {
  deliveryPolicyLabel,
  deliveryRefusalLabel,
  deliveryStateLabel,
  deliverySettingsUrl,
  deliveryUrl,
} from "@/lib/delivery-display";
import { queueStateLabel, queueUrl } from "@/lib/queue-display";
import { loadProjectTasks } from "@/lib/tasks";

/**
 * Un bloc de compteurs.
 *
 * Chaque valeur est deja formatee par `project-metrics-display.ts` : une case
 * ne recoit jamais un nombre brut, parce que « non rapporte » est une reponse
 * possible et qu'un `0` a sa place mentirait.
 */
function MetricGroup({ title, rows }: { title: string; rows: readonly MetricRow[] }) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-zinc-600">{title}</h3>
      <dl className="mt-3 flex flex-col gap-3">
        {rows.map((entry) => (
          <div key={entry.label}>
            <dt className="text-xs text-zinc-500">{entry.label}</dt>
            <dd className="mt-0.5 text-sm font-medium text-zinc-200">{entry.value}</dd>
            {entry.detail === null ? null : (
              <p className="text-xs text-zinc-600">{entry.detail}</p>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}

function TaskCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-zinc-600">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-zinc-200">{value}</dd>
    </div>
  );
}

/**
 * Page d'un projet.
 *
 * ## L'ordre des sections
 *
 * Il suit le chemin du travail : l'Architecte, puis le plan qu'on en tire, le
 * backlog qui en decoule, l'amorcage du repository, et enfin les taches. Les
 * surfaces de consultation — documents, memoire — viennent apres, sans pretendre
 * etre des etapes.
 *
 * ## Ce qui a disparu en TASK-025
 *
 * Une carte « Executions — A venir » annoncait une fonctionnalite livree depuis
 * longtemps, et un pied de page expliquait comment lire des sections qui
 * n'existent plus. Les metadonnees techniques du repository — dates
 * d'enregistrement, phrase de validation Git — sont parties dans Project
 * settings, ou elles servent : cette page repond a « ou en est ce projet », pas
 * a « qu'est-ce que NOX a enregistre a son sujet ».
 */
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

  // La file vient de SQLite : aucune sonde du repository ici. Cette page dit
  // combien de taches attendent, pas si elles pourraient partir.
  const queue = await loadQueue(project.id);

  // La politique Git et la derniere livraison, lues en base. Aucune commande
  // Git, aucun appel au runner : ouvrir un projet n'inspecte pas son
  // repository, et n'y ecrit evidemment rien.
  const deliveryPolicy = await readProjectDeliveryPolicy(getDatabaseClient(), project.id);
  const blockingDelivery = await getBlockingDelivery(getDatabaseClient(), project.id);

  // Un lot d'agregats, emis ensemble, jamais une requete par tache. Rien n'est
  // mis en cache : ces nombres se recalculent a chaque rendu, ce qui est la
  // seule facon qu'ils restent vrais apres une reouverture ou une correction.
  const metrics = await collectProjectMetrics(db, project.id);

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
          &larr; Retour aux projets
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-zinc-50">{project.name}</h1>
            {project.description === null ? null : (
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-400">
                {project.description}
              </p>
            )}
            <p
              className="mt-2 truncate font-mono text-xs text-zinc-600"
              title={project.repositoryPath}
            >
              {project.repositoryPath}
            </p>
          </div>
          <StatusBadge tone="neutral">{project.status}</StatusBadge>
        </div>

        <ProjectNav projectId={project.id} />
      </header>

      <main className="flex flex-col gap-8">
        <SectionCard
          title="Architecte"
          description="La conversation durable de ce projet : concevoir, décider, préparer la suite."
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
            L&apos;architecte lit les documents du projet, sa mémoire et ses tâches récentes. Il
            répond, compare des options, et propose une tâche quand un prochain incrément est
            clair &mdash; vous la relisez avant de la créer. Créer une tâche ne ferme pas la
            conversation : vous y revenez pour la suite.
          </p>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-zinc-500">
            Il ne lance rien, ne modifie aucun fichier, et ne voit ni le code, ni les diffs, ni les
            sorties de Claude Code. Ouvrir la conversation ne coûte aucun appel.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-800 pt-4 text-xs text-zinc-600">
            {architect === null ? (
              <span>Aucun tour échangé pour le moment.</span>
            ) : (
              <span>
                {architect.generationCount === 0
                  ? "Aucun tour échangé"
                  : architect.generationCount === 1
                    ? "1 tour échangé"
                    : `${String(architect.generationCount)} tours échangés`}{" "}
                · dernière activité {formatIsoDateTime(architect.updatedAt)}
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
            Cet état accompagne chaque conversation Architecte, et prime sur la documentation du
            repository pour l&apos;intention produit. NOX ne le modifie jamais seul : une
            proposition de l&apos;Architecte attend toujours votre validation.
          </p>
        </SectionCard>

        <SectionCard
          title="V1 Backlog"
          description="Le travail d'implémentation restant pour atteindre le Living V1 Plan."
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
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Tâches créées</dt>
              <dd className="mt-1 text-sm text-zinc-300">
                {backlogTaskCountLabel(backlog.lastAppliedTasks.length)}
              </dd>
            </div>
          </dl>

          <p className="mt-5 max-w-prose text-sm leading-relaxed text-zinc-400">
            Générer un backlog est une action explicite, qui engage un appel au fournisseur. Aucune
            tâche n&apos;est créée tant que vous n&apos;avez pas appliqué un backlog vous-même.
          </p>
        </SectionCard>

        {/*
          Amorcage : une carte compacte, et un lien. L'etat affiche est derive de
          la tache elle-meme — NOX ne tient aucun second cycle de vie.
        */}
        <SectionCard
          title="Bootstrap"
          description="TASK-000 prépare le repository avant les tâches produit."
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
              <dt className="text-xs uppercase tracking-wider text-zinc-600">État</dt>
              <dd className="mt-1 text-sm text-zinc-300">
                {bootstrapTask === null
                  ? "Not prepared"
                  : `${bootstrapTask.code} · ${taskStatusLabel(bootstrapTask.status)}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Exécution</dt>
              <dd className="mt-1 text-sm text-zinc-300">
                Toujours explicite : créer TASK-000 ne lance rien.
              </dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard
          title="Tâches"
          description="Unités de travail structurées, enregistrées dans la base locale de NOX."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/projects/${project.id}/tasks`}
                className="inline-block rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50"
              >
                Voir les tâches
              </Link>
              <Link
                href={`/projects/${project.id}/tasks/new`}
                className="inline-block rounded-md bg-teal-400/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-300"
              >
                Nouvelle tâche
              </Link>
            </div>
          }
        >
          <dl className="grid grid-cols-3 gap-4">
            <TaskCount label="Total" value={tasks.length} />
            <TaskCount
              label={taskStatusLabel(TASK_STATUS.READY)}
              value={taskCounts[TASK_STATUS.READY]}
            />
            <TaskCount
              label={taskStatusLabel(TASK_STATUS.BLOCKED)}
              value={taskCounts[TASK_STATUS.BLOCKED]}
            />
          </dl>

          {/* La repartition complete, dans l'ordre du workflow et sans les
              statuts vides. Les trois chiffres ci-dessus repondent a « combien
              de travail reste » ; cette ligne repond a « ou en est-il ». */}
          {taskBreakdown(taskCounts).length === 0 ? null : (
            <ul className="mt-5 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-4">
              {taskBreakdown(taskCounts).map((entry) => (
                <li key={entry.status}>
                  <StatusBadge tone={taskStatusTone(entry.status)}>
                    {breakdownLabel(entry)}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Project activity"
          description="Ce que ce projet a réellement produit, décidé et consommé."
        >
          <div className="grid gap-8 sm:grid-cols-2">
            <MetricGroup title="Travail" rows={workRows(metrics)} />
            <MetricGroup title="Vérification" rows={verificationRows(metrics)} />
            <MetricGroup title="Décisions humaines" rows={humanDecisionRows(metrics)} />
            <MetricGroup title="Consommation" rows={costRows(metrics, formatReportedCost)} />
          </div>

          {/* Affiche, et pas seulement ecrit dans le code : quelqu'un finira par
              citer un de ces nombres, et il doit savoir ce qu'il ne dit pas. */}
          <p className="mt-6 max-w-prose border-t border-zinc-800 pt-4 text-xs leading-relaxed text-zinc-500">
            {METRICS_NOTICE}
          </p>
        </SectionCard>

        <SectionCard
          title="Execution queue"
          description="Les tâches inscrites, et l'ordre dans lequel NOX les prendra."
          action={
            <Link
              href={queueUrl(project.id)}
              className="inline-block rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50"
            >
              Open queue
            </Link>
          }
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">Queued</dt>
              <dd className="mt-1 text-sm text-zinc-300">
                {queue.queuedCount === 0
                  ? "Aucune tâche inscrite"
                  : `${String(queue.queuedCount)} queued`}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-zinc-600">État</dt>
              <dd className="mt-1 text-sm text-zinc-300">
                {queue.active ? "Active" : "Paused"} · {queueStateLabel(queue.state)}
              </dd>
            </div>
          </dl>

          <p className="mt-5 max-w-prose text-sm leading-relaxed text-zinc-400">
            Inscrire une tâche ne lance rien. Démarrer la file ouvre une autorisation permanente,
            qui reste soumise aux dépendances, à la review et aux préconditions du repository.
          </p>
        </SectionCard>

        <SectionCard
          title="Git delivery"
          description="Ce que NOX a le droit d'écrire dans Git après une tâche validée."
          action={
            <Link
              href={deliverySettingsUrl(project.id)}
              className="inline-block rounded-md border border-zinc-700 bg-zinc-800/70 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-50"
            >
              Change policy
            </Link>
          }
        >
          <p className="text-sm text-zinc-200">{deliveryPolicyLabel(deliveryPolicy)}</p>

          {blockingDelivery === null ? null : (
            <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3">
              <p className="text-sm font-medium text-amber-200">
                {blockingDelivery.errorCode === null
                  ? deliveryStateLabel(blockingDelivery.status, null)
                  : deliveryRefusalLabel(blockingDelivery.errorCode)}
              </p>
              <Link
                href={deliveryUrl(project.id, blockingDelivery.taskId)}
                className="mt-2 inline-block text-xs text-amber-200 underline underline-offset-4 hover:text-amber-100"
              >
                Open delivery
              </Link>
            </div>
          )}

          <p className="mt-5 max-w-prose text-sm leading-relaxed text-zinc-400">
            Ce réglage est indépendant de la file : « Start queue » autorise NOX à lancer
            Claude Code, jamais à écrire dans Git.
          </p>
        </SectionCard>

        <SectionCard
          title="Mémoire"
          description="Ce que NOX retient de ce projet : décisions, contraintes, conventions, connaissances durables."
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
            Les entrées actives accompagnent chaque conversation Architecte de ce projet, sans avoir
            à être réexpliquées. Rien n&apos;y entre automatiquement : ni depuis une conversation,
            ni depuis une proposition, ni depuis une exécution de Claude Code.
          </p>
        </SectionCard>

        <SectionCard
          title="Documents"
          description="Documents Markdown de référence présents dans le repository."
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
                ? "Aucun document Markdown trouvé dans les emplacements inspectés."
                : `${String(documents.documents.length)} document(s) Markdown détecté(s).`}
            </p>
          ) : (
            <p className="text-sm text-amber-200/90">{documents.message}</p>
          )}
        </SectionCard>
      </main>
    </div>
  );
}
