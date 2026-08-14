/**
 * Transcript local d'une conversation Architecte.
 *
 * ## L'historique appartient a NOX
 *
 * Il est reconstruit depuis SQLite a chaque tour, et transmis **en entier**.
 * Aucun identifiant de conversation du fournisseur n'intervient :
 * `previous_response_id` reprendrait un historique que NOX n'a pas choisi, dont
 * il ne pourrait rien montrer a l'utilisateur, et qui disparaitrait le jour ou
 * le fournisseur cesserait de le conserver.
 *
 * ## Aucun resume
 *
 * Ce module n'ecarte aucun message et n'en resume aucun : il rend l'histoire
 * complete, telle qu'elle est stockee. Choisir ce qui part reellement est le
 * travail de `window.ts`, et cette separation est volontaire — l'historique
 * affiche et l'historique transmis sont deux questions distinctes, et les
 * melanger ferait dependre ce que l'utilisateur voit d'une borne d'envoi.
 */

import { architectProposalOfMessage, type ArchitectSessionView } from "@nox/database";

import type { TranscriptEntry } from "./window.ts";

/**
 * Messages du transcript local, du plus ancien au plus recent.
 *
 * Chaque reponse d'architecte emporte la proposition de son tour, lorsqu'elle
 * en portait une : sans elle, « retire la partie backend » ne designerait rien
 * de precis, et le tour suivant repartirait de zero.
 *
 * `turnId` vient de la generation du message. Un message sans generation — cas
 * d'une session historique — devient son propre tour plutot que d'etre rattache
 * a un voisin dont rien ne dit qu'il lui repondait.
 */
export function architectTranscript(session: ArchitectSessionView): TranscriptEntry[] {
  return session.messages.map((message) => ({
    role: message.role,
    content: message.content,
    proposal: architectProposalOfMessage(session, message),
    turnId: message.generationId ?? message.id,
  }));
}
