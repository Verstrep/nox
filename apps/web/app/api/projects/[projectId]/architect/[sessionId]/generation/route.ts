/**
 * Le tour d'Architecte en vol : le regarder, et l'arreter.
 *
 * ## Pourquoi un Route Handler plutot qu'une Server Action
 *
 * Parce qu'une Server Action ne peut pas arreter une Server Action. Next.js les
 * met en file d'attente cote client : un `Arrêter` ecrit ainsi partirait
 * derriere l'envoi qu'il doit interrompre, et n'arriverait qu'une fois
 * l'attente terminee — c'est-a-dire trop tard, toujours. Un Route Handler est
 * une requete HTTP ordinaire ; elle traverse pendant que l'autre attend.
 *
 * C'est le meme raisonnement que pour l'etat d'une execution Claude, qui vit
 * deja dans un Route Handler pour une raison voisine.
 *
 * ## Ce qui traverse
 *
 * `GET` : un booleen et un instant. `POST` : un booleen et un fait. Ni modele,
 * ni empreinte, ni prompt, ni message, ni configuration, ni valeur
 * d'environnement — le plafond de securite lui-meme ne quitte pas le serveur.
 *
 * ## L'ordre de l'arret
 *
 * La base d'abord, le reseau ensuite. Conclure la ligne avant d'abandonner la
 * requete ferme la seule course qui compte : une reponse qui arriverait entre
 * les deux trouverait un tour deja conclu, et sa transaction serait refusee.
 * L'inverse laisserait une fenetre ou elle serait acceptee.
 */

import { cancelArchitectGeneration, getActiveArchitectGeneration, getDatabaseClient } from "@nox/database";
import { NextResponse } from "next/server";

import { abortArchitectCall } from "@/lib/architect/cancellation";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * Verifie que la session appartient bien a ce projet.
 *
 * La chaine projet → session est controlee entierement : un identifiant de
 * session devine ne doit rien reveler d'un autre projet, ni permettre d'y
 * arreter quoi que ce soit.
 */
async function loadSession(projectId: string, sessionId: string): Promise<boolean> {
  const session = await getDatabaseClient().architectSession.findUnique({
    where: { id: sessionId },
    select: { projectId: true },
  });
  return session !== null && session.projectId === projectId;
}

/** Y a-t-il un tour en vol, et depuis quand ? */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> },
) {
  const { projectId, sessionId } = await params;
  if (!(await loadSession(projectId, sessionId))) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const active = await getActiveArchitectGeneration(getDatabaseClient(), sessionId);

  return NextResponse.json(
    {
      ok: true,
      // `startedAt` est l'instant **enregistre** a la reservation, et non celui
      // du clic : c'est lui qui reste juste apres un rechargement de page.
      active: active === null ? null : { startedAt: active.startedAt },
    },
    { headers: NO_STORE },
  );
}

/** Arrete le tour en vol. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> },
) {
  const { projectId, sessionId } = await params;
  if (!(await loadSession(projectId, sessionId))) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const cancelled = await cancelArchitectGeneration(getDatabaseClient(), { sessionId });
  if (!cancelled.ok) {
    // Rien a arreter : jamais commence, ou deja conclu pendant que le clic
    // voyageait. Ce n'est pas une erreur — un second `Arrêter` doit etre sans
    // effet et sans message d'echec.
    return NextResponse.json({ ok: true, stopped: false, aborted: false }, { headers: NO_STORE });
  }

  // La ligne est conclue ; la requete peut maintenant etre abandonnee sans
  // qu'aucune reponse tardive ne puisse plus etre acceptee.
  //
  // `aborted` dit si NOX a bel et bien ferme la connexion. `false` signifie que
  // le controleur n'existe plus dans ce processus — redemarrage du serveur
  // depuis le depart de l'appel — et non que le travail continue : NOX ne le
  // sait pas, et l'ecran ne pretend pas le contraire.
  const aborted = abortArchitectCall(cancelled.generation.id);

  return NextResponse.json({ ok: true, stopped: true, aborted }, { headers: NO_STORE });
}
