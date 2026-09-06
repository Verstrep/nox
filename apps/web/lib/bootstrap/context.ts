/**
 * Contexte d'amorcage : ce qui entre dans `TASK-000`.
 *
 * ## Une liste fermee, plus courte que celle d'une planification
 *
 * Le brief, le plan, la memoire active, les taches produit deja enregistrees et
 * ce que le runner a constate du repository. Rien d'autre — ni transcript, ni
 * documentation du depot, ni diff, ni sortie de Claude Code.
 *
 * La documentation du depot en est volontairement absente : `TASK-000` va
 * justement l'ecrire, et la lui transmettre reviendrait a lui demander de
 * partir de la version qu'elle doit remplacer. Ce qui existe deja lui est dit
 * autrement — par la liste des documents fondamentaux presents, qu'elle ira
 * lire elle-meme dans le repository.
 *
 * ## Tout est sanitise
 *
 * Par le nettoyeur de l'Architecte, le seul de NOX du cote web. Un titre de
 * tache piege ou une entree de memoire hostile est neutralisee visiblement,
 * jamais supprimee en silence.
 *
 * ## Pur, sauf l'appel au runner
 *
 * Ce module ne parle a personne : il recoit l'inspection deja faite. C'est ce
 * qui permet de le tester sans repository, et de garantir qu'un meme etat
 * produit toujours la meme tache.
 */

import {
  BOOTSTRAP_PRESENTATION_LIMITS,
  BOOTSTRAP_SPEC_VERSION,
  PROJECT_MEMORY_STATUS,
  TASK_KIND,
  buildBootstrapTaskSpec,
  summarizeForDisplay,
  type ArchitectPromptBrief,
  type ArchitectPromptMemory,
  type ArchitectPromptV1Plan,
  type BootstrapSourceRefusal,
  type BootstrapTaskSpec,
  type BootstrapUpcomingTask,
  type DevelopmentTaskSummary,
  type ProjectMemoryEntry,
  type RepositoryInspection,
} from "@nox/shared";

import {
  bootstrapFingerprint,
  bootstrapMemoryRevision,
  bootstrapTaskInventoryRevision,
  repositoryInspectionRevision,
} from "./fingerprint.ts";

export type BootstrapContextInput = {
  projectName: string;
  /** Taches du projet, dans n'importe quel ordre : ce module les trie. */
  tasks: readonly DevelopmentTaskSummary[];
  /** Objectif de chaque tache, indexe par identifiant. */
  objectives: ReadonlyMap<string, string>;
  /** Memoire du projet. Les archivees sont refiltrees ici, jamais supposees absentes. */
  memories: readonly ProjectMemoryEntry[];
  projectBrief: ArchitectPromptBrief | null;
  projectV1Plan: ArchitectPromptV1Plan | null;
  /** Ce que le runner a constate. */
  inspection: RepositoryInspection;
  /** Nettoyeur applique a **toute** chaine transmise. */
  sanitize: (value: string) => string;
  /** Revision d'une entree de memoire, calculee sur son texte sanitise. */
  memoryRevision: (memory: ArchitectPromptMemory) => string;
};

export type BootstrapContext = {
  spec: BootstrapTaskSpec;
  /** Memoire active retenue, dans l'ordre des codes. */
  memories: ArchitectPromptMemory[];
  /** Taches produit a venir, dans l'ordre de leurs codes. */
  upcomingTasks: BootstrapUpcomingTask[];
  inspection: RepositoryInspection;
  /** Empreinte de tout ce qui precede. Seule autorite sur la peremption. */
  fingerprint: string;
  /** Revisions principales, conservees pour l'inspection. */
  briefRevision: string | null;
  planRevision: string | null;
  memoryRevision: string;
  taskInventoryRevision: string;
  inspectionRevision: string;
};

/**
 * Memoire **active** seulement.
 *
 * Le filtrage est refait ici plutot que suppose fait en amont : « seules les
 * `ACTIVE` partent » est une garantie, et une garantie ne se delegue pas a
 * l'appelant.
 */
function buildMemories(input: BootstrapContextInput): ArchitectPromptMemory[] {
  const retained: ArchitectPromptMemory[] = [];

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
    retained.push(entry);
  }

  return retained;
}

/**
 * Taches produit a venir.
 *
 * La tache d'amorcage elle-meme en est exclue : elle ne se decrit pas a
 * elle-meme comme un travail a preparer. L'ordre est celui des codes, qui est
 * aussi celui valide par l'humain — les codes sont attribues dans l'ordre
 * applique, et n'ont pas bouge depuis.
 */
function buildUpcomingTasks(input: BootstrapContextInput): BootstrapUpcomingTask[] {
  const limits = BOOTSTRAP_PRESENTATION_LIMITS.upcomingTasks;

  return input.tasks
    .filter((task) => task.kind !== TASK_KIND.BOOTSTRAP)
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code))
    .slice(0, limits.max)
    .map((task) => ({
      code: task.code,
      // `summarizeForDisplay` rend un `SummaryText` : le champ ne peut pas
      // recevoir une valeur canonique par distraction, et ce qui est resume
      // ici ne peut plus repartir comme une source.
      title: summarizeForDisplay(input.sanitize(task.title), limits.titleLength),
      objective: summarizeForDisplay(
        input.sanitize(input.objectives.get(task.id) ?? ""),
        limits.objectiveLength,
      ),
      priority: task.priority,
      status: task.status,
    }));
}

/**
 * Issue de la construction.
 *
 * Une union plutot qu'un contexte eventuellement incomplet : un contrat
 * d'amorcage tronque a l'air complet, et c'est precisement ce qui l'a rendu si
 * couteux chez le premier pilote reel.
 */
export type BootstrapContextOutcome =
  | { ok: true; context: BootstrapContext }
  | { ok: false; refusal: BootstrapSourceRefusal };

/**
 * Assemble le contexte, la specification et l'empreinte d'un amorcage.
 *
 * Deterministe de bout en bout : aucun appel, aucune horloge, aucun aleatoire.
 * Deux executions sur le meme etat produisent la meme tache et la meme
 * empreinte — c'est ce qui rend l'apercu digne de confiance.
 *
 * Le brief, le plan et la memoire y entrent **entiers**. Si l'etat produit
 * sortait des bornes qui garantissent cette integralite, la construction refuse
 * en nommant le champ : NOX ne fabrique pas un contrat qu'il sait incomplet.
 */
export function buildBootstrapContext(input: BootstrapContextInput): BootstrapContextOutcome {
  const memories = buildMemories(input);
  const upcomingTasks = buildUpcomingTasks(input);

  const built = buildBootstrapTaskSpec({
    projectName: input.sanitize(input.projectName),
    brief: input.projectBrief,
    v1Plan: input.projectV1Plan,
    memories,
    upcomingTasks,
    inspection: input.inspection,
  });

  if (!built.ok) {
    return { ok: false, refusal: built.refusal };
  }

  const spec = built.spec;
  const memoryRevision = bootstrapMemoryRevision(memories);
  const taskInventoryRevision = bootstrapTaskInventoryRevision(upcomingTasks);
  const inspectionRevision = repositoryInspectionRevision(input.inspection);

  const context: BootstrapContext = {
    spec,
    memories,
    upcomingTasks,
    inspection: input.inspection,
    fingerprint: bootstrapFingerprint({
      briefRevision: input.projectBrief?.revision ?? null,
      planRevision: input.projectV1Plan?.revision ?? null,
      memoryRevision,
      taskInventoryRevision,
      inspectionRevision,
      specVersion: BOOTSTRAP_SPEC_VERSION,
    }),
    briefRevision: input.projectBrief?.revision ?? null,
    planRevision: input.projectV1Plan?.revision ?? null,
    memoryRevision,
    taskInventoryRevision,
    inspectionRevision,
  };

  return { ok: true, context };
}
