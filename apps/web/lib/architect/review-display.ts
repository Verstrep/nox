/**
 * Presentation de la review Architecte, sans React.
 *
 * Fonctions pures : URL, eligibilite, lignes de preview. Aucune ne lit la base,
 * le disque ni le fournisseur — et ce sont les memes qui decident de l'affichage
 * d'un bouton et du message qui le remplace quand il n'y en a pas. Deux
 * implementations divergeraient, et c'est l'interface qui aurait raison a tort.
 *
 * Les libelles, eux, vivent dans `lib/labels.ts`.
 */

import {
  ARCHITECT_REVIEW_LIMITS,
  REVIEW_PATCH_STATE,
  isFinalRunStatus,
  type ArchitectReviewBundle,
  type ReviewPatchState,
  type ReviewPromptFile,
  type RunStatus,
} from "@nox/shared";

/** Page de preparation d'une analyse de review. */
export function architectReviewUrl(projectId: string, taskId: string, runId: string): string {
  return `/projects/${projectId}/tasks/${taskId}/runs/${runId}/architect-review`;
}

/** Page d'une analyse enregistree. */
export function architectAnalysisUrl(
  projectId: string,
  taskId: string,
  runId: string,
  analysisId: string,
): string {
  return `${architectReviewUrl(projectId, taskId, runId)}/${analysisId}`;
}

/**
 * Pourquoi cette execution peut — ou ne peut pas — etre analysee.
 *
 * `legacy` et `active` disent deux choses differentes, et les confondre
 * ferait attendre une review qui n'arrivera jamais.
 */
export type ArchitectReviewEligibility = "eligible" | "active" | "legacy";

export function architectReviewEligibility(
  status: RunStatus,
  reviewCapturedAt: string | null,
): ArchitectReviewEligibility {
  if (reviewCapturedAt !== null) {
    return "eligible";
  }
  return isFinalRunStatus(status) ? "legacy" : "active";
}

const INELIGIBLE_MESSAGES: Record<Exclude<ArchitectReviewEligibility, "eligible">, string> = {
  active:
    "Cette execution n'est pas terminee. L'architecte analyse une review enregistree, pas un travail en cours.",
  legacy:
    "Cette execution ne possede pas de snapshot de review suffisamment detaille pour une analyse Architecte.",
};

export function architectReviewIneligibleMessage(
  eligibility: Exclude<ArchitectReviewEligibility, "eligible">,
): string {
  return INELIGIBLE_MESSAGES[eligibility];
}

/**
 * Sort d'un fichier dans le bundle, tel que la preview l'affiche.
 *
 * Reprend exactement les etats du prompt : ce que l'utilisateur lit avant de
 * cliquer est ce que le modele lira. Une preview qui resumerait autrement
 * finirait par decrire un envoi different de celui qui part.
 */
export type ArchitectReviewFileRow = {
  path: string;
  changeType: string;
  patchState: ReviewPatchState;
  /** Caracteres de diff reellement transmis pour ce fichier. */
  chars: number;
};

export function bundleFileRows(bundle: ArchitectReviewBundle): ArchitectReviewFileRow[] {
  return bundle.files.map((file: ReviewPromptFile) => ({
    path: file.path,
    changeType: file.changeType,
    patchState: file.patchState,
    chars: file.patch?.length ?? 0,
  }));
}

/** Vrai lorsque le contenu de ce fichier n'a pas quitte la machine. */
export function isPatchWithheld(state: ReviewPatchState): boolean {
  return state !== REVIEW_PATCH_STATE.INCLUDED && state !== REVIEW_PATCH_STATE.TRUNCATED;
}

/** Bornes affichees dans la section « Limits » de la preview. */
export type ArchitectReviewLimitsRow = {
  filesAvailable: number;
  filesIncluded: number;
  patchChars: number;
  patchLimit: number;
  truncated: boolean;
  omittedFiles: number;
};

export function bundleLimits(
  bundle: ArchitectReviewBundle,
  patchCharsIncluded: number,
): ArchitectReviewLimitsRow {
  return {
    filesAvailable: bundle.fileCountAvailable,
    filesIncluded: bundle.files.length,
    patchChars: patchCharsIncluded,
    patchLimit: ARCHITECT_REVIEW_LIMITS.patchTotal,
    truncated: bundle.truncated,
    omittedFiles: bundle.omittedFiles,
  };
}

/**
 * Phrase de confidentialite affichee avant tout appel.
 *
 * Elle decrit **exactement** ce que le bundle contient : ni plus rassurant, ni
 * plus vague. Un texte qui promettrait moins que ce qui part serait pire que
 * pas de texte du tout.
 */
export const ARCHITECT_REVIEW_PRIVACY_NOTICE =
  "La specification de la tache, les patches non sensibles inclus dans cette review et les " +
  "resultats de validation listes ci-dessous seront envoyes a OpenAI pour obtenir une seconde " +
  "lecture. Les contenus sensibles et binaires masques ne sont pas envoyes.";
