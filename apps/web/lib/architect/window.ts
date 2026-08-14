/**
 * Fenetre de transcript : ce qui part reellement chez le fournisseur.
 *
 * ## Pourquoi une fenetre est apparue en TASK-020
 *
 * Jusqu'a TASK-019, une conversation Architecte servait a concevoir **une**
 * tache, puis se fermait. Un transcript qui depassait 64 Kio arretait la
 * conversation, et c'etait defendable : la conversation avait de toute facon une
 * fin proche.
 *
 * Une conversation projet n'a pas de fin. Elle accompagne le projet pendant des
 * mois, et un refus definitif au vingtieme tour la rendrait muette exactement
 * quand elle sert le plus. Les tours les plus anciens cessent donc d'etre
 * **transmis** — ils ne sont ni supprimes, ni resumes, ni compresses : ils
 * restent en base et restent affiches.
 *
 * ## Ce que la fenetre n'est pas
 *
 * Ce n'est pas un resume. Aucun second appel n'est fait pour compresser
 * l'histoire : cela couterait un appel pour perdre de l'information, et
 * introduirait une source d'erreur entre l'utilisateur et l'architecte.
 *
 * Ce n'est pas non plus une troncature. Un message n'est jamais coupe en son
 * milieu, et un tour n'est jamais transmis a moitie : envoyer une question sans
 * sa reponse produirait un dialogue que personne n'a tenu.
 *
 * ## Ce qui remplace la memoire perdue
 *
 * Rien, et c'est voulu. Le contexte durable d'un projet ne vit pas dans son
 * transcript : il vit dans ses documents et dans sa memoire projet, qui sont
 * relus **en entier** a chaque tour. C'est precisement pourquoi TASK-017 existe.
 * Une decision qui doit survivre a cinquante tours s'ecrit en memoire ; une
 * decision laissee dans une phrase de conversation ne survit a rien, y compris
 * aujourd'hui.
 */

import { ARCHITECT_LIMITS, type ArchitectPromptMessage } from "@nox/shared";

/**
 * Un message du transcript local, avec le tour auquel il appartient.
 *
 * `turnId` regroupe le message de l'utilisateur et la reponse qui lui a ete
 * faite. C'est l'unite que la fenetre manipule : elle prend des tours entiers,
 * jamais des messages isoles.
 */
export type TranscriptEntry = ArchitectPromptMessage & { turnId: string };

export type TranscriptWindow = {
  /** Messages reellement transmis, du plus ancien au plus recent. */
  messages: ArchitectPromptMessage[];
  /** Tours transmis. */
  includedTurns: number;
  /** Tours conserves en base mais non transmis. */
  omittedTurns: number;
  /** Messages conserves en base mais non transmis. */
  omittedMessages: number;
  /** Taille du transcript transmis, en caracteres. */
  chars: number;
};

type Turn = { id: string; messages: TranscriptEntry[]; chars: number };

/**
 * Regroupe les messages consecutifs partageant un tour.
 *
 * Le regroupement suit l'ordre du transcript et ne trie rien : deux tours ne
 * s'entrelacent jamais, puisqu'un tour n'est ecrit qu'une fois abouti. Un
 * message orphelin — sans reponse, cas d'une session historique — forme un tour
 * a lui seul plutot que d'etre rattache au precedent.
 */
function groupTurns(entries: readonly TranscriptEntry[]): Turn[] {
  const turns: Turn[] = [];

  for (const entry of entries) {
    const current = turns.at(-1);
    if (current !== undefined && current.id === entry.turnId) {
      current.messages.push(entry);
      current.chars += entry.content.length;
      continue;
    }
    turns.push({ id: entry.turnId, messages: [entry], chars: entry.content.length });
  }

  return turns;
}

/**
 * Selectionne les tours les plus recents qui tiennent dans le budget.
 *
 * Deterministe, et volontairement simple : on remonte du plus recent vers le
 * plus ancien, on s'arrete au premier tour qui ne tient pas, et on ne reprend
 * pas plus loin. Reprendre un tour ancien plus petit apres en avoir saute un
 * gros produirait un dialogue troue — l'architecte lirait une reponse a une
 * question qu'il n'a pas vue.
 *
 * `budget` est ce qui reste apres le message que l'utilisateur vient d'ecrire :
 * c'est lui qui compte pour ce tour-ci, et il ne peut pas etre ecarte.
 */
export function selectTranscriptWindow(
  entries: readonly TranscriptEntry[],
  budget: number,
  maxTurns: number = ARCHITECT_LIMITS.windowTurns,
): TranscriptWindow {
  const turns = groupTurns(entries);
  const kept: Turn[] = [];
  let chars = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn === undefined || kept.length >= maxTurns || chars + turn.chars > budget) {
      break;
    }
    kept.unshift(turn);
    chars += turn.chars;
  }

  const messages = kept.flatMap((turn) =>
    turn.messages.map(({ role, content, proposal }) => ({ role, content, proposal })),
  );

  return {
    messages,
    includedTurns: kept.length,
    omittedTurns: turns.length - kept.length,
    omittedMessages: entries.length - messages.length,
    chars,
  };
}

/**
 * Budget restant pour le transcript, une fois le nouveau message compte.
 *
 * Le message de l'utilisateur est prioritaire sur l'histoire : c'est la question
 * posee. Sa borne propre — `ARCHITECT_LIMITS.request` — est tres inferieure au
 * budget de transcript, donc il reste toujours de la place pour au moins le tour
 * le plus recent.
 */
export function transcriptBudget(newMessageChars: number): number {
  return Math.max(0, ARCHITECT_LIMITS.transcript - newMessageChars);
}
