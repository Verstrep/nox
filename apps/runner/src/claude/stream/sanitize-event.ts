/**
 * Nettoyage des chaines publiques d'un evenement.
 *
 * **Toute** chaine qui finira dans un `label` ou un `detail` passe par ici. Pas
 * « toute chaine suspecte » : toutes. Une fonction de sanitation qu'on applique
 * au cas par cas finit toujours par etre oubliee une fois, et c'est cette fois-la
 * qui compte.
 *
 * ## Ce qu'elle retire, et pourquoi
 *
 * - **Les chemins absolus du repository** deviennent relatifs. Ce n'est pas de la
 *   cosmetique : `D:\Projets\Dev\nox` nomme un disque, un utilisateur et une
 *   organisation de machine. Le navigateur n'a besoin que de
 *   `apps/web/lib/runs.ts`, et c'est aussi plus lisible.
 * - **Les chemins absolus exterieurs** sont masques entierement. On ne peut pas
 *   les rendre relatifs — ils ne sont relatifs a rien de connu — et ils revelent
 *   l'arborescence de la machine.
 * - **Le jeton du runner** est retire par comparaison a sa valeur reelle. La
 *   valeur n'est jamais ecrite, jamais journalisee, jamais comparee
 *   partiellement : soit la chaine la contient, soit non.
 * - **Les variables `NOX_*`** disparaissent, nom compris. Le nom seul suffirait a
 *   indiquer ou chercher.
 * - **Les caracteres de controle** sont retires, y compris les marques de
 *   direction et les caracteres de largeur nulle : ils permettent d'afficher un
 *   texte different de celui qui est stocke.
 *
 * ## Ce qu'elle preserve
 *
 * Les accents, les ideogrammes, les emoji. Un nettoyage qui reduirait tout a
 * l'ASCII rendrait illisible la moitie des messages, pour un gain de securite
 * nul.
 */

import process from "node:process";

/** Remplacement affiche a la place d'un chemin exterieur au repository. */
export const EXTERNAL_PATH_PLACEHOLDER = "<chemin externe>";

/** Remplacement affiche a la place d'une valeur secrete. */
export const SECRET_PLACEHOLDER = "<masque>";

export type SanitizerOptions = {
  /** Racine canonique du repository de l'execution. */
  repositoryRoot: string;
  /** Environnement source des secrets a masquer. */
  environment?: Record<string, string | undefined>;
  /** Comparaison de chemins insensible a la casse (Windows). */
  caseInsensitivePaths?: boolean;
};

export type EventSanitizer = (value: string, maxLength: number) => string;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Construit le motif reconnaissant la racine du repository.
 *
 * Les separateurs sont rendus interchangeables : Claude Code melange `\` et `/`
 * sous Windows, parfois dans la meme ligne, et un motif qui n'accepterait qu'une
 * forme laisserait passer l'autre.
 */
function buildRootPattern(repositoryRoot: string, caseInsensitive: boolean): RegExp | null {
  const segments = repositoryRoot.split(/[\\/]/u).filter((segment) => segment !== "");
  if (segments.length === 0) {
    return null;
  }

  const leading = /^[\\/]/u.test(repositoryRoot) ? "[\\\\/]" : "";
  const body = segments.map(escapeRegExp).join("[\\\\/]+");

  // Le motif consomme aussi la suite du chemin : c'est elle qu'il faut
  // reecrire en separateurs uniformes, et la reconnaitre ici evite de toucher
  // aux antislash du reste du texte.
  return new RegExp(
    `${leading}${body}(?:[\\\\/]+([\\p{L}\\p{N}._@+\\-/\\\\]*))?`,
    caseInsensitive ? "giu" : "gu",
  );
}

/**
 * Chemins absolus n'appartenant pas au repository.
 *
 * Trois familles : lettre de lecteur Windows, chemin UNC, chemin POSIX. Le
 * dernier est le plus delicat — il ne doit pas capturer une URL, d'ou le refus
 * de matcher juste apres un `:` ou un caractere de mot.
 */
const EXTERNAL_PATH_PATTERNS: readonly RegExp[] = [
  // La lettre de lecteur doit etre isolee : sans le refus qui precede,
  // `https://…` se lirait comme le lecteur « s: », et toutes les URL
  // disparaitraient.
  /(?<!\w)[A-Za-z]:[\\/][^\s"'`,;)\]}]*/gu,
  /\\\\[^\s"'`,;)\]}]+/gu,
  /(?<![\w.:/])\/[^\s"'`,;)\]}/]+\/[^\s"'`,;)\]}]*/gu,
];

/**
 * Caracteres de controle et de mise en forme invisible.
 *
 * C0 et C1 hors tabulation et saut de ligne, plus les marques de direction, les
 * espaces de largeur nulle et le caractere de remplacement. Ces derniers ne sont
 * pas des caracteres de controle au sens strict, mais ils permettent la meme
 * chose : afficher autre chose que ce qui est ecrit.
 */
// `no-control-regex` existe pour attraper les caracteres de controle glisses
// par accident dans une expression. Ici, ils sont exactement le sujet : cette
// expression n'a d'autre role que de les reconnaitre pour les retirer. La regle
// est donc desactivee sur cette ligne, et sur elle seule.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\uFEFF]/gu;

/**
 * Collecte les valeurs a masquer.
 *
 * Le jeton du runner d'abord, puis toute variable `NOX_*` : le filtre porte sur
 * le prefixe entier, pas sur une liste nominative. Une variable ajoutee plus tard
 * serait sinon exposee par oubli, et l'oubli irait dans le mauvais sens.
 *
 * Les valeurs trop courtes sont ecartees : masquer une valeur de trois
 * caracteres remplacerait des fragments de mots ordinaires partout dans le
 * texte, sans rien proteger.
 */
export function collectEnvironmentSecrets(
  environment: Record<string, string | undefined>,
): string[] {
  const secrets: string[] = [];

  for (const [name, value] of Object.entries(environment)) {
    if (!name.toUpperCase().startsWith("NOX_") || value === undefined) {
      continue;
    }
    if (value.trim().length >= 8) {
      secrets.push(value);
    }
  }

  // Les plus longues d'abord : masquer une sous-chaine avant sa chaine
  // englobante laisserait le reste de cette derniere visible.
  return secrets.sort((a, b) => b.length - a.length);
}

/**
 * Retire les caracteres qui permettent d'afficher autre chose que le texte reel.
 *
 * Isolee du nettoyeur complet parce qu'un patch de review en a besoin **sans**
 * le reste : reecrire les chemins d'un diff ou en ecraser l'indentation
 * produirait un diff faux, c'est-a-dire pire qu'aucun diff.
 *
 * `\t` et `\n` sont preserves : ils portent la structure d'un fichier.
 */
export function stripControlCharacters(value: string): string {
  return value.replace(CONTROL_CHARACTERS, "");
}

/**
 * Construit le nettoyeur d'une execution donnee.
 *
 * Il est cree une fois par execution, avec la racine reelle du repository :
 * c'est la seule facon de rendre les chemins relatifs plutot que de simplement
 * les masquer.
 */
export function createEventSanitizer(options: SanitizerOptions): EventSanitizer {
  const environment = options.environment ?? process.env;
  const caseInsensitive = options.caseInsensitivePaths ?? process.platform === "win32";
  const rootPattern = buildRootPattern(options.repositoryRoot, caseInsensitive);
  const secrets = collectEnvironmentSecrets(environment);
  const secretNames = /\bNOX_[A-Z0-9_]+\b/gu;

  return (value: string, maxLength: number): string => {
    if (value === "") {
      return "";
    }

    let text = value;

    // 1. La racine du repository devient un chemin relatif. En premier : sinon
    //    l'etape suivante masquerait ces chemins comme s'ils etaient exterieurs.
    if (rootPattern !== null) {
      text = text.replace(rootPattern, (_match, rest: string | undefined) => {
        const relative = (rest ?? "").replace(/\\/gu, "/");
        return relative === "" ? "." : relative;
      });
    }

    // 2. Ce qui reste d'absolu ne peut venir que d'ailleurs.
    for (const pattern of EXTERNAL_PATH_PATTERNS) {
      text = text.replace(pattern, EXTERNAL_PATH_PLACEHOLDER);
    }

    // 3. Les secrets, par valeur puis par nom.
    for (const secret of secrets) {
      text = text.split(secret).join(SECRET_PLACEHOLDER);
    }
    text = text.replace(secretNames, SECRET_PLACEHOLDER);

    // 4. Ce qui pourrait mentir a l'affichage.
    text = text.replace(CONTROL_CHARACTERS, "");

    // 5. Les espaces reduits : une timeline se lit en lignes courtes, et une
    //    indentation de vingt niveaux n'y apporte rien.
    text = text.replace(/[ \t]+/gu, " ").replace(/\n{3,}/gu, "\n\n").trim();

    return boundDetail(text, maxLength);
  };
}

/** Borne une chaine publique et signale la coupe. */
export function boundDetail(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const notice = " […]";
  return value.slice(0, Math.max(0, maxLength - notice.length)) + notice;
}
