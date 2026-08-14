import { ARCHITECT_MESSAGE_ROLE } from "@nox/shared";
import { architectProposalOfMessage, type ArchitectSessionView } from "@nox/database";
import Link from "next/link";
import type { ReactNode } from "react";

import type { ArchitectTimelineEntry } from "@/lib/architect/timeline";
import { formatIsoDateTime } from "@/lib/format";
import { architectMessageRoleLabel } from "@/lib/labels";
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
