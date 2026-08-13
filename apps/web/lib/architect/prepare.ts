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
  ARCHITECT_LIMITS,
  ARCHITECT_PROMPT_VERSION,
  renderArchitectPrompt,
  type ArchitectContextManifest,
  type ArchitectPrompt,
  type ArchitectPromptMessage,
  type DevelopmentTaskDetail,
  type ProjectDocumentSummary,
  type ProjectMemoryEntry,
} from "@nox/shared";
import { createHash } from "node:crypto";

import { buildArchitectContext, type FetchedArchitectDocument } from "./context.ts";
import {
  architectContextFingerprint,
  architectTaskRevision,
  projectMemoryRevision,
} from "./fingerprint.ts";
import { createArchitectSanitizer } from "./sanitize.ts";

export type PrepareArchitectInput = {
  projectName: string;
  repositoryPath: string;
  documents: readonly FetchedArchitectDocument[];
  inventory: readonly ProjectDocumentSummary[];
  tasks: readonly DevelopmentTaskDetail[];
  /** Memoire du projet, dans l'ordre des codes. Les archivees sont ecartees. */
  memories: readonly ProjectMemoryEntry[];
  /** Messages deja echanges, du plus ancien au plus recent. */
  transcript: readonly ArchitectPromptMessage[];
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
  /** Empreinte du contexte projet seul. */
  contextFingerprint: string;
  /** Taille du transcript reellement transmis, en caracteres. */
  transcriptChars: number;
  /** Vrai lorsque le transcript depasse la borne : le tour est impossible. */
  transcriptTooLarge: boolean;
  /** Empreinte deterministe de l'entree logique. Diagnostic, jamais securite. */
  inputHash: string;
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
    sanitize,
    taskRevision: architectTaskRevision,
    memoryRevision: projectMemoryRevision,
  });

  const transcript: ArchitectPromptMessage[] = input.transcript.map((message) => ({
    role: message.role,
    content: sanitize(message.content),
    proposal: message.proposal ?? null,
  }));
  const newMessage = sanitize(input.newMessage);

  const transcriptChars =
    transcript.reduce((total, message) => total + message.content.length, 0) + newMessage.length;

  const prompt = renderArchitectPrompt({
    projectName: sanitize(input.projectName),
    instructionDocuments: bundle.instructionDocuments,
    contextDocuments: bundle.contextDocuments,
    projectMemory: bundle.projectMemory,
    recentTasks: bundle.recentTasks,
    availableDocuments: bundle.availableDocuments,
    transcript,
    newMessage,
  });

  return {
    manifest: bundle.manifest,
    prompt,
    availableDocuments: bundle.availableDocuments,
    contextFingerprint: architectContextFingerprint(bundle),
    transcriptChars,
    transcriptTooLarge: transcriptChars > ARCHITECT_LIMITS.transcript,
    inputHash: architectInputHash({
      promptVersion: ARCHITECT_PROMPT_VERSION,
      model: input.model,
      instructions: prompt.instructions,
      input: prompt.input,
      manifest: bundle.manifest,
    }),
  };
}
