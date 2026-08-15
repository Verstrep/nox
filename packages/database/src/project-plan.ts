/**
 * Etat structure d'un projet : lecture, ecriture, et le budget qui les borne.
 *
 * ## Le nettoyeur et les revisions sont injectes
 *
 * Comme pour la memoire projet, ce module recoit le nettoyeur de l'Architecte
 * plutot que de l'importer : `packages/database` doit rester utilisable par un
 * script, et le nettoyeur vit dans `apps/web`. Les fonctions de revision suivent
 * le meme chemin, pour la meme raison — elles s'appuient sur `node:crypto`, que
 * `@nox/shared` n'a pas le droit d'importer.
 *
 * Ce detour a une vertu : le budget, la revision et l'ecriture se calculent
 * **dans la meme transaction**, sur le texte qui partira reellement. Une valeur
 * acceptee ici tiendra donc dans le contexte au moment de l'envoi.
 *
 * ## Un budget commun, pas deux
 *
 * Le brief et le plan se partagent seize Kio. Deux budgets separes auraient
 * laisse passer un total de trente-deux, et la garantie « jamais tronque » ne
 * tenait qu'a l'arithmetique globale du contexte.
 *
 * ## Absent, defini, vide
 *
 * Trois etats, et ils ne se confondent pas. Absent : personne n'a rien ecrit.
 * Defini : une ligne existe. Vide : elle existe et ne dit rien. La ligne, une
 * fois creee, ne disparait plus — vider ses champs est une edition, jamais une
 * suppression.
 */

import {
  PROJECT_PLAN_LIMITS,
  checkProjectBriefInput,
  checkProjectV1PlanInput,
  projectBriefChars,
  projectV1PlanChars,
  type ArchitectPromptBrief,
  type ArchitectPromptV1Plan,
  type ProjectBrief,
  type ProjectBriefInput,
  type ProjectV1Plan,
  type ProjectV1PlanInput,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Nettoyeur applique avant toute mesure et toute revision. */
export type ProjectPlanSanitizer = (value: string) => string;

/** Fonctions de revision, injectees depuis `apps/web`. */
export type ProjectPlanRevisions = {
  brief: (brief: ArchitectPromptBrief) => string;
  plan: (plan: ArchitectPromptV1Plan) => string;
};

/** Ce dont toute lecture et toute ecriture ont besoin. */
export type ProjectPlanTools = {
  sanitize: ProjectPlanSanitizer;
  revisions: ProjectPlanRevisions;
};

/** Listes serialisees : une valeur illisible vaut liste vide, jamais une panne. */
function readList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

type BriefRow = {
  id: string;
  projectId: string;
  summary: string;
  problem: string;
  targetUsers: string;
  desiredOutcome: string;
  goalsJson: string;
  nonGoalsJson: string;
  createdAt: Date;
  updatedAt: Date;
};

type PlanRow = {
  id: string;
  projectId: string;
  goal: string;
  technicalDirection: string;
  inScopeJson: string;
  outOfScopeJson: string;
  milestonesJson: string;
  createdAt: Date;
  updatedAt: Date;
};

function toBrief(row: BriefRow): ProjectBrief {
  return {
    id: row.id,
    projectId: row.projectId,
    summary: row.summary,
    problem: row.problem,
    targetUsers: row.targetUsers,
    desiredOutcome: row.desiredOutcome,
    goals: readList(row.goalsJson),
    nonGoals: readList(row.nonGoalsJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPlan(row: PlanRow): ProjectV1Plan {
  return {
    id: row.id,
    projectId: row.projectId,
    goal: row.goal,
    technicalDirection: row.technicalDirection,
    inScope: readList(row.inScopeJson),
    outOfScope: readList(row.outOfScopeJson),
    milestones: readList(row.milestonesJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Forme transmise a l'Architecte : texte nettoye, plus la revision. */
export function sanitizedBrief(
  values: ProjectBriefInput,
  tools: ProjectPlanTools,
): ArchitectPromptBrief {
  const brief: ArchitectPromptBrief = {
    revision: "",
    summary: tools.sanitize(values.summary),
    problem: tools.sanitize(values.problem),
    targetUsers: tools.sanitize(values.targetUsers),
    desiredOutcome: tools.sanitize(values.desiredOutcome),
    goals: values.goals.map(tools.sanitize),
    nonGoals: values.nonGoals.map(tools.sanitize),
  };
  brief.revision = tools.revisions.brief(brief);
  return brief;
}

/** Forme transmise a l'Architecte pour le plan. */
export function sanitizedV1Plan(
  values: ProjectV1PlanInput,
  tools: ProjectPlanTools,
): ArchitectPromptV1Plan {
  const plan: ArchitectPromptV1Plan = {
    revision: "",
    goal: tools.sanitize(values.goal),
    technicalDirection: tools.sanitize(values.technicalDirection),
    inScope: values.inScope.map(tools.sanitize),
    outOfScope: values.outOfScope.map(tools.sanitize),
    milestones: values.milestones.map(tools.sanitize),
  };
  plan.revision = tools.revisions.plan(plan);
  return plan;
}

/** Nombre de caracteres reellement transmis pour un brief. */
export function sanitizedBriefChars(brief: ArchitectPromptBrief): number {
  return projectBriefChars({
    summary: brief.summary,
    problem: brief.problem,
    targetUsers: brief.targetUsers,
    desiredOutcome: brief.desiredOutcome,
    goals: brief.goals,
    nonGoals: brief.nonGoals,
  });
}

/** Nombre de caracteres reellement transmis pour un plan. */
export function sanitizedV1PlanChars(plan: ArchitectPromptV1Plan): number {
  return projectV1PlanChars({
    goal: plan.goal,
    technicalDirection: plan.technicalDirection,
    inScope: plan.inScope,
    outOfScope: plan.outOfScope,
    milestones: plan.milestones,
  });
}

/**
 * L'etat structure d'un projet, tel qu'il sera transmis.
 *
 * **La source unique.** Le Context Builder, l'inspection du contexte et la
 * future application d'une proposition lisent tous cet objet : trois lectures
 * differentes finiraient par decrire trois etats differents.
 */
export type ProjectStructuredState = {
  brief: {
    /** Une ligne existe-t-elle ? Different de « elle existe et ne dit rien ». */
    present: boolean;
    /** Valeurs telles qu'elles sont stockees, sans sanitation. */
    stored: ProjectBrief | null;
    /** Ce qui partira, nettoye. `null` lorsque rien n'est defini. */
    prompt: ArchitectPromptBrief | null;
    revision: string | null;
    chars: number;
  };
  plan: {
    present: boolean;
    stored: ProjectV1Plan | null;
    prompt: ArchitectPromptV1Plan | null;
    revision: string | null;
    chars: number;
  };
  /** Cout commun, mesure apres sanitation. Borne par `structuredChars`. */
  combinedChars: number;
};

/**
 * Surface minimale utilisee a l'interieur d'une transaction.
 *
 * Le client transactionnel de Prisma n'est pas un `DatabaseClient` complet : il
 * ne porte ni `$connect`, ni `$transaction`. Ce type dit exactement ce dont la
 * lecture et l'ecriture de l'etat structure ont besoin, et rien de plus.
 */
export type ProjectPlanQueryClient = Pick<DatabaseClient, "projectBrief" | "projectV1Plan">;

/** Les deux lignes d'un projet, telles qu'elles sont stockees. */
export type ProjectPlanRows = { brief: BriefRow | null; plan: PlanRow | null };

/**
 * Lit les deux lignes en une fois.
 *
 * Toujours les deux, meme quand l'appelant n'en modifie qu'une : le budget est
 * commun, et une revision de base se compare sur les deux sections.
 */
export async function readProjectPlanRows(
  tx: ProjectPlanQueryClient,
  projectId: string,
): Promise<ProjectPlanRows> {
  const [brief, plan] = await Promise.all([
    tx.projectBrief.findUnique({ where: { projectId } }),
    tx.projectV1Plan.findUnique({ where: { projectId } }),
  ]);
  return { brief, plan };
}

/** Assemble l'etat structure a partir des lignes lues. */
export function buildStructuredStateFromRows(
  rows: ProjectPlanRows,
  tools: ProjectPlanTools,
): ProjectStructuredState {
  return buildStructuredState(
    rows.brief === null ? null : toBrief(rows.brief),
    rows.plan === null ? null : toPlan(rows.plan),
    tools,
  );
}

/**
 * Ecrit le brief, sans aucun controle.
 *
 * Primitive volontairement nue : validation, revision attendue et budget sont
 * la responsabilite de l'appelant, qui doit les avoir faits **dans la meme
 * transaction**. Elle n'est exportee que pour que l'application d'une
 * proposition puisse ecrire les deux sections sous une seule transaction, sans
 * qu'une seconde implementation de l'ecriture existe.
 */
export async function writeProjectBriefRow(
  tx: ProjectPlanQueryClient,
  projectId: string,
  values: ProjectBriefInput,
): Promise<BriefRow> {
  const data = {
    summary: values.summary,
    problem: values.problem,
    targetUsers: values.targetUsers,
    desiredOutcome: values.desiredOutcome,
    goalsJson: JSON.stringify(values.goals),
    nonGoalsJson: JSON.stringify(values.nonGoals),
  };

  // `upsert` sur une colonne unique : deux creations simultanees ne peuvent pas
  // produire deux lignes, et la seconde devient une mise a jour.
  return tx.projectBrief.upsert({
    where: { projectId },
    create: { projectId, ...data },
    update: data,
  });
}

/** Ecrit le plan de V1, sans aucun controle. Memes reserves que le brief. */
export async function writeProjectV1PlanRow(
  tx: ProjectPlanQueryClient,
  projectId: string,
  values: ProjectV1PlanInput,
): Promise<PlanRow> {
  const data = {
    goal: values.goal,
    technicalDirection: values.technicalDirection,
    inScopeJson: JSON.stringify(values.inScope),
    outOfScopeJson: JSON.stringify(values.outOfScope),
    milestonesJson: JSON.stringify(values.milestones),
  };

  return tx.projectV1Plan.upsert({
    where: { projectId },
    create: { projectId, ...data },
    update: data,
  });
}

/** Lit le brief d'un projet, ou `null` s'il n'a jamais ete defini. */
export async function getProjectBrief(
  db: DatabaseClient,
  projectId: string,
): Promise<ProjectBrief | null> {
  const row = await db.projectBrief.findUnique({ where: { projectId } });
  return row === null ? null : toBrief(row);
}

/** Lit le plan de V1 d'un projet. */
export async function getProjectV1Plan(
  db: DatabaseClient,
  projectId: string,
): Promise<ProjectV1Plan | null> {
  const row = await db.projectV1Plan.findUnique({ where: { projectId } });
  return row === null ? null : toPlan(row);
}

/**
 * Lit l'etat structure complet d'un projet.
 *
 * Une seule requete par objet, une seule sanitation, une seule mesure. C'est
 * cette fonction que tout le reste appelle.
 */
export async function loadProjectStructuredState(
  db: DatabaseClient,
  projectId: string,
  tools: ProjectPlanTools,
): Promise<ProjectStructuredState> {
  const [brief, plan] = await Promise.all([
    getProjectBrief(db, projectId),
    getProjectV1Plan(db, projectId),
  ]);

  return buildStructuredState(brief, plan, tools);
}

/** Assemble l'etat structure a partir de ce qui a ete lu. */
function buildStructuredState(
  brief: ProjectBrief | null,
  plan: ProjectV1Plan | null,
  tools: ProjectPlanTools,
): ProjectStructuredState {
  const promptBrief = brief === null ? null : sanitizedBrief(brief, tools);
  const promptPlan = plan === null ? null : sanitizedV1Plan(plan, tools);
  const briefChars = promptBrief === null ? 0 : sanitizedBriefChars(promptBrief);
  const planChars = promptPlan === null ? 0 : sanitizedV1PlanChars(promptPlan);

  return {
    brief: {
      present: brief !== null,
      stored: brief,
      prompt: promptBrief,
      revision: promptBrief?.revision ?? null,
      chars: briefChars,
    },
    plan: {
      present: plan !== null,
      stored: plan,
      prompt: promptPlan,
      revision: promptPlan?.revision ?? null,
      chars: planChars,
    },
    combinedChars: briefChars + planChars,
  };
}

/**
 * Ce qu'une ecriture peut renvoyer.
 *
 * `stale` porte la revision courante : l'interface peut ainsi dire ce qui a
 * change sans relancer une lecture, et l'utilisateur comprend pourquoi il est
 * refuse.
 */
export type ProjectPlanWriteResult =
  | { ok: true; state: ProjectStructuredState }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid"; field: string }
  | { ok: false; reason: "budget"; used: number; limit: number }
  | { ok: false; reason: "stale"; currentRevision: string | null };

/**
 * Enregistre le brief d'un projet.
 *
 * ## Ce qui se passe dans la transaction
 *
 * Relecture de l'etat courant, comparaison de la revision attendue, sanitation,
 * mesure du budget **commun**, puis ecriture. Tout, ou rien.
 *
 * ## `expectedRevision`
 *
 * Jeton de concurrence optimiste, jamais une autorite sur le contenu. `null`
 * signifie « je crois qu'aucun brief n'existe encore » ; `undefined` desactive
 * la verification, ce que seule une ecriture non concurrente devrait se
 * permettre. Deux onglets ouverts sur la meme revision ne peuvent pas ecrire
 * tous les deux : le second est refuse, jamais fusionne.
 */
export async function saveProjectBrief(
  db: DatabaseClient,
  input: {
    projectId: string;
    values: ProjectBriefInput;
    tools: ProjectPlanTools;
    expectedRevision?: string | null;
  },
): Promise<ProjectPlanWriteResult> {
  const checked = checkProjectBriefInput(input.values);
  if (!checked.ok) {
    return { ok: false, reason: "invalid", field: checked.refusal.field };
  }
  const values = checked.values;

  return db.$transaction(async (tx): Promise<ProjectPlanWriteResult> => {
    const project = await tx.project.findUnique({
      where: { id: input.projectId },
      select: { id: true },
    });
    if (project === null) {
      return { ok: false, reason: "not_found" };
    }

    const rows = await readProjectPlanRows(tx, input.projectId);
    const current = buildStructuredStateFromRows(rows, input.tools);

    if (input.expectedRevision !== undefined && input.expectedRevision !== current.brief.revision) {
      return { ok: false, reason: "stale", currentRevision: current.brief.revision };
    }

    const nextBrief = sanitizedBrief(values, input.tools);
    const used = sanitizedBriefChars(nextBrief) + current.plan.chars;
    if (used > PROJECT_PLAN_LIMITS.structuredChars) {
      return {
        ok: false,
        reason: "budget",
        used,
        limit: PROJECT_PLAN_LIMITS.structuredChars,
      };
    }

    const saved = await writeProjectBriefRow(tx, input.projectId, values);

    return {
      ok: true,
      state: buildStructuredStateFromRows({ brief: saved, plan: rows.plan }, input.tools),
    };
  });
}

/** Enregistre le plan de V1. Memes garanties que le brief. */
export async function saveProjectV1Plan(
  db: DatabaseClient,
  input: {
    projectId: string;
    values: ProjectV1PlanInput;
    tools: ProjectPlanTools;
    expectedRevision?: string | null;
  },
): Promise<ProjectPlanWriteResult> {
  const checked = checkProjectV1PlanInput(input.values);
  if (!checked.ok) {
    return { ok: false, reason: "invalid", field: checked.refusal.field };
  }
  const values = checked.values;

  return db.$transaction(async (tx): Promise<ProjectPlanWriteResult> => {
    const project = await tx.project.findUnique({
      where: { id: input.projectId },
      select: { id: true },
    });
    if (project === null) {
      return { ok: false, reason: "not_found" };
    }

    const rows = await readProjectPlanRows(tx, input.projectId);
    const current = buildStructuredStateFromRows(rows, input.tools);

    if (input.expectedRevision !== undefined && input.expectedRevision !== current.plan.revision) {
      return { ok: false, reason: "stale", currentRevision: current.plan.revision };
    }

    const nextPlan = sanitizedV1Plan(values, input.tools);
    const used = current.brief.chars + sanitizedV1PlanChars(nextPlan);
    if (used > PROJECT_PLAN_LIMITS.structuredChars) {
      return {
        ok: false,
        reason: "budget",
        used,
        limit: PROJECT_PLAN_LIMITS.structuredChars,
      };
    }

    const saved = await writeProjectV1PlanRow(tx, input.projectId, values);

    return {
      ok: true,
      state: buildStructuredStateFromRows({ brief: rows.brief, plan: saved }, input.tools),
    };
  });
}
