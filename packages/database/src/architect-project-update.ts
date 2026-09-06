/**
 * Propositions de mise a jour du projet, produites par un tour de l'Architecte.
 *
 * ## Le payload du fournisseur est immuable
 *
 * `proposedJson` conserve la reponse telle qu'elle a ete rendue. **Aucune
 * fonction de ce module ne le reecrit**, et c'est deliberat : la version editee
 * par l'utilisateur est une donnee differente, ecrite dans `appliedJson` au
 * moment de l'application. Melanger les deux ferait perdre ce que le modele
 * avait reellement repondu — la seule question a laquelle `proposedJson` sert a
 * repondre.
 *
 * ## Les revisions de base decrivent ce que le fournisseur a vu
 *
 * Elles sont **recues** du service qui a prepare le tour, jamais relues ici.
 *
 * C'est la correction la plus importante de ce module, et elle est contre-
 * intuitive : « tout relire cote serveur » est habituellement plus sur, mais
 * pas ici. Entre l'envoi et la reponse, l'utilisateur peut avoir modifie son
 * plan a la main ; relire au moment de l'enregistrement etiquetterait la
 * proposition comme batie sur un etat que le modele n'a jamais vu, et le controle
 * de peremption ne detecterait plus rien.
 *
 * La valeur ne vient donc pas de l'exterieur pour autant : `ProjectUpdateBase`
 * est produite par la preparation du tour, cote serveur, a partir de l'etat lu
 * en base au moment de construire le contexte. Elle ne traverse ni le
 * navigateur, ni un formulaire, ni une requete.
 *
 * ## Ce module n'appelle personne
 *
 * Ni OpenAI, ni Claude Code, ni le runner. Appliquer ou ecarter une proposition
 * sont des ecritures SQLite, et rien d'autre.
 */

import {
  ARCHITECT_PROJECT_UPDATE_STATUS,
  MEMORY_CODE_PREFIX,
  PROJECT_MEMORY_ACTION,
  PROJECT_MEMORY_LIMITS,
  PROJECT_PLAN_LIMITS,
  PROJECT_UPDATE_ACTION,
  checkProjectMemoryProposal,
  checkProjectBriefInput,
  checkProjectV1PlanInput,
  isArchitectProjectUpdateStatus,
  isProjectUpdateAction,
  unchangedProjectUpdateSection,
  type ArchitectProjectUpdateProposal,
  type ArchitectProjectUpdateStatus,
  type ProjectBriefInput,
  type ProjectMemoryProposal,
  type ProjectUpdateTarget,
  type ProjectV1PlanInput,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";
import { writeProposedMemory } from "./project-memory.js";
import {
  buildStructuredStateFromRows,
  readProjectPlanRows,
  sanitizedBrief,
  sanitizedBriefChars,
  sanitizedV1Plan,
  sanitizedV1PlanChars,
  writeProjectBriefRow,
  writeProjectV1PlanRow,
  type ProjectPlanTools,
  type ProjectStructuredState,
} from "./project-plan.js";

/**
 * Etat structure vu par le fournisseur au moment ou le tour est parti.
 *
 * `null` sur une section signifie « rien n'etait defini a ce moment-la ». C'est
 * un fait distinct de « la section vaut la chaine vide », et la difference est
 * conservee jusqu'a l'application : un brief cree a la main pendant l'appel rend
 * la proposition perimee, meme si le fournisseur ne proposait rien pour lui.
 */
export type ProjectUpdateBase = {
  briefRevision: string | null;
  planRevision: string | null;
  /**
   * Revision de la memoire active vue par le fournisseur.
   *
   * `null` pour une proposition qui ne pose aucune regle durable : il n'y a
   * alors rien a proteger, et exiger une revision obligerait chaque appelant
   * historique a en fabriquer une.
   */
  memoryRevision: string | null;
};

/** Une proposition, telle que l'interface la lit. */
export type ArchitectProjectUpdateView = {
  id: string;
  generationId: string;
  projectId: string;
  status: ArchitectProjectUpdateStatus;
  reason: string;
  /** Ce que le fournisseur a propose, tel quel. Jamais reecrit. */
  proposed: ArchitectProjectUpdateProposal;
  /** Ce que l'utilisateur a reellement applique. `null` tant que ce n'est pas fait. */
  applied: ProjectUpdateTarget | null;
  /** Revision du brief vue par le fournisseur. `null` = pas encore defini. */
  baseBriefRevision: string | null;
  basePlanRevision: string | null;
  /** Revision de la memoire vue par le fournisseur. `null` avant HOTFIX-005. */
  baseMemoryRevision: string | null;
  /** Date ISO 8601, ou `null`. */
  appliedAt: string | null;
  dismissedAt: string | null;
  /** Date ISO 8601. */
  createdAt: string;
};

type UpdateRow = {
  id: string;
  generationId: string;
  projectId: string;
  status: string;
  reason: string;
  proposedJson: string;
  appliedJson: string | null;
  baseBriefRevision: string | null;
  basePlanRevision: string | null;
  baseMemoryRevision: string | null;
  appliedAt: Date | null;
  dismissedAt: Date | null;
  createdAt: Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Relit une section serialisee, sans jamais faire tomber la page. */
function readSection<TValue>(
  raw: unknown,
  read: (record: Record<string, unknown>) => TValue | null,
): { action: "UNCHANGED" | "SET"; value: TValue | null } {
  if (!isRecord(raw) || !isProjectUpdateAction(raw["action"])) {
    return unchangedProjectUpdateSection<TValue>();
  }
  if (raw["action"] === PROJECT_UPDATE_ACTION.UNCHANGED) {
    return unchangedProjectUpdateSection<TValue>();
  }
  const value = isRecord(raw["value"]) ? read(raw["value"]) : null;
  return value === null
    ? unchangedProjectUpdateSection<TValue>()
    : { action: PROJECT_UPDATE_ACTION.SET, value };
}

function readBriefValue(record: Record<string, unknown>): ProjectBriefInput | null {
  const checked = checkProjectBriefInput({
    summary: typeof record["summary"] === "string" ? record["summary"] : "",
    problem: typeof record["problem"] === "string" ? record["problem"] : "",
    targetUsers: typeof record["targetUsers"] === "string" ? record["targetUsers"] : "",
    desiredOutcome: typeof record["desiredOutcome"] === "string" ? record["desiredOutcome"] : "",
    goals: readStrings(record["goals"]),
    nonGoals: readStrings(record["nonGoals"]),
  });
  return checked.ok ? checked.values : null;
}

function readPlanValue(record: Record<string, unknown>): ProjectV1PlanInput | null {
  const checked = checkProjectV1PlanInput({
    goal: typeof record["goal"] === "string" ? record["goal"] : "",
    technicalDirection:
      typeof record["technicalDirection"] === "string" ? record["technicalDirection"] : "",
    inScope: readStrings(record["inScope"]),
    outOfScope: readStrings(record["outOfScope"]),
    milestones: readStrings(record["milestones"]),
  });
  return checked.ok ? checked.values : null;
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * Relit une proposition enregistree.
 *
 * Un payload illisible ne fait pas tomber la page : la proposition se lit alors
 * comme ne changeant rien. Un tour ancien reste consultable meme si le contrat a
 * evolue depuis — c'est precisement pour cela que NOX le conserve.
 */
/** Proposition vide, valeur de repli d'une ligne illisible. */
function emptyProposal(): ArchitectProjectUpdateProposal {
  return {
    reason: "",
    brief: unchangedProjectUpdateSection(),
    plan: unchangedProjectUpdateSection(),
    memories: [],
  };
}

/**
 * Relit les regles durables d'une proposition enregistree.
 *
 * Ne valide pas : cette lecture sert a **afficher** une proposition, y compris
 * une proposition dont le contrat a change depuis. La validation a lieu a
 * l'application, sur ce que l'humain a retenu.
 */
function readProposedMemoryList(value: unknown): ProjectMemoryProposal[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: ProjectMemoryProposal[] = [];
  for (const entry of value) {
    const checked = checkProjectMemoryProposal(entry);
    if (checked.ok) {
      entries.push(checked.values);
    }
  }
  return entries;
}

function readProposal(value: string): ArchitectProjectUpdateProposal {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) {
      return emptyProposal();
    }
    return {
      reason: typeof parsed["reason"] === "string" ? parsed["reason"] : "",
      brief: readSection(parsed["brief"], readBriefValue),
      plan: readSection(parsed["plan"], readPlanValue),
      // Absent pour toute proposition anterieure a HOTFIX-005. Une liste vide,
      // jamais une panne : l'historique ne se reecrit pas pour ressembler au
      // contrat du jour.
      memories: readProposedMemoryList(parsed["memories"]),
    };
  } catch {
    return emptyProposal();
  }
}

/** Relit l'etat cible applique. */
function readApplied(value: string | null): ProjectUpdateTarget | null {
  if (value === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) {
      return null;
    }
    return {
      brief: isRecord(parsed["brief"]) ? readBriefValue(parsed["brief"]) : null,
      plan: isRecord(parsed["plan"]) ? readPlanValue(parsed["plan"]) : null,
    };
  } catch {
    return null;
  }
}

function toUpdate(row: UpdateRow): ArchitectProjectUpdateView {
  return {
    id: row.id,
    generationId: row.generationId,
    projectId: row.projectId,
    status: isArchitectProjectUpdateStatus(row.status)
      ? row.status
      : ARCHITECT_PROJECT_UPDATE_STATUS.PENDING,
    reason: row.reason,
    proposed: readProposal(row.proposedJson),
    applied: readApplied(row.appliedJson),
    baseBriefRevision: row.baseBriefRevision,
    basePlanRevision: row.basePlanRevision,
    baseMemoryRevision: row.baseMemoryRevision,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export type CreateProjectUpdateResult =
  | { ok: true; update: ArchitectProjectUpdateView }
  | { ok: false; reason: "not_found" | "already_exists" };

/**
 * Enregistre la proposition d'un tour.
 *
 * `baseState` decrit ce que le fournisseur avait sous les yeux, et est fourni
 * par le service qui a prepare ce tour. Il n'est **pas** relu ici : voir l'entete
 * du module.
 *
 * Une generation ne porte qu'une proposition. Deux enregistrements simultanes ne
 * peuvent pas produire deux lignes : l'index unique tranche, et le perdant
 * obtient `already_exists` plutot qu'une seconde proposition fantome.
 */
export async function createArchitectProjectUpdate(
  db: DatabaseClient,
  input: {
    generationId: string;
    projectId: string;
    proposed: ArchitectProjectUpdateProposal;
    baseState: ProjectUpdateBase;
  },
): Promise<CreateProjectUpdateResult> {
  try {
    const row = await db.architectProjectUpdate.create({
      data: {
        generationId: input.generationId,
        projectId: input.projectId,
        status: ARCHITECT_PROJECT_UPDATE_STATUS.PENDING,
        reason: input.proposed.reason,
        proposedJson: JSON.stringify(input.proposed),
        baseBriefRevision: input.baseState.briefRevision,
        basePlanRevision: input.baseState.planRevision,
        baseMemoryRevision: input.baseState.memoryRevision,
      },
    });
    return { ok: true, update: toUpdate(row) };
  } catch {
    // Soit la generation n'existe pas, soit elle porte deja une proposition.
    // Relire tranche entre les deux sans supposer un code d'erreur du moteur.
    const existing = await db.architectProjectUpdate.findUnique({
      where: { generationId: input.generationId },
    });
    return { ok: false, reason: existing === null ? "not_found" : "already_exists" };
  }
}

/** Surface minimale pour ecrire une proposition dans une transaction en cours. */
export type ProjectUpdateWriteClient = Pick<DatabaseClient, "architectProjectUpdate">;

/**
 * Ecrit la proposition d'un tour **dans la transaction de ce tour**.
 *
 * C'est ce qui interdit l'etat batard : une reponse affichee qui dit « je
 * propose de modifier le plan » sans proposition enregistree. Soit le tour
 * aboutit avec sa proposition, soit rien n'est ecrit.
 *
 * L'index unique sur `generationId` reste la garantie « une generation, au plus
 * une proposition » ; ici il ne peut pas etre viole, puisque la generation vient
 * d'etre conclue dans la meme transaction.
 */
export async function writeArchitectProjectUpdate(
  tx: ProjectUpdateWriteClient,
  input: {
    generationId: string;
    projectId: string;
    proposed: ArchitectProjectUpdateProposal;
    baseState: ProjectUpdateBase;
  },
): Promise<string> {
  const row = await tx.architectProjectUpdate.create({
    data: {
      generationId: input.generationId,
      projectId: input.projectId,
      status: ARCHITECT_PROJECT_UPDATE_STATUS.PENDING,
      reason: input.proposed.reason,
      proposedJson: JSON.stringify(input.proposed),
      baseBriefRevision: input.baseState.briefRevision,
      basePlanRevision: input.baseState.planRevision,
      baseMemoryRevision: input.baseState.memoryRevision,
    },
    select: { id: true },
  });
  // L'identifiant est rendu depuis TASK-032 : une replanification du meme tour
  // s'y lie, et les deux forment alors un seul changement de projet.
  return row.id;
}

/** Lit une proposition par son identifiant. */
export async function getArchitectProjectUpdate(
  db: DatabaseClient,
  updateId: string,
): Promise<ArchitectProjectUpdateView | null> {
  const row = await db.architectProjectUpdate.findUnique({ where: { id: updateId } });
  return row === null ? null : toUpdate(row);
}

/** Lit la proposition d'un tour, s'il en porte une. */
export async function getArchitectProjectUpdateForGeneration(
  db: DatabaseClient,
  generationId: string,
): Promise<ArchitectProjectUpdateView | null> {
  const row = await db.architectProjectUpdate.findUnique({ where: { generationId } });
  return row === null ? null : toUpdate(row);
}

/**
 * Propositions d'une conversation, de la plus ancienne a la plus recente.
 *
 * L'ordre suit celui des tours : c'est celui dans lequel la conversation se lit,
 * et une liste triee autrement obligerait a chercher.
 */
export async function listArchitectProjectUpdatesForSession(
  db: DatabaseClient,
  sessionId: string,
): Promise<ArchitectProjectUpdateView[]> {
  const rows = await db.architectProjectUpdate.findMany({
    where: { generation: { sessionId } },
    orderBy: { generation: { sequence: "asc" } },
  });
  return rows.map(toUpdate);
}

// --- Application et abandon --------------------------------------------------

export type ProjectUpdateActionResult =
  | { ok: true; update: ArchitectProjectUpdateView; state: ProjectStructuredState }
  | { ok: false; reason: "not_found" }
  /** Deja appliquee ou deja ecartee : un second passage ne refait rien. */
  | { ok: false; reason: "not_pending"; status: ArchitectProjectUpdateStatus }
  /** L'etat courant n'est plus celui que le fournisseur avait vu. */
  | {
      ok: false;
      reason: "stale";
      currentBriefRevision: string | null;
      currentPlanRevision: string | null;
    }
  | { ok: false; reason: "invalid"; field: string }
  | { ok: false; reason: "budget"; used: number; limit: number };

/**
 * Applique une proposition, avec l'etat cible que l'utilisateur a valide.
 *
 * ## Le target vient de l'humain, et il est entierement revalide
 *
 * `target` peut differer de ce que le fournisseur avait propose : c'est
 * precisement le point d'une revue. Il repasse donc par la validation de champ,
 * la normalisation, la sanitation et le budget commun — exactement comme une
 * saisie manuelle. Le fait que la proposition d'origine ait ete valide ne prouve
 * rien sur la valeur editee.
 *
 * ## Pourquoi comparer les deux revisions
 *
 * Meme quand la proposition ne touche que le brief, le modele a vu le plan en la
 * formulant. Un plan modifie depuis peut invalider son raisonnement, sans que
 * rien dans la proposition ne le laisse voir. Toute divergence — brief ou plan —
 * rend donc la proposition perimee.
 *
 * Une proposition perimee est **refusee localement**. NOX ne demande a personne
 * de fusionner : il n'existe aucun chemin de code allant d'un conflit a un appel.
 *
 * ## Tout, ou rien
 *
 * Une seule transaction : controles, ecriture du brief, ecriture du plan,
 * changement de statut. Le statut est pris par une mise a jour conditionnelle,
 * donc un Apply et un Dismiss simultanes ne peuvent pas tous deux aboutir — et
 * l'etat « brief modifie, proposition ecartee » n'existe pas.
 */
export async function applyArchitectProjectUpdate(
  db: DatabaseClient,
  input: {
    projectId: string;
    updateId: string;
    target: ProjectUpdateTarget;
    tools: ProjectPlanTools;
    /**
     * Regles durables retenues par l'humain, dans leur forme definitive.
     *
     * Absent vaut liste vide : une proposition qui n'en portait pas, ou dont
     * l'utilisateur les a toutes retirees, n'ecrit rien en memoire.
     */
    memories?: readonly ProjectMemoryProposal[];
    /**
     * Revision de la memoire active **d'aujourd'hui**.
     *
     * Reconstruite par l'appelant, comme l'empreinte de planification d'un
     * backlog et pour la meme raison : la revision decrit le texte sanitise,
     * que seule la couche web sait produire. Comparee ici a celle enregistree
     * avec la proposition, dans la transaction qui prend le statut — donc sans
     * fenetre exploitable.
     *
     * Absente, le controle est saute : c'est le cas d'une proposition
     * anterieure a HOTFIX-005, qui ne porte aucune entree de memoire.
     */
    currentMemoryRevision?: string;
  },
): Promise<ProjectUpdateActionResult> {
  return db.$transaction(async (tx): Promise<ProjectUpdateActionResult> => {
    const row = await tx.architectProjectUpdate.findUnique({ where: { id: input.updateId } });

    // Un identifiant croise entre deux projets est un « introuvable », jamais un
    // refus qui confirmerait l'existence de la ligne.
    if (row === null || row.projectId !== input.projectId) {
      return { ok: false, reason: "not_found" };
    }

    const status = isArchitectProjectUpdateStatus(row.status)
      ? row.status
      : ARCHITECT_PROJECT_UPDATE_STATUS.PENDING;
    if (status !== ARCHITECT_PROJECT_UPDATE_STATUS.PENDING) {
      return { ok: false, reason: "not_pending", status };
    }

    const rows = await readProjectPlanRows(tx, input.projectId);
    const current = buildStructuredStateFromRows(rows, input.tools);

    if (
      row.baseBriefRevision !== current.brief.revision ||
      row.basePlanRevision !== current.plan.revision
    ) {
      return {
        ok: false,
        reason: "stale",
        currentBriefRevision: current.brief.revision,
        currentPlanRevision: current.plan.revision,
      };
    }

    // La memoire est le troisieme axe depuis HOTFIX-005, et se refuse comme les
    // deux autres. Une entree `UPDATE` batie sur un texte que l'utilisateur a
    // reecrit depuis ecraserait sa version sans que personne ne l'ait vu — et
    // « fusionner » deux redactions d'une meme regle produirait un contrat que
    // ni l'un ni l'autre n'a valide.
    //
    // Le controle ne s'applique qu'aux propositions qui portent une revision de
    // reference. Une proposition d'avant HOTFIX-005 n'en a pas, ne peut pas
    // porter d'entree de memoire, et n'a donc rien a proteger.
    if (
      row.baseMemoryRevision !== null &&
      input.currentMemoryRevision !== undefined &&
      row.baseMemoryRevision !== input.currentMemoryRevision
    ) {
      return {
        ok: false,
        reason: "stale",
        currentBriefRevision: current.brief.revision,
        currentPlanRevision: current.plan.revision,
      };
    }

    // Le target humain, revalide de zero.
    let briefValues: ProjectBriefInput | null = null;
    if (input.target.brief !== null) {
      const checked = checkProjectBriefInput(input.target.brief);
      if (!checked.ok) {
        return { ok: false, reason: "invalid", field: checked.refusal.field };
      }
      briefValues = checked.values;
    }

    let planValues: ProjectV1PlanInput | null = null;
    if (input.target.plan !== null) {
      const checked = checkProjectV1PlanInput(input.target.plan);
      if (!checked.ok) {
        return { ok: false, reason: "invalid", field: checked.refusal.field };
      }
      planValues = checked.values;
    }

    const memories = input.memories ?? [];

    // Poser une regle durable **est** un changement de projet. Avant HOTFIX-005
    // une proposition qui ne touchait ni le brief ni le plan n'avait rien a
    // appliquer ; c'est desormais le cas central — le contrat d'import de
    // TicketPulse n'avait aucune raison de modifier une capacite deja ecrite.
    if (briefValues === null && planValues === null && memories.length === 0) {
      return { ok: false, reason: "invalid", field: "target" };
    }

    // Revalidee de zero, comme le brief et le plan : ce qui arrive ici a pu
    // etre modifie par l'utilisateur dans la revue, et la validation du
    // fournisseur ne vaut pas pour un texte humain.
    if (memories.length > PROJECT_MEMORY_LIMITS.proposals) {
      return { ok: false, reason: "invalid", field: "memories" };
    }
    const memoryValues: { proposal: ProjectMemoryProposal; targetId: string | null }[] = [];
    for (const [index, proposal] of memories.entries()) {
      const checked = checkProjectMemoryProposal(proposal);
      if (!checked.ok) {
        return { ok: false, reason: "invalid", field: `memories.${String(index)}` };
      }

      let targetId: string | null = null;
      if (checked.values.action === PROJECT_MEMORY_ACTION.UPDATE) {
        // L'entree visee est relue **ici**, dans la transaction : son existence
        // est une question de base, pas de format, et une entree supprimee
        // entre la proposition et l'application doit refuser plutot que
        // ressusciter sous un autre numero.
        const sequence = Number(checked.values.code?.slice(MEMORY_CODE_PREFIX.length) ?? "");
        const existing = await tx.projectMemoryEntry.findFirst({
          where: { projectId: input.projectId, sequence },
          select: { id: true },
        });
        if (existing === null) {
          return { ok: false, reason: "invalid", field: `memories.${String(index)}.code` };
        }
        targetId = existing.id;
      }

      memoryValues.push({ proposal: checked.values, targetId });
    }

    // Le budget se mesure sur l'etat **resultant**, pas sur ce qui change : une
    // section inchangee continue d'occuper sa place dans le contexte.
    const nextBrief = briefValues === null ? null : sanitizedBrief(briefValues, input.tools);
    const nextPlan = planValues === null ? null : sanitizedV1Plan(planValues, input.tools);
    const used =
      (nextBrief === null ? current.brief.chars : sanitizedBriefChars(nextBrief)) +
      (nextPlan === null ? current.plan.chars : sanitizedV1PlanChars(nextPlan));
    if (used > PROJECT_PLAN_LIMITS.structuredChars) {
      return { ok: false, reason: "budget", used, limit: PROJECT_PLAN_LIMITS.structuredChars };
    }

    // Le statut est pris avant d'ecrire quoi que ce soit. Une mise a jour
    // conditionnelle, jamais une lecture suivie d'une ecriture : c'est elle qui
    // rend un Apply et un Dismiss concurrents mutuellement exclusifs.
    const claimed = await tx.architectProjectUpdate.updateMany({
      where: { id: input.updateId, status: ARCHITECT_PROJECT_UPDATE_STATUS.PENDING },
      data: {
        status: ARCHITECT_PROJECT_UPDATE_STATUS.APPLIED,
        appliedAt: new Date(),
        appliedJson: JSON.stringify({
          brief: briefValues,
          plan: planValues,
          // Ce que l'humain a **retenu**, y compris quand il a retire ou reecrit
          // une entree proposee. `proposedJson` garde ce que le modele avait
          // suggere ; les deux restent distincts, comme pour le brief et le plan.
          memories: memoryValues.map((entry) => entry.proposal),
        }),
      },
    });
    if (claimed.count !== 1) {
      return { ok: false, reason: "not_pending", status };
    }

    // Les regles durables sont ecrites dans **cette** transaction, avec le brief
    // et le plan. Un plan qui annonce un import controle et une memoire qui ne
    // dit pas ce que « controle » veut dire serait exactement le trou que
    // HOTFIX-005 comble : les deux moities arrivent ensemble, ou aucune.
    for (const entry of memoryValues) {
      const written = await writeProposedMemory(tx, {
        projectId: input.projectId,
        proposal: entry.proposal,
        targetId: entry.targetId,
        sanitize: input.tools.sanitize,
      });
      if (!written.ok) {
        // La transaction entiere est annulee : ni brief, ni plan, ni memoire, et
        // la proposition reste `PENDING`. Une application a moitie faite
        // laisserait un contrat partiel que personne n'aurait valide.
        return written.failure;
      }
    }

    const savedBrief =
      briefValues === null ? rows.brief : await writeProjectBriefRow(tx, input.projectId, briefValues);
    const savedPlan =
      planValues === null ? rows.plan : await writeProjectV1PlanRow(tx, input.projectId, planValues);

    const applied = await tx.architectProjectUpdate.findUnique({ where: { id: input.updateId } });
    if (applied === null) {
      return { ok: false, reason: "not_found" };
    }

    return {
      ok: true,
      update: toUpdate(applied),
      state: buildStructuredStateFromRows({ brief: savedBrief, plan: savedPlan }, input.tools),
    };
  });
}

/**
 * Ecarte une proposition.
 *
 * Aucune ecriture du brief, aucune ecriture du plan, aucun appel. La proposition
 * reste lisible : elle raconte ce que le modele avait propose, et le fait qu'on
 * ne l'ait pas retenu est lui aussi une information.
 */
export async function dismissArchitectProjectUpdate(
  db: DatabaseClient,
  input: { projectId: string; updateId: string; tools: ProjectPlanTools },
): Promise<ProjectUpdateActionResult> {
  return db.$transaction(async (tx): Promise<ProjectUpdateActionResult> => {
    const row = await tx.architectProjectUpdate.findUnique({ where: { id: input.updateId } });
    if (row === null || row.projectId !== input.projectId) {
      return { ok: false, reason: "not_found" };
    }

    const status = isArchitectProjectUpdateStatus(row.status)
      ? row.status
      : ARCHITECT_PROJECT_UPDATE_STATUS.PENDING;
    if (status !== ARCHITECT_PROJECT_UPDATE_STATUS.PENDING) {
      return { ok: false, reason: "not_pending", status };
    }

    const claimed = await tx.architectProjectUpdate.updateMany({
      where: { id: input.updateId, status: ARCHITECT_PROJECT_UPDATE_STATUS.PENDING },
      data: {
        status: ARCHITECT_PROJECT_UPDATE_STATUS.DISMISSED,
        dismissedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      return { ok: false, reason: "not_pending", status };
    }

    const dismissed = await tx.architectProjectUpdate.findUnique({ where: { id: input.updateId } });
    if (dismissed === null) {
      return { ok: false, reason: "not_found" };
    }

    const rows = await readProjectPlanRows(tx, input.projectId);

    return {
      ok: true,
      update: toUpdate(dismissed),
      state: buildStructuredStateFromRows(rows, input.tools),
    };
  });
}
