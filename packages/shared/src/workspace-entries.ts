/**
 * Localisation d'une divergence du dossier de travail.
 *
 * ## Ce que l'empreinte ne peut pas dire
 *
 * `workspace-fingerprint.ts` repond a une question, et la repond bien : « le
 * dossier de travail est-il **exactement** celui qui a ete relu ? ». C'est la
 * garantie de securite, et elle reste seule autorite pour accorder ou refuser
 * une reprise.
 *
 * Mais un HMAC unique ne sait dire que « non ». Face a un refus, l'utilisateur
 * du second pilote reel n'avait aucun moyen de savoir s'il avait touche un
 * fichier, si un outil de fond avait ecrit un cache, ou si le jeton du runner
 * avait change. Un refus qu'on ne peut pas diagnostiquer se contourne — en
 * general en detruisant le travail qu'il protegeait.
 *
 * ## Ce que ce module ajoute
 *
 * Une empreinte **par entree**, calculee avec la meme cle, sur exactement les
 * memes octets. Comparer deux listes nomme alors ce qui a change : apparu,
 * disparu, statut Git different, contenu different.
 *
 * ## Ce que ce module n'est pas
 *
 * Ce n'est pas un second controle de securite, et il ne doit jamais en devenir
 * un. L'empreinte globale decide ; ces entrees **expliquent** une decision deja
 * prise. Si les deux se contredisaient — liste identique, empreinte differente —
 * c'est l'empreinte qui gagne, et le refus tient. Le code le dit explicitement.
 *
 * ## Aucun contenu ne sort
 *
 * Une entree porte un chemin relatif, deux lettres de statut Git, et un HMAC.
 * Jamais un octet du fichier. Les chemins relatifs sont deja ce que la review
 * affiche ; le HMAC est authentifie par la cle du runner, donc il n'ouvre
 * aucune attaque hors ligne sur un `.env` de faible entropie.
 */

/**
 * Bornes de la liste conservee.
 *
 * Plus basses que celles de l'empreinte, et volontairement. L'empreinte doit
 * couvrir **tout** le dossier de travail — un controle partiel n'en est pas un —
 * alors que cette liste sert a expliquer. Au-dela de la borne, NOX n'en conserve
 * aucune plutot qu'une partie : une liste tronquee ferait dire « ce fichier est
 * apparu » d'un fichier simplement absent de la moitie retenue.
 */
export const WORKSPACE_ENTRY_LIMITS = {
  /** Entrees conservees. Au-dela, aucune n'est gardee. */
  maxEntries: 500,
  /** Longueur d'un chemin conserve. Au-dela, aucune entree n'est gardee. */
  maxPathLength: 1_024,
  /** Caracteres hexadecimaux d'une empreinte d'entree. */
  digestLength: 32,
  /** Chemins nommes dans un message de divergence. */
  maxNamedPaths: 5,
} as const;

/**
 * Une entree changee du dossier de travail, telle qu'elle est conservee.
 *
 * `code` sont les deux lettres de `git status --porcelain=v1` : index puis
 * dossier de travail. Elles distinguent « modifie » de « ajoute a l'index », ce
 * qu'un digest de contenu ne dirait pas.
 */
export type WorkspaceEntryDigest = {
  /** Chemin relatif au repository, separateurs `/`. */
  path: string;
  /** Les deux lettres d'etat de `git status --porcelain`. */
  code: string;
  /** HMAC hexadecimal de l'entree, calcule avec la cle du runner. */
  digest: string;
};

function isEntry(value: unknown): value is WorkspaceEntryDigest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record["path"] === "string" &&
    record["path"] !== "" &&
    typeof record["code"] === "string" &&
    typeof record["digest"] === "string" &&
    record["digest"] !== ""
  );
}

/**
 * Serialise la liste pour la base, ou rend `null` quand elle ne tient pas.
 *
 * JSON plutot qu'un format en lignes : un chemin Git peut contenir un retour a
 * la ligne, et un separateur qu'une donnee a le droit de contenir n'est pas un
 * separateur. Les autres colonnes de NOX qui listent des chemins portent ce
 * defaut latent ; celle-ci sert a decider d'un refus, alors elle ne le porte pas.
 *
 * `null` signifie « NOX ne conservera aucune entree », et c'est un etat prevu :
 * la reprise reste possible, seul son diagnostic sera moins precis.
 */
export function serializeWorkspaceEntries(
  entries: readonly WorkspaceEntryDigest[],
): string | null {
  if (entries.length === 0 || entries.length > WORKSPACE_ENTRY_LIMITS.maxEntries) {
    return null;
  }
  if (entries.some((entry) => entry.path.length > WORKSPACE_ENTRY_LIMITS.maxPathLength)) {
    return null;
  }
  return JSON.stringify(
    entries.map((entry) => ({ path: entry.path, code: entry.code, digest: entry.digest })),
  );
}

/**
 * Relit une liste serialisee.
 *
 * Tolerante : une valeur illisible rend `null`, jamais une exception. Cette
 * colonne est facultative, et une base ecrite par une version anterieure doit
 * rester lisible sans qu'une page tombe.
 */
export function parseWorkspaceEntries(value: string | null): WorkspaceEntryDigest[] | null {
  if (value === null || value.trim() === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length > WORKSPACE_ENTRY_LIMITS.maxEntries) {
    return null;
  }
  const entries: WorkspaceEntryDigest[] = [];
  for (const raw of parsed) {
    if (!isEntry(raw)) {
      return null;
    }
    entries.push({ path: raw.path, code: raw.code, digest: raw.digest });
  }
  return entries;
}

/** Ce qui distingue deux etats du dossier de travail, chemin par chemin. */
export type WorkspaceDivergence = {
  /** Presents maintenant, absents de l'etat relu. */
  appeared: readonly string[];
  /** Presents dans l'etat relu, absents maintenant. */
  disappeared: readonly string[];
  /** Presents des deux cotes, contenu different. */
  modified: readonly string[];
  /** Presents des deux cotes, contenu identique, statut Git different. */
  restaged: readonly string[];
};

/** Vrai des qu'une des quatre listes n'est pas vide. */
export function divergenceIsEmpty(divergence: WorkspaceDivergence): boolean {
  return (
    divergence.appeared.length === 0 &&
    divergence.disappeared.length === 0 &&
    divergence.modified.length === 0 &&
    divergence.restaged.length === 0
  );
}

/**
 * Compare l'etat relu et l'etat courant, chemin par chemin.
 *
 * Fonction pure. Elle ne decide de rien : c'est `fingerprintsMatch` qui refuse
 * ou accorde, et cette comparaison ne sert qu'a formuler le refus.
 */
export function diffWorkspaceEntries(
  expected: readonly WorkspaceEntryDigest[],
  current: readonly WorkspaceEntryDigest[],
): WorkspaceDivergence {
  const before = new Map(expected.map((entry) => [entry.path, entry]));
  const after = new Map(current.map((entry) => [entry.path, entry]));

  const appeared: string[] = [];
  const disappeared: string[] = [];
  const modified: string[] = [];
  const restaged: string[] = [];

  for (const [path, entry] of after) {
    const previous = before.get(path);
    if (previous === undefined) {
      appeared.push(path);
      continue;
    }
    if (previous.digest !== entry.digest) {
      modified.push(path);
      continue;
    }
    if (previous.code !== entry.code) {
      restaged.push(path);
    }
  }

  for (const path of before.keys()) {
    if (!after.has(path)) {
      disappeared.push(path);
    }
  }

  const sort = (values: string[]): string[] => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    appeared: sort(appeared),
    disappeared: sort(disappeared),
    modified: sort(modified),
    restaged: sort(restaged),
  };
}

/** Nomme quelques chemins, et compte le reste. */
function namePaths(paths: readonly string[]): string {
  const shown = paths.slice(0, WORKSPACE_ENTRY_LIMITS.maxNamedPaths);
  const rest = paths.length - shown.length;
  return rest === 0 ? shown.join(", ") : `${shown.join(", ")} (+${String(rest)} autres)`;
}

/**
 * Ecrit la divergence en une phrase, bornee par l'appelant.
 *
 * L'ordre des familles n'est pas cosmetique : un fichier apparu est ce que
 * l'utilisateur reconnait le plus vite comme etant de son fait, et un fichier
 * simplement re-indexe est le moins inquietant. On nomme d'abord ce qui
 * s'explique.
 */
export function describeWorkspaceDivergence(divergence: WorkspaceDivergence): string | null {
  const parts: string[] = [];
  if (divergence.appeared.length > 0) {
    parts.push(`apparus : ${namePaths(divergence.appeared)}`);
  }
  if (divergence.disappeared.length > 0) {
    parts.push(`disparus : ${namePaths(divergence.disappeared)}`);
  }
  if (divergence.modified.length > 0) {
    parts.push(`modifies : ${namePaths(divergence.modified)}`);
  }
  if (divergence.restaged.length > 0) {
    parts.push(`reindexes : ${namePaths(divergence.restaged)}`);
  }
  return parts.length === 0 ? null : parts.join(" ; ");
}

/**
 * Message de refus, quelle que soit la finesse de ce que NOX sait.
 *
 * Trois cas, trois phrases, et aucune ne pretend en savoir plus qu'une autre :
 *
 * - une divergence localisee : les chemins sont nommes ;
 * - une divergence non localisable : NOX le dit, et rappelle qu'un changement de
 *   jeton de runner produit le meme refus ;
 * - une liste identique malgre une empreinte differente : c'est l'empreinte qui
 *   gagne, et le message ne laisse pas croire que « rien n'a change ».
 */
export function workspaceDivergenceMessage(
  divergence: WorkspaceDivergence | null,
): string {
  if (divergence === null) {
    return (
      "Le dossier de travail ne correspond plus a l'etat relu, et NOX ne peut pas nommer " +
      "les chemins concernes. Un jeton de runner different depuis la capture produit le " +
      "meme refus."
    );
  }
  const described = describeWorkspaceDivergence(divergence);
  if (described === null) {
    return (
      "Le dossier de travail ne correspond plus a l'etat relu, alors que les chemins " +
      "changes sont les memes. Une reprise reste refusee : c'est l'empreinte qui fait foi."
    );
  }
  return `Le dossier de travail a diverge depuis l'execution relue — ${described}.`;
}
