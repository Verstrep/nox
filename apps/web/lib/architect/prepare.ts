/**
 * Preparation d'un tour : contexte, transcript, prompt, empreintes.
 *
 * Ce module ne joint ni le runner, ni le fournisseur, ni la base. Il assemble ce
 * qu'on lui donne et rend exactement ce qui partira. C'est ce qui permet a la
 * preview d'afficher **le texte reel** plutot qu'une approximation, et aux tests
 * de tout verifier sans reseau.
 *
 * ## Deux empreintes, deux roles
 *
 * - `contextFingerprint` ne couvre que le **contexte projet**. C'est lui qu'on
 *   compare entre l'apercu et l'envoi, et entre deux tours.
 * - `inputHash` couvre **tout** ce qui peut changer la reponse : version du
 *   prompt, modele, transcript, nouveau message, contexte. C'est un identifiant
 *   de diagnostic — « ces deux generations ont-elles vu la meme chose ? » —, pas
 *   une decision d'autorisation.
 *
 * Les melanger aurait un cout precis : le contexte serait declare « change » a
 * chaque message, et l'avertissement finirait par ne plus rien signaler.
 */

import {
  architectTurnSchemaVersion,
  renderArchitectPrompt,
  type ArchitectContextManifest,
  type ArchitectPrompt,
  type ArchitectPromptBrief,
  type ArchitectPromptV1Plan,
  type ArchitectSessionKind,
  type ArchitectTurnSchemaVersion,
  type DevelopmentTaskDetail,
  type ProjectDocumentSummary,
  type ProjectMemoryEntry,
} from "@nox/shared";
import type { ProjectUpdateBase } from "@nox/database";
import { createHash } from "node:crypto";

import { buildArchitectContext, type FetchedArchitectDocument } from "./context.ts";
import {
  architectContextFingerprint,
  architectTaskRevision,
  architectTurnFingerprint,
  projectMemoryRevision,
} from "./fingerprint.ts";
import { createArchitectSanitizer } from "./sanitize.ts";
import {
  selectTranscriptWindow,
  transcriptBudget,
  type TranscriptEntry,
  type TranscriptWindow,
} from "./window.ts";

export type PrepareArchitectInput = {
  /** Role de la session : il decide du prompt et de la version de contrat. */
  sessionKind: ArchitectSessionKind;
  projectName: string;
  repositoryPath: string;
  documents: readonly FetchedArchitectDocument[];
  inventory: readonly ProjectDocumentSummary[];
  tasks: readonly DevelopmentTaskDetail[];
  /** Memoire du projet, dans l'ordre des codes. Les archivees sont ecartees. */
  memories: readonly ProjectMemoryEntry[];
  /** Brief produit courant, deja sanitise. `null` s'il n'a jamais ete defini. */
  projectBrief: ArchitectPromptBrief | null;
  /** Plan de V1 courant, deja sanitise. */
  projectV1Plan: ArchitectPromptV1Plan | null;
  /** Messages deja echanges, du plus ancien au plus recent. */
  transcript: readonly TranscriptEntry[];
  /** Message que l'utilisateur vient d'ecrire. */
  newMessage: string;
  /** Modele lu dans la configuration serveur ; entre dans l'empreinte d'entree. */
  model: string;
  environment: Record<string, string | undefined>;
};

export type PreparedArchitectGeneration = {
  manifest: ArchitectContextManifest;
  prompt: ArchitectPrompt;
  availableDocuments: string[];
  /** Empreinte du contexte projet seul : documents, memoire, taches recentes. */
  contextFingerprint: string;
  /**
   * Empreinte de **tout** ce qui part : contexte, transcript retenu, message.
   *
   * C'est elle qui est enregistree a l'apercu et recomparee juste avant
   * l'envoi. Sans le transcript, un message envoye depuis un second onglet
   * passerait inapercu : le contexte projet, lui, n'aurait pas bouge.
   */
  turnFingerprint: string;
  /** Ce qui a ete retenu du transcript, et ce qui ne l'a pas ete. */
  window: TranscriptWindow;
  /** Taille du transcript reellement transmis, message compris. */
  transcriptChars: number;
  /** Empreinte deterministe de l'entree logique. Diagnostic, jamais securite. */
  inputHash: string;
  /** Version de contrat attendue de la reponse, derivee du role de la session. */
  turnSchemaVersion: ArchitectTurnSchemaVersion;
  /**
   * Etat structure **vu par le fournisseur** pour ce tour.
   *
   * C'est la seule source autorisee des revisions de base d'une proposition de
   * mise a jour. Elle est produite ici, au moment de construire le contexte, et
   * transportee en memoire serveur jusqu'a la persistance du resultat.
   *
   * Relire l'etat courant a l'arrivee de la reponse serait plus simple et faux :
   * l'utilisateur peut avoir modifie son plan pendant l'appel, et la proposition
   * serait alors etiquetee comme batie sur un etat que le modele n'a jamais vu.
   * Le controle de peremption ne detecterait plus rien.
   */
  baseStructuredState: ProjectUpdateBase;
};

/**
 * Empreinte de l'entree logique d'une generation.
 *
 * Chaque champ est precede de sa longueur, sans quoi deux entrees differentes
 * pourraient produire la meme empreinte par simple deplacement d'une frontiere.
 *
 * **Ce n'est pas un mecanisme de securite.** Aucune decision d'autorisation ne
 * s'y appuie.
 */
export function architectInputHash(parts: {
  promptVersion: string;
  model: string;
  instructions: string;
  input: string;
  manifest: ArchitectContextManifest;
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
 * Assemble le contexte, le transcript, le prompt et les empreintes d'un tour.
 *
 * Le transcript et le nouveau message traversent la **meme** sanitation que les
 * documents : ils viennent d'un formulaire, donc de l'exterieur, et rien ne
 * garantit qu'un utilisateur n'y colle pas par megarde un chemin absolu ou une
 * cle. Les reponses de l'architecte la traversent aussi — elles ont ete
 * produites a partir d'un contexte, et un modele recopie ce qu'il lit.
 */
export function prepareArchitectGeneration(
  input: PrepareArchitectInput,
): PreparedArchitectGeneration {
  const sanitize = createArchitectSanitizer({
    repositoryRoot: input.repositoryPath,
    environment: input.environment,
  });

  const bundle = buildArchitectContext({
    documents: input.documents,
    inventory: input.inventory,
    tasks: input.tasks,
    memories: input.memories,
    projectBrief: input.projectBrief,
    projectV1Plan: input.projectV1Plan,
    sanitize,
    taskRevision: architectTaskRevision,
    memoryRevision: projectMemoryRevision,
  });

  // La sanitation precede la fenetre, et non l'inverse : le budget doit se
  // mesurer sur le texte reellement transmis, comme celui de la memoire projet.
  const sanitized: TranscriptEntry[] = input.transcript.map((message) => ({
    role: message.role,
    content: sanitize(message.content),
    proposal: message.proposal ?? null,
    turnId: message.turnId,
  }));
  const newMessage = sanitize(input.newMessage);

  const window = selectTranscriptWindow(sanitized, transcriptBudget(newMessage.length));
  const transcript = window.messages;
  const transcriptChars = window.chars + newMessage.length;

  const prompt = renderArchitectPrompt({
    sessionKind: input.sessionKind,
    projectName: sanitize(input.projectName),
    instructionDocuments: bundle.instructionDocuments,
    contextDocuments: bundle.contextDocuments,
    projectMemory: bundle.projectMemory,
    projectBrief: bundle.projectBrief,
    projectV1Plan: bundle.projectV1Plan,
    recentTasks: bundle.recentTasks,
    availableDocuments: bundle.availableDocuments,
    transcript,
    newMessage,
  });

  const contextFingerprint = architectContextFingerprint(bundle);

  return {
    manifest: bundle.manifest,
    prompt,
    availableDocuments: bundle.availableDocuments,
    contextFingerprint,
    turnFingerprint: architectTurnFingerprint({ contextFingerprint, transcript, newMessage }),
    window,
    transcriptChars,
    turnSchemaVersion: architectTurnSchemaVersion(input.sessionKind),
    baseStructuredState: {
      briefRevision: bundle.projectBrief?.revision ?? null,
      planRevision: bundle.projectV1Plan?.revision ?? null,
    },
    inputHash: architectInputHash({
      promptVersion: prompt.version,
      model: input.model,
      instructions: prompt.instructions,
      input: prompt.input,
      manifest: bundle.manifest,
    }),
  };
}
