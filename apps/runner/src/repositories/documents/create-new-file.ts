/**
 * Creation exclusive d'un fichier qui n'existe pas encore.
 *
 * Volontairement distinct de `safe-write.ts`. Les deux ecrivent, mais ils
 * protegent de choses opposees :
 *
 * - `safe-write` **remplace** un fichier existant sans jamais le laisser
 *   partiel : il passe par un temporaire puis ecrase la cible.
 * - `create-new-file` **refuse** d'ecraser quoi que ce soit : il exige que la
 *   cible n'existe pas.
 *
 * Reutiliser le remplacement pour creer aurait donc inverse la garantie
 * principale de la creation. Le temporaire n'apporte d'ailleurs rien ici : un
 * fichier neuf incomplet peut simplement etre supprime, alors qu'un fichier
 * existant tronque serait irrecuperable.
 *
 * ## La garantie de non-ecrasement
 *
 * Elle repose entierement sur le drapeau `wx` : le systeme d'exploitation cree
 * le fichier **et** echoue s'il existe deja, en une seule operation
 * indivisible. Un enchainement `exists()` puis `writeFile()` ne donnerait
 * aucune garantie : entre les deux appels, un `git pull` ou un editeur peut
 * creer le fichier, qui serait alors ecrase sans que personne ne le sache.
 *
 * Un controle d'existence prealable reste utile — il produit un meilleur
 * message — mais il n'a aucune valeur de garantie. Seul `wx` fait autorite.
 *
 * ## Comportement en cas d'echec
 *
 * | Etape qui echoue | Consequence |
 * | --- | --- |
 * | Ouverture, cible deja presente | `DOCUMENT_ALREADY_EXISTS`, fichier existant intact |
 * | Ouverture, autre cause | `DOCUMENT_CREATION_FAILED`, rien n'a ete cree |
 * | Ecriture du contenu | Le fichier cree est supprime, `DOCUMENT_CREATION_FAILED` |
 * | Synchronisation | Idem : NOX sait que le contenu n'est pas garanti sur le disque |
 * | Fermeture | Idem |
 *
 * La suppression apres echec ne peut jamais detruire un fichier tiers : on ne
 * l'atteint que si `wx` a reussi, ce qui prouve que la cible n'existait pas
 * avant cette operation. NOX ne supprime donc que ce qu'il vient lui-meme de
 * creer.
 *
 * Il reste un cas que NOX ne peut pas couvrir : une coupure de courant entre
 * l'ouverture et la synchronisation laisse un fichier vide ou partiel, sans
 * qu'aucun code n'ait la main pour le nettoyer. Le document etant neuf, la
 * consequence se limite a un fichier a supprimer — aucune donnee anterieure
 * n'existe pour etre perdue.
 */

import { open, rm, type FileHandle } from "node:fs/promises";

import { RUNNER_ERROR, type RunnerErrorCode } from "@nox/shared";

export type CreateFileResult = { ok: true } | { ok: false; code: RunnerErrorCode };

/**
 * Points d'injection, utilises par les tests pour faire echouer une etape
 * precise sans dependre d'une panne disque reelle.
 */
export type CreateFileHooks = {
  writeContent?: (handle: FileHandle, data: Buffer) => Promise<void>;
  synchronize?: (handle: FileHandle) => Promise<void>;
};

/**
 * Permissions du fichier cree : lecture et ecriture pour le proprietaire,
 * lecture pour les autres. Jamais executable — un document Markdown n'a aucune
 * raison de l'etre, et `umask` peut encore restreindre davantage.
 */
const NEW_FILE_MODE = 0o644;

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}

/** Supprime le fichier que cette operation vient de creer, sans jamais lever. */
async function discardCreatedFile(targetPath: string): Promise<void> {
  try {
    await rm(targetPath, { force: true });
  } catch {
    // Un fichier vide non supprime est un desagrement ; l'erreur utile est
    // celle que l'appelant recoit.
  }
}

/**
 * Cree un fichier et y ecrit son contenu initial.
 *
 * `targetPath` doit avoir ete valide et confine par l'appelant : cette fonction
 * ne connait rien des repositories et ne verifie aucun chemin.
 */
export async function createNewFile(
  targetPath: string,
  data: Buffer,
  hooks: CreateFileHooks = {},
): Promise<CreateFileResult> {
  const writeContent =
    hooks.writeContent ?? ((handle: FileHandle, bytes: Buffer) => handle.writeFile(bytes));
  const synchronize = hooks.synchronize ?? ((handle: FileHandle) => handle.sync());

  let handle: FileHandle;
  try {
    handle = await open(targetPath, "wx", NEW_FILE_MODE);
  } catch (error) {
    return {
      ok: false,
      code: isAlreadyExistsError(error)
        ? RUNNER_ERROR.DOCUMENT_ALREADY_EXISTS
        : RUNNER_ERROR.DOCUMENT_CREATION_FAILED,
    };
  }

  // A partir d'ici, la cible existe et appartient a cette operation.
  try {
    await writeContent(handle, data);
    await synchronize(handle);
    await handle.close();
  } catch {
    // `close` peut avoir deja eu lieu ou echouer a son tour : dans les deux cas
    // le descripteur ne sert plus a rien, et l'erreur reelle est deja connue.
    await handle.close().catch(() => undefined);
    await discardCreatedFile(targetPath);
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_CREATION_FAILED };
  }

  return { ok: true };
}
