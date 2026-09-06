/**
 * Assemblage du prompt de correction, a un seul endroit.
 *
 * ## Pourquoi cette fonction existe
 *
 * Quatre surfaces construisent le meme prompt : les trois pages de preparation,
 * qui l'affichent avec son empreinte, et `correction-launch.ts`, qui l'envoie.
 * Elles doivent produire le **meme texte**, sinon l'ecran montre un prompt et la
 * session en recoit un autre — et l'empreinte affichee cesse de prouver quoi que
 * ce soit.
 *
 * HOTFIX-006 a paye cette lecon sur un autre objet : `ResumeCandidate` etait
 * assemble a la main sur huit surfaces, il a suffi d'y oublier un champ pour
 * qu'une page refuse ce que le lancement acceptait. Le supplement de source de
 * HOTFIX-007 est exactement le meme genre de champ optionnel — celui qu'on
 * oublie sur trois surfaces sur quatre.
 *
 * ## Ce qu'elle lit
 *
 * Uniquement SQLite, et seulement pour un amorcage : la relecture de l'etat
 * structure du projet est court-circuitee des la premiere ligne pour toute autre
 * tache. Aucun runner, aucun fournisseur, aucun acces au repository.
 */

import type { DevelopmentTaskDetail } from "@nox/shared";
import type { DatabaseClient } from "@nox/database";

import { loadBootstrapSourceSupplement } from "./bootstrap/source-supplement.ts";
import type { BootstrapSupplementOutcome } from "./bootstrap/source-recovery.ts";
import { buildCorrectionPrompt, type ExecutionPrompt } from "./run-prompt.ts";

export type CorrectionPromptRequest = {
  task: DevelopmentTaskDetail;
  project: { id: string; repositoryPath: string };
  /** Code de l'execution relue : `RUN-002`. */
  sourceRunCode: string;
  /** Texte humain, ou `null` quand les preuves de NOX suffisent. */
  feedback: string | null;
  /** Contrat gele deja rendu. */
  contract: string | null;
  /** Preuves deja rendues et bornees. */
  evidence: string | null;
  environment: Record<string, string | undefined>;
};

export type CorrectionPromptResult = ExecutionPrompt & {
  /**
   * Ce que NOX a decide du supplement de source, refus compris.
   *
   * Rendu a l'appelant plutot que garde pour lui : une page doit pouvoir dire
   * « la source du projet a change depuis la creation de cette tache », qui est
   * une information, pas un incident.
   */
  supplement: BootstrapSupplementOutcome;
};

/** Le prompt d'une correction, et le sort de son supplement de source. */
export async function buildCorrectionPromptFor(
  db: DatabaseClient,
  request: CorrectionPromptRequest,
): Promise<CorrectionPromptResult> {
  const supplement = await loadBootstrapSourceSupplement(db, {
    task: request.task,
    project: request.project,
    environment: request.environment,
  });

  const built = buildCorrectionPrompt({
    task: request.task,
    sourceRunCode: request.sourceRunCode,
    feedback: request.feedback,
    contract: request.contract,
    sourceSupplement: supplement.ok ? supplement.supplement : null,
    evidence: request.evidence,
  });

  return { ...built, supplement };
}
