/**
 * Modele de revue d'une proposition de mise a jour du projet.
 *
 * ## Ce que ce module produit
 *
 * Une representation `Current → Proposed`, champ par champ, dans l'ordre ou le
 * brief et le plan se lisent. Rien de plus : ni HTML, ni Markdown, ni couleur, ni
 * libelle traduit. L'interface viendra ensuite et n'aura qu'a afficher.
 *
 * ## Pourquoi pas un diff textuel
 *
 * Parce qu'un diff mot a mot repond a la mauvaise question. L'utilisateur ne
 * relit pas une proposition pour savoir quels caracteres ont bouge, mais pour
 * decider si la nouvelle valeur est la bonne. Un champ porte donc sa valeur
 * actuelle et sa valeur proposee, entieres, et un booleen qui dit si elles
 * different.
 *
 * ## Pur, et sans etat
 *
 * Aucune lecture de base, aucun appel, aucune date. Les memes entrees produisent
 * toujours la meme revue, ce qui la rend testable sans projet.
 */

import {
  PROJECT_UPDATE_ACTION,
  type ArchitectProjectUpdateProposal,
  type ProjectBriefInput,
  type ProjectUpdateAction,
  type ProjectV1PlanInput,
} from "./project-plan.js";

/** Nature d'un champ : elle decide de la forme de `current` et `proposed`. */
export const PROJECT_UPDATE_FIELD_KIND = { TEXT: "TEXT", LIST: "LIST" } as const;

export type ProjectUpdateFieldKind =
  (typeof PROJECT_UPDATE_FIELD_KIND)[keyof typeof PROJECT_UPDATE_FIELD_KIND];

/**
 * Un champ de la revue.
 *
 * `current` et `proposed` portent toujours une valeur, meme quand la section
 * n'existe pas encore : une chaine vide ou une liste vide disent « rien », et
 * evitent a l'interface d'avoir a distinguer trois cas la ou deux suffisent.
 * L'absence de la section, elle, se lit sur `ProjectUpdateReviewSection.present`.
 */
export type ProjectUpdateReviewField = {
  /** Identifiant stable du champ. Le libelle affiche vit dans l'interface. */
  field: string;
  kind: ProjectUpdateFieldKind;
  currentText: string;
  proposedText: string;
  currentList: readonly string[];
  proposedList: readonly string[];
  changed: boolean;
};

export type ProjectUpdateReviewSection = {
  section: "BRIEF" | "PLAN";
  action: ProjectUpdateAction;
  /** La section existe-t-elle deja dans le projet ? */
  present: boolean;
  /** Vrai des qu'au moins un champ change. Faux sur une section `UNCHANGED`. */
  changed: boolean;
  fields: readonly ProjectUpdateReviewField[];
};

export type ProjectUpdateReview = {
  reason: string;
  brief: ProjectUpdateReviewSection;
  plan: ProjectUpdateReviewSection;
};

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function textField(field: string, current: string, proposed: string): ProjectUpdateReviewField {
  return {
    field,
    kind: PROJECT_UPDATE_FIELD_KIND.TEXT,
    currentText: current,
    proposedText: proposed,
    currentList: [],
    proposedList: [],
    changed: current !== proposed,
  };
}

function listField(
  field: string,
  current: readonly string[],
  proposed: readonly string[],
): ProjectUpdateReviewField {
  return {
    field,
    kind: PROJECT_UPDATE_FIELD_KIND.LIST,
    currentText: "",
    proposedText: "",
    currentList: current,
    proposedList: proposed,
    changed: !sameList(current, proposed),
  };
}

const EMPTY_BRIEF: ProjectBriefInput = {
  summary: "",
  problem: "",
  targetUsers: "",
  desiredOutcome: "",
  goals: [],
  nonGoals: [],
};

const EMPTY_PLAN: ProjectV1PlanInput = {
  goal: "",
  inScope: [],
  outOfScope: [],
  technicalDirection: "",
  milestones: [],
};

function briefFields(
  current: ProjectBriefInput,
  proposed: ProjectBriefInput,
): ProjectUpdateReviewField[] {
  return [
    textField("summary", current.summary, proposed.summary),
    textField("problem", current.problem, proposed.problem),
    textField("targetUsers", current.targetUsers, proposed.targetUsers),
    textField("desiredOutcome", current.desiredOutcome, proposed.desiredOutcome),
    listField("goals", current.goals, proposed.goals),
    listField("nonGoals", current.nonGoals, proposed.nonGoals),
  ];
}

function planFields(
  current: ProjectV1PlanInput,
  proposed: ProjectV1PlanInput,
): ProjectUpdateReviewField[] {
  return [
    textField("goal", current.goal, proposed.goal),
    listField("inScope", current.inScope, proposed.inScope),
    listField("outOfScope", current.outOfScope, proposed.outOfScope),
    textField("technicalDirection", current.technicalDirection, proposed.technicalDirection),
    listField("milestones", current.milestones, proposed.milestones),
  ];
}

/**
 * Construit la revue d'une proposition.
 *
 * Une section `UNCHANGED` est rendue quand meme : elle porte ses valeurs
 * actuelles des deux cotes et `changed: false`. Ne pas la rendre du tout
 * obligerait l'interface a deviner ce qui n'a pas bouge, et l'utilisateur a
 * faire confiance a ce silence.
 */
export function buildArchitectProjectUpdateReview(
  current: { brief: ProjectBriefInput | null; plan: ProjectV1PlanInput | null },
  proposal: ArchitectProjectUpdateProposal,
): ProjectUpdateReview {
  const currentBrief = current.brief ?? EMPTY_BRIEF;
  const currentPlan = current.plan ?? EMPTY_PLAN;

  const proposedBrief =
    proposal.brief.action === PROJECT_UPDATE_ACTION.SET && proposal.brief.value !== null
      ? proposal.brief.value
      : currentBrief;
  const proposedPlan =
    proposal.plan.action === PROJECT_UPDATE_ACTION.SET && proposal.plan.value !== null
      ? proposal.plan.value
      : currentPlan;

  const briefEntries = briefFields(currentBrief, proposedBrief);
  const planEntries = planFields(currentPlan, proposedPlan);

  return {
    reason: proposal.reason,
    brief: {
      section: "BRIEF",
      action: proposal.brief.action,
      present: current.brief !== null,
      changed: briefEntries.some((entry) => entry.changed),
      fields: briefEntries,
    },
    plan: {
      section: "PLAN",
      action: proposal.plan.action,
      present: current.plan !== null,
      changed: planEntries.some((entry) => entry.changed),
      fields: planEntries,
    },
  };
}
