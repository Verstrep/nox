/**
 * Fins de ligne : alignement du contenu soumis sur celui du document existant.
 *
 * Ce module resout un probleme qui vient du navigateur, pas de NOX. La
 * specification HTML impose qu'un `<textarea>` soit soumis avec des fins de
 * ligne CRLF, quel que soit le contenu affiche. Sans correction, enregistrer
 * depuis NOX un fichier ecrit en LF reecrirait **toutes** ses lignes en CRLF :
 * un diff Git de plusieurs centaines de lignes pour une correction de trois
 * mots.
 *
 * La regle retenue : le contenu recu est ramene en LF, puis les fins de ligne du
 * document deja sur le disque lui sont reappliquees. NOX conserve donc la
 * convention du fichier au lieu d'en imposer une. C'est le seul endroit ou le
 * contenu ecrit s'ecarte de la chaine soumise, et cet ecart existe precisement
 * pour rester fidele a l'intention de l'utilisateur.
 *
 * Ce fichier est volontairement pur : aucun acces au disque, donc testable sans
 * fixture.
 */

export type LineEnding = "\r\n" | "\n";

/** Ramene toutes les fins de ligne — CRLF, CR isole, LF — a LF. */
export function toLineFeed(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

/**
 * Determine la fin de ligne dominante d'un contenu existant.
 *
 * Retourne `null` lorsque le contenu ne comporte aucune fin de ligne : il n'y a
 * alors rien a preserver, et rien a deduire.
 */
export function detectLineEnding(existingContent: string): LineEnding | null {
  const crlfCount = (existingContent.match(/\r\n/g) ?? []).length;
  // Les LF precedes d'un CR appartiennent deja aux CRLF comptes ci-dessus.
  const lfCount = (existingContent.match(/(?<!\r)\n/g) ?? []).length;

  if (crlfCount === 0 && lfCount === 0) {
    return null;
  }

  // A egalite — fichier deja mixte — LF l'emporte : c'est la convention par
  // defaut du repository et la forme la plus neutre pour Git.
  return crlfCount > lfCount ? "\r\n" : "\n";
}

/**
 * Reecrit les fins de ligne d'un contenu soumis pour qu'elles suivent celles du
 * document existant.
 */
export function alignLineEndings(submittedContent: string, existingContent: string): string {
  const normalized = toLineFeed(submittedContent);
  const ending = detectLineEnding(existingContent);

  return ending === "\r\n" ? normalized.replaceAll("\n", "\r\n") : normalized;
}
