/**
 * Preparation du dossier `tasks/` d'un repository.
 *
 * C'est la **seule** creation de dossier autorisee dans tout NOX, et elle est
 * volontairement etroite : un dossier, a la racine, dont le nom est une
 * constante de ce fichier. Rien de ce que le web envoie n'influe sur ce nom.
 *
 * ## Pourquoi une exception ici, alors que la creation de documents n'en a pas
 *
 * Un document ordinaire est range par l'utilisateur : s'il se trompe de dossier,
 * refuser lui evite une arborescence parasite. Le document d'une tache, lui, n'a
 * pas d'emplacement au choix — il vaut toujours `tasks/<code>.md`. Exiger que
 * l'utilisateur cree `tasks/` a la main avant sa premiere tache serait un
 * obstacle sans contrepartie : il n'y a aucune faute de frappe possible dans un
 * nom que NOX ecrit lui-meme.
 *
 * ## Ce qui reste refuse
 *
 * - `tasks` occupe par un **fichier** : NOX ne le supprime pas et ne renomme
 *   rien. C'est a l'utilisateur de trancher.
 * - `tasks` qui est un **lien** ou une **jonction Windows** : ecrire au travers
 *   deposerait les documents ailleurs que la ou l'utilisateur croit les ranger,
 *   et le `git status` qui suit serait incomprehensible.
 * - Un dossier reel qui, apres resolution, sort du repository.
 *
 * Aucun sous-dossier n'est jamais cree : `mkdir` est appele sans `recursive`.
 */

import type { Stats } from "node:fs";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import { RUNNER_ERROR, type RunnerErrorCode } from "@nox/shared";

import { isContainedIn } from "../documents/paths.ts";

/** Nom du dossier, constant : il ne vient jamais d'une requete. */
export const TASKS_DIRECTORY_NAME = "tasks";

/**
 * Permissions du dossier cree : traversable et lisible par tous, modifiable par
 * son proprietaire. Le bit d'execution est indispensable a un dossier — sans
 * lui, plus rien a l'interieur n'est accessible. `umask` peut encore restreindre.
 */
const NEW_DIRECTORY_MODE = 0o755;

export type TasksDirectoryResult =
  | { ok: true; directory: string }
  | { ok: false; code: RunnerErrorCode };

/**
 * Etat de `tasks/` observe sans jamais le creer.
 *
 * `present: false` n'est pas une erreur : pour une suppression, un dossier
 * absent signifie que le document recherche l'est aussi, ce qui est exactement
 * le resultat vise.
 */
export type TasksDirectoryInspection =
  | { ok: true; present: true; directory: string }
  | { ok: true; present: false }
  | { ok: false; code: RunnerErrorCode };

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "EEXIST"
  );
}

async function lstatOrNull(target: string): Promise<Stats | null> {
  try {
    return await lstat(target);
  } catch {
    return null;
  }
}

/**
 * Retourne le chemin reel de `tasks/`, en le creant s'il est absent.
 *
 * La verification de nature est faite **apres** la creation eventuelle, et non a
 * la place : entre le premier `lstat` et le `mkdir`, un autre programme peut
 * avoir cree un fichier, un lien ou un dossier a cet emplacement. Un `EEXIST`
 * n'est donc pas une reussite implicite, c'est une invitation a regarder ce qui
 * s'y trouve reellement.
 */
export async function ensureTasksDirectory(root: string): Promise<TasksDirectoryResult> {
  const target = path.join(root, TASKS_DIRECTORY_NAME);

  let stats = await lstatOrNull(target);

  if (stats === null) {
    try {
      // Sans `recursive` : un seul dossier, jamais une arborescence.
      await mkdir(target, { mode: NEW_DIRECTORY_MODE });
    } catch (error) {
      // `EEXIST` signale une creation concurrente : le dossier existe
      // desormais, ce qui est exactement le resultat recherche.
      if (!isAlreadyExistsError(error)) {
        return { ok: false, code: RUNNER_ERROR.TASKS_DIRECTORY_CREATION_FAILED };
      }
    }

    stats = await lstatOrNull(target);
    if (stats === null) {
      return { ok: false, code: RUNNER_ERROR.TASKS_DIRECTORY_CREATION_FAILED };
    }
  }

  return checkTasksDirectory(root, target, stats);
}

/**
 * Verifie la nature d'un `tasks/` deja observe, et son confinement.
 *
 * Partage par la creation et par la suppression : les deux posent exactement les
 * memes questions au meme dossier, et deux copies de ces trois refus finiraient
 * par diverger.
 */
async function checkTasksDirectory(
  root: string,
  target: string,
  stats: Stats,
): Promise<TasksDirectoryResult> {
  if (stats.isSymbolicLink()) {
    return { ok: false, code: RUNNER_ERROR.TASKS_DIRECTORY_SYMLINK_NOT_ALLOWED };
  }

  if (!stats.isDirectory()) {
    return { ok: false, code: RUNNER_ERROR.TASKS_DIRECTORY_NOT_DIRECTORY };
  }

  let realDirectory: string;
  try {
    realDirectory = await realpath(target);
  } catch {
    return { ok: false, code: RUNNER_ERROR.TASKS_DIRECTORY_CREATION_FAILED };
  }

  // Aucun lien n'ayant ete accepte, la resolution reelle ne devrait rien
  // changer. On la verifie tout de meme : c'est elle qui fait autorite sur le
  // confinement, jamais une comparaison de chaines.
  if (!isContainedIn(root, realDirectory)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_OUTSIDE_REPOSITORY };
  }

  return { ok: true, directory: realDirectory };
}

/**
 * Retourne l'etat de `tasks/` **sans jamais le creer**.
 *
 * La suppression n'a aucune raison de faire apparaitre le dossier qu'elle vient
 * vider : ce serait creer pour constater qu'il n'y a rien a supprimer. Un
 * dossier absent est donc rapporte tel quel, et l'appelant en tire la conclusion
 * qui s'impose.
 */
export async function inspectTasksDirectory(root: string): Promise<TasksDirectoryInspection> {
  const target = path.join(root, TASKS_DIRECTORY_NAME);

  const stats = await lstatOrNull(target);
  if (stats === null) {
    return { ok: true, present: false };
  }

  const checked = await checkTasksDirectory(root, target, stats);
  return checked.ok ? { ok: true, present: true, directory: checked.directory } : checked;
}
