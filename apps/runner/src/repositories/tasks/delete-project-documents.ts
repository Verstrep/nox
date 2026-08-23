/**
 * Nettoyage des documents de taches d'un projet supprime de NOX.
 *
 * ## Ce que cette route peut, et ce qu'elle ne peut pas
 *
 * Elle retire `tasks/<code>.md` pour une liste de codes que le serveur web a
 * lus en base. Elle ne peut rien faire d'autre : aucun chemin ne lui est
 * transmis, aucun dossier n'est cree ni supprime, aucun lien n'est suivi, et
 * `unlink` est le seul appel destructeur du module.
 *
 * ## La difference avec `delete-task-document.ts`
 *
 * Une seule, et elle est nommee : **une divergence de contenu n'arrete pas le
 * retrait**. La revision reste calculee et comparee — un document modifie a la
 * main est rapporte `REMOVED_MODIFIED`, jamais confondu avec un retrait
 * ordinaire — mais elle ne decide plus. Elle a deja fait son travail plus tot :
 * une tache sans revision enregistree n'a pas d'artefact, donc n'entre pas dans
 * la requete, donc le fichier qui occuperait son chemin n'est pas touche.
 *
 * C'est pour cela que le module est separe plutot que pilote par un drapeau : la
 * garantie d'une suppression de fichier ne doit pas dependre d'un booleen.
 *
 * ## Ce que le refus preserve
 *
 * Un lien symbolique, un dossier, une erreur systeme : l'entree est rapportee
 * `REFUSED` et rien n'est touche. Le serveur web en fait un refus global — il
 * vaut mieux un projet non supprime que des artefacts orphelins que plus rien
 * ne designe.
 */

import type { Stats } from "node:fs";
import { lstat, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import {
  RUNNER_ERROR,
  TASK_ARTIFACT_OUTCOME,
  isTaskCode,
  taskDocumentPath,
  type ProjectTaskArtifact,
  type RunnerErrorCode,
  type TaskArtifactReport,
} from "@nox/shared";

import { MAX_DOCUMENT_BYTES } from "../documents/constants.ts";
import type { DeleteFileHooks } from "../documents/delete-document.ts";
import { resolveRepositoryRoot } from "../documents/repository-root.ts";
import { computeRevision, isValidRevisionFormat, revisionsMatch } from "../documents/revisions.ts";
import { inspectTasksDirectory } from "./tasks-directory.ts";

export type DeleteProjectDocumentsResult =
  | { ok: true; documents: TaskArtifactReport[] }
  | { ok: false; code: RunnerErrorCode };

export type DeleteProjectDocumentsOptions = {
  maxBytes?: number;
  deleteHooks?: DeleteFileHooks;
};

async function lstatOrNull(target: string): Promise<Stats | null> {
  try {
    return await lstat(target);
  } catch {
    return null;
  }
}

/**
 * Retire les documents des taches d'un projet.
 *
 * Le repository et le dossier `tasks/` sont resolus une seule fois : les codes
 * appartiennent tous au meme projet, et les revalider a chaque entree ne dirait
 * rien de plus.
 */
export async function deleteProjectTaskDocuments(
  repositoryPath: string,
  artifacts: readonly ProjectTaskArtifact[],
  options: DeleteProjectDocumentsOptions = {},
): Promise<DeleteProjectDocumentsResult> {
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;
  const removeFile = options.deleteHooks?.unlink ?? unlink;

  // La forme des codes est verifiee avant tout acces au disque : une seule
  // entree douteuse condamne la requete entiere, plutot que d'ouvrir un
  // nettoyage partiel dont personne ne saurait ce qu'il a fait.
  for (const artifact of artifacts) {
    if (!isTaskCode(artifact.taskCode)) {
      return { ok: false, code: RUNNER_ERROR.TASK_CODE_INVALID };
    }
    if (!isValidRevisionFormat(artifact.expectedRevision)) {
      return { ok: false, code: RUNNER_ERROR.DOCUMENT_REVISION_INVALID };
    }
  }

  const repository = resolveRepositoryRoot(repositoryPath);
  if (!repository.ok) {
    return repository;
  }

  const directory = await inspectTasksDirectory(repository.root);
  if (!directory.ok) {
    return directory;
  }

  const documents: TaskArtifactReport[] = [];

  // Pas de dossier `tasks/` : plus rien a retirer, et NOX ne le cree surtout pas
  // pour le constater.
  if (!directory.present) {
    for (const artifact of artifacts) {
      documents.push({
        taskCode: artifact.taskCode,
        path: taskDocumentPath(artifact.taskCode),
        outcome: TASK_ARTIFACT_OUTCOME.ABSENT,
      });
    }
    return { ok: true, documents };
  }

  for (const artifact of artifacts) {
    documents.push(
      await removeOne(
        directory.directory,
        artifact,
        maxBytes,
        removeFile,
      ),
    );
  }

  return { ok: true, documents };
}

/** Traite un artefact, et n'echoue jamais : son sort est une donnee. */
async function removeOne(
  tasksDirectory: string,
  artifact: ProjectTaskArtifact,
  maxBytes: number,
  removeFile: (target: string) => Promise<void>,
): Promise<TaskArtifactReport> {
  const relativePath = taskDocumentPath(artifact.taskCode);
  const target = path.join(tasksDirectory, `${artifact.taskCode}.md`);

  const report = (outcome: TaskArtifactReport["outcome"]): TaskArtifactReport => ({
    taskCode: artifact.taskCode,
    path: relativePath,
    outcome,
  });

  const stats = await lstatOrNull(target);
  if (stats === null) {
    return report(TASK_ARTIFACT_OUTCOME.ABSENT);
  }

  // Un lien ou un dossier n'est jamais retire, meme pour un projet supprime :
  // NOX ne saurait pas dire ce qui disparait vraiment.
  if (stats.isSymbolicLink() || !stats.isFile()) {
    return report(TASK_ARTIFACT_OUTCOME.REFUSED);
  }

  // La revision est calculee pour **dire** si le document avait diverge, pas
  // pour decider s'il part. Un fichier trop gros pour etre relu est traite comme
  // divergent : NOX ne peut pas affirmer qu'il est intact.
  let modified = false;
  try {
    const currentBytes = await readFile(target);
    modified =
      currentBytes.byteLength > maxBytes ||
      !revisionsMatch(computeRevision(currentBytes), artifact.expectedRevision);
  } catch {
    return report(TASK_ARTIFACT_OUTCOME.REFUSED);
  }

  // Dernier controle au plus pres de la suppression, comme dans les deux autres
  // routes d'ecriture : la fenetre ne se ferme pas, mais `unlink` ne suit aucun
  // lien apparu entre-temps.
  const lateStats = await lstatOrNull(target);
  if (lateStats === null) {
    return report(TASK_ARTIFACT_OUTCOME.ABSENT);
  }
  if (lateStats.isSymbolicLink() || !lateStats.isFile()) {
    return report(TASK_ARTIFACT_OUTCOME.REFUSED);
  }

  try {
    await removeFile(target);
  } catch {
    return report(TASK_ARTIFACT_OUTCOME.REFUSED);
  }

  // Confirmation reelle : NOX n'annonce un retrait qu'apres avoir constate
  // l'absence du fichier.
  if ((await lstatOrNull(target)) !== null) {
    return report(TASK_ARTIFACT_OUTCOME.REFUSED);
  }

  return report(
    modified ? TASK_ARTIFACT_OUTCOME.REMOVED_MODIFIED : TASK_ARTIFACT_OUTCOME.REMOVED,
  );
}
