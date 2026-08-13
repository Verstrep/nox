import {
  ARCHITECT_CONVERSATION_VERSION,
  ARCHITECT_LIMITS,
  ARCHITECT_MESSAGE_ROLE,
  ARCHITECT_SESSION_STATUS,
  isProjectMemoryCategory,
} from "@nox/shared";
import {
  architectProposalOfMessage,
  canCreateArchitectTask,
  getArchitectSession,
  getDatabaseClient,
  getTaskById,
  latestArchitectProposal,
  latestArchitectQuestions,
} from "@nox/database";
import Link from "next/link";
import { notFound } from "next/navigation";
import process from "node:process";

import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import {
  ARCHITECT_ENVIRONMENT_VARIABLES,
  loadArchitectConfig,
} from "@/lib/architect/config";
import {
  architectUrl,
  formatChars,
  manifestRows,
  manifestTaskCount,
  memoryRows,
  proposalToFormValues,
} from "@/lib/architect/display";
import { loadRecentArchitectTasks } from "@/lib/architect/recent-tasks";
import { prepareArchitectTurn } from "@/lib/architect/service";
import { formatIsoDateTime } from "@/lib/format";
import {
  architectContextChangeLabel,
  architectGenerationStatusLabel,
  architectMessageRoleLabel,
  architectSessionStatusLabel,
  architectSourceStatusLabel,
  projectMemoryCategoryLabel,
} from "@/lib/labels";
import { loadActiveProjectMemories } from "@/lib/memory";
import { loadProject } from "@/lib/projects";
import { taskUrl } from "@/lib/task-display";

import { ComposerForm } from "./ComposerForm";
import { ProposalForm } from "./ProposalForm";
import { SendTurnForm } from "./SendTurnForm";

/**
 * Page d'une conversation Architecte.
 *
 * Elle se lit de haut en bas comme la conversation elle-meme : ce qui a ete dit,
 * puis ce qui va etre dit, puis ce qui partira avec. La preview du contexte
 * precede toujours le bouton d'envoi — l'utilisateur doit pouvoir comprendre ce
 * qui quitte sa machine avant que cela ne parte, pas apres.
 *
 * Le contexte est prepare a chaque rendu, avec le **meme** code que l'envoi :
 * afficher une preview construite autrement reviendrait a mentir. Cette
 * preparation lit le repository via le runner ; elle ne contacte aucun
 * fournisseur.
 */
export default async function ArchitectSessionPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;

  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  const db = getDatabaseClient();
  const session = await getArchitectSession(db, sessionId);
  if (session === null || session.projectId !== project.id) {
    notFound();
  }

  const config = loadArchitectConfig(process.env);
  const questions = latestArchitectQuestions(session);
  const proposalGeneration = latestArchitectProposal(session);
  const creatable = canCreateArchitectTask(session);
  const applied = session.status === ARCHITECT_SESSION_STATUS.APPLIED;
  const appliedTask =
    session.appliedTaskId === null ? null : await getTaskById(db, session.appliedTaskId);

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
        model: config.ok ? config.config.model : "",
        environment: process.env,
      });

  // Le contexte a-t-il bouge **depuis l'apercu** ? Different de « depuis le
  // dernier tour » : celui-ci bloque l'envoi, celui-la l'informe seulement.
  const staleDraft =
    pending !== null &&
    prepared !== null &&
    prepared.ok &&
    prepared.turn.prepared.contextFingerprint !== pending.contextFingerprint;

  const back = architectUrl(project.id);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-6">
        <Link href={back} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour aux conversations
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-mono text-xs text-zinc-500">{session.code}</p>
          <StatusBadge>{architectSessionStatusLabel(session.status)}</StatusBadge>
          <span className="text-xs text-zinc-600">{formatIsoDateTime(session.createdAt)}</span>
        </div>
        <h1 className="text-xl font-semibold text-zinc-50">Architecte</h1>
        <p className="truncate text-sm text-zinc-600">{project.name}</p>
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

          <ol className="flex flex-col gap-5">
            {session.messages.map((message) => {
              const proposal = architectProposalOfMessage(session, message);
              const architect = message.role === ARCHITECT_MESSAGE_ROLE.ARCHITECT;
              const generation =
                message.generationId === null
                  ? null
                  : (session.generations.find((entry) => entry.id === message.generationId) ?? null);

              return (
                <li key={message.id} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h3
                      className={
                        architect
                          ? "text-sm font-medium text-zinc-100"
                          : "text-sm font-medium text-zinc-300"
                      }
                    >
                      {architectMessageRoleLabel(message.role)}
                    </h3>
                    <span className="text-xs text-zinc-600">
                      {formatIsoDateTime(message.createdAt)}
                    </span>
                  </div>

                  <p
                    className={
                      architect
                        ? "whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm leading-relaxed text-zinc-200"
                        : "whitespace-pre-wrap text-sm leading-relaxed text-zinc-400"
                    }
                  >
                    {message.content}
                  </p>

                  {proposal === null ? null : (
                    <div className="rounded-md border border-zinc-800 px-4 py-3">
                      <h4 className="text-xs font-medium text-zinc-400">Proposition de ce tour</h4>
                      <p className="mt-1 text-sm text-zinc-200">{proposal.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                        {String(proposal.acceptanceCriteria.length)} criteres ·{" "}
                        {proposal.priority ?? "priorite non fournie"}
                      </p>
                    </div>
                  )}

                  {architect && generation !== null ? (
                    <details className="text-xs text-zinc-600">
                      <summary className="cursor-pointer hover:text-zinc-400">
                        Detail technique de ce tour
                      </summary>
                      <p className="mt-2 font-mono">
                        {generation.model} · {generation.promptVersion}
                      </p>
                      <p className="mt-1">
                        Usage reported by OpenAI — entree :{" "}
                        {generation.usage.inputTokens === null
                          ? "non fourni"
                          : generation.usage.inputTokens.toLocaleString("fr-FR")}{" "}
                        · sortie :{" "}
                        {generation.usage.outputTokens === null
                          ? "non fourni"
                          : generation.usage.outputTokens.toLocaleString("fr-FR")}{" "}
                        · total :{" "}
                        {generation.usage.totalTokens === null
                          ? "non fourni"
                          : generation.usage.totalTokens.toLocaleString("fr-FR")}{" "}
                        · en cache :{" "}
                        {generation.usage.cachedInputTokens === null
                          ? "non fourni"
                          : generation.usage.cachedInputTokens.toLocaleString("fr-FR")}
                      </p>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ol>

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
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              <Link href={back} className="text-zinc-200 underline hover:text-zinc-50">
                Ouvrez une nouvelle conversation
              </Link>{" "}
              pour discuter avec l&apos;architecte.
            </p>
          </SectionCard>
        ) : null}

        {applied ? (
          <SectionCard title="Tache creee">
            {appliedTask === null ? (
              <p className="text-sm text-zinc-400">
                Cette conversation a ete appliquee, mais la tache correspondante est introuvable.
              </p>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-zinc-300">
                  <Link
                    href={taskUrl(project.id, appliedTask.id)}
                    className="font-mono text-zinc-200 underline hover:text-zinc-50"
                  >
                    {appliedTask.code}
                  </Link>{" "}
                  — {appliedTask.title}. Elle est en brouillon : c&apos;est a vous de la mettre en
                  file quand elle vous convient.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                  Cette conversation est close. Une conversation produit une tache, et une seule.{" "}
                  <Link href={back} className="text-zinc-200 underline hover:text-zinc-50">
                    Start new conversation
                  </Link>
                </p>
              </>
            )}
          </SectionCard>
        ) : null}

        {config.ok || readOnly ? null : (
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
                  {config.missing.includes(name) ? " — manquante" : " — definie"}
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
                ? "Cette conversation a atteint la taille maximale que NOX accepte d'envoyer. Aucun message n'est resume ni supprime : ouvrez une nouvelle conversation pour poursuivre."
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
            {pending === null ? null : (
              <div className="mb-5">
                <h3 className="text-xs font-medium text-zinc-400">Message</h3>
                <p className="mt-2 whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm leading-relaxed text-zinc-200">
                  {pending.messageText}
                </p>
              </div>
            )}

            <h3 className="text-xs font-medium text-zinc-400">Project context</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">
              {!prepared.turn.comparable
                ? "Premier tour : il n'y a rien a comparer."
                : prepared.turn.changes.length === 0
                  ? "Project context unchanged"
                  : "Project context changed since previous turn"}
            </p>

            {prepared.turn.changes.length === 0 ? null : (
              <ul className="mt-3 flex flex-col divide-y divide-zinc-800/80 font-mono text-xs">
                {prepared.turn.changes.map((change) => (
                  <li
                    key={`${change.kind}:${change.identifier}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-2"
                  >
                    <span className="text-zinc-300">{change.identifier}</span>
                    <span className="flex items-center gap-3 text-zinc-600">
                      {change.previousRevision === null || change.currentRevision === null ? null : (
                        <span>
                          {change.previousRevision} &rarr; {change.currentRevision}
                        </span>
                      )}
                      <StatusBadge>{architectContextChangeLabel(change.kind)}</StatusBadge>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {staleDraft ? (
              <p
                role="alert"
                className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
              >
                Le contexte du projet a change depuis votre apercu. Relisez le contexte mis a jour
                avant de l&apos;envoyer : l&apos;envoi sera refuse tant que ce ne sera pas fait.
              </p>
            ) : null}

            {memoryRows(prepared.turn.prepared.manifest).length === 0 ? null : (
              <>
                <h3 className="mt-5 text-xs font-medium text-zinc-400">Project memory</h3>
                <p className="my-2 max-w-prose text-sm leading-relaxed text-zinc-400">
                  Entrees actives de la memoire de ce projet, dans l&apos;ordre des codes. Les
                  entrees archivees ne figurent pas ici : elles ne quittent jamais cette machine.
                </p>
                <ul className="flex flex-col divide-y divide-zinc-800/80 text-xs">
                  {memoryRows(prepared.turn.prepared.manifest).map((row) => (
                    <li
                      key={row.code}
                      className="flex flex-wrap items-center justify-between gap-3 py-2"
                    >
                      <span className="flex flex-wrap items-center gap-3">
                        <span className="font-mono text-zinc-300">{row.code}</span>
                        <span className="text-zinc-500">
                          {isProjectMemoryCategory(row.category)
                            ? projectMemoryCategoryLabel(row.category)
                            : row.category}
                        </span>
                      </span>
                      <span className="flex items-center gap-3 font-mono text-zinc-600">
                        {row.revision === null ? null : <span>{row.revision}</span>}
                        <span>{formatChars(row.chars)}</span>
                        <StatusBadge>Included</StatusBadge>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h3 className="mt-5 text-xs font-medium text-zinc-400">Sources</h3>
            <p className="my-2 max-w-prose text-sm leading-relaxed text-zinc-400">
              Les elements listes ci-dessous seront envoyes au fournisseur OpenAI. Aucun fichier de
              code, diff Git, sortie Claude ou fichier{" "}
              <code className="font-mono text-xs text-zinc-300">.env</code> n&apos;est inclus.
            </p>

            <ul className="flex flex-col divide-y divide-zinc-800/80 font-mono text-xs">
              {manifestRows(prepared.turn.prepared.manifest).map((row) => (
                <li
                  key={`${row.kind}:${row.identifier}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-2"
                >
                  <span className="text-zinc-300">{row.identifier}</span>
                  <span className="flex items-center gap-3 text-zinc-600">
                    {row.revision === null ? null : <span>{row.revision}</span>}
                    {row.chars === 0 ? null : <span>{formatChars(row.chars)}</span>}
                    <StatusBadge>{architectSourceStatusLabel(row.status)}</StatusBadge>
                  </span>
                </li>
              ))}
            </ul>

            <dl className="mt-4 flex flex-col gap-1 text-xs text-zinc-500">
              <div className="flex gap-2">
                <dt>Taches recentes incluses :</dt>
                <dd>{String(manifestTaskCount(prepared.turn.prepared.manifest))}</dd>
              </div>
              <div className="flex gap-2">
                <dt>Conversation :</dt>
                <dd>
                  {session.messages.length === 1
                    ? "1 message"
                    : `${String(session.messages.length)} messages`}{" "}
                  · {formatChars(prepared.turn.prepared.transcriptChars)} sur{" "}
                  {formatChars(ARCHITECT_LIMITS.transcript)}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt>Contexte total :</dt>
                <dd>{formatChars(prepared.turn.prepared.manifest.totalChars)}</dd>
              </div>
              <div className="flex gap-2">
                <dt>Provider :</dt>
                <dd className="font-mono">
                  {config.ok ? config.config.model : "modele non configure"}
                </dd>
              </div>
            </dl>

            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
                Voir le texte exact envoye
              </summary>
              <div className="mt-3 flex flex-col gap-4">
                <div>
                  <h4 className="text-xs font-medium text-zinc-400">Instructions</h4>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-400">
                    {prepared.turn.prepared.prompt.instructions}
                  </pre>
                </div>
                <div>
                  <h4 className="text-xs font-medium text-zinc-400">Contexte et conversation</h4>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-400">
                    {prepared.turn.prepared.prompt.input}
                  </pre>
                </div>
              </div>
            </details>

            {pending === null ? null : (
              <div className="mt-6 border-t border-zinc-800 pt-5">
                <SendTurnForm
                  projectId={project.id}
                  sessionId={session.id}
                  configured={config.ok}
                  contextChanged={prepared.turn.changes.length > 0}
                />
              </div>
            )}
          </SectionCard>
        ) : null}

        {readOnly || pending !== null ? null : (
          <SectionCard title={session.messages.length === 0 ? "Premier tour" : "Votre message"}>
            <ComposerForm
              projectId={project.id}
              sessionId={session.id}
              draft=""
              maxLength={ARCHITECT_LIMITS.request}
              generationsLeft={session.generationsLeft}
              opening={session.messages.length === 0 ? session.requestText : null}
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
                  cancelHref={back}
                />
              ) : (
                <p role="alert" className="text-sm leading-relaxed text-amber-200">
                  La conversation a continue depuis cette proposition. Demandez a
                  l&apos;architecte une proposition a jour avant de creer la tache : creer
                  celle-ci reviendrait a ignorer ce que vous venez de lui dire.
                </p>
              )}
            </SectionCard>
          </>
        )}

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
                  </div>
                  <p className="font-mono text-xs text-zinc-600">
                    {generation.model} · {generation.promptVersion}
                    {generation.contextFingerprint === null
                      ? ""
                      : ` · contexte ${generation.contextFingerprint.slice(0, 12)}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs leading-relaxed text-zinc-600">
            NOX n&apos;estime aucun cout : seuls les chiffres rapportes par le fournisseur sont
            affiches, et « non fourni » veut dire ce qu&apos;il dit.
          </p>
        </SectionCard>
      </main>
    </div>
  );
}
