import {
  ARCHITECT_MESSAGE_ROLE,
  ARCHITECT_PROJECT_UPDATE_STATUS,
  REPLAN_PROPOSAL_STATUS,
} from "@nox/shared";
import { architectProposalOfMessage, type ArchitectSessionView } from "@nox/database";
import Link from "next/link";
import type { ReactNode } from "react";

import type { ArchitectTimelineEntry } from "@/lib/architect/timeline";
import { formatIsoDateTime } from "@/lib/format";
import { architectMessageRoleLabel } from "@/lib/labels";
import { planChangeCountLabel, planUrl, projectUpdateUrl } from "@/lib/plan-display";
import { projectChangeUrl, replanSummaryLines } from "@/lib/replan/display";
import { taskUrl } from "@/lib/task-display";

import { ArchitectBubble, UserBubble } from "./MessageBubble";
import { ProgressiveArchitectMessage } from "./ProgressiveMessage";

/**
 * Le fil : ce qui a ete dit, et ce que NOX a fait.
 *
 * Les deux surfaces l'utilisent. `chat` decide de la **presentation** : une
 * conversation projet s'affiche en bulles, alignees a droite pour l'utilisateur ;
 * une session historique garde exactement l'apparence qu'elle avait. Cette
 * distinction ne touche que l'ecran — rien de ce qui est stocke ne change, et le
 * fournisseur ne voit ni couleur, ni alignement.
 *
 * Un evenement de tache n'est **pas** un message. Il n'a pas de role, ne part
 * jamais, et n'est jamais anime : il est derive de
 * `ArchitectGeneration.appliedTaskId`, donc il survit a un rafraichissement sans
 * qu'aucun etat de navigateur soit conserve.
 *
 * Les messages restent du texte : `whitespace-pre-wrap`, aucun Markdown rendu,
 * aucun HTML injecte.
 */
export function ConversationTimeline({
  entries,
  session,
  projectId,
  chat = false,
}: {
  entries: readonly ArchitectTimelineEntry[];
  session: ArchitectSessionView;
  projectId: string;
  /** Presentation en bulles, reservee a la conversation projet. */
  chat?: boolean;
}) {
  // Seule la derniere reponse peut etre revelee progressivement, et seulement si
  // elle vient d'arriver. Le composant client tranche ; le serveur se contente
  // de designer laquelle est la derniere.
  const lastArchitect = [...entries]
    .reverse()
    .find((entry) => entry.kind === "message" && entry.role === ARCHITECT_MESSAGE_ROLE.ARCHITECT);

  return (
    <ol className="flex flex-col gap-5">
      {entries.map((entry) => {
        if (entry.kind === "change") {
          return (
            <li key={entry.id}>
              <ProjectChangeCard projectId={projectId} entry={entry} />
            </li>
          );
        }

        if (entry.kind === "update") {
          return (
            <li key={entry.id}>
              <ProjectUpdateCard projectId={projectId} entry={entry} />
            </li>
          );
        }

        if (entry.kind === "task") {
          return (
            <li key={entry.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  {/*
                    Le libelle est une seule chaine : React inserait sinon un
                    marqueur entre le code et le mot, et le texte rendu ne serait
                    plus celui qu'on lit ici.
                  */}
                  <p className="text-sm font-medium text-emerald-200">
                    <span aria-hidden="true">✓ </span>
                    {`${entry.code} creee`}
                  </p>
                  <p className="truncate text-xs text-zinc-400">{entry.title}</p>
                </div>
                <Link
                  href={taskUrl(projectId, entry.taskId)}
                  className="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
                >
                  Open task
                </Link>
              </div>
              <p className="mt-1.5 text-xs text-zinc-600">
                Evenement local. Il n&apos;entre pas dans la conversation transmise.
              </p>
            </li>
          );
        }

        const message = session.messages.find((candidate) => candidate.id === entry.id);
        const proposal = message === undefined ? null : architectProposalOfMessage(session, message);
        const architect = entry.role === ARCHITECT_MESSAGE_ROLE.ARCHITECT;
        const generation =
          entry.generationId === null
            ? null
            : (session.generations.find((candidate) => candidate.id === entry.generationId) ?? null);

        const proposalCard =
          proposal === null ? null : (
            <div className="mt-2 rounded-md border border-zinc-800 px-4 py-3">
              <h4 className="text-xs font-medium text-zinc-400">Proposition de ce tour</h4>
              <p className="mt-1 text-sm text-zinc-200">{proposal.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                {String(proposal.acceptanceCriteria.length)} criteres ·{" "}
                {proposal.priority ?? "priorite non fournie"}
              </p>
            </div>
          );

        const body: ReactNode =
          chat && architect && entry.id === lastArchitect?.id ? (
            <ProgressiveArchitectMessage text={entry.content}>
              {proposalCard}
            </ProgressiveArchitectMessage>
          ) : architect ? (
            <>
              <ArchitectBubble>{entry.content}</ArchitectBubble>
              {proposalCard}
            </>
          ) : chat ? (
            <>
              <UserBubble>{entry.content}</UserBubble>
              {proposalCard}
            </>
          ) : (
            <>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
                {entry.content}
              </p>
              {proposalCard}
            </>
          );

        return (
          <li key={entry.id} className="flex flex-col gap-2">
            <div
              className={
                chat && !architect
                  ? "flex flex-wrap items-baseline justify-end gap-3"
                  : "flex flex-wrap items-baseline gap-3"
              }
            >
              <h3
                className={
                  architect
                    ? "text-sm font-medium text-zinc-100"
                    : "text-sm font-medium text-zinc-300"
                }
              >
                {architectMessageRoleLabel(entry.role)}
              </h3>
              <span className="text-xs text-zinc-600">{formatIsoDateTime(entry.createdAt)}</span>
            </div>

            {body}

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
  );
}

/**
 * La carte d'une proposition de mise a jour du projet.
 *
 * ## Elle est derivee de la base, jamais d'un etat React
 *
 * Son statut vient d'`ArchitectProjectUpdate`. Un rafraichissement rend donc
 * exactement la meme carte, et deux onglets ouverts sur la meme conversation ne
 * peuvent pas en montrer deux versions differentes.
 *
 * ## Ce n'est pas un message
 *
 * Elle n'entre ni dans le transcript, ni dans le prompt, ni dans le decompte de
 * jetons. Le fournisseur decouvrira le nouvel etat au tour suivant, par le
 * contexte — pas par une phrase qu'on lui aurait fait dire.
 *
 * ## Trois etats, trois affichages
 *
 * Une proposition finalisee ne porte plus de bouton d'application : le domaine
 * la refuserait, et offrir un bouton condamne a echouer serait un mensonge.
 */
function ProjectUpdateCard({
  projectId,
  entry,
}: {
  projectId: string;
  entry: Extract<ArchitectTimelineEntry, { kind: "update" }>;
}) {
  if (entry.status === ARCHITECT_PROJECT_UPDATE_STATUS.APPLIED) {
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <p className="text-sm font-medium text-emerald-200">
            <span aria-hidden="true">✓ </span>
            {"Project update applied"}
          </p>
          <Link
            href={planUrl(projectId)}
            className="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
          >
            Open Project Plan
          </Link>
        </div>
        <p className="mt-1.5 text-xs text-zinc-600">
          Evenement local. Il n&apos;entre pas dans la conversation transmise.
        </p>
      </>
    );
  }

  if (entry.status === ARCHITECT_PROJECT_UPDATE_STATUS.DISMISSED) {
    return (
      <>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-3">
          <p className="text-sm text-zinc-400">{"Project update dismissed"}</p>
        </div>
        <p className="mt-1.5 text-xs text-zinc-600">
          Evenement local. Il n&apos;entre pas dans la conversation transmise.
        </p>
      </>
    );
  }

  return (
    <>
      <div className="rounded-md border border-teal-400/30 bg-teal-400/5 px-4 py-3">
        <h4 className="text-sm font-medium text-teal-100">Proposed project update</h4>
        <dl className="mt-3 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-xs text-zinc-400">Project Brief</dt>
            <dd className="text-xs text-zinc-300">{planChangeCountLabel(entry.briefChanges)}</dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-xs text-zinc-400">Living V1 Plan</dt>
            <dd className="text-xs text-zinc-300">{planChangeCountLabel(entry.planChanges)}</dd>
          </div>
          {/* Une proposition peut ne porter que des regles durables : c'est
              meme le cas central quand le plan couvre deja la capacite et que
              l'utilisateur fige son contrat precis. Sans cette ligne, la carte
              annoncait « 0 champ » deux fois et paraissait vide. */}
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-xs text-zinc-400">Règles durables</dt>
            <dd className="text-xs text-zinc-300">
              {entry.memoryChanges === 0
                ? "aucune"
                : `${String(entry.memoryChanges)} ${entry.memoryChanges === 1 ? "règle" : "règles"}`}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex justify-end">
          <Link
            href={projectUpdateUrl(projectId, entry.updateId)}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
          >
            Review changes
          </Link>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-zinc-600">
        Une proposition ne change rien tant que vous ne l&apos;avez pas appliquee.
      </p>
    </>
  );
}

/**
 * La carte d'un changement de projet.
 *
 * ## Une intention, une carte
 *
 * Un tour peut proposer une mise a jour du projet **et** une replanification.
 * Les deux forment un seul changement : ils se relisent sur une page et
 * s'appliquent d'un geste. Deux cartes auraient invite a trancher en deux fois,
 * et rendu possible l'etat que TASK-032 existe pour empecher.
 *
 * ## Elle est derivee de la base, jamais d'un etat React
 *
 * Son statut vient d'`ArchitectReplanProposal`. Un rafraichissement rend donc
 * exactement la meme carte, et deux onglets ouverts sur la meme conversation ne
 * peuvent pas en montrer deux versions differentes.
 *
 * ## Ce n'est pas un message
 *
 * Elle n'entre ni dans le transcript, ni dans le prompt, ni dans le decompte de
 * jetons. L'architecte decouvrira le nouvel etat au tour suivant, par le
 * contexte — pas par une phrase qu'on lui aurait fait dire.
 *
 * ## Aucun JSON brut
 *
 * Des nombres et des mots. Le payload du fournisseur vit derriere `Inspect`,
 * a un clic de la revue, et n'a rien a faire dans un fil de conversation.
 */
function ProjectChangeCard({
  projectId,
  entry,
}: {
  projectId: string;
  entry: Extract<ArchitectTimelineEntry, { kind: "change" }>;
}) {
  if (entry.status === REPLAN_PROPOSAL_STATUS.APPLIED) {
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <p className="text-sm font-medium text-emerald-200">
            <span aria-hidden="true">✓ </span>
            {"Project change applied"}
          </p>
          <Link
            href={projectChangeUrl(projectId, entry.proposalId)}
            className="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
          >
            View change
          </Link>
        </div>
        <p className="mt-1.5 text-xs text-zinc-600">
          Evenement local. Il n&apos;entre pas dans la conversation transmise.
        </p>
      </>
    );
  }

  if (entry.status === REPLAN_PROPOSAL_STATUS.DISMISSED) {
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-3">
          <p className="text-sm text-zinc-400">{"Project change dismissed"}</p>
          <Link
            href={projectChangeUrl(projectId, entry.proposalId)}
            className="shrink-0 rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
          >
            View change
          </Link>
        </div>
        <p className="mt-1.5 text-xs text-zinc-600">
          Evenement local. Il n&apos;entre pas dans la conversation transmise.
        </p>
      </>
    );
  }

  const lines = replanSummaryLines({
    added: entry.added,
    updated: entry.updated,
    removed: entry.removed,
    dependencyChanged: 0,
    orderChanged: entry.orderChanged,
  });

  return (
    <>
      <div className="rounded-md border border-teal-400/30 bg-teal-400/5 px-4 py-3">
        <h4 className="text-sm font-medium text-teal-100">Proposed project change</h4>
        <dl className="mt-3 flex flex-col gap-1.5">
          {/*
            Une section vide ne s'affiche pas : un changement qui ne touche que
            les taches futures ne doit pas laisser croire qu'il touche le plan.
          */}
          {entry.updateId === null ? null : (
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-xs text-zinc-400">Project Plan</dt>
              <dd className="text-xs text-zinc-300">
                {planChangeCountLabel(entry.briefChanges + entry.planChanges)}
              </dd>
            </div>
          )}
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-xs text-zinc-400">Future Tasks</dt>
            <dd className="text-xs text-zinc-300">
              {lines.length === 0 ? "No change" : lines.join(" · ")}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex justify-end">
          <Link
            href={projectChangeUrl(projectId, entry.proposalId)}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
          >
            Review
          </Link>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-zinc-600">
        {entry.stale
          ? "Le projet a change depuis : ce changement reste lisible, mais NOX refusera de l'appliquer."
          : "Une proposition ne change rien tant que vous ne l'avez pas appliquee."}
      </p>
    </>
  );
}
