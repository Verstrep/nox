/**
 * Portabilite des noms de fichiers proposes a la creation.
 *
 * Ce module ne protege pas le repository — le confinement s'en charge. Il
 * protege le **projet** : un document versionne avec Git finira par etre clone
 * ailleurs, et un nom accepte ici mais impossible a creer sur un autre systeme
 * rendrait ce clone inutilisable. Mieux vaut refuser a la saisie que produire un
 * repository qui ne se clone pas.
 *
 * Ces regles s'appliquent **uniquement a la creation**. Elles ne sont pas
 * ajoutees a `normalizeDocumentPath` : refuser de *lire* un fichier existant
 * sous pretexte que son nom est peu portable n'aiderait personne — le fichier
 * est la, l'utilisateur veut le voir. C'est au moment ou NOX ajoute un nom au
 * repository que la question se pose.
 *
 * Aucune transformation n'est appliquee : le nom saisi est accepte tel quel ou
 * refuse. Corriger silencieusement la casse ou remplacer un caractere produirait
 * un fichier que l'utilisateur n'a pas demande.
 */

/**
 * Noms de peripheriques reserves sous Windows.
 *
 * Ils restent reserves quelle que soit l'extension : `CON.md` est aussi
 * impossible a creer que `CON`.
 */
const RESERVED_WINDOWS_NAMES: ReadonlySet<string> = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_unused, index) => `com${String(index + 1)}`),
  ...Array.from({ length: 9 }, (_unused, index) => `lpt${String(index + 1)}`),
]);

/** Caracteres refuses par le systeme de fichiers Windows. */
const FORBIDDEN_CHARACTERS = /[<>:"|?*\\/]/;

/** Caracteres de controle, dont l'octet nul : illisibles et trompeurs. */
// eslint-disable-next-line no-control-regex -- la plage de controle est precisement l'objet du test
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Retire l'extension pour comparer la base du nom aux noms reserves. */
function baseName(segment: string): string {
  const dot = segment.indexOf(".");
  return dot === -1 ? segment : segment.slice(0, dot);
}

/**
 * Indique si un segment de chemin peut etre cree sans risque de portabilite.
 *
 * Les espaces internes, tirets, underscores, accents et parentheses sont
 * acceptes : ils sont portables et courants dans une documentation francaise.
 */
export function isPortableSegment(segment: string): boolean {
  if (segment === "" || segment === "." || segment === "..") {
    return false;
  }

  if (FORBIDDEN_CHARACTERS.test(segment) || CONTROL_CHARACTERS.test(segment)) {
    return false;
  }

  // Windows tronque silencieusement les espaces et points finaux : le fichier
  // cree ne porterait alors pas le nom demande.
  if (segment.endsWith(" ") || segment.endsWith(".")) {
    return false;
  }

  if (segment.startsWith(" ")) {
    return false;
  }

  return !RESERVED_WINDOWS_NAMES.has(baseName(segment).toLowerCase());
}

/**
 * Retourne le premier segment non portable d'un chemin relatif, ou `null`.
 *
 * Le chemin est attendu normalise (separateurs `/`), tel que le produit
 * `normalizeDocumentPath`.
 */
export function findUnportableSegment(relativePath: string): string | null {
  return relativePath.split("/").find((segment) => !isPortableSegment(segment)) ?? null;
}
