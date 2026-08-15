/**
 * Affichage de l'etat structure d'un projet.
 *
 * ## Ce module ne decide de rien
 *
 * Il traduit : des URL, des libelles, une liste saisie ligne a ligne, et les
 * phrases qui expliquent un refus. Aucune regle metier n'y vit — les bornes, le
 * budget et les revisions appartiennent au serveur, et les redire ici les ferait
 * diverger le jour ou l'une des deux changerait.
 *
 * Pur et sans dependance : ni base, ni React, ni reseau.
 */

import {
  PROJECT_PLAN_LIMITS,
  type ProjectBriefInput,
  type ProjectPlanRefusal,
  type ProjectV1PlanInput,
} from "@nox/shared";

/** Page principale de l'etat structure d'un projet. */
export function planUrl(projectId: string): string {
  return `/projects/${projectId}/plan`;
}

/** Formulaire du brief produit. */
export function editBriefUrl(projectId: string): string {
  return `/projects/${projectId}/plan/brief`;
}

/** Formulaire du plan de V1. */
export function editPlanUrl(projectId: string): string {
  return `/projects/${projectId}/plan/v1`;
}

/** Revue d'une proposition de l'Architecte. */
export function projectUpdateUrl(projectId: string, updateId: string): string {
  return `/projects/${projectId}/architect/project-updates/${updateId}`;
}

/**
 * Lit une liste saisie ligne a ligne.
 *
 * Un element par ligne : c'est la saisie la plus rapide au clavier, et la seule
 * qui se recopie telle quelle depuis un document. Les lignes vides disparaissent
 * — une ligne qu'on n'a pas remplie n'est pas un element vide.
 *
 * Le serveur renormalise de toute facon : cette fonction sert a lire un
 * formulaire, jamais a garantir quoi que ce soit.
 */
export function readPlanList(value: string): string[] {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/** Reecrit une liste pour la reafficher dans un champ de saisie. */
export function writePlanList(values: readonly string[]): string {
  return values.join("\n");
}

/** Nom lisible d'un champ, pour un message de refus. */
const FIELD_LABELS: Record<string, string> = {
  summary: "Resume",
  problem: "Probleme",
  targetUsers: "Utilisateurs vises",
  desiredOutcome: "Resultat vise",
  goals: "Objectifs",
  nonGoals: "Hors objectifs",
  goal: "Objectif de la V1",
  inScope: "Dans le perimetre",
  outOfScope: "Hors perimetre",
  technicalDirection: "Direction technique",
  milestones: "Etapes",
};

export function planFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * Phrase expliquant un refus de champ.
 *
 * Elle dit **quoi faire**, pas seulement que c'est refuse : « trop long » sans
 * la borne oblige a chercher.
 */
export function planRefusalMessage(refusal: ProjectPlanRefusal): string {
  const label = planFieldLabel(refusal.field);

  switch (refusal.reason) {
    case "too_long":
      return `Le champ « ${label} » depasse la taille acceptee. Raccourcissez-le avant d'enregistrer.`;
    case "too_many":
      return `La liste « ${label} » contient trop d'elements (maximum ${String(PROJECT_PLAN_LIMITS.items)}). Retirez-en avant d'enregistrer.`;
    case "item_too_long":
      return `Un element de « ${label} » depasse ${String(PROJECT_PLAN_LIMITS.item)} caracteres. Une entree decrit une idee, pas un paragraphe.`;
    case "control_character":
      return `Le champ « ${label} » contient un caractere que NOX n'accepte pas. Recollez le texte depuis une source simple.`;
  }
}

/**
 * Phrase expliquant un refus d'ecriture.
 *
 * Le budget et la peremption ne se resolvent pas de la meme facon : le premier
 * demande de raccourcir, la seconde de recharger. Les confondre sous un
 * « Validation failed » laisserait l'utilisateur sans rien a faire.
 */
export function planWriteRefusalMessage(
  result:
    | { reason: "not_found" }
    | { reason: "invalid"; field: string }
    | { reason: "budget"; used: number; limit: number }
    | { reason: "stale"; currentRevision: string | null },
): string {
  switch (result.reason) {
    case "not_found":
      return "Ce projet n'existe pas. Revenez au tableau de bord et rouvrez-le.";
    case "invalid":
      return `Le champ « ${planFieldLabel(result.field)} » est refuse. Corrigez-le avant d'enregistrer.`;
    case "budget":
      return (
        "Le Project Brief et le Living V1 Plan depassent ensemble la place reservee a l'etat " +
        `structure du projet (${formatPlanSize(result.used)} pour ${formatPlanSize(result.limit)}). ` +
        "Ils partagent un seul budget : raccourcissez l'un ou l'autre avant d'enregistrer."
      );
    case "stale":
      return (
        "Ce Project Plan a change ailleurs depuis l'ouverture de ce formulaire. " +
        "Rechargez la version actuelle avant d'enregistrer — NOX ne remplace jamais " +
        "silencieusement le travail d'un autre onglet."
      );
  }
}

/** Taille lisible, en caracteres ou en Kio. */
export function formatPlanSize(chars: number): string {
  if (chars < 1024) {
    return `${String(chars)} caracteres`;
  }
  return `${(chars / 1024).toFixed(1)} Kio`;
}

/**
 * Etat d'affichage d'une section : trois cas, jamais deux.
 *
 * `absent` et `empty` ne se confondent pas. La premiere dit que personne n'a
 * rien ecrit ; la seconde qu'une ligne existe et ne dit rien. Les fusionner
 * ferait afficher « Not defined » sur un objet que l'utilisateur a bel et bien
 * cree, et son prochain enregistrement se croirait une creation.
 */
export type PlanSectionState = "absent" | "empty" | "defined";

export function briefSectionState(
  present: boolean,
  values: ProjectBriefInput | null,
): PlanSectionState {
  if (!present || values === null) {
    return "absent";
  }
  const empty =
    values.summary === "" &&
    values.problem === "" &&
    values.targetUsers === "" &&
    values.desiredOutcome === "" &&
    values.goals.length === 0 &&
    values.nonGoals.length === 0;
  return empty ? "empty" : "defined";
}

export function planSectionState(
  present: boolean,
  values: ProjectV1PlanInput | null,
): PlanSectionState {
  if (!present || values === null) {
    return "absent";
  }
  const empty =
    values.goal === "" &&
    values.technicalDirection === "" &&
    values.inScope.length === 0 &&
    values.outOfScope.length === 0 &&
    values.milestones.length === 0;
  return empty ? "empty" : "defined";
}

/** Libelle court d'un etat de section, pour la carte du projet. */
export function planSectionStateLabel(state: PlanSectionState): string {
  switch (state) {
    case "absent":
      return "Not defined";
    case "empty":
      return "Defined, empty";
    case "defined":
      return "Defined";
  }
}

/**
 * Nombre de champs modifies par une section d'une proposition.
 *
 * Sert au libelle de la carte de chat — « 2 changes » dit assez pour decider
 * d'ouvrir la revue, et rien de plus n'y tiendrait.
 */
export function countPlanChanges(fields: readonly { changed: boolean }[]): number {
  return fields.filter((field) => field.changed).length;
}

/** Libelle d'un nombre de changements. */
export function planChangeCountLabel(count: number): string {
  if (count === 0) {
    return "No proposed change";
  }
  return count === 1 ? "1 change" : `${String(count)} changes`;
}
