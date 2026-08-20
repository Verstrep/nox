/**
 * Etat du formulaire d'amorcage.
 *
 * Separe de la Server Action pour la meme raison que partout ailleurs : un
 * Client Component ne peut pas importer un module `"use server"` sans en
 * importer tout le contenu, et ce type doit traverser la frontiere sans rien
 * entrainer avec lui.
 */

export type BootstrapCreateState = {
  error: string | null;
  /** L'etat a change depuis l'apercu : la creation est refusee. */
  stale: boolean;
};

export const INITIAL_CREATE_STATE: BootstrapCreateState = { error: null, stale: false };
