/**
 * Ecriture sure d'un fichier : jamais de document a moitie ecrit.
 *
 * Ecrire directement dans le fichier cible le tronque d'abord, puis le remplit.
 * Une coupure de courant, un disque plein ou une exception au milieu de cette
 * fenetre laisse un document mutile — et NOX n'aurait rien pour le reconstituer,
 * puisqu'il ne conserve aucune copie.
 *
 * La strategie retenue est donc classique :
 *
 * ```text
 * ecriture dans un fichier temporaire du meme dossier
 *         v
 * synchronisation sur le disque, puis fermeture
 *         v
 * remplacement du fichier cible
 *         v
 * nettoyage du temporaire en cas d'echec
 * ```
 *
 * Le temporaire vit dans le **meme dossier** que la cible : un renommage entre
 * volumes n'est pas un renommage, c'est une copie suivie d'une suppression, ce
 * qui reintroduit exactement la fenetre que l'on cherche a fermer.
 *
 * ## Garanties reelles sous Windows
 *
 * `fs.rename` s'appuie sur `MoveFileEx` avec `MOVEFILE_REPLACE_EXISTING`. Sur un
 * meme volume NTFS, le remplacement se joue au niveau des metadonnees du systeme
 * de fichiers : un lecteur voit l'ancien contenu ou le nouveau, jamais un
 * melange. En revanche, Windows ne documente pas cette operation comme atomique
 * au sens strict, et elle **echoue** — au lieu d'attendre — si un autre
 * processus tient la cible ouverte sans partage de suppression : antivirus,
 * indexeur, editeur. Cet echec est propre : le document conserve son contenu
 * d'origine et l'erreur remonte a l'utilisateur.
 *
 * Autrement dit, la garantie offerte ici est « jamais de contenu partiel », pas
 * « ecriture atomique certifiee ». Obtenir la seconde sous Windows demanderait
 * `ReplaceFileW` via une dependance native, ce qui n'apporterait rien de
 * decisif pour un outil local a un seul utilisateur.
 */

import { randomBytes } from "node:crypto";
import { chmod, lstat, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { RUNNER_ERROR, type RunnerErrorCode } from "@nox/shared";

export type SafeWriteResult = { ok: true } | { ok: false; code: RunnerErrorCode };

/**
 * Points d'injection, utilises par les tests pour simuler une panne.
 *
 * Trois fonctions remplacables valent mieux qu'une abstraction de systeme de
 * fichiers : les tests visent precisement l'etape qu'ils veulent faire echouer.
 */
export type SafeWriteHooks = {
  writeTemporary?: (temporaryPath: string, data: Buffer) => Promise<void>;
  replace?: (temporaryPath: string, targetPath: string) => Promise<void>;
  randomSuffix?: () => string;
};

/**
 * Prefixe des fichiers temporaires.
 *
 * Le point initial les masque sous les systemes de type UNIX, et le nom dit d'ou
 * ils viennent : un temporaire oublie apres une coupure doit etre identifiable
 * sans deviner.
 */
export const TEMPORARY_FILE_PREFIX = ".nox-";

/**
 * Suffixe des fichiers temporaires.
 *
 * Il ne se termine deliberement pas par `.md` : l'inventaire ne retient que les
 * fichiers Markdown, un temporaire n'y apparait donc jamais, meme s'il survit a
 * un arret brutal.
 */
export const TEMPORARY_FILE_SUFFIX = ".tmp";

/** Reconnait un fichier temporaire de NOX a son seul nom. */
export function isTemporaryFileName(fileName: string): boolean {
  return fileName.startsWith(TEMPORARY_FILE_PREFIX) && fileName.endsWith(TEMPORARY_FILE_SUFFIX);
}

/** Suffixe aleatoire : deux ecritures simultanees ne se disputent pas un nom. */
function defaultRandomSuffix(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Ecrit le fichier temporaire et force son enregistrement sur le disque.
 *
 * Le drapeau `wx` echoue si le fichier existe deja : un temporaire n'ecrase
 * jamais rien, meme en cas de collision de nom improbable.
 *
 * `sync()` avant la fermeture garantit que les octets sont sur le disque avant
 * le renommage. Sans lui, une coupure entre les deux pourrait laisser un fichier
 * cible correctement renomme mais vide.
 */
async function defaultWriteTemporary(temporaryPath: string, data: Buffer): Promise<void> {
  const handle = await open(temporaryPath, "wx");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Reprend les permissions du fichier remplace.
 *
 * Best effort assume : sous Windows, `chmod` ne pilote que l'attribut « lecture
 * seule » et n'a aucune prise sur les ACL — que NOX ne modifie jamais. Un echec
 * ici ne doit pas faire echouer une ecriture par ailleurs correcte.
 */
async function copyPermissions(targetPath: string, temporaryPath: string): Promise<void> {
  try {
    const stats = await stat(targetPath);
    await chmod(temporaryPath, stats.mode);
  } catch {
    // Le fichier temporaire garde les permissions par defaut : jamais
    // executable, jamais plus ouvert que ce que le systeme accorde.
  }
}

/**
 * Verifie que le nom temporaire est libre.
 *
 * Sans ce controle, un echec d'ecriture declencherait le nettoyage d'un fichier
 * que NOX n'a pas cree — perdre un fichier tiers en voulant ranger le sien
 * serait le comble pour une ecriture « sure ». La collision est improbable, la
 * consequence ne l'est pas.
 */
async function isNameFree(temporaryPath: string): Promise<boolean> {
  try {
    await lstat(temporaryPath);
    return false;
  } catch {
    return true;
  }
}

/** Supprime un temporaire sans jamais masquer l'erreur d'origine. */
async function discardTemporary(temporaryPath: string): Promise<void> {
  try {
    await rm(temporaryPath, { force: true });
  } catch {
    // Un temporaire non supprime est un desagrement, pas une perte de donnees :
    // l'erreur reelle est celle que l'appelant recoit.
  }
}

/**
 * Remplace le contenu d'un fichier existant sans jamais le laisser partiel.
 *
 * `targetPath` doit avoir ete valide et confine par l'appelant : cette fonction
 * ne connait rien des repositories et ne verifie aucun chemin.
 */
export async function writeFileSafely(
  targetPath: string,
  data: Buffer,
  hooks: SafeWriteHooks = {},
): Promise<SafeWriteResult> {
  const writeTemporary = hooks.writeTemporary ?? defaultWriteTemporary;
  const replace = hooks.replace ?? ((from: string, to: string) => rename(from, to));
  const randomSuffix = hooks.randomSuffix ?? defaultRandomSuffix;

  const directory = path.dirname(targetPath);
  const temporaryPath = path.join(
    directory,
    `${TEMPORARY_FILE_PREFIX}${randomSuffix()}${TEMPORARY_FILE_SUFFIX}`,
  );

  if (!(await isNameFree(temporaryPath))) {
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_TEMPORARY_FILE_FAILED };
  }

  try {
    await writeTemporary(temporaryPath, data);
  } catch {
    // A partir d'ici, le nom appartient a cette ecriture : le nettoyer ne peut
    // detruire que ce qu'elle a elle-meme cree.
    await discardTemporary(temporaryPath);
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_TEMPORARY_FILE_FAILED };
  }

  await copyPermissions(targetPath, temporaryPath);

  try {
    await replace(temporaryPath, targetPath);
  } catch {
    // Le document conserve son contenu d'origine : rien n'a ete tronque.
    await discardTemporary(temporaryPath);
    return { ok: false, code: RUNNER_ERROR.DOCUMENT_WRITE_FAILED };
  }

  return { ok: true };
}
