import type { TaskFormValues } from "@/lib/task-input";

/**
 * Etat du composer, partage par `Review context`, `Send` et `Cancel`.
 *
 * Un seul etat pour les trois actions : elles portent sur le meme texte, et
 * trois etats distincts finiraient par se contredire — l'erreur de l'une
 * s'affichant a cote du brouillon de l'autre.
 */
export type ComposerState = {
  error: string | null;
  /**
   * Texte a reafficher dans le composer.
   *
   * Vide apres une preparation reussie : le brouillon est alors en base, et
   * c'est lui que la page montre. Rempli apres un refus ou une annulation —
   * perdre le texte de l'utilisateur serait la pire facon de refuser.
   */
  message: string;
};

export const INITIAL_COMPOSER_STATE: ComposerState = { error: null, message: "" };

/** Etat du formulaire de creation de tache. */
export type CreateFromProposalState = {
  error: string | null;
  /**
   * Champs deja saisis, reaffiches apres un refus.
   *
   * `null` signifie « rien de saisi encore » : le formulaire affiche alors la
   * proposition telle que l'architecte l'a rendue, sans l'ecraser par un etat
   * vide.
   */
  values: TaskFormValues | null;
};

export const INITIAL_CREATE_FROM_PROPOSAL_STATE: CreateFromProposalState = {
  error: null,
  values: null,
};
