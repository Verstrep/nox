/**
 * Creation du document Markdown d'une tache.
 *
 * Proche de la creation d'un document ordinaire, avec deux differences qui
 * justifient une route et un module a part :
 *
 * 1. **Le chemin n'est pas recu, il est deduit.** Le web envoie un code de
 *    tache ; c'est ce module qui compose `tasks/<code>.md`. Un chemin arbitraire
 *    n'a donc aucune prise, et le controle a faire se reduit a la forme du code.
 * 2. **Le dossier `tasks/` peut etre cree.** C'est la seule exception a la regle
 *    « NOX ne cree aucun dossier », et elle est justifiee dans
 *    `tasks-directory.ts`.
 *
 * Tout le reste est repris tel quel de TASK-006 : meme primitive exclusive, meme
 * refus absolu d'ecraser, meme relecture finale. Il n'existe pas de seconde
 * logique d'ecriture.
 */

import path from "node:path";

import {
  RUNNER_ERROR,
  isTaskCode,
  taskDocumentPath,
  type ProjectDocumentContent,
  type RunnerErrorCode,
} from "@nox/shared";

import { MAX_DOCUMENT_BYTES } from "../documents/constants.ts";
import { createNewFile, type CreateFileHooks } from "../documents/create-new-file.ts";
import { readDocument } from "../documents/read-document.ts";
import { resolveRepositoryRoot } from "../documents/repository-root.ts";
import { ensureTasksDirectory } from "./tasks-directory.ts";

export type CreateTaskDocumentResult =
  | { ok: true; document: ProjectDocumentContent }
  | { ok: false; code: RunnerErrorCode };

export type CreateTaskDocumentOptions = {
  maxBytes?: number;
  /** Transmis a la creation ; sert aux tests a simuler une panne disque. */
  createHooks?: CreateFileHooks;
};

/**
 * Detecte une moitie de paire de substitution isolee.
 *
 * JSON l'accepte, UTF-8 non : `Buffer.from` la remplacerait par `U+FFFD` sans
 * rien dire, et le fichier cree differerait du texte genere.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Cree `tasks/<taskCode>.md` sans jamais ecraser de fichier existant.
 *
 * Le contenu est valide **avant** que le dossier `tasks/` ne soit prepare : une
 * requete mal formee ne doit pas laisser derriere elle un dossier vide.
 */
export async function createTaskDocument(
  repositoryPath: string,
  taskCode: string,
  content: string,
  options: CreateTaskDocumentOptions = {},
): Promise<CreateTaskDocumentResult> {
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;

  // Le code determine le nom du fichier : sa validation est donc la validation
  // du chemin. `TASK-` suivi d'au moins trois chiffres ne peut contenir ni
  // separateur, ni remontee, ni caractere non portable.
  if (!isTaskCode(taskCode)) {
    return { ok: false, code: RUNNER_ERROR.TASK_CODE_INVALID };
  }

  const repository = resolveRepositoryRoot(repositoryPath);
  if (!repository.ok) {
    return repository;
  }

  if (LONE_SURROGATE.test(content)) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_CONTENT_INVALID };
  }

  const data = Buffer.from(content, "utf8");
  if (data.byteLength > maxBytes) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_TOO_LARGE };
  }

  const directory = await ensureTasksDirectory(repository.root);
  if (!directory.ok) {
    return directory;
  }

  const targetPath = path.join(directory.directory, `${taskCode}.md`);

  const created = await createNewFile(targetPath, data, options.createHooks);
  if (!created.ok) {
    return created;
  }

  // Relecture reelle : metadonnees, categorie et revision viennent du disque.
  // Le document est ainsi immediatement affichable dans le lecteur Markdown.
  return readDocument(repositoryPath, taskDocumentPath(taskCode), { maxBytes });
}
