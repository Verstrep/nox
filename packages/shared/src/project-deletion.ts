/**
 * Semantique de la suppression d'un projet dans NOX.
 *
 * ## Ce que ce module dit, et ce qu'il ne dit pas
 *
 * Supprimer un projet, c'est supprimer **ce que NOX en sait** : sa
 * conversation, son brief, son plan, sa memoire, ses taches, ses executions.
 * Ce n'est jamais supprimer le logiciel. Le repository appartient a
 * l'utilisateur, et il lui survit entierement — code, `.git`, documentation,
 * fichiers arbitraires.
 *
 * La seule chose que NOX retire du disque est ce qu'il y a lui-meme ecrit : les
 * documents `tasks/TASK-xxx.md` des taches de ce projet. Il ne les cherche pas,
 * il les **connait** : chaque tache porte en base la revision du fichier que
 * NOX y a ecrit, et c'est cette revision qui fait la preuve d'appartenance.
 *
 * Ce module est pur : ni base, ni disque, ni reseau, ni React. Il porte le
 * vocabulaire commun au web, au runner et aux tests.
 */

/** Refus possibles d'une suppression de projet. */
export const PROJECT_DELETION_ERROR = {
  /** Le projet n'existe pas, ou n'existe plus. */
  UNKNOWN_PROJECT: "PROJECT_NOT_FOUND",
  /** Le nom saisi ne correspond pas a celui du projet. */
  CONFIRMATION_MISMATCH: "PROJECT_DELETE_CONFIRMATION_MISMATCH",
  /** Une execution de Claude Code est en cours sur une tache de ce projet. */
  ACTIVE_RUN: "PROJECT_HAS_ACTIVE_RUN",
  /** Le runner n'a pas pu retirer un artefact que NOX sait lui appartenir. */
  ARTIFACT_REFUSED: "PROJECT_ARTIFACT_CLEANUP_FAILED",
  /** Le repository ne repond pas : NOX ne peut pas nettoyer ce qu'il y a ecrit. */
  REPOSITORY_UNAVAILABLE: "PROJECT_REPOSITORY_UNAVAILABLE",
} as const;

export type ProjectDeletionErrorCode =
  (typeof PROJECT_DELETION_ERROR)[keyof typeof PROJECT_DELETION_ERROR];

/**
 * Sort d'un artefact de tache pendant le nettoyage.
 *
 * Quatre issues, et les quatre sont dites. « Supprime » et « deja absent » sont
 * deux reussites differentes ; « supprime alors qu'il avait diverge » est une
 * reussite qui merite d'etre annoncee ; « refuse » interdit d'affirmer que le
 * projet a ete supprime.
 */
export const TASK_ARTIFACT_OUTCOME = {
  /** Le fichier etait celui que NOX avait ecrit, et il a ete retire. */
  REMOVED: "REMOVED",
  /** Le fichier avait ete modifie a la main, et il a ete retire quand meme. */
  REMOVED_MODIFIED: "REMOVED_MODIFIED",
  /** Plus rien a ce chemin : le resultat recherche etait deja atteint. */
  ABSENT: "ABSENT",
  /** Rien n'a ete touche : lien symbolique, dossier, ou echec systeme. */
  REFUSED: "REFUSED",
} as const;

export type TaskArtifactOutcome =
  (typeof TASK_ARTIFACT_OUTCOME)[keyof typeof TASK_ARTIFACT_OUTCOME];

/** Un artefact retire, tel que le runner le rapporte. */
export type TaskArtifactReport = {
  taskCode: string;
  /** Chemin relatif, derive du code cote runner. Jamais un chemin absolu. */
  path: string;
  outcome: TaskArtifactOutcome;
};

/**
 * Verifie la confirmation saisie par l'utilisateur.
 *
 * Comparaison stricte apres `trim` : ni insensibilite a la casse, ni
 * normalisation des accents. Recopier le nom exact est precisement ce qui
 * distingue un geste delibere d'un clic.
 */
export function projectDeletionConfirmed(projectName: string, typed: string): boolean {
  return typed.trim() === projectName.trim() && projectName.trim() !== "";
}

/** Un artefact refuse interdit d'annoncer une suppression. */
export function hasRefusedArtifact(reports: readonly TaskArtifactReport[]): boolean {
  return reports.some((report) => report.outcome === TASK_ARTIFACT_OUTCOME.REFUSED);
}

/** Nombre d'artefacts reellement retires du disque, divergences comprises. */
export function countRemovedArtifacts(reports: readonly TaskArtifactReport[]): number {
  return reports.filter(
    (report) =>
      report.outcome === TASK_ARTIFACT_OUTCOME.REMOVED ||
      report.outcome === TASK_ARTIFACT_OUTCOME.REMOVED_MODIFIED,
  ).length;
}

/** Nombre d'artefacts retires alors que leur contenu avait diverge. */
export function countModifiedArtifacts(reports: readonly TaskArtifactReport[]): number {
  return reports.filter((report) => report.outcome === TASK_ARTIFACT_OUTCOME.REMOVED_MODIFIED)
    .length;
}
