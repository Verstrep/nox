/**
 * Forme de l'etat echange entre les Server Actions du plan et ses formulaires.
 *
 * Separe de `actions.ts` : un fichier `"use server"` ne peut exporter que des
 * fonctions asynchrones.
 *
 * ## Ce que le formulaire transporte
 *
 * Les valeurs saisies, et un jeton de concurrence. Rien d'autre. Ni chemin de
 * repository, ni budget calcule, ni contenu sanitise, ni etat courant : tout
 * cela est derive cote serveur a partir de l'identifiant du projet, relu en
 * base. Le navigateur n'a aucune autorite sur ce qui tient dans le contexte.
 *
 * `expectedRevision` n'echappe pas a cette regle : c'est un jeton, pas une
 * verite. Il ne peut qu'obtenir un refus, jamais elargir quoi que ce soit — et
 * le serveur recalcule la revision courante lui-meme pour le comparer.
 */

/** Valeurs brutes du formulaire de brief, telles qu'elles sont saisies. */
export type BriefFormValues = {
  summary: string;
  problem: string;
  targetUsers: string;
  desiredOutcome: string;
  /** Un element par ligne. */
  goals: string;
  nonGoals: string;
};

export const EMPTY_BRIEF_FORM_VALUES: BriefFormValues = {
  summary: "",
  problem: "",
  targetUsers: "",
  desiredOutcome: "",
  goals: "",
  nonGoals: "",
};

/** Valeurs brutes du formulaire de plan de V1. */
export type V1PlanFormValues = {
  goal: string;
  inScope: string;
  outOfScope: string;
  technicalDirection: string;
  milestones: string;
};

export const EMPTY_V1_PLAN_FORM_VALUES: V1PlanFormValues = {
  goal: "",
  inScope: "",
  outOfScope: "",
  technicalDirection: "",
  milestones: "",
};

export type BriefFormState = {
  values: BriefFormValues;
  error: string | null;
};

export type V1PlanFormState = {
  values: V1PlanFormValues;
  error: string | null;
};

export const INITIAL_BRIEF_FORM_STATE: BriefFormState = {
  values: EMPTY_BRIEF_FORM_VALUES,
  error: null,
};

export const INITIAL_V1_PLAN_FORM_STATE: V1PlanFormState = {
  values: EMPTY_V1_PLAN_FORM_VALUES,
  error: null,
};
