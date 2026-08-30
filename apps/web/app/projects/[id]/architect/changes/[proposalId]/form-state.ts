import type { ReplanReviewItem } from "@/lib/replan/target";

import type { BriefFormValues, V1PlanFormValues } from "../../../plan/form-state";

/**
 * Etat du formulaire de revue d'un changement de projet.
 *
 * Il porte **tout** ce que l'utilisateur a saisi — le brief, le plan et la cible
 * des taches futures — pour qu'un refus de validation lui rende sa page telle
 * qu'il l'avait laissee. Perdre une demi-heure d'edition parce qu'une commande
 * etait mal formee serait une punition, pas un message d'erreur.
 */
export type ProjectChangeApplyState = {
  items: ReplanReviewItem[];
  brief: BriefFormValues;
  plan: V1PlanFormValues;
  error: string | null;
  /** L'etat du projet a change depuis : l'application est refusee. */
  stale: boolean;
};

export type ProjectChangeDismissState = { error: string | null };
