/**
 * Comment l'apercu decrit la fenetre de transcript.
 *
 * Deux phrases, et une regle : ce qui part et ce qui reste sont dits separement.
 * Les fondre en une seule — « 18 tours sur 54 » — laisserait croire qu'un
 * morceau de conversation a disparu, alors qu'il est intact en base et affiche
 * quelques centimetres plus haut.
 *
 * Pur : ni base, ni reseau, ni horloge.
 */

import type { TranscriptWindow } from "./window.ts";

/** Ce qui part reellement chez le fournisseur. */
export function describeTranscriptWindow(window: TranscriptWindow): string {
  if (window.includedTurns === 0) {
    return "aucun tour precedent";
  }
  if (window.omittedTurns === 0) {
    return window.includedTurns === 1 ? "1 tour, soit toute la conversation" : `${String(window.includedTurns)} tours, soit toute la conversation`;
  }
  return window.includedTurns === 1
    ? "1 tour, le plus recent"
    : `${String(window.includedTurns)} tours les plus recents`;
}

/** Ce qui reste en base sans partir. */
export function describeStoredTurns(window: TranscriptWindow): string {
  const turns =
    window.omittedTurns === 1 ? "1 tour plus ancien" : `${String(window.omittedTurns)} tours plus anciens`;
  const messages =
    window.omittedMessages === 1 ? "1 message" : `${String(window.omittedMessages)} messages`;
  return `${turns} (${messages})`;
}
