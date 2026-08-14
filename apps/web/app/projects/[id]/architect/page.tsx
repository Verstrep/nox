import { ensureProjectArchitectSession, getDatabaseClient } from "@nox/database";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { loadProject } from "@/lib/projects";

import { ArchitectConversation } from "./[sessionId]/ConversationView";

/**
 * Conversation Architecte principale d'un projet.
 *
 * ## Pourquoi l'URL ne porte pas d'identifiant
 *
 * Parce qu'il n'y en a qu'une. Demander a l'utilisateur de connaitre un
 * identifiant de session pour retrouver la conversation de son projet serait lui
 * faire porter une contrainte technique ; le serveur la retrouve tout seul.
 *
 * ## Ouvrir la page cree la conversation
 *
 * Et cela ne coute rien : une ligne SQLite, aucun message, **aucun appel au
 * fournisseur**. Le message d'accueil affiche tant que la conversation est vide
 * est du texte d'interface, pas une reponse de modele.
 *
 * La creer au premier message aurait laisse la page dans un etat batard — un fil
 * visible a l'ecran mais absent de la base — et complique chaque lecture
 * ulterieure. Deux ouvertures simultanees ne produisent qu'une conversation :
 * la reservation est une mise a jour conditionnelle sur le projet.
 */
export default async function ProjectArchitectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await loadProject(id);
  if (project === null) {
    notFound();
  }

  await connection();
  const session = await ensureProjectArchitectSession(getDatabaseClient(), project.id);
  if (session === null) {
    notFound();
  }

  return (
    <ArchitectConversation
      project={project}
      sessionId={session.id}
      backHref={`/projects/${project.id}`}
      backLabel="Retour au projet"
    />
  );
}
