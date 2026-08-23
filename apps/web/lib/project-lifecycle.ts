/**
 * Suppression et renommage d'un projet, cote serveur.
 *
 * ## L'ordre, et pourquoi il n'est pas negociable
 *
 * Le disque d'abord, la base ensuite. Cette operation traverse deux systemes
 * qui ne partagent aucune transaction, et NOX ne pretend a aucune atomicite
 * entre les deux. Le choix se resume donc a quelle incoherence on prefere :
 *
 * - **Base d'abord** : les revisions qui prouvent l'appartenance des documents
 *   disparaissent avec elle. Les `tasks/TASK-xxx.md` restent sur le disque, et
 *   plus rien — ni NOX, ni l'utilisateur — ne peut dire a quel projet ils
 *   appartenaient. Reenregistrer le meme repository ferait alors surgir des
 *   documents historiques qui n'ont plus de proprietaire.
 * - **Disque d'abord** : si le nettoyage echoue, la suppression est refusee et
 *   **rien** n'a bouge en base. L'utilisateur voit pourquoi, corrige, reessaie.
 *
 * Le second cas se repare ; le premier se decouvre des mois plus tard. C'est le
 * meme raisonnement qu'a la suppression d'une tache, applique a l'echelle du
 * projet — avec une difference : ici, un artefact refuse **annule tout**. Un
 * projet a moitie supprime est precisement l'etat qu'il faut rendre impossible.
 *
 * ## Ce que ce module ne fait jamais
 *
 * Aucun appel OpenAI, aucun Claude Code, aucune commande Git. Il ne supprime
 * aucun dossier, ne touche a aucun fichier autre que les documents de taches, et
 * n'accepte aucun chemin venu du navigateur — la liste des artefacts est
 * **reconstruite** en base a partir de l'identifiant du projet.
 */

import {
  deleteProjectState,
  getProjectById,
  listOwnedTaskArtifacts,
  projectHasActiveRun,
  renameProject,
  type DatabaseClient,
} from "@nox/database";
import {
  countModifiedArtifacts,
  countRemovedArtifacts,
  hasRefusedArtifact,
  type ProjectTaskArtifact,
  type TaskArtifactReport,
} from "@nox/shared";
import {
  PROJECT_UNKNOWN_MESSAGE,
  artifactCleanupRefusedMessage,
  checkProjectDeletion,
} from "./project-delete.ts";
import { validateProjectName } from "./project-input.ts";
import { deleteProjectTaskDocuments } from "./runner/client.ts";
import { describeRunnerFailure } from "./runner/errors.ts";
import type { RunnerResult } from "./runner/errors.ts";

/** Acces reel au runner ; remplace par une doublure dans les tests. */
export type ProjectLifecyclePorts = {
  removeArtifacts: (
    repositoryPath: string,
    artifacts: readonly ProjectTaskArtifact[],
  ) => Promise<RunnerResult<TaskArtifactReport[]>>;
};

const RUNNER_PORTS: ProjectLifecyclePorts = {
  removeArtifacts: (repositoryPath, artifacts) =>
    deleteProjectTaskDocuments(repositoryPath, artifacts),
};

const DATABASE_FAILED_MESSAGE =
  "Les documents de tâches ont bien été retirés du repository, mais l'état du projet n'a pas pu " +
  "être supprimé de la base. Consultez les logs du serveur, puis relancez la suppression : elle " +
  "reprendra sans redemander les fichiers déjà retirés.";

export type DeleteProjectOutcome =
  /**
   * Deux compteurs, pas une phrase.
   *
   * La confirmation affichee ensuite est reconstruite a partir d'eux : rien de
   * ce que l'appelant transporte ne devient du texte affichable tel quel.
   */
  | { ok: true; removed: number; modified: number }
  | { ok: false; message: string };

/**
 * Supprime un projet de NOX.
 *
 * Le navigateur ne fournit que l'identifiant du projet et le nom recopie. Tout
 * le reste — nom reel, chemin du repository, execution active, liste des
 * artefacts — est relu en base **au moment de la suppression**, jamais pris
 * dans un instantane que la page de confirmation aurait porte.
 */
export async function deleteProjectFromNox(
  db: DatabaseClient,
  projectId: string,
  typedName: string,
  ports: ProjectLifecyclePorts = RUNNER_PORTS,
): Promise<DeleteProjectOutcome> {
  const project = await getProjectById(db, projectId);
  if (project === null) {
    return { ok: false, message: PROJECT_UNKNOWN_MESSAGE };
  }

  // Revalidation au moment d'agir : un onglet ouvert hier a pu voir un autre
  // nom, et une execution a pu demarrer entre-temps.
  const check = checkProjectDeletion(
    { projectName: project.name, hasActiveRun: await projectHasActiveRun(db, project.id) },
    typedName,
  );
  if (!check.ok) {
    return { ok: false, message: check.message };
  }

  // La liste vient de la base, jamais d'un scan du repository : un fichier
  // nomme `tasks/TASK-999.md` qu'aucune tache ne revendique n'y figure pas.
  const owned = await listOwnedTaskArtifacts(db, project.id);
  const artifacts: ProjectTaskArtifact[] = owned.map((artifact) => ({
    taskCode: artifact.taskCode,
    expectedRevision: artifact.expectedRevision,
  }));

  let reports: readonly TaskArtifactReport[] = [];
  if (artifacts.length > 0) {
    const removal = await ports.removeArtifacts(project.repositoryPath, artifacts);
    if (!removal.ok) {
      // Runner arrete, repository deplace : rien n'est supprime en base.
      return { ok: false, message: describeRunnerFailure(removal.failure) };
    }
    reports = removal.value;

    if (hasRefusedArtifact(reports)) {
      return { ok: false, message: artifactCleanupRefusedMessage(reports) };
    }
  }

  try {
    const removed = await deleteProjectState(db, project.id);
    if (!removed.ok) {
      return { ok: false, message: PROJECT_UNKNOWN_MESSAGE };
    }
  } catch (error) {
    console.error("[nox] Nettoyage du repository reussi mais echec en base :", error);
    return { ok: false, message: DATABASE_FAILED_MESSAGE };
  }

  return {
    ok: true,
    removed: countRemovedArtifacts(reports),
    modified: countModifiedArtifacts(reports),
  };
}

export type RenameProjectOutcome =
  | { ok: true; changed: boolean; name: string }
  | { ok: false; message: string };

/**
 * Renomme un projet.
 *
 * Le nom NOX est de la metadata locale. Le renommer ne renomme aucun dossier,
 * ne touche pas a Git, ne reecrit ni le brief, ni le plan, ni la documentation
 * du repository, et n'appelle aucun fournisseur. Le chemin du repository, lui,
 * n'est pas modifiable : deplacer un projet est une autre question.
 */
export async function renameProjectInNox(
  db: DatabaseClient,
  projectId: string,
  rawName: string,
): Promise<RenameProjectOutcome> {
  // Exactement le validateur de la creation : il n'existe pas deux formats de
  // nom de projet, dont l'un serait le moins verifie.
  const name = validateProjectName(rawName);
  if (!name.ok) {
    return { ok: false, message: name.message };
  }

  const result = await renameProject(db, projectId, name.name);
  if (!result.ok) {
    return { ok: false, message: PROJECT_UNKNOWN_MESSAGE };
  }

  return { ok: true, changed: result.changed, name: name.name };
}
