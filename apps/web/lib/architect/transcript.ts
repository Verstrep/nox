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
 * ## Aucune fenetre, aucun resume
 *
 * Ce module n'ecarte aucun message. Une decision prise au deuxieme tour peut
 * etre essentielle au quinzieme ; une fenetre glissante invisible fabriquerait
 * une memoire fictive, et un resume produit par un second appel couterait un
 * appel de plus pour perdre de l'information. Quand la borne est atteinte, NOX
 * le dit et la conversation s'arrete la.
 */

import {
  architectProposalOfMessage,
  type ArchitectSessionView,
} from "@nox/database";
import type { ArchitectPromptMessage } from "@nox/shared";

/**
 * Messages a transmettre, du plus ancien au plus recent.
 *
 * Chaque reponse d'architecte emporte la proposition de son tour, lorsqu'elle
 * en portait une : sans elle, « retire la partie backend » ne designerait rien
 * de precis, et le tour suivant repartirait de zero.
 */
export function architectTranscript(session: ArchitectSessionView): ArchitectPromptMessage[] {
  return session.messages.map((message) => ({
    role: message.role,
    content: message.content,
    proposal: architectProposalOfMessage(session, message),
  }));
}
