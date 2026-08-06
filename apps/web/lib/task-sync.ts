/**
 * Synchronisation du document Markdown d'une tache.
 *
 * Le fichier `tasks/TASK-xxx.md` est un **export** de la specification
 * enregistree en base : SQLite reste la source de verite, Git recoit l'artefact
 * que liront les agents. Ce module decide seulement de ce qui doit arriver ; il
 * n'ecrit ni en base, ni sur le disque.
 *
 * ## Pourquoi la reprise est identique a la premiere tentative
 *
 * Il n'existe pas de chemin « premiere fois » et de chemin « reessai ». Les deux
 * appellent la meme fonction, qui tente toujours la creation exclusive et
 * n'interprete la suite qu'en fonction de ce que le disque repond. Un
 * enchainement qui commencerait par « le fichier existe-t-il ? » aurait deux
 * comportements a maintenir, et le second serait le moins teste des deux.
 *
 * ## L'adoption d'un fichier identique
 *
 * Si le chemin est deja occupe par un fichier dont le contenu correspond
 * exactement au Markdown attendu, la synchronisation est consideree comme
 * reussie. Ce cas n'a rien d'exotique : il se produit des qu'une creation a
 * abouti sur le disque mais que l'enregistrement de son succes a echoue —
 * navigateur ferme, processus arrete. Refuser d'adopter ce fichier obligerait a
 * le supprimer a la main pour sortir d'une situation ou, pourtant, tout est
 * correct.
 *
 * Un contenu different, lui, produit un conflit. NOX n'ecrase rien et ne propose
 * aucun forcage : personne ne peut choisir d'ecraser un fichier sans l'avoir vu.
 */

import { renderTaskMarkdown, type ProjectDocumentContent, type TaskSpecification } from "@nox/shared";

import { isDocumentAlreadyExists, type RunnerFailure, type RunnerResult } from "./runner/errors.ts";
import { describeRunnerFailure } from "./runner/errors.ts";

export type TaskDocumentSyncOutcome =
  | { kind: "synced"; path: string; revision: string }
  | { kind: "conflict"; message: string }
  | { kind: "error"; message: string };

/**
 * Acces au runner, injectes plutot qu'importes.
 *
 * Les tests peuvent ainsi rejouer chaque scenario — runner arrete, fichier
 * identique, fichier different — sans demarrer ni runner, ni repository.
 */
export type TaskSyncPorts = {
  createDocument: (
    repositoryPath: string,
    taskCode: string,
    content: string,
  ) => Promise<RunnerResult<ProjectDocumentContent>>;
  readDocument: (
    repositoryPath: string,
    documentPath: string,
  ) => Promise<RunnerResult<ProjectDocumentContent>>;
};

/** Tache telle que ce module en a besoin : sa specification et son chemin. */
export type SynchronizableTask = TaskSpecification & { documentPath: string };

const UNREADABLE_EXISTING_MESSAGE =
  "Un document occupe deja cet emplacement, et NOX n'a pas pu le lire pour le comparer.";

const CONFLICT_MESSAGE =
  "Un document different occupe deja cet emplacement. NOX ne l'ecrase pas : ouvrez-le pour decider quoi en faire.";

function describeError(failure: RunnerFailure): TaskDocumentSyncOutcome {
  return { kind: "error", message: describeRunnerFailure(failure) };
}

/**
 * Cree le document de la tache, ou constate ce qui occupe deja sa place.
 *
 * La tache existe deja en base quand cette fonction est appelee : aucun echec
 * ici ne la remet en cause. C'est tout l'interet de separer les deux etapes —
 * une panne du runner coute un document a recreer, jamais une specification.
 */
export async function synchronizeTaskDocument(
  repositoryPath: string,
  task: SynchronizableTask,
  ports: TaskSyncPorts,
): Promise<TaskDocumentSyncOutcome> {
  const expected = renderTaskMarkdown(task);

  const created = await ports.createDocument(repositoryPath, task.code, expected);
  if (created.ok) {
    return { kind: "synced", path: created.value.path, revision: created.value.revision };
  }

  // Tout echec autre qu'un emplacement occupe est une panne : runner arrete,
  // droits, disque. Rien a comparer, rien a adopter.
  if (!isDocumentAlreadyExists(created.failure)) {
    return describeError(created.failure);
  }

  const existing = await ports.readDocument(repositoryPath, task.documentPath);
  if (!existing.ok) {
    return { kind: "error", message: UNREADABLE_EXISTING_MESSAGE };
  }

  // Comparaison sur le texte exact, sans tolerance : le generateur est
  // deterministe, donc un ecart signale un fichier que NOX n'a pas ecrit.
  if (existing.value.content === expected) {
    return { kind: "synced", path: existing.value.path, revision: existing.value.revision };
  }

  return { kind: "conflict", message: CONFLICT_MESSAGE };
}
