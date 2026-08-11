/**
 * Etat du formulaire d'analyse.
 *
 * Un seul champ : ce formulaire n'a rien a conserver. Le bundle est reconstruit
 * cote serveur a chaque fois, et il n'existe aucun texte saisi a rendre a
 * l'utilisateur en cas de refus.
 */
export type AnalyzeReviewState = {
  error: string | null;
};

export const INITIAL_ANALYZE_REVIEW_STATE: AnalyzeReviewState = { error: null };
