import {
  ARCHITECT_GENERATION_STATUS,
  ARCHITECT_LIMITS,
  ARCHITECT_SESSION_STATUS,
} from "@nox/shared";
import {
  getArchitectSession,
  getDatabaseClient,
  getTaskById,
  latestArchitectProposal,
  latestArchitectQuestions,
  listTasksByProject,
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
  proposalToFormValues,
} from "@/lib/architect/display";
import { loadRecentArchitectTasks } from "@/lib/architect/recent-tasks";
import { prepareArchitectContext } from "@/lib/architect/service";
import { formatIsoDateTime } from "@/lib/format";
import {
  architectGenerationStatusLabel,
  architectSessionStatusLabel,
  architectSourceStatusLabel,
} from "@/lib/labels";
import { loadProject } from "@/lib/projects";
import { taskUrl } from "@/lib/task-display";

import { GenerateProposalForm } from "./GenerateProposalForm";
import { ProposalForm } from "./ProposalForm";

/**
 * Page de travail d'une demande Architecte.
 *
 * Elle montre, dans cet ordre : ce qui partira, ce qui est parti, et ce qui en
 * est revenu. La preview du contexte precede toujours le bouton — l'utilisateur
 * doit pouvoir comprendre ce qui quitte sa machine avant que cela ne parte, pas
 * apres.
 *
 * Le contexte est prepare a chaque rendu, avec le **meme** code que la
 * generation : afficher une preview construite autrement reviendrait a mentir.
 * Cette preparation lit le repository via le runner ; elle ne contacte aucun
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
  const appliedTask =
    session.appliedTaskId === null ? null : await getTaskById(db, session.appliedTaskId);

  const summaries = await listTasksByProject(db, project.id);
  const prepared = await prepareArchitectContext({
    projectName: project.name,
    repositoryPath: project.repositoryPath,
    request: session.requestText,
    clarification: session.clarificationText,
    previousQuestions: questions,
    // Les memes taches que la generation, par le meme selecteur : une preview
    // construite autrement mentirait sur ce qui part.
    tasks: await loadRecentArchitectTasks(db, project.id),
    model: config.ok ? config.config.model : "",
    environment: process.env,
  });

  const back = architectUrl(project.id);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-6">
        <Link href={back} className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour aux demandes
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
        <SectionCard title="Demande">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
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
        </SectionCard>

        <SectionCard
          title="Contexte envoye a l'architecte"
          description="Ce qui quittera votre machine, et rien d'autre."
        >
          <p className="mb-4 max-w-prose text-sm leading-relaxed text-zinc-400">
            Les elements listes ci-dessous seront envoyes au fournisseur OpenAI pour generer cette
            proposition. Aucun fichier de code, diff Git, sortie Claude ou fichier{" "}
            <code className="font-mono text-xs text-zinc-300">.env</code> n&apos;est inclus.
          </p>

          {prepared.ok ? (
            <>
              <ul className="flex flex-col divide-y divide-zinc-800/80 font-mono text-xs">
                {manifestRows(prepared.prepared.manifest).map((row) => (
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

              <p className="mt-4 text-xs text-zinc-500">
                Taches recentes incluses :{" "}
                {String(manifestTaskCount(prepared.prepared.manifest))} sur {String(summaries.length)}{" "}
                · Total : {formatChars(prepared.prepared.manifest.totalChars)}
              </p>

              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
                  Voir le texte exact envoye
                </summary>
                <div className="mt-3 flex flex-col gap-4">
                  <div>
                    <h3 className="text-xs font-medium text-zinc-400">Instructions</h3>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-400">
                      {prepared.prepared.prompt.instructions}
                    </pre>
                  </div>
                  <div>
                    <h3 className="text-xs font-medium text-zinc-400">Contexte et demande</h3>
                    <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-400">
                      {prepared.prepared.prompt.input}
                    </pre>
                  </div>
                </div>
              </details>
            </>
          ) : (
            <p role="alert" className="text-sm leading-relaxed text-amber-200">
              {prepared.message}
            </p>
          )}
        </SectionCard>

        {config.ok ? null : (
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
              Vous pouvez continuer a saisir une demande et a inspecter le contexte : seule la
              generation est bloquee.
            </p>
          </SectionCard>
        )}

        {questions.length === 0 ? null : (
          <SectionCard
            title="L'architecte a besoin de precisions"
            description="Repondez ci-dessous, puis relancez une generation."
          >
            <ul className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed text-zinc-300">
              {questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </SectionCard>
        )}

        {session.status === ARCHITECT_SESSION_STATUS.APPLIED ? (
          <SectionCard title="Tache creee">
            {appliedTask === null ? (
              <p className="text-sm text-zinc-400">
                Cette session a ete appliquee, mais la tache correspondante est introuvable.
              </p>
            ) : (
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
            )}
          </SectionCard>
        ) : (
          <SectionCard
            title="Generation"
            description="Un clic, un appel. NOX ne relance jamais de lui-meme."
          >
            <GenerateProposalForm
              projectId={project.id}
              sessionId={session.id}
              questions={questions}
              clarification={session.clarificationText ?? ""}
              maxLength={ARCHITECT_LIMITS.clarification}
              generationsLeft={session.generationsLeft}
              configured={config.ok}
              label={session.generationCount === 0 ? "Generate proposal" : "Generate again"}
            />
          </SectionCard>
        )}

        {proposalGeneration === null ||
        proposalGeneration.proposal === null ||
        session.status === ARCHITECT_SESSION_STATUS.APPLIED ? null : (
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
              title="Proposition"
              description="Relisez et modifiez librement. Rien n'est enregistre tant que vous n'avez pas clique."
            >
              <ProposalForm
                projectId={project.id}
                sessionId={session.id}
                proposed={proposalToFormValues(proposalGeneration.proposal)}
                cancelHref={back}
              />
            </SectionCard>
          </>
        )}

        <SectionCard
          title="Historique"
          description="Chaque generation reste consultable, avec sa consommation."
        >
          {session.generations.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucune generation lancee.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-800/80">
              {session.generations.map((generation) => (
                <li key={generation.id} className="flex flex-col gap-1.5 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-xs text-zinc-500">
                      Generation {String(generation.sequence)}
                    </span>
                    <StatusBadge>{architectGenerationStatusLabel(generation.status)}</StatusBadge>
                    <span className="text-xs text-zinc-600">
                      {formatIsoDateTime(generation.createdAt)}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-zinc-600">
                    {generation.model} · {generation.promptVersion}
                  </p>
                  <p className="text-xs text-zinc-500">
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
                  {generation.status === ARCHITECT_GENERATION_STATUS.NEEDS_INPUT &&
                  generation.questions.length > 0 ? (
                    <p className="text-xs text-zinc-500">
                      {generation.questions.length === 1
                        ? "1 question posee"
                        : `${String(generation.questions.length)} questions posees`}
                    </p>
                  ) : null}
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
