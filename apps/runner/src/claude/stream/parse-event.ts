/**
 * Lecture d'une ligne NDJSON de Claude Code.
 *
 * Une ligne, un objet JSON — c'est tout ce que cette etape decide. Elle ne
 * normalise rien, n'interprete aucun champ, et ne juge pas du contenu : elle
 * repond a « est-ce un objet JSON que je peux regarder ? ».
 *
 * ## Pourquoi les tableaux et les primitives sont refuses
 *
 * `[1, 2, 3]`, `"bonjour"` et `42` sont du JSON parfaitement valide. Les
 * accepter donnerait une valeur sur laquelle toute lecture de champ retourne
 * `undefined` — donc un evenement vide, muet, indistinguable d'un evenement
 * legitime dont tous les champs manqueraient. Un refus franc en dit plus.
 *
 * ## Ce qui n'est jamais journalise
 *
 * La ligne elle-meme. Elle peut contenir le contenu d'un fichier, un secret lu
 * par l'agent, ou un chemin absolu. En cas d'echec, seules sa **taille** et la
 * **nature** du probleme sont exploitables — jamais son texte.
 */

/** Message brut de Claude Code, avant toute normalisation. */
export type ClaudeStreamMessage = Record<string, unknown>;

export type ParsedLine =
  | { ok: true; message: ClaudeStreamMessage }
  | { ok: false; reason: ParseFailureReason; length: number };

export type ParseFailureReason =
  /** La ligne n'est pas du JSON. */
  | "invalid_json"
  /** La ligne est un tableau JSON. */
  | "array"
  /** La ligne est une primitive JSON : nombre, chaine, booleen, `null`. */
  | "primitive";

/**
 * Lit une ligne et retourne l'objet qu'elle contient, ou la raison du refus.
 *
 * Ne leve jamais : une ligne illisible est un cas normal du flux d'un processus
 * exterieur, pas une exception du runner.
 */
export function parseStreamLine(line: string): ParsedLine {
  const length = line.length;

  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false, reason: "invalid_json", length };
  }

  if (Array.isArray(value)) {
    return { ok: false, reason: "array", length };
  }
  if (typeof value !== "object" || value === null) {
    return { ok: false, reason: "primitive", length };
  }

  return { ok: true, message: value as ClaudeStreamMessage };
}

/**
 * Reconnait le message de resultat final.
 *
 * C'est le seul message dont NOX a besoin pour rester compatible avec TASK-008 :
 * il porte le compte rendu, la session, les durees, le nombre de tours et le
 * cout. Le reste du flux est de la progression — utile a lire, jamais necessaire
 * a conclure.
 */
export function isFinalResultMessage(message: ClaudeStreamMessage): boolean {
  return message["type"] === "result";
}

/** Lit une chaine, ou `null` si le champ est absent ou d'un autre type. */
export function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

/** Lit un nombre fini, ou `null`. */
export function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Lit un booleen, ou `null`. */
export function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

/** Lit un objet imbrique, ou `null` — les tableaux sont exclus, comme partout. */
export function readRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** Lit un tableau, ou un tableau vide si le champ n'en est pas un. */
export function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}
