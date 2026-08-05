/**
 * Revision d'un document : empreinte de son contenu binaire.
 *
 * La revision sert a une seule chose : detecter qu'un fichier a change entre le
 * moment ou NOX l'a lu et celui ou l'utilisateur l'enregistre.
 *
 * Elle est calculee sur les **octets reels** du fichier, jamais sur ses
 * metadonnees. `updatedAt` et `size` seraient plus rapides mais faux : deux
 * ecritures dans la meme seconde peuvent partager un horodatage, et une
 * modification a taille constante — corriger un mot par un autre de meme
 * longueur — passerait totalement inapercue. Une empreinte du contenu ne se
 * laisse tromper par aucun des deux.
 *
 * SHA-256 n'est pas choisi ici pour une propriete cryptographique : la revision
 * n'est pas un secret et ne protege de personne. Elle doit simplement ne jamais
 * collisionner par accident, ce qu'un CRC ne garantit pas.
 */

import { createHash } from "node:crypto";

import { isProjectDocumentRevision, type ProjectDocumentRevision } from "@nox/shared";

/** Nom de l'algorithme, expose pour la documentation et les tests. */
export const REVISION_ALGORITHM = "sha256";

/** Calcule la revision d'un contenu binaire. */
export function computeRevision(bytes: Uint8Array): ProjectDocumentRevision {
  return createHash(REVISION_ALGORITHM).update(bytes).digest("hex");
}

/**
 * Verifie qu'une revision recue de l'exterieur a bien la forme attendue.
 *
 * Un format invalide est distingue d'un conflit : l'un signale un appelant qui
 * n'a pas respecte le contrat, l'autre un fichier modifie entre-temps. Les deux
 * meritent des messages differents.
 */
export function isValidRevisionFormat(value: string): boolean {
  return isProjectDocumentRevision(value);
}

/**
 * Compare deux revisions.
 *
 * Comparaison ordinaire : contrairement au jeton du runner, une revision n'est
 * pas un secret, et rien ne se deduit du temps de comparaison.
 */
export function revisionsMatch(
  left: ProjectDocumentRevision,
  right: ProjectDocumentRevision,
): boolean {
  return left === right;
}
