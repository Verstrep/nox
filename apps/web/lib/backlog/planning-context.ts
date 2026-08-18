/**
 * Construction du contexte de planification envoye au fournisseur.
 *
 * ## Une liste fermee, pas une exploration
 *
 * Le planificateur ne recoit **jamais** le repository. Il recoit le brief, le
 * plan, la memoire active, l'inventaire des taches, et les huit chemins connus
 * a l'avance de l'Architecte — deux fichiers de conventions, six documents
 * produit. Rien d'autre n'est candidat : ni code source, ni diff, ni sortie de
 * Claude Code, ni fichier `.env`, ni chemin choisi par le navigateur.
 *
 * La liste des documents est **exactement** celle de l'Architecte, importee et
 * non recopiee. Deux listes fermees pour un meme repository finiraient par
 * diverger, et celle qui aurait tort serait celle qui envoie trop.
 *
 * ## Aucun transcript
 *
 * Et c'est le point de TASK-022. Le brief, le plan, la memoire, les taches et
 * la documentation suffisent a planifier : si ce n'etait pas vrai, l'etat
 * structure de TASK-021 n'aurait servi a rien. Faire dependre un backlog du
 * dernier message ecrit reviendrait a dire que la connaissance durable du
 * projet vit dans le chat — exactement ce que NOX a passe deux taches a
 * corriger.
 *
 * ## Ce module ne lit rien
 *
 * Il recoit des documents deja lus par le runner et des taches deja relues en
 * base, et decide de ce qui entre. Pur et deterministe : les memes entrees
 * produisent le meme bundle, ce qui rend l'empreinte comparable et les tests
 * possibles sans runner ni repository.
 */

import {
  PROJECT_MEMORY_STATUS,
  type ArchitectPromptBrief,
  type ArchitectPromptDocument,
  type ArchitectPromptMemory,
  type ArchitectPromptV1Plan,
  type BacklogContextManifest,
  type BacklogContextSource,
  type BacklogInventoryTask,
  type DevelopmentTaskSummary,
  type ProjectDocumentSummary,
  type ProjectMemoryEntry,
} from "@nox/shared";

import {
  ARCHITECT_CONTEXT_DOCUMENTS,
  ARCHITECT_INSTRUCTION_DOCUMENTS,
  buildAvailableDocuments,
  truncateAroundMiddle,
  type FetchedArchitectDocument,
} from "../architect/context.ts";
import {
  backlogMemoryRevision,
  backlogPlanningFingerprint,
  backlogTaskInventoryRevision,
  backlogTaskRevision,
} from "./fingerprint.ts";

/**
 * Bornes du contexte de planification.
 *
 * ## Un budget dedie, et pourquoi il est plus large
 *
 * Une conversation transporte un transcript de 64 Kio ; une planification n'en
 * transporte aucun. La place ainsi liberee sert a l'inventaire des taches, dont
 * la conversation se passe presque entierement — elle n'en voit que dix.
 *
 * ## L'arithmetique de non-troncature
 *
 * ```text
 *  16 (etat structure, borne a l'ecriture)
 * + 64 (deux documents de conventions, 32 Kio chacun)
 * + 48 (memoire active, borne a l'ecriture)
 * + 32 (inventaire : 40 taches de 800 caracteres)
 * = 160 Kio
 * ```
 *
 * Le budget vaut 192 Kio : les quatre categories qui ne doivent jamais etre
 * coupees y tiennent, et il reste une trentaine de Kio pour la documentation du
 * repository — la seule qui ait le droit d'etre tronquee, et qui l'annonce
 * quand elle l'est.
 *
 * Des constantes, jamais des variables d'environnement : elles decident de ce
 * qui quitte la machine et de ce qui sera facture.
 */
export const BACKLOG_CONTEXT_LIMITS = {
  totalChars: 192 * 1024,
  /** Taille maximale d'un document, troncature comprise. */
  documentChars: 32 * 1024,
  /**
   * Taches decrites dans l'inventaire.
   *
   * Quarante, et les plus recentes quand il y en a davantage. Un projet qui
   * depasse ce nombre a une histoire plus longue que sa V1 ; ce sont ses taches
   * recentes qui decrivent le travail en cours, et donc ce qu'il ne faut pas
   * reproposer. La limite est reelle et assumee : au-dela, le modele pourrait
   * reproposer un travail couvert par une tache tres ancienne, et c'est la revue
   * humaine qui l'attrapera.
   */
  tasks: 40,
  /** Taille maximale de la fiche d'une tache. */
  taskChars: 800,
  /** Longueur retenue du titre d'une tache. */
  taskTitleChars: 200,
  /** Longueur retenue de l'objectif d'une tache. */
  taskObjectiveChars: 500,
  /** Taille maximale de la liste fermee des documents referencables. */
  availableDocuments: 80,
} as const;

export type BacklogPlanningInput = {
  /** Documents effectivement lus par le runner, quel que soit leur ordre. */
  documents: readonly FetchedArchitectDocument[];
  /** Inventaire complet du repository, pour la liste fermee des references. */
  inventory: readonly ProjectDocumentSummary[];
  /** Taches du projet, dans n'importe quel ordre : ce module les trie. */
  tasks: readonly DevelopmentTaskSummary[];
  /** Objectif de chaque tache, indexe par identifiant. */
  objectives: ReadonlyMap<string, string>;
  /** Memoire du projet. Les archivees sont refiltrees ici, jamais supposees absentes. */
  memories: readonly ProjectMemoryEntry[];
  /** Brief produit courant, deja sanitise et porteur de sa revision. */
  projectBrief: ArchitectPromptBrief | null;
  /** Plan de V1 courant. */
  projectV1Plan: ArchitectPromptV1Plan | null;
  /** Nettoyeur applique a **toute** chaine transmise. */
  sanitize: (value: string) => string;
  /** Revision d'une entree de memoire, calculee sur son texte sanitise. */
  memoryRevision: (memory: ArchitectPromptMemory) => string;
};

export type BacklogPlanningBundle = {
  manifest: BacklogContextManifest;
  instructionDocuments: ArchitectPromptDocument[];
  contextDocuments: ArchitectPromptDocument[];
  projectMemory: ArchitectPromptMemory[];
  projectBrief: ArchitectPromptBrief | null;
  projectV1Plan: ArchitectPromptV1Plan | null;
  existingTasks: BacklogInventoryTask[];
  availableDocuments: string[];
  /** Empreinte de tout ce qui precede. Sert a detecter la peremption. */
  planningFingerprint: string;
  /** Revisions principales, conservees pour l'inspection du manifest. */
  taskInventoryRevision: string;
  memoryRevision: string;
};

/** Cout d'un brief, mesure exactement comme a l'ecriture. */
function briefChars(brief: ArchitectPromptBrief): number {
  return (
    brief.summary.length +
    brief.problem.length +
    brief.targetUsers.length +
    brief.desiredOutcome.length +
    brief.goals.reduce((total, entry) => total + entry.length, 0) +
    brief.nonGoals.reduce((total, entry) => total + entry.length, 0)
  );
}

/** Cout d'un plan de V1. */
function planChars(plan: ArchitectPromptV1Plan): number {
  return (
    plan.goal.length +
    plan.technicalDirection.length +
    plan.inScope.reduce((total, entry) => total + entry.length, 0) +
    plan.outOfScope.reduce((total, entry) => total + entry.length, 0) +
    plan.milestones.reduce((total, entry) => total + entry.length, 0)
  );
}

/**
 * Resume une tache pour l'inventaire.
 *
 * Ce qui entre : ce que la tache **demandait**, et ou elle en est. Ce qui
 * n'entre jamais : ce que son execution a produit — prompt, timeline, diff,
 * cout, session, feedback. Le planificateur decoupe du travail restant, il
 * n'audite pas un run.
 *
 * Les criteres d'acceptation n'y sont pas non plus, et c'est un choix : titre,
 * statut et objectif suffisent a repondre a « ce travail est-il deja couvert ? »,
 * et ajouter les criteres de quarante taches remplirait le budget sans changer
 * une seule decision de decoupage.
 */
function summarizeInventoryTask(
  task: DevelopmentTaskSummary,
  objective: string,
  sanitize: (value: string) => string,
): BacklogInventoryTask {
  const entry = {
    code: task.code,
    title: sanitize(task.title).slice(0, BACKLOG_CONTEXT_LIMITS.taskTitleChars),
    status: task.status,
    priority: task.priority,
    objective: sanitize(objective).slice(0, BACKLOG_CONTEXT_LIMITS.taskObjectiveChars),
  };

  return { ...entry, revision: backlogTaskRevision(entry) };
}

/** Cout d'une fiche d'inventaire, borne. */
function inventoryTaskChars(task: BacklogInventoryTask): number {
  return Math.min(
    task.code.length + task.title.length + task.status.length + task.priority.length + task.objective.length,
    BACKLOG_CONTEXT_LIMITS.taskChars,
  );
}

/**
 * Construit le contexte transmis au planificateur.
 *
 * L'ordre de consommation du budget est fixe : etat structure, conventions,
 * memoire, inventaire, puis documentation. Les quatre premiers ne peuvent pas
 * etre tronques — l'arithmetique de `BACKLOG_CONTEXT_LIMITS` le garantit — et
 * seule la documentation, en dernier, peut l'etre. Elle l'annonce alors dans son
 * manifest.
 */
export function buildBacklogPlanningContext(
  input: BacklogPlanningInput,
): BacklogPlanningBundle {
  const byPath = new Map(input.documents.map((document) => [document.path, document]));
  const sources: BacklogContextSource[] = [];
  const missing: string[] = [];
  let remaining = BACKLOG_CONTEXT_LIMITS.totalChars;

  const takeDocument = (
    path: string,
    kind: "INSTRUCTIONS" | "DOCUMENT",
  ): ArchitectPromptDocument | null => {
    const found = byPath.get(path);
    if (found === undefined) {
      // Un document absent n'est pas une erreur : c'est simplement moins de
      // contexte. Un projet qui commence n'en possede aucun.
      missing.push(path);
      return null;
    }

    const cleaned = input.sanitize(found.content);
    const budget = Math.min(BACKLOG_CONTEXT_LIMITS.documentChars, remaining);
    const { text, truncated } = truncateAroundMiddle(cleaned, budget);
    remaining -= text.length;

    sources.push({
      kind,
      identifier: path,
      revision: found.revision,
      includedChars: text.length,
      truncated,
    });

    return { path, revision: found.revision, truncated, content: text };
  };

  if (input.projectBrief !== null) {
    const chars = briefChars(input.projectBrief);
    remaining -= chars;
    sources.push({
      kind: "PROJECT_BRIEF",
      identifier: "Project Brief",
      revision: input.projectBrief.revision,
      includedChars: chars,
      truncated: false,
    });
  }

  if (input.projectV1Plan !== null) {
    const chars = planChars(input.projectV1Plan);
    remaining -= chars;
    sources.push({
      kind: "PROJECT_V1_PLAN",
      identifier: "Living V1 Plan",
      revision: input.projectV1Plan.revision,
      includedChars: chars,
      truncated: false,
    });
  }

  const instructionDocuments: ArchitectPromptDocument[] = [];
  for (const path of ARCHITECT_INSTRUCTION_DOCUMENTS) {
    const document = takeDocument(path, "INSTRUCTIONS");
    if (document !== null && document.content !== "") {
      instructionDocuments.push(document);
    }
  }

  // La memoire passe avant l'inventaire et la documentation : elle ne doit
  // jamais etre tronquee, et la garantie « ACTIVE = envoye » de TASK-017 doit
  // valoir ici exactement comme dans une conversation.
  const projectMemory: ArchitectPromptMemory[] = [];
  for (const memory of input.memories) {
    if (memory.status !== PROJECT_MEMORY_STATUS.ACTIVE) {
      continue;
    }

    const entry: ArchitectPromptMemory = {
      code: memory.code,
      category: memory.category,
      revision: "",
      title: input.sanitize(memory.title),
      content: input.sanitize(memory.content),
      rationale: memory.rationale === null ? null : input.sanitize(memory.rationale),
    };
    entry.revision = input.memoryRevision(entry);

    const chars = entry.title.length + entry.content.length + (entry.rationale?.length ?? 0);
    remaining -= chars;
    projectMemory.push(entry);

    sources.push({
      kind: "MEMORY",
      identifier: memory.code,
      revision: entry.revision,
      includedChars: chars,
      truncated: false,
      category: memory.category,
    });
  }

  // L'inventaire est trie par code croissant : c'est l'ordre dans lequel le
  // projet s'est construit, donc celui dans lequel il se lit. Quand il y a plus
  // de taches que la borne, ce sont les plus recentes qui sont retenues — elles
  // decrivent le travail en cours, donc ce qu'il ne faut pas reproposer.
  const ordered = [...input.tasks].sort((a, b) => a.code.localeCompare(b.code));
  const retained = ordered.slice(Math.max(0, ordered.length - BACKLOG_CONTEXT_LIMITS.tasks));

  const existingTasks: BacklogInventoryTask[] = [];
  for (const task of retained) {
    const summary = summarizeInventoryTask(
      task,
      input.objectives.get(task.id) ?? "",
      input.sanitize,
    );
    const chars = inventoryTaskChars(summary);
    remaining -= chars;
    existingTasks.push(summary);

    sources.push({
      kind: "TASK",
      identifier: task.code,
      revision: summary.revision,
      includedChars: chars,
      truncated: false,
    });
  }

  const contextDocuments: ArchitectPromptDocument[] = [];
  for (const path of ARCHITECT_CONTEXT_DOCUMENTS) {
    const document = takeDocument(path, "DOCUMENT");
    if (document !== null && document.content !== "") {
      contextDocuments.push(document);
    }
  }

  const availableDocuments = buildAvailableDocuments(input.inventory).slice(
    0,
    BACKLOG_CONTEXT_LIMITS.availableDocuments,
  );

  const taskInventoryRevision = backlogTaskInventoryRevision(existingTasks);
  const memoryRevision = backlogMemoryRevision(projectMemory);

  return {
    manifest: {
      schemaVersion: 1,
      sources,
      totalChars: BACKLOG_CONTEXT_LIMITS.totalChars - remaining,
      missing,
      taskInventoryRevision,
    },
    instructionDocuments,
    contextDocuments,
    projectMemory,
    projectBrief: input.projectBrief,
    projectV1Plan: input.projectV1Plan,
    existingTasks,
    availableDocuments,
    taskInventoryRevision,
    memoryRevision,
    planningFingerprint: backlogPlanningFingerprint({
      briefRevision: input.projectBrief?.revision ?? null,
      planRevision: input.projectV1Plan?.revision ?? null,
      memoryRevision,
      taskInventoryRevision,
      instructionDocuments,
      contextDocuments,
      availableDocuments,
      missingDocuments: missing,
    }),
  };
}
