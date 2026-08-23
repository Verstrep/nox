/**
 * Logique de la suppression d'un projet, hors Server Action.
 *
 * Comme `task-delete.ts`, ce module n'importe ni Prisma, ni Next.js, ni React :
 * il est testable directement, ce qu'une Server Action n'est pas sans demarrer
 * l'application. Il ne touche ni au disque, ni a la base — il decide des
 * questions metier et formule les phrases.
 *
 * ## La distinction que tout ce fichier existe pour tenir
 *
 * « Supprimer un projet » veut dire supprimer ce que NOX en sait. Jamais le
 * logiciel. Le repository, son code, son `.git`, sa documentation et ses
 * fichiers arbitraires appartiennent a l'utilisateur, et lui restent. Les seuls
 * fichiers retires sont ceux que NOX y a lui-meme ecrits : les documents
 * `tasks/TASK-xxx.md` des taches de ce projet, reconnus par la revision
 * enregistree en base.
 *
 * Les textes ci-dessous existent pour que cette distinction soit lue avant le
 * clic, pas apres.
 */

import {
  TASK_ARTIFACT_OUTCOME,
  projectDeletionConfirmed,
  type TaskArtifactReport,
} from "@nox/shared";

/** Ce que NOX retire, dit avant le clic. */
export const PROJECT_DELETE_REMOVES = [
  "la conversation Architecte du projet, ses propositions et ses analyses",
  "son Project Brief, son Living V1 Plan et sa mémoire",
  "son backlog, ses tâches, leurs dépendances et leurs exécutions",
  "les documents tasks/TASK-xxx.md que NOX a écrits dans le repository",
] as const;

/** Ce que NOX ne touche pas, dit avec la meme insistance. */
export const PROJECT_DELETE_PRESERVES = [
  "le code source, package.json, src/ et tout fichier du repository",
  "le dossier .git, ses branches, ses commits et son dépôt distant",
  "la documentation applicative, y compris docs/ et CLAUDE.md",
  "les fichiers nommés TASK-xxx.md que NOX n'a pas écrits",
] as const;

export const PROJECT_DELETE_NO_GIT_NOTICE =
  "Aucun commit, aucun push, aucun git add, aucun reset, aucun restore. Retirer les documents " +
  "de tâches peut rendre le repository « dirty » : c'est à vous de décider ce que Git en fait.";

export const PROJECT_DELETE_IRREVERSIBLE_NOTICE =
  "Cette action est irréversible côté NOX. Le repository restant intact, vous pourrez le " +
  "réenregistrer comme un nouveau projet — mais sa conversation, son brief, son plan, sa " +
  "mémoire, ses tâches et ses exécutions ne seront pas reconstruits.";

export const PROJECT_CONFIRMATION_MISMATCH_MESSAGE =
  "Le nom saisi ne correspond pas à celui du projet. Recopiez-le exactement pour confirmer la " +
  "suppression.";

export const PROJECT_ACTIVE_RUN_MESSAGE =
  "Une exécution de Claude Code est en cours sur ce projet. Arrêtez-la ou attendez sa fin avant " +
  "de supprimer le projet : NOX ne l'annule pas à votre place.";

export const PROJECT_UNKNOWN_MESSAGE =
  "Ce projet n'existe plus. Revenez au tableau de bord pour voir la liste à jour.";

/**
 * Refus lorsqu'un artefact n'a pas pu etre retire.
 *
 * L'issue dangereuse serait l'inverse : un projet efface de la base, et des
 * `tasks/TASK-xxx.md` laisses derriere lui sans que plus rien ne sache a qui ils
 * appartenaient. NOX prefere donc refuser la suppression entiere, et le dire.
 */
export function artifactCleanupRefusedMessage(reports: readonly TaskArtifactReport[]): string {
  const refused = reports
    .filter((report) => report.outcome === TASK_ARTIFACT_OUTCOME.REFUSED)
    .map((report) => report.path);
  return (
    "NOX n'a pas pu retirer " +
    `${refused.length === 1 ? "le document" : "les documents"} ${refused.join(", ")}. ` +
    "Le projet n'a donc pas été supprimé : NOX préfère un refus à une suppression partielle qui " +
    "laisserait des documents que plus rien ne rattacherait à un projet. Vérifiez ces fichiers " +
    "— un lien symbolique ou un dossier occupe peut-être leur chemin — puis réessayez."
  );
}

/**
 * Etat relu en base au moment de la suppression.
 *
 * Aucune de ces valeurs ne vient du navigateur : le nom sert a comparer la
 * confirmation, `hasActiveRun` est relu juste avant d'agir.
 */
export type ProjectDeletionCheckInput = {
  projectName: string;
  hasActiveRun: boolean;
};

export type ProjectDeletionCheck = { ok: true } | { ok: false; message: string };

/**
 * Verifie qu'une suppression peut commencer.
 *
 * L'ordre compte : la confirmation d'abord, l'execution ensuite. Apprendre a
 * quelqu'un qu'une execution tourne alors qu'il a mal recopie le nom lui ferait
 * corriger la mauvaise chose — et lui laisserait croire que le nom etait bon.
 */
export function checkProjectDeletion(
  input: ProjectDeletionCheckInput,
  typedName: string,
): ProjectDeletionCheck {
  if (!projectDeletionConfirmed(input.projectName, typedName)) {
    return { ok: false, message: PROJECT_CONFIRMATION_MISMATCH_MESSAGE };
  }
  if (input.hasActiveRun) {
    return { ok: false, message: PROJECT_ACTIVE_RUN_MESSAGE };
  }
  return { ok: true };
}

/**
 * Confirmation affichee apres coup, sur le tableau de bord.
 *
 * Elle dit trois choses, dans cet ordre : le projet est parti, les fichiers du
 * repository sont restes, et voila ce que NOX a retire du disque. La derniere
 * partie disparait quand il n'y avait rien a retirer — annoncer « 0 document
 * nettoyé » ferait douter de la deuxieme.
 *
 * Elle est **reconstruite** a partir de deux nombres, jamais transportee comme
 * texte : la redirection ne porte que des compteurs, et une URL forgee ne peut
 * donc pas faire afficher une phrase arbitraire par NOX.
 */
export function projectDeletedNotice(removed: number, modified: number): string {
  let message = "Project deleted from NOX. Les fichiers du repository ont été préservés.";

  if (removed === 1) {
    message += " 1 document de tâche écrit par NOX a été retiré.";
  } else if (removed > 1) {
    message += ` ${String(removed)} documents de tâche écrits par NOX ont été retirés.`;
  }

  if (modified === 1) {
    message +=
      " L'un d'eux avait été modifié à la main : la suppression ayant été explicitement " +
      "confirmée, il a été retiré lui aussi.";
  } else if (modified > 1) {
    message +=
      ` ${String(modified)} d'entre eux avaient été modifiés à la main : la suppression ayant ` +
      "été explicitement confirmée, ils ont été retirés eux aussi.";
  }

  return message;
}

/**
 * Lit un compteur de la redirection.
 *
 * Une valeur absente, negative, non entiere ou farfelue vaut zero : un lien
 * errone ne doit produire ni page d'erreur, ni chiffre invente.
 */
export function readDeletedCount(value: string | string[] | undefined): number {
  // La chaine entiere doit etre une suite de chiffres : `Number.parseInt` lirait
  // « 1.5 » comme 1 et « 12abc » comme 12, ce qui inventerait un chiffre a
  // partir d'une valeur qui n'en est pas un.
  if (typeof value !== "string" || !/^\d{1,4}$/u.test(value)) {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : 0;
}

/** URL de la surface de reglages d'un projet. */
export function projectSettingsUrl(projectId: string): string {
  return `/projects/${projectId}/settings`;
}
