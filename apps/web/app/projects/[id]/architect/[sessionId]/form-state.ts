import type { TaskFormValues } from "@/lib/task-input";

/** Etat du formulaire de generation, questions comprises. */
export type GenerateProposalState = {
  error: string | null;
  /** Precisions deja saisies, reaffichees apres un refus. */
  clarification: string;
};

export const INITIAL_GENERATE_PROPOSAL_STATE: GenerateProposalState = {
  error: null,
  clarification: "",
};

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
