/**
 * Duree d'un appel a l'Architecte, telle qu'elle s'affiche.
 *
 * ## Pourquoi ce module existe
 *
 * Le second pilote reel a vu quatre depassements de delai sans jamais savoir
 * combien de temps un appel prenait reellement — l'information n'etait nulle
 * part. Le plafond a ete deplace a dix minutes en connaissance de cause : nous
 * ne savons pas encore quelle duree est normale, et le prochain reglage devra
 * venir de durees observees plutot que d'un second pari.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il ne juge rien. Une generation longue n'est pas une generation malade, et
 * aucune de ces fonctions ne rend un seuil, une couleur d'alerte ou un
 * qualificatif. Passer quatre-vingt-dix secondes etait la raison d'un echec
 * hier ; c'est un fait sans consequence aujourd'hui.
 *
 * Pur : ni base, ni React, ni reseau, ni horloge implicite — l'instant courant
 * est toujours un parametre, sans quoi rien ne serait testable.
 */

/**
 * Espace fine insecable, entre un nombre et son unite.
 *
 * Ecrite en echappement plutot qu'en litteral : le caractere est invisible dans
 * un editeur, et un outil de transformation l'a deja mange une fois.
 */
const THIN_SPACE = "\u202f";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * Une duree en millisecondes, rendue lisible.
 *
 * ```text
 *      900 ms  ->  0 s
 *    42 000 ms  ->  42 s
 *   102 000 ms  ->  1 min 42 s
 * 3 700 000 ms  ->  1 h 1 min
 * ```
 *
 * Toujours tronquee vers le bas, jamais arrondie : un compteur qui afficherait
 * `1 min` a cinquante-cinq secondes reviendrait ensuite en arriere.
 *
 * Une duree negative — horloge reculee, instants incoherents — est ramenee a
 * zero. Afficher `-3 s` ferait douter de tout le reste de la page.
 */
export function formatArchitectDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return `0${THIN_SPACE}s`;
  }

  if (durationMs < MINUTE) {
    return `${String(Math.floor(durationMs / SECOND))}${THIN_SPACE}s`;
  }

  if (durationMs < HOUR) {
    const minutes = Math.floor(durationMs / MINUTE);
    const seconds = Math.floor((durationMs % MINUTE) / SECOND);
    return `${String(minutes)}${THIN_SPACE}min ${String(seconds)}${THIN_SPACE}s`;
  }

  const hours = Math.floor(durationMs / HOUR);
  const minutes = Math.floor((durationMs % HOUR) / MINUTE);
  return `${String(hours)}${THIN_SPACE}h ${String(minutes)}${THIN_SPACE}min`;
}

/**
 * Temps ecoule depuis un instant persiste, en millisecondes.
 *
 * `startedAt` est la date ISO enregistree a la reservation de la generation —
 * l'autorite, et non l'instant du clic dans le navigateur. Les deux different
 * de peu, mais seule la premiere reste juste apres un rechargement de page.
 *
 * `null` quand la date est illisible : un compteur absent vaut mieux qu'un
 * compteur faux, et `NaN` seconde s'afficherait sans prevenir.
 */
export function architectElapsedMs(startedAt: string, now: number): number | null {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) {
    return null;
  }
  return Math.max(0, now - started);
}

/**
 * Duree d'une generation conclue, prete a etre affichee.
 *
 * `null` quand elle n'a jamais ete enregistree : les generations anterieures a
 * HOTFIX-004, et celles encore en vol. « Duree inconnue » est un etat, et le
 * reconstruire a partir d'autre chose inventerait une mesure.
 */
export function architectDurationLabel(durationMs: number | null): string | null {
  return durationMs === null ? null : formatArchitectDuration(durationMs);
}
