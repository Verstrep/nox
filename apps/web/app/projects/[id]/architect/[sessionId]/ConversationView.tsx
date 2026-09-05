import {
  ARCHITECT_CONVERSATION_VERSION,
  ARCHITECT_LIMITS,
  ARCHITECT_SESSION_KIND,
  ARCHITECT_SESSION_STATUS,
} from "@nox/shared";
import {
  canCreateArchitectTask,
  getArchitectSession,
  getDatabaseClient,
  getTaskById,
  latestArchitectProposal,
  latestArchitectQuestions,
  listArchitectSessionTasks,
  listReplanProposalsForSession,
  loadReplanPlanningState,
  type ArchitectGenerationView,
  type ArchitectSessionView,
  type Project,
} from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";
import process from "node:process";

import { ArchitectModelBadge } from "@/components/ArchitectModelBadge";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { loadTimelineProjectChanges } from "@/lib/replan/change";
import { loadReplanState } from "@/lib/replan/load";
import {
  ARCHITECT_ENVIRONMENT_VARIABLES,
  ARCHITECT_OPTIONAL_ENVIRONMENT_VARIABLES,
  loadArchitectConfig,
  nextArchitectConfiguration,
  type EffectiveArchitectConfiguration,
} from "@/lib/architect/config";
import {
  architectComposerTitle,
  architectOpeningMessage,
  type ComposerSession,
} from "@/lib/architect/composer";
import {
  CONTEXT_FINGERPRINT_NOTICE,
  architectDiagnosticView,
} from "@/lib/architect/diagnostic-display";
import { architectModelLine, proposalToFormValues } from "@/lib/architect/display";
import { PROJECT_ARCHITECT_GREETING } from "@/lib/architect/greeting";
import { loadRecentArchitectTasks } from "@/lib/architect/recent-tasks";
import { prepareArchitectTurn, type PrepareTurnResult } from "@/lib/architect/service";
import { loadTimelineProjectUpdates } from "@/lib/architect/project-update";
import { buildArchitectTimeline } from "@/lib/architect/timeline";
import { formatArchitectDuration } from "@/lib/architect/duration";
import { formatIsoDateTime } from "@/lib/format";
import { architectGenerationStatusLabel, architectSessionStatusLabel } from "@/lib/labels";
import { loadActiveProjectMemories } from "@/lib/memory";
import { planUrl } from "@/lib/plan-display";
import { loadStructuredState, projectPlanTools } from "@/lib/project-plan";
import { taskUrl } from "@/lib/task-display";

import { ChatPanel } from "./ChatPanel";
import { ComposerForm } from "./ComposerForm";
import { ContextPanel } from "./ContextPanel";
import { ConversationTimeline } from "./ConversationTimeline";
import { ProposalForm } from "./ProposalForm";
import { SendTurnForm } from "./SendTurnForm";

/**
 * Rendu d'une conversation Architecte.
 *
 * ## Deux surfaces, deux parcours
 *
 * Une **conversation projet** est un chat : on lit, on ecrit, on envoie. Elle
 * occupe la page, son composer est en bas, et l'inspection du contexte se replie
 * sous le fil. C'est le parcours quotidien d'une conversation qui accompagne un
 * projet pendant des mois.
 *
 * Une **session de conception de tache** garde son parcours en deux clics :
 * apercu obligatoire, puis envoi. Rien n'y change. Ces conversations racontent
 * comment des taches existantes ont ete concues, et reecrire leur interaction
 * reecrirait leur histoire.
 *
 * Ce qui reste commun est ce qui doit l'etre : le fil, le panneau de contexte,
 * l'editeur de proposition, l'historique des tours. Une seule implementation de
 * chacun.
 *
 * ## Ce que le rendu ne fait pas
 *
 * Il ne contacte **aucun fournisseur**. La preparation du contexte lit le
 * repository via le runner et la base ; ouvrir la page coute zero appel,
 * toujours.
 */
export async function ArchitectConversation({
  project,
  sessionId,
  backHref,
  backLabel,
}: {
  project: Project;
  sessionId: string;
  backHref: string;
  backLabel: string;
}) {
  const db = getDatabaseClient();
  const session = await getArchitectSession(db, sessionId);
  if (session === null || session.projectId !== project.id) {
    notFound();
  }

  const config = loadArchitectConfig(process.env);
  // Ce que le **prochain** appel utilisera, sans la cle. Resolu par la meme
  // fonction que l'appel lui-meme : l'ecran ne peut pas annoncer un modele et
  // en engager un autre.
  const architectConfiguration = nextArchitectConfiguration();
  const isProject = session.kind === ARCHITECT_SESSION_KIND.PROJECT;
  // Une conversation projet n'est jamais `APPLIED` : creer une tache n'y met pas
  // fin. Ce drapeau ne concerne donc que le modele historique.
  const applied = !isProject && session.status === ARCHITECT_SESSION_STATUS.APPLIED;
  const pending = session.pendingTurn;
  const readOnly = applied || !session.conversational;

  // Le contexte n'est prepare que si un tour reste possible : une conversation
  // appliquee ou historique n'enverra plus rien, et lire le repository pour
  // afficher une preview inutile ferait echouer la page quand le runner dort.
  const prepared = readOnly
    ? null
    : await prepareArchitectTurn({
        session,
        projectName: project.name,
        repositoryPath: project.repositoryPath,
        message: pending?.messageText ?? "",
        tasks: await loadRecentArchitectTasks(db, project.id),
        // Relue a chaque rendu : la preview doit decrire la memoire actuelle,
        // pas celle qui existait a l'ouverture de la conversation.
        memories: await loadActiveProjectMemories(project.id),
        structuredState: await loadStructuredState(db, project),
        projectId: project.id,
        planTools: projectPlanTools(project.repositoryPath),
        // Relu a chaque rendu, comme la memoire : l'apercu doit decrire le plan
        // actuel, pas celui qui existait a l'ouverture de la conversation.
        planningState: await loadReplanState(db, session.kind, project.id),
        model: config.ok ? config.config.model : "",
        environment: process.env,
      });

  // Evenements locaux, derives de la base : un rafraichissement les retrouve
  // tels quels, sans qu'aucun etat de navigateur soit conserve.
  const structured = await loadStructuredState(db, project);
  const proposals = await listReplanProposalsForSession(db, sessionId);

  // Une mise a jour du projet liee a une replanification n'a pas sa propre
  // carte : les deux forment un seul changement, et l'afficher deux fois
  // inviterait a le trancher en deux fois.
  const linkedUpdateIds = new Set(
    proposals
      .map((proposal) => proposal.projectUpdateId)
      .filter((id): id is string => id !== null),
  );
  const updates = (await loadTimelineProjectUpdates(db, project, sessionId, structured)).filter(
    (update) => !linkedUpdateIds.has(update.updateId),
  );

  const entries = buildArchitectTimeline(
    session.messages,
    await listArchitectSessionTasks(db, sessionId),
    updates,
    await loadTimelineProjectChanges(
      db,
      project,
      proposals,
      await loadReplanPlanningState(db, project.id),
      structured,
    ),
  );

  const shared = {
    project,
    session,
    entries,
    prepared,
    configured: config.ok,
    missingConfig: config.ok ? [] : config.missing,
    // Le modele est resolu meme sans cle : c'est bien celui qui serait
    // utilise. Ce qui manque alors est l'autorisation d'appeler, et c'est
    // `configured` qui le porte — pas le nom du modele.
    model: architectModelLine(architectConfiguration),
    architectConfiguration,
    backHref,
    backLabel,
  };

  return isProject ? (
    <ProjectChat {...shared} />
  ) : (
    <LegacyConversation {...shared} applied={applied} readOnly={readOnly} />
  );
}

type SurfaceProps = {
  project: Project;
  session: ArchitectSessionView;
  entries: ReturnType<typeof buildArchitectTimeline>;
  prepared: PrepareTurnResult | null;
  configured: boolean;
  missingConfig: readonly string[];
  model: string;
  architectConfiguration: EffectiveArchitectConfiguration;
  backHref: string;
  backLabel: string;
};

// --- Conversation projet -----------------------------------------------------

/**
 * Le chat principal d'un projet.
 *
 * Le fil occupe la hauteur de la fenetre et defile a l'interieur de son panneau ;
 * le composer reste visible en bas. La hauteur est exprimee en unites de
 * viewport, jamais en pixels : une valeur choisie pour un ecran serait fausse
 * sur tous les autres.
 */
function ProjectChat({
  project,
  session,
  entries,
  prepared,
  configured,
  missingConfig,
  model,
  architectConfiguration,
  backHref,
  backLabel,
}: SurfaceProps) {
  const proposalGeneration = latestArchitectProposal(session);
  const creatable = canCreateArchitectTask(session);
  const questions = latestArchitectQuestions(session);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-5 py-6 sm:px-8 sm:py-8">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href={backHref} className="text-xs text-zinc-500 hover:text-zinc-300">
            &larr; {backLabel}
          </Link>
          {/*
            Discret, et volontairement : le plan se consulte quand on en a
            besoin, il n'a pas a concurrencer la conversation.
          */}
          <Link href={planUrl(project.id)} className="text-xs text-zinc-500 hover:text-zinc-300">
            Project plan
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-zinc-50">Project Architect</h1>
          <StatusBadge>Active</StatusBadge>
          <span className="font-mono text-xs text-zinc-600">{session.code}</span>
          <span className="truncate text-xs text-zinc-600">{project.name}</span>
        </div>
        {/* Envoyer un message engage un appel : le modele qui le traitera se lit
            avant le clic, et non dans l'historique une fois la facture payee. */}
        <ArchitectModelBadge configuration={architectConfiguration} />
      </header>

      {configured ? null : (
        <div
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          L&apos;architecte n&apos;est pas configure : {missingConfig.join(", ")} manquante(s) dans
          le fichier <code className="font-mono text-xs">.env</code> a la racine. Vous pouvez lire
          la conversation et inspecter le contexte ; seul l&apos;envoi est bloque.
        </div>
      )}

      {/*
        Le panneau est un composant client : c'est lui qui sait qu'un envoi est
        en vol, et l'attente s'affiche a la fin du fil, loin du bouton qui la
        declenche. Le fil, lui, reste rendu par le serveur et traverse la
        frontiere en `children`.
      */}
      <ChatPanel
        projectId={project.id}
        sessionId={session.id}
        maxLength={ARCHITECT_LIMITS.request}
        messageCount={session.messages.length}
        configured={configured}
      >
        <>
          {session.messages.length === 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-zinc-100">NOX</h3>
              <p className="whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm leading-relaxed text-zinc-200">
                {PROJECT_ARCHITECT_GREETING}
              </p>
              <p className="text-xs text-zinc-600">
                Message local. Il n&apos;a coute aucun appel et n&apos;entre pas dans la
                conversation transmise.
              </p>
            </div>
          ) : (
            <ConversationTimeline
              entries={entries}
              session={session}
              projectId={project.id}
              chat
            />
          )}

          {questions.length === 0 ? null : (
            <div className="mt-5 rounded-md border border-zinc-800 px-4 py-3">
              <h3 className="text-xs font-medium text-zinc-400">
                Questions posees par l&apos;architecte
              </h3>
              <ul className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-zinc-300">
                {questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      </ChatPanel>

      {proposalGeneration === null || proposalGeneration.proposal === null ? null : (
        <SectionCard
          title="Derniere proposition"
          description="Relisez et modifiez librement. Rien n'est enregistre tant que vous n'avez pas clique."
        >
          {proposalGeneration.proposal.assumptions.length === 0 ? null : (
            <>
              <h3 className="text-xs font-medium text-zinc-400">Hypotheses de l&apos;architecte</h3>
              <ul className="my-3 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-zinc-300">
                {proposalGeneration.proposal.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </>
          )}

          {creatable ? (
            <ProposalForm
              projectId={project.id}
              sessionId={session.id}
              proposed={proposalToFormValues(proposalGeneration.proposal)}
              cancelHref={backHref}
            />
          ) : (
            <p className="text-sm leading-relaxed text-zinc-400">
              La conversation a continue depuis cette proposition, ou sa tache a deja ete creee.
              Demandez une proposition a jour avant d&apos;en creer une autre.
            </p>
          )}
        </SectionCard>
      )}

      <details className="rounded-lg border border-zinc-800">
        <summary className="cursor-pointer px-5 py-3 text-sm text-zinc-300 hover:text-zinc-100">
          Inspect context
          <span className="ml-2 text-xs text-zinc-600">
            ce qui partira au prochain envoi · aucun appel
          </span>
        </summary>
        <div className="border-t border-zinc-800 px-5 py-4">
          {prepared === null ? null : !prepared.ok ? (
            <p role="alert" className="text-sm leading-relaxed text-amber-200">
              {"code" in prepared
                ? "Le contexte n'a pas pu etre relu."
                : prepared.message}{" "}
              L&apos;historique ci-dessus reste entierement lisible.
            </p>
          ) : (
            <ContextPanel turn={prepared.turn} model={model} pendingMessage={null} staleNotice={false} />
          )}
        </div>
      </details>

      <GenerationHistory session={session} />
    </div>
  );
}

// --- Session de conception de tache -----------------------------------------

/** Le parcours de TASK-014, inchange : apercu obligatoire, puis envoi. */
function LegacyConversation({
  project,
  session,
  entries,
  prepared,
  configured,
  missingConfig,
  model,
  backHref,
  backLabel,
  applied,
  readOnly,
}: SurfaceProps & { applied: boolean; readOnly: boolean }) {
  const questions = latestArchitectQuestions(session);
  const proposalGeneration = latestArchitectProposal(session);
  const creatable = canCreateArchitectTask(session);
  const pending = session.pendingTurn;
  const composer: ComposerSession = {
    kind: session.kind,
    messageCount: session.messages.length,
    requestText: session.requestText,
  };

  const staleDraft =
    pending !== null &&
    prepared !== null &&
    prepared.ok &&
    prepared.turn.prepared.contextFingerprint !== pending.contextFingerprint;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-6">
        <Link href={backHref} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; {backLabel}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-mono text-xs text-zinc-500">{session.code}</p>
          <StatusBadge>{architectSessionStatusLabel(session.status)}</StatusBadge>
          <span className="text-xs text-zinc-600">{formatIsoDateTime(session.createdAt)}</span>
        </div>
        <h1 className="text-xl font-semibold text-zinc-50">Historical Architect conversation</h1>
        <p className="truncate text-sm text-zinc-600">{project.name}</p>
        <p className="max-w-prose text-sm leading-relaxed text-zinc-400">
          Read-only. Cette conversation a servi a concevoir une tache, selon le modele en vigueur
          avant TASK-020. NOX la conserve telle quelle et ne la poursuit pas.
        </p>
      </header>

      <main className="flex flex-col gap-6">
        <SectionCard
          title="Conversation"
          description="Tenue par NOX, en entier. Rien n'est resume, rien n'est oublie."
        >
          {session.messages.length > 0 ? null : session.conversational ? (
            <p className="text-sm leading-relaxed text-zinc-500">
              Aucun tour echange. Votre message d&apos;ouverture partira au premier envoi.
            </p>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-zinc-400">
                Cette conversation date d&apos;avant l&apos;historique conversationnel. Sa demande
                et ses precisions sont conservees telles quelles ; NOX ne reconstitue pas des tours
                qu&apos;il n&apos;a jamais enregistres.
              </p>
              <h3 className="mt-5 text-sm font-medium text-zinc-200">Demande</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
                {session.requestText}
              </p>
              {session.clarificationText === null ? null : (
                <>
                  <h3 className="mt-5 text-sm font-medium text-zinc-200">Precisions</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
                    {session.clarificationText}
                  </p>
                </>
              )}
            </>
          )}

          <ConversationTimeline entries={entries} session={session} projectId={project.id} />

          {questions.length === 0 ? null : (
            <div className="mt-5 rounded-md border border-zinc-800 px-4 py-3">
              <h3 className="text-xs font-medium text-zinc-400">
                Questions posees par l&apos;architecte
              </h3>
              <ul className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-zinc-300">
                {questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-zinc-600">
                Repondez dans le message ci-dessous, comme vous le souhaitez. Aucun formulaire
                numerote : la conversation porte desormais les precisions.
              </p>
            </div>
          )}
        </SectionCard>

        {session.conversationVersion < ARCHITECT_CONVERSATION_VERSION.CONVERSATION ? (
          <SectionCard title="Legacy conversation — read only">
            <p className="text-sm leading-relaxed text-zinc-400">
              Cette conversation a ete ouverte avant TASK-014, quand l&apos;Architecte fonctionnait
              par formulaire. Ses generations, sa consommation et sa proposition restent
              consultables, et sa tache eventuelle aussi. Elle ne se poursuit pas :{" "}
              <strong className="text-zinc-300">
                NOX ne fabrique pas des tours qu&apos;il n&apos;a jamais enregistres.
              </strong>
            </p>
          </SectionCard>
        ) : null}

        {applied ? <AppliedTaskCard session={session} projectId={project.id} /> : null}

        {configured || readOnly ? null : (
          <SectionCard title="Architect unavailable">
            <p role="alert" className="text-sm leading-relaxed text-amber-200">
              L&apos;architecte n&apos;est pas configure. Renseignez les variables suivantes dans le
              fichier <code className="font-mono text-xs">.env</code> a la racine, puis redemarrez
              l&apos;application web.
            </p>
            <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 font-mono text-xs text-zinc-400">
              {ARCHITECT_ENVIRONMENT_VARIABLES.map((name) => (
                <li key={name}>
                  {name}
                  {missingConfig.includes(name) ? " — manquante" : " — definie"}
                </li>
              ))}
              {ARCHITECT_OPTIONAL_ENVIRONMENT_VARIABLES.map((name) => (
                <li key={name} className="text-zinc-600">
                  {name} — facultative
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-zinc-600">
              Vous pouvez continuer a ecrire et a inspecter le contexte : seul l&apos;envoi est
              bloque.
            </p>
          </SectionCard>
        )}

        {prepared !== null && !prepared.ok ? (
          <SectionCard title="Contexte indisponible">
            <p role="alert" className="text-sm leading-relaxed text-amber-200">
              {"code" in prepared
                ? "Cette conversation a atteint la taille maximale que NOX accepte d'envoyer."
                : prepared.message}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-zinc-600">
              Sans contexte relu, aucun tour ne peut partir. L&apos;historique ci-dessus reste
              entierement lisible.
            </p>
          </SectionCard>
        ) : null}

        {prepared !== null && prepared.ok ? (
          <SectionCard
            title={pending === null ? "Contexte du projet" : "Next turn"}
            description="Ce qui quittera votre machine, et rien d'autre."
          >
            <ContextPanel
              turn={prepared.turn}
              model={model}
              pendingMessage={pending?.messageText ?? null}
              staleNotice={staleDraft}
            />

            {pending === null ? null : (
              <div className="mt-6 border-t border-zinc-800 pt-5">
                <SendTurnForm
                  projectId={project.id}
                  sessionId={session.id}
                  configured={configured}
                  contextChanged={prepared.turn.changes.length > 0}
                />
              </div>
            )}
          </SectionCard>
        ) : null}

        {readOnly || pending !== null ? null : (
          <SectionCard title={architectComposerTitle(composer)}>
            <ComposerForm
              projectId={project.id}
              sessionId={session.id}
              draft=""
              maxLength={ARCHITECT_LIMITS.request}
              generationsLeft={session.generationsLeft}
              openingMessage={architectOpeningMessage(composer)}
            />
          </SectionCard>
        )}

        {proposalGeneration === null || proposalGeneration.proposal === null || applied ? null : (
          <>
            {proposalGeneration.proposal.assumptions.length === 0 ? null : (
              <SectionCard
                title="Hypotheses de l'architecte"
                description="Decisions produit prises faute d'information. Elles ne sont pas enregistrees dans la tache."
              >
                <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-zinc-300">
                  {proposalGeneration.proposal.assumptions.map((assumption) => (
                    <li key={assumption}>{assumption}</li>
                  ))}
                </ul>
              </SectionCard>
            )}

            <SectionCard
              title="Latest proposal"
              description="Relisez et modifiez librement. Rien n'est enregistre tant que vous n'avez pas clique."
            >
              {creatable ? (
                <ProposalForm
                  projectId={project.id}
                  sessionId={session.id}
                  proposed={proposalToFormValues(proposalGeneration.proposal)}
                  cancelHref={backHref}
                />
              ) : (
                <p role="alert" className="text-sm leading-relaxed text-amber-200">
                  La conversation a continue depuis cette proposition. Demandez a l&apos;architecte
                  une proposition a jour avant de creer la tache : creer celle-ci reviendrait a
                  ignorer ce que vous venez de lui dire.
                </p>
              )}
            </SectionCard>
          </>
        )}

        <GenerationHistory session={session} />
      </main>
    </div>
  );
}

/** Tache produite par une session de conception, une fois celle-ci appliquee. */
async function AppliedTaskCard({
  session,
  projectId,
}: {
  session: ArchitectSessionView;
  projectId: string;
}) {
  const task =
    session.appliedTaskId === null
      ? null
      : await getTaskById(getDatabaseClient(), session.appliedTaskId);

  return (
    <SectionCard title="Tache creee">
      {task === null ? (
        <p className="text-sm text-zinc-400">
          Cette conversation a ete appliquee, mais la tache correspondante est introuvable.
        </p>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-zinc-300">
            <Link
              href={taskUrl(projectId, task.id)}
              className="font-mono text-zinc-200 underline hover:text-zinc-50"
            >
              {task.code}
            </Link>{" "}
            — {task.title}. Elle est en brouillon : c&apos;est a vous de la mettre en file quand
            elle vous convient.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            Cette conversation est close. Une conversation de conception produit une tache, et une
            seule.
          </p>
        </>
      )}
    </SectionCard>
  );
}

/** Historique des tours, avec leur modele et leur consommation. */
function GenerationHistory({ session }: { session: ArchitectSessionView }) {
  return (
    <SectionCard
      title="Historique des tours"
      description="Chaque tour reste consultable, avec son modele et sa consommation."
    >
      {session.generations.length === 0 ? (
        <p className="text-sm text-zinc-500">Aucun tour lance.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-800/80">
          {session.generations.map((generation) => (
            <li key={generation.id} className="flex flex-col gap-1.5 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xs text-zinc-500">
                  Tour {String(generation.sequence)}
                </span>
                <StatusBadge>{architectGenerationStatusLabel(generation.status)}</StatusBadge>
                <span className="text-xs text-zinc-600">
                  {formatIsoDateTime(generation.createdAt)}
                </span>
                {/* La duree reelle du tour, depuis HOTFIX-004. Absente pour les
                    tours anterieurs, dont personne n'a enregistre la fin — et
                    ne rien afficher vaut mieux que reconstruire une mesure.
                    Aucun seuil, aucune couleur : un tour long n'est pas un tour
                    malade. */}
                {generation.durationMs === null ? null : (
                  <span className="font-mono text-xs tabular-nums text-zinc-600">
                    {formatArchitectDuration(generation.durationMs)}
                  </span>
                )}
              </div>
              <p className="font-mono text-xs text-zinc-600">
                {generation.model} · {generation.promptVersion}
                {generation.contextFingerprint === null
                  ? ""
                  : ` · contexte ${generation.contextFingerprint.slice(0, 12)}`}
              </p>
              {/* La cause de l'echec, enregistree depuis HOTFIX-003. Un tour
                  anterieur n'en porte aucune, et n'affiche donc rien : NOX ne
                  reconstruit pas apres coup une cause que personne n'a
                  persistee. */}
              <FailureDetail generation={generation} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs leading-relaxed text-zinc-600">
        NOX n&apos;estime aucun cout : seuls les chiffres rapportes par le fournisseur sont
        affiches, et « non fourni » veut dire ce qu&apos;il dit.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-zinc-600">{CONTEXT_FINGERPRINT_NOTICE}</p>
    </SectionCard>
  );
}

/**
 * Pourquoi un tour a echoue, quand NOX l'a enregistre.
 *
 * Trois informations, et l'ordre compte : la nature du probleme, ou il se
 * situe, puis quoi faire. C'est exactement ce qui manquait au second pilote
 * reel — deux tours echoues sur la meme phrase generique, sans aucun moyen d'en
 * apprendre plus qu'en payant un troisieme appel.
 */
function FailureDetail({ generation }: { generation: ArchitectGenerationView }) {
  const view = architectDiagnosticView(generation.diagnostic, generation.errorCode);
  if (view === null) {
    return null;
  }

  return (
    <div className="mt-1 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs leading-relaxed">
      <p className="text-zinc-300">{view.category}</p>
      {view.fieldLabel === null && view.fieldPath === null ? null : (
        <p className="mt-1 text-zinc-400">
          {view.fieldLabel}
          {view.fieldPath === null ? null : (
            <span className="ml-2 font-mono text-[11px] text-zinc-600">{view.fieldPath}</span>
          )}
        </p>
      )}
      {view.message === null ? null : <p className="mt-1 text-zinc-500">{view.message}</p>}
      <p className="mt-1 text-zinc-600">{view.guidance}</p>
    </div>
  );
}
