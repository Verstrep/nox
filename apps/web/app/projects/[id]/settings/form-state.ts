/**
 * Etats retournes par les Server Actions du cycle de vie d'un projet.
 *
 * Un fichier `"use server"` ne peut exporter que des fonctions asynchrones :
 * ces formes vivent donc a cote, comme pour les autres formulaires.
 */

export type RenameProjectState = {
  error: string | null;
  /** Confirmation affichee apres une sauvegarde reussie, `null` sinon. */
  notice: string | null;
};

export const INITIAL_RENAME_PROJECT_STATE: RenameProjectState = { error: null, notice: null };

/**
 * Etat retourne par la suppression d'un projet.
 *
 * Une reussite ne produit aucun etat : la Server Action redirige vers le
 * tableau de bord, et le projet n'existe plus pour reafficher quoi que ce soit.
 */
export type DeleteProjectState = {
  error: string | null;
};

export const INITIAL_DELETE_PROJECT_STATE: DeleteProjectState = { error: null };

/**
 * Etat retourne par le choix de la politique de livraison Git.
 *
 * Un `notice` distinct de l'erreur, comme pour le renommage : une sauvegarde
 * sans changement ne s'est rien passe, et le dire vaut mieux que d'afficher une
 * confirmation qui laisserait croire a une ecriture.
 */
export type DeliveryPolicyState = {
  error: string | null;
  notice: string | null;
};

export const INITIAL_DELIVERY_POLICY_STATE: DeliveryPolicyState = { error: null, notice: null };
