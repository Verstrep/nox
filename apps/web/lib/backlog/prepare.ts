/**
 * Preparation d'une planification : contexte, prompt, empreintes.
 *
 * Ce module ne joint ni le runner, ni le fournisseur, ni la base. Il assemble ce
 * qu'on lui donne et rend exactement ce qui partira. C'est ce qui permet a
 * l'inspection du contexte d'afficher **le texte reel** plutot qu'une
 * approximation, et aux tests de tout verifier sans reseau.
 *
 * ## Deux empreintes, deux roles
 *
 * - `planningFingerprint` couvre les cinq sources qui decident d'un backlog :
 *   brief, plan, memoire active, inventaire des taches, documents inclus. C'est
 *   elle qui est enregistree avec la generation et recomparee a l'application.
 * - `inputHash` couvre **tout** ce qui peut changer la reponse : version du
 *   prompt, modele, instructions, entree, manifest. C'est un identifiant de
 *   diagnostic — « ces deux planifications ont-elles vu la meme chose ? » —, pas
 *   une decision d'autorisation.
 *
 * Les melanger aurait un cout precis : un changement de modele rendrait perime
 * un backlog dont le projet n'a pas bouge d'une ligne.
 */

import {
  ARCHITECT_BACKLOG_MAX_OUTPUT_TOKENS,
  renderBacklogPrompt,
  type ArchitectPromptBrief,
  type ArchitectPromptV1Plan,
  type BacklogContextManifest,
  type BacklogPrompt,
  type DevelopmentTaskSummary,
  type ProjectDocumentSummary,
  type ProjectMemoryEntry,
} from "@nox/shared";
import type { BacklogPlanningBase } from "@nox/database";
import { createHash } from "node:crypto";

import type { FetchedArchitectDocument } from "../architect/context.ts";
import { projectMemoryRevision } from "../architect/fingerprint.ts";
import { createArchitectSanitizer } from "../architect/sanitize.ts";
import { buildBacklogPlanningContext } from "./planning-context.ts";

export type PrepareBacklogInput = {
  projectName: string;
  repositoryPath: string;
  documents: readonly FetchedArchitectDocument[];
  inventory: readonly ProjectDocumentSummary[];
  tasks: readonly DevelopmentTaskSummary[];
  /** Objectif de chaque tache, indexe par identifiant. */
  objectives: ReadonlyMap<string, string>;
  memories: readonly ProjectMemoryEntry[];
  projectBrief: ArchitectPromptBrief | null;
  projectV1Plan: ArchitectPromptV1Plan | null;
  /** Modele lu dans la configuration serveur ; entre dans l'empreinte d'entree. */
  model: string;
  environment: Record<string, string | undefined>;
};

export type PreparedBacklogGeneration = {
  manifest: BacklogContextManifest;
  prompt: BacklogPrompt;
  availableDocuments: string[];
  /** Etat de planification vu par le fournisseur, a enregistrer tel quel. */
  base: BacklogPlanningBase;
  /** Empreinte deterministe de l'entree logique. Diagnostic, jamais securite. */
  inputHash: string;
  /** Plafond de sortie declare pour cet appel. */
  maxOutputTokens: number;
};

/**
 * Empreinte de l'entree logique d'une planification.
 *
 * Chaque champ est precede de sa longueur, sans quoi deux entrees differentes
 * pourraient produire la meme empreinte par simple deplacement d'une frontiere.
 *
 * **Ce n'est pas un mecanisme de securite.** Aucune decision d'autorisation ne
 * s'y appuie.
 */
export function backlogInputHash(parts: {
  promptVersion: string;
  model: string;
  instructions: string;
  input: string;
  manifest: BacklogContextManifest;
}): string {
  const hash = createHash("sha256");
  const field = (value: string): void => {
    hash.update(String(value.length));
    hash.update(" ");
    hash.update(value, "utf8");
    hash.update(" ");
  };

  field(parts.promptVersion);
  field(parts.model);
  field(parts.instructions);
  field(parts.input);
  field(JSON.stringify(parts.manifest));

  return hash.digest("hex");
}

/**
 * Assemble le contexte, le prompt et les empreintes d'une planification.
 *
 * Le nettoyeur est **exactement** celui de l'Architecte : il n'existe qu'un
 * nettoyeur dans NOX, et le doubler reviendrait a laisser passer un jour ce que
 * l'autre attrape. Documents, memoire, titres et objectifs de taches, nom du
 * projet : tout ce qui part le traverse.
 */
export function prepareBacklogGeneration(
  input: PrepareBacklogInput,
): PreparedBacklogGeneration {
  const sanitize = createArchitectSanitizer({
    repositoryRoot: input.repositoryPath,
    environment: input.environment,
  });

  const bundle = buildBacklogPlanningContext({
    documents: input.documents,
    inventory: input.inventory,
    tasks: input.tasks,
    objectives: input.objectives,
    memories: input.memories,
    projectBrief: input.projectBrief,
    projectV1Plan: input.projectV1Plan,
    sanitize,
    memoryRevision: projectMemoryRevision,
  });

  const prompt = renderBacklogPrompt({
    projectName: sanitize(input.projectName),
    instructionDocuments: bundle.instructionDocuments,
    projectBrief: bundle.projectBrief,
    projectV1Plan: bundle.projectV1Plan,
    projectMemory: bundle.projectMemory,
    existingTasks: bundle.existingTasks,
    contextDocuments: bundle.contextDocuments,
    availableDocuments: bundle.availableDocuments,
  });

  return {
    manifest: bundle.manifest,
    prompt,
    availableDocuments: bundle.availableDocuments,
    base: {
      planningFingerprint: bundle.planningFingerprint,
      briefRevision: bundle.projectBrief?.revision ?? null,
      planRevision: bundle.projectV1Plan?.revision ?? null,
      taskInventoryRevision: bundle.taskInventoryRevision,
      memoryRevision: bundle.memoryRevision,
    },
    maxOutputTokens: ARCHITECT_BACKLOG_MAX_OUTPUT_TOKENS,
    inputHash: backlogInputHash({
      promptVersion: prompt.version,
      model: input.model,
      instructions: prompt.instructions,
      input: prompt.input,
      manifest: bundle.manifest,
    }),
  };
}
