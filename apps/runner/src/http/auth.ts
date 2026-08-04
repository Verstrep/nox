/**
 * Authentification des routes sensibles du runner.
 *
 * Un unique jeton partage entre le runner et l'application web, transmis en
 * `Authorization: Bearer <jeton>`. Aucune reponse ne contient le jeton attendu,
 * le jeton recu, ni un fragment de l'un ou de l'autre.
 */

import { timingSafeEqual } from "node:crypto";

const BEARER_PREFIX = "bearer ";

/**
 * Compare deux chaines sans laisser le temps de reponse reveler ou elles
 * different.
 *
 * `timingSafeEqual` exige des buffers de meme longueur : les longueurs sont donc
 * comparees d'abord. Cela divulgue la longueur du jeton, ce qui est sans valeur
 * pour un attaquant face a un secret aleatoire de 256 bits.
 */
function isEqualToken(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  if (receivedBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(receivedBytes, expectedBytes);
}

/**
 * Verifie l'en-tete `Authorization` d'une requete.
 *
 * Retourne `false` si l'en-tete est absent, si le schema n'est pas `Bearer`, ou
 * si le jeton ne correspond pas. L'appelant repond alors `401` sans preciser
 * laquelle de ces trois causes s'applique.
 */
export function isAuthorized(
  authorizationHeader: string | string[] | undefined,
  expectedToken: string,
): boolean {
  if (typeof authorizationHeader !== "string") {
    return false;
  }

  const header = authorizationHeader.trim();
  if (!header.toLowerCase().startsWith(BEARER_PREFIX)) {
    return false;
  }

  const received = header.slice(BEARER_PREFIX.length).trim();
  if (received === "") {
    return false;
  }

  return isEqualToken(received, expectedToken);
}
