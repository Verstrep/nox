/**
 * Preparation d'une analyse de review : bundle, prompt, empreinte.
 *
 * Ce module ne joint ni le runner, ni le fournisseur, ni la base. Il assemble ce
 * qu'on lui donne et rend **exactement** ce qui partira.
 *
 * ## Un seul pipeline, pour la preview comme pour l'envoi
 *
 * `Analyze with Architect` affiche le resultat de cette fonction ; `Analyze
 * review` envoie le resultat de cette meme fonction. Il n'existe pas un
 * constructeur d'apercu et un constructeur de requete — deux implementations
 * finiraient par diverger, et la divergence serait invisible jusqu'au jour ou
 * elle compterait.
 */

import {
  ARCHITECT_REVIEW_PROMPT_VERSION,
  ARCHITECT_REVIEW_SCHEMA_VERSION,
  renderArchitectReviewPrompt,
  type ArchitectReviewPrompt,
} from "@nox/shared";
import { createHash } from "node:crypto";

import {
  buildArchitectReviewBundle,
  type ArchitectReviewRun,
  type ArchitectReviewSnapshot,
  type BuiltArchitectReview,
} from "./review-bundle.ts";
import { createArchitectPatchSanitizer, createArchitectSanitizer } from "./sanitize.ts";
import type { DevelopmentTaskDetail } from "@nox/shared";

export type PrepareArchitectReviewInput = {
  runId: string;
  task: DevelopmentTaskDetail;
  run: ArchitectReviewRun;
  review: ArchitectReviewSnapshot;
  /** Racine du repository, pour rendre les chemins relatifs. Jamais transmise. */
  repositoryPath: string;
  /** Modele lu dans la configuration serveur ; entre dans l'empreinte d'entree. */
  model: string;
  environment: Record<string, string | undefined>;
};

export type PreparedArchitectReview = BuiltArchitectReview & {
  prompt: ArchitectReviewPrompt;
  /** Empreinte deterministe de l'entree logique. Diagnostic, jamais securite. */
  inputHash: string;
};

/**
 * Empreinte de l'entree logique d'une analyse.
 *
 * Couvre la version du contrat, celle du prompt, le modele, le texte reellement
 * envoye et le manifest. Chaque champ est precede de sa longueur, sans quoi deux
 * entrees differentes pourraient produire la meme empreinte par simple
 * deplacement d'une frontiere.
 *
 * **Ce n'est pas un mecanisme de securite.** Elle sert a comparer deux analyses
 * du meme run — « ont-elles vu la meme chose ? » —, et a refuser un envoi qui ne
 * correspondrait plus a l'apercu. Aucune autorisation ne s'y appuie.
 */
export function architectReviewInputHash(parts: {
  schemaVersion: number;
  promptVersion: string;
  model: string;
  instructions: string;
  input: string;
  manifest: unknown;
}): string {
  const hash = createHash("sha256");
  const field = (value: string): void => {
    hash.update(String(value.length));
    hash.update(" ");
    hash.update(value, "utf8");
    hash.update(" ");
  };

  field(String(parts.schemaVersion));
  field(parts.promptVersion);
  field(parts.model);
  field(parts.instructions);
  field(parts.input);
  field(JSON.stringify(parts.manifest));

  return hash.digest("hex");
}

/**
 * Assemble le bundle, le prompt et l'empreinte d'une analyse.
 *
 * Deux nettoyeurs, parce qu'il y a deux natures de texte. La prose — titre,
 * objectif, criteres, resumes de commande — traverse le nettoyeur de contexte.
 * Les patches traversent celui qui preserve la structure d'un diff : reecrire un
 * chemin dans un diff produirait un diff faux, et un relecteur ne doit jamais
 * lire un diff que personne n'a produit.
 */
export function prepareArchitectReview(
  input: PrepareArchitectReviewInput,
): PreparedArchitectReview {
  const options = { repositoryRoot: input.repositoryPath, environment: input.environment };

  const built = buildArchitectReviewBundle({
    runId: input.runId,
    task: input.task,
    run: input.run,
    review: input.review,
    sanitize: createArchitectSanitizer(options),
    sanitizePatch: createArchitectPatchSanitizer(options),
  });

  const prompt = renderArchitectReviewPrompt(built.bundle);

  return {
    ...built,
    prompt,
    inputHash: architectReviewInputHash({
      schemaVersion: ARCHITECT_REVIEW_SCHEMA_VERSION,
      promptVersion: ARCHITECT_REVIEW_PROMPT_VERSION,
      model: input.model,
      instructions: prompt.instructions,
      input: prompt.input,
      manifest: built.manifest,
    }),
  };
}
