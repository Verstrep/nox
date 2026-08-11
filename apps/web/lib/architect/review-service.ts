/**
 * Orchestration d'une analyse de review, cote serveur.
 *
 * ## Deux clics, et pourquoi
 *
 * ```text
 * Analyze with Architect   ← aucun appel au fournisseur
 *        ↓
 * bundle assemble, preview affichee, empreinte calculee
 *        ↓
 * Analyze review           ← un clic, un appel
 *        ↓
 * bundle RECONSTRUIT et empreinte recomparee
 *        ↓
 * analyse reservee              ← le verrou : une a la fois
 *        ↓
 * appel au fournisseur
 *        ↓
 * validation NOX de la reponse
 *        ↓
 * garde NOX : verdict du fournisseur → verdict final
 *        ↓
 * analyse conclue et persistee
 * ```
 *
 * ## Pourquoi le controle final differe de celui de TASK-014
 *
 * Une conversation relit le repository a chaque tour : le contexte peut avoir
 * change entre l'apercu et le clic, et c'est un cas **courant**. Une review, elle,
 * est immuable en base — le controle d'empreinte est ici un garde-fou, pas un
 * evenement attendu. S'il declenche, c'est qu'un invariant de TASK-011 a cede,
 * et le bon comportement est alors de ne rien envoyer plutot que d'envoyer autre
 * chose que ce qui a ete relu.
 *
 * ## Ce que cette analyse ne peut pas faire
 *
 * Elle ne change aucun statut, ne cree aucun `ReviewFeedback`, ne lance aucune
 * correction et n'approuve rien. Ce module n'importe aucune fonction d'action de
 * tache — et c'est une propriete verifiable, pas une intention.
 */

import {
  ARCHITECT_ERROR,
  ARCHITECT_REVIEW_SCHEMA_NAME,
  ARCHITECT_REVIEW_STATUS,
  buildArchitectReviewSchema,
  guardArchitectReviewVerdict,
  readArchitectReviewOutput,
  type ArchitectErrorCode,
  type ArchitectReviewGuardResult,
  type ArchitectReviewOutput,
} from "@nox/shared";
import {
  finishArchitectRunReview,
  startArchitectRunReview,
  type ArchitectRunReviewView,
  type DatabaseClient,
} from "@nox/database";

import { ARCHITECT_REQUEST_TIMEOUT_MS } from "./config.ts";
import type { ArchitectProvider } from "./provider.ts";
import {
  prepareArchitectReview,
  type PrepareArchitectReviewInput,
  type PreparedArchitectReview,
} from "./review-prepare.ts";

export type AnalyzeArchitectReviewInput = PrepareArchitectReviewInput & {
  provider: ArchitectProvider;
  /**
   * Empreinte affichee par la preview.
   *
   * Le seul champ que le navigateur transporte, et il ne peut qu'**empecher**
   * un envoi : une valeur inconnue produit un refus, jamais une acceptation. Le
   * bundle, lui, est integralement reconstruit ici a partir de la base.
   */
  expectedInputHash: string;
};

export type AnalyzeArchitectReviewOutcome =
  | {
      ok: true;
      analysis: ArchitectRunReviewView;
      output: ArchitectReviewOutput;
      guard: ArchitectReviewGuardResult;
    }
  | { ok: false; code: ArchitectErrorCode };

/** Traduit un refus de reservation en code stable. */
function reservationCode(reason: "not_found" | "active" | "limit"): ArchitectErrorCode {
  switch (reason) {
    case "active":
      return ARCHITECT_ERROR.ARCHITECT_REVIEW_ACTIVE;
    case "limit":
      return ARCHITECT_ERROR.ARCHITECT_REVIEW_LIMIT;
    default:
      return ARCHITECT_ERROR.ARCHITECT_REVIEW_UNAVAILABLE;
  }
}

/**
 * Analyse la review d'une execution.
 *
 * Ne leve jamais : toute panne devient un code, et l'analyse reservee est
 * conclue en base dans **tous** les cas. Une analyse laissee `RUNNING`
 * bloquerait l'execution pour toujours, puisque c'est elle qui porte le verrou.
 */
export async function analyzeArchitectReview(
  db: DatabaseClient,
  input: AnalyzeArchitectReviewInput,
): Promise<AnalyzeArchitectReviewOutcome> {
  // Le bundle est reconstruit maintenant, et non repris de la preview : c'est
  // la seule facon de savoir ce qui part vraiment.
  const prepared: PreparedArchitectReview = prepareArchitectReview(input);

  if (prepared.inputHash !== input.expectedInputHash) {
    // Aucun appel, aucune analyse reservee, aucun quota consomme.
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_REVIEW_CHANGED };
  }

  const reserved = await startArchitectRunReview(db, {
    runId: input.runId,
    model: input.model,
    promptVersion: prepared.prompt.version,
    inputHash: prepared.inputHash,
    manifest: prepared.manifest,
  });
  if (!reserved.ok) {
    return { ok: false, code: reservationCode(reserved.reason) };
  }

  const analysisId = reserved.analysis.id;

  /** Conclut l'analyse en echec, sans jamais laisser le verrou pose. */
  const fail = async (code: ArchitectErrorCode): Promise<AnalyzeArchitectReviewOutcome> => {
    await finishArchitectRunReview(db, {
      analysisId,
      status:
        code === ARCHITECT_ERROR.ARCHITECT_REFUSED
          ? ARCHITECT_REVIEW_STATUS.REFUSED
          : ARCHITECT_REVIEW_STATUS.FAILED,
      errorCode: code,
    });
    return { ok: false, code };
  };

  let result;
  try {
    result = await input.provider.analyzeRunReview({
      model: input.model,
      instructions: prepared.prompt.instructions,
      input: prepared.prompt.input,
      schemaName: ARCHITECT_REVIEW_SCHEMA_NAME,
      schema: buildArchitectReviewSchema(),
      timeoutMs: ARCHITECT_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    // Une exception inattendue du fournisseur ne doit pas remonter telle quelle :
    // elle porterait son URL et ses en-tetes.
    console.error("[nox] Echec inattendu de l'analyse de review :", error);
    return fail(ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR);
  }

  if (!result.ok) {
    return fail(result.code);
  }

  const validated = readArchitectReviewOutput(result.value.raw, {
    filePaths: prepared.filePaths,
    criteriaCount: prepared.criteriaCount,
  });
  if (!validated.ok) {
    // La reponse respectait le schema strict et reste inacceptable : c'est
    // exactement le cas que la validation metier existe pour attraper.
    console.error(
      "[nox] Analyse de review refusee :",
      validated.refusal.field,
      validated.refusal.message,
    );
    await finishArchitectRunReview(db, {
      analysisId,
      status: ARCHITECT_REVIEW_STATUS.FAILED,
      providerResponseId: result.value.responseId,
      usage: result.value.usage,
      errorCode: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
    });
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID };
  }

  const output = validated.output;

  // La garde NOX : le verdict du modele est conserve tel quel, et le verdict
  // retenu peut en differer. Les faits qui l'imposent viennent de la review
  // enregistree, jamais du texte du modele — un verdict ne se justifie pas
  // lui-meme.
  const guard = guardArchitectReviewVerdict(output.verdict, prepared.facts);

  const analysis = await finishArchitectRunReview(db, {
    analysisId,
    status: ARCHITECT_REVIEW_STATUS.COMPLETED,
    providerVerdict: guard.providerVerdict,
    finalVerdict: guard.finalVerdict,
    blockers: guard.blockers,
    summary: output.summary,
    findings: output.findings,
    feedback: output.feedback,
    providerResponseId: result.value.responseId,
    usage: result.value.usage,
  });

  if (analysis === null) {
    return { ok: false, code: ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR };
  }

  return { ok: true, analysis, output, guard };
}
