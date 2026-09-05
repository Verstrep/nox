/**
 * Etats des formulaires du backlog.
 *
 * Separes des Server Actions pour la meme raison que partout ailleurs : un
 * Client Component ne peut pas importer un module `"use server"` sans en
 * importer tout le contenu, et ces types doivent traverser la frontiere sans
 * rien entrainer avec eux.
 */

import type { BacklogReviewItem } from "@/lib/backlog/service";

/** Ce que rend l'action de generation. */
export type BacklogGenerateState = {
  error: string | null;
};

export const INITIAL_GENERATE_STATE: BacklogGenerateState = { error: null };

/** Ce que rend l'action d'abandon. */
export type BacklogDismissState = {
  error: string | null;
};

export const INITIAL_DISMISS_STATE: BacklogDismissState = { error: null };

/**
 * Un element de backlog en cours de revue.
 *
 * Exactement les valeurs d'un formulaire d'edition de tache — plan de
 * verification compris : c'est la meme chose, et une seconde forme presque
 * identique aurait fini par accepter ce que l'autre refuse.
 */
export type BacklogItemValues = BacklogReviewItem;

/**
 * Ce que rend l'action d'application.
 *
 * `items` revient avec le refus : un backlog de huit taches edite pendant dix
 * minutes ne doit jamais disparaitre parce qu'une commande a ete refusee.
 */
export type BacklogApplyState = {
  items: BacklogItemValues[];
  error: string | null;
  /** Le projet a change depuis la planification : l'application est fermee. */
  stale: boolean;
};
