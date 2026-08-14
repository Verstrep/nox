import { findProjectArchitectSession, getDatabaseClient } from "@nox/database";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { architectHistoryUrl, architectUrl } from "@/lib/architect/display";
import { loadProject } from "@/lib/projects";

import { ArchitectConversation } from "./ConversationView";

/**
 * Conversation Architecte designee par son identifiant.
 *
 * ## Pourquoi cette route survit a TASK-020
 *
 * Parce que les conversations historiques ont ete ouvertes ici, et que leurs
 * URL circulent : dans un signet, dans un lien de tache, dans une note. Les
 * casser ferait disparaitre une histoire que NOX a promis de conserver.
 *
 * ## Pourquoi la conversation principale redirige
 *
 * Elle a une adresse a elle, sans identifiant. Servir le meme fil a deux URL
 * differentes creerait deux surfaces d'ecriture pour une seule conversation,
 * avec deux brouillons et deux apercus — exactement le genre de dedoublement que
 * la reservation de tour existe pour empecher.
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

  await connection();
  const main = await findProjectArchitectSession(getDatabaseClient(), project.id);
  if (main !== null && main.id === sessionId) {
    redirect(architectUrl(project.id));
  }

  return (
    <ArchitectConversation
      project={project}
      sessionId={sessionId}
      backHref={architectHistoryUrl(project.id)}
      backLabel="Retour aux conversations historiques"
    />
  );
}
