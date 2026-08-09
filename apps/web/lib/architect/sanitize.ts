/**
 * Nettoyage de tout ce qui part vers le fournisseur de l'Architecte.
 *
 * **Toute** chaine transmise passe par ici : contenu de document, resume de
 * tache, demande de l'utilisateur, precisions. Pas « toute chaine suspecte » :
 * toutes. Une sanitation appliquee au cas par cas finit toujours par etre
 * oubliee une fois, et c'est cette fois-la qui compte.
 *
 * ## Pourquoi une seconde fonction, alors que le runner en a deja une
 *
 * Parce qu'elles nettoient dans deux directions opposees, avec deux contraintes
 * incompatibles.
 *
 * Le nettoyeur du runner (`sanitize-event.ts`) prepare des chaines destinees au
 * **navigateur** : il ecrase les espaces multiples et reduit les lignes vides,
 * parce qu'une timeline se lit en lignes courtes. Appliquer cela a un document
 * Markdown detruirait ses blocs de code, ses listes indentees et ses tableaux —
 * c'est-a-dire l'essentiel de ce que l'architecte doit comprendre.
 *
 * Celui-ci prepare des chaines destinees a **quitter la machine**. Il preserve
 * donc la structure Markdown, et durcit le reste : en plus des variables `NOX_*`,
 * il masque les formes de secret reconnaissables, parce qu'un document de projet
 * peut en contenir un par accident.
 *
 * ## Ce qu'il ne pretend pas etre
 *
 * Un detecteur de secrets exhaustif. Aucune expression reguliere ne reconnait
 * « toutes » les cles, et pretendre le contraire donnerait une fausse assurance.
 * La premiere protection de NOX n'est pas ici : c'est la **liste fermee** des
 * documents envoyes. Le code source, les diffs, les sorties de Claude Code et
 * tout fichier `.env` ne sont jamais candidats — ils ne peuvent donc pas fuir,
 * quelle que soit la qualite de ce module.
 */

/** Remplacement affiche a la place d'un chemin exterieur au repository. */
export const EXTERNAL_PATH_PLACEHOLDER = "<chemin externe>";

/** Remplacement affiche a la place d'une valeur secrete. */
export const SECRET_PLACEHOLDER = "<masque>";

/** Marqueur qui remplace la racine du repository dans un chemin absolu. */
export const REPOSITORY_ROOT_PLACEHOLDER = ".";

export type ArchitectSanitizerOptions = {
  /** Racine canonique du repository du projet. */
  repositoryRoot: string;
  /** Environnement source des secrets a masquer. */
  environment: Record<string, string | undefined>;
  /** Comparaison de chemins insensible a la casse (Windows). */
  caseInsensitivePaths?: boolean;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Motif reconnaissant la racine du repository.
 *
 * Les separateurs sont rendus interchangeables : un document redige sous Windows
 * melange volontiers `\` et `/`, parfois dans la meme ligne.
 */
function buildRootPattern(repositoryRoot: string, caseInsensitive: boolean): RegExp | null {
  const segments = repositoryRoot.split(/[\\/]/u).filter((segment) => segment !== "");
  if (segments.length === 0) {
    return null;
  }
  const leading = /^[\\/]/u.test(repositoryRoot) ? "[\\\\/]" : "";
  const body = segments.map(escapeRegExp).join("[\\\\/]+");
  return new RegExp(
    `${leading}${body}(?:[\\\\/]+([\\p{L}\\p{N}._@+\\-/\\\\]*))?`,
    caseInsensitive ? "giu" : "gu",
  );
}

/** Chemins absolus n'appartenant pas au repository : lecteur, UNC, POSIX. */
const EXTERNAL_PATH_PATTERNS: readonly RegExp[] = [
  /(?<!\w)[A-Za-z]:[\\/][^\s"'`,;)\]}]*/gu,
  /\\\\[^\s"'`,;)\]}]+/gu,
  /(?<![\w.:/])\/[^\s"'`,;)\]}/]+\/[^\s"'`,;)\]}]*/gu,
];

/**
 * Formes de secret reconnaissables.
 *
 * Volontairement peu nombreuses et tres specifiques : un motif trop large
 * masquerait des identifiants ordinaires — un SHA de commit, un identifiant de
 * tache — et rendrait le contexte incomprehensible pour l'architecte.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // Cles de fournisseurs de modeles et de forges, a prefixe stable.
  /\b(?:sk|rk)-[A-Za-z0-9_-]{16,}/gu,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/gu,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/gu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  // En-tete d'autorisation recopie dans un exemple de documentation.
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}/gu,
];

/**
 * Affectation dont le **nom** annonce un secret.
 *
 * Seule la valeur est masquee : le nom reste visible, parce qu'il fait partie de
 * la documentation utile — savoir qu'une variable existe n'est pas la connaitre.
 */
const SECRET_ASSIGNMENT =
  /\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)([^\s"'`\n]{8,})\3/gu;

/** Bloc de cle privee au format PEM, quelle qu'en soit la variante. */
const PEM_BLOCK = /-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?-----END[^\n]*PRIVATE KEY-----/gu;

/**
 * Plages de caracteres de controle et de mise en forme invisible.
 *
 * Exprimees en points de code plutot qu'en litteral : une classe de caracteres
 * de controle ecrite en clair est invisible a la relecture, indiscernable d'une
 * faute de frappe, et le lint la refuse pour cette raison meme.
 *
 * La tabulation et le saut de ligne sont volontairement absents des plages : ils
 * portent la structure d'un Markdown.
 */
const CONTROL_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0xfeff, 0xfeff],
];

const CONTROL_CHARACTERS = new RegExp(
  `[${CONTROL_RANGES.map(
    ([from, to]) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`,
  ).join("")}]`,
  "gu",
);

/**
 * Collecte les valeurs a masquer depuis l'environnement.
 *
 * Le filtre porte sur le prefixe `NOX_` entier, jamais sur une liste nominative :
 * `NOX_OPENAI_API_KEY` et `NOX_RUNNER_TOKEN` sont couverts par construction, et
 * toute variable ajoutee plus tard le sera aussi. Une valeur de moins de huit
 * caracteres est ecartee : la masquer remplacerait des fragments de mots
 * ordinaires partout dans le texte, sans rien proteger.
 */
export function collectArchitectSecrets(
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

export type ArchitectSanitizer = (value: string) => string;

/**
 * Construit le nettoyeur d'un projet donne.
 *
 * Cree une fois par preparation de contexte, avec la racine reelle du
 * repository : c'est la seule facon de rendre les chemins relatifs plutot que de
 * simplement les masquer.
 */
export function createArchitectSanitizer(options: ArchitectSanitizerOptions): ArchitectSanitizer {
  const caseInsensitive = options.caseInsensitivePaths ?? process.platform === "win32";
  const rootPattern = buildRootPattern(options.repositoryRoot, caseInsensitive);
  const secrets = collectArchitectSecrets(options.environment);
  const secretNames = /\bNOX_[A-Z0-9_]+\b/gu;

  return (value: string): string => {
    if (value === "") {
      return "";
    }

    let text = value;

    // 1. La racine du repository devient un chemin relatif. En premier : sinon
    //    l'etape suivante masquerait ces chemins comme s'ils venaient d'ailleurs.
    if (rootPattern !== null) {
      text = text.replace(rootPattern, (_match, rest: string | undefined) => {
        const relative = (rest ?? "").replace(/\\/gu, "/");
        return relative === "" ? REPOSITORY_ROOT_PLACEHOLDER : relative;
      });
    }

    // 2. Ce qui reste d'absolu ne peut venir que d'ailleurs : il nomme un
    //    disque, un utilisateur, une organisation de machine.
    for (const pattern of EXTERNAL_PATH_PATTERNS) {
      text = text.replace(pattern, EXTERNAL_PATH_PLACEHOLDER);
    }

    // 3. Les secrets connus de NOX, par valeur puis par nom.
    for (const secret of secrets) {
      text = text.split(secret).join(SECRET_PLACEHOLDER);
    }
    text = text.replace(secretNames, SECRET_PLACEHOLDER);

    // 4. Les formes de secret reconnaissables, meme inconnues de NOX.
    text = text.replace(PEM_BLOCK, SECRET_PLACEHOLDER);
    for (const pattern of SECRET_PATTERNS) {
      text = text.replace(pattern, SECRET_PLACEHOLDER);
    }
    text = text.replace(
      SECRET_ASSIGNMENT,
      (_match, name: string, separator: string, quote: string) =>
        `${name}${separator}${quote}${SECRET_PLACEHOLDER}${quote}`,
    );

    // 5. Ce qui pourrait afficher autre chose que le texte reel. Les espaces et
    //    les sauts de ligne, eux, ne sont pas touches : ils sont le Markdown.
    return text.replace(CONTROL_CHARACTERS, "");
  };
}

/**
 * Nettoie une chaine isolee.
 *
 * Raccourci pour les appels uniques — la demande de l'utilisateur, ses
 * precisions. Pour un lot de documents, `createArchitectSanitizer` evite de
 * reconstruire les motifs a chaque appel.
 */
export function sanitizeArchitectContext(
  value: string,
  options: ArchitectSanitizerOptions,
): string {
  return createArchitectSanitizer(options)(value);
}
