/**
 * Etat structure d'un projet : son brief produit et son plan de V1.
 *
 * ## Deux objets, deux questions
 *
 * Le **Project Brief** decrit le produit : ce qu'on construit, pour qui, contre
 * quel probleme. Il bouge peu.
 *
 * Le **Living V1 Plan** decrit comment atteindre une premiere version utile : ce
 * qui est dans le perimetre, ce qui n'y est pas, la direction technique, les
 * grandes etapes. Il bouge souvent.
 *
 * Les fusionner en un seul champ Markdown aurait ete plus rapide a ecrire et
 * inutilisable a lire : on ne repond pas « qui utilise ce produit ? » et « que
 * doit accomplir la V1 ? » au meme endroit.
 *
 * ## Ce que ce n'est pas
 *
 * Ce n'est pas une seconde memoire projet. « Nous utilisons SQLite parce que… »
 * est une decision, et sa place est dans la memoire. « L'application aide a
 * organiser ses repas de la semaine » est un brief.
 *
 * Ce n'est pas un backlog non plus. Une etape decrit une **capacite atteinte**,
 * pas un travail a faire : « le planning hebdomadaire est utilisable », jamais
 * « implementer POST /api/meals ». Aucun critere d'acceptation, aucune commande
 * de validation, aucune dependance n'a sa place ici.
 *
 * ## Bornes
 *
 * Des constantes, jamais des variables d'environnement — comme partout ailleurs
 * dans NOX, une limite qu'on peut desserrer depuis un `.env` n'en est plus une.
 *
 * Le budget global est verifie a **l'ecriture**, sur le texte sanitise qui
 * partirait reellement. Une modification qui le depasserait est refusee, avec sa
 * raison. Jamais de troncature silencieuse : le brief et le plan sont de la
 * connaissance validee explicitement, et un plan qui annonce douze etapes dont
 * le fournisseur n'en recevrait que quatre serait un mensonge.
 */

/** Bornes de l'etat structure. En caracteres, mesurees apres sanitation. */
export const PROJECT_PLAN_LIMITS = {
  /** Le projet en quelques phrases. */
  summary: 2 * 1024,
  /** Le probleme resolu. */
  problem: 4 * 1024,
  /** A qui le produit s'adresse. */
  targetUsers: 2 * 1024,
  /** Le resultat vise. */
  desiredOutcome: 2 * 1024,
  /** Ce que la V1 doit accomplir. */
  goal: 2 * 1024,
  /** La direction technique retenue. */
  technicalDirection: 4 * 1024,
  /** Un element de liste : objectif, perimetre, etape. */
  item: 512,
  /** Nombre d'elements par liste. */
  items: 20,
  /**
   * Budget commun au brief et au plan, mesure apres sanitation.
   *
   * Seize Kio, et le chiffre se demontre plutot qu'il ne se choisit. Le contexte
   * de l'Architecte vaut 128 Kio, consommes dans cet ordre : etat structure,
   * conventions, memoire, taches, documents. Les conventions consomment au plus
   * deux documents de 32 Kio, la memoire a un budget d'ecriture de 48 Kio.
   *
   * ```text
   * 16 (etat structure) + 64 (conventions) + 48 (memoire) = 128
   * ```
   *
   * Les trois categories qui ne doivent **jamais** etre tronquees tiennent donc
   * exactement dans le budget global. Taches et documents se partagent ce qui
   * reste, et eux ont le droit d'etre coupes.
   */
  structuredChars: 16 * 1024,
} as const;

/** Le brief produit, tel que l'interface le lit. */
export type ProjectBrief = {
  id: string;
  projectId: string;
  summary: string;
  problem: string;
  targetUsers: string;
  desiredOutcome: string;
  goals: string[];
  nonGoals: string[];
  /** Date ISO 8601. */
  createdAt: string;
  /** Date ISO 8601. */
  updatedAt: string;
};

/** Le plan de V1, tel que l'interface le lit. */
export type ProjectV1Plan = {
  id: string;
  projectId: string;
  goal: string;
  inScope: string[];
  outOfScope: string[];
  technicalDirection: string;
  milestones: string[];
  /** Date ISO 8601. */
  createdAt: string;
  /** Date ISO 8601. */
  updatedAt: string;
};

/** Ce qu'un formulaire propose pour le brief, avant toute validation. */
export type ProjectBriefInput = {
  summary: string;
  problem: string;
  targetUsers: string;
  desiredOutcome: string;
  goals: string[];
  nonGoals: string[];
};

/** Ce qu'un formulaire propose pour le plan, avant toute validation. */
export type ProjectV1PlanInput = {
  goal: string;
  inScope: string[];
  outOfScope: string[];
  technicalDirection: string;
  milestones: string[];
};

/** Champs bornes du brief et du plan, pour un message de refus precis. */
export type ProjectPlanField =
  | "summary"
  | "problem"
  | "targetUsers"
  | "desiredOutcome"
  | "goals"
  | "nonGoals"
  | "goal"
  | "inScope"
  | "outOfScope"
  | "technicalDirection"
  | "milestones";

export type ProjectPlanRefusal = {
  field: ProjectPlanField;
  reason: "too_long" | "too_many" | "item_too_long" | "control_character";
};

/**
 * Normalise un texte de plan.
 *
 * Fins de ligne ramenees a `\n`, marges retirees. Rien d'autre : le texte relu
 * dans six mois doit etre celui qui a ete ecrit, et une revision reproductible
 * exige une forme unique.
 */
export function normalizeProjectPlanText(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

/**
 * Normalise une liste : chaque element nettoye, les vides retires.
 *
 * Une ligne vide dans un formulaire est une ligne que l'utilisateur n'a pas
 * remplie, pas un element vide qu'il faudrait conserver. La retirer ici evite
 * qu'elle occupe une place dans la borne et dans la revision.
 */
export function normalizeProjectPlanList(values: readonly string[]): string[] {
  return values.map(normalizeProjectPlanText).filter((value) => value !== "");
}

/**
 * Refuse les octets qui casseraient une ecriture ou un affichage.
 *
 * Meme regle que la memoire projet : tabulation, saut de ligne et retour
 * chariot portent la structure du texte et sont conserves ; les autres
 * caracteres de controle ne portent rien.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const printable = code >= 0x20 && code !== 0x7f;
    const structural = code === 0x09 || code === 0x0a || code === 0x0d;
    if (!printable && !structural) {
      return true;
    }
  }
  return false;
}

/** Verifie un champ de texte borne. */
function checkText(
  value: string,
  max: number,
  field: ProjectPlanField,
): ProjectPlanRefusal | null {
  if (value.length > max) {
    return { field, reason: "too_long" };
  }
  if (hasControlCharacter(value)) {
    return { field, reason: "control_character" };
  }
  return null;
}

/** Verifie une liste bornee en nombre et en taille d'element. */
function checkList(values: readonly string[], field: ProjectPlanField): ProjectPlanRefusal | null {
  if (values.length > PROJECT_PLAN_LIMITS.items) {
    return { field, reason: "too_many" };
  }
  for (const value of values) {
    if (value.length > PROJECT_PLAN_LIMITS.item) {
      return { field, reason: "item_too_long" };
    }
    if (hasControlCharacter(value)) {
      return { field, reason: "control_character" };
    }
  }
  return null;
}

export type ProjectBriefCheck =
  | { ok: true; values: ProjectBriefInput }
  | { ok: false; refusal: ProjectPlanRefusal };

export type ProjectV1PlanCheck =
  | { ok: true; values: ProjectV1PlanInput }
  | { ok: false; refusal: ProjectPlanRefusal };

/**
 * Valide et normalise un brief.
 *
 * Fonction pure : c'est la meme qui garde le formulaire manuel et l'application
 * d'une proposition de l'Architecte. Deux implementations divergeraient, et
 * celle qui aurait tort serait celle qui accepte.
 *
 * **Aucun champ n'est obligatoire.** Un brief partiel est un etat legitime : on
 * connait souvent le probleme avant de savoir nommer la cible. Le budget, lui,
 * n'est pas verifie ici — il depend du plan et du texte sanitise, deux choses
 * que cette fonction ne connait pas.
 */
export function checkProjectBriefInput(input: ProjectBriefInput): ProjectBriefCheck {
  const values: ProjectBriefInput = {
    summary: normalizeProjectPlanText(input.summary),
    problem: normalizeProjectPlanText(input.problem),
    targetUsers: normalizeProjectPlanText(input.targetUsers),
    desiredOutcome: normalizeProjectPlanText(input.desiredOutcome),
    goals: normalizeProjectPlanList(input.goals),
    nonGoals: normalizeProjectPlanList(input.nonGoals),
  };

  const refusal =
    checkText(values.summary, PROJECT_PLAN_LIMITS.summary, "summary") ??
    checkText(values.problem, PROJECT_PLAN_LIMITS.problem, "problem") ??
    checkText(values.targetUsers, PROJECT_PLAN_LIMITS.targetUsers, "targetUsers") ??
    checkText(values.desiredOutcome, PROJECT_PLAN_LIMITS.desiredOutcome, "desiredOutcome") ??
    checkList(values.goals, "goals") ??
    checkList(values.nonGoals, "nonGoals");

  return refusal === null ? { ok: true, values } : { ok: false, refusal };
}

/** Valide et normalise un plan de V1. Memes regles que le brief. */
export function checkProjectV1PlanInput(input: ProjectV1PlanInput): ProjectV1PlanCheck {
  const values: ProjectV1PlanInput = {
    goal: normalizeProjectPlanText(input.goal),
    inScope: normalizeProjectPlanList(input.inScope),
    outOfScope: normalizeProjectPlanList(input.outOfScope),
    technicalDirection: normalizeProjectPlanText(input.technicalDirection),
    milestones: normalizeProjectPlanList(input.milestones),
  };

  const refusal =
    checkText(values.goal, PROJECT_PLAN_LIMITS.goal, "goal") ??
    checkText(
      values.technicalDirection,
      PROJECT_PLAN_LIMITS.technicalDirection,
      "technicalDirection",
    ) ??
    checkList(values.inScope, "inScope") ??
    checkList(values.outOfScope, "outOfScope") ??
    checkList(values.milestones, "milestones");

  return refusal === null ? { ok: true, values } : { ok: false, refusal };
}

/** Un brief entierement vide reste un brief : il est defini, il ne dit rien. */
export function isProjectBriefEmpty(values: ProjectBriefInput): boolean {
  return (
    values.summary === "" &&
    values.problem === "" &&
    values.targetUsers === "" &&
    values.desiredOutcome === "" &&
    values.goals.length === 0 &&
    values.nonGoals.length === 0
  );
}

/** Un plan entierement vide reste un plan. */
export function isProjectV1PlanEmpty(values: ProjectV1PlanInput): boolean {
  return (
    values.goal === "" &&
    values.technicalDirection === "" &&
    values.inScope.length === 0 &&
    values.outOfScope.length === 0 &&
    values.milestones.length === 0
  );
}

/** Nombre de caracteres d'un brief. Sert a mesurer le budget. */
export function projectBriefChars(values: ProjectBriefInput): number {
  return (
    values.summary.length +
    values.problem.length +
    values.targetUsers.length +
    values.desiredOutcome.length +
    values.goals.reduce((total, entry) => total + entry.length, 0) +
    values.nonGoals.reduce((total, entry) => total + entry.length, 0)
  );
}

/** Nombre de caracteres d'un plan. */
export function projectV1PlanChars(values: ProjectV1PlanInput): number {
  return (
    values.goal.length +
    values.technicalDirection.length +
    values.inScope.reduce((total, entry) => total + entry.length, 0) +
    values.outOfScope.reduce((total, entry) => total + entry.length, 0) +
    values.milestones.reduce((total, entry) => total + entry.length, 0)
  );
}

/** Ce que l'Architecte recoit du brief : le texte sanitise, et sa revision. */
export type ArchitectPromptBrief = {
  revision: string;
  summary: string;
  problem: string;
  targetUsers: string;
  desiredOutcome: string;
  goals: string[];
  nonGoals: string[];
};

/** Ce que l'Architecte recoit du plan. */
export type ArchitectPromptV1Plan = {
  revision: string;
  goal: string;
  inScope: string[];
  outOfScope: string[];
  technicalDirection: string;
  milestones: string[];
};

// --- Mise a jour proposee par l'Architecte -----------------------------------

/**
 * Etat d'une proposition de mise a jour du projet.
 *
 * Trois etats, et une seule transition possible depuis `PENDING`. Une
 * proposition appliquee ne l'est jamais deux fois, une proposition ecartee ne
 * modifie rien.
 */
export const ARCHITECT_PROJECT_UPDATE_STATUS = {
  PENDING: "PENDING",
  APPLIED: "APPLIED",
  DISMISSED: "DISMISSED",
} as const;

export type ArchitectProjectUpdateStatus =
  (typeof ARCHITECT_PROJECT_UPDATE_STATUS)[keyof typeof ARCHITECT_PROJECT_UPDATE_STATUS];

export const ARCHITECT_PROJECT_UPDATE_STATUSES: readonly ArchitectProjectUpdateStatus[] =
  Object.values(ARCHITECT_PROJECT_UPDATE_STATUS);

export function isArchitectProjectUpdateStatus(
  value: unknown,
): value is ArchitectProjectUpdateStatus {
  return typeof value === "string" && ARCHITECT_PROJECT_UPDATE_STATUSES.includes(value as ArchitectProjectUpdateStatus);
}

/**
 * Ce qu'une proposition demande pour une section.
 *
 * Deux actions, declarees plutot que deduites. `null` aurait pu signifier
 * « inchange », mais il aurait aussi pu signifier « vide » : deux sens pour une
 * seule valeur, et un modele qui hesite entre les deux produit un effacement que
 * personne n'a demande. Une action explicite retire la question.
 */
export const PROJECT_UPDATE_ACTION = {
  /** La section garde sa valeur actuelle. `value` vaut alors `null`. */
  UNCHANGED: "UNCHANGED",
  /** La section prend la valeur portee par `value`. */
  SET: "SET",
} as const;

export type ProjectUpdateAction =
  (typeof PROJECT_UPDATE_ACTION)[keyof typeof PROJECT_UPDATE_ACTION];

export const PROJECT_UPDATE_ACTIONS: readonly ProjectUpdateAction[] =
  Object.values(PROJECT_UPDATE_ACTION);

export function isProjectUpdateAction(value: unknown): value is ProjectUpdateAction {
  return (
    typeof value === "string" &&
    PROJECT_UPDATE_ACTIONS.includes(value as ProjectUpdateAction)
  );
}

/**
 * Une section d'une proposition : ce qu'elle demande, et la valeur qui va avec.
 *
 * Les deux invariants sont verifies cote serveur, jamais supposes :
 *
 * ```text
 * UNCHANGED → value = null
 * SET       → value != null
 * ```
 */
export type ProjectUpdateSection<TValue> = {
  action: ProjectUpdateAction;
  value: TValue | null;
};

/**
 * Etat cible propose pour le projet.
 *
 * ## Un etat cible, pas un correctif
 *
 * Une section `SET` porte la **valeur complete** qu'elle veut voir, jamais un
 * fragment. Un correctif partiel — « ajoute ceci a la liste » — obligerait le
 * serveur a interpreter une intention, et deux interpretations raisonnables
 * suffiraient a rendre une application impossible a verifier. Un etat cible
 * complet se valide, se relit, s'edite et s'applique sans rappeler personne.
 *
 * ## Aucune suppression
 *
 * Il n'existe pas d'action `DELETE` dans TASK-021. Vider une section se propose
 * en la rendant vide — ce qui reste visible dans la revue avant application.
 */
export type ArchitectProjectUpdateProposal = {
  /** Pourquoi ce changement. Du contenu, jamais une instruction. */
  reason: string;
  brief: ProjectUpdateSection<ProjectBriefInput>;
  plan: ProjectUpdateSection<ProjectV1PlanInput>;
};

/** Section vide, utilisee comme valeur de repli d'un payload illisible. */
export function unchangedProjectUpdateSection<TValue>(): ProjectUpdateSection<TValue> {
  return { action: PROJECT_UPDATE_ACTION.UNCHANGED, value: null };
}

/**
 * Etat cible resolu : ce qui sera reellement ecrit.
 *
 * `null` sur une section signifie « rien a ecrire ici » — la section reste
 * exactement ce qu'elle etait, y compris absente.
 */
export type ProjectUpdateTarget = {
  brief: ProjectBriefInput | null;
  plan: ProjectV1PlanInput | null;
};

/** Extrait de la proposition les seules sections a ecrire. */
export function projectUpdateTarget(
  proposal: ArchitectProjectUpdateProposal,
): ProjectUpdateTarget {
  return {
    brief: proposal.brief.action === PROJECT_UPDATE_ACTION.SET ? proposal.brief.value : null,
    plan: proposal.plan.action === PROJECT_UPDATE_ACTION.SET ? proposal.plan.value : null,
  };
}

/** Une proposition qui ne change rien n'en est pas une. */
export function projectUpdateTouchesSomething(
  proposal: ArchitectProjectUpdateProposal,
): boolean {
  return (
    proposal.brief.action === PROJECT_UPDATE_ACTION.SET ||
    proposal.plan.action === PROJECT_UPDATE_ACTION.SET
  );
}

export type ProjectUpdateRefusal = {
  field: string;
  message: string;
};

export type ArchitectProjectUpdateResult =
  | { ok: true; proposal: ArchitectProjectUpdateProposal }
  | { ok: false; refusal: ProjectUpdateRefusal };

/** Bornes du texte libre d'une proposition. */
export const PROJECT_UPDATE_REASON_LIMIT = 2 * 1024;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refuseUpdate(field: string, message: string): ArchitectProjectUpdateResult {
  return { ok: false, refusal: { field, message } };
}

/** Lit une liste de chaines rendue par le fournisseur. */
function readStringList(value: unknown): string[] | null {
  if (value === null || value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const entries: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") {
      return null;
    }
    entries.push(raw);
  }
  return entries;
}

function readText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : null;
}

/**
 * Lit une section, et fait respecter les deux invariants d'action.
 *
 * Le Structured Output garantit qu'`action` et `value` sont presents ; il ne
 * garantit pas qu'ils sont coherents. Un `SET` sans valeur et un `UNCHANGED`
 * porteur d'un objet sont deux reponses conformes au schema et inacceptables :
 * la premiere ne dit pas quoi ecrire, la seconde dit deux choses a la fois.
 */
function readSection<TValue>(
  raw: unknown,
  field: string,
  readValue: (value: Record<string, unknown>) => TValue | ProjectPlanRefusal,
): { ok: true; section: ProjectUpdateSection<TValue> } | { ok: false; refusal: ProjectUpdateRefusal } {
  if (!isPlainRecord(raw)) {
    return { ok: false, refusal: { field, message: `La section « ${field} » n'est pas lisible.` } };
  }

  const action: unknown = raw["action"];
  if (!isProjectUpdateAction(action)) {
    return {
      ok: false,
      refusal: { field, message: `L'action proposee pour « ${field} » est inconnue.` },
    };
  }

  const value: unknown = raw["value"];

  if (action === PROJECT_UPDATE_ACTION.UNCHANGED) {
    if (isPlainRecord(value)) {
      return {
        ok: false,
        refusal: {
          field,
          message: `« ${field} » est annoncee inchangee tout en portant une nouvelle valeur.`,
        },
      };
    }
    return { ok: true, section: { action, value: null } };
  }

  if (!isPlainRecord(value)) {
    return {
      ok: false,
      refusal: { field, message: `« ${field} » doit changer sans porter de nouvelle valeur.` },
    };
  }

  const read = readValue(value);
  if (isPlanRefusal(read)) {
    return {
      ok: false,
      refusal: {
        field: `${field}.${read.field}`,
        message: `La valeur proposee pour « ${read.field} » est refusee : ${read.reason}.`,
      },
    };
  }

  return { ok: true, section: { action, value: read } };
}

function isPlanRefusal(value: unknown): value is ProjectPlanRefusal {
  return isPlainRecord(value) && typeof value["field"] === "string" && typeof value["reason"] === "string";
}

/**
 * Valide une proposition rendue par le fournisseur.
 *
 * Ne fait **aucune** confiance au Structured Output. Les valeurs traversent
 * exactement `checkProjectBriefInput` et `checkProjectV1PlanInput` — les memes
 * fonctions que le formulaire manuel, jamais une seconde implementation plus
 * permissive.
 *
 * Le budget commun n'est pas verifie ici : il depend de l'etat courant du projet,
 * que ce module ne connait pas. Il l'est cote serveur, avant tout enregistrement.
 */
export function readArchitectProjectUpdate(value: unknown): ArchitectProjectUpdateResult {
  if (!isPlainRecord(value)) {
    return refuseUpdate("projectUpdate", "La mise a jour proposee n'est pas une structure lisible.");
  }

  const rawReason: unknown = value["reason"];
  if (typeof rawReason !== "string") {
    return refuseUpdate("reason", "La mise a jour proposee ne dit pas pourquoi elle existe.");
  }
  const reason = normalizeProjectPlanText(rawReason);
  if (reason === "") {
    return refuseUpdate("reason", "La mise a jour proposee ne dit pas pourquoi elle existe.");
  }
  if (reason.length > PROJECT_UPDATE_REASON_LIMIT) {
    return refuseUpdate("reason", "La justification de la mise a jour est trop longue.");
  }

  const brief = readSection(value["brief"], "brief", (record) => {
    const summary = readText(record["summary"]);
    const problem = readText(record["problem"]);
    const targetUsers = readText(record["targetUsers"]);
    const desiredOutcome = readText(record["desiredOutcome"]);
    const goals = readStringList(record["goals"]);
    const nonGoals = readStringList(record["nonGoals"]);

    if (
      summary === null ||
      problem === null ||
      targetUsers === null ||
      desiredOutcome === null ||
      goals === null ||
      nonGoals === null
    ) {
      return { field: "summary", reason: "control_character" } satisfies ProjectPlanRefusal;
    }

    const checked = checkProjectBriefInput({
      summary,
      problem,
      targetUsers,
      desiredOutcome,
      goals,
      nonGoals,
    });
    return checked.ok ? checked.values : checked.refusal;
  });
  if (!brief.ok) {
    return { ok: false, refusal: brief.refusal };
  }

  const plan = readSection(value["plan"], "plan", (record) => {
    const goal = readText(record["goal"]);
    const technicalDirection = readText(record["technicalDirection"]);
    const inScope = readStringList(record["inScope"]);
    const outOfScope = readStringList(record["outOfScope"]);
    const milestones = readStringList(record["milestones"]);

    if (
      goal === null ||
      technicalDirection === null ||
      inScope === null ||
      outOfScope === null ||
      milestones === null
    ) {
      return { field: "goal", reason: "control_character" } satisfies ProjectPlanRefusal;
    }

    const checked = checkProjectV1PlanInput({
      goal,
      inScope,
      outOfScope,
      technicalDirection,
      milestones,
    });
    return checked.ok ? checked.values : checked.refusal;
  });
  if (!plan.ok) {
    return { ok: false, refusal: plan.refusal };
  }

  const proposal: ArchitectProjectUpdateProposal = {
    reason,
    brief: brief.section,
    plan: plan.section,
  };

  // Une proposition qui n'annonce aucun changement n'a rien a proposer. Elle
  // serait persistee, affichee, et n'aurait rien a appliquer.
  if (!projectUpdateTouchesSomething(proposal)) {
    return refuseUpdate(
      "projectUpdate",
      "La mise a jour proposee ne modifie ni le brief, ni le plan.",
    );
  }

  return { ok: true, proposal };
}
