/**
 * Application et abandon d'un changement de projet.
 *
 * ## Un changement, une transaction
 *
 * Une decision produit qui modifie le perimetre change generalement le plan
 * **et** ce qui reste a faire. Les deux forment une seule intention humaine, et
 * elles s'appliquent donc ensemble : brief, plan de V1, contrats des taches
 * futures, creations, suppressions, dependances, ordre de planification et
 * statuts vivent dans la meme transaction SQLite.
 *
 * L'etat « le plan est a jour, les taches ne le sont pas » n'existe pas. Il
 * n'aurait pas ete rattrapable : l'utilisateur aurait lu un plan qui decrit un
 * produit, et un backlog qui en construit un autre.
 *
 * ## Le passe est relu, jamais suppose
 *
 * Une tache etait modifiable au moment ou la proposition a ete concue. Cela ne
 * prouve rien sur aujourd'hui : elle a pu etre inscrite en file, acquerir une
 * execution, ou changer de statut. Tout est donc **relu dans la transaction**,
 * et la classification appliquee est celle de TASK-024 — jamais une seconde
 * regle, jamais une regle plus permissive.
 *
 * ## Il n'existe aucun forcage
 *
 * Ni `force`, ni `ignoreStale`, ni `applyAnyway`. Une proposition perimee est
 * refusee **avant** la moindre ecriture, et NOX ne fusionne jamais deux etats.
 * C'est la meme regle qu'en TASK-021 et TASK-022, pour la meme raison : le
 * modele a raisonne sur un etat, et cet etat n'existe plus.
 *
 * ## Ce module n'appelle personne
 *
 * Ni OpenAI, ni Claude Code, ni le runner, ni Git. Appliquer un changement de
 * projet est une suite d'ecritures SQLite. Les documents Markdown sont
 * synchronises **apres** la transaction, par l'appelant : NOX ne pretend a
 * aucune atomicite entre une base et un systeme de fichiers.
 */

import {
  ARCHITECT_PROJECT_UPDATE_STATUS,
  PROJECT_PLAN_LIMITS,
  REPLAN_PROPOSAL_STATUS,
  TASK_KIND,
  TASK_STATUS,
  checkProjectBriefInput,
  checkProjectV1PlanInput,
  checkReplanTargetGraph,
  formatTaskCode,
  isArchitectProjectUpdateStatus,
  isReplanProposalStatus,
  taskStatusAfterEdit,
  type ProjectBriefInput,
  type ProjectUpdateTarget,
  type ProjectV1PlanInput,
  type ReplanLockReason,
  type ReplanProposalStatus,
  type ReplanTargetTask,
  type TaskStatus,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";
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
import { hasAnyCycle, readProjectDependencyEdges } from "./task-dependencies.js";
import { normalizeTaskEditSnapshot, taskContractChanged, type TaskEditInput } from "./task-edit.js";
import { reserveTaskSequences, writeTaskRow } from "./tasks.js";
import { loadReplanPlanningState, type ReplanPlanningState } from "./replan-state.js";
import { writeVerificationPlan } from "./verification-plan.js";

/**
 * Un element de la cible, tel que l'humain l'a valide.
 *
 * `values.dependsOnTaskIds` n'est **pas** lu : les dependances d'un replan
 * peuvent designer une tache qui n'existe pas encore, ce qu'un contrat de tache
 * ne sait pas exprimer. Elles arrivent donc par les deux listes explicites, et
 * sont recomposees dans le contrat au moment de la comparaison.
 */
export type ReplanApplyItem = {
  existingTaskId: string | null;
  tempId: string | null;
  values: TaskEditInput;
  /** Taches existantes attendues, par identifiant. */
  dependsOnTaskIds: readonly string[];
  /** Taches nouvelles attendues, par identifiant temporaire du meme lot. */
  dependsOnTempIds: readonly string[];
};

/** Une tache creee ou modifiee, telle que la synchronisation Markdown en a besoin. */
export type ReplanAppliedTask = {
  taskId: string;
  code: string;
  /** Le contrat a-t-il reellement change ? Seul un `true` justifie une reecriture. */
  contractChanged: boolean;
};

/** Une tache supprimee, telle que le nettoyage du disque en a besoin. */
export type ReplanRemovedTask = {
  taskId: string;
  code: string;
  documentPath: string;
  /** Revision enregistree : c'est elle qui prouve que le fichier vise est celui de NOX. */
  documentRevision: string | null;
};

export type ReplanApplyOutcome = {
  proposalId: string;
  /** Mise a jour du projet appliquee dans la meme transaction, le cas echeant. */
  projectUpdateId: string | null;
  /** Etat structure resultant, deja reconstruit. */
  state: ProjectStructuredState;
  created: ReplanAppliedTask[];
  updated: ReplanAppliedTask[];
  removed: ReplanRemovedTask[];
  /** Taches dont seul l'ordre de planification a bouge. */
  reordered: number;
};

/** Ce qui a rendu une proposition caduque, dit aussi precisement que possible. */
export type ReplanStaleDetail = {
  brief: boolean;
  plan: boolean;
  /** Le plan de travail a change, sans qu'une tache nommee l'explique. */
  planning: boolean;
  /** Taches citees par la cible dont l'etat interdit desormais l'application. */
  tasks: readonly { code: string; reason: ReplanLockReason | "MISSING" }[];
};

export type ApplyReplanResult =
  | { ok: true; outcome: ReplanApplyOutcome }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_pending"; status: ReplanProposalStatus }
  | { ok: false; reason: "stale"; detail: ReplanStaleDetail }
  /** `TASK-000` n'a jamais tourne, et le changement reecrit son point de depart. */
  | { ok: false; reason: "bootstrap"; code: string }
  | { ok: false; reason: "graph"; message: string }
  | { ok: false; reason: "invalid"; field: string }
  | { ok: false; reason: "budget"; used: number; limit: number };

/**
 * Code du refus d'amorcage.
 *
 * Nomme, parce que l'utilisateur a un geste precis a faire : terminer ou
 * supprimer `TASK-000` avant d'appliquer, ou appliquer le changement sans la
 * mise a jour du projet. NOX ne tranche ni l'un ni l'autre a sa place.
 */
export const BOOTSTRAP_REQUIRES_REFRESH = "BOOTSTRAP_REQUIRES_REFRESH";

export type ApplyReplanInput = {
  projectId: string;
  proposalId: string;
  /** Etat cible valide par l'humain, dans l'ordre qu'il a valide. */
  target: readonly ReplanApplyItem[];
  /**
   * Brief et plan retenus par l'humain, ou `null` quand la section n'est pas
   * touchee. Toujours `null` des deux cotes quand aucune mise a jour n'est liee.
   */
  projectUpdate: ProjectUpdateTarget | null;
  /** Ce qui sera conserve dans `appliedJson`. Deja serialise par l'appelant. */
  appliedJson: string;
  tools: ProjectPlanTools;
  /**
   * Empreinte de l'etat de planification, injectee depuis `apps/web`.
   *
   * Recalculee **dans** la transaction, a partir de l'etat relu : la calculer
   * avant laisserait une fenetre entre le controle et les ecritures, exactement
   * celle qu'une transaction existe pour fermer.
   */
  fingerprint: (input: {
    state: ReplanPlanningState;
    briefRevision: string | null;
    planRevision: string | null;
  }) => string;
};

/**
 * Le contrat d'un element, dependances existantes comprises.
 *
 * Les dependances temporaires n'y entrent pas : elles ne designent aucune tache
 * enregistree, et les faire entrer dans une comparaison de contrats reviendrait
 * a comparer un identifiant de formulaire a un identifiant de base.
 */
function itemContract(item: ReplanApplyItem): TaskEditInput {
  return normalizeTaskEditSnapshot({
    ...item.values,
    dependsOnTaskIds: [...item.dependsOnTaskIds],
  });
}

/**
 * Applique un changement de projet.
 *
 * ## L'ordre des controles
 *
 * Existence, statut, peremption du plan de travail, peremption du projet,
 * amorcage, validite du graphe. Il est fixe et teste : apprendre a
 * l'utilisateur qu'une dependance forme un cycle alors que sa proposition est de
 * toute facon perimee lui ferait corriger la mauvaise chose.
 *
 * Aucune ecriture n'a lieu avant que les six soient passes.
 */
export async function applyReplanProposal(
  db: DatabaseClient,
  input: ApplyReplanInput,
): Promise<ApplyReplanResult> {
  return db
    .$transaction(async (tx): Promise<ApplyReplanResult> => {
      // --- 1. La proposition ---------------------------------------------------
      const row = await tx.architectReplanProposal.findUnique({ where: { id: input.proposalId } });
      // Un identifiant croise entre deux projets est un « introuvable », jamais un
      // refus qui confirmerait l'existence de la ligne.
      if (row === null || row.projectId !== input.projectId) {
        return { ok: false, reason: "not_found" };
      }

      const status = isReplanProposalStatus(row.status)
        ? row.status
        : REPLAN_PROPOSAL_STATUS.DISMISSED;
      if (status !== REPLAN_PROPOSAL_STATUS.PENDING) {
        return { ok: false, reason: "not_pending", status };
      }

      // --- 2. L'etat de planification d'aujourd'hui ----------------------------
      const state = await loadReplanPlanningState(tx, input.projectId);
      const byId = new Map(state.tasks.map((task) => [task.classified.id, task]));
      const editable = state.tasks.filter((task) => task.classified.editable);
      const locked = state.tasks.filter((task) => !task.classified.editable);

      // Le detail du refus se construit avant de trancher : il nomme ce qu'il peut
      // nommer, et « le plan a change » reste la reponse honnete quand aucune
      // tache citee n'explique a elle seule la divergence.
      const staleTasks: { code: string; reason: ReplanLockReason | "MISSING" }[] = [];
      for (const item of input.target) {
        if (item.existingTaskId === null) {
          continue;
        }
        const task = byId.get(item.existingTaskId);
        if (task === undefined) {
          staleTasks.push({ code: item.existingTaskId, reason: "MISSING" });
          continue;
        }
        if (!task.classified.editable) {
          staleTasks.push({ code: task.classified.code, reason: task.classified.lockReason });
        }
      }

      const rows = await readProjectPlanRows(tx, input.projectId);
      const current = buildStructuredStateFromRows(rows, input.tools);
      const briefStale = row.baseBriefRevision !== current.brief.revision;
      const planStale = row.basePlanRevision !== current.plan.revision;
      const planningStale =
      input.fingerprint({
        state,
        briefRevision: current.brief.revision,
        planRevision: current.plan.revision,
      }) !== row.planningFingerprint;

      if (briefStale || planStale || planningStale || staleTasks.length > 0) {
        return {
          ok: false,
          reason: "stale",
          detail: {
            brief: briefStale,
            plan: planStale,
            // Une divergence d'empreinte qu'aucune tache citee n'explique : une
            // tache a ete editee, ajoutee, retiree, ou l'ordre a bouge.
            planning: planningStale && staleTasks.length === 0,
            tasks: staleTasks,
          },
        };
      }

      // --- 3. La mise a jour du projet liee ------------------------------------
      let projectUpdateId: string | null = null;
      let briefValues: ProjectBriefInput | null = null;
      let planValues: ProjectV1PlanInput | null = null;

      if (row.projectUpdateId !== null) {
        const update = await tx.architectProjectUpdate.findUnique({
          where: { id: row.projectUpdateId },
        });
        if (update === null || update.projectId !== input.projectId) {
          return { ok: false, reason: "not_found" };
        }
        const updateStatus = isArchitectProjectUpdateStatus(update.status)
          ? update.status
          : ARCHITECT_PROJECT_UPDATE_STATUS.PENDING;
        if (updateStatus !== ARCHITECT_PROJECT_UPDATE_STATUS.PENDING) {
          // Une moitie du changement a deja ete tranchee ailleurs. NOX n'applique
          // pas l'autre moitie toute seule : les deux forment une intention.
          return { ok: false, reason: "not_pending", status: REPLAN_PROPOSAL_STATUS.APPLIED };
        }
        projectUpdateId = update.id;

        const target = input.projectUpdate ?? { brief: null, plan: null };
        if (target.brief !== null) {
          const checked = checkProjectBriefInput(target.brief);
          if (!checked.ok) {
            return { ok: false, reason: "invalid", field: checked.refusal.field };
          }
          briefValues = checked.values;
        }
        if (target.plan !== null) {
          const checked = checkProjectV1PlanInput(target.plan);
          if (!checked.ok) {
            return { ok: false, reason: "invalid", field: checked.refusal.field };
          }
          planValues = checked.values;
        }

        // Le budget se mesure sur l'etat **resultant**, pas sur ce qui change :
        // une section inchangee continue d'occuper sa place dans le contexte.
        const nextBrief = briefValues === null ? null : sanitizedBrief(briefValues, input.tools);
        const nextPlan = planValues === null ? null : sanitizedV1Plan(planValues, input.tools);
        const used =
          (nextBrief === null ? current.brief.chars : sanitizedBriefChars(nextBrief)) +
          (nextPlan === null ? current.plan.chars : sanitizedV1PlanChars(nextPlan));
        if (used > PROJECT_PLAN_LIMITS.structuredChars) {
          return { ok: false, reason: "budget", used, limit: PROJECT_PLAN_LIMITS.structuredChars };
        }

        // --- 4. L'amorcage ------------------------------------------------------
        const changesProject =
          (nextBrief !== null &&
            input.tools.revisions.brief(nextBrief) !== current.brief.revision) ||
          (nextPlan !== null && input.tools.revisions.plan(nextPlan) !== current.plan.revision);

        if (changesProject) {
          // `TASK-000` a ete redigee a partir de l'etat produit d'alors. Changer
          // cet etat avant qu'elle n'ait tourne la laisserait preparer des
          // fondations pour un projet qui n'existe plus — et NOX ne la reecrit ni
          // ne la supprime a la place de l'utilisateur.
          const bootstrap = await tx.task.findFirst({
            where: { projectId: input.projectId, kind: TASK_KIND.BOOTSTRAP },
            select: { id: true, _count: { select: { runs: true } } },
          });
          if (bootstrap !== null && bootstrap._count.runs === 0) {
            return { ok: false, reason: "bootstrap", code: BOOTSTRAP_REQUIRES_REFRESH };
          }
        }
      }

      // --- 5. Le graphe final --------------------------------------------------
      const targetTasks: ReplanTargetTask[] = input.target.map((item) => ({
        existingTaskId: item.existingTaskId,
        tempId: item.tempId,
        title: item.values.title,
        priority: item.values.priority,
        objective: item.values.objective,
        context: item.values.context,
        acceptanceCriteria: [],
        outOfScope: item.values.outOfScope === null ? [] : [item.values.outOfScope],
        documentReferences: [...item.values.documentReferences],
        validationCommands: [],
        dependsOnTaskIds: [...item.dependsOnTaskIds],
        dependsOnTempIds: [...item.dependsOnTempIds],
      }));

      const source = {
        editable: editable.map((task) => ({
          id: task.classified.id,
          code: task.classified.code,
          dependsOnTaskIds: task.dependsOnTaskIds,
        })),
        locked: locked.map((task) => ({
          id: task.classified.id,
          code: task.classified.code,
          dependsOnTaskIds: task.dependsOnTaskIds,
        })),
      };

      const structural = checkTargetStructure(input.target, source);
      if (structural !== null) {
        return { ok: false, reason: "graph", message: structural };
      }

      // Exactement l'autorite de PART 1, rejouee : cycles, dependances pendantes,
      // et tache verrouillee laissee a attendre une tache future supprimee.
      const graph = checkReplanTargetGraph(targetTasks, source);
      if (graph !== null) {
        return { ok: false, reason: "graph", message: graph.message };
      }

      // --- 6. Ecritures --------------------------------------------------------
      // La proposition est prise avant toute mutation. Une mise a jour
      // conditionnelle, jamais une lecture suivie d'une ecriture : c'est elle qui
      // rend dix applications simultanees mutuellement exclusives, et qui rend un
      // Apply et un Dismiss concurrents incapables d'aboutir tous les deux.
      const claimed = await tx.architectReplanProposal.updateMany({
        where: { id: input.proposalId, status: REPLAN_PROPOSAL_STATUS.PENDING },
        data: {
          status: REPLAN_PROPOSAL_STATUS.APPLIED,
          appliedAt: new Date(),
          appliedJson: input.appliedJson,
        },
      });
      if (claimed.count !== 1) {
        return { ok: false, reason: "not_pending", status };
      }

      if (projectUpdateId !== null) {
        const claimedUpdate = await tx.architectProjectUpdate.updateMany({
          where: { id: projectUpdateId, status: ARCHITECT_PROJECT_UPDATE_STATUS.PENDING },
          data: {
            status: ARCHITECT_PROJECT_UPDATE_STATUS.APPLIED,
            appliedAt: new Date(),
            appliedJson: JSON.stringify({ brief: briefValues, plan: planValues }),
          },
        });
        if (claimedUpdate.count !== 1) {
          return { ok: false, reason: "not_pending", status: REPLAN_PROPOSAL_STATUS.APPLIED };
        }
      }

      const savedBrief =
        briefValues === null
          ? rows.brief
          : await writeProjectBriefRow(tx, input.projectId, briefValues);
      const savedPlan =
        planValues === null
          ? rows.plan
          : await writeProjectV1PlanRow(tx, input.projectId, planValues);

      // --- 6a. Suppressions ----------------------------------------------------
      const kept = new Set(
        input.target.map((item) => item.existingTaskId).filter((id): id is string => id !== null),
      );
      const removed: ReplanRemovedTask[] = [];
      for (const task of editable) {
        if (kept.has(task.classified.id)) {
          continue;
        }
        const detail = await tx.task.findUnique({
          where: { id: task.classified.id },
          select: { documentPath: true, documentRevision: true },
        });
        await tx.taskAcceptanceCriterion.deleteMany({ where: { taskId: task.classified.id } });
        await tx.taskDocumentReference.deleteMany({ where: { taskId: task.classified.id } });
        await tx.taskValidationCommand.deleteMany({ where: { taskId: task.classified.id } });
        await tx.taskDependency.deleteMany({ where: { taskId: task.classified.id } });
        await tx.task.delete({ where: { id: task.classified.id } });
        removed.push({
          taskId: task.classified.id,
          code: task.classified.code,
          documentPath: detail?.documentPath ?? "",
          documentRevision: detail?.documentRevision ?? null,
        });
      }

      // --- 6b. Mises a jour ----------------------------------------------------
      const updated: ReplanAppliedTask[] = [];
      for (const item of input.target) {
        if (item.existingTaskId === null) {
          continue;
        }
        const task = byId.get(item.existingTaskId);
        if (task === undefined || task.contract === null) {
          // Impossible apres le controle de peremption ; laisse la transaction
          // echouer plutot que d'ecrire une tache a moitie decrite.
          throw new Error(`Tache ${item.existingTaskId} introuvable pendant une replanification.`);
        }

        const next = itemContract(item);
        if (!taskContractChanged(task.contract, next)) {
          // Rien n'a bouge : ni ecriture, ni `updatedAt`, ni degradation du
          // statut. Un plan cible identique n'est pas une modification.
          continue;
        }

        await tx.taskDocumentReference.deleteMany({ where: { taskId: item.existingTaskId } });
        await tx.task.update({
          where: { id: item.existingTaskId },
          data: {
            title: next.title,
            objective: next.objective,
            context: next.context,
            outOfScope: next.outOfScope,
            priority: next.priority,
            // Exactement la regle de TASK-024 : un contrat qui change ramene une
            // tache prete en brouillon, et laisse un brouillon en brouillon.
            status: taskStatusAfterEdit(task.classified.status, true),
            documentReferences: {
              create: next.documentReferences.map((path, position) => ({ position, path })),
            },
          },
        });
        await writeVerificationPlan(tx, item.existingTaskId, {
          criteria: next.acceptanceCriteria.map((criterion) => ({
            text: criterion.text,
            verificationMode: criterion.verificationMode,
            humanInstructions: criterion.humanInstructions,
            commandPositions: criterion.commandPositions,
          })),
          commands: next.validationCommands.map((command) => ({
            command: command.command,
            executionMode: command.executionMode,
          })),
        });

        updated.push({
          taskId: item.existingTaskId,
          code: task.classified.code,
          contractChanged: true,
        });
      }

      // --- 6c. Creations -------------------------------------------------------
      const created: ReplanAppliedTask[] = [];
      const idByTempId = new Map<string, string>();
      const newItems = input.target.filter((item) => item.tempId !== null);

      if (newItems.length > 0) {
        // Une seule incrementation pour toute la plage : deux applications
        // simultanees obtiennent deux plages disjointes, et aucun numero n'est
        // jamais attribue deux fois. Un numero supprime n'est jamais rendu.
        const sequences = await reserveTaskSequences(tx, input.projectId, newItems.length);
        for (const [position, item] of newItems.entries()) {
          const sequence = sequences[position];
          if (sequence === undefined) {
            throw new Error("Numero de tache manquant pendant une replanification.");
          }
          const values = item.values;
          const task = await writeTaskRow(tx, {
            projectId: input.projectId,
            title: values.title,
            objective: values.objective,
            context: values.context,
            outOfScope: values.outOfScope,
            priority: values.priority,
            acceptanceCriteria: values.acceptanceCriteria.map((criterion) => criterion.text),
            documentReferences: [...values.documentReferences],
            validationCommands: values.validationCommands.map((command) => command.command),
            verificationPlan: {
              criteria: values.acceptanceCriteria,
              commands: values.validationCommands,
            },
            sequence,
            replanProposalId: input.proposalId,
          });
          idByTempId.set(item.tempId ?? "", task.id);
          created.push({ taskId: task.id, code: task.code, contractChanged: true });
        }
      }

      // --- 6d. Dependances -----------------------------------------------------
      // Ecrites une fois tous les identifiants connus : une tache peut attendre
      // une tache nouvelle du meme lot, et aucun etat intermediaire incoherent
      // n'est jamais observable depuis l'exterieur de la transaction.
      for (const item of input.target) {
        const taskId = item.existingTaskId ?? idByTempId.get(item.tempId ?? "") ?? null;
        if (taskId === null) {
          throw new Error("Identifiant de tache introuvable pendant une replanification.");
        }

        const targets = new Set<string>(item.dependsOnTaskIds);
        for (const temp of item.dependsOnTempIds) {
          const resolved = idByTempId.get(temp);
          if (resolved === undefined) {
            throw new Error(`Dependance temporaire « ${temp} » non resolue.`);
          }
          targets.add(resolved);
        }

        // Comparees comme un **ensemble** : leur ordre ne signifie rien. Une liste
        // identique n'est pas reecrite — effacer puis recreer les memes aretes
        // ferait du bruit dans une base que quelqu'un finira par relire a la main.
        const before = byId.get(taskId)?.dependsOnTaskIds ?? [];
        const same = before.length === targets.size && before.every((id) => targets.has(id));
        if (same) {
          continue;
        }

        await tx.taskDependency.deleteMany({ where: { taskId } });
        for (const dependsOnTaskId of targets) {
          await tx.taskDependency.create({ data: { taskId, dependsOnTaskId } });
        }
      }

      // --- 6e. Ordre de planification -----------------------------------------
      const reordered = await normalizePlanningOrder(tx, input.target, editable, idByTempId);

      // --- 7. Le graphe ecrit --------------------------------------------------
      // Juge sur les aretes **ecrites**, comme l'edition unitaire de TASK-024 :
      // c'est la seule lecture qui contienne aussi ce qu'une transaction
      // concurrente vient de valider.
      if (hasAnyCycle(await readProjectDependencyEdges(tx, input.projectId))) {
        throw new ReplanCycleError();
      }

      return {
        ok: true,
        outcome: {
          proposalId: input.proposalId,
          projectUpdateId,
          state: buildStructuredStateFromRows({ brief: savedBrief, plan: savedPlan }, input.tools),
          created,
          updated,
          removed,
          reordered,
        },
      };
    })
    .catch((error: unknown): ApplyReplanResult => {
      if (error instanceof ReplanCycleError) {
        return { ok: false, reason: "graph", message: error.message };
      }
      throw error;
    });
}

/** Levee quand le graphe ecrit porte un cycle : la transaction entiere retombe. */
class ReplanCycleError extends Error {
  constructor() {
    super("Le plan applique contiendrait un cycle de dependances.");
    this.name = "ReplanCycleError";
  }
}

/**
 * Controles que le graphe partage ne couvre pas.
 *
 * Deux elements qui designent la meme tache, un element qui ne se declare ni
 * existant ni nouveau, deux identifiants temporaires identiques : le contrat les
 * refuse deja a la lecture d'un tour, et une cible editee a la main doit passer
 * exactement les memes.
 */
function checkTargetStructure(
  target: readonly ReplanApplyItem[],
  source: {
    editable: readonly { id: string; code: string }[];
    locked: readonly { id: string; code: string }[];
  },
): string | null {
  const editableIds = new Set(source.editable.map((task) => task.id));
  const lockedIds = new Set(source.locked.map((task) => task.id));
  const seenExisting = new Set<string>();
  const seenTemp = new Set<string>();

  for (const item of target) {
    if ((item.existingTaskId === null) === (item.tempId === null)) {
      return "Un element du plan ne dit pas s'il remplace une tache existante ou s'il en cree une.";
    }
    if (item.existingTaskId !== null) {
      if (lockedIds.has(item.existingTaskId)) {
        return "Le plan tente de reecrire une tache verrouillee : le travail deja commence n'est jamais reecrit.";
      }
      if (!editableIds.has(item.existingTaskId)) {
        return "Le plan designe une tache qui n'existe pas dans ce projet.";
      }
      if (seenExisting.has(item.existingTaskId)) {
        return "Le plan designe deux fois la meme tache existante.";
      }
      seenExisting.add(item.existingTaskId);
    }
    if (item.tempId !== null) {
      if (seenTemp.has(item.tempId)) {
        return "Le plan reutilise un identifiant temporaire.";
      }
      seenTemp.add(item.tempId);
    }
  }

  for (const item of target) {
    for (const temp of item.dependsOnTempIds) {
      if (!seenTemp.has(temp)) {
        return "Le plan fait attendre une tache nouvelle qui n'existe pas dans la cible.";
      }
    }
    for (const dependency of item.dependsOnTaskIds) {
      if (dependency === item.existingTaskId) {
        return "Une tache du plan s'attend elle-meme.";
      }
      if (!editableIds.has(dependency) && !lockedIds.has(dependency)) {
        return "Le plan fait attendre une tache qui n'existe pas dans ce projet.";
      }
      // Une tache future que la cible supprime ne peut plus etre attendue : elle
      // n'existera plus. Le refus vient avant l'ecriture, jamais d'une contrainte
      // de base declenchee au milieu d'une suppression.
      if (editableIds.has(dependency) && !seenExisting.has(dependency)) {
        return "Le plan fait attendre une tache qu'il supprime par ailleurs.";
      }
    }
  }

  return null;
}

/**
 * Normalise l'ordre du plan, et seulement quand il a reellement bouge.
 *
 * ## Pourquoi une condition, et pas une ecriture systematique
 *
 * Parce qu'appliquer une cible identique a l'etat courant ne doit produire
 * **aucune** mutation. La plupart des projets n'ont aucun ordre enregistre —
 * leur plan est celui des codes —, et ecrire `0, 1, 2` a chaque application
 * ferait bouger `updatedAt` sur des taches que personne n'a touchees.
 *
 * La question posee est donc : la suite des taches futures est-elle exactement
 * celle d'avant ? Si oui, rien n'est ecrit. Sinon, l'ordre valide par l'humain
 * devient l'ordre enregistre — et seules les lignes dont la valeur change sont
 * reecrites.
 */
async function normalizePlanningOrder(
  tx: Pick<DatabaseClient, "task">,
  target: readonly ReplanApplyItem[],
  editable: readonly { classified: { id: string }; planningOrder: number | null }[],
  idByTempId: ReadonlyMap<string, string>,
): Promise<number> {
  const before = editable.map((task) => task.classified.id);
  const after = target.map(
    (item) => item.existingTaskId ?? idByTempId.get(item.tempId ?? "") ?? "",
  );

  const unchanged =
    before.length === after.length && before.every((id, index) => id === after[index]);
  if (unchanged) {
    return 0;
  }

  const currentOrder = new Map(editable.map((task) => [task.classified.id, task.planningOrder]));

  let written = 0;
  for (const [position, taskId] of after.entries()) {
    if (currentOrder.get(taskId) === position) {
      continue;
    }
    await tx.task.update({ where: { id: taskId }, data: { planningOrder: position } });
    written += 1;
  }
  return written;
}

export type DismissReplanResult =
  | { ok: true; projectUpdateId: string | null }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_pending"; status: ReplanProposalStatus };

/**
 * Ecarte un changement de projet, dans son entier.
 *
 * Quand une mise a jour du projet est liee, les deux passent a `DISMISSED`
 * **ensemble**. L'etat « le plan a ete ecarte, la replanification attend
 * toujours » n'existe pas : ce serait offrir a l'utilisateur la moitie d'une
 * decision qu'il vient de refuser.
 *
 * Aucune tache n'est modifiee, aucun brief n'est ecrit, aucun document n'est
 * touche, et aucun appel n'est fait. La proposition reste lisible : ne pas
 * l'avoir retenue est aussi une information.
 */
export async function dismissReplanProposal(
  db: DatabaseClient,
  input: { projectId: string; proposalId: string },
): Promise<DismissReplanResult> {
  return db.$transaction(async (tx): Promise<DismissReplanResult> => {
    const row = await tx.architectReplanProposal.findUnique({ where: { id: input.proposalId } });
    if (row === null || row.projectId !== input.projectId) {
      return { ok: false, reason: "not_found" };
    }

    const status = isReplanProposalStatus(row.status)
      ? row.status
      : REPLAN_PROPOSAL_STATUS.DISMISSED;
    if (status !== REPLAN_PROPOSAL_STATUS.PENDING) {
      return { ok: false, reason: "not_pending", status };
    }

    const claimed = await tx.architectReplanProposal.updateMany({
      where: { id: input.proposalId, status: REPLAN_PROPOSAL_STATUS.PENDING },
      data: { status: REPLAN_PROPOSAL_STATUS.DISMISSED, dismissedAt: new Date() },
    });
    if (claimed.count !== 1) {
      return { ok: false, reason: "not_pending", status };
    }

    if (row.projectUpdateId !== null) {
      await tx.architectProjectUpdate.updateMany({
        where: { id: row.projectUpdateId, status: ARCHITECT_PROJECT_UPDATE_STATUS.PENDING },
        data: { status: ARCHITECT_PROJECT_UPDATE_STATUS.DISMISSED, dismissedAt: new Date() },
      });
    }

    return { ok: true, projectUpdateId: row.projectUpdateId };
  });
}

/**
 * Taches nees d'une replanification appliquee, pour la surface d'inspection.
 *
 * Rendues par code croissant : c'est l'ordre dans lequel elles ont ete creees,
 * et celui dans lequel l'utilisateur les lira.
 */
export async function listReplanCreatedTasks(
  db: DatabaseClient,
  proposalId: string,
): Promise<{ id: string; code: string; title: string; status: TaskStatus }[]> {
  const rows = await db.task.findMany({
    where: { replanProposalId: proposalId },
    orderBy: { sequence: "asc" },
    select: { id: true, sequence: true, title: true, status: true },
  });
  return rows.map((row) => ({
    id: row.id,
    code: formatTaskCode(row.sequence),
    title: row.title,
    // Un statut illisible ne fait pas tomber la page d'inspection : elle sert
    // precisement a regarder une base qu'on soupconne.
    status: (row.status as TaskStatus) ?? TASK_STATUS.DRAFT,
  }));
}
